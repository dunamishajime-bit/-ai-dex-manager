from __future__ import annotations

import datetime as dt
import json
import os
from pathlib import Path
from typing import Dict, List

import research_lab_v35_core_pengu_v67_combined_v2 as v68b
import research_lab_v35_core_pengu_v67_v69_sizing as v69
import research_lab_v35_weight_band_strong_v95 as v95

v68b.MAX_ALLOWED_BUCKET_MOVE_PCT = 75.0
v68 = v69.v68
core = v69.core
DAY = v69.DAY
HOUR = v69.HOUR
TARGET_V67_GROSS = 1.15
TOTAL_GROSS_CAP = 2.0
MINIMUM_PENGU_CLIP = 0.50


def reserved_combine(
    core_rows: List[dict],
    pengu: Dict[int, dict],
    field: str,
) -> tuple[List[dict], dict]:
    result: List[dict] = []
    clip_ratios: List[float] = []
    core_scales: List[float] = []
    clipped_pengu = scaled_core = 0
    for row in core_rows:
        p = pengu.get(int(row["ts"]), {
            field: 0.0,
            "maxExposure": 0.0,
            "averageExposure": 0.0,
        })
        core_gross_raw = float(row["gross"])
        p_max = float(p.get("maxExposure", 0.0))
        p_avg = float(p.get("averageExposure", 0.0))
        reserved = MINIMUM_PENGU_CLIP * p_max
        core_capacity = max(0.0, TOTAL_GROSS_CAP - reserved)
        core_scale = min(1.0, core_capacity / core_gross_raw) if core_gross_raw > 0 else 1.0
        core_gross = core_gross_raw * core_scale
        if core_scale < 1.0 - 1e-12:
            scaled_core += 1
        if p_max > 0:
            capacity = max(0.0, TOTAL_GROSS_CAP - core_gross)
            p_clip = min(1.0, capacity / p_max)
            p_clip = max(MINIMUM_PENGU_CLIP, p_clip)
            p_clip = min(p_clip, TOTAL_GROSS_CAP / p_max if p_max > 0 else 1.0)
            clip_ratios.append(p_clip)
            if p_clip < 1.0 - 1e-12:
                clipped_pengu += 1
        else:
            p_clip = 1.0
        core_return = float(row["return"]) * core_scale
        pengu_return = float(p.get(field, 0.0)) * p_clip
        result.append({
            "ts": int(row["ts"]),
            "return": core_return + pengu_return,
            "gross": core_gross + p_avg * p_clip,
            "maxGross": core_gross + p_max * p_clip,
            "coreReturn": core_return,
            "penguReturn": pengu_return,
            "coreScale": core_scale,
            "penguScale": p_clip,
        })
        if result[-1]["maxGross"] > TOTAL_GROSS_CAP + 1e-9:
            raise RuntimeError(f"Gross cap exceeded at {row['ts']}: {result[-1]['maxGross']}")
    return result, {
        "activePenguBuckets": len(clip_ratios),
        "clippedPenguBuckets": clipped_pengu,
        "coreScaledBuckets": scaled_core,
        "minimumClipRatio": min(clip_ratios) if clip_ratios else 1.0,
        "averageClipRatio": sum(clip_ratios) / len(clip_ratios) if clip_ratios else 1.0,
        "minimumCoreScale": min(core_scales) if core_scales else 1.0,
    }


def integrate(profile: dict, pengu_rows: List[dict]) -> dict:
    trades = v69.scale_trades(TARGET_V67_GROSS)
    main = v68.v67_series(pengu_rows, trades)
    no_best = v68.v67_series(pengu_rows, v69.remove_best_trade(trades))
    no_month = v68.v67_series(pengu_rows, v69.remove_best_month(trades))
    normal, cap = reserved_combine(profile["normal"], main, "base")
    severe, cap_severe = reserved_combine(profile["severe"], main, "severe")
    excluded, cap_excluded = reserved_combine(profile["normal"], main, "excludedBase")
    excluded_severe, cap_excluded_severe = reserved_combine(profile["severe"], main, "excludedSevere")
    remove_best, _ = reserved_combine(profile["normal"], no_best, "base")
    remove_best_severe, _ = reserved_combine(profile["severe"], no_best, "severe")
    remove_month, _ = reserved_combine(profile["normal"], no_month, "base")
    remove_month_severe, _ = reserved_combine(profile["severe"], no_month, "severe")
    return {
        "full": v69.metrics(normal, core.CORE_START, core.CORE_END),
        "severeFull": v69.metrics(severe, core.CORE_START, core.CORE_END),
        "largeWaveExcludedFull": v69.metrics(excluded, core.CORE_START, core.CORE_END),
        "largeWaveExcludedSevereFull": v69.metrics(excluded_severe, core.CORE_START, core.CORE_END),
        "reused2026H1": v69.metrics(normal, core.v4.START_2026, core.CORE_END),
        "reused2026H1Severe": v69.metrics(severe, core.v4.START_2026, core.CORE_END),
        "reused2026H1Excluded": v69.metrics(excluded, core.v4.START_2026, core.CORE_END),
        "reused2026H1ExcludedSevere": v69.metrics(excluded_severe, core.v4.START_2026, core.CORE_END),
        "removeBestTrade": v69.metrics(remove_best, core.CORE_START, core.CORE_END),
        "removeBestTradeSevere": v69.metrics(remove_best_severe, core.CORE_START, core.CORE_END),
        "removeBestMonth": v69.metrics(remove_month, core.CORE_START, core.CORE_END),
        "removeBestMonthSevere": v69.metrics(remove_month_severe, core.CORE_START, core.CORE_END),
        "capDiagnostics": {
            "normal": cap,
            "severe": cap_severe,
            "excluded": cap_excluded,
            "excludedSevere": cap_excluded_severe,
        },
    }


def rounded(value):
    return core.rounded(value)


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    raw = v95.v89.build_raw()
    profile = v95.build_profile(raw, v95.STRONG_CONFIG)
    trade_start = min(int(trade["entry_ts"]) for trade in v68.V67_ASTER_TRADES)
    trade_end = max(int(trade["exit_ts"]) for trade in v68.V67_ASTER_TRADES)
    pengu_rows = core.fetch_klines("PENGUUSDT", trade_start - 30 * DAY, trade_end + HOUR)
    integrated = integrate(profile, pengu_rows)
    passed = bool(
        integrated["full"]["compoundedReturnPct"] > 0
        and integrated["severeFull"]["compoundedReturnPct"] > 0
        and integrated["largeWaveExcludedFull"]["compoundedReturnPct"] > 0
        and integrated["largeWaveExcludedSevereFull"]["compoundedReturnPct"] > 0
        and integrated["full"]["maxDrawdownPct"] >= -31.0
        and integrated["severeFull"]["maxDrawdownPct"] >= -47.0
        and integrated["reused2026H1"]["compoundedReturnPct"] > 0
        and integrated["reused2026H1Severe"]["compoundedReturnPct"] > 0
        and integrated["reused2026H1ExcludedSevere"]["compoundedReturnPct"] > 0
        and integrated["removeBestTradeSevere"]["compoundedReturnPct"] > 0
        and integrated["removeBestMonthSevere"]["compoundedReturnPct"] > 0
        and integrated["full"]["observedMaxConcurrentGross"] <= TOTAL_GROSS_CAP + 1e-9
        and integrated["capDiagnostics"]["normal"]["minimumClipRatio"] >= MINIMUM_PENGU_CLIP
    )
    status = "V35_STRONG_RESERVED_PENGU_PASS" if passed else "V35_STRONG_RESERVED_PENGU_DIAGNOSTIC"
    result = rounded({
        "version": 96,
        "strategyId": "V35_STRONG_WITH_RESERVED_PENGU_V96",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": status,
        "passed": passed,
        "fixedV35TargetConfig": asdict(v95.TARGET_CONFIG),
        "fixedV35StrongConfig": asdict(v95.STRONG_CONFIG),
        "targetV67Gross": TARGET_V67_GROSS,
        "totalGrossCap": TOTAL_GROSS_CAP,
        "minimumPenguClip": MINIMUM_PENGU_CLIP,
        "v35Core": {
            "full": v69.metrics(profile["normal"], core.CORE_START, core.CORE_END),
            "severeFull": v69.metrics(profile["severe"], core.CORE_START, core.CORE_END),
        },
        "integration": integrated,
        "rule": (
            "Reserve at least 50% of the active V71 PENGU target exposure before assigning Core Gross. "
            "Scale only the V35 Core return/Gross when needed; allocate remaining capacity to PENGU up to its full target."
        ),
        "safety": {
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "ordersSent": False,
        },
        "limitations": [
            "The 50% reserve is the predeclared V71 minimum-clip acceptance gate, not a newly optimized threshold.",
            "V35 V90/V86 and PENGU V71 histories were observed before this integration.",
            "2026H1 is reused evidence, not pristine holdout.",
        ],
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "v35-strong-reserved-pengu-v96.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    report = [
        "# V35 Strong + Reserved PENGU V96",
        "",
        f"- Status: **{status}**",
        f"- V35 Core: {result['v35Core']['full']['compoundedReturnPct']}% / Severe {result['v35Core']['severeFull']['compoundedReturnPct']}%",
        f"- Full: {integrated['full']['compoundedReturnPct']}% / CAGR {integrated['full']['cagrPct']}% / DD {integrated['full']['maxDrawdownPct']}%",
        f"- Severe: {integrated['severeFull']['compoundedReturnPct']}% / DD {integrated['severeFull']['maxDrawdownPct']}%",
        f"- Waves excluded: {integrated['largeWaveExcludedFull']['compoundedReturnPct']}% / Severe {integrated['largeWaveExcludedSevereFull']['compoundedReturnPct']}%",
        f"- 2026H1: {integrated['reused2026H1']['compoundedReturnPct']}% / Severe {integrated['reused2026H1Severe']['compoundedReturnPct']}%",
        f"- Best trade/month removed Severe: {integrated['removeBestTradeSevere']['compoundedReturnPct']}% / {integrated['removeBestMonthSevere']['compoundedReturnPct']}%",
        f"- Max Gross: {integrated['full']['observedMaxConcurrentGross']}",
        f"- PENGU minimum/average clip: {integrated['capDiagnostics']['normal']['minimumClipRatio']} / {integrated['capDiagnostics']['normal']['averageClipRatio']}",
        f"- Core scaled buckets: {integrated['capDiagnostics']['normal']['coreScaledBuckets']}",
        "",
        "- Production / LIVE / VPS changed: **NO**",
    ]
    (state_dir / "v35-strong-reserved-pengu-v96.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
