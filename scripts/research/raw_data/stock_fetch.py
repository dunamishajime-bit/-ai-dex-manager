from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .models import Bar


def _series(payload: dict[str, Any]) -> tuple[list[int], dict[str, list[Any]]]:
    try:
        result = payload["chart"]["result"][0]
        timestamps = list(result["timestamp"])
        quote = result["indicators"]["quote"][0]
    except (KeyError, IndexError, TypeError) as exc:
        raise ValueError("Malformed Yahoo Finance chart payload") from exc
    required = ("open", "high", "low", "close", "volume")
    if any(key not in quote for key in required):
        raise ValueError("Yahoo Finance chart payload is missing an OHLCV series")
    series = {key: list(quote[key]) for key in required}
    if any(len(values) != len(timestamps) for values in series.values()):
        raise ValueError("Yahoo Finance chart series lengths do not match timestamps")
    return timestamps, series


def load_yahoo_chart_json(path: Path, symbol: str, start_ms: int, end_ms: int) -> list[Bar]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    timestamps, series = _series(payload)
    rows: list[Bar] = []
    for index, timestamp_s in enumerate(timestamps):
        ts_ms = int(timestamp_s) * 1000
        if not start_ms <= ts_ms < end_ms:
            continue
        values = [series[key][index] for key in ("open", "high", "low", "close", "volume")]
        if all(value is None for value in values):
            continue
        if any(value is None for value in values):
            raise ValueError(f"Yahoo Finance chart has null OHLCV at {ts_ms} for {symbol}")
        rows.append(Bar(symbol, ts_ms, *(float(value) for value in values)))
    return rows
