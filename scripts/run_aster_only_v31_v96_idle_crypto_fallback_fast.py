from __future__ import annotations

import bisect
from typing import Dict, Sequence, Tuple

import research_lab_aster_only_v31_v96_idle_crypto_fallback as v31

_START_CACHE: Dict[int, Tuple[int, ...]] = {}


def fast_overlaps(intervals: Sequence[Tuple[int, int, str]], start: int, end: int) -> bool:
    key = id(intervals)
    starts = _START_CACHE.get(key)
    if starts is None or len(starts) != len(intervals):
        starts = tuple(int(row[0]) for row in intervals)
        _START_CACHE[key] = starts
    index = bisect.bisect_left(starts, end) - 1
    return index >= 0 and start < int(intervals[index][1])


v31.overlaps = fast_overlaps


if __name__ == "__main__":
    raise SystemExit(v31.main())
