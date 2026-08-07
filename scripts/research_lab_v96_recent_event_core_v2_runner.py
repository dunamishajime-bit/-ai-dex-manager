from pathlib import Path

import research_lab_v96_recent_event_core_v2 as v2


_original_load_aster_symbol = v2.core.load_aster_symbol
_cache_root = Path.cwd() / ".cache" / "perp-research-usdm"
_funding_cache = {}


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


v2.core.load_aster_symbol = _one_arg_loader
v2.funding_for_bar = _fast_funding_for_bar


if __name__ == "__main__":
    v2.main()
