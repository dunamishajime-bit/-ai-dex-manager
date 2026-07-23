from __future__ import annotations

import datetime as dt
import json
import os
from dataclasses import asdict
from pathlib import Path
from typing import Dict, List

import research_lab_v35_core_pengu_v67_v69_sizing as v69
import research_lab_v35_strong_growth_v86 as v86
import research_lab_v35_strong_reserved_pengu_v96 as v96
import research_lab_v35_turnover_stabilizer_v89 as v89
import research_lab_v35_weight_band_strong_v95 as v95
import research_lab_v35_weight_band_v90 as v90
import research_lab_v96_core_volume_floor_validation as floorval
import research_lab_v96_frequency_uplift as freq

core = v69.core
PRODUCTION_MERGE_SHA = "a4529372a4a331b602a51d36f3287345a89436bb"
OLD = freq.CoreCandidate(
    "V96_OLD_VOLUME70_TURNOVER20",
    volume_floor=0.70,
    turnover_threshold=0.20,
)
NEW = freq.CoreCandidate(
    "V96_PRODUCTION_VOLUME50_TURNOVER075",
    volume_floor=0.50,
    turnover_threshold=0.075,
)


def iso_ms(value: int) -> str:
    return dt.datetime.fromtimestamp(value / 1000, tz=dt.timezone.utc).isoformat()


def rounded(value):
    if isinstance(value, float):
        return round(value, 4)
    if isinstance(value, dict):
        return {key: rounded(item) for key, item in value.items()}
    if isinstance(value, list):
        return [rounded(item) for item in value]
    return value


def build_core_profile(candidate: freq.CoreCandidate, raw: dict) -> dict:
    raw_targets = freq.raw_targets_for(candidate, raw)
    targets, stabilization = v90.stabilize(
        raw_targets,
        raw["times"],
        v90.Config(candidate.weight_tolerance, candidate.turnover_threshold, candidate.stale_bars),
    )
    normal_cost_rows = core.v32.core_series(
        targets, raw["times"], raw["bars"], raw["indexes"], raw["funding"], 10, 0, 0
    )
    severe_cost_rows = core.v32.core_series(
        targets, raw["times"], raw["bars"], raw["indexes"], raw["funding"], 50, 1, 3
    )
    features = core.v34.features_with_vol(raw["times"], targets, raw["bars"], raw["indexes"], raw["funding"])
    config = core.CoreConfig()
    normal_base = core.core_rows(config, raw["times"], normal_cost_rows, features)
    severe_base = core.core_rows(config, raw["times"], severe_cost_rows, features)
    context = v89.context_for(targets, raw, normal_cost_rows, features)
    normal, normal_diag = v86.controlled_core(normal_base, context, v95.STRONG_CONFIG)
    severe, severe_diag = v86.controlled_core(severe_base, context, v95.STRONG_CONFIG)
    return {
        "normal": normal,
        "severe": severe,
        "targets": targets,
        "frequency": freq.count_core_frequency(targets, raw["times"], stabilization),
        "stabilization": stabilization,
        "controlDiagnostics": {"normal": normal_diag, "severe": severe_diag},
    }


def metric(rows: List[dict], start: int, end: int) -> dict:
    return v69.metrics(rows, start, end)


def yearly(rows_normal: List[dict], rows_severe: List[dict]) -> dict:
    result = {}
    for year in (2023, 2024, 2025, 2026):
        start = int(dt.datetime(year, 1, 1, tzinfo=dt.timezone.utc).timestamp() * 1000)
        end = core.CORE_END if year == 2026 else int(
            dt.datetime(year + 1, 1, 1, tzinfo=dt.timezone.utc).timestamp() * 1000
        )
        result[str(year)] = {
            "normal": metric(rows_normal, start, end),
            "severe": metric(rows_severe, start, end),
        }
    return result


def core_result(profile: dict) -> dict:
    normal = profile["normal"]
    severe = profile["severe"]
    return {
        "frequency": profile["frequency"],
        "full": metric(normal, core.CORE_START, core.CORE_END),
        "fullSevere": metric(severe, core.CORE_START, core.CORE_END),
        "development": metric(normal, core.CORE_START, core.v4.START_2026),
        "developmentSevere": metric(severe, core.CORE_START, core.v4.START_2026),
        "reused2026H1": metric(normal, core.v4.START_2026, core.CORE_END),
        "reused2026H1Severe": metric(severe, core.v4.START_2026, core.CORE_END),
        "removeBestPortfolioMonthSevere": metric(
            floorval.remove_best_month(severe, core.CORE_START, core.CORE_END),
            core.CORE_START,
            core.CORE_END,
        ),
        "removeBestPortfolioBucketSevere": metric(
            floorval.remove_best_bucket(severe, core.CORE_START, core.CORE_END),
            core.CORE_START,
            core.CORE_END,
        ),
        "years": yearly(normal, severe),
        "controlDiagnostics": profile["controlDiagnostics"],
    }


def combined_series(profile: dict, pengu_rows: List[dict]) -> dict:
    trades = v69.scale_trades(v96.TARGET_V67_GROSS)
    main = v96.v68.v67_series(pengu_rows, trades)
    no_best = v96.v68.v67_series(pengu_rows, v69.remove_best_trade(trades))
    no_month = v96.v68.v67_series(pengu_rows, v69.remove_best_month(trades))

    normal, cap_normal = v96.reserved_combine(profile["normal"], main, "base")
    severe, cap_severe = v96.reserved_combine(profile["severe"], main, "severe")
    excluded, cap_excluded = v96.reserved_combine(profile["normal"], main, "excludedBase")
    excluded_severe, cap_excluded_severe = v96.reserved_combine(profile["severe"], main, "excludedSevere")
    remove_best, _ = v96.reserved_combine(profile["normal"], no_best, "base")
    remove_best_severe, _ = v96.reserved_combine(profile["severe"], no_best, "severe")
    remove_month, _ = v96.reserved_combine(profile["normal"], no_month, "base")
    remove_month_severe, _ = v96.reserved_combine(profile["severe"], no_month, "severe")

    core_scales = [float(row.get("coreScale", 1.0)) for row in normal]
    pengu_scales = [float(row.get("penguScale", 1.0)) for row in normal if float(row.get("penguScale", 1.0)) < 1.0]
    return {
        "normalRows": normal,
        "severeRows": severe,
        "full": metric(normal, core.CORE_START, core.CORE_END),
        "fullSevere": metric(severe, core.CORE_START, core.CORE_END),
        "development": metric(normal, core.CORE_START, core.v4.START_2026),
        "developmentSevere": metric(severe, core.CORE_START, core.v4.START_2026),
        "reused2026H1": metric(normal, core.v4.START_2026, core.CORE_END),
        "reused2026H1Severe": metric(severe, core.v4.START_2026, core.CORE_END),
        "largeWaveExcludedFull": metric(excluded, core.CORE_START, core.CORE_END),
        "largeWaveExcludedSevereFull": metric(excluded_severe, core.CORE_START, core.CORE_END),
        "removeBestPenguTrade": metric(remove_best, core.CORE_START, core.CORE_END),
        "removeBestPenguTradeSevere": metric(remove_best_severe, core.CORE_START, core.CORE_END),
        "removeBestPenguMonth": metric(remove_month, core.CORE_START, core.CORE_END),
        "removeBestPenguMonthSevere": metric(remove_month_severe, core.CORE_START, core.CORE_END),
        "removeBestPortfolioMonthSevere": metric(
            floorval.remove_best_month(severe, core.CORE_START, core.CORE_END),
            core.CORE_START,
            core.CORE_END,
        ),
        "removeBestPortfolioBucketSevere": metric(
            floorval.remove_best_bucket(severe, core.CORE_START, core.CORE_END),
            core.CORE_START,
            core.CORE_END,
        ),
        "years": yearly(normal, severe),
        "capDiagnostics": {
            "normal": cap_normal,
            "severe": cap_severe,
            "excluded": cap_excluded,
            "excludedSevere": cap_excluded_severe,
            "observedMinimumCoreScale": min(core_scales) if core_scales else 1.0,
            "observedMinimumClippedPenguScale": min(pengu_scales) if pengu_scales else 1.0,
        },
        "penguHistoricalTradeCount": len(trades),
    }


def delta(new: dict, old: dict, field: str) -> float:
    return float(new[field]) - float(old[field])


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    raw = v89.build_raw()
    old_profile = build_core_profile(OLD, raw)
    new_profile = build_core_profile(NEW, raw)

    trade_rows = v69.scale_trades(v96.TARGET_V67_GROSS)
    trade_start = min(int(trade["entry_ts"]) for trade in trade_rows)
    trade_end = max(int(trade["exit_ts"]) for trade in trade_rows)
    pengu_rows = core.fetch_klines("PENGUUSDT", trade_start - 30 * v69.DAY, trade_end + v69.HOUR)

    old_core = core_result(old_profile)
    new_core = core_result(new_profile)
    old_combined = combined_series(old_profile, pengu_rows)
    new_combined = combined_series(new_profile, pengu_rows)

    all_years_normal_positive = all(
        new_combined["years"][str(year)]["normal"]["compoundedReturnPct"] > 0
        for year in (2023, 2024, 2025, 2026)
    )
    gross_pass = new_combined["full"]["observedMaxConcurrentGross"] <= v96.TOTAL_GROSS_CAP + 1e-9
    clip_pass = new_combined["capDiagnostics"]["normal"]["minimumClipRatio"] >= v96.MINIMUM_PENGU_CLIP
    stress_pass = all(
        new_combined[key]["compoundedReturnPct"] > 0
        for key in (
            "fullSevere",
            "largeWaveExcludedSevereFull",
            "removeBestPenguTradeSevere",
            "removeBestPenguMonthSevere",
            "removeBestPortfolioMonthSevere",
            "removeBestPortfolioBucketSevere",
        )
    )
    status = (
        "V96_VOLUME50_TURNOVER075_FULL_PERIOD_BT_PASS"
        if gross_pass and clip_pass and stress_pass and all_years_normal_positive
        else "V96_VOLUME50_TURNOVER075_FULL_PERIOD_BT_DIAGNOSTIC"
    )

    payload = rounded({
        "version": 1,
        "strategyId": "DISDEX_V35_STRONG_RESERVED_PENGU_V96_CORE_VOLUME50_TURNOVER075_BT",
        "productionMergeSha": PRODUCTION_MERGE_SHA,
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": status,
        "period": {
            "startInclusive": iso_ms(core.CORE_START),
            "endExclusive": iso_ms(core.CORE_END),
            "developmentEnd": iso_ms(core.v4.START_2026),
        },
        "costAssumptions": {
            "normal": {"turnoverBps": 10, "fundingStressBps": 0, "slippageStressBps": 0},
            "severe": {"turnoverBps": 50, "fundingStressBps": 1, "slippageStressBps": 3},
        },
        "fixedProductionRules": {
            "core": asdict(NEW),
            "strongBoostConfig": asdict(v95.STRONG_CONFIG),
            "penguTargetGross": v96.TARGET_V67_GROSS,
            "totalGrossCap": v96.TOTAL_GROSS_CAP,
            "minimumPenguClip": v96.MINIMUM_PENGU_CLIP,
        },
        "oldV96": {"core": old_core, "combined": {key: value for key, value in old_combined.items() if not key.endswith("Rows")}},
        "newV96": {"core": new_core, "combined": {key: value for key, value in new_combined.items() if not key.endswith("Rows")}},
        "deltaNewMinusOld": {
            "coreOrderEvents": new_core["frequency"]["orderEvents"] - old_core["frequency"]["orderEvents"],
            "coreOrderEventsPct": (
                new_core["frequency"]["orderEvents"] / old_core["frequency"]["orderEvents"] - 1.0
            ) * 100.0,
            "combinedFullReturnPctPoints": delta(new_combined["full"], old_combined["full"], "compoundedReturnPct"),
            "combinedFullCagrPctPoints": delta(new_combined["full"], old_combined["full"], "cagrPct"),
            "combinedFullMaxDrawdownPctPoints": delta(new_combined["full"], old_combined["full"], "maxDrawdownPct"),
            "combinedSevereReturnPctPoints": delta(new_combined["fullSevere"], old_combined["fullSevere"], "compoundedReturnPct"),
            "combinedSevereMaxDrawdownPctPoints": delta(new_combined["fullSevere"], old_combined["fullSevere"], "maxDrawdownPct"),
            "reused2026H1ReturnPctPoints": delta(new_combined["reused2026H1"], old_combined["reused2026H1"], "compoundedReturnPct"),
            "reused2026H1SeverePctPoints": delta(new_combined["reused2026H1Severe"], old_combined["reused2026H1Severe"], "compoundedReturnPct"),
        },
        "checks": {
            "allYearsNormalPositive": all_years_normal_positive,
            "grossCapPass": gross_pass,
            "minimumPenguClipPass": clip_pass,
            "stressRemovalPass": stress_pass,
        },
        "safety": {
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "ordersSent": False,
        },
        "limitations": [
            "The 0.50 and 7.5% thresholds were selected after inspecting known history; this is not independent Holdout evidence.",
            "2026H1 is reused evidence, not pristine Forward evidence.",
            "The PENGU contribution uses the fixed historical V67 trade set and is not evidence that future signals will reproduce those trades.",
            "Core order events are target/rebalance events, not confirmed exchange fills.",
        ],
    })

    state_dir.mkdir(parents=True, exist_ok=True)
    json_path = state_dir / "v96-volume50-turnover075-full-bt.json"
    md_path = state_dir / "v96-volume50-turnover075-full-bt.md"
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    old_full = payload["oldV96"]["combined"]["full"]
    new_full = payload["newV96"]["combined"]["full"]
    old_severe = payload["oldV96"]["combined"]["fullSevere"]
    new_severe = payload["newV96"]["combined"]["fullSevere"]
    lines = [
        "# V96 Volume50 / Turnover7.5 Full-period Backtest",
        "",
        f"- Status: **{status}**",
        f"- Period: `{payload['period']['startInclusive']}` to `{payload['period']['endExclusive']}` (end exclusive)",
        f"- Production merge SHA: `{PRODUCTION_MERGE_SHA}`",
        "- Production / LIVE / VPS / orders changed: **NO**",
        "",
        "| Portfolio | Core events | Full | CAGR | DD | Severe | Severe DD | 2026H1 | 2026H1 Severe |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
        f"| Old V96 0.70 / 20% | {payload['oldV96']['core']['frequency']['orderEvents']} | {old_full['compoundedReturnPct']}% | {old_full['cagrPct']}% | {old_full['maxDrawdownPct']}% | {old_severe['compoundedReturnPct']}% | {old_severe['maxDrawdownPct']}% | {payload['oldV96']['combined']['reused2026H1']['compoundedReturnPct']}% | {payload['oldV96']['combined']['reused2026H1Severe']['compoundedReturnPct']}% |",
        f"| New V96 0.50 / 7.5% | {payload['newV96']['core']['frequency']['orderEvents']} | {new_full['compoundedReturnPct']}% | {new_full['cagrPct']}% | {new_full['maxDrawdownPct']}% | {new_severe['compoundedReturnPct']}% | {new_severe['maxDrawdownPct']}% | {payload['newV96']['combined']['reused2026H1']['compoundedReturnPct']}% | {payload['newV96']['combined']['reused2026H1Severe']['compoundedReturnPct']}% |",
        "",
        "## New V96 annual returns",
        "",
        "| Year | Normal | Severe | DD | Severe DD |",
        "| --- | ---: | ---: | ---: | ---: |",
    ]
    for year in (2023, 2024, 2025, 2026):
        item = payload["newV96"]["combined"]["years"][str(year)]
        lines.append(
            f"| {year} | {item['normal']['compoundedReturnPct']}% | {item['severe']['compoundedReturnPct']}% | "
            f"{item['normal']['maxDrawdownPct']}% | {item['severe']['maxDrawdownPct']}% |"
        )
    lines.extend([
        "",
        "## New V96 stress removals",
        "",
        f"- Large-wave excluded Severe: {payload['newV96']['combined']['largeWaveExcludedSevereFull']['compoundedReturnPct']}%",
        f"- Best PENGU trade removed Severe: {payload['newV96']['combined']['removeBestPenguTradeSevere']['compoundedReturnPct']}%",
        f"- Best PENGU month removed Severe: {payload['newV96']['combined']['removeBestPenguMonthSevere']['compoundedReturnPct']}%",
        f"- Best portfolio month removed Severe: {payload['newV96']['combined']['removeBestPortfolioMonthSevere']['compoundedReturnPct']}%",
        f"- Best 12h bucket removed Severe: {payload['newV96']['combined']['removeBestPortfolioBucketSevere']['compoundedReturnPct']}%",
        f"- Observed max Gross: {new_full['observedMaxConcurrentGross']}",
        f"- PENGU minimum / average clip: {payload['newV96']['combined']['capDiagnostics']['normal']['minimumClipRatio']} / {payload['newV96']['combined']['capDiagnostics']['normal']['averageClipRatio']}",
        f"- Core scaled buckets: {payload['newV96']['combined']['capDiagnostics']['normal']['coreScaledBuckets']}",
        "",
        "## Evidence warning",
        "",
        "Known-history BT only. The PENGU leg uses the fixed historical V67 trade set; it must not be treated as independent proof of future reproducibility.",
    ])
    md_path.write_text("\n".join(lines), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(lines))
    print("\n".join(lines))


if __name__ == "__main__":
    main()
