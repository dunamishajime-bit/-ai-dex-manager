from __future__ import annotations

import hashlib
import json
import math
from typing import Any

from .models import Bar, Funding, coerce_bar, coerce_funding


def _canonical(bundle: dict[str, Any]) -> bytes:
    def encode(value: Any) -> Any:
        if isinstance(value, (Bar, Funding)):
            return value.to_dict()
        if isinstance(value, dict):
            return {str(k): encode(v) for k, v in sorted(value.items(), key=lambda item: str(item[0]))}
        if isinstance(value, (list, tuple)):
            return [encode(item) for item in value]
        return value

    return json.dumps(encode(bundle), sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _valid_ohlc(row: Bar) -> bool:
    values = (row.open, row.high, row.low, row.close, row.volume)
    if not all(math.isfinite(value) for value in values):
        return False
    if row.open <= 0 or row.high <= 0 or row.low <= 0 or row.close <= 0 or row.volume < 0:
        return False
    return row.high >= max(row.open, row.close) and row.low <= min(row.open, row.close)


def validate_bundle(bundle: dict[str, Any]) -> dict[str, Any]:
    period = bundle.get("period", {})
    start_ms = int(period["start_ms"])
    end_ms = int(period["end_ms"])
    interval_ms = int(bundle.get("interval_ms", 3_600_000))
    duplicate_rows = 0
    invalid_rows = 0
    non_monotonic_rows = 0
    post_period_rows = 0
    pre_period_rows = 0
    funding_after_decision = 0
    incomplete_symbols: list[str] = []
    gaps: list[dict[str, Any]] = []
    ranges: dict[str, dict[str, int | None]] = {}

    for symbol, raw_rows in bundle.get("bars", {}).items():
        rows = [coerce_bar(row) for row in raw_rows]
        seen: set[int] = set()
        previous: int | None = None
        in_period: list[int] = []
        for row in rows:
            if row.ts_ms in seen:
                duplicate_rows += 1
            seen.add(row.ts_ms)
            if previous is not None and row.ts_ms < previous:
                non_monotonic_rows += 1
            previous = row.ts_ms
            if not _valid_ohlc(row):
                invalid_rows += 1
            if row.ts_ms < start_ms:
                pre_period_rows += 1
            elif row.ts_ms >= end_ms:
                post_period_rows += 1
            else:
                in_period.append(row.ts_ms)
        ranges[str(symbol)] = {
            "first_ts_ms": min(in_period) if in_period else None,
            "last_ts_ms": max(in_period) if in_period else None,
            "row_count": len(in_period),
        }
        declared_start = int(bundle.get("availability", {}).get(str(symbol), {}).get("start_ms", start_ms))
        if not in_period or in_period[0] != declared_start or in_period[-1] != end_ms - interval_ms:
            incomplete_symbols.append(str(symbol))
        for left, right in zip(in_period, in_period[1:]):
            if right - left > interval_ms:
                gaps.append({"symbol": str(symbol), "from_ts_ms": left, "to_ts_ms": right, "missing_bars": (right - left) // interval_ms - 1})

    decision_ts_ms = bundle.get("decision_ts_ms")
    for raw_rows in bundle.get("funding", {}).values():
        for raw_row in raw_rows:
            row = coerce_funding(raw_row)
            if decision_ts_ms is not None and row.ts_ms > int(decision_ts_ms):
                funding_after_decision += 1

    digest = hashlib.sha256(_canonical(bundle)).hexdigest()
    valid = not any((duplicate_rows, invalid_rows, non_monotonic_rows, post_period_rows, pre_period_rows, funding_after_decision, incomplete_symbols))
    return {
        "valid": valid,
        "period": {"start_ms": start_ms, "end_ms": end_ms},
        "duplicate_rows": duplicate_rows,
        "invalid_rows": invalid_rows,
        "non_monotonic_rows": non_monotonic_rows,
        "post_period_rows": post_period_rows,
        "pre_period_rows": pre_period_rows,
        "funding_after_decision": funding_after_decision,
        "incomplete_symbols": incomplete_symbols,
        "gaps": gaps,
        "ranges": ranges,
        "sha256": digest,
    }
