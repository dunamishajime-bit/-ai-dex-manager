from __future__ import annotations

import collections
import datetime as dt
import gzip
import json
import math
import time
import urllib.request
from pathlib import Path
from typing import Any, Dict, Optional
from zoneinfo import ZoneInfo

STRATEGY_ID = "V96_STOCK_CROSS_VENUE_MAKER_HEDGE_V13"
SYMBOLS = ("AMZN", "META", "MSFT", "NVDA", "TSLA")
ASTER = {s: f"{s}USDT" for s in SYMBOLS}
XYZ = {s: f"xyz:{s}" for s in SYMBOLS}
ASTER_WS = "wss://fstream.asterdex.com"
XYZ_WS = "wss://api.hyperliquid.xyz/ws"
NY = ZoneInfo("America/New_York")
COSTS = {"FORWARD_MEDIAN": 6.0, "NORMAL": 10.0, "P95": 17.0, "SEVERE": 30.0}
FORCED_COSTS = {"FORWARD_MEDIAN": 10.0, "NORMAL": 16.0, "P95": 26.0, "SEVERE": 45.0}
NOTIONAL = 100.0
MIN_NET_BPS = 2.0
MAX_QUEUE_USD = 250.0
MIN_HEDGE_USD = 100.0
FRESH_MS = 1500
TTL_MS = 3000
MAX_INVENTORY_MS = 60_000
CANCEL_MOVE_BPS = 4.0
MAX_ADVERSE_IMBALANCE = 0.65
TRADE_WINDOW_MS = 2000


def now_ms() -> int:
    return int(time.time() * 1000)


def iso(ms: Optional[int] = None) -> str:
    value = dt.datetime.fromtimestamp((ms or now_ms()) / 1000, tz=dt.timezone.utc)
    return value.isoformat().replace("+00:00", "Z")


def us_regular_session(ms: int) -> bool:
    local = dt.datetime.fromtimestamp(ms / 1000, tz=dt.timezone.utc).astimezone(NY)
    minute = local.hour * 60 + local.minute
    return local.weekday() < 5 and 570 <= minute < 960


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
    ordered = sorted(values)
    x = (len(ordered) - 1) * q
    lo, hi = math.floor(x), math.ceil(x)
    return ordered[lo] if lo == hi else ordered[lo] * (hi - x) + ordered[hi] * (x - lo)


class Writer:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.handle = gzip.open(path, "at", encoding="utf-8")

    def write(self, row: dict) -> None:
        self.handle.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")
        self.handle.flush()

    def close(self) -> None:
        self.handle.close()


class BaseEngine:
    def __init__(self, writer: Writer):
        self.writer = writer
        self.books: Dict[tuple[str, str], dict] = {}
        self.trades = collections.defaultdict(collections.deque)
        self.quotes: Dict[str, dict] = {}
        self.inventory: Dict[str, dict] = {}
        self.cycles: list[dict] = []
        self.stats = collections.Counter()
        self.edges: list[float] = []
        self.latencies: list[float] = []
        self.counter = 0

    def record(self, row: dict) -> None:
        if row.get("recordType") == "collector_error":
            self.stats["collector_errors"] += 1
        self.writer.write({"schemaVersion": 2, "strategyId": STRATEGY_ID, **row})

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

    def maker_top(self, book: dict, quote_side: str) -> tuple[float, float]:
        if quote_side == "BUY":
            return book["bid"], book["bid"] * book["bidQty"]
        return book["ask"], book["ask"] * book["askQty"]

    def taker_top(self, book: dict, action: str) -> tuple[float, float]:
        if action == "BUY":
            return book["ask"], book["ask"] * book["askQty"]
        return book["bid"], book["bid"] * book["bidQty"]

    def flow_fields(self, venue: str, symbol: str, side: str, received_ms: int) -> tuple[Optional[float], Optional[float]]:
        imbalance = self.imbalance(venue, symbol, received_ms)
        adverse = None if imbalance is None else (-imbalance if side == "BUY" else imbalance)
        return imbalance, adverse

    def opening_candidates(self, symbol: str, received_ms: int) -> list[dict]:
        pair = self.ready(symbol, received_ms)
        if not pair or not us_regular_session(received_ms):
            return []
        rows = []
        for maker, hedge in ((pair[0], pair[1]), (pair[1], pair[0])):
            for side in ("BUY", "SELL"):
                maker_price, maker_usd = self.maker_top(maker, side)
                hedge_action = "SELL" if side == "BUY" else "BUY"
                hedge_price, hedge_usd = self.taker_top(hedge, hedge_action)
                quantity = NOTIONAL / maker_price
                required_hedge_usd = quantity * hedge_price
                gross = (hedge_price / maker_price - 1) * 10_000 if side == "BUY" else (maker_price / hedge_price - 1) * 10_000
                net = gross - COSTS["NORMAL"]
                imbalance, adverse = self.flow_fields(maker["venue"], symbol, side, received_ms)
                eligible = (net >= MIN_NET_BPS and maker_usd <= MAX_QUEUE_USD
                            and hedge_usd >= max(MIN_HEDGE_USD, required_hedge_usd)
                            and (adverse is None or adverse <= MAX_ADVERSE_IMBALANCE))
                rows.append({"purpose": "OPEN", "symbol": symbol, "makerVenue": maker["venue"],
                             "hedgeVenue": hedge["venue"], "side": side, "makerPrice": maker_price,
                             "makerTopUsd": maker_usd, "hedgePrice": hedge_price, "hedgeTopUsd": hedge_usd,
                             "requiredHedgeUsd": required_hedge_usd, "grossEdgeBps": gross, "projectedNormalNetBps": net,
                             "tradeImbalance": imbalance, "adverseImbalance": adverse, "eligible": eligible})
        return rows

    def cycle_gross_bps(self, inv: dict, maker_close: float, hedge_close: float) -> float:
        q = inv["quantity"]
        if inv["openSide"] == "BUY":
            pnl = q * ((maker_close - inv["makerOpenPrice"]) + (inv["hedgeOpenPrice"] - hedge_close))
        else:
            pnl = q * ((inv["makerOpenPrice"] - maker_close) + (hedge_close - inv["hedgeOpenPrice"]))
        return pnl / inv["initialNotional"] * 10_000

    def closing_candidates(self, symbol: str, received_ms: int) -> list[dict]:
        inv = self.inventory.get(symbol)
        pair = self.ready(symbol, received_ms)
        if not inv or not pair:
            return []
        maker = self.books[(inv["makerVenue"], symbol)]
        hedge = self.books[(inv["hedgeVenue"], symbol)]
        side = "SELL" if inv["openSide"] == "BUY" else "BUY"
        hedge_action = "BUY" if inv["openSide"] == "BUY" else "SELL"
        maker_price, maker_usd = self.maker_top(maker, side)
        hedge_price, hedge_usd = self.taker_top(hedge, hedge_action)
        required_hedge_usd = inv["quantity"] * hedge_price
        gross = self.cycle_gross_bps(inv, maker_price, hedge_price)
        net = gross - COSTS["NORMAL"]
        imbalance, adverse = self.flow_fields(maker["venue"], symbol, side, received_ms)
        eligible = (net >= MIN_NET_BPS and maker_usd <= MAX_QUEUE_USD
                    and hedge_usd >= max(MIN_HEDGE_USD, required_hedge_usd)
                    and (adverse is None or adverse <= MAX_ADVERSE_IMBALANCE))
        return [{"purpose": "CLOSE", "inventoryId": inv["inventoryId"], "symbol": symbol,
                 "makerVenue": maker["venue"], "hedgeVenue": hedge["venue"], "side": side,
                 "makerPrice": maker_price, "makerTopUsd": maker_usd, "hedgePrice": hedge_price,
                 "hedgeTopUsd": hedge_usd, "requiredHedgeUsd": required_hedge_usd, "grossEdgeBps": gross,
                 "projectedNormalNetBps": net, "tradeImbalance": imbalance,
                 "adverseImbalance": adverse, "eligible": eligible}]

    def candidates(self, symbol: str, received_ms: int) -> list[dict]:
        if symbol in self.inventory:
            return self.closing_candidates(symbol, received_ms)
        return self.opening_candidates(symbol, received_ms)
