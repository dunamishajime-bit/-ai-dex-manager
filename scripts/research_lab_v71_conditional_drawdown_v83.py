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
import research_lab_v71_drawdown_control_v82 as v82

v68b.MAX_ALLOWED_BUCKET_MOVE_PCT = 75.0
v68 = v69.v68
core = v69.core
DAY = v69.DAY
HOUR = v69.HOUR
TARGET_GROSS = 1.15
GROSS_CAP = 2.0
SECOND_GAP = 0.08


@dataclass(frozen=True)
class Config:
    core_start_dd: float
    core_window_buckets: int
    core_trigger_return: float
    core_scale_1: float
    core_scale_2: float
    pengu_shadow_dd: float
    pengu_scale: float

    @property
    def config_id(self) -> str:
        return (
            f"D{int(self.core_start_dd*100)}_W{self.core_window_buckets}"
            f"_T{int(abs(self.core_trigger_return)*100)}"
            f"_C{int(self.core_scale_1*100)}-{int(self.core_scale_2*100)}"
            f"_PD{int(self.pengu_shadow_dd*100)}_P{int(self.pengu_scale*100)}"
        )


def configs() -> List[Config]:
    return [
        Config(*values)
        for values in itertools.product(
            (0.08, 0.10, 0.12),
            (10, 20, 40),
            (-0.02, -0.04, -0.06),
            (0.70, 0.85),
            (0.40, 0.55),
            (0.08, 0.12),
            (0.50, 0.75, 1.00),
        )
    ]


def compounded(values: List[float]) -> float:
    equity = 1.0
    for value in values:
        equity *= max(0.001, 1.0 + value)
    return equity - 1.0


def combine(
    core_rows: List[dict],
    pengu: Dict[int, dict],
    field: str,
    config: Config,
) -> tuple[List[dict], dict]:
    result: List[dict] = []
    equity = peak = 1.0
    shadow_pengu_equity = shadow_pengu_peak = 1.0
    core_reference_returns: List[float] = []
    stage_counts = {0: 0, 1: 0, 2: 0}
    pengu_brake_buckets = 0
    clipped = 0
    clip_ratios: List[float] = []
    for row in core_rows:
        portfolio_dd = equity / peak - 1.0
        window = core_reference_returns[-config.core_window_buckets:]
        recent_core = compounded(window) if window else 0.0
        if (
            portfolio_dd <= -(config.core_start_dd + SECOND_GAP)
            and recent_core <= config.core_trigger_return
        ):
            stage = 2
            core_scale = config.core_scale_2
        elif portfolio_dd <= -config.core_start_dd and recent_core <= config.core_trigger_return:
            stage = 1
            core_scale = config.core_scale_1
        else:
            stage = 0
            core_scale = 1.0
        stage_counts[stage] += 1

        p = pengu.get(int(row["ts"]), {
            field: 0.0,
            "maxExposure": 0.0,
            "averageExposure": 0.0,
        })
        shadow_pengu_dd = shadow_pengu_equity / shadow_pengu_peak - 1.0
        pengu_scale = config.pengu_scale if shadow_pengu_dd <= -config.pengu_shadow_dd else 1.0
        if pengu_scale < 1.0:
            pengu_brake_buckets += 1

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
            "ddStage": stage,
            "recentCoreReferenceReturn": recent_core,
            "shadowPenguDrawdown": shadow_pengu_dd,
        })
        equity *= max(0.001, 1.0 + value)
        peak = max(peak, equity)
        shadow_pengu_equity *= max(0.001, 1.0 + raw_pengu_return)
        shadow_pengu_peak = max(shadow_pengu_peak, shadow_pengu_equity)
        core_reference_returns.append(float(row["return"]))
    return result, {
        "stageBuckets": stage_counts,
        "stage1RatePct": stage_counts[1] / len(result) * 100.0 if result else 0.0,
        "stage2RatePct": stage_counts[2] / len(result) * 100.0 if result else 0.0,
        "penguBrakeBuckets": pengu_brake_buckets,
        "penguBrakeRatePct": pengu_brake_buckets / len(result) * 100.0 if result else 0.0,
        "activePenguBuckets": len(clip_ratios),
        "clippedPenguBuckets": clipped,
        "minimumClipRatio": min(clip_ratios) if clip_ratios else 1.0,
        "averageClipRatio": statistics.fmean(clip_ratios) if clip_ratios else 1.0,
    }


def retention(value: float, baseline: float) -> float:
    return value / baseline if baseline > 0 else 1.0 if value >= baseline else 0.0


def evaluate(
    config: Config,
    series_by_field: Dict[str, Dict[int, dict]],
    base_core_rows: List[dict],
    severe_core_rows: List[dict],
    overlap_start: int,
    overlap_end: int,
    baseline: dict,
) -> dict:
    normal, normal_diag = combine(base_core_rows, series_by_field["main"], "base", config)
    severe, severe_diag = combine(severe_core_rows, series_by_field["main"], "severe", config)
    excluded, excluded_diag = combine(base_core_rows, series_by_field["main"], "excludedBase", config)
    excluded_severe, excluded_severe_diag = combine(severe_core_rows, series_by_field["main"], "excludedSevere", config)
    no_best, _ = combine(base_core_rows, series_by_field["noBest"], "base", config)
    no_best_severe, _ = combine(severe_core_rows, series_by_field["noBest"], "severe", config)
    no_month, _ = combine(base_core_rows, series_by_field["noMonth"], "base", config)
    no_month_severe, _ = combine(severe_core_rows, series_by_field["noMonth"], "severe", config)

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

    ret = {
        "full": retention(full["compoundedReturnPct"], baseline["full"]["compoundedReturnPct"]),
        "severe": retention(severe_full["compoundedReturnPct"], baseline["severeFull"]["compoundedReturnPct"]),
        "excluded": retention(excluded_full["compoundedReturnPct"], baseline["largeWaveExcludedFull"]["compoundedReturnPct"]),
        "excludedSevere": retention(excluded_severe_full["compoundedReturnPct"], baseline["largeWaveExcludedSevereFull"]["compoundedReturnPct"]),
    }
    normal_gain = full["maxDrawdownPct"] - baseline["full"]["maxDrawdownPct"]
    severe_gain = severe_full["maxDrawdownPct"] - baseline["severeFull"]["maxDrawdownPct"]
    passed = bool(
        ret["full"] >= 0.85
        and ret["excluded"] >= 0.85
        and severe_full["compoundedReturnPct"] > 0
        and excluded_severe_full["compoundedReturnPct"] > 0
        and full["maxDrawdownPct"] >= -27.0
        and severe_full["maxDrawdownPct"] >= -42.0
        and normal_gain >= 4.0
        and severe_gain >= 8.0
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
        "retention": ret,
        "normalDdGainPctPoints": normal_gain,
        "severeDdGainPctPoints": severe_gain,
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
        item["largeWaveExcludedFull"]["compoundedReturnPct"],
        item["largeWaveExcludedSevereFull"]["compoundedReturnPct"],
        item["full"]["compoundedReturnPct"],
        item["severeFull"]["maxDrawdownPct"],
        item["full"]["maxDrawdownPct"],
        -item["diagnostics"]["normal"]["stage1RatePct"],
        -item["diagnostics"]["normal"]["penguBrakeRatePct"],
    )


def rounded(value):
    return core.rounded(value)


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    core_data = v69.build_core()
    base_core_rows = core_data["baseRows"]
    severe_core_rows = core_data["severeRows"]
    trade_start = min(int(trade["entry_ts"]) for trade in v68.V67_ASTER_TRADES)
    trade_end = max(int(trade["exit_ts"]) for trade in v68.V67_ASTER_TRADES)
    pengu_rows = core.fetch_klines("PENGUUSDT", trade_start - 30 * DAY, trade_end + HOUR)
    overlap_start = max(core.CORE_START, trade_start)
    overlap_end = min(core.CORE_END, trade_end + HOUR)

    trades = v69.scale_trades(TARGET_GROSS)
    series_by_field = {
        "main": v68.v67_series(pengu_rows, trades),
        "noBest": v68.v67_series(pengu_rows, v69.remove_best_trade(trades)),
        "noMonth": v68.v67_series(pengu_rows, v69.remove_best_month(trades)),
    }
    baseline = v70.evaluate(
        TARGET_GROSS,
        pengu_rows,
        base_core_rows,
        severe_core_rows,
        overlap_start,
        overlap_end,
    )
    candidates = [
        evaluate(
            config,
            series_by_field,
            base_core_rows,
            severe_core_rows,
            overlap_start,
            overlap_end,
            baseline,
        )
        for config in configs()
    ]
    passed = [item for item in candidates if item["passed"]]
    passed.sort(key=rank_key, reverse=True)
    selected = passed[0] if passed else None
    best_compromise = max(
        candidates,
        key=lambda item: (
            min(item["retention"]["full"], item["retention"]["excluded"])
            + max(0.0, item["normalDdGainPctPoints"]) / 20.0
            + max(0.0, item["severeDdGainPctPoints"]) / 30.0,
            item["largeWaveExcludedFull"]["compoundedReturnPct"],
        ),
    )
    status = "V71_CONDITIONAL_DD_PASS" if selected else "NO_V71_CONDITIONAL_DD_PASS"
    chosen = selected or best_compromise
    chosen_rows, _ = combine(base_core_rows, series_by_field["main"], "base", Config(**chosen["config"]))
    chosen_severe_rows, _ = combine(severe_core_rows, series_by_field["main"], "severe", Config(**chosen["config"]))
    result = rounded({
        "version": 83,
        "strategyId": "V71_CONDITIONAL_DRAWDOWN_CONTROL_V83",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": status,
        "targetV67MaxGross": TARGET_GROSS,
        "candidateCount": len(candidates),
        "passedCount": len(passed),
        "baselineV71": baseline,
        "selected": selected,
        "bestCompromise": best_compromise,
        "chosenForAudit": chosen,
        "chosenWorstDrawdowns": v82.drawdown_episodes(chosen_rows),
        "chosenWorstSevereDrawdowns": v82.drawdown_episodes(chosen_severe_rows),
        "topCandidates": sorted(candidates, key=rank_key, reverse=True)[:40],
        "rule": {
            "core": "Scale Core only when prior portfolio DD and trailing reference Core return are both adverse; restore immediately when the trailing Core return no longer confirms deterioration.",
            "pengu": "Track a shadow unscaled PENGU sleeve equity and reduce PENGU only after its own sleeve DD threshold is crossed.",
            "grossCap": GROSS_CAP,
            "lookAhead": False,
        },
        "safety": {
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "ordersSent": False,
        },
        "limitations": [
            "V71 history is already observed; V83 is an engineering refinement rather than independent OOS evidence.",
            "The shadow PENGU sleeve is implementable but must be persisted independently from actual clipped account equity.",
        ],
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "v71-conditional-drawdown-v83.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    report = [
        "# V71 Conditional Drawdown Control V83",
        "",
        f"- Status: **{status}**",
        f"- Candidates: {len(candidates)} / passed {len(passed)}",
        f"- Baseline: {baseline['full']['compoundedReturnPct']}% / DD {baseline['full']['maxDrawdownPct']}%",
        f"- Baseline Severe: {baseline['severeFull']['compoundedReturnPct']}% / DD {baseline['severeFull']['maxDrawdownPct']}%",
        f"- Baseline waves excluded: {baseline['largeWaveExcludedFull']['compoundedReturnPct']}% / Severe {baseline['largeWaveExcludedSevereFull']['compoundedReturnPct']}%",
        "",
        f"- Chosen: **{chosen['configId']}**{' (strict pass)' if selected else ' (best compromise; not strict pass)'}",
        f"- Full: {chosen['full']['compoundedReturnPct']}% / DD {chosen['full']['maxDrawdownPct']}%",
        f"- Severe: {chosen['severeFull']['compoundedReturnPct']}% / DD {chosen['severeFull']['maxDrawdownPct']}%",
        f"- Waves excluded: {chosen['largeWaveExcludedFull']['compoundedReturnPct']}% / Severe {chosen['largeWaveExcludedSevereFull']['compoundedReturnPct']}%",
        f"- Retention: full {chosen['retention']['full']*100.0}% / excluded {chosen['retention']['excluded']*100.0}%",
        f"- DD improvement: normal {chosen['normalDdGainPctPoints']} points / Severe {chosen['severeDdGainPctPoints']} points",
        f"- Core brake rates: stage1 {chosen['diagnostics']['normal']['stage1RatePct']}% / stage2 {chosen['diagnostics']['normal']['stage2RatePct']}%",
        f"- PENGU brake rate: {chosen['diagnostics']['normal']['penguBrakeRatePct']}%",
        "",
        "- Production / LIVE / VPS changed: **NO**",
    ]
    (state_dir / "v71-conditional-drawdown-v83.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
