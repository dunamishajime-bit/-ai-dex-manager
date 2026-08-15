"""Data-boundary adapter for the predeclared V7 metrics mechanism router.

The V7 strategy logic, mechanism set, thresholds, holds, selection rule, and
gates are untouched. This adapter only connects V7 to the independently
verified metrics V2 cache and enforces its data-quality/Fresh-OOS boundary.

The cache is sealed at 2026-07-01 00:00 UTC, while the existing research
evaluation period ends one hour earlier at 2026-07-01 08:00 JST =
2026-06-30 23:00 UTC. Therefore it covers evaluation without containing
post-boundary Fresh OOS data.
"""
from __future__ import annotations

import gzip
import json
from pathlib import Path

import research_metrics_mechanism_router_v7 as v7

CACHE_FRESH_BOUNDARY_MS = 1782864000000  # 2026-07-01 00:00 UTC
METRICS_V2_ROOT = Path(".cache/research-usdm-metrics-v2")


def corrected_load_metrics():
    manifest = json.loads((METRICS_V2_ROOT / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["cacheVersion"] == "v2"
    assert manifest["researchOnly"] is True
    assert manifest["strategyEvaluationPerformed"] is False
    assert manifest["freshOosRead"] is False
    assert manifest["post20260701DataUsed"] is False
    assert manifest["freshOosBoundaryExclusiveMs"] == CACHE_FRESH_BOUNDARY_MS
    assert v7.base.END_2026 < CACHE_FRESH_BOUNDARY_MS
    data = {}
    for pair in v7.PAIRS:
        symbol = v7.METRIC_SYMBOL[pair]
        meta = manifest["symbols"][symbol]
        assert meta["dailyArchiveCoverage"] == 1.0
        assert meta["hourCoverage"] >= 0.995
        assert meta["maxGapHours"] <= 12
        assert meta["freshOosRead"] is False
        assert meta["post20260701DataUsed"] is False
        with gzip.open(METRICS_V2_ROOT / f"{symbol}.hourly.json.gz", "rt", encoding="utf-8") as fh:
            rows = json.load(fh)
        d = {int(r["hourTs"]): r for r in rows}
        if d and max(d) >= CACHE_FRESH_BOUNDARY_MS:
            raise RuntimeError(f"METRICS_FRESH_OOS_CONTAMINATION:{pair}:{max(d)}")
        data[pair] = d
    return data, manifest


def main() -> None:
    v7.METRICS_ROOT = METRICS_V2_ROOT
    v7.load_metrics = corrected_load_metrics
    v7.main()


if __name__ == "__main__":
    main()
