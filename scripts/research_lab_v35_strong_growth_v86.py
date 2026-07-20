from __future__ import annotations

import datetime as dt
import itertools
import json
import os
import statistics
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, List, Optional

import research_lab_v35_core_pengu_v67_combined_v2 as v68b
import research_lab_v35_core_pengu_v67_v69_sizing as v69
import research_lab_v35_core_pengu_v67_v70_dynamic_cap as v70
import research_lab_v71_conditional_drawdown_v83 as v83
import research_lab_v71_whipsaw_guard_v84 as v84

v68b.MAX_ALLOWED_BUCKET_MOVE_PCT = 75.0
v68 = v69.v68
core = v69.core
DAY = v69.DAY
HOUR = v69.HOUR
CORE_GROSS_CAP = 2.0
PORTFOLIO_GROSS_CAP = 2.0
TARGET_V67_GROSS = 1.15
DEV_END = core.v4.START_2026
BALANCED_GUARD = v84.WhipsawConfig(10, 1.5, 3, 0.60, 1, 2)
BALANCED_DD = v83.Config(0.12, 20, -0.04, 0.85, 0.40, 0.08, 1.00)


@dataclass(frozen=True)
class GrowthConfig:
    mom20_min: float
    mom3_min: float
    shock_min: float
    skew_max: float
    btc_vol_max: Optional[float]
    breadth_min: int
    boost: float

    @property
    def config_id(self) -> str:
        vol = 0 if self.btc_vol_max is None else int(self.btc_vol_max)
        return (
            f"M20{int(self.mom20_min)}_M3{int(self.mom3_min)}"
            f"_SH{int(abs(self.shock_min))}_SK{int(self.skew_max*100)}"
            f"_V{vol}_BR{self.breadth_min}_B{int(self.boost*100)}"
        )


def configs() -> List[GrowthConfig]:
    return [
        GrowthConfig(*values)
        for values in itertools.product(
            (10.0, 15.0, 20.0),
            (0.0, 1.0),
            (-4.0, -2.0),
            (1.20, 1.35),
            (None, 80.0, 100.0),
            (2, 3),
            (0.10, 0.20, 0.30),
        )
    ]


def build_context() -> dict:
    core.v4.load_symbol = core.load_aster_symbol
    cache_root = Path.cwd() / ".cache" / "perp-research-usdm"
    raw = {symbol: core.v4.load_symbol(cache_root, symbol) for symbol in core.v4.SYMBOLS}
    bars = {symbol: core.v4.resample_12h(raw[symbol]["candles"]) for symbol in core.v4.SYMBOLS}
    indexes = {
        symbol: {int(bar["ts"]): index for index, bar in enumerate(rows)}
        for symbol, rows in bars.items()
    }
    funding = core.v6.funding_buckets({symbol: raw[symbol]["funding"] for symbol in core.v4.SYMBOLS})
    times = [int(row["ts"]) for row in bars["BTC"] if core.CORE_START <= int(row["ts"]) < core.CORE_END]
    projected = core.v6.precompute_projected_members(core.v20.COMPONENTS, times, bars, indexes)
    base_map = {
        ts: core.v4.overlay_target(core.v20.OVERLAY, ts, projected[ts], bars, indexes)
        for ts in times
    }
    bear_map = core.v6.precompute_bear_targets([core.v20.HEDGE], times, bars, indexes)[core.v20.HEDGE.hedge_id]
    targets = core.v28.combo_targets("VWM25_SKEW125", base_map, bear_map, times, bars, indexes, funding)
    base_core = core.v32.core_series(targets, times, bars, indexes, funding, 10, 0, 0)
    severe_core = core.v32.core_series(targets, times, bars, indexes, funding, 50, 1, 3)
    features = core.v34.features_with_vol(times, targets, bars, indexes, funding)
    config = core.CoreConfig()
    base_rows = core.core_rows(config, times, base_core, features)
    severe_rows = core.core_rows(config, times, severe_core, features)
    previous = {}
    context: Dict[int, dict] = {}
    for position, ts in enumerate(times):
        desired = dict(targets.get(ts, {}))
        turnover = core.v4.turnover(previous, desired) if desired != previous else 0.0
        regime = int(base_core.get(ts, {}).get("regime", 0))
        source_target = targets.get(times[position - 1], {}) if position > 0 else {}
        breadth = sum(
            1 for symbol, weight in source_target.items()
            if symbol != "BTC" and float(weight) > 0.0
        )
        context[ts] = {
            "turnover": turnover,
            "regime": regime,
            "breadth": breadth,
            "feature": dict(features.get(ts, {})),
        }
        previous = desired
    return {
        "times": times,
        "baseRows": base_rows,
        "severeRows": severe_rows,
        "context": context,
        "coreConfig": asdict(config),
    }


def count_flips(regimes: List[int]) -> int:
    return sum(
        regimes[index] != 0
        and regimes[index - 1] != 0
        and regimes[index] != regimes[index - 1]
        for index in range(1, len(regimes))
    )


def strong_signal(config: GrowthConfig, item: dict) -> bool:
    feature = item.get("feature", {})
    btc_vol = float(feature.get("btcVol", 0.0))
    return bool(
        int(item.get("regime", 0)) > 0
        and bool(feature.get("closeAboveSma20", False))
        and float(feature.get("mom20", 0.0)) >= config.mom20_min
        and float(feature.get("mom3", 0.0)) >= config.mom3_min
        and float(feature.get("shock", 0.0)) >= config.shock_min
        and float(feature.get("skew", 1.0)) <= config.skew_max
        and int(item.get("breadth", 0)) >= config.breadth_min
        and (config.btc_vol_max is None or btc_vol <= config.btc_vol_max)
    )


def controlled_core(
    core_rows: List[dict],
    context: Dict[int, dict],
    growth: Optional[GrowthConfig],
) -> tuple[List[dict], dict]:
    result: List[dict] = []
    equity = peak = 1.0
    reference_returns: List[float] = []
    turnover_history: List[float] = []
    regime_history: List[int] = []
    signal_count = calm_count = 0
    whipsaw_active = False
    growth_buckets = 0
    whipsaw_buckets = 0
    dd_stage_counts = {0: 0, 1: 0, 2: 0}
    capped_buckets = 0
    for row in core_rows:
        ts = int(row["ts"])
        item = context.get(ts, {"turnover": 0.0, "regime": 0, "breadth": 0, "feature": {}})
        portfolio_dd = equity / peak - 1.0
        recent_core = v83.compounded(reference_returns[-BALANCED_DD.core_window_buckets:]) if reference_returns else 0.0
        if (
            portfolio_dd <= -(BALANCED_DD.core_start_dd + v83.SECOND_GAP)
            and recent_core <= BALANCED_DD.core_trigger_return
        ):
            dd_stage = 2
            dd_scale = BALANCED_DD.core_scale_2
        elif portfolio_dd <= -BALANCED_DD.core_start_dd and recent_core <= BALANCED_DD.core_trigger_return:
            dd_stage = 1
            dd_scale = BALANCED_DD.core_scale_1
        else:
            dd_stage = 0
            dd_scale = 1.0
        dd_stage_counts[dd_stage] += 1

        recent_turnover = sum(turnover_history[-BALANCED_GUARD.window_buckets:])
        recent_flips = count_flips(regime_history[-BALANCED_GUARD.window_buckets:])
        whipsaw_signal = (
            recent_turnover >= BALANCED_GUARD.turnover_threshold
            or recent_flips >= BALANCED_GUARD.flip_threshold
        )
        if whipsaw_signal:
            signal_count += 1
            calm_count = 0
        else:
            calm_count += 1
            signal_count = 0
        if not whipsaw_active and signal_count >= BALANCED_GUARD.confirmation_buckets:
            whipsaw_active = True
        elif whipsaw_active and calm_count >= BALANCED_GUARD.recovery_buckets:
            whipsaw_active = False
        if whipsaw_active:
            whipsaw_buckets += 1
        whipsaw_scale = BALANCED_GUARD.core_scale if whipsaw_active else 1.0

        boost = 0.0
        if (
            growth is not None
            and dd_stage == 0
            and not whipsaw_active
            and portfolio_dd > -0.05
            and strong_signal(growth, item)
        ):
            boost = growth.boost
            growth_buckets += 1
        scale = dd_scale * whipsaw_scale * (1.0 + boost)
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
            "boost": boost,
            "whipsawActive": whipsaw_active,
            "ddStage": dd_stage,
        })
        equity *= max(0.001, 1.0 + value)
        peak = max(peak, equity)
        reference_returns.append(float(row["return"]))
        turnover_history.append(float(item.get("turnover", 0.0)))
        regime_history.append(int(item.get("regime", 0)))
    return result, {
        "growthBuckets": growth_buckets,
        "growthRatePct": growth_buckets / len(result) * 100.0 if result else 0.0,
        "whipsawBuckets": whipsaw_buckets,
        "whipsawRatePct": whipsaw_buckets / len(result) * 100.0 if result else 0.0,
        "ddStageBuckets": dd_stage_counts,
        "cappedBuckets": capped_buckets,
    }


def neighbor(left: GrowthConfig, right: GrowthConfig) -> bool:
    differences = sum([
        left.mom20_min != right.mom20_min,
        left.mom3_min != right.mom3_min,
        left.shock_min != right.shock_min,
        left.skew_max != right.skew_max,
        left.btc_vol_max != right.btc_vol_max,
        left.breadth_min != right.breadth_min,
        left.boost != right.boost,
    ])
    return differences <= 1


def retention(value: float, baseline: float) -> float:
    return value / baseline if baseline > 0 else 1.0 if value >= baseline else 0.0


def evaluate_core(
    config: GrowthConfig,
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
        dev["compoundedReturnPct"] >= baseline["development"]["compoundedReturnPct"] * 1.05
        and dev_severe["compoundedReturnPct"] >= baseline["developmentSevere"]["compoundedReturnPct"]
        and dev["maxDrawdownPct"] >= baseline["development"]["maxDrawdownPct"] - 1.5
        and dev_severe["maxDrawdownPct"] >= baseline["developmentSevere"]["maxDrawdownPct"] - 2.0
        and all(float(value) > 0.0 for value in dev["annualReturnsPct"].values())
        and full["observedMaxConcurrentGross"] <= CORE_GROSS_CAP + 1e-9
        and normal_diag["growthBuckets"] >= 10
    )
    return {
        "config": asdict(config),
        "configId": config.config_id,
        "developmentPass": development_pass,
        "development": dev,
        "developmentSevere": dev_severe,
        "reused2026H1": hold,
        "reused2026H1Severe": hold_severe,
        "full": full,
        "fullSevere": full_severe,
        "diagnostics": {"normal": normal_diag, "severe": severe_diag},
        "retentionVsControlledBaseline": {
            "full": retention(full["compoundedReturnPct"], baseline["full"]["compoundedReturnPct"]),
            "severe": retention(full_severe["compoundedReturnPct"], baseline["fullSevere"]["compoundedReturnPct"]),
        },
    }


def development_rank(item: dict) -> tuple:
    return (
        item["developmentSevere"]["compoundedReturnPct"],
        item["development"]["compoundedReturnPct"],
        item["developmentSevere"]["maxDrawdownPct"],
        item["development"]["maxDrawdownPct"],
        -item["config"]["boost"],
    )


def combine_with_pengu(core_rows: List[dict], series: Dict[int, dict], field: str) -> tuple[List[dict], dict]:
    return v70.capped_combine(core_rows, series, field)


def rounded(value):
    return core.rounded(value)


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    built = build_context()
    base_rows = built["baseRows"]
    severe_rows = built["severeRows"]
    context = built["context"]
    baseline_normal, baseline_diag = controlled_core(base_rows, context, None)
    baseline_severe, baseline_severe_diag = controlled_core(severe_rows, context, None)
    baseline = {
        "development": v69.metrics(baseline_normal, core.CORE_START, DEV_END),
        "developmentSevere": v69.metrics(baseline_severe, core.CORE_START, DEV_END),
        "reused2026H1": v69.metrics(baseline_normal, DEV_END, core.CORE_END),
        "reused2026H1Severe": v69.metrics(baseline_severe, DEV_END, core.CORE_END),
        "full": v69.metrics(baseline_normal, core.CORE_START, core.CORE_END),
        "fullSevere": v69.metrics(baseline_severe, core.CORE_START, core.CORE_END),
        "diagnostics": {"normal": baseline_diag, "severe": baseline_severe_diag},
    }

    candidates = [evaluate_core(config, base_rows, severe_rows, context, baseline) for config in configs()]
    development_passed = [item for item in candidates if item["developmentPass"]]
    lookup = {config.config_id: config for config in configs()}
    stable = [
        item for item in development_passed
        if sum(
            neighbor(lookup[item["configId"]], lookup[other["configId"]])
            for other in development_passed if other["configId"] != item["configId"]
        ) >= 2
    ]
    stable.sort(key=development_rank, reverse=True)
    selected_development = stable[0] if stable else None
    holdout_pass = False
    selected = None
    if selected_development:
        hold = selected_development["reused2026H1"]
        hold_severe = selected_development["reused2026H1Severe"]
        holdout_pass = bool(
            hold["compoundedReturnPct"] > 0
            and hold_severe["compoundedReturnPct"] > 0
            and hold["compoundedReturnPct"] >= baseline["reused2026H1"]["compoundedReturnPct"] * 0.90
            and hold_severe["compoundedReturnPct"] >= baseline["reused2026H1Severe"]["compoundedReturnPct"]
            and hold["maxDrawdownPct"] >= baseline["reused2026H1"]["maxDrawdownPct"] - 2.0
            and hold_severe["maxDrawdownPct"] >= baseline["reused2026H1Severe"]["maxDrawdownPct"] - 2.0
        )
        if holdout_pass:
            selected = selected_development

    integration = None
    if selected:
        selected_config = GrowthConfig(**selected["config"])
        growth_normal, _ = controlled_core(base_rows, context, selected_config)
        growth_severe, _ = controlled_core(severe_rows, context, selected_config)
        trade_start = min(int(trade["entry_ts"]) for trade in v68.V67_ASTER_TRADES)
        trade_end = max(int(trade["exit_ts"]) for trade in v68.V67_ASTER_TRADES)
        pengu_rows = core.fetch_klines("PENGUUSDT", trade_start - 30 * DAY, trade_end + HOUR)
        trades = v69.scale_trades(TARGET_V67_GROSS)
        main_series = v68.v67_series(pengu_rows, trades)
        no_best_series = v68.v67_series(pengu_rows, v69.remove_best_trade(trades))
        no_month_series = v68.v67_series(pengu_rows, v69.remove_best_month(trades))
        normal, cap = combine_with_pengu(growth_normal, main_series, "base")
        severe, cap_severe = combine_with_pengu(growth_severe, main_series, "severe")
        excluded, cap_excluded = combine_with_pengu(growth_normal, main_series, "excludedBase")
        excluded_severe, cap_excluded_severe = combine_with_pengu(growth_severe, main_series, "excludedSevere")
        no_best, _ = combine_with_pengu(growth_normal, no_best_series, "base")
        no_best_severe, _ = combine_with_pengu(growth_severe, no_best_series, "severe")
        no_month, _ = combine_with_pengu(growth_normal, no_month_series, "base")
        no_month_severe, _ = combine_with_pengu(growth_severe, no_month_series, "severe")
        integration = {
            "full": v69.metrics(normal, core.CORE_START, core.CORE_END),
            "severeFull": v69.metrics(severe, core.CORE_START, core.CORE_END),
            "largeWaveExcludedFull": v69.metrics(excluded, core.CORE_START, core.CORE_END),
            "largeWaveExcludedSevereFull": v69.metrics(excluded_severe, core.CORE_START, core.CORE_END),
            "removeBestTrade": v69.metrics(no_best, core.CORE_START, core.CORE_END),
            "removeBestTradeSevere": v69.metrics(no_best_severe, core.CORE_START, core.CORE_END),
            "removeBestMonth": v69.metrics(no_month, core.CORE_START, core.CORE_END),
            "removeBestMonthSevere": v69.metrics(no_month_severe, core.CORE_START, core.CORE_END),
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

    status = (
        "V35_STRONG_GROWTH_AND_V71_INTEGRATION_PASS"
        if selected and integration and integration["passed"]
        else "V35_STRONG_GROWTH_CORE_PASS"
        if selected
        else "NO_V35_STRONG_GROWTH_PASS"
    )
    result = rounded({
        "version": 86,
        "strategyId": "V35_STRONG_REGIME_GROWTH_V86",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": status,
        "candidateCount": len(candidates),
        "developmentPassedCount": len(development_passed),
        "stableDevelopmentCount": len(stable),
        "baselineControlledCore": baseline,
        "selectedDevelopment": selected_development,
        "holdoutPassed": holdout_pass,
        "selected": selected,
        "v71Integration": integration,
        "topDevelopment": sorted(candidates, key=development_rank, reverse=True)[:40],
        "fixedRiskControls": {
            "dd": asdict(BALANCED_DD),
            "whipsaw": asdict(BALANCED_GUARD),
            "coreGrossCap": CORE_GROSS_CAP,
            "portfolioGrossCap": PORTFOLIO_GROSS_CAP,
            "v67TargetGross": TARGET_V67_GROSS,
        },
        "growthRule": (
            "Add 0.10-0.30 Core Gross only when prior completed 12h V35 features confirm strong trend, "
            "breadth, acceptable shock/skew/volatility, no active drawdown stage, no active whipsaw guard, "
            "and current controlled equity DD is better than -5%."
        ),
        "safety": {
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "ordersSent": False,
        },
        "limitations": [
            "2026H1 is reused acceptance evidence, not pristine holdout.",
            "The V35 signal family is fixed, but the Strong-regime growth thresholds are historically researched and require frozen forward evidence.",
            "PENGU integration uses the already observed V67 trade sequence and V71 target Gross 1.15.",
        ],
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "v35-strong-growth-v86.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    report = [
        "# V35 Strong-Regime Growth V86",
        "",
        f"- Status: **{status}**",
        f"- Candidates: {len(candidates)} / development pass {len(development_passed)} / stable {len(stable)}",
        f"- Controlled Core baseline: {baseline['full']['compoundedReturnPct']}% / DD {baseline['full']['maxDrawdownPct']}%",
        f"- Controlled Core baseline Severe: {baseline['fullSevere']['compoundedReturnPct']}% / DD {baseline['fullSevere']['maxDrawdownPct']}%",
    ]
    if selected_development:
        report.extend([
            "",
            f"- Development selection: **{selected_development['configId']}**",
            f"- Development: {selected_development['development']['compoundedReturnPct']}% / Severe {selected_development['developmentSevere']['compoundedReturnPct']}%",
            f"- 2026H1: {selected_development['reused2026H1']['compoundedReturnPct']}% / Severe {selected_development['reused2026H1Severe']['compoundedReturnPct']}%",
            f"- Holdout acceptance: **{'YES' if holdout_pass else 'NO'}**",
            f"- Full Core: {selected_development['full']['compoundedReturnPct']}% / DD {selected_development['full']['maxDrawdownPct']}%",
            f"- Full Core Severe: {selected_development['fullSevere']['compoundedReturnPct']}% / DD {selected_development['fullSevere']['maxDrawdownPct']}%",
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
    report.extend(["", "- Production / LIVE / VPS changed: **NO**"])
    (state_dir / "v35-strong-growth-v86.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
