from __future__ import annotations

import csv
import json
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .models import Bar, Funding


ASTER_FUTURES_BASE = "https://fapi.asterdex.com"


def _get_json(url: str) -> Any:
    request = Request(url, headers={"User-Agent": "DisDex-raw-bt/1.0"})
    with urlopen(request, timeout=30) as response:
        return json.load(response)


def fetch_aster_bundle(symbols: list[str], start_ms: int, end_ms: int, interval: str = "1h") -> dict[str, Any]:
    bars: dict[str, list[Bar]] = {}
    funding: dict[str, list[Funding]] = {}
    for symbol in symbols:
        rows: list[Bar] = []
        cursor = start_ms
        while cursor < end_ms:
            query = urlencode({"symbol": symbol, "interval": interval, "startTime": cursor, "endTime": end_ms, "limit": 1000})
            payload = _get_json(f"{ASTER_FUTURES_BASE}/fapi/v1/klines?{query}")
            if not payload:
                break
            for item in payload:
                ts_ms = int(item[0])
                if start_ms <= ts_ms < end_ms:
                    rows.append(Bar(symbol, ts_ms, float(item[1]), float(item[2]), float(item[3]), float(item[4]), float(item[5])))
            last_ts = int(payload[-1][0])
            if last_ts < cursor:
                raise RuntimeError(f"Aster kline cursor did not advance for {symbol}")
            cursor = last_ts + 3_600_000
            if len(payload) < 1000:
                break
            time.sleep(0.05)
        bars[symbol] = rows
        funding[symbol] = []
    return {"period": {"start_ms": start_ms, "end_ms": end_ms}, "interval": interval, "interval_ms": 3_600_000, "bars": bars, "funding": funding}


def load_stock_bars(path: Path, symbol: str) -> list[Bar]:
    rows: list[Bar] = []
    with path.open(newline="", encoding="utf-8") as handle:
        for item in csv.DictReader(handle):
            ts_value = item.get("ts_ms") or item.get("timestamp") or item.get("ts")
            rows.append(Bar(symbol, int(ts_value), float(item["open"]), float(item["high"]), float(item["low"]), float(item["close"]), float(item.get("volume", 0.0))))
    return rows

