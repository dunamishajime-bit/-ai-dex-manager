from __future__ import annotations

import datetime as dt
import itertools
import json
import os
import statistics
from copy import deepcopy
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, List, Tuple

import research_lab_v35_core_pengu_v67_v69_sizing as v69
import research_lab_v35_core_pengu_v67_v70_dynamic_cap as v70

v68 = v69.v68
core = v69.core
HOUR = v69.HOUR
DAY = v69.DAY
TARGET_V67_MAX_GROSS = 1.15
PORTFOLIO_GROSS_CAP = 2.0
SECOND_STAGE_GAP = 0.08


@dataclass(frozen=True)
class BrakeConfig:
    start_dd: float
    core_scale_1: float
    core_scale_2: float
    pengu_scale_1: float
    pengu_scale_2: float
    recovery_buffer: float

    @property
    def config_id(self) -> str:
        return (
            f"D{int(self.start_dd*100)}"
            f"_C{int(self.core_scale_1*100)}-{int(self.core_scale_2*100)}"
            f"_P{int(self.pengu_scale_1*100)}-{int(self.pengu_scale_2*100)}"
            f"_R{int(self.recovery_buffer*100)}"
        )


def configs() -> List[BrakeConfig]:
    return [
        BrakeConfig(*values)
        for values in itertools.product(
            (0.08, 0.10, 0.12, 0.15),
            (0.75, 0.85, 0.90),
            (0.40, 0.55, 0.70),
            (0.90, 1.00),
            (0.70, 0.85, 1.00),
            (0.03, 0.05),
        )
    ]


def stage_scales(config: BrakeConfig, stage: int) -> tuple[float, float]:
    if stage == 1:
        return config.core_scale_1, config.pengu_scale_1
    if stage == 2:
        return config.core_scale_2, config.pengu_scale_2
    return 1.0, 1.0


def update_stage(config: BrakeConfig, stage: int, drawdown: float) -> int:
    first = -config.start_dd
    second = -(config.start_dd + SECOND_STAGE_GAP)
    if stage == 0:
        if drawdown <= second:
            return 2
        if drawdown <= first:
            return 1
        return 0
    if stage == 1:
        if drawdown <= second:
            return 2
        if drawdown >= -(max(0.0, config.start_dd - config.recovery_buffer)):
            return 0
        return 1
    if drawdown >= -(max(0.0, config.start_dd + SECOND_STAGE_GAP - config.recovery_buffer)):
        return 1
    return 2


def controlled_combine(
    core_rows: List[dict],
    pengu: Dict[int, dict],
    field: str,
    config: BrakeConfig,
) -> tuple[List[dict], dict]:
    result: List[dict] = []
    equity = peak = 1.0
    stage = 0
    clip_ratios: List[float] = []
    stage_counts = {0: 0, 1: 0, 2: 0}
    clipped = 0
    transitions = 0
    previous_stage = 0
    for row in core_rows:
        drawdown = equity / peak - 1.0
        stage = update_stage(config, stage, drawdown)
        if stage != previous_stage:
            transitions += 1
        previous_stage = stage
        stage_counts[stage] += 1
        core_scale, pengu_scale = stage_scales(config, stage)
        p = pengu.get(int(row["ts"]), {
            field: 0.0,
            "maxExposure": 0.0,
            "averageExposure": 0.0,
        })
        core_gross = float(row["gross"]) * core_scale
        p_max = float(p.get("maxExposure", 0.0)) * pengu_scale
        p_avg = float(p.get("averageExposure", 0.0)) * pengu_scale
        if p_max > 0:
            capacity = max(0.0, PORTFOLIO_GROSS_CAP - core_gross)
            cap_ratio = min(1.0, capacity / p_max)
            clip_ratios.append(cap_ratio)
            if cap_ratio < 1.0 - 1e-12:
                clipped += 1
        else:
            cap_ratio = 1.0
        core_return = float(row["return"]) * core_scale
        pengu_return = float(p.get(field, 0.0)) * pengu_scale * cap_ratio
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
            "priorDrawdown": drawdown,
        })
        equity *= max(0.001, 1.0 + value)
        peak = max(peak, equity)
    diagnostics = {
        "stageBuckets": stage_counts,
        "stage1RatePct": stage_counts[1] / len(result) * 100.0 if result else 0.0,
        "stage2RatePct": stage_counts[2] / len(result) * 100.0 if result else 0.0,
        "transitions": transitions,
        "activePenguBuckets": len(clip_ratios),
        "clippedPenguBuckets": clipped,
        "minimumClipRatio": min(clip_ratios) if clip_ratios else 1.0,
        "averageClipRatio": statistics.fmean(clip_ratios) if clip_ratios else 1.0,
    }
    return result, diagnostics


def drawdown_episodes(rows: List[dict], limit: int = 5) -> List[dict]:
    equity = peak = 1.0
    peak_index = 0
    active_start = None
    trough_index = None
    trough_dd = 0.0
    episodes: List[dict] = []
    for index, row in enumerate(rows):
        equity *= max(0.001, 1.0 + float(row["return"]))
        if equity >= peak:
            if active_start is not None and trough_index is not None:
                episodes.append(_episode(rows, active_start, trough_index, index, trough_dd))
            peak = equity
            peak_index = index
            active_start = None
            trough_index = None
            trough_dd = 0.0
        else:
            dd = equity / peak - 1.0
            if active_start is None:
                active_start = peak_index
            if dd < trough_dd:
                trough_dd = dd
                trough_index = index
    if active_start is not None and trough_index is not None:
        episodes.append(_episode(rows, active_start, trough_index, len(rows) - 1, trough_dd))
    episodes.sort(key=lambda item: item["maxDrawdownPct"])
    return episodes[:limit]


def _compound(rows: List[dict], field: str, start: int, end: int) -> float:
    equity = 1.0
    for row in rows[start:end + 1]:
        equity *= max(0.001, 1.0 + float(row.get(field, 0.0)))
    return (equity - 1.0) * 100.0


def _episode(rows: List[dict], start: int, trough: int, recovery: int, dd: float) -> dict:
    return {
        "peakTs": int(rows[start]["ts"]),
        "peakIso": dt.datetime.fromtimestamp(int(rows[start]["ts"]) / 1000, tz=dt.timezone.utc).isoformat(),
        "troughTs": int(rows[trough]["ts"]),
        "troughIso": dt.datetime.fromtimestamp(int(rows[trough]["ts"]) / 1000, tz=dt.timezone.utc).isoformat(),
        "recoveryTs": int(rows[recovery]["ts"]),
        "recoveryIso": dt.datetime.fromtimestamp(int(rows[recovery]["ts"]) / 1000, tz=dt.timezone.utc).isoformat(),
        "maxDrawdownPct": dd * 100.0,
        "combinedPeakToTroughPct": _compound(rows, "return", start + 1, trough),
        "coreContributionPct": _compound(rows, "coreReturn", start + 1, trough),
        "penguContributionPct": _compound(rows, "penguReturn", start + 1, trough),
        "bucketsToTrough": max(0, trough - start),
        "bucketsToRecovery": max(0, recovery - start),
    }


def retention(value: float, baseline: float) -> float:
    if baseline <= 0:
        return 1.0 if value >= baseline else 0.0
    return value / baseline


def evaluate(
    config: BrakeConfig,
    pengu_rows: List[dict],
    base_core_rows: List[dict],
    severe_core_rows: List[dict],
    overlap_start: int,
    overlap_end: int,
    baseline: dict,
) -> dict:
    trades = v69.scale_trades(TARGET_V67_MAX_GROSS)
    series = v68.v67_series(pengu_rows, trades)
    normal, normal_diag = controlled_combine(base_core_rows, series, "base", config)
    severe, severe_diag = controlled_combine(severe_core_rows, series, "severe", config)
    excluded, excluded_diag = controlled_combine(base_core_rows, series, "excludedBase", config)
    excluded_severe, excluded_severe_diag = controlled_combine(severe_core_rows, series, "excludedSevere", config)

    no_best = v68.v67_series(pengu_rows, v69.remove_best_trade(trades))
    no_month = v68.v67_series(pengu_rows, v69.remove_best_month(trades))
    remove_best, _ = controlled_combine(base_core_rows, no_best, "base", config)
    remove_best_severe, _ = controlled_combine(severe_core_rows, no_best, "severe", config)
    remove_month, _ = controlled_combine(base_core_rows, no_month, "base", config)
    remove_month_severe, _ = controlled_combine(severe_core_rows, no_month, "severe", config)

    full = v69.metrics(normal, core.CORE_START, core.CORE_END)
    severe_full = v69.metrics(severe, core.CORE_START, core.CORE_END)
    excluded_full = v69.metrics(excluded, core.CORE_START, core.CORE_END)
    excluded_severe_full = v69.metrics(excluded_severe, core.CORE_START, core.CORE_END)
    overlap = v69.metrics(normal, overlap_start, overlap_end)
    overlap_severe = v69.metrics(severe, overlap_start, overlap_end)
    excluded_overlap = v69.metrics(excluded, overlap_start, overlap_end)
    excluded_overlap_severe = v69.metrics(excluded_severe, overlap_start, overlap_end)
    best_trade_severe = v69.metrics(remove_best_severe, core.CORE_START, core.CORE_END)
    best_month_severe = v69.metrics(remove_month_severe, core.CORE_START, core.CORE_END)
    best_trade = v69.metrics(remove_best, core.CORE_START, core.CORE_END)
    best_month = v69.metrics(remove_month, core.CORE_START, core.CORE_END)

    retentions = {
        "full": retention(full["compoundedReturnPct"], baseline["full"]["compoundedReturnPct"]),
        "severe": retention(severe_full["compoundedReturnPct"], baseline["severeFull"]["compoundedReturnPct"]),
        "excluded": retention(excluded_full["compoundedReturnPct"], baseline["largeWaveExcludedFull"]["compoundedReturnPct"]),
        "excludedSevere": retention(excluded_severe_full["compoundedReturnPct"], baseline["largeWaveExcludedSevereFull"]["compoundedReturnPct"]),
    }
    normal_dd_gain = full["maxDrawdownPct"] - baseline["full"]["maxDrawdownPct"]
    severe_dd_gain = severe_full["maxDrawdownPct"] - baseline["severeFull"]["maxDrawdownPct"]
    strict_pass = bool(
        retentions["full"] >= 0.85
        and retentions["excluded"] >= 0.85
        and retentions["severe"] >= 0.65
        and retentions["excludedSevere"] >= 0.65
        and full["maxDrawdownPct"] >= -25.0
        and severe_full["maxDrawdownPct"] >= -42.0
        and overlap["compoundedReturnPct"] > 0
        and overlap_severe["compoundedReturnPct"] > 0
        and excluded_overlap["compoundedReturnPct"] > 0
        and excluded_overlap_severe["compoundedReturnPct"] > 0
        and best_trade["compoundedReturnPct"] > 0
        and best_trade_severe["compoundedReturnPct"] > 0
        and best_month["compoundedReturnPct"] > 0
        and best_month_severe["compoundedReturnPct"] > 0
        and full["observedMaxConcurrentGross"] <= PORTFOLIO_GROSS_CAP + 1e-9
        and normal_diag["minimumClipRatio"] >= 0.50
    )
    partial_pass = bool(
        retentions["full"] >= 0.88
        and retentions["excluded"] >= 0.88
        and retentions["severe"] >= 0.70
        and retentions["excludedSevere"] >= 0.70
        and normal_dd_gain >= 3.0
        and severe_dd_gain >= 5.0
        and best_trade_severe["compoundedReturnPct"] > 0
        and best_month_severe["compoundedReturnPct"] > 0
        and normal_diag["minimumClipRatio"] >= 0.50
    )
    return {
        "config": asdict(config),
        "configId": config.config_id,
        "strictPass": strict_pass,
        "partialPass": partial_pass,
        "retention": retentions,
        "normalDdGainPctPoints": normal_dd_gain,
        "severeDdGainPctPoints": severe_dd_gain,
        "full": full,
        "severeFull": severe_full,
        "largeWaveExcludedFull": excluded_full,
        "largeWaveExcludedSevereFull": excluded_severe_full,
        "overlap": overlap,
        "overlapSevere": overlap_severe,
        "largeWaveExcludedOverlap": excluded_overlap,
        "largeWaveExcludedOverlapSevere": excluded_overlap_severe,
        "removeBestTrade": best_trade,
        "removeBestTradeSevere": best_trade_severe,
        "removeBestMonth": best_month,
        "removeBestMonthSevere": best_month_severe,
        "diagnostics": {
            "normal": normal_diag,
            "severe": severe_diag,
            "excluded": excluded_diag,
            "excludedSevere": excluded_severe_diag,
        },
        "worstDrawdowns": drawdown_episodes(normal),
        "worstSevereDrawdowns": drawdown_episodes(severe),
    }


def rank_key(item: dict) -> tuple:
    return (
        item["largeWaveExcludedSevereFull"]["compoundedReturnPct"],
        item["largeWaveExcludedFull"]["compoundedReturnPct"],
        item["severeFull"]["maxDrawdownPct"],
        item["full"]["maxDrawdownPct"],
        item["full"]["compoundedReturnPct"],
        -item["diagnostics"]["normal"]["transitions"],
    )


def pareto(candidates: List[dict]) -> List[dict]:
    result = []
    for candidate in candidates:
        dominated = False
        for other in candidates:
            if other is candidate:
                continue
            no_worse = (
                other["full"]["compoundedReturnPct"] >= candidate["full"]["compoundedReturnPct"]
                and other["largeWaveExcludedFull"]["compoundedReturnPct"] >= candidate["largeWaveExcludedFull"]["compoundedReturnPct"]
                and other["full"]["maxDrawdownPct"] >= candidate["full"]["maxDrawdownPct"]
                and other["severeFull"]["maxDrawdownPct"] >= candidate["severeFull"]["maxDrawdownPct"]
            )
            strictly_better = (
                other["full"]["compoundedReturnPct"] > candidate["full"]["compoundedReturnPct"]
                or other["largeWaveExcludedFull"]["compoundedReturnPct"] > candidate["largeWaveExcludedFull"]["compoundedReturnPct"]
                or other["full"]["maxDrawdownPct"] > candidate["full"]["maxDrawdownPct"]
                or other["severeFull"]["maxDrawdownPct"] > candidate["severeFull"]["maxDrawdownPct"]
            )
            if no_worse and strictly_better:
                dominated = True
                break
        if not dominated:
            result.append(candidate)
    result.sort(key=rank_key, reverse=True)
    return result


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

    baseline = v70.evaluate(
        TARGET_V67_MAX_GROSS,
        pengu_rows,
        base_core_rows,
        severe_core_rows,
        overlap_start,
        overlap_end,
    )
    baseline_trades = v69.scale_trades(TARGET_V67_MAX_GROSS)
    baseline_series = v68.v67_series(pengu_rows, baseline_trades)
    baseline_rows, baseline_diag = v70.capped_combine(base_core_rows, baseline_series, "base")
    baseline_severe_rows, _ = v70.capped_combine(severe_core_rows, baseline_series, "severe")
    baseline["worstDrawdowns"] = drawdown_episodes([
        {
            **row,
            "coreReturn": float(base_core_rows[index]["return"]),
            "penguReturn": float(row["return"]) - float(base_core_rows[index]["return"]),
        }
        for index, row in enumerate(baseline_rows)
    ])
    baseline["worstSevereDrawdowns"] = drawdown_episodes([
        {
            **row,
            "coreReturn": float(severe_core_rows[index]["return"]),
            "penguReturn": float(row["return"]) - float(severe_core_rows[index]["return"]),
        }
        for index, row in enumerate(baseline_severe_rows)
    ])
    baseline["baselineCapDiagnostics"] = baseline_diag

    candidates = [
        evaluate(
            config,
            pengu_rows,
            base_core_rows,
            severe_core_rows,
            overlap_start,
            overlap_end,
            baseline,
        )
        for config in configs()
    ]
    strict = [item for item in candidates if item["strictPass"]]
    partial = [item for item in candidates if item["partialPass"]]
    pool = strict if strict else partial
    pool.sort(key=rank_key, reverse=True)
    selected = pool[0] if pool else None
    status = (
        "V71_DD_CONTROL_PASS"
        if strict and selected
        else "V71_DD_CONTROL_PARTIAL"
        if selected
        else "NO_V71_DD_CONTROL_CANDIDATE"
    )
    frontier = pareto(candidates)
    result = rounded({
        "version": 82,
        "strategyId": "V71_DRAWDOWN_CONTROL_V82",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": status,
        "targetV67MaxGross": TARGET_V67_MAX_GROSS,
        "candidateCount": len(candidates),
        "strictPassCount": len(strict),
        "partialPassCount": len(partial),
        "baselineV71": baseline,
        "selected": selected,
        "paretoFrontier": frontier[:30],
        "topCandidates": sorted(candidates, key=rank_key, reverse=True)[:30],
        "controlRule": {
            "decisionTiming": "Use the portfolio drawdown known before the current completed 12h bucket.",
            "stage1": "Scale Core first; keep PENGU at 90-100% to preserve wave capture.",
            "stage2": "Apply a deeper Core reduction and only moderate PENGU reduction.",
            "recovery": "Hysteresis buffer prevents repeated on/off switching near a threshold.",
            "grossCap": PORTFOLIO_GROSS_CAP,
            "secondStageGapPctPoints": SECOND_STAGE_GAP * 100.0,
        },
        "selectionRule": (
            "Primary: large-wave-excluded Severe and normal returns. "
            "Strict candidates must retain at least 85% of normal/excluded return, 65% of Severe returns, "
            "reduce normal DD to <=25% and Severe DD to <=42%, and keep concentration/Gross gates positive."
        ),
        "safety": {
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "ordersSent": False,
        },
        "limitations": [
            "The V71 trade sequence and Core history were already observed; this is a drawdown-control engineering study, not pristine new OOS evidence.",
            "The brake reacts to prior portfolio equity drawdown and does not use future prices or future large-wave labels.",
            "PENGU wave trades are not selectively identified in real time; PENGU is preserved through asymmetric sleeve scaling instead.",
        ],
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "v71-drawdown-control-v82.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    report = [
        "# V71 Drawdown Control V82",
        "",
        f"- Status: **{status}**",
        f"- Candidates: {len(candidates)} / strict {len(strict)} / partial {len(partial)}",
        f"- V71 baseline: {baseline['full']['compoundedReturnPct']}% / DD {baseline['full']['maxDrawdownPct']}%",
        f"- V71 baseline Severe: {baseline['severeFull']['compoundedReturnPct']}% / DD {baseline['severeFull']['maxDrawdownPct']}%",
        f"- Baseline waves excluded: {baseline['largeWaveExcludedFull']['compoundedReturnPct']}% / Severe {baseline['largeWaveExcludedSevereFull']['compoundedReturnPct']}%",
    ]
    if selected:
        report.extend([
            "",
            f"- Selected: **{selected['configId']}**",
            f"- Full: {selected['full']['compoundedReturnPct']}% / CAGR {selected['full']['cagrPct']}% / DD {selected['full']['maxDrawdownPct']}%",
            f"- Severe: {selected['severeFull']['compoundedReturnPct']}% / DD {selected['severeFull']['maxDrawdownPct']}%",
            f"- Waves excluded: {selected['largeWaveExcludedFull']['compoundedReturnPct']}% / Severe {selected['largeWaveExcludedSevereFull']['compoundedReturnPct']}%",
            f"- Return retention: full {selected['retention']['full']*100.0}% / excluded {selected['retention']['excluded']*100.0}%",
            f"- DD improvement: normal {selected['normalDdGainPctPoints']} points / Severe {selected['severeDdGainPctPoints']} points",
            f"- Stage usage: {selected['diagnostics']['normal']['stageBuckets']}",
            f"- Minimum PENGU clip ratio: {selected['diagnostics']['normal']['minimumClipRatio']}",
        ])
    report.extend(["", "- Production / LIVE / VPS changed: **NO**"])
    (state_dir / "v71-drawdown-control-v82.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
