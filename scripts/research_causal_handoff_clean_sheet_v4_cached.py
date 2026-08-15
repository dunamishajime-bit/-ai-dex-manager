"""Performance-only memoization wrapper for frozen Causal Handoff V4.

This does not alter signal, lifecycle, costs, delays, periods, architectures,
or gates. It only caches deterministic historical feature components that are
replayed across Normal/Stress and reporting passes.
"""
from __future__ import annotations

import research_causal_handoff_clean_sheet_v4 as v4

_raw_ctx = v4.base._ctx
_raw_norm_ret = v4.norm_ret
_raw_raw_ret = v4.raw_ret
_raw_feature = v4.feature

_ctx_cache: dict[tuple[str, int], dict[str, float] | None] = {}
_norm_cache: dict[tuple[str, int, int], float | None] = {}
_raw_ret_cache: dict[tuple[str, int, int], float | None] = {}
_feature_cache: dict[tuple[str, int], dict[str, float] | None] = {}


def cached_ctx(symbol: str, candles, index, ts: int):
    key = (str(symbol), int(ts))
    if key not in _ctx_cache:
        _ctx_cache[key] = _raw_ctx(symbol, candles, index, int(ts))
    value = _ctx_cache[key]
    return None if value is None else dict(value)


def cached_norm_ret(candles, index, symbol: str, ts: int, bars: int):
    key = (str(symbol), int(ts), int(bars))
    if key not in _norm_cache:
        _norm_cache[key] = _raw_norm_ret(candles, index, symbol, int(ts), int(bars))
    return _norm_cache[key]


def cached_raw_ret(candles, index, symbol: str, ts: int, bars: int):
    key = (str(symbol), int(ts), int(bars))
    if key not in _raw_ret_cache:
        _raw_ret_cache[key] = _raw_raw_ret(candles, index, symbol, int(ts), int(bars))
    return _raw_ret_cache[key]


def cached_feature(symbol: str, candles, index, ts: int):
    key = (str(symbol), int(ts))
    if key not in _feature_cache:
        _feature_cache[key] = _raw_feature(symbol, candles, index, int(ts))
    value = _feature_cache[key]
    return None if value is None else dict(value)


def main() -> None:
    v4.base._ctx = cached_ctx
    v4.norm_ret = cached_norm_ret
    v4.raw_ret = cached_raw_ret
    v4.feature = cached_feature
    v4.main()


if __name__ == "__main__":
    main()
