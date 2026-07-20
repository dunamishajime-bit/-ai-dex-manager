from __future__ import annotations

import datetime as dt
import itertools
import json
import os
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, List

import research_lab_v35_core_pengu_v67_combined_v2 as v68b
import research_lab_v35_core_pengu_v67_v69_sizing as v69
import research_lab_v35_core_pengu_v67_v70_dynamic_cap as v70
import research_lab_v35_strong_growth_v86 as v86

v68b.MAX_ALLOWED_BUCKET_MOVE_PCT = 75.0
v68 = v69.v68
core = v69.core
DAY = v69.DAY
HOUR = v69.HOUR
DEV_END = core.v4.START_2026
TARGET_V67_GROSS = 1.15
CORE_GROSS_CAP = 2.0
PORTFOLIO_GROSS_CAP = 2.0


@dataclass(frozen=True)
class Config:
    mom20_min: float
    boost: float
    bear_scale: float
    fragile_scale: float
    shock_min: float
    skew_max: float

    @property
    def config_id(self) -> str:
        return (
            f"M{int(self.mom20_min)}_B{int(self.boost*100)}"
            f"_H{int(self.bear_scale*100)}_F{int(self.fragile_scale*100)}"
            f"_SH{int(abs(self.shock_min))}_SK{int(self.skew_max*100)}"
        )


def configs() -> List[Config]:
    return [
        Config(*values)
        for values in itertools.product(
            (10.0, 15.0, 20.0),
            (0.10, 0.20, 0.30),
            (0.00, 0.25, 0.50, 0.75),
            (0.50, 0.65, 0.80),
            (-4.0, -2.0),
            (1.20, 1.35),
        )
    ]


def fragile(config: Config, item: dict) -> bool:
    feature = item.get("feature", {})
    return bool(
        int(item.get("regime", 0)) > 0
        and (
            not bool(feature.get("closeAboveSma20", False))
            or float(feature.get("mom3", 0.0)) <= 0.0
            or float(feature.get("shock", 0.0)) < config.shock_min
            or float(feature.get("skew", 1.0)) > config.skew_max
            or int(item.get("breadth", 0)) < 2
        )
    )


def growth_signal(config: Config, item: dict) -> bool:
    feature = item.get("feature", {})
    return bool(
        int(item.get("regime", 0)) > 0
        and not fragile(config, item)
        and float(feature.get("mom20", 0.0)) >= config.mom20_min
        and float(feature.get("mom3", 0.0)) > 0.0
        and int(item.get("breadth", 0)) >= 2
    )


def controlled_core(
    core_rows: List[dict],
    context: Dict[int, dict],
    config: Config,
) -> tuple[List[dict], dict]:
    result: List[dict] = []
    equity = peak = 1.0
    reference_returns: List[float] = []
    turnover_history: List[float] = []
    regime_history: List[int] = []
    signal_count = calm_count = 0
    whipsaw_active = False
    growth_buckets = fragile_buckets = bear_buckets = 0
    whipsaw_buckets = capped_buckets = 0
    dd_stage_counts = {0: 0, 1: 0, 2: 0}
    for row in core_rows:
        ts = int(row["ts"])
        item = context.get(ts, {"turnover": 0.0, "regime": 0, "breadth": 0, "feature": {}})
        portfolio_dd = equity / peak - 1.0
        recent_core = v86.v83.compounded(reference_returns[-v86.BALANCED_DD.core_window_buckets:]) if reference_returns else 0.0
        if (
            portfolio_dd <= -(v86.BALANCED_DD.core_start_dd + v86.v83.SECOND_GAP)
            and recent_core <= v86.BALANCED_DD.core_trigger_return
        ):
            dd_stage = 2
            dd_scale = v86.BALANCED_DD.core_scale_2
        elif portfolio_dd <= -v86.BALANCED_DD.core_start_dd and recent_core <= v86.BALANCED_DD.core_trigger_return:
            dd_stage = 1
            dd_scale = v86.BALANCED_DD.core_scale_1
        else:
            dd_stage = 0
            dd_scale = 1.0
        dd_stage_counts[dd_stage] += 1

        recent_turnover = sum(turnover_history[-v86.BALANCED_GUARD.window_buckets:])
        recent_flips = v86.count_flips(regime_history[-v86.BALANCED_GUARD.window_buckets:])
        whipsaw_signal = (
            recent_turnover >= v86.BALANCED_GUARD.turnover_threshold
            or recent_flips >= v86.BALANCED_GUARD.flip_threshold
        )
        if whipsaw_signal:
            signal_count += 1
            calm_count = 0
        else:
            calm_count += 1
            signal_count = 0
        if not whipsaw_active and signal_count >= v86.BALANCED_GUARD.confirmation_buckets:
            whipsaw_active = True
        elif whipsaw_active and calm_count >= v86.BALANCED_GUARD.recovery_buckets:
            whipsaw_active = False
        if whipsaw_active:
            whipsaw_buckets += 1
        scale = dd_scale * (v86.BALANCED_GUARD.core_scale if whipsaw_active else 1.0)

        regime = int(item.get("regime", 0))
        if regime < 0:
            scale *= config.bear_scale
            bear_buckets += 1
        elif fragile(config, item):
            scale *= config.fragile_scale
            fragile_buckets += 1
        elif (
            dd_stage == 0
            and not whipsaw_active
            and portfolio_dd > -0.05
            and growth_signal(config, item)
        ):
            scale *= 1.0 + config.boost
            growth_buckets += 1

        raw_gross = float(row["gross"]) * scale
        cap_ratio = min(1.0, CORE_GROSS_CAP / raw_gross) if raw_gross > 0 else 1.0
        if cap_ratio < 1.0 - 1e-12:
            capped_buckets += 1
        value = float(row["return"]) * scale * cap_ratio
        result.append({
            "ts": ts,
            "return": value,
            "gross": raw_gross * cap_ratio,
            "maxGross": raw_gross * cap_ratio,
            "turnover": 0.0,
            "stops": 0,
            "scale": scale * cap_ratio,
            "whipsawActive": whipsaw_active,
            "ddStage": dd_stage,
        })
        equity *= max(0.001, 1.0 + value)
        peak = max(peak, equity)
        reference_returns.append(float(row["return"]))
        turnover_history.append(float(item.get("turnover", 0.0)))
        regime_history.append(regime)
    return result, {
        "growthBuckets": growth_buckets,
        "fragileBuckets": fragile_buckets,
        "bearBuckets": bear_buckets,
        "whipsawBuckets": whipsaw_buckets,
        "ddStageBuckets": dd_stage_counts,
        "cappedBuckets": capped_buckets,
    }


def neighbor(left: Config, right: Config) -> bool:
    differences = sum([
        left.mom20_min != right.mom20_min,
        left.boost != right.boost,
        left.bear_scale != right.bear_scale,
        left.fragile_scale != right.fragile_scale,
        left.shock_min != right.shock_min,
        left.skew_max != right.skew_max,
    ])
    return differences <= 1


def evaluate(
    config: Config,
    base_rows: List[dict],
    severe_rows: List[dict],
    context: Dict[int, dict],
    baseline: dict,
) -> dict:
    normal, normal_diag = controlled_core(base_rows, context, config)
    severe, severe_diag = controlled_core(severe_rows, context, config)
    dev = v69.metrics(normal, core.CORE_START, DEV_END)
    dev_severe = v69.metrics(severe, core.CORE_START, DEV_END)
    hold = v69.metrics(normal, DEV_END, core.CORE_END)
    hold_severe = v69.metrics(severe, DEV_END, core.CORE_END)
    full = v69.metrics(normal, core.CORE_START, core.CORE_END)
    full_severe = v69.metrics(severe, core.CORE_START, core.CORE_END)
    development_pass = bool(
        dev["compoundedReturnPct"] >= baseline["development"]["compoundedReturnPct"] * 1.02
        and dev_severe["compoundedReturnPct"] >= baseline["developmentSevere"]["compoundedReturnPct"]
        and dev["maxDrawdownPct"] >= baseline["development"]["maxDrawdownPct"] - 1.5
        and dev_severe["maxDrawdownPct"] >= baseline["developmentSevere"]["maxDrawdownPct"] - 2.0
        and all(float(value) > 0.0 for value in dev["annualReturnsPct"].values())
        and full["observedMaxConcurrentGross"] <= CORE_GROSS_CAP + 1e-9
        and normal_diag["growthBuckets"] >= 10
    )
    holdout_pass = bool(
        hold["compoundedReturnPct"] > 0
        and hold_severe["compoundedReturnPct"] > 0
        and hold["compoundedReturnPct"] >= baseline["reused2026H1"]["compoundedReturnPct"] * 0.90
        and hold["maxDrawdownPct"] >= -15.0
        and hold_severe["maxDrawdownPct"] >= -20.0
        and full_severe["compoundedReturnPct"] >= baseline["fullSevere"]["compoundedReturnPct"]
    )
    return {
        "config": asdict(config),
        "configId": config.config_id,
        "developmentPass": development_pass,
        "holdoutPass": holdout_pass,
        "development": dev,
        "developmentSevere": dev_severe,
        "reused2026H1": hold,
        "reused2026H1Severe": hold_severe,
        "full": full,
        "fullSevere": full_severe,
        "diagnostics": {"normal": normal_diag, "severe": severe_diag},
    }


def rank_key(item: dict) -> tuple:
    return (
        item["developmentSevere"]["compoundedReturnPct"],
        item["development"]["compoundedReturnPct"],
        item["developmentSevere"]["maxDrawdownPct"],
        item["development"]["maxDrawdownPct"],
        -item["config"]["boost"],
    )


def rounded(value):
    return core.rounded(value)


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    built = v86.build_context()
    base_rows = built["baseRows"]
    severe_rows = built["severeRows"]
    context = built["context"]
    baseline_normal, baseline_normal_diag = v86.controlled_core(base_rows, context, None)
    baseline_severe, baseline_severe_diag = v86.controlled_core(severe_rows, context, None)
    baseline = {
        "development": v69.metrics(baseline_normal, core.CORE_START, DEV_END),
        "developmentSevere": v69.metrics(baseline_severe, core.CORE_START, DEV_END),
        "reused2026H1": v69.metrics(baseline_normal, DEV_END, core.CORE_END),
        "reused2026H1Severe": v69.metrics(baseline_severe, DEV_END, core.CORE_END),
        "full": v69.metrics(baseline_normal, core.CORE_START, core.CORE_END),
        "fullSevere": v69.metrics(baseline_severe, core.CORE_START, core.CORE_END),
        "diagnostics": {"normal": baseline_normal_diag, "severe": baseline_severe_diag},
    }

    candidates = [evaluate(config, base_rows, severe_rows, context, baseline) for config in configs()]
    development_passed = [item for item in candidates if item["developmentPass"]]
    lookup = {config.config_id: config for config in configs()}
    stable = [
        item for item in development_passed
        if sum(
            neighbor(lookup[item["configId"]], lookup[other["configId"]])
            for other in development_passed if other["configId"] != item["configId"]
        ) >= 2
    ]
    accepted = [item for item in stable if item["holdoutPass"]]
    accepted.sort(key=rank_key, reverse=True)
    selected = accepted[0] if accepted else None

    integration = None
    if selected:
        selected_config = Config(**selected["config"])
        growth_normal, _ = controlled_core(base_rows, context, selected_config)
        growth_severe, _ = controlled_core(severe_rows, context, selected_config)
        trade_start = min(int(trade["entry_ts"]) for trade in v68.V67_ASTER_TRADES)
        trade_end = max(int(trade["exit_ts"]) for trade in v68.V67_ASTER_TRADES)
        pengu_rows = core.fetch_klines("PENGUUSDT", trade_start - 30 * DAY, trade_end + HOUR)
        trades = v69.scale_trades(TARGET_V67_GROSS)
        series = v68.v67_series(pengu_rows, trades)
        no_best = v68.v67_series(pengu_rows, v69.remove_best_trade(trades))
        no_month = v68.v67_series(pengu_rows, v69.remove_best_month(trades))
        normal, cap = v70.capped_combine(growth_normal, series, "base")
        severe, cap_severe = v70.capped_combine(growth_severe, series, "severe")
        excluded, cap_excluded = v70.capped_combine(growth_normal, series, "excludedBase")
        excluded_severe, cap_excluded_severe = v70.capped_combine(growth_severe, series, "excludedSevere")
        remove_best, _ = v70.capped_combine(growth_normal, no_best, "base")
        remove_best_severe, _ = v70.capped_combine(growth_severe, no_best, "severe")
        remove_month, _ = v70.capped_combine(growth_normal, no_month, "base")
        remove_month_severe, _ = v70.capped_combine(growth_severe, no_month, "severe")
        integration = {
            "full": v69.metrics(normal, core.CORE_START, core.CORE_END),
            "severeFull": v69.metrics(severe, core.CORE_START, core.CORE_END),
            "largeWaveExcludedFull": v69.metrics(excluded, core.CORE_START, core.CORE_END),
            "largeWaveExcludedSevereFull": v69.metrics(excluded_severe, core.CORE_START, core.CORE_END),
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
        integration["passed"] = bool(
            integration["full"]["compoundedReturnPct"] > 0
            and integration["severeFull"]["compoundedReturnPct"] > 0
            and integration["largeWaveExcludedFull"]["compoundedReturnPct"] > 0
            and integration["largeWaveExcludedSevereFull"]["compoundedReturnPct"] > 0
            and integration["full"]["maxDrawdownPct"] >= -30.0
            and integration["severeFull"]["maxDrawdownPct"] >= -47.0
            and integration["removeBestTradeSevere"]["compoundedReturnPct"] > 0
            and integration["removeBestMonthSevere"]["compoundedReturnPct"] > 0
            and integration["full"]["observedMaxConcurrentGross"] <= PORTFOLIO_GROSS_CAP + 1e-9
            and cap["minimumClipRatio"] >= 0.50
        )

    best_holdout = max(
        stable,
        key=lambda item: (
            item["reused2026H1Severe"]["compoundedReturnPct"],
            item["reused2026H1"]["compoundedReturnPct"],
            item["developmentSevere"]["compoundedReturnPct"],
        ),
        default=None,
    )
    status = (
        "V35_PROTECTED_GROWTH_AND_V71_PASS"
        if selected and integration and integration["passed"]
        else "V35_PROTECTED_GROWTH_CORE_PASS"
        if selected
        else "NO_V35_PROTECTED_GROWTH_PASS"
    )
    result = rounded({
        "version": 87,
        "strategyId": "V35_PROTECTED_STRONG_GROWTH_V87",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": status,
        "candidateCount": len(candidates),
        "developmentPassedCount": len(development_passed),
        "stableDevelopmentCount": len(stable),
        "acceptedCount": len(accepted),
        "baselineControlledCore": baseline,
        "selected": selected,
        "bestHoldoutDiagnostic": best_holdout,
        "v71Integration": integration,
        "topAccepted": accepted[:30],
        "topDevelopment": sorted(stable, key=rank_key, reverse=True)[:40],
        "rule": {
            "bear": "Scale BTC Bear hedge to 0-75% of the existing V35 exposure.",
            "fragileBull": "Scale weak Bull regimes when momentum, shock, skew, SMA or breadth are adverse.",
            "strongGrowth": "Add 10-30% only in non-fragile Strong Bull regimes with no DD or Whipsaw guard.",
            "entryFamilyRetuned": False,
        },
        "safety": {
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "ordersSent": False,
        },
        "limitations": [
            "2026H1 is reused acceptance evidence and is used as a pass/fail filter; it is not pristine holdout.",
            "The candidate grid is historical research and requires frozen forward evidence before promotion.",
            "PENGU integration uses the observed V67 trade sequence and V71 target Gross 1.15.",
        ],
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "v35-protected-growth-v87.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    report = [
        "# V35 Protected Strong Growth V87",
        "",
        f"- Status: **{status}**",
        f"- Candidates: {len(candidates)} / development {len(development_passed)} / stable {len(stable)} / accepted {len(accepted)}",
        f"- Baseline Core: {baseline['full']['compoundedReturnPct']}% / Severe {baseline['fullSevere']['compoundedReturnPct']}% / DD {baseline['full']['maxDrawdownPct']}%",
        f"- Baseline 2026H1: {baseline['reused2026H1']['compoundedReturnPct']}% / Severe {baseline['reused2026H1Severe']['compoundedReturnPct']}%",
    ]
    if selected:
        report.extend([
            "",
            f"- Selected: **{selected['configId']}**",
            f"- Development: {selected['development']['compoundedReturnPct']}% / Severe {selected['developmentSevere']['compoundedReturnPct']}%",
            f"- 2026H1: {selected['reused2026H1']['compoundedReturnPct']}% / Severe {selected['reused2026H1Severe']['compoundedReturnPct']}%",
            f"- Full Core: {selected['full']['compoundedReturnPct']}% / DD {selected['full']['maxDrawdownPct']}%",
            f"- Full Severe: {selected['fullSevere']['compoundedReturnPct']}% / DD {selected['fullSevere']['maxDrawdownPct']}%",
        ])
    if integration:
        report.extend([
            "",
            "## V71 integration",
            f"- Pass: **{'YES' if integration['passed'] else 'NO'}**",
            f"- Full: {integration['full']['compoundedReturnPct']}% / DD {integration['full']['maxDrawdownPct']}%",
            f"- Severe: {integration['severeFull']['compoundedReturnPct']}% / DD {integration['severeFull']['maxDrawdownPct']}%",
            f"- Waves excluded: {integration['largeWaveExcludedFull']['compoundedReturnPct']}% / Severe {integration['largeWaveExcludedSevereFull']['compoundedReturnPct']}%",
            f"- Max Gross: {integration['full']['observedMaxConcurrentGross']}",
        ])
    if not selected and best_holdout:
        report.extend([
            "",
            f"- Best 2026 diagnostic: `{best_holdout['configId']}` / 2026 {best_holdout['reused2026H1']['compoundedReturnPct']}% / Severe {best_holdout['reused2026H1Severe']['compoundedReturnPct']}%",
        ])
    report.extend(["", "- Production / LIVE / VPS changed: **NO**"])
    (state_dir / "v35-protected-growth-v87.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
