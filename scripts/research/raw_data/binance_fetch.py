from __future__ import annotations

import json
import time
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .models import Bar, Funding


BINANCE_FUTURES_BASE = "https://fapi.binance.com"
HOUR_MS = 3_600_000


def _get_json(url: str) -> Any:
    request = Request(url, headers={"User-Agent": "DisDex-raw-bt/1.0"})
    with urlopen(request, timeout=30) as response:
        return json.load(response)


def parse_binance_kline_rows(symbol: str, payload: list[list[Any]]) -> list[Bar]:
    rows: list[Bar] = []
    for item in payload:
        if len(item) < 6:
            raise ValueError(f"Malformed Binance kline for {symbol}: expected at least 6 fields")
        rows.append(Bar(symbol, int(item[0]), float(item[1]), float(item[2]), float(item[3]), float(item[4]), float(item[5])))
    return rows


def parse_binance_funding_rows(symbol: str, payload: list[dict[str, Any]]) -> list[Funding]:
    rows: list[Funding] = []
    for item in payload:
        rows.append(Funding(symbol, int(item["fundingTime"]), float(item["fundingRate"])))
    return rows


def _fetch_klines(symbol: str, start_ms: int, end_ms: int, interval: str) -> list[Bar]:
    rows: list[Bar] = []
    cursor = start_ms
    while cursor < end_ms:
        query = urlencode({"symbol": symbol, "interval": interval, "startTime": cursor, "endTime": end_ms, "limit": 1500})
        payload = _get_json(f"{BINANCE_FUTURES_BASE}/fapi/v1/klines?{query}")
        if not payload:
            break
        page = parse_binance_kline_rows(symbol, payload)
        rows.extend(row for row in page if start_ms <= row.ts_ms < end_ms)
        last_ts = page[-1].ts_ms
        if last_ts < cursor:
            raise RuntimeError(f"Binance kline cursor did not advance for {symbol}")
        cursor = last_ts + HOUR_MS
        if len(page) < 1500:
            break
        time.sleep(0.05)
    return rows


def _fetch_funding(symbol: str, start_ms: int, end_ms: int) -> list[Funding]:
    rows: list[Funding] = []
    cursor = start_ms
    while cursor < end_ms:
        query = urlencode({"symbol": symbol, "startTime": cursor, "endTime": end_ms, "limit": 1000})
        payload = _get_json(f"{BINANCE_FUTURES_BASE}/fapi/v1/fundingRate?{query}")
        if not payload:
            break
        page = parse_binance_funding_rows(symbol, payload)
        rows.extend(row for row in page if start_ms <= row.ts_ms < end_ms)
        last_ts = page[-1].ts_ms
        if last_ts < cursor:
            raise RuntimeError(f"Binance funding cursor did not advance for {symbol}")
        cursor = last_ts + 1
        if len(page) < 1000:
            break
        time.sleep(0.05)
    return rows


def fetch_binance_bundle(symbols: list[str], start_ms: int, end_ms: int, interval: str = "1h") -> dict[str, Any]:
    bars = {symbol: _fetch_klines(symbol, start_ms, end_ms, interval) for symbol in symbols}
    funding = {symbol: _fetch_funding(symbol, start_ms, end_ms) for symbol in symbols}
    return {
        "source": {"provider": "Binance USD-M Futures public REST", "base_url": BINANCE_FUTURES_BASE, "authenticated": False},
        "period": {"start_ms": start_ms, "end_ms": end_ms},
        "interval": interval,
        "interval_ms": HOUR_MS,
        "bars": bars,
        "funding": funding,
    }
