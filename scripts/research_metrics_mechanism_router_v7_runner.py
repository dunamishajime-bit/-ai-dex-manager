"""Boundary adapter for the predeclared V7 metrics mechanism router.

The V7 strategy logic/thresholds are untouched. This adapter corrects only the
cache-boundary assertion: the metrics cache is sealed at 2026-07-01 00:00 UTC,
while the existing research evaluation period ends one hour earlier at
2026-07-01 08:00 JST = 2026-06-30 23:00 UTC. Therefore the cache safely covers
the evaluation period without containing post-2026-07-01 Fresh OOS data.
"""
from __future__ import annotations

import gzip
import json

import research_metrics_mechanism_router_v7 as v7

CACHE_FRESH_BOUNDARY_MS = 1782864000000  # 2026-07-01 00:00 UTC


def corrected_load_metrics():
    manifest = json.loads((v7.METRICS_ROOT / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["researchOnly"] is True
    assert manifest["freshOosRead"] is False
    assert manifest["post20260701DataUsed"] is False
    assert manifest["freshOosBoundaryExclusiveMs"] == CACHE_FRESH_BOUNDARY_MS
    assert v7.base.END_2026 < CACHE_FRESH_BOUNDARY_MS
    data = {}
    for pair in v7.PAIRS:
        symbol = v7.METRIC_SYMBOL[pair]
        with gzip.open(v7.METRICS_ROOT / f"{symbol}.hourly.json.gz", "rt", encoding="utf-8") as fh:
            rows = json.load(fh)
        d = {int(r["hourTs"]): r for r in rows}
        if d and max(d) >= CACHE_FRESH_BOUNDARY_MS:
            raise RuntimeError(f"METRICS_FRESH_OOS_CONTAMINATION:{pair}:{max(d)}")
        data[pair] = d
    return data, manifest


def main() -> None:
    v7.load_metrics = corrected_load_metrics
    v7.main()


if __name__ == "__main__":
    main()
