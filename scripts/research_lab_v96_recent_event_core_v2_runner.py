from pathlib import Path

import research_lab_v96_recent_event_core_v2 as v2


_original_load_aster_symbol = v2.core.load_aster_symbol
_original_momentum = v2.momentum
_original_sma = v2.sma
_original_volume_ratio = v2.volume_ratio
_original_prior_low = v2.prior_low
_cache_root = Path.cwd() / ".cache" / "perp-research-usdm"
_funding_cache = {}
_momentum_cache = {}
_sma_cache = {}
_volume_cache = {}
_low_cache = {}


def _one_arg_loader(symbol: str):
    return _original_load_aster_symbol(_cache_root, symbol)


def _fast_funding_for_bar(points, ts: int) -> float:
    key = id(points)
    buckets = _funding_cache.get(key)
    if buckets is None:
        buckets = {}
        for row in points:
            point_ts = int(row["ts"])
            bucket = point_ts // v2.BAR_MS * v2.BAR_MS
            buckets[bucket] = buckets.get(bucket, 0.0) + float(row["rate"])
        _funding_cache[key] = buckets
    return buckets.get(ts, 0.0)


def _fast_momentum(rows, idx: int, bars: int):
    key = (id(rows), idx, bars)
    if key not in _momentum_cache:
        _momentum_cache[key] = _original_momentum(rows, idx, bars)
    return _momentum_cache[key]


def _fast_sma(rows, idx: int, bars: int):
    key = (id(rows), idx, bars)
    if key not in _sma_cache:
        _sma_cache[key] = _original_sma(rows, idx, bars)
    return _sma_cache[key]


def _fast_volume_ratio(rows, idx: int, recent: int = 8, base: int = 32):
    key = (id(rows), idx, recent, base)
    if key not in _volume_cache:
        _volume_cache[key] = _original_volume_ratio(rows, idx, recent, base)
    return _volume_cache[key]


def _fast_prior_low(rows, idx: int, bars: int):
    key = (id(rows), idx, bars)
    if key not in _low_cache:
        _low_cache[key] = _original_prior_low(rows, idx, bars)
    return _low_cache[key]


v2.core.load_aster_symbol = _one_arg_loader
v2.funding_for_bar = _fast_funding_for_bar
v2.momentum = _fast_momentum
v2.sma = _fast_sma
v2.volume_ratio = _fast_volume_ratio
v2.prior_low = _fast_prior_low


if __name__ == "__main__":
    v2.main()
