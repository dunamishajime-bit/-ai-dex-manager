from __future__ import annotations

import argparse
import asyncio
import collections
import datetime as dt
import gzip
import json
import math
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, Optional

try:
    import websockets
except ImportError:  # pragma: no cover
    websockets = None

STRATEGY_ID = "V96_STOCK_CROSS_VENUE_MAKER_HEDGE_V13"
SYMBOLS = ("AMZN", "META", "MSFT", "NVDA", "TSLA")
ASTER = {s: f"{s}USDT" for s in SYMBOLS}
XYZ = {s: f"xyz:{s}" for s in SYMBOLS}
ASTER_WS = "wss://fstream.asterdex.com"
XYZ_WS = "wss://api.hyperliquid.xyz/ws"
COSTS = {"FORWARD_MEDIAN": 6.0, "NORMAL": 10.0, "P95": 17.0, "SEVERE": 30.0}
NOTIONAL = 100.0
MIN_NET_BPS = 2.0
MAX_QUEUE_USD = 250.0
MIN_HEDGE_USD = 100.0
FRESH_MS = 1500
TTL_MS = 3000
CANCEL_MOVE_BPS = 4.0
MAX_ADVERSE_IMBALANCE = 0.65
TRADE_WINDOW_MS = 2000


def now_ms() -> int:
    return int(time.time() * 1000)


def iso(ms: Optional[int] = None) -> str:
    value = dt.datetime.fromtimestamp((ms or now_ms()) / 1000, tz=dt.timezone.utc)
    return value.isoformat().replace("+00:00", "Z")


def finite(value: Any) -> Optional[float]:
    try:
        value = float(value)
    except (TypeError, ValueError):
        return None
    return value if math.isfinite(value) else None


def request_json(url: str, payload: Optional[dict] = None) -> Any:
    headers = {"User-Agent": "DisDex-V13-Shadow/1.0", "Accept": "application/json"}
    data = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(payload, separators=(",", ":")).encode()
    request = urllib.request.Request(url, data=data, headers=headers, method="POST" if data else "GET")
    with urllib.request.urlopen(request, timeout=15) as response:
        return json.loads(response.read().decode())


def percentile(values: list[float], q: float) -> Optional[float]:
    if not values:
        return None
    values = sorted(values)
    x = (len(values) - 1) * q
    lo, hi = math.floor(x), math.ceil(x)
    return values[lo] if lo == hi else values[lo] * (hi - x) + values[hi] * (x - lo)


class Writer:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.handle = gzip.open(path, "at", encoding="utf-8")

    def write(self, row: dict) -> None:
        self.handle.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")
        self.handle.flush()

    def close(self) -> None:
        self.handle.close()


class Engine:
    def __init__(self, writer: Writer):
        self.writer = writer
        self.books: Dict[tuple[str, str], dict] = {}
        self.trades = collections.defaultdict(collections.deque)
        self.quotes: Dict[str, dict] = {}
        self.stats = collections.Counter()
        self.gross: list[float] = []
        self.edges: list[float] = []
        self.latencies: list[float] = []
        self.counter = 0

    def record(self, row: dict) -> None:
        self.writer.write({"schemaVersion": 1, "strategyId": STRATEGY_ID, **row})

    def book(self, venue: str, symbol: str, event_ms: int, received_ms: int,
             bid: float, bid_qty: float, ask: float, ask_qty: float) -> None:
        if min(bid, bid_qty, ask, ask_qty) <= 0 or ask <= bid:
            return
        row = {"venue": venue, "symbol": symbol, "eventMs": event_ms, "receivedMs": received_ms,
               "bid": bid, "bidQty": bid_qty, "ask": ask, "askQty": ask_qty,
               "mid": (bid + ask) / 2}
        self.books[(venue, symbol)] = row
        self.stats[f"book_{venue}"] += 1
        self.latencies.append(max(0, received_ms - event_ms))
        self.record({"recordType": "book", **row})
        self.refresh(symbol, received_ms)

    def trade(self, venue: str, symbol: str, event_ms: int, received_ms: int,
              price: float, quantity: float, aggressor: str) -> None:
        row = {"venue": venue, "symbol": symbol, "eventMs": event_ms, "receivedMs": received_ms,
               "price": price, "quantity": quantity, "aggressor": aggressor,
               "notional": price * quantity}
        window = self.trades[(venue, symbol)]
        window.append(row)
        while window and window[0]["receivedMs"] < received_ms - TRADE_WINDOW_MS:
            window.popleft()
        self.stats[f"trade_{venue}"] += 1
        self.record({"recordType": "trade", **row})
        quote = self.quotes.get(symbol)
        if quote and quote["status"] == "OPEN" and quote["makerVenue"] == venue:
            self.consume(quote, row)

    def imbalance(self, venue: str, symbol: str, received_ms: int) -> Optional[float]:
        window = self.trades[(venue, symbol)]
        while window and window[0]["receivedMs"] < received_ms - TRADE_WINDOW_MS:
            window.popleft()
        buy = sum(t["notional"] for t in window if t["aggressor"] == "BUY")
        sell = sum(t["notional"] for t in window if t["aggressor"] == "SELL")
        return (buy - sell) / (buy + sell) if buy + sell else None

    def ready(self, symbol: str, received_ms: int) -> Optional[tuple[dict, dict]]:
        a, x = self.books.get(("ASTER", symbol)), self.books.get(("XYZ", symbol))
        if not a or not x or received_ms - a["receivedMs"] > FRESH_MS or received_ms - x["receivedMs"] > FRESH_MS:
            return None
        return a, x

    def candidates(self, symbol: str, received_ms: int) -> list[dict]:
        pair = self.ready(symbol, received_ms)
        if not pair:
            return []
        rows = []
        for maker, hedge in ((pair[0], pair[1]), (pair[1], pair[0])):
            for side in ("BUY", "SELL"):
                maker_price = maker["bid"] if side == "BUY" else maker["ask"]
                maker_usd = maker_price * (maker["bidQty"] if side == "BUY" else maker["askQty"])
                hedge_price = hedge["bid"] if side == "BUY" else hedge["ask"]
                hedge_usd = hedge_price * (hedge["bidQty"] if side == "BUY" else hedge["askQty"])
                gross = (hedge_price / maker_price - 1) * 10000 if side == "BUY" else (maker_price / hedge_price - 1) * 10000
                net = gross - COSTS["NORMAL"]
                imbalance = self.imbalance(maker["venue"], symbol, received_ms)
                adverse = None if imbalance is None else (-imbalance if side == "BUY" else imbalance)
                eligible = net >= MIN_NET_BPS and maker_usd <= MAX_QUEUE_USD and hedge_usd >= MIN_HEDGE_USD and (adverse is None or adverse <= MAX_ADVERSE_IMBALANCE)
                rows.append({"symbol": symbol, "makerVenue": maker["venue"], "hedgeVenue": hedge["venue"],
                             "side": side, "makerPrice": maker_price, "makerTopUsd": maker_usd,
                             "hedgeTopUsd": hedge_usd, "grossEdgeBps": gross, "netEdgeBps": net,
                             "tradeImbalance": imbalance, "adverseImbalance": adverse, "eligible": eligible})
        return rows

    def refresh(self, symbol: str, received_ms: int) -> None:
        quote = self.quotes.get(symbol)
        if quote and quote["status"] == "OPEN":
            self.cancel_if_needed(quote, received_ms)
            if quote["status"] == "OPEN":
                return
        rows = self.candidates(symbol, received_ms)
        for row in rows:
            self.edges.append(row["netEdgeBps"])
            self.record({"recordType": "opportunity", "receivedMs": received_ms, **row})
        eligible = [r for r in rows if r["eligible"]]
        if not eligible:
            return
        selected = max(eligible, key=lambda r: (r["netEdgeBps"], -r["makerTopUsd"]))
        self.counter += 1
        hedge = self.books[(selected["hedgeVenue"], symbol)]
        quote = {**selected, "quoteId": f"v13-{self.counter:08d}", "quantity": NOTIONAL / selected["makerPrice"],
                 "createdMs": received_ms, "expiresMs": received_ms + TTL_MS,
                 "queueAheadUsd": selected["makerTopUsd"], "filledUsd": 0.0,
                 "referenceMid": hedge["mid"], "status": "OPEN", "cancelReason": None}
        self.quotes[symbol] = quote
        self.stats["quotes"] += 1
        self.record({"recordType": "virtual_quote_open", **quote})

    def cancel_if_needed(self, quote: dict, received_ms: int) -> None:
        reason = None
        pair = self.ready(quote["symbol"], received_ms)
        if received_ms >= quote["expiresMs"]:
            reason = "TTL"
        elif not pair:
            reason = "STALE_OR_INVALID_BOOK"
        else:
            maker = self.books[(quote["makerVenue"], quote["symbol"])]
            hedge = self.books[(quote["hedgeVenue"], quote["symbol"])]
            current = maker["bid"] if quote["side"] == "BUY" else maker["ask"]
            if current != quote["makerPrice"]:
                reason = "MAKER_TOP_MOVED"
            elif abs(hedge["mid"] / quote["referenceMid"] - 1) * 10000 > CANCEL_MOVE_BPS:
                reason = "REFERENCE_MOVED"
            else:
                imbalance = self.imbalance(quote["makerVenue"], quote["symbol"], received_ms)
                adverse = None if imbalance is None else (-imbalance if quote["side"] == "BUY" else imbalance)
                if adverse is not None and adverse > MAX_ADVERSE_IMBALANCE:
                    reason = "ADVERSE_ORDER_FLOW"
        if reason:
            quote["status"], quote["cancelReason"] = "CANCELED", reason
            self.stats[f"cancel_{reason}"] += 1
            self.record({"recordType": "virtual_quote_cancel", "canceledMs": received_ms, **quote})

    def consume(self, quote: dict, trade: dict) -> None:
        crosses = (quote["side"] == "BUY" and trade["aggressor"] == "SELL" and trade["price"] <= quote["makerPrice"]) or (quote["side"] == "SELL" and trade["aggressor"] == "BUY" and trade["price"] >= quote["makerPrice"])
        if not crosses:
            return
        usd = trade["notional"]
        consumed = min(quote["queueAheadUsd"], usd)
        quote["queueAheadUsd"] -= consumed
        usd -= consumed
        quote["filledUsd"] += min(max(0.0, NOTIONAL - quote["filledUsd"]), max(0.0, usd))
        if quote["filledUsd"] + 1e-9 < NOTIONAL:
            return
        hedge = self.books.get((quote["hedgeVenue"], quote["symbol"]))
        if not hedge or trade["receivedMs"] - hedge["receivedMs"] > FRESH_MS:
            quote["status"], quote["cancelReason"] = "UNHEDGED_REJECTED", "HEDGE_BOOK_STALE"
            self.stats["unhedged"] += 1
            return
        hedge_price = hedge["bid"] if quote["side"] == "BUY" else hedge["ask"]
        hedge_usd = hedge_price * (hedge["bidQty"] if quote["side"] == "BUY" else hedge["askQty"])
        if hedge_usd < NOTIONAL:
            quote["status"], quote["cancelReason"] = "UNHEDGED_REJECTED", "HEDGE_TOP_DEPTH"
            self.stats["unhedged"] += 1
            return
        gross = (hedge_price / quote["makerPrice"] - 1) * 10000 if quote["side"] == "BUY" else (quote["makerPrice"] / hedge_price - 1) * 10000
        quote["status"] = "FILLED_AND_HEDGED"
        self.gross.append(gross)
        self.stats["fills"] += 1
        self.record({"recordType": "virtual_fill_and_hedge", "filledMs": trade["receivedMs"],
                     "hedgePrice": hedge_price, "hedgeTopUsd": hedge_usd, "grossBps": gross,
                     "normalNetBps": gross - COSTS["NORMAL"], **quote})

    def result(self) -> dict:
        for quote in self.quotes.values():
            if quote["status"] == "OPEN":
                quote["status"], quote["cancelReason"] = "CANCELED", "PROBE_END"
                self.stats["cancel_PROBE_END"] += 1
        coverage = {s: sorted(v for v in ("ASTER", "XYZ") if (v, s) in self.books) for s in SYMBOLS}
        complete = [s for s, venues in coverage.items() if venues == ["ASTER", "XYZ"]]
        scenarios = {}
        for name, cost in COSTS.items():
            net = [g - cost for g in self.gross]
            scenarios[name] = {"costBps": cost, "fills": len(net),
                               "averageNetBps": sum(net) / len(net) if net else None,
                               "positiveNetRate": sum(n > 0 for n in net) / len(net) if net else None,
                               "minimumNetBps": min(net) if net else None, "maximumNetBps": max(net) if net else None}
        status = "V13_FORWARD_DATA_REQUIRED" if len(complete) == len(SYMBOLS) else "V13_ENDPOINT_OR_SYMBOL_COVERAGE_FAILED"
        if len(self.gross) >= 30:
            normal = scenarios["NORMAL"]
            status = "V13_SHORT_PROBE_LEAD_FORWARD_ONLY" if normal["averageNetBps"] > 0 and normal["positiveNetRate"] >= 0.55 else "V13_SHORT_PROBE_FAILED"
        return {"strategyId": STRATEGY_ID, "status": status, "generatedAt": iso(),
                "safety": {"mode": "SHADOW_RESEARCH_ONLY", "orderSubmissionAllowed": False,
                           "productionChanged": False, "liveChanged": False, "vpsChanged": False, "cryptoV96Changed": False},
                "coverage": {"booksBySymbol": coverage, "completeSymbols": complete,
                             "asterBooks": self.stats["book_ASTER"], "xyzBooks": self.stats["book_XYZ"],
                             "asterTrades": self.stats["trade_ASTER"], "xyzTrades": self.stats["trade_XYZ"]},
                "virtualExecution": {"quotesOpened": self.stats["quotes"], "fills": self.stats["fills"],
                                     "fillRate": self.stats["fills"] / self.stats["quotes"] if self.stats["quotes"] else 0.0,
                                     "unhedgedRejected": self.stats["unhedged"],
                                     "cancellations": {k.removeprefix("cancel_"): v for k, v in self.stats.items() if k.startswith("cancel_")}},
                "costScenarios": scenarios,
                "diagnostics": {"latencyP50Ms": percentile(self.latencies, .5), "latencyP95Ms": percentile(self.latencies, .95),
                                "observedNetEdgeP50Bps": percentile(self.edges, .5), "observedNetEdgeP95Bps": percentile(self.edges, .95)},
                "promotionGate": {"minimumForwardRegularSessions": 20, "minimumVirtualFills": 100,
                                  "minimumPositiveNetRate": .55, "normalP95SevereAverageNetMustBePositive": True,
                                  "maximumSingleSymbolPnlShare": .40, "retuningOnCollectedForwardWindow": False}}

