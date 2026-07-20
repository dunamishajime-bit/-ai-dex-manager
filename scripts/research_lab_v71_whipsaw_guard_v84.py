from __future__ import annotations

import datetime as dt
import itertools
import json
import os
import statistics
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, List

import research_lab_v35_core_pengu_v67_combined_v2 as v68b
import research_lab_v35_core_pengu_v67_v69_sizing as v69
import research_lab_v35_core_pengu_v67_v70_dynamic_cap as v70
import research_lab_v71_conditional_drawdown_v83 as v83
import research_lab_v71_drawdown_control_v82 as v82

v68b.MAX_ALLOWED_BUCKET_MOVE_PCT = 75.0
v68 = v69.v68
core = v69.core
DAY = v69.DAY
HOUR = v69.HOUR
TARGET_GROSS = 1.15
GROSS_CAP = 2.0
BASE_DD_CONFIG = v83.Config(0.12, 20, -0.04, 0.85, 0.40, 0.08, 1.00)


@dataclass(frozen=True)
class WhipsawConfig:
    window_buckets: int
    turnover_threshold: float
    flip_threshold: int
    core_scale: float
    confirmation_buckets: int
    recovery_buckets: int

    @property
    def config_id(self) -> str:
        return (
            f"W{self.window_buckets}_T{int(self.turnover_threshold*100)}"
            f"_F{self.flip_threshold}_S{int(self.core_scale*100)}"
            f"_C{self.confirmation_buckets}_R{self.recovery_buckets}"
        )


def configs() -> List[WhipsawConfig]:
    return [
        WhipsawConfig(*values)
        for values in itertools.product(
            (10, 20),
            (1.0, 1.5, 2.0),
            (2, 3, 4),
            (0.60, 0.75, 0.85),
            (1, 2),
            (1, 2),
        )
    ]


def build_core_context() -> dict:
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
    previous = {}
    context: Dict[int, dict] = {}
    for ts in times:
        desired = dict(targets.get(ts, {}))
        turnover = core.v4.turnover(previous, desired) if desired != previous else 0.0
        regime = int(base_core.get(ts, {}).get("regime", 0))
        context[ts] = {"turnover": turnover, "regime": regime}
        previous = desired
    return {
        "baseRows": core.core_rows(config, times, base_core, features),
        "severeRows": core.core_rows(config, times, severe_core, features),
        "context": context,
        "config": config,
    }


def count_flips(regimes: List[int]) -> int:
    return sum(
        regimes[index] != 0
        and regimes[index - 1] != 0
        and regimes[index] != regimes[index - 1]
        for index in range(1, len(regimes))
    )


def combine(
    core_rows: List[dict],
    pengu: Dict[int, dict],
    field: str,
    context: Dict[int, dict],
    config: WhipsawConfig,
) -> tuple[List[dict], dict]:
    result: List[dict] = []
    equity = peak = 1.0
    shadow_pengu_equity = shadow_pengu_peak = 1.0
    core_reference_returns: List[float] = []
    turnover_history: List[float] = []
    regime_history: List[int] = []
    signal_count = calm_count = 0
    whipsaw_active = False
    whipsaw_buckets = 0
    dd_stage_counts = {0: 0, 1: 0, 2: 0}
    clipped = 0
    clip_ratios: List[float] = []
    for row in core_rows:
        portfolio_dd = equity / peak - 1.0
        recent_core = v83.compounded(core_reference_returns[-BASE_DD_CONFIG.core_window_buckets:]) if core_reference_returns else 0.0
        if (
            portfolio_dd <= -(BASE_DD_CONFIG.core_start_dd + v83.SECOND_GAP)
            and recent_core <= BASE_DD_CONFIG.core_trigger_return
        ):
            dd_stage = 2
            dd_scale = BASE_DD_CONFIG.core_scale_2
        elif portfolio_dd <= -BASE_DD_CONFIG.core_start_dd and recent_core <= BASE_DD_CONFIG.core_trigger_return:
            dd_stage = 1
            dd_scale = BASE_DD_CONFIG.core_scale_1
        else:
            dd_stage = 0
            dd_scale = 1.0
        dd_stage_counts[dd_stage] += 1

        recent_turnover = sum(turnover_history[-config.window_buckets:])
        recent_flips = count_flips(regime_history[-config.window_buckets:])
        whipsaw_signal = (
            recent_turnover >= config.turnover_threshold
            or recent_flips >= config.flip_threshold
        )
        if whipsaw_signal:
            signal_count += 1
            calm_count = 0
        else:
            calm_count += 1
            signal_count = 0
        if not whipsaw_active and signal_count >= config.confirmation_buckets:
            whipsaw_active = True
        elif whipsaw_active and calm_count >= config.recovery_buckets:
            whipsaw_active = False
        if whipsaw_active:
            whipsaw_buckets += 1
        core_scale = dd_scale * (config.core_scale if whipsaw_active else 1.0)

        p = pengu.get(int(row["ts"]), {
            field: 0.0,
            "maxExposure": 0.0,
            "averageExposure": 0.0,
        })
        shadow_pengu_dd = shadow_pengu_equity / shadow_pengu_peak - 1.0
        pengu_scale = BASE_DD_CONFIG.pengu_scale if shadow_pengu_dd <= -BASE_DD_CONFIG.pengu_shadow_dd else 1.0
        core_gross = float(row["gross"]) * core_scale
        p_max = float(p.get("maxExposure", 0.0)) * pengu_scale
        p_avg = float(p.get("averageExposure", 0.0)) * pengu_scale
        if p_max > 0:
            capacity = max(0.0, GROSS_CAP - core_gross)
            cap_ratio = min(1.0, capacity / p_max)
            clip_ratios.append(cap_ratio)
            if cap_ratio < 1.0 - 1e-12:
                clipped += 1
        else:
            cap_ratio = 1.0
        core_return = float(row["return"]) * core_scale
        raw_pengu_return = float(p.get(field, 0.0))
        pengu_return = raw_pengu_return * pengu_scale * cap_ratio
        value = core_return + pengu_return
        result.append({
            "ts": int(row["ts"]),
            "return": value,
            "gross": core_gross + p_avg * cap_ratio,
            "maxGross": core_gross + p_max * cap_ratio,
            "coreReturn": core_return,
            "penguReturn": pengu_return,
            "coreScale": core_scale,
            "penguScale": pengu_scale * cap_ratio,
            "whipsawActive": whipsaw_active,
            "recentTurnover": recent_turnover,
            "recentFlips": recent_flips,
            "ddStage": dd_stage,
        })
        equity *= max(0.001, 1.0 + value)
        peak = max(peak, equity)
        shadow_pengu_equity *= max(0.001, 1.0 + raw_pengu_return)
        shadow_pengu_peak = max(shadow_pengu_peak, shadow_pengu_equity)
        core_reference_returns.append(float(row["return"]))
        item = context.get(int(row["ts"]), {"turnover": 0.0, "regime": 0})
        turnover_history.append(float(item["turnover"]))
        regime_history.append(int(item["regime"]))
    return result, {
        "whipsawBuckets": whipsaw_buckets,
        "whipsawRatePct": whipsaw_buckets / len(result) * 100.0 if result else 0.0,
        "ddStageBuckets": dd_stage_counts,
        "activePenguBuckets": len(clip_ratios),
        "clippedPenguBuckets": clipped,
        "minimumClipRatio": min(clip_ratios) if clip_ratios else 1.0,
        "averageClipRatio": statistics.fmean(clip_ratios) if clip_ratios else 1.0,
    }


def retention(value: float, baseline: float) -> float:
    return value / baseline if baseline > 0 else 1.0 if value >= baseline else 0.0


def evaluate(
    config: WhipsawConfig,
    series: Dict[str, Dict[int, dict]],
    base_core_rows: List[dict],
    severe_core_rows: List[dict],
    context: Dict[int, dict],
    overlap_start: int,
    overlap_end: int,
    baseline_v71: dict,
    baseline_v83: dict,
) -> dict:
    normal, normal_diag = combine(base_core_rows, series["main"], "base", context, config)
    severe, severe_diag = combine(severe_core_rows, series["main"], "severe", context, config)
    excluded, excluded_diag = combine(base_core_rows, series["main"], "excludedBase", context, config)
    excluded_severe, excluded_severe_diag = combine(severe_core_rows, series["main"], "excludedSevere", context, config)
    no_best, _ = combine(base_core_rows, series["noBest"], "base", context, config)
    no_best_severe, _ = combine(severe_core_rows, series["noBest"], "severe", context, config)
    no_month, _ = combine(base_core_rows, series["noMonth"], "base", context, config)
    no_month_severe, _ = combine(severe_core_rows, series["noMonth"], "severe", context, config)

    full = v69.metrics(normal, core.CORE_START, core.CORE_END)
    severe_full = v69.metrics(severe, core.CORE_START, core.CORE_END)
    excluded_full = v69.metrics(excluded, core.CORE_START, core.CORE_END)
    excluded_severe_full = v69.metrics(excluded_severe, core.CORE_START, core.CORE_END)
    overlap = v69.metrics(normal, overlap_start, overlap_end)
    overlap_severe = v69.metrics(severe, overlap_start, overlap_end)
    excluded_overlap = v69.metrics(excluded, overlap_start, overlap_end)
    excluded_overlap_severe = v69.metrics(excluded_severe, overlap_start, overlap_end)
    remove_best = v69.metrics(no_best, core.CORE_START, core.CORE_END)
    remove_best_severe = v69.metrics(no_best_severe, core.CORE_START, core.CORE_END)
    remove_month = v69.metrics(no_month, core.CORE_START, core.CORE_END)
    remove_month_severe = v69.metrics(no_month_severe, core.CORE_START, core.CORE_END)
    ret_v71 = {
        "full": retention(full["compoundedReturnPct"], baseline_v71["full"]["compoundedReturnPct"]),
        "excluded": retention(excluded_full["compoundedReturnPct"], baseline_v71["largeWaveExcludedFull"]["compoundedReturnPct"]),
        "severe": retention(severe_full["compoundedReturnPct"], baseline_v71["severeFull"]["compoundedReturnPct"]),
        "excludedSevere": retention(excluded_severe_full["compoundedReturnPct"], baseline_v71["largeWaveExcludedSevereFull"]["compoundedReturnPct"]),
    }
    passed = bool(
        full["compoundedReturnPct"] >= baseline_v71["full"]["compoundedReturnPct"]
        and excluded_full["compoundedReturnPct"] >= baseline_v71["largeWaveExcludedFull"]["compoundedReturnPct"]
        and full["maxDrawdownPct"] >= -29.0
        and severe_full["maxDrawdownPct"] >= -45.0
        and severe_full["compoundedReturnPct"] >= baseline_v71["severeFull"]["compoundedReturnPct"] * 0.80
        and excluded_severe_full["compoundedReturnPct"] >= 20.0
        and overlap["compoundedReturnPct"] > 0
        and overlap_severe["compoundedReturnPct"] > 0
        and excluded_overlap["compoundedReturnPct"] > 0
        and excluded_overlap_severe["compoundedReturnPct"] > 0
        and remove_best_severe["compoundedReturnPct"] > 0
        and remove_month_severe["compoundedReturnPct"] > 0
        and full["observedMaxConcurrentGross"] <= GROSS_CAP + 1e-9
        and normal_diag["minimumClipRatio"] >= 0.50
    )
    return {
        "config": asdict(config),
        "configId": config.config_id,
        "passed": passed,
        "retentionVsV71": ret_v71,
        "returnDeltaVsV83PctPoints": full["compoundedReturnPct"] - baseline_v83["full"]["compoundedReturnPct"],
        "normalDdDeltaVsV83PctPoints": full["maxDrawdownPct"] - baseline_v83["full"]["maxDrawdownPct"],
        "severeDdGainVsV71PctPoints": severe_full["maxDrawdownPct"] - baseline_v71["severeFull"]["maxDrawdownPct"],
        "full": full,
        "severeFull": severe_full,
        "largeWaveExcludedFull": excluded_full,
        "largeWaveExcludedSevereFull": excluded_severe_full,
        "overlap": overlap,
        "overlapSevere": overlap_severe,
        "largeWaveExcludedOverlap": excluded_overlap,
        "largeWaveExcludedOverlapSevere": excluded_overlap_severe,
        "removeBestTrade": remove_best,
        "removeBestTradeSevere": remove_best_severe,
        "removeBestMonth": remove_month,
        "removeBestMonthSevere": remove_month_severe,
        "diagnostics": {
            "normal": normal_diag,
            "severe": severe_diag,
            "excluded": excluded_diag,
            "excludedSevere": excluded_severe_diag,
        },
    }


def rank_key(item: dict) -> tuple:
    return (
        item["largeWaveExcludedSevereFull"]["compoundedReturnPct"],
        item["severeFull"]["maxDrawdownPct"],
        item["largeWaveExcludedFull"]["compoundedReturnPct"],
        item["full"]["compoundedReturnPct"],
        item["full"]["maxDrawdownPct"],
        -item["diagnostics"]["normal"]["whipsawRatePct"],
    )


def rounded(value):
    return core.rounded(value)


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    built = build_core_context()
    base_core_rows = built["baseRows"]
    severe_core_rows = built["severeRows"]
    context = built["context"]
    trade_start = min(int(trade["entry_ts"]) for trade in v68.V67_ASTER_TRADES)
    trade_end = max(int(trade["exit_ts"]) for trade in v68.V67_ASTER_TRADES)
    pengu_rows = core.fetch_klines("PENGUUSDT", trade_start - 30 * DAY, trade_end + HOUR)
    overlap_start = max(core.CORE_START, trade_start)
    overlap_end = min(core.CORE_END, trade_end + HOUR)
    trades = v69.scale_trades(TARGET_GROSS)
    series = {
        "main": v68.v67_series(pengu_rows, trades),
        "noBest": v68.v67_series(pengu_rows, v69.remove_best_trade(trades)),
        "noMonth": v68.v67_series(pengu_rows, v69.remove_best_month(trades)),
    }
    baseline_v71 = v70.evaluate(
        TARGET_GROSS,
        pengu_rows,
        base_core_rows,
        severe_core_rows,
        overlap_start,
        overlap_end,
    )
    baseline_v83_rows, _ = v83.combine(base_core_rows, series["main"], "base", BASE_DD_CONFIG)
    baseline_v83_severe_rows, _ = v83.combine(severe_core_rows, series["main"], "severe", BASE_DD_CONFIG)
    baseline_v83 = {
        "full": v69.metrics(baseline_v83_rows, core.CORE_START, core.CORE_END),
        "severeFull": v69.metrics(baseline_v83_severe_rows, core.CORE_START, core.CORE_END),
    }
    candidates = [
        evaluate(
            config,
            series,
            base_core_rows,
            severe_core_rows,
            context,
            overlap_start,
            overlap_end,
            baseline_v71,
            baseline_v83,
        )
        for config in configs()
    ]
    passed = [item for item in candidates if item["passed"]]
    passed.sort(key=rank_key, reverse=True)
    selected = passed[0] if passed else None
    best_compromise = max(
        candidates,
        key=lambda item: (
            item["largeWaveExcludedFull"]["compoundedReturnPct"]
            + item["largeWaveExcludedSevereFull"]["compoundedReturnPct"] * 3.0
            + max(0.0, item["severeDdGainVsV71PctPoints"]) * 20.0,
            item["full"]["compoundedReturnPct"],
        ),
    )
    chosen = selected or best_compromise
    chosen_normal, _ = combine(base_core_rows, series["main"], "base", context, WhipsawConfig(**chosen["config"]))
    chosen_severe, _ = combine(severe_core_rows, series["main"], "severe", context, WhipsawConfig(**chosen["config"]))
    status = "V71_WHIPSaw_GUARD_PASS" if selected else "NO_V71_WHIPSaw_GUARD_PASS"
    result = rounded({
        "version": 84,
        "strategyId": "V71_WHIPSaw_GUARD_V84",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": status,
        "candidateCount": len(candidates),
        "passedCount": len(passed),
        "baseDrawdownConfig": asdict(BASE_DD_CONFIG),
        "baselineV71": baseline_v71,
        "baselineV83": baseline_v83,
        "selected": selected,
        "bestCompromise": best_compromise,
        "chosenForAudit": chosen,
        "chosenWorstDrawdowns": v82.drawdown_episodes(chosen_normal),
        "chosenWorstSevereDrawdowns": v82.drawdown_episodes(chosen_severe),
        "topCandidates": sorted(candidates, key=rank_key, reverse=True)[:40],
        "rule": {
            "observables": "Prior completed 12h target turnover and prior regime flips only.",
            "activation": "Whipsaw guard requires threshold confirmation and separate calm recovery confirmation.",
            "scope": "Scale Core only; PENGU V71 target Gross and wave sleeve remain unchanged except existing total Gross cap.",
            "lookAhead": False,
        },
        "safety": {
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "ordersSent": False,
        },
        "limitations": [
            "V71 and V83 historical paths were observed before V84; this is engineering refinement, not pristine OOS evidence.",
            "Turnover thresholds must be reproduced from the production target allocator before promotion.",
        ],
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "v71-whipsaw-guard-v84.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    report = [
        "# V71 Whipsaw Guard V84",
        "",
        f"- Status: **{status}**",
        f"- Candidates: {len(candidates)} / passed {len(passed)}",
        f"- V71 baseline: {baseline_v71['full']['compoundedReturnPct']}% / DD {baseline_v71['full']['maxDrawdownPct']}%",
        f"- V71 Severe: {baseline_v71['severeFull']['compoundedReturnPct']}% / DD {baseline_v71['severeFull']['maxDrawdownPct']}%",
        f"- V83 baseline: {baseline_v83['full']['compoundedReturnPct']}% / DD {baseline_v83['full']['maxDrawdownPct']}%",
        "",
        f"- Chosen: **{chosen['configId']}**{' (strict pass)' if selected else ' (best compromise; not strict pass)'}",
        f"- Full: {chosen['full']['compoundedReturnPct']}% / DD {chosen['full']['maxDrawdownPct']}%",
        f"- Severe: {chosen['severeFull']['compoundedReturnPct']}% / DD {chosen['severeFull']['maxDrawdownPct']}%",
        f"- Waves excluded: {chosen['largeWaveExcludedFull']['compoundedReturnPct']}% / Severe {chosen['largeWaveExcludedSevereFull']['compoundedReturnPct']}%",
        f"- Severe DD gain vs V71: {chosen['severeDdGainVsV71PctPoints']} points",
        f"- Whipsaw active rate: {chosen['diagnostics']['normal']['whipsawRatePct']}%",
        f"- Minimum PENGU clip ratio: {chosen['diagnostics']['normal']['minimumClipRatio']}",
        "",
        "- Production / LIVE / VPS changed: **NO**",
    ]
    (state_dir / "v71-whipsaw-guard-v84.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
