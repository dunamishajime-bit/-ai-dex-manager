"""Performance-only wrapper for research_pairwise_clean_sheet_3y.

It memoizes the causal context function by (symbol,timestamp).  Signal logic,
periods, thresholds, selection gates and execution assumptions are unchanged.
"""
from __future__ import annotations

import research_pairwise_clean_sheet_3y as core

_raw_ctx = core._ctx
_cache = {}


def _cached_ctx(symbol, candles, index, ts):
    key = (str(symbol), int(ts))
    if key not in _cache:
        _cache[key] = _raw_ctx(symbol, candles, index, int(ts))
    return _cache[key]


core._ctx = _cached_ctx

if __name__ == "__main__":
    core.main()
