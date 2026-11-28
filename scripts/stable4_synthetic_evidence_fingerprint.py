"""Canonical fingerprints for offline synthetic research artifacts.

The raw artifact SHA is retained separately. Only wall-clock profiling fields
are excluded here; prices, fills, equity, drawdown, seeds and exit reasons
must all remain in the canonical digest. No certificate or order authority.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any

NONDETERMINISTIC_DIAGNOSTIC_KEYS = frozenset({"runtimeMs"})


def deterministic_research_result(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: deterministic_research_result(item)
            for key, item in value.items()
            if key not in NONDETERMINISTIC_DIAGNOSTIC_KEYS
        }
    if isinstance(value, list):
        return [deterministic_research_result(item) for item in value]
    return value


def canonical_result_bytes(value: Any) -> bytes:
    return json.dumps(
        deterministic_research_result(value),
        sort_keys=True,
        ensure_ascii=False,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def canonical_result_sha256(value: Any) -> str:
    return hashlib.sha256(canonical_result_bytes(value)).hexdigest()
