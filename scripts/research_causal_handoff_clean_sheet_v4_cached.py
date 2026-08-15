"""Performance-only wrapper for frozen Causal Handoff V4.

This does not alter signal, lifecycle, costs, delays, periods, or gates.
It memoizes deterministic per-(symbol,timestamp) feature snapshots because V4
replays the identical historical timestamps across Normal/Stress and reporting
passes.
"""
from __future__ import annotations

import research_causal_handoff_clean_sheet_v4 as v4

_raw_feature = v4.feature
_feature_cache: dict[tuple[str, int], dict[str, float] | None] = {}


def cached_feature(symbol: str, candles, index, ts: int):
    key = (str(symbol), int(ts))
    if key not in _feature_cache:
        _feature_cache[key] = _raw_feature(symbol, candles, index, int(ts))
    value = _feature_cache[key]
    return None if value is None else dict(value)


def main() -> None:
    v4.feature = cached_feature
    v4.main()


if __name__ == "__main__":
    main()
