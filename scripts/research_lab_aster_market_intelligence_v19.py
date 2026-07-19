from __future__ import annotations

import asyncio
import datetime as dt
import json
import math
import os
import statistics
import time
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

import websockets

ASTER_REST = "https://fapi.asterdex.com"
ASTER_WS = "wss://fstream.asterdex.com/stream"
BINANCE_FUTURES = "https://fapi.binance.com"
SYMBOLS = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "LINKUSDT", "AVAXUSDT"]
DURATION_SECONDS = int(os.environ.get("ASTER_V19_DURATION_SECONDS", "120"))
BUCKET_SECONDS = int(os.environ.get("ASTER_V19_BUCKET_SECONDS", "5"))
DEPTH_LEVELS = int(os.environ.get("ASTER_V19_DEPTH_LEVELS", "20"))
STATE_DIR = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
ROOT = STATE_DIR / "aster-market-intelligence-v19"
HISTORY_DIR = ROOT / "history"
NOTIONALS = [1000.0, 5000.0]
TAKER_FEE_BPS_PER_SIDE = 3.5


def fetch_json(base: str, path: str, params: Optional[dict] = None, timeout: int = 15) -> object:
    query = urllib.parse.urlencode(params or {})
    url = f"{base}{path}" + (f"?{query}" if query else "")
    request = urllib.request.Request(url, headers={"User-Agent": "GoldCat-Research-V19/1.0"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def safe_float(value: object, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def percentile(values: List[float], q: float) -> Optional[float]:
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    index = (len(ordered) - 1) * q
    lower = math.floor(index)
    upper = math.ceil(index)
    if lower == upper:
        return ordered[lower]
    fraction = index - lower
    return ordered[lower] * (1.0 - fraction) + ordered[upper] * fraction


def summarize(values: Iterable[float]) -> dict:
    cleaned = [float(value) for value in values if value is not None and math.isfinite(float(value))]
    return {
        "count": len(cleaned),
        "mean": statistics.fmean(cleaned) if cleaned else None,
        "median": statistics.median(cleaned) if cleaned else None,
        "p10": percentile(cleaned, 0.10),
        "p90": percentile(cleaned, 0.90),
        "min": min(cleaned) if cleaned else None,
        "max": max(cleaned) if cleaned else None,
    }


def pearson(left: List[float], right: List[float]) -> Optional[float]:
    if len(left) != len(right) or len(left) < 20:
        return None
    left_mean = statistics.fmean(left)
    right_mean = statistics.fmean(right)
    numerator = sum((x - left_mean) * (y - right_mean) for x, y in zip(left, right))
    left_var = sum((x - left_mean) ** 2 for x in left)
    right_var = sum((y - right_mean) ** 2 for y in right)
    denominator = math.sqrt(left_var * right_var)
    return numerator / denominator if denominator > 0 else None


def walk_book(levels: List[List[str]], notional: float) -> Optional[float]:
    remaining = notional
    quantity = 0.0
    spent = 0.0
    for raw_price, raw_qty, *_ in levels:
        price = safe_float(raw_price)
        qty = safe_float(raw_qty)
        if price <= 0 or qty <= 0:
            continue
        available = price * qty
        used = min(remaining, available)
        quantity += used / price
        spent += used
        remaining -= used
        if remaining <= 1e-9:
            break
    if remaining > 1e-6 or quantity <= 0:
        return None
    return spent / quantity


def depth_features(bids: List[List[str]], asks: List[List[str]]) -> dict:
    if not bids or not asks:
        return {}
    best_bid = safe_float(bids[0][0])
    best_ask = safe_float(asks[0][0])
    if best_bid <= 0 or best_ask <= 0:
        return {}
    mid = (best_bid + best_ask) / 2.0
    result = {
        "bestBid": best_bid,
        "bestAsk": best_ask,
        "mid": mid,
        "spreadBps": (best_ask - best_bid) / mid * 10_000.0,
    }
    for band in [5, 10, 25]:
        bid_floor = mid * (1.0 - band / 10_000.0)
        ask_cap = mid * (1.0 + band / 10_000.0)
        bid_notional = sum(safe_float(price) * safe_float(qty) for price, qty, *_ in bids if safe_float(price) >= bid_floor)
        ask_notional = sum(safe_float(price) * safe_float(qty) for price, qty, *_ in asks if safe_float(price) <= ask_cap)
        total = bid_notional + ask_notional
        result[f"bidDepth{band}Bps"] = bid_notional
        result[f"askDepth{band}Bps"] = ask_notional
        result[f"bookImbalance{band}Bps"] = (bid_notional - ask_notional) / total if total > 0 else 0.0
    for notional in NOTIONALS:
        buy = walk_book(asks, notional)
        sell = walk_book(bids, notional)
        key = str(int(notional))
        if buy is None or sell is None:
            result[f"roundTrip{key}Bps"] = None
        else:
            buy_impact = (buy / mid - 1.0) * 10_000.0
            sell_impact = (1.0 - sell / mid) * 10_000.0
            result[f"roundTrip{key}Bps"] = buy_impact + sell_impact + 2 * TAKER_FEE_BPS_PER_SIDE
    return result


def oi_snapshot(symbol: str) -> Tuple[Optional[float], Optional[str]]:
    try:
        payload = fetch_json(BINANCE_FUTURES, "/fapi/v1/openInterest", {"symbol": symbol})
        value = safe_float(payload.get("openInterest")) if isinstance(payload, dict) else 0.0
        return (value if value > 0 else None), "BINANCE_USDM_PROXY"
    except Exception as error:
        return None, f"UNAVAILABLE:{type(error).__name__}"


def initial_rest_snapshot(symbol: str) -> dict:
    depth = fetch_json(ASTER_REST, "/fapi/v1/depth", {"symbol": symbol, "limit": DEPTH_LEVELS})
    premium = fetch_json(ASTER_REST, "/fapi/v1/premiumIndex", {"symbol": symbol})
    ticker = fetch_json(ASTER_REST, "/fapi/v1/ticker/24hr", {"symbol": symbol})
    features = depth_features(depth.get("bids", []), depth.get("asks", []))
    mark = safe_float(premium.get("markPrice"))
    index = safe_float(premium.get("indexPrice"))
    features.update({
        "markPrice": mark,
        "indexPrice": index,
        "basisBps": (mark / index - 1.0) * 10_000.0 if mark > 0 and index > 0 else 0.0,
        "fundingRate": safe_float(premium.get("lastFundingRate")),
        "nextFundingTime": int(premium.get("nextFundingTime", 0) or 0),
        "priceChange24hPct": safe_float(ticker.get("priceChangePercent")),
        "quoteVolume24h": safe_float(ticker.get("quoteVolume")),
        "tradeCount24h": int(ticker.get("count", 0) or 0),
    })
    return features


def parse_liquidation(data: object) -> List[dict]:
    payloads = data if isinstance(data, list) else [data]
    result: List[dict] = []
    for payload in payloads:
        if not isinstance(payload, dict):
            continue
        order = payload.get("o", payload)
        if not isinstance(order, dict):
            continue
        symbol = order.get("s")
        if symbol not in SYMBOLS:
            continue
        price = safe_float(order.get("ap") or order.get("p"))
        qty = safe_float(order.get("z") or order.get("q"))
        result.append({
            "symbol": symbol,
            "side": str(order.get("S", "")),
            "notional": price * qty,
            "timestamp": int(order.get("T") or payload.get("E") or time.time() * 1000),
        })
    return result


def combined_stream_url() -> str:
    streams: List[str] = []
    for symbol in SYMBOLS:
        lower = symbol.lower()
        streams.extend([
            f"{lower}@aggTrade",
            f"{lower}@depth{DEPTH_LEVELS}@500ms",
            f"{lower}@markPrice@1s",
        ])
    streams.append("!forceOrder@arr")
    return ASTER_WS + "?streams=" + "/".join(streams)


class Collector:
    def __init__(self) -> None:
        self.latest: Dict[str, dict] = {}
        self.bucket_flow: Dict[str, dict] = defaultdict(lambda: {
            "takerBuyNotional": 0.0,
            "takerSellNotional": 0.0,
            "liquidationBuyNotional": 0.0,
            "liquidationSellNotional": 0.0,
            "aggTradeEvents": 0,
            "depthEvents": 0,
            "markEvents": 0,
            "liquidationEvents": 0,
        })
        self.rows: List[dict] = []
        self.errors: List[str] = []
        self.ws_messages = 0
        self.started_ms = int(time.time() * 1000)
        self.oi_start: Dict[str, Optional[float]] = {}
        self.oi_end: Dict[str, Optional[float]] = {}
        self.oi_source: Dict[str, Optional[str]] = {}

    async def initialize(self) -> None:
        for symbol in SYMBOLS:
            try:
                self.latest[symbol] = await asyncio.to_thread(initial_rest_snapshot, symbol)
            except Exception as error:
                self.latest[symbol] = {}
                self.errors.append(f"initial:{symbol}:{type(error).__name__}:{error}")
            value, source = await asyncio.to_thread(oi_snapshot, symbol)
            self.oi_start[symbol] = value
            self.oi_source[symbol] = source

    def process(self, envelope: dict) -> None:
        data = envelope.get("data", envelope)
        stream = str(envelope.get("stream", ""))
        self.ws_messages += 1
        if "forceOrder" in stream:
            for item in parse_liquidation(data):
                flow = self.bucket_flow[item["symbol"]]
                key = "liquidationBuyNotional" if item["side"] == "BUY" else "liquidationSellNotional"
                flow[key] += item["notional"]
                flow["liquidationEvents"] += 1
            return
        if not isinstance(data, dict):
            return
        symbol = data.get("s")
        if symbol not in SYMBOLS:
            return
        latest = self.latest.setdefault(symbol, {})
        flow = self.bucket_flow[symbol]
        event = data.get("e")
        if event == "aggTrade" or "@aggTrade" in stream:
            price = safe_float(data.get("p"))
            qty = safe_float(data.get("q"))
            notional = price * qty
            if bool(data.get("m")):
                flow["takerSellNotional"] += notional
            else:
                flow["takerBuyNotional"] += notional
            flow["aggTradeEvents"] += 1
            latest["lastTradePrice"] = price
        elif event == "depthUpdate" or "@depth" in stream:
            bids = data.get("b", data.get("bids", []))
            asks = data.get("a", data.get("asks", []))
            metrics = depth_features(bids, asks)
            if metrics:
                latest.update(metrics)
                flow["depthEvents"] += 1
        elif event == "markPriceUpdate" or "@markPrice" in stream:
            mark = safe_float(data.get("p"))
            index = safe_float(data.get("i"))
            latest.update({
                "markPrice": mark,
                "indexPrice": index,
                "basisBps": (mark / index - 1.0) * 10_000.0 if mark > 0 and index > 0 else 0.0,
                "fundingRate": safe_float(data.get("r")),
                "nextFundingTime": int(data.get("T", 0) or 0),
            })
            flow["markEvents"] += 1

    def capture_bucket(self, timestamp_ms: int) -> None:
        for symbol in SYMBOLS:
            latest = dict(self.latest.get(symbol, {}))
            flow = dict(self.bucket_flow[symbol])
            buy = flow["takerBuyNotional"]
            sell = flow["takerSellNotional"]
            flow_total = buy + sell
            liq_buy = flow["liquidationBuyNotional"]
            liq_sell = flow["liquidationSellNotional"]
            liq_total = liq_buy + liq_sell
            row = {
                "timestamp": timestamp_ms,
                "runStarted": self.started_ms,
                "symbol": symbol,
                **latest,
                **flow,
                "takerImbalance": (buy - sell) / flow_total if flow_total > 0 else 0.0,
                "liquidationImbalance": (liq_buy - liq_sell) / liq_total if liq_total > 0 else 0.0,
                "oiStart": self.oi_start.get(symbol),
                "oiSource": self.oi_source.get(symbol),
            }
            self.rows.append(row)
            self.bucket_flow[symbol] = {
                "takerBuyNotional": 0.0,
                "takerSellNotional": 0.0,
                "liquidationBuyNotional": 0.0,
                "liquidationSellNotional": 0.0,
                "aggTradeEvents": 0,
                "depthEvents": 0,
                "markEvents": 0,
                "liquidationEvents": 0,
            }

    async def run(self) -> None:
        await self.initialize()
        url = combined_stream_url()
        end_at = time.monotonic() + DURATION_SECONDS
        next_bucket = time.monotonic() + BUCKET_SECONDS
        try:
            async with websockets.connect(
                url,
                ping_interval=20,
                ping_timeout=20,
                close_timeout=10,
                max_size=8_000_000,
                user_agent_header="GoldCat-Research-V19/1.0",
            ) as websocket:
                while time.monotonic() < end_at:
                    now = time.monotonic()
                    timeout = max(0.05, min(1.0, end_at - now, next_bucket - now))
                    try:
                        raw = await asyncio.wait_for(websocket.recv(), timeout=timeout)
                        self.process(json.loads(raw))
                    except asyncio.TimeoutError:
                        pass
                    except Exception as error:
                        self.errors.append(f"message:{type(error).__name__}:{error}")
                    now = time.monotonic()
                    if now >= next_bucket:
                        self.capture_bucket(int(time.time() * 1000))
                        next_bucket += BUCKET_SECONDS
        except Exception as error:
            self.errors.append(f"websocket:{type(error).__name__}:{error}")
        if not self.rows or self.rows[-1]["timestamp"] < int(time.time() * 1000) - BUCKET_SECONDS * 1000:
            self.capture_bucket(int(time.time() * 1000))
        for symbol in SYMBOLS:
            value, source = await asyncio.to_thread(oi_snapshot, symbol)
            self.oi_end[symbol] = value
            if self.oi_source.get(symbol) is None:
                self.oi_source[symbol] = source
        for row in self.rows:
            symbol = row["symbol"]
            start = self.oi_start.get(symbol)
            end = self.oi_end.get(symbol)
            row["oiEnd"] = end
            row["oiChangePct"] = ((end / start - 1.0) * 100.0) if start and end and start > 0 else None


def load_history() -> List[dict]:
    rows: List[dict] = []
    if not HISTORY_DIR.exists():
        return rows
    for path in sorted(HISTORY_DIR.glob("*.ndjson")):
        try:
            for line in path.read_text(encoding="utf-8").splitlines():
                if line.strip():
                    rows.append(json.loads(line))
        except Exception:
            continue
    return rows


def persist(rows: List[dict]) -> Path:
    HISTORY_DIR.mkdir(parents=True, exist_ok=True)
    today = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d")
    path = HISTORY_DIR / f"{today}.ndjson"
    with path.open("a", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")
    return path


def feature_analysis(rows: List[dict]) -> dict:
    features = [
        "bookImbalance5Bps",
        "bookImbalance10Bps",
        "bookImbalance25Bps",
        "takerImbalance",
        "liquidationImbalance",
        "basisBps",
        "fundingRate",
        "oiChangePct",
    ]
    horizons = {"30s": max(1, round(30 / BUCKET_SECONDS)), "60s": max(1, round(60 / BUCKET_SECONDS))}
    result: Dict[str, dict] = {}
    for symbol in SYMBOLS:
        symbol_rows = sorted([row for row in rows if row.get("symbol") == symbol and safe_float(row.get("mid")) > 0], key=lambda row: int(row["timestamp"]))
        result[symbol] = {"samples": len(symbol_rows), "features": {}}
        for feature in features:
            feature_result: Dict[str, dict] = {}
            for horizon_name, steps in horizons.items():
                xs: List[float] = []
                ys: List[float] = []
                for index, row in enumerate(symbol_rows):
                    future_index = index + steps
                    if future_index >= len(symbol_rows):
                        break
                    future = symbol_rows[future_index]
                    expected_gap = steps * BUCKET_SECONDS * 1000
                    if int(future["timestamp"]) - int(row["timestamp"]) > expected_gap * 1.6:
                        continue
                    value = row.get(feature)
                    if value is None:
                        continue
                    x = safe_float(value, float("nan"))
                    if not math.isfinite(x):
                        continue
                    current_mid = safe_float(row.get("mid"))
                    future_mid = safe_float(future.get("mid"))
                    if current_mid <= 0 or future_mid <= 0:
                        continue
                    xs.append(x)
                    ys.append((future_mid / current_mid - 1.0) * 10_000.0)
                correlation = pearson(xs, ys)
                event_spread = None
                if len(xs) >= 50:
                    low_cut = percentile(xs, 0.20)
                    high_cut = percentile(xs, 0.80)
                    low_returns = [y for x, y in zip(xs, ys) if low_cut is not None and x <= low_cut]
                    high_returns = [y for x, y in zip(xs, ys) if high_cut is not None and x >= high_cut]
                    if low_returns and high_returns:
                        event_spread = statistics.fmean(high_returns) - statistics.fmean(low_returns)
                feature_result[horizon_name] = {
                    "pairs": len(xs),
                    "correlation": correlation,
                    "topMinusBottomQuintileReturnBps": event_spread,
                }
            result[symbol]["features"][feature] = feature_result
    return result


def rounded(value: object) -> object:
    if isinstance(value, float):
        return round(value, 6) if math.isfinite(value) else None
    if isinstance(value, dict):
        return {key: rounded(item) for key, item in value.items()}
    if isinstance(value, list):
        return [rounded(item) for item in value]
    return value


def build_report(result: dict) -> str:
    lines = [
        "# Aster Market Intelligence V19",
        "",
        f"- Status: **{result['status']}**",
        f"- Observation span: {result['coverage']['observationHours']} hours",
        f"- Stored rows: {result['coverage']['totalRows']}",
        f"- Current run rows: {result['currentRun']['rows']}",
        f"- WebSocket messages: {result['currentRun']['websocketMessages']}",
        f"- Errors: {len(result['currentRun']['errors'])}",
        "- Authentication/API key: NOT USED",
        "- Production changed: NO",
        "- Real trading: DISABLED",
        "",
        "| Symbol | Rows | Spread p90 | Book imbalance 10bps mean | Taker imbalance mean | Basis mean bps | Funding mean | OI proxy |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ]
    for symbol in SYMBOLS:
        item = result["summary"].get(symbol, {})
        lines.append(
            f"| {symbol} | {item.get('rows', 0)} | {item.get('spreadBps', {}).get('p90')} | "
            f"{item.get('bookImbalance10Bps', {}).get('mean')} | {item.get('takerImbalance', {}).get('mean')} | "
            f"{item.get('basisBps', {}).get('mean')} | {item.get('fundingRate', {}).get('mean')} | {item.get('oiSource')} |"
        )
    lines.extend([
        "",
        "## Interpretation",
        "",
        "This collector measures order-book imbalance, taker buy/sell flow, mark-index basis, funding, liquidation flow and a clearly-labelled Binance USD-M open-interest proxy. It does not alter V6 or authorize Paper/Live trading.",
        "",
        "## Next Gate",
        "",
        "Seven calendar days are required for preliminary event-study analysis. Thirty days and frozen forward validation are required before any feature may influence V6 entries, exits or position sizing.",
    ])
    return "\n".join(lines)


async def main_async() -> None:
    collector = Collector()
    await collector.run()
    history_path = persist(collector.rows)
    history = load_history()
    timestamps = [int(row["timestamp"]) for row in history if row.get("timestamp")]
    observation_hours = (max(timestamps) - min(timestamps)) / 3_600_000.0 if len(timestamps) >= 2 else 0.0
    summary: Dict[str, dict] = {}
    for symbol in SYMBOLS:
        rows = [row for row in history if row.get("symbol") == symbol]
        summary[symbol] = {
            "rows": len(rows),
            "spreadBps": summarize(row.get("spreadBps") for row in rows),
            "bookImbalance10Bps": summarize(row.get("bookImbalance10Bps") for row in rows),
            "takerImbalance": summarize(row.get("takerImbalance") for row in rows),
            "liquidationImbalance": summarize(row.get("liquidationImbalance") for row in rows),
            "basisBps": summarize(row.get("basisBps") for row in rows),
            "fundingRate": summarize(row.get("fundingRate") for row in rows),
            "oiChangePct": summarize(row.get("oiChangePct") for row in rows),
            "roundTrip1000Bps": summarize(row.get("roundTrip1000Bps") for row in rows),
            "roundTrip5000Bps": summarize(row.get("roundTrip5000Bps") for row in rows),
            "oiSource": next((row.get("oiSource") for row in reversed(rows) if row.get("oiSource")), None),
        }
    minimum_rows = min((summary[symbol]["rows"] for symbol in SYMBOLS), default=0)
    if observation_hours >= 720 and minimum_rows >= 8000:
        status = "MARKET_INTELLIGENCE_READY_FOR_FROZEN_FEATURE_AUDIT"
    elif observation_hours >= 168 and minimum_rows >= 1800:
        status = "PRELIMINARY_SEVEN_DAY_ANALYSIS_READY"
    else:
        status = "MARKET_INTELLIGENCE_COLLECTION_STARTED"
    result = rounded({
        "version": 19,
        "strategyId": "ASTER_MARKET_INTELLIGENCE_V19",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": status,
        "configuration": {
            "symbols": SYMBOLS,
            "durationSecondsPerRun": DURATION_SECONDS,
            "bucketSeconds": BUCKET_SECONDS,
            "depthLevels": DEPTH_LEVELS,
            "authenticationUsed": False,
        },
        "sources": {
            "asterRest": ASTER_REST,
            "asterWebSocket": ASTER_WS,
            "asterFeatures": ["orderBook", "aggregateTrades", "markIndexBasis", "funding", "liquidations"],
            "openInterest": "Binance USD-M public openInterest endpoint used only as a cross-market proxy because Aster public OI was not documented.",
        },
        "coverage": {
            "observationHours": observation_hours,
            "totalRows": len(history),
            "minimumRowsPerSymbol": minimum_rows,
            "historyFile": str(history_path),
        },
        "currentRun": {
            "rows": len(collector.rows),
            "websocketMessages": collector.ws_messages,
            "errors": collector.errors,
        },
        "summary": summary,
        "shortHorizonEventStudy": feature_analysis(history),
        "gates": {
            "preliminary": "7 calendar days and >=1800 five-second buckets per symbol",
            "robust": "30 calendar days and >=8000 buckets per symbol, day-split stability, then frozen forward audit",
            "noSameRunRetuning": True,
        },
        "productionChanged": False,
        "realTradingEnabled": False,
        "paperEligible": False,
        "liveEligible": False,
        "limitations": [
            "Order-book and liquidation history cannot be reconstructed before collection start from the documented public Aster API.",
            "Binance open interest is a market-wide proxy and is not presented as Aster venue open interest.",
            "Short-horizon correlations are descriptive until day-split and frozen-forward validation pass.",
            "No API key, order placement, account, position, VPS, .env or production runner access is used.",
        ],
    })
    ROOT.mkdir(parents=True, exist_ok=True)
    (ROOT / "aster-market-intelligence-v19.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    report = build_report(result)
    (ROOT / "aster-market-intelligence-v19.md").write_text(report, encoding="utf-8")
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + report)
    print(report)


def main() -> None:
    asyncio.run(main_async())


if __name__ == "__main__":
    main()
