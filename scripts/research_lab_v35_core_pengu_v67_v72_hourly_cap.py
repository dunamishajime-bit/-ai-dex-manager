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
BUCKET = 12 * HOUR
PORTFOLIO_GROSS_CAP = 2.0
TARGET_LEVELS = tuple(round(1.00 + 0.05 * index, 2) for index in range(13))


def trade_target(trade: dict, target_field: str) -> float:
    return float(trade[target_field]) / 100.0


def original_field(target_field: str) -> str:
    return "severe_pct" if "severe" in target_field.lower() else "base_pct"


def hourly_trade_path(
    rows_by_ts: Dict[int, dict],
    trade: dict,
    target_field: str,
) -> Dict[int, float]:
    target = trade_target(trade, target_field)
    original = float(trade[original_field(target_field)]) / 100.0
    if target == 0.0 and original > 0.0:
        return {}

    increments: Dict[int, float] = {}
    gross_sum = 0.0
    for gross, artifact_entry_price, leg_start in v68.trade_legs(trade):
        gross = float(gross)
        if gross <= 0:
            continue
        fetched_entry = v68.price_at_open(rows_by_ts, int(leg_start), float(artifact_entry_price))
        entry_price = fetched_entry if fetched_entry > 0 else float(artifact_entry_price)
        current = entry_price
        ts = int(leg_start)
        while ts < int(trade["exit_ts"]):
            next_ts = min(ts + HOUR, int(trade["exit_ts"]))
            end_price = v68.price_at_open(rows_by_ts, next_ts, current)
            value = gross * int(trade["side"]) * (end_price - current) / entry_price
            increments[ts] = increments.get(ts, 0.0) + value
            gross_sum += value
            current = end_price
            ts = next_ts

    final_hour = int(trade["exit_ts"]) - HOUR
    increments[final_hour] = increments.get(final_hour, 0.0) + (target - gross_sum)
    return increments


def hourly_exposure(trade: dict) -> Dict[int, float]:
    exposure: Dict[int, float] = {}
    ts = int(trade["entry_ts"])
    while ts < int(trade["exit_ts"]):
        if trade.get("add_ts") is not None and ts < int(trade["add_ts"]):
            gross = float(trade["probe_gross"])
        else:
            gross = float(trade["total_gross"])
        exposure[ts] = exposure.get(ts, 0.0) + gross
        ts += HOUR
    return exposure


def hourly_penguin_series(
    rows: List[dict],
    trades: List[dict],
    target_field: str,
) -> Tuple[Dict[int, float], Dict[int, float], dict]:
    rows_by_ts = {int(row["ts"]): row for row in rows}
    pnl: Dict[int, float] = {}
    exposure: Dict[int, float] = {}
    trade_target_sum = 0.0
    for trade in trades:
        trade_target_sum += trade_target(trade, target_field)
        for ts, value in hourly_trade_path(rows_by_ts, trade, target_field).items():
            pnl[ts] = pnl.get(ts, 0.0) + value
        for ts, value in hourly_exposure(trade).items():
            exposure[ts] = exposure.get(ts, 0.0) + value
    diagnostics = {
        "tradeTargetSumPct": trade_target_sum * 100.0,
        "hourlyPathSumPct": sum(pnl.values()) * 100.0,
        "pathResidualPct": (sum(pnl.values()) - trade_target_sum) * 100.0,
        "maxRawHourlyReturnPct": max((abs(value) * 100.0 for value in pnl.values()), default=0.0),
        "maxRawHourlyExposure": max(exposure.values(), default=0.0),
        "activeHours": len(exposure),
    }
    if abs(diagnostics["pathResidualPct"]) > 1e-7:
        raise RuntimeError(
            f"Hourly PENGU path reconciliation failed: {diagnostics['pathResidualPct']:.10f}%"
        )
    return pnl, exposure, diagnostics


def hourly_capped_combine(
    core_rows: List[dict],
    pengu_rows: List[dict],
    trades: List[dict],
    target_field: str,
) -> Tuple[List[dict], dict]:
    pnl, exposure, path_diagnostics = hourly_penguin_series(
        pengu_rows, trades, target_field
    )
    result: List[dict] = []
    active_ratios: List[float] = []
    clipped_hours = 0
    active_hours = 0
    capped_pengu_return = 0.0
    raw_pengu_return = 0.0

    for row in core_rows:
        bucket = int(row["ts"])
        core_gross = float(row["gross"])
        bucket_return = 0.0
        bucket_exposures: List[float] = []
        for offset in range(12):
            ts = bucket + offset * HOUR
            p_exposure = float(exposure.get(ts, 0.0))
            p_return = float(pnl.get(ts, 0.0))
            raw_pengu_return += p_return
            if p_exposure <= 0:
                ratio = 1.0
                capped_exposure = 0.0
            else:
                capacity = max(0.0, PORTFOLIO_GROSS_CAP - core_gross)
                ratio = min(1.0, capacity / p_exposure)
                capped_exposure = p_exposure * ratio
                active_hours += 1
                active_ratios.append(ratio)
                if ratio < 1.0 - 1e-12:
                    clipped_hours += 1
            scaled_return = p_return * ratio
            capped_pengu_return += scaled_return
            bucket_return += scaled_return
            bucket_exposures.append(capped_exposure)
        result.append({
            "ts": bucket,
            "return": float(row["return"]) + bucket_return,
            "gross": core_gross + statistics.fmean(bucket_exposures),
            "maxGross": core_gross + max(bucket_exposures, default=0.0),
        })

    diagnostics = {
        "activeHours": active_hours,
        "clippedHours": clipped_hours,
        "clipRatePct": clipped_hours / active_hours * 100.0 if active_hours else 0.0,
        "minimumClipRatio": min(active_ratios) if active_ratios else 1.0,
        "averageClipRatio": statistics.fmean(active_ratios) if active_ratios else 1.0,
        "rawPenguReturnSumPct": raw_pengu_return * 100.0,
        "cappedPenguReturnSumPct": capped_pengu_return * 100.0,
        "retainedPnlPct": (
            capped_pengu_return / raw_pengu_return * 100.0
            if raw_pengu_return > 0 else None
        ),
        "path": path_diagnostics,
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
    combined, normal_cap = hourly_capped_combine(
        base_core_rows, pengu_rows, trades, "base_pct"
    )
    combined_severe, severe_cap = hourly_capped_combine(
        severe_core_rows, pengu_rows, trades, "severe_pct"
    )
    excluded, excluded_cap = hourly_capped_combine(
        base_core_rows, pengu_rows, trades, "excluded_base_pct"
    )
    excluded_severe, excluded_severe_cap = hourly_capped_combine(
        severe_core_rows, pengu_rows, trades, "excluded_severe_pct"
    )

    no_best_trades = v69.remove_best_trade(trades)
    no_month_trades = v69.remove_best_month(trades)
    no_best, _ = hourly_capped_combine(
        base_core_rows, pengu_rows, no_best_trades, "base_pct"
    )
    no_best_severe, _ = hourly_capped_combine(
        severe_core_rows, pengu_rows, no_best_trades, "severe_pct"
    )
    no_month, _ = hourly_capped_combine(
        base_core_rows, pengu_rows, no_month_trades, "base_pct"
    )
    no_month_severe, _ = hourly_capped_combine(
        severe_core_rows, pengu_rows, no_month_trades, "severe_pct"
    )

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
        and normal_cap["minimumClipRatio"] >= 0.50
        and normal_cap["averageClipRatio"] >= 0.85
    )
    return {
        "targetV67MaxGross": target_level,
        "passed": passed,
        "capDiagnostics": {
            "normal": normal_cap,
            "severe": severe_cap,
            "excluded": excluded_cap,
            "excludedSevere": excluded_severe_cap,
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
    status = "HOURLY_DYNAMIC_CAP_PASS" if selected else "NO_ROBUST_HOURLY_DYNAMIC_CAP"

    result = rounded({
        "version": 72,
        "strategyId": "V35_CORE_PLUS_PENGU_V67_HOURLY_DYNAMIC_CAP",
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
            "For every PENGU-active hour, scale that hour's PENGU PnL and exposure by "
            "min(1, (2.0 - Core 12h Gross) / PENGU hourly exposure), then aggregate to 12h."
        ),
        "selectionGates": {
            "minimumHourlyClipRatio": 0.50,
            "minimumAverageClipRatio": 0.85,
            "standaloneSevereDdPct": -16.0,
            "portfolioNormalDdPct": -35.0,
            "portfolioSevereDdPct": -55.0,
        },
        "safety": {
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "ordersSent": False,
        },
        "limitations": [
            "Hourly dynamic sizing uses an already observed V67 trade sequence and is not pristine new out-of-sample evidence.",
            "Core Gross is constant inside each 12-hour Core bucket; PENGU exposure and PnL are evaluated hourly.",
            "Funding and execution-cost residuals are reconciled in each trade's final hour.",
        ],
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "v35-core-pengu-v67-v72-hourly-cap.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    if selected:
        cap = selected["capDiagnostics"]["normal"]
        report = [
            "# V35 Core + PENGU V67 V72 Hourly Dynamic Cap",
            "",
            f"- Status: **{status}**",
            f"- Selected target V67 max Gross: **{selected['targetV67MaxGross']}**",
            f"- Observed max concurrent Gross: {selected['full']['observedMaxConcurrentGross']}",
            f"- Clipped hours: {cap['clippedHours']} / {cap['activeHours']}",
            f"- Minimum hourly clip ratio: {cap['minimumClipRatio']}",
            f"- Average hourly clip ratio: {cap['averageClipRatio']}",
            f"- Retained PENGU PnL: {cap['retainedPnlPct']}%",
            f"- Full: {selected['full']['compoundedReturnPct']}% / CAGR {selected['full']['cagrPct']}% / DD {selected['full']['maxDrawdownPct']}%",
            f"- Severe: {selected['severeFull']['compoundedReturnPct']}% / DD {selected['severeFull']['maxDrawdownPct']}%",
            f"- Large-wave profits excluded: {selected['largeWaveExcludedFull']['compoundedReturnPct']}%",
            f"- Excluded Severe: {selected['largeWaveExcludedSevereFull']['compoundedReturnPct']}%",
            f"- Remove best trade Severe: {selected['removeBestTradeSevere']['compoundedReturnPct']}%",
            f"- Remove best month Severe: {selected['removeBestMonthSevere']['compoundedReturnPct']}%",
            f"- V67 standalone Severe DD: {selected['v67StandaloneSevere']['maxDrawdownPct']}%",
            f"- Increment vs Core: {selected['full']['compoundedReturnPct'] - core_full['compoundedReturnPct']} percentage points",
            "",
            "- Production / LIVE / VPS changed: **NO**",
        ]
    else:
        report = [
            "# V35 Core + PENGU V67 V72 Hourly Dynamic Cap",
            "",
            f"- Status: **{status}**",
            "- No target level passed every hourly and portfolio risk gate.",
            "- Production / LIVE / VPS changed: **NO**",
        ]
    (state_dir / "v35-core-pengu-v67-v72-hourly-cap.md").write_text(
        "\n".join(report), encoding="utf-8"
    )
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
