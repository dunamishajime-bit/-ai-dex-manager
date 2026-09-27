"""Auditable Aster H1 repair from independently fetched *native* 1-minute bars.

Only malformed original Aster H1 OHLC rows are eligible. Never substitute
Binance/other venue candles, fill gaps with synthetic prices, or use future
observations. If the full 60-minute window cannot be independently checked,
the original malformed H1 remains explicit and later strategy/model replay
quarantines the affected signals.
"""
from __future__ import annotations

import hashlib
import json
import math
from typing import Any

MINUTE_MS = 60_000
HOUR_MS = 60 * MINUTE_MS


def valid_h1(row: dict[str, Any]) -> bool:
    try:
        op, hi, lo, cl = (float(row[key]) for key in ("open", "high", "low", "close"))
        vol = float(row["base_volume"])
    except (KeyError, TypeError, ValueError):
        return False
    return (all(math.isfinite(value) and value > 0 for value in (op, hi, lo, cl))
            and math.isfinite(vol) and vol >= 0
            and hi >= max(op, cl) and lo <= min(op, cl)
            and hi >= lo)


def reconstruct_aster_h1(
    symbol: str, hour_ms: int, one_minute_rows: list[list[Any]],
) -> dict[str, Any]:
    """Verify 60 strictly contiguous native M1 bars and aggregate the H1."""
    if hour_ms <= 0 or hour_ms % HOUR_MS:
        raise ValueError("ASTER_H1_REPAIR_HOUR_ALIGNMENT_INVALID")
    if len(one_minute_rows) != 60:
        raise ValueError("ASTER_H1_REPAIR_REQUIRES_60_NATIVE_M1_BARS")
    records: list[tuple[float, float, float, float, float, float | None]] = []
    for index, item in enumerate(one_minute_rows):
        expected = hour_ms + index * MINUTE_MS
        if len(item) < 7 or int(item[0]) != expected:
            raise ValueError(f"ASTER_H1_REPAIR_M1_GAP:{symbol}:{expected}")
        op, hi, lo, cl, vol = (float(item[k]) for k in range(1, 6))
        quote = float(item[7]) if len(item) > 7 else None
        if not (all(math.isfinite(value) and value > 0 for value in (op, hi, lo, cl))
                and hi >= max(op, cl) and lo <= min(op, cl) and hi >= lo
                and math.isfinite(vol) and vol >= 0
                and (quote is None or (math.isfinite(quote) and quote >= 0))):
            raise ValueError(f"ASTER_H1_REPAIR_M1_OHLC_INVALID:{symbol}:{expected}")
        close_ts = int(item[6])
        if not expected <= close_ts < expected + MINUTE_MS:
            raise ValueError(f"ASTER_H1_REPAIR_M1_CLOSE_TS_INVALID:{symbol}:{expected}")
        records.append((op, hi, lo, cl, vol, quote))
    output = {
        "source": "aster", "exchange": "ASTER", "instrument": symbol,
        "interval": "1h", "event_time_ms": hour_ms,
        "close_time_ms": hour_ms + HOUR_MS - 1,
        "open": records[0][0], "high": max(row[1] for row in records),
        "low": min(row[2] for row in records), "close": records[-1][3],
        "base_volume": sum(row[4] for row in records),
        "quote_volume": (
            sum(row[5] for row in records if row[5] is not None)
            if all(row[5] is not None for row in records) else None),
        "historical_reconstruction": {
            "source": "ASTER_NATIVE_1M", "count": 60,
            "source_hour_open_ms": hour_ms,
            "rule": "STRICT_CONTIGUOUS_60M_NO_PROXY_NO_FORWARD_FILL",
        },
    }
    if not valid_h1(output):
        raise ValueError("ASTER_H1_REPAIR_AGGREGATION_INVALID")
    return output
