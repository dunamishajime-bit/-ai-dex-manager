from __future__ import annotations

import asyncio
import datetime as dt
import json
import math
import os
from pathlib import Path
from typing import Any, Dict, Iterable, Optional, Sequence
from zoneinfo import ZoneInfo

import v96_three_day_market_collector as base

JST = ZoneInfo("Asia/Tokyo")
NY = ZoneInfo("America/New_York")
EXECUTION_NOTIONALS = (100.0, 500.0, 1000.0)
EXTRA_ENDPOINT_KEYS = ("ticker24h", "klines1m")


def finite(value: Any, fallback: Optional[float] = None) -> Optional[float]:
    return base.finite(value, fallback)


def percentile(values: Sequence[float], fraction: float) -> Optional[float]:
    if not values:
        return None
    ordered = sorted(values)
    position = (len(ordered) - 1) * fraction
    lower = int(math.floor(position))
    upper = int(math.ceil(position))
    if lower == upper:
        return ordered[lower]
    weight = position - lower
    return ordered[lower] * (1.0 - weight) + ordered[upper] * weight


def market_clock(captured_at: dt.datetime) -> Dict[str, Any]:
    utc = captured_at.astimezone(dt.timezone.utc)
    jst = utc.astimezone(JST)
    ny = utc.astimezone(NY)
    ny_minutes = ny.hour * 60 + ny.minute
    jst_minutes = jst.hour * 60 + jst.minute
    weekday = ny.weekday() < 5
    regular = weekday and 570 <= ny_minutes < 960
    stock_entry = weekday and 585 <= ny_minutes < 930
    crypto_entry = 315 <= jst_minutes < 1335
    transition = (1335 <= jst_minutes < 1365) or (270 <= jst_minutes < 315)
    return {
        "utc": base.iso(utc),
        "jst": jst.isoformat(),
        "newYork": ny.isoformat(),
        "usRegularSession": regular,
        "stockEntryAllowedByClock": stock_entry,
        "cryptoEntryAllowedByClock": crypto_entry,
        "transitionWindow": transition,
    }


def fill_estimate(
    levels: Iterable[Sequence[Any]],
    mid: Optional[float],
    quote_notional: float,
    side: str,
) -> Dict[str, Any]:
    remaining = max(0.0, quote_notional)
    base_quantity = 0.0
    quote_value = 0.0
    levels_used = 0
    worst_price: Optional[float] = None
    for level in levels:
        if len(level) < 2 or remaining <= 1e-9:
            break
        price = finite(level[0])
        quantity = finite(level[1])
        if price is None or quantity is None or price <= 0 or quantity <= 0:
            continue
        level_quote = price * quantity
        take_quote = min(remaining, level_quote)
        take_base = take_quote / price
        base_quantity += take_base
        quote_value += take_quote
        remaining -= take_quote
        levels_used += 1
        worst_price = price
    fillable = remaining <= max(1e-6, quote_notional * 1e-9) and base_quantity > 0
    average_price = quote_value / base_quantity if fillable else None
    slippage_bps: Optional[float] = None
    if fillable and average_price is not None and mid is not None and mid > 0:
        if side == "BUY":
            slippage_bps = (average_price / mid - 1.0) * 10_000.0
        else:
            slippage_bps = (mid / average_price - 1.0) * 10_000.0
    return {
        "side": side,
        "quoteNotional": quote_notional,
        "fillable": fillable,
        "filledQuote": quote_value,
        "filledBase": base_quantity,
        "averagePrice": average_price,
        "worstPrice": worst_price,
        "levelsUsed": levels_used,
        "slippageBpsFromMid": slippage_bps,
        "unfilledQuote": max(0.0, remaining),
    }


def execution_estimates(depth_payload: Any, order_book: Any) -> Dict[str, Any]:
    depth = depth_payload if isinstance(depth_payload, dict) else {}
    book = order_book if isinstance(order_book, dict) else {}
    bids = depth.get("bids", []) if isinstance(depth.get("bids"), list) else []
    asks = depth.get("asks", []) if isinstance(depth.get("asks"), list) else []
    mid = finite(book.get("mid"))
    estimates: Dict[str, Dict[str, Any]] = {}
    for notional in EXECUTION_NOTIONALS:
        key = str(int(notional))
        estimates[key] = {
            "buy": fill_estimate(asks, mid, notional, "BUY"),
            "sell": fill_estimate(bids, mid, notional, "SELL"),
        }
    return {"mid": mid, "quoteNotionals": estimates}


def latest_minute_bar(capture: Dict[str, Any]) -> Optional[dict]:
    if not capture.get("ok"):
        return None
    payload = capture.get("payload")
    if not isinstance(payload, list) or not payload:
        return None
    row = payload[-1]
    if not isinstance(row, list) or len(row) < 9:
        return None
    return {
        "openTimeMs": int(row[0]),
        "open": finite(row[1]),
        "high": finite(row[2]),
        "low": finite(row[3]),
        "close": finite(row[4]),
        "baseVolume": finite(row[5]),
        "closeTimeMs": int(row[6]),
        "quoteVolume": finite(row[7]),
        "tradeCount": int(row[8] or 0),
    }


def enhanced_snapshot_symbol(symbol: str, captured_at: dt.datetime) -> Dict[str, Any]:
    row = base.snapshot_symbol(symbol, captured_at)
    ticker24h = base.endpoint_capture("/fapi/v1/ticker/24hr", {"symbol": symbol})
    klines1m = base.endpoint_capture("/fapi/v1/klines", {"symbol": symbol, "interval": "1m", "limit": 2})
    row["schemaVersion"] = 2
    row["ticker24h"] = ticker24h
    row["klines1m"] = klines1m
    row["marketClock"] = market_clock(captured_at)
    depth_capture = row.get("depth") if isinstance(row.get("depth"), dict) else {}
    depth_payload = depth_capture.get("payload") if depth_capture.get("ok") else None
    order_book = row.get("derived", {}).get("orderBook", {})
    activity_payload = ticker24h.get("payload") if ticker24h.get("ok") else None
    activity = activity_payload if isinstance(activity_payload, dict) else {}
    row.setdefault("derived", {})["execution"] = execution_estimates(depth_payload, order_book)
    row["derived"]["latestMinuteBar"] = latest_minute_bar(klines1m)
    row["derived"]["marketActivity"] = {
        "priceChangePct24h": finite(activity.get("priceChangePercent")),
        "baseVolume24h": finite(activity.get("volume")),
        "quoteVolume24h": finite(activity.get("quoteVolume")),
        "tradeCount24h": int(activity.get("count", 0) or 0),
    }
    return row


def contract_metadata(symbols: Sequence[str], captured_at: dt.datetime) -> dict:
    exchange = base.endpoint_capture("/fapi/v1/exchangeInfo", {})
    server_time = base.endpoint_capture("/fapi/v1/time", {})
    allowed = set(symbols)
    contracts = []
    payload = exchange.get("payload") if exchange.get("ok") else None
    source_symbols = payload.get("symbols", []) if isinstance(payload, dict) else []
    for item in source_symbols:
        if not isinstance(item, dict) or str(item.get("symbol", "")).upper() not in allowed:
            continue
        contracts.append({
            "symbol": str(item.get("symbol", "")).upper(),
            "status": item.get("status"),
            "contractType": item.get("contractType"),
            "quoteAsset": item.get("quoteAsset"),
            "marginAsset": item.get("marginAsset"),
            "pricePrecision": item.get("pricePrecision"),
            "quantityPrecision": item.get("quantityPrecision"),
            "filters": item.get("filters", []),
            "orderTypes": item.get("orderTypes", []),
            "timeInForce": item.get("timeInForce", []),
        })
    server_payload = server_time.get("payload") if server_time.get("ok") else None
    server_ms = int(server_payload.get("serverTime", 0) or 0) if isinstance(server_payload, dict) else 0
    local_ms = int(captured_at.timestamp() * 1000)
    return {
        "schemaVersion": 2,
        "capturedAt": base.iso(captured_at),
        "requestedSymbols": list(symbols),
        "observedSymbols": sorted(item["symbol"] for item in contracts),
        "missingSymbols": sorted(allowed - {item["symbol"] for item in contracts}),
        "exchangeInfo": exchange,
        "serverTime": server_time,
        "clockSkewMs": (local_ms - server_ms) if server_ms > 0 else None,
        "contracts": contracts,
        "safety": {
            "orderSubmissionAllowed": False,
            "liveTradingChanged": False,
            "productionStrategyChanged": False,
        },
    }


def write_contract_metadata(output_dir: Path, symbols: Sequence[str], captured_at: dt.datetime) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    run_id = os.environ.get("GITHUB_RUN_ID", "local")
    stamp = captured_at.strftime("%Y%m%dT%H%M%SZ")
    path = output_dir / f"contracts-{stamp}-{run_id}.json"
    path.write_text(json.dumps(contract_metadata(symbols, captured_at), ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def run_unit_tests() -> None:
    base.run_unit_tests()
    levels = [["100", "1"], ["101", "2"]]
    estimate = fill_estimate(levels, 100.0, 150.0, "BUY")
    assert estimate["fillable"] is True
    assert estimate["levelsUsed"] == 2
    clock = market_clock(dt.datetime(2026, 7, 22, 14, 0, tzinfo=dt.timezone.utc))
    assert clock["usRegularSession"] is True
    assert clock["stockEntryAllowedByClock"] is True


def main() -> int:
    args = base.build_parser().parse_args()
    run_unit_tests()
    if args.self_test:
        Path(args.output_dir).mkdir(parents=True, exist_ok=True)
        Path(args.output_dir, "run-status.txt").write_text("self_test\n", encoding="utf-8")
        print("V96 stock-theme market collector quality v2 self-test: PASS")
        return 0
    if base.websockets is None:
        print("Missing dependency: websockets", file=os.sys.stderr)
        return 2
    symbols = tuple(dict.fromkeys(symbol.upper() for symbol in args.symbols))
    now = base.utc_now()
    start_utc = base.parse_utc(args.start_utc)
    end_utc = base.parse_utc(args.end_utc)
    if args.ignore_window or (start_utc <= now < end_utc):
        write_contract_metadata(Path(args.output_dir).resolve(), symbols, now)
    original = base.snapshot_symbol
    base.snapshot_symbol = enhanced_snapshot_symbol
    try:
        return asyncio.run(base.collect(args))
    finally:
        base.snapshot_symbol = original


if __name__ == "__main__":
    raise SystemExit(main())
