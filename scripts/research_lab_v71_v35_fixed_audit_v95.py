from __future__ import annotations

import datetime as dt
import json
import os
from dataclasses import asdict
from pathlib import Path
from typing import Dict, List

import research_lab_v35_core_pengu_v67_combined_v2 as v68b
import research_lab_v35_core_pengu_v67_v69_sizing as v69
import research_lab_v35_core_pengu_v67_v70_dynamic_cap as v70
import research_lab_v35_turnover_stabilizer_v89 as v89
import research_lab_v35_weight_band_v90 as v90
import research_lab_v35_exhaustion_guard_v93 as v93
import research_lab_v71_whipsaw_guard_v84 as v84

AUDIT_GUARD_PCT = 75.0
v68b.MAX_ALLOWED_BUCKET_MOVE_PCT = AUDIT_GUARD_PCT
v69.v68.v67_series.__globals__["MAX_ALLOWED_BUCKET_MOVE_PCT"] = AUDIT_GUARD_PCT

v68 = v69.v68
core = v69.core
DAY = v69.DAY
HOUR = v69.HOUR
TARGET_GROSS = 1.15
GROWTH_CONFIG = v90.Config(0.05, 0.20, 12)
RESILIENT_CONFIG = v93.Config(2.0, 15.0, 1, 0.80, 2)
BALANCED_CONFIG = v84.WhipsawConfig(10, 1.5, 3, 0.60, 1, 2)
DEFENSIVE_CONFIG = v84.WhipsawConfig(10, 1.0, 3, 0.60, 1, 2)


def metrics(rows: List[dict], start: int, end: int) -> dict:
    return v69.metrics(rows, start, end)


def metric_signature(item: dict) -> tuple:
    return (
        round(float(item["compoundedReturnPct"]), 8),
        round(float(item["maxDrawdownPct"]), 8),
        round(float(item.get("monthlyProfitFactor") or 0.0), 8),
        round(float(item.get("observedMaxConcurrentGross") or 0.0), 8),
    )


def core_profile(name: str, normal_rows: List[dict], severe_rows: List[dict], rule: dict, diagnostics: dict) -> dict:
    return {
        "name": name,
        "normal": normal_rows,
        "severe": severe_rows,
        "rule": rule,
        "diagnostics": diagnostics,
    }


def evaluate_profile(
    profile: dict,
    series: Dict[str, Dict[int, dict]],
) -> dict:
    normal, cap_normal = v70.capped_combine(profile["normal"], series["main"], "base")
    severe, cap_severe = v70.capped_combine(profile["severe"], series["main"], "severe")
    excluded, cap_excluded = v70.capped_combine(profile["normal"], series["main"], "excludedBase")
    excluded_severe, cap_excluded_severe = v70.capped_combine(profile["severe"], series["main"], "excludedSevere")
    no_best, _ = v70.capped_combine(profile["normal"], series["noBest"], "base")
    no_best_severe, _ = v70.capped_combine(profile["severe"], series["noBest"], "severe")
    no_month, _ = v70.capped_combine(profile["normal"], series["noMonth"], "base")
    no_month_severe, _ = v70.capped_combine(profile["severe"], series["noMonth"], "severe")
    result = {
        "name": profile["name"],
        "coreRule": profile["rule"],
        "coreDiagnostics": profile["diagnostics"],
        "coreOnly": metrics(profile["normal"], core.CORE_START, core.CORE_END),
        "coreOnlySevere": metrics(profile["severe"], core.CORE_START, core.CORE_END),
        "core2026H1": metrics(profile["normal"], core.v4.START_2026, core.CORE_END),
        "core2026H1Severe": metrics(profile["severe"], core.v4.START_2026, core.CORE_END),
        "full": metrics(normal, core.CORE_START, core.CORE_END),
        "severeFull": metrics(severe, core.CORE_START, core.CORE_END),
        "largeWaveExcludedFull": metrics(excluded, core.CORE_START, core.CORE_END),
        "largeWaveExcludedSevereFull": metrics(excluded_severe, core.CORE_START, core.CORE_END),
        "reused2026H1": metrics(normal, core.v4.START_2026, core.CORE_END),
        "reused2026H1Severe": metrics(severe, core.v4.START_2026, core.CORE_END),
        "reused2026H1Excluded": metrics(excluded, core.v4.START_2026, core.CORE_END),
        "reused2026H1ExcludedSevere": metrics(excluded_severe, core.v4.START_2026, core.CORE_END),
        "removeBestTrade": metrics(no_best, core.CORE_START, core.CORE_END),
        "removeBestTradeSevere": metrics(no_best_severe, core.CORE_START, core.CORE_END),
        "removeBestMonth": metrics(no_month, core.CORE_START, core.CORE_END),
        "removeBestMonthSevere": metrics(no_month_severe, core.CORE_START, core.CORE_END),
        "capDiagnostics": {
            "normal": cap_normal,
            "severe": cap_severe,
            "excluded": cap_excluded,
            "excludedSevere": cap_excluded_severe,
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
        and cap_normal["minimumClipRatio"] >= 0.50
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

    growth_a = v90.simulate(GROWTH_CONFIG, raw)
    growth_b = v90.simulate(GROWTH_CONFIG, raw)
    resilient = v93.simulate(RESILIENT_CONFIG, raw)

    growth_a_full = metrics(growth_a["normalRows"], core.CORE_START, core.CORE_END)
    growth_b_full = metrics(growth_b["normalRows"], core.CORE_START, core.CORE_END)
    growth_a_severe = metrics(growth_a["severeRows"], core.CORE_START, core.CORE_END)
    growth_b_severe = metrics(growth_b["severeRows"], core.CORE_START, core.CORE_END)
    deterministic = bool(
        metric_signature(growth_a_full) == metric_signature(growth_b_full)
        and metric_signature(growth_a_severe) == metric_signature(growth_b_severe)
    )
    if not deterministic:
        raise RuntimeError("V90 Growth profile is not deterministic inside one fixed checkout/data snapshot")

    profiles = [
        core_profile(
            "GROWTH",
            growth_a["normalRows"],
            growth_a["severeRows"],
            {"weightBand": asdict(GROWTH_CONFIG), "exhaustionGuard": None},
            {"target": growth_a["stabilization"], "control": growth_a["controlDiagnostics"]},
        ),
        core_profile(
            "RESILIENT",
            resilient["normalRows"],
            resilient["severeRows"],
            {"weightBand": asdict(GROWTH_CONFIG), "exhaustionGuard": asdict(RESILIENT_CONFIG)},
            {
                "target": resilient["targetDiagnostics"],
                "guard": resilient["guardDiagnostics"],
                "control": resilient["controlDiagnostics"],
            },
        ),
    ]

    original = v84.build_core_context()
    trade_start = min(int(trade["entry_ts"]) for trade in v68.V67_ASTER_TRADES)
    trade_end = max(int(trade["exit_ts"]) for trade in v68.V67_ASTER_TRADES)
    pengu_rows = core.fetch_klines("PENGUUSDT", trade_start - 30 * DAY, trade_end + HOUR)
    trades = v69.scale_trades(TARGET_GROSS)
    series = {
        "main": v68.v67_series(pengu_rows, trades),
        "noBest": v68.v67_series(pengu_rows, v69.remove_best_trade(trades)),
        "noMonth": v68.v67_series(pengu_rows, v69.remove_best_month(trades)),
    }
    overlap_start = max(core.CORE_START, trade_start)
    overlap_end = min(core.CORE_END, trade_end + HOUR)
    baseline_v71 = v70.evaluate(
        TARGET_GROSS,
        pengu_rows,
        original["baseRows"],
        original["severeRows"],
        overlap_start,
        overlap_end,
    )
    fixed_v85 = {
        "BALANCED": v84.evaluate(
            BALANCED_CONFIG, series, original["baseRows"], original["severeRows"], original["context"],
            overlap_start, overlap_end, baseline_v71,
            {"full": baseline_v71["full"], "severeFull": baseline_v71["severeFull"]},
        ),
        "DEFENSIVE": v84.evaluate(
            DEFENSIVE_CONFIG, series, original["baseRows"], original["severeRows"], original["context"],
            overlap_start, overlap_end, baseline_v71,
            {"full": baseline_v71["full"], "severeFull": baseline_v71["severeFull"]},
        ),
    }

    results = [evaluate_profile(profile, series) for profile in profiles]
    passed = sorted((item for item in results if item["passed"]), key=rank_key, reverse=True)
    selected = passed[0] if passed else None
    growth = next(item for item in results if item["name"] == "GROWTH")
    resilient_result = next(item for item in results if item["name"] == "RESILIENT")
    status = "V71_V35_FIXED_AUDIT_PASS" if selected and deterministic else "V71_V35_FIXED_AUDIT_FAIL"
    result = rounded({
        "version": 95,
        "strategyId": "V71_V35_FIXED_CHECKOUT_AUDIT_V95",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": status,
        "determinismAudit": {
            "passed": deterministic,
            "growthRunA": {"full": growth_a_full, "severe": growth_a_severe},
            "growthRunB": {"full": growth_b_full, "severe": growth_b_severe},
        },
        "targetV67MaxGross": TARGET_GROSS,
        "baselineV71": baseline_v71,
        "v85FixedProfiles": fixed_v85,
        "profiles": results,
        "selected": selected,
        "growthProfile": growth,
        "resilientProfile": resilient_result,
        "selectionPriority": (
            "Large-wave-excluded Severe, large-wave-excluded normal, full Severe, full return, "
            "then Severe and normal drawdown."
        ),
        "safety": {
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "ordersSent": False,
        },
        "limitations": [
            "The historical V71/V35/PENGU data and profile definitions were observed before this fixed-run audit.",
            "2026H1 remains reused acceptance evidence, not pristine forward evidence.",
            "This audit resolves same-checkout reproducibility; it does not replace frozen future evidence.",
        ],
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "v71-v35-fixed-audit-v95.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    report = [
        "# V71 + V35 Fixed-checkout Audit V95",
        "",
        f"- Status: **{status}**",
        f"- Deterministic repeated Growth calculation: **{'YES' if deterministic else 'NO'}**",
        f"- V71 baseline: {baseline_v71['full']['compoundedReturnPct']}% / DD {baseline_v71['full']['maxDrawdownPct']}% / Severe DD {baseline_v71['severeFull']['maxDrawdownPct']}%",
        f"- Selected profile: **{selected['name'] if selected else 'NONE'}**",
        "",
    ]
    for item in results:
        report.extend([
            f"## {item['name']}",
            f"- Pass: **{'YES' if item['passed'] else 'NO'}**",
            f"- Core only: {item['coreOnly']['compoundedReturnPct']}% / Severe {item['coreOnlySevere']['compoundedReturnPct']}% / DD {item['coreOnly']['maxDrawdownPct']}%",
            f"- Core 2026H1: {item['core2026H1']['compoundedReturnPct']}% / Severe {item['core2026H1Severe']['compoundedReturnPct']}%",
            f"- Full: {item['full']['compoundedReturnPct']}% / CAGR {item['full']['cagrPct']}% / DD {item['full']['maxDrawdownPct']}%",
            f"- Severe: {item['severeFull']['compoundedReturnPct']}% / DD {item['severeFull']['maxDrawdownPct']}%",
            f"- Waves excluded: {item['largeWaveExcludedFull']['compoundedReturnPct']}% / Severe {item['largeWaveExcludedSevereFull']['compoundedReturnPct']}%",
            f"- 2026H1 combined: {item['reused2026H1']['compoundedReturnPct']}% / Severe {item['reused2026H1Severe']['compoundedReturnPct']}%",
            f"- Best trade/month removed Severe: {item['removeBestTradeSevere']['compoundedReturnPct']}% / {item['removeBestMonthSevere']['compoundedReturnPct']}%",
            f"- Max Gross / min clip: {item['full']['observedMaxConcurrentGross']} / {item['capDiagnostics']['normal']['minimumClipRatio']}",
            "",
        ])
    report.extend([
        "## V85 fixed reference",
        f"- Balanced: {fixed_v85['BALANCED']['full']['compoundedReturnPct']}% / DD {fixed_v85['BALANCED']['full']['maxDrawdownPct']}% / Severe DD {fixed_v85['BALANCED']['severeFull']['maxDrawdownPct']}%",
        f"- Defensive: {fixed_v85['DEFENSIVE']['full']['compoundedReturnPct']}% / DD {fixed_v85['DEFENSIVE']['full']['maxDrawdownPct']}% / Severe DD {fixed_v85['DEFENSIVE']['severeFull']['maxDrawdownPct']}%",
        "",
        "- Production / LIVE / VPS changed: **NO**",
    ])
    (state_dir / "v71-v35-fixed-audit-v95.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
