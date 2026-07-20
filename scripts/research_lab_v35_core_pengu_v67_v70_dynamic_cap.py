from __future__ import annotations

import datetime as dt
import json
import os
import statistics
from dataclasses import asdict
from pathlib import Path
from typing import Dict, List, Tuple

import research_lab_v35_core_pengu_v67_v69_sizing as v69

v68 = v69.v68
core = v69.core
HOUR = v69.HOUR
DAY = v69.DAY
PORTFOLIO_GROSS_CAP = 2.0
TARGET_LEVELS = (0.55, 0.60, 0.65, 0.70, 0.75, 0.80)


def capped_combine(core_rows: List[dict], pengu: Dict[int, dict], field: str) -> Tuple[List[dict], dict]:
    result = []
    clip_ratios: List[float] = []
    clipped_buckets = 0
    for row in core_rows:
        p = pengu.get(int(row["ts"]), {
            field: 0.0, "maxExposure": 0.0, "averageExposure": 0.0,
        })
        p_max = float(p.get("maxExposure", 0.0))
        p_avg = float(p.get("averageExposure", 0.0))
        core_gross = float(row["gross"])
        if p_max <= 0:
            ratio = 1.0
        else:
            capacity = max(0.0, PORTFOLIO_GROSS_CAP - core_gross)
            ratio = min(1.0, capacity / p_max)
        if ratio < 1.0 - 1e-12:
            clipped_buckets += 1
        if p_max > 0:
            clip_ratios.append(ratio)
        result.append({
            "ts": int(row["ts"]),
            "return": float(row["return"]) + float(p.get(field, 0.0)) * ratio,
            "gross": core_gross + p_avg * ratio,
            "maxGross": core_gross + p_max * ratio,
        })
    diagnostics = {
        "activeBuckets": len(clip_ratios),
        "clippedBuckets": clipped_buckets,
        "clipRatePct": clipped_buckets / len(clip_ratios) * 100.0 if clip_ratios else 0.0,
        "minimumClipRatio": min(clip_ratios) if clip_ratios else 1.0,
        "averageClipRatio": statistics.fmean(clip_ratios) if clip_ratios else 1.0,
    }
    return result, diagnostics


def evaluate(
    target_level: float,
    pengu_rows: List[dict],
    base_core_rows: List[dict],
    severe_core_rows: List[dict],
    overlap_start: int,
    overlap_end: int,
) -> dict:
    trades = v69.scale_trades(target_level)
    series = v68.v67_series(pengu_rows, trades)
    combined, cap = capped_combine(base_core_rows, series, "base")
    combined_severe, cap_severe = capped_combine(severe_core_rows, series, "severe")
    excluded, cap_excluded = capped_combine(base_core_rows, series, "excludedBase")
    excluded_severe, cap_excluded_severe = capped_combine(severe_core_rows, series, "excludedSevere")

    no_best_series = v68.v67_series(pengu_rows, v69.remove_best_trade(trades))
    no_month_series = v68.v67_series(pengu_rows, v69.remove_best_month(trades))
    no_best, _ = capped_combine(base_core_rows, no_best_series, "base")
    no_best_severe, _ = capped_combine(severe_core_rows, no_best_series, "severe")
    no_month, _ = capped_combine(base_core_rows, no_month_series, "base")
    no_month_severe, _ = capped_combine(severe_core_rows, no_month_series, "severe")

    full = v69.metrics(combined, core.CORE_START, core.CORE_END)
    severe_full = v69.metrics(combined_severe, core.CORE_START, core.CORE_END)
    excluded_full = v69.metrics(excluded, core.CORE_START, core.CORE_END)
    excluded_severe_full = v69.metrics(excluded_severe, core.CORE_START, core.CORE_END)
    overlap = v69.metrics(combined, overlap_start, overlap_end)
    overlap_severe = v69.metrics(combined_severe, overlap_start, overlap_end)
    excluded_overlap = v69.metrics(excluded, overlap_start, overlap_end)
    excluded_overlap_severe = v69.metrics(excluded_severe, overlap_start, overlap_end)
    removed_best = v69.metrics(no_best, core.CORE_START, core.CORE_END)
    removed_best_severe = v69.metrics(no_best_severe, core.CORE_START, core.CORE_END)
    removed_month = v69.metrics(no_month, core.CORE_START, core.CORE_END)
    removed_month_severe = v69.metrics(no_month_severe, core.CORE_START, core.CORE_END)
    standalone = v68.trade_metrics(trades, "base_pct", overlap_start, overlap_end)
    standalone_severe = v68.trade_metrics(trades, "severe_pct", overlap_start, overlap_end)

    passed = bool(
        full["observedMaxConcurrentGross"] <= PORTFOLIO_GROSS_CAP + 1e-9
        and full["compoundedReturnPct"] > 0
        and full["maxDrawdownPct"] >= -35.0
        and severe_full["compoundedReturnPct"] > 0
        and severe_full["maxDrawdownPct"] >= -55.0
        and excluded_full["compoundedReturnPct"] > 0
        and excluded_severe_full["compoundedReturnPct"] > 0
        and overlap["compoundedReturnPct"] > 0
        and overlap_severe["compoundedReturnPct"] > 0
        and excluded_overlap["compoundedReturnPct"] > 0
        and excluded_overlap_severe["compoundedReturnPct"] > 0
        and removed_best["compoundedReturnPct"] > 0
        and removed_best_severe["compoundedReturnPct"] > 0
        and removed_month["compoundedReturnPct"] > 0
        and removed_month_severe["compoundedReturnPct"] > 0
        and standalone_severe["maxDrawdownPct"] >= -16.0
        and cap["minimumClipRatio"] >= 0.50
    )
    return {
        "targetV67MaxGross": target_level,
        "passed": passed,
        "capDiagnostics": {
            "normal": cap,
            "severe": cap_severe,
            "excluded": cap_excluded,
            "excludedSevere": cap_excluded_severe,
        },
        "full": full,
        "severeFull": severe_full,
        "largeWaveExcludedFull": excluded_full,
        "largeWaveExcludedSevereFull": excluded_severe_full,
        "overlap": overlap,
        "overlapSevere": overlap_severe,
        "largeWaveExcludedOverlap": excluded_overlap,
        "largeWaveExcludedOverlapSevere": excluded_overlap_severe,
        "removeBestTrade": removed_best,
        "removeBestTradeSevere": removed_best_severe,
        "removeBestMonth": removed_month,
        "removeBestMonthSevere": removed_month_severe,
        "v67Standalone": standalone,
        "v67StandaloneSevere": standalone_severe,
    }


def rounded(value):
    return core.rounded(value)


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    core_data = v69.build_core()
    base_core_rows = core_data["baseRows"]
    severe_core_rows = core_data["severeRows"]
    core_full = v69.metrics(base_core_rows, core.CORE_START, core.CORE_END)
    core_severe = v69.metrics(severe_core_rows, core.CORE_START, core.CORE_END)

    trade_start = min(int(trade["entry_ts"]) for trade in v68.V67_ASTER_TRADES)
    trade_end = max(int(trade["exit_ts"]) for trade in v68.V67_ASTER_TRADES)
    pengu_rows = core.fetch_klines("PENGUUSDT", trade_start - 30 * DAY, trade_end + HOUR)
    overlap_start = max(core.CORE_START, trade_start)
    overlap_end = min(core.CORE_END, trade_end + HOUR)

    candidates = [
        evaluate(
            level,
            pengu_rows,
            base_core_rows,
            severe_core_rows,
            overlap_start,
            overlap_end,
        )
        for level in TARGET_LEVELS
    ]
    passed = [candidate for candidate in candidates if candidate["passed"]]
    passed.sort(
        key=lambda candidate: (
            candidate["full"]["compoundedReturnPct"],
            candidate["largeWaveExcludedSevereFull"]["compoundedReturnPct"],
            candidate["severeFull"]["compoundedReturnPct"],
        ),
        reverse=True,
    )
    selected = passed[0] if passed else None
    status = "DYNAMIC_CAP_PASS" if selected else "NO_ROBUST_DYNAMIC_CAP"

    result = rounded({
        "version": 70,
        "strategyId": "V35_CORE_PLUS_PENGU_V67_DYNAMIC_GROSS_CAP",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": status,
        "portfolioGrossCap": PORTFOLIO_GROSS_CAP,
        "targetLevels": TARGET_LEVELS,
        "core": {
            "full": core_full,
            "severeFull": core_severe,
            "config": asdict(core_data["config"]),
        },
        "selected": selected,
        "passedCount": len(passed),
        "candidates": candidates,
        "capRule": (
            "For each 12-hour bucket, scale all PENGU PnL and exposure by "
            "min(1, (2.0 - Core Gross) / PENGU max exposure)."
        ),
        "safety": {
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "ordersSent": False,
        },
        "limitations": [
            "Dynamic sizing uses an already observed V67 trade sequence and is not pristine new out-of-sample evidence.",
            "The cap uses the Core bucket Gross and the maximum PENGU exposure inside that bucket.",
            "PENGU return is proportionally scaled for the entire 12-hour bucket when clipping is required.",
        ],
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "v35-core-pengu-v67-v70-dynamic-cap.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    if selected:
        report = [
            "# V35 Core + PENGU V67 V70 Dynamic Gross Cap",
            "",
            f"- Status: **{status}**",
            f"- Selected target V67 max Gross: **{selected['targetV67MaxGross']}**",
            f"- Observed max concurrent Gross: {selected['full']['observedMaxConcurrentGross']}",
            f"- Clipped buckets: {selected['capDiagnostics']['normal']['clippedBuckets']} / {selected['capDiagnostics']['normal']['activeBuckets']}",
            f"- Minimum clip ratio: {selected['capDiagnostics']['normal']['minimumClipRatio']}",
            f"- Full: {selected['full']['compoundedReturnPct']}% / CAGR {selected['full']['cagrPct']}% / DD {selected['full']['maxDrawdownPct']}%",
            f"- Severe: {selected['severeFull']['compoundedReturnPct']}% / DD {selected['severeFull']['maxDrawdownPct']}%",
            f"- Large-wave profits excluded: {selected['largeWaveExcludedFull']['compoundedReturnPct']}%",
            f"- Excluded Severe: {selected['largeWaveExcludedSevereFull']['compoundedReturnPct']}%",
            f"- Overlap: {selected['overlap']['compoundedReturnPct']}% / Severe {selected['overlapSevere']['compoundedReturnPct']}%",
            f"- Remove best trade Severe: {selected['removeBestTradeSevere']['compoundedReturnPct']}%",
            f"- Remove best month Severe: {selected['removeBestMonthSevere']['compoundedReturnPct']}%",
            f"- V67 standalone Severe DD before cap: {selected['v67StandaloneSevere']['maxDrawdownPct']}%",
            f"- Increment vs Core: {selected['full']['compoundedReturnPct'] - core_full['compoundedReturnPct']} percentage points",
            "",
            "- Production / LIVE / VPS changed: **NO**",
        ]
    else:
        report = [
            "# V35 Core + PENGU V67 V70 Dynamic Gross Cap",
            "",
            f"- Status: **{status}**",
            "- No target level passed all portfolio and standalone risk gates.",
            "- Production / LIVE / VPS changed: **NO**",
        ]
    (state_dir / "v35-core-pengu-v67-v70-dynamic-cap.md").write_text(
        "\n".join(report), encoding="utf-8"
    )
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
