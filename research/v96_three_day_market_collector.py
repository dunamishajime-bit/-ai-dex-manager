from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import gzip
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

try:
    import websockets
except ImportError:  # pragma: no cover - surfaced clearly by main()
    websockets = None

API_BASE = "https://fapi.asterdex.com"
WS_BASE = "wss://fstream.asterdex.com"
DEFAULT_SYMBOLS = ("BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT")
DEFAULT_START_UTC = "2026-07-22T00:00:00Z"
DEFAULT_END_UTC = "2026-07-25T00:00:00Z"
DEPTH_LIMIT = 100
DEPTH_BANDS_BPS = (5.0, 10.0, 25.0)


def utc_now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def iso(value: dt.datetime) -> str:
    return value.astimezone(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def parse_utc(value: str) -> dt.datetime:
    normalized = value.strip().replace("Z", "+00:00")
    parsed = dt.datetime.fromisoformat(normalized)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed.astimezone(dt.timezone.utc)


def finite(value: Any, fallback: Optional[float] = None) -> Optional[float]:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return number if math.isfinite(number) else fallback


def fetch_json(path: str, params: Optional[Dict[str, Any]] = None, timeout: int = 12) -> Any:
    query = urllib.parse.urlencode(params or {})
    url = f"{API_BASE}{path}" + (f"?{query}" if query else "")
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": "DisDex-V96-ThreeDay-Collector/1.0",
        },
    )
    last_error: Optional[Exception] = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except Exception as exc:
            last_error = exc
            if attempt < 2:
                time.sleep(0.5 * (attempt + 1))
    raise RuntimeError(f"GET {path} failed: {last_error}")


def quote_depth(levels: Sequence[Sequence[Any]], mid: float, side: str, band_bps: float) -> float:
    if mid <= 0:
        return 0.0
    total = 0.0
    for level in levels:
        if len(level) < 2:
            continue
        price = finite(level[0])
        quantity = finite(level[1])
        if price is None or quantity is None or price <= 0 or quantity < 0:
            continue
        distance_bps = ((mid - price) / mid * 10_000.0) if side == "bid" else ((price - mid) / mid * 10_000.0)
        if -1e-9 <= distance_bps <= band_bps + 1e-9:
            total += price * quantity
    return total


def depth_metrics(depth: Any, book: Any) -> Dict[str, Any]:
    bids = depth.get("bids", []) if isinstance(depth, dict) else []
    asks = depth.get("asks", []) if isinstance(depth, dict) else []
    best_bid = finite(book.get("bidPrice")) if isinstance(book, dict) else None
    best_ask = finite(book.get("askPrice")) if isinstance(book, dict) else None
    if best_bid is None and bids:
        best_bid = finite(bids[0][0])
    if best_ask is None and asks:
        best_ask = finite(asks[0][0])
    mid = (best_bid + best_ask) / 2.0 if best_bid and best_ask and best_bid > 0 and best_ask > 0 else None
    spread_bps = (best_ask - best_bid) / mid * 10_000.0 if mid and best_bid is not None and best_ask is not None else None
    metrics: Dict[str, Any] = {
        "lastUpdateId": depth.get("lastUpdateId") if isinstance(depth, dict) else None,
        "bestBid": best_bid,
        "bestAsk": best_ask,
        "bestBidQty": finite(book.get("bidQty")) if isinstance(book, dict) else None,
        "bestAskQty": finite(book.get("askQty")) if isinstance(book, dict) else None,
        "mid": mid,
        "spreadBps": spread_bps,
        "bands": {},
    }
    if mid:
        for band in DEPTH_BANDS_BPS:
            bid_quote = quote_depth(bids, mid, "bid", band)
            ask_quote = quote_depth(asks, mid, "ask", band)
            denominator = bid_quote + ask_quote
            metrics["bands"][str(int(band))] = {
                "bidQuote": bid_quote,
                "askQuote": ask_quote,
                "imbalance": (bid_quote - ask_quote) / denominator if denominator > 0 else None,
            }
    metrics["topLevels"] = {
        "bids": bids[:20],
        "asks": asks[:20],
    }
    return metrics


def endpoint_capture(path: str, params: Dict[str, Any]) -> Dict[str, Any]:
    started = time.monotonic()
    try:
        payload = fetch_json(path, params)
        return {
            "ok": True,
            "latencyMs": round((time.monotonic() - started) * 1000.0, 3),
            "payload": payload,
        }
    except Exception as exc:
        return {
            "ok": False,
            "latencyMs": round((time.monotonic() - started) * 1000.0, 3),
            "error": f"{type(exc).__name__}: {exc}",
        }


def snapshot_symbol(symbol: str, captured_at: dt.datetime) -> Dict[str, Any]:
    premium = endpoint_capture("/fapi/v1/premiumIndex", {"symbol": symbol})
    open_interest = endpoint_capture("/fapi/v1/openInterest", {"symbol": symbol})
    depth = endpoint_capture("/fapi/v1/depth", {"symbol": symbol, "limit": DEPTH_LIMIT})
    book = endpoint_capture("/fapi/v1/ticker/bookTicker", {"symbol": symbol})
    ticker = endpoint_capture("/fapi/v1/ticker/price", {"symbol": symbol})

    premium_payload = premium.get("payload") if premium.get("ok") else None
    depth_payload = depth.get("payload") if depth.get("ok") else None
    book_payload = book.get("payload") if book.get("ok") else None
    mark = finite(premium_payload.get("markPrice")) if isinstance(premium_payload, dict) else None
    index = finite(premium_payload.get("indexPrice")) if isinstance(premium_payload, dict) else None

    return {
        "schemaVersion": 1,
        "recordType": "market_snapshot",
        "capturedAt": iso(captured_at),
        "capturedAtMs": int(captured_at.timestamp() * 1000),
        "symbol": symbol,
        "premium": premium,
        "openInterest": open_interest,
        "depth": depth,
        "bookTicker": book,
        "lastPrice": ticker,
        "derived": {
            "markIndexPremiumBps": (mark / index - 1.0) * 10_000.0 if mark and index and index > 0 else None,
            "orderBook": depth_metrics(depth_payload, book_payload),
        },
    }


@dataclass
class CollectorStats:
    snapshots: int = 0
    liquidation_events: int = 0
    rest_errors: int = 0
    websocket_connections: int = 0
    websocket_errors: int = 0
    started_at: str = ""
    finished_at: str = ""
    symbols: List[str] = field(default_factory=list)


class GzipJsonlWriter:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self.handle = gzip.open(path, "at", encoding="utf-8")

    def write(self, row: Dict[str, Any]) -> None:
        self.handle.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")
        self.handle.flush()

    def close(self) -> None:
        self.handle.close()


async def liquidation_listener(
    symbols: Sequence[str],
    writer: GzipJsonlWriter,
    stats: CollectorStats,
    stop_at: float,
    error_writer: GzipJsonlWriter,
) -> None:
    if websockets is None:
        stats.websocket_errors += 1
        error_writer.write({
            "schemaVersion": 1,
            "recordType": "collector_error",
            "capturedAt": iso(utc_now()),
            "component": "websocket",
            "error": "websockets package is not installed",
        })
        return
    streams = "/".join(f"{symbol.lower()}@forceOrder" for symbol in symbols)
    url = f"{WS_BASE}/stream?streams={streams}"
    allowed = set(symbols)
    while time.monotonic() < stop_at:
        try:
            async with websockets.connect(
                url,
                open_timeout=15,
                ping_interval=15,
                ping_timeout=15,
                close_timeout=5,
                max_size=2**20,
            ) as websocket:
                stats.websocket_connections += 1
                while time.monotonic() < stop_at:
                    remaining = max(0.1, stop_at - time.monotonic())
                    try:
                        message = await asyncio.wait_for(websocket.recv(), timeout=min(30.0, remaining))
                    except asyncio.TimeoutError:
                        continue
                    payload = json.loads(message)
                    data = payload.get("data", payload) if isinstance(payload, dict) else payload
                    order = data.get("o", {}) if isinstance(data, dict) else {}
                    symbol = str(order.get("s", ""))
                    if symbol not in allowed:
                        continue
                    received = utc_now()
                    writer.write({
                        "schemaVersion": 1,
                        "recordType": "liquidation",
                        "receivedAt": iso(received),
                        "receivedAtMs": int(received.timestamp() * 1000),
                        "stream": payload.get("stream") if isinstance(payload, dict) else None,
                        "symbol": symbol,
                        "event": data,
                    })
                    stats.liquidation_events += 1
        except Exception as exc:
            stats.websocket_errors += 1
            error_writer.write({
                "schemaVersion": 1,
                "recordType": "collector_error",
                "capturedAt": iso(utc_now()),
                "component": "liquidation_websocket",
                "error": f"{type(exc).__name__}: {exc}",
            })
            await asyncio.sleep(min(5.0, max(0.0, stop_at - time.monotonic())))


async def snapshot_loop(
    symbols: Sequence[str],
    writer: GzipJsonlWriter,
    stats: CollectorStats,
    stop_at: float,
    interval_seconds: float,
) -> None:
    next_capture = time.monotonic()
    while time.monotonic() < stop_at:
        captured_at = utc_now()
        rows = await asyncio.gather(
            *(asyncio.to_thread(snapshot_symbol, symbol, captured_at) for symbol in symbols)
        )
        for row in rows:
            writer.write(row)
            stats.snapshots += 1
            stats.rest_errors += sum(
                1
                for key in ("premium", "openInterest", "depth", "bookTicker", "lastPrice")
                if not bool(row.get(key, {}).get("ok"))
            )
        next_capture += interval_seconds
        await asyncio.sleep(max(0.0, min(stop_at - time.monotonic(), next_capture - time.monotonic())))


def run_unit_tests() -> None:
    parsed = parse_utc("2026-07-22T00:00:00Z")
    assert iso(parsed) == "2026-07-22T00:00:00Z"
    depth = {
        "lastUpdateId": 1,
        "bids": [["99.99", "2"], ["99.90", "3"]],
        "asks": [["100.01", "4"], ["100.10", "5"]],
    }
    book = {"bidPrice": "99.99", "askPrice": "100.01", "bidQty": "2", "askQty": "4"}
    metrics = depth_metrics(depth, book)
    assert metrics["spreadBps"] is not None and abs(metrics["spreadBps"] - 2.0) < 0.001
    assert metrics["bands"]["5"]["bidQuote"] > 0
    assert metrics["bands"]["5"]["askQuote"] > 0
    assert finite("nan") is None


async def collect(args: argparse.Namespace) -> int:
    symbols = tuple(dict.fromkeys(symbol.upper() for symbol in args.symbols))
    start_utc = parse_utc(args.start_utc)
    end_utc = parse_utc(args.end_utc)
    now = utc_now()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    status_path = output_dir / "run-status.txt"

    if not args.ignore_window and now < start_utc:
        status_path.write_text("not_started\n", encoding="utf-8")
        (output_dir / "window.json").write_text(json.dumps({
            "status": "not_started", "now": iso(now), "startUtc": iso(start_utc), "endUtc": iso(end_utc)
        }, indent=2), encoding="utf-8")
        return 0
    if not args.ignore_window and now >= end_utc:
        status_path.write_text("expired\n", encoding="utf-8")
        (output_dir / "window.json").write_text(json.dumps({
            "status": "expired", "now": iso(now), "startUtc": iso(start_utc), "endUtc": iso(end_utc)
        }, indent=2), encoding="utf-8")
        return 0

    remaining_window = (end_utc - now).total_seconds() if not args.ignore_window else args.duration_seconds
    duration = max(1.0, min(float(args.duration_seconds), remaining_window))
    stamp = now.strftime("%Y%m%dT%H%M%SZ")
    run_id = os.environ.get("GITHUB_RUN_ID", "local")
    prefix = f"{stamp}-{run_id}"
    snapshot_path = output_dir / f"snapshots-{prefix}.jsonl.gz"
    liquidation_path = output_dir / f"liquidations-{prefix}.jsonl.gz"
    error_path = output_dir / f"errors-{prefix}.jsonl.gz"
    summary_path = output_dir / f"summary-{prefix}.json"

    snapshot_writer = GzipJsonlWriter(snapshot_path)
    liquidation_writer = GzipJsonlWriter(liquidation_path)
    error_writer = GzipJsonlWriter(error_path)
    stats = CollectorStats(started_at=iso(now), symbols=list(symbols))
    stop_at = time.monotonic() + duration
    try:
        await asyncio.gather(
            snapshot_loop(symbols, snapshot_writer, stats, stop_at, float(args.interval_seconds)),
            liquidation_listener(symbols, liquidation_writer, stats, stop_at, error_writer),
        )
    finally:
        snapshot_writer.close()
        liquidation_writer.close()
        error_writer.close()
    stats.finished_at = iso(utc_now())
    summary = {
        "schemaVersion": 1,
        "status": "collected",
        "windowStartUtc": iso(start_utc),
        "windowEndUtc": iso(end_utc),
        "durationSecondsRequested": args.duration_seconds,
        "durationSecondsActual": duration,
        "intervalSeconds": args.interval_seconds,
        "stats": stats.__dict__,
        "files": {
            "snapshots": snapshot_path.name,
            "liquidations": liquidation_path.name,
            "errors": error_path.name,
        },
        "safety": {
            "orderSubmissionAllowed": False,
            "liveTradingChanged": False,
            "productionStrategyChanged": False,
        },
    }
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    status_path.write_text("collected\n", encoding="utf-8")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Collect three days of Aster market microstructure evidence.")
    parser.add_argument("--output-dir", default=".research-state/v96-three-day-market-data")
    parser.add_argument("--symbols", nargs="+", default=list(DEFAULT_SYMBOLS))
    parser.add_argument("--start-utc", default=os.environ.get("COLLECTION_START_UTC", DEFAULT_START_UTC))
    parser.add_argument("--end-utc", default=os.environ.get("COLLECTION_END_UTC", DEFAULT_END_UTC))
    parser.add_argument("--duration-seconds", type=int, default=3000)
    parser.add_argument("--interval-seconds", type=float, default=60.0)
    parser.add_argument("--ignore-window", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    run_unit_tests()
    if args.self_test:
        Path(args.output_dir).mkdir(parents=True, exist_ok=True)
        Path(args.output_dir, "run-status.txt").write_text("self_test\n", encoding="utf-8")
        print("V96 three-day collector self-test: PASS")
        return 0
    if websockets is None:
        print("Missing dependency: websockets", file=sys.stderr)
        return 2
    return asyncio.run(collect(args))


if __name__ == "__main__":
    raise SystemExit(main())
