from __future__ import annotations

import datetime as dt
import json
import os
from copy import deepcopy
from dataclasses import asdict
from pathlib import Path
from typing import Dict, List

import research_lab_v35_core_pengu_v67_combined_v2 as v68b
import research_lab_v35_core_pengu_v67_v69_sizing as v69
import research_lab_v35_core_pengu_v67_v70_dynamic_cap as v70
import research_lab_v35_strong_growth_v86 as v86
import research_lab_v35_turnover_stabilizer_v89 as v89
import research_lab_v35_weight_band_v90 as v90
import research_lab_v35_exhaustion_guard_v93 as v93
import research_lab_v71_whipsaw_guard_v84 as v84

v68b.MAX_ALLOWED_BUCKET_MOVE_PCT = 75.0
v68 = v69.v68
core = v69.core
DAY = v69.DAY
HOUR = v69.HOUR
TARGET_V67_GROSS = 1.15
GROWTH_CONFIG = v90.Config(0.05, 0.20, 12)
RESILIENT_TARGET_CONFIG = v90.Config(0.05, 0.20, 12)
RESILIENT_GUARD_CONFIG = v93.Config(2.0, 15.0, 1, 0.80, 2)
BALANCED_V85_CONFIG = v84.WhipsawConfig(10, 1.5, 3, 0.60, 1, 2)


def profile_core_rows(raw: dict) -> Dict[str, dict]:
    growth = v90.simulate(GROWTH_CONFIG, raw)
    resilient = v93.simulate(RESILIENT_GUARD_CONFIG, raw)
    return {
        "GROWTH": {
            "normal": growth["normalRows"],
            "severe": growth["severeRows"],
            "rule": {
                "target": asdict(GROWTH_CONFIG),
                "exhaustionGuard": None,
            },
            "diagnostics": {
                "target": growth["stabilization"],
            },
        },
        "RESILIENT": {
            "normal": resilient["normalRows"],
            "severe": resilient["severeRows"],
            "rule": {
                "target": asdict(RESILIENT_TARGET_CONFIG),
                "exhaustionGuard": asdict(RESILIENT_GUARD_CONFIG),
            },
            "diagnostics": {
                "target": resilient["targetDiagnostics"],
                "guard": resilient["guardDiagnostics"],
            },
        },
    }


def concentration_series(pengu_rows: List[dict]) -> Dict[str, Dict[int, dict]]:
    trades = v69.scale_trades(TARGET_V67_GROSS)
    return {
        "main": v68.v67_series(pengu_rows, trades),
        "noBest": v68.v67_series(pengu_rows, v69.remove_best_trade(trades)),
        "noMonth": v68.v67_series(pengu_rows, v69.remove_best_month(trades)),
    }


def combine_profile(
    name: str,
    core_profile: dict,
    series: Dict[str, Dict[int, dict]],
) -> dict:
    normal, normal_cap = v70.capped_combine(core_profile["normal"], series["main"], "base")
    severe, severe_cap = v70.capped_combine(core_profile["severe"], series["main"], "severe")
    excluded, excluded_cap = v70.capped_combine(core_profile["normal"], series["main"], "excludedBase")
    excluded_severe, excluded_severe_cap = v70.capped_combine(core_profile["severe"], series["main"], "excludedSevere")
    no_best, _ = v70.capped_combine(core_profile["normal"], series["noBest"], "base")
    no_best_severe, _ = v70.capped_combine(core_profile["severe"], series["noBest"], "severe")
    no_month, _ = v70.capped_combine(core_profile["normal"], series["noMonth"], "base")
    no_month_severe, _ = v70.capped_combine(core_profile["severe"], series["noMonth"], "severe")
    result = {
        "name": name,
        "coreRule": core_profile["rule"],
        "coreDiagnostics": core_profile["diagnostics"],
        "coreOnly": v69.metrics(core_profile["normal"], core.CORE_START, core.CORE_END),
        "coreOnlySevere": v69.metrics(core_profile["severe"], core.CORE_START, core.CORE_END),
        "core2026H1": v69.metrics(core_profile["normal"], core.v4.START_2026, core.CORE_END),
        "core2026H1Severe": v69.metrics(core_profile["severe"], core.v4.START_2026, core.CORE_END),
        "full": v69.metrics(normal, core.CORE_START, core.CORE_END),
        "severeFull": v69.metrics(severe, core.CORE_START, core.CORE_END),
        "largeWaveExcludedFull": v69.metrics(excluded, core.CORE_START, core.CORE_END),
        "largeWaveExcludedSevereFull": v69.metrics(excluded_severe, core.CORE_START, core.CORE_END),
        "reused2026H1": v69.metrics(normal, core.v4.START_2026, core.CORE_END),
        "reused2026H1Severe": v69.metrics(severe, core.v4.START_2026, core.CORE_END),
        "reused2026H1Excluded": v69.metrics(excluded, core.v4.START_2026, core.CORE_END),
        "reused2026H1ExcludedSevere": v69.metrics(excluded_severe, core.v4.START_2026, core.CORE_END),
        "removeBestTrade": v69.metrics(no_best, core.CORE_START, core.CORE_END),
        "removeBestTradeSevere": v69.metrics(no_best_severe, core.CORE_START, core.CORE_END),
        "removeBestMonth": v69.metrics(no_month, core.CORE_START, core.CORE_END),
        "removeBestMonthSevere": v69.metrics(no_month_severe, core.CORE_START, core.CORE_END),
        "capDiagnostics": {
            "normal": normal_cap,
            "severe": severe_cap,
            "excluded": excluded_cap,
            "excludedSevere": excluded_severe_cap,
        },
    }
    result["passed"] = bool(
        result["full"]["compoundedReturnPct"] > 0
        and result["severeFull"]["compoundedReturnPct"] > 0
        and result["largeWaveExcludedFull"]["compoundedReturnPct"] > 0
        and result["largeWaveExcludedSevereFull"]["compoundedReturnPct"] > 0
        and result["full"]["maxDrawdownPct"] >= -30.0
        and result["severeFull"]["maxDrawdownPct"] >= -47.0
        and result["reused2026H1"]["compoundedReturnPct"] > 0
        and result["reused2026H1Severe"]["compoundedReturnPct"] > 0
        and result["reused2026H1Excluded"]["compoundedReturnPct"] > 0
        and result["reused2026H1ExcludedSevere"]["compoundedReturnPct"] > 0
        and result["removeBestTradeSevere"]["compoundedReturnPct"] > 0
        and result["removeBestMonthSevere"]["compoundedReturnPct"] > 0
        and result["full"]["observedMaxConcurrentGross"] <= 2.0 + 1e-9
        and normal_cap["minimumClipRatio"] >= 0.50
    )
    return result


def rank_key(item: dict) -> tuple:
    return (
        item["largeWaveExcludedSevereFull"]["compoundedReturnPct"],
        item["largeWaveExcludedFull"]["compoundedReturnPct"],
        item["severeFull"]["compoundedReturnPct"],
        item["full"]["compoundedReturnPct"],
        item["severeFull"]["maxDrawdownPct"],
        item["full"]["maxDrawdownPct"],
    )


def rounded(value):
    return core.rounded(value)


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    raw = v89.build_raw()
    profiles = profile_core_rows(raw)

    original_core = v84.build_core_context()
    trade_start = min(int(trade["entry_ts"]) for trade in v68.V67_ASTER_TRADES)
    trade_end = max(int(trade["exit_ts"]) for trade in v68.V67_ASTER_TRADES)
    pengu_rows = core.fetch_klines("PENGUUSDT", trade_start - 30 * DAY, trade_end + HOUR)
    series = concentration_series(pengu_rows)
    overlap_start = max(core.CORE_START, trade_start)
    overlap_end = min(core.CORE_END, trade_end + HOUR)

    baseline_v71 = v70.evaluate(
        TARGET_V67_GROSS,
        pengu_rows,
        original_core["baseRows"],
        original_core["severeRows"],
        overlap_start,
        overlap_end,
    )
    v85_balanced = v84.evaluate(
        BALANCED_V85_CONFIG,
        series,
        original_core["baseRows"],
        original_core["severeRows"],
        original_core["context"],
        overlap_start,
        overlap_end,
        baseline_v71,
        {"full": baseline_v71["full"], "severeFull": baseline_v71["severeFull"]},
    )

    results = [combine_profile(name, profile, series) for name, profile in profiles.items()]
    passed = sorted([item for item in results if item["passed"]], key=rank_key, reverse=True)
    selected = passed[0] if passed else None
    default = next((item for item in results if item["name"] == "GROWTH"), results[0])
    chosen = selected or default
    status = "V71_V35_FINAL_PROFILE_PASS" if selected else "V71_V35_FINAL_PROFILE_DIAGNOSTIC"
    result = rounded({
        "version": 94,
        "strategyId": "V71_PLUS_V35_FINAL_PROFILES_V94",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": status,
        "targetV67MaxGross": TARGET_V67_GROSS,
        "baselineV71": baseline_v71,
        "v85Balanced": v85_balanced,
        "profiles": results,
        "selected": selected,
        "chosenForReport": chosen,
        "selectionPriority": (
            "Large-wave-excluded Severe, large-wave-excluded normal, full Severe, full return, "
            "then Severe and normal DD. All four 2026H1 variants and concentration stresses must remain positive."
        ),
        "frozenProfileDefinitions": {
            "GROWTH": {
                "v35WeightBand": asdict(GROWTH_CONFIG),
                "description": "Preserve V35 entry/exit/signature changes and suppress only small same-direction weight changes.",
            },
            "RESILIENT": {
                "v35WeightBand": asdict(RESILIENT_TARGET_CONFIG),
                "exhaustionGuard": asdict(RESILIENT_GUARD_CONFIG),
                "description": "Use the Growth allocator and scale 80% for two 12h buckets after confirmed momentum exhaustion.",
            },
            "PENGU": {
                "source": "V67 fixed Short trade sequence",
                "targetMaxGross": TARGET_V67_GROSS,
                "portfolioGrossCap": 2.0,
            },
        },
        "safety": {
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "ordersSent": False,
        },
        "limitations": [
            "V71, V85, V90 and V93 historical results were observed before this frozen comparison.",
            "2026H1 is reused acceptance evidence, not pristine holdout.",
            "The recommended profile requires frozen forward evidence and execution parity review before promotion.",
        ],
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "v71-v35-final-profiles-v94.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    report = [
        "# V71 + V35 Final Profiles V94",
        "",
        f"- Status: **{status}**",
        f"- V71 baseline: {baseline_v71['full']['compoundedReturnPct']}% / DD {baseline_v71['full']['maxDrawdownPct']}% / Severe DD {baseline_v71['severeFull']['maxDrawdownPct']}%",
        f"- V85 Balanced: {v85_balanced['full']['compoundedReturnPct']}% / DD {v85_balanced['full']['maxDrawdownPct']}% / Severe {v85_balanced['severeFull']['compoundedReturnPct']}% / Severe DD {v85_balanced['severeFull']['maxDrawdownPct']}%",
        f"- Selected profile: **{selected['name'] if selected else 'NONE'}**",
        "",
    ]
    for item in results:
        report.extend([
            f"## {item['name']}",
            f"- Pass: **{'YES' if item['passed'] else 'NO'}**",
            f"- Core only: {item['coreOnly']['compoundedReturnPct']}% / Severe {item['coreOnlySevere']['compoundedReturnPct']}%",
            f"- Full: {item['full']['compoundedReturnPct']}% / CAGR {item['full']['cagrPct']}% / DD {item['full']['maxDrawdownPct']}%",
            f"- Severe: {item['severeFull']['compoundedReturnPct']}% / DD {item['severeFull']['maxDrawdownPct']}%",
            f"- Waves excluded: {item['largeWaveExcludedFull']['compoundedReturnPct']}% / Severe {item['largeWaveExcludedSevereFull']['compoundedReturnPct']}%",
            f"- 2026H1: {item['reused2026H1']['compoundedReturnPct']}% / Severe {item['reused2026H1Severe']['compoundedReturnPct']}%",
            f"- 2026H1 waves excluded: {item['reused2026H1Excluded']['compoundedReturnPct']}% / Severe {item['reused2026H1ExcludedSevere']['compoundedReturnPct']}%",
            f"- Best trade/month removed Severe: {item['removeBestTradeSevere']['compoundedReturnPct']}% / {item['removeBestMonthSevere']['compoundedReturnPct']}%",
            f"- Max Gross / min clip: {item['full']['observedMaxConcurrentGross']} / {item['capDiagnostics']['normal']['minimumClipRatio']}",
            "",
        ])
    report.append("- Production / LIVE / VPS changed: **NO**")
    (state_dir / "v71-v35-final-profiles-v94.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
