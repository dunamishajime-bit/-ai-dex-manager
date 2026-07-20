from __future__ import annotations

import datetime as dt
import json
import os
import statistics
from copy import deepcopy
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, List, Optional, Sequence

import research_lab_major_core_nested_v73 as major
import research_lab_pengu_wave_sleeve_v47 as v47
import research_lab_pengu_wave_sleeve_v50 as v50

HOUR = 3_600_000
BAR = 12 * HOUR
TOTAL_GROSS_CAP = 2.0


@dataclass(frozen=True)
class BalanceConfig:
    long_scale: float
    short_scale: float
    dd_brake_start: Optional[float]

    @property
    def config_id(self) -> str:
        dd = 0 if self.dd_brake_start is None else int(self.dd_brake_start * 100)
        return f"L{int(self.long_scale*100)}_S{int(self.short_scale*100)}_DD{dd}"


def balance_space() -> List[BalanceConfig]:
    return [
        BalanceConfig(long_scale, short_scale, dd)
        for long_scale in (0.0, 0.5, 1.0)
        for short_scale in (0.5, 0.75, 1.0)
        for dd in (None, 0.15, 0.20)
    ]


def rescale_trade(trade: dict, scale: float, fields: Sequence[str]) -> dict:
    result = deepcopy(trade)
    for key in ("probe_gross", "add_gross", "total_gross"):
        result[key] = float(result.get(key, 0.0) or 0.0) * scale
    for field in fields:
        if field in result:
            result[field] = float(result[field]) * scale
    return result


def overlaps(left: dict, right: dict) -> bool:
    return int(left["entry_ts"]) < int(right["exit_ts"]) and int(right["entry_ts"]) < int(left["exit_ts"])


def combine_pengu_trades(long_trades: List[dict], short_trades: List[dict]) -> List[dict]:
    candidates = [
        (int(trade["entry_ts"]), 0 if int(trade["side"]) < 0 else 1, trade)
        for trade in [*short_trades, *long_trades]
    ]
    candidates.sort(key=lambda item: (item[0], item[1]))
    selected: List[dict] = []
    for _, _, trade in candidates:
        if any(overlaps(trade, existing) for existing in selected):
            continue
        selected.append(trade)
    return sorted(selected, key=lambda trade: int(trade["entry_ts"]))


def event_overlap(trade: dict, event: dict) -> bool:
    return (
        int(trade["side"]) == int(event["side"])
        and int(trade["entry_ts"]) < int(event["endTs"])
        and int(trade["exit_ts"]) > int(event["startTs"])
    )


def add_long_exclusions(long_trades: List[dict], pengu_rows: List[dict]) -> List[dict]:
    events = [*v50.wave_events(pengu_rows, 24, 20.0), *v50.wave_events(pengu_rows, 72, 35.0)]
    result = []
    for trade in long_trades:
        item = deepcopy(trade)
        hit = any(event_overlap(item, event) for event in events)
        item["excluded_base_pct"] = 0.0 if float(item["base_pct"]) > 0 and hit else float(item["base_pct"])
        item["excluded_severe_pct"] = 0.0 if float(item["severe_pct"]) > 0 and hit else float(item["severe_pct"])
        result.append(item)
    return result


def trade_hourly_path(trade: dict, candles: Dict[int, dict], field: str) -> Dict[int, float]:
    entry = int(trade["entry_ts"])
    exit_ts = int(trade["exit_ts"])
    add_ts = int(trade["add_ts"]) if trade.get("add_ts") is not None else None
    side = int(trade["side"])
    values: Dict[int, float] = {}
    equity = 1.0
    ts = entry
    while ts < exit_ts:
        candle = candles.get(ts)
        if candle is None:
            ts += HOUR
            continue
        gross = (
            float(trade.get("probe_gross", 0.0) or 0.0)
            if add_ts is not None and ts < add_ts
            else float(trade.get("total_gross", 0.0) or 0.0)
        )
        hourly = gross * side * (float(candle["close"]) / float(candle["open"]) - 1.0)
        values[ts] = hourly
        equity *= max(0.001, 1.0 + hourly)
        ts += HOUR
    target = float(trade[field]) / 100.0
    residual = (1.0 + target) / max(0.001, equity) - 1.0
    residual_ts = max(entry, exit_ts - HOUR)
    values[residual_ts] = values.get(residual_ts, 0.0) + residual
    return values


def pengu_series(pengu_rows: List[dict], trades: List[dict]) -> Dict[int, dict]:
    candles = {int(row["ts"]): row for row in pengu_rows}
    result: Dict[int, dict] = {}
    exposure_slots: Dict[int, Dict[int, float]] = {}
    field_map = {
        "base": "base_pct",
        "severe": "severe_pct",
        "excludedBase": "excluded_base_pct",
        "excludedSevere": "excluded_severe_pct",
    }
    for trade in trades:
        for output_field, trade_field in field_map.items():
            path = trade_hourly_path(trade, candles, trade_field)
            buckets: Dict[int, List[float]] = {}
            for ts, value in path.items():
                buckets.setdefault(ts // BAR * BAR, []).append(value)
            for bucket, values in buckets.items():
                item = result.setdefault(bucket, {
                    "base": 0.0,
                    "severe": 0.0,
                    "excludedBase": 0.0,
                    "excludedSevere": 0.0,
                    "maxExposure": 0.0,
                    "averageExposure": 0.0,
                })
                item[output_field] += major.product(values)
        ts = int(trade["entry_ts"])
        while ts < int(trade["exit_ts"]):
            gross_value = (
                float(trade.get("probe_gross", 0.0) or 0.0)
                if trade.get("add_ts") is not None and ts < int(trade["add_ts"])
                else float(trade.get("total_gross", 0.0) or 0.0)
            )
            bucket = ts // BAR * BAR
            slot = int((ts - bucket) // HOUR)
            exposure_slots.setdefault(bucket, {})[slot] = gross_value
            ts += HOUR
    for bucket, slots in exposure_slots.items():
        item = result.setdefault(bucket, {
            "base": 0.0,
            "severe": 0.0,
            "excludedBase": 0.0,
            "excludedSevere": 0.0,
            "maxExposure": 0.0,
            "averageExposure": 0.0,
        })
        values = [float(slots.get(index, 0.0)) for index in range(12)]
        item["maxExposure"] = max(values, default=0.0)
        item["averageExposure"] = statistics.fmean(values) if values else 0.0
    return result


def combine_rows(core_rows: List[dict], pengu: Dict[int, dict], field: str, config: BalanceConfig) -> List[dict]:
    result = []
    equity = peak = 1.0
    for row in core_rows:
        ts = int(row["ts"])
        p = pengu.get(ts, {field: 0.0, "maxExposure": 0.0, "averageExposure": 0.0})
        core_scale = pengu_scale = 1.0
        drawdown = equity / peak - 1.0
        if config.dd_brake_start is not None:
            if drawdown <= -config.dd_brake_start - 0.08:
                core_scale, pengu_scale = 0.65, 0.35
            elif drawdown <= -config.dd_brake_start:
                core_scale, pengu_scale = 0.85, 0.60
        core_gross = float(row["gross"]) * core_scale
        p_max = float(p.get("maxExposure", 0.0)) * pengu_scale
        p_avg = float(p.get("averageExposure", 0.0)) * pengu_scale
        allowed = max(0.0, TOTAL_GROSS_CAP - core_gross)
        cap = min(1.0, allowed / p_max) if p_max > 0 else 1.0
        value = float(row["return"]) * core_scale + float(p.get(field, 0.0)) * pengu_scale * cap
        result.append({
            "ts": ts,
            "return": value,
            "gross": core_gross + p_avg * cap,
            "maxGross": core_gross + p_max * cap,
            "coreScale": core_scale,
            "penguScale": pengu_scale * cap,
        })
        equity *= max(0.001, 1.0 + value)
        peak = max(peak, equity)
    return result


def metrics(rows: Sequence[dict], start: int, end: int) -> dict:
    base = major.metrics(rows, start, end)
    active = [row for row in rows if start <= int(row["ts"]) < end]
    base["observedMaxConcurrentGross"] = max(
        (float(row.get("maxGross", row["gross"])) for row in active), default=0.0
    )
    base["averagePenguScale"] = statistics.fmean(
        float(row.get("penguScale", 0.0)) for row in active
    ) if active else 0.0
    base["minimumActivePenguScale"] = min(
        (float(row.get("penguScale", 0.0)) for row in active if float(row.get("penguScale", 0.0)) > 0),
        default=0.0,
    )
    return base


def zero_best_trade(trades: List[dict], fields: Sequence[str]) -> tuple[List[dict], dict]:
    best = max(trades, key=lambda trade: float(trade["base_pct"]))
    result = []
    for trade in trades:
        item = deepcopy(trade)
        if int(item["entry_ts"]) == int(best["entry_ts"]):
            for field in fields:
                item[field] = 0.0
        result.append(item)
    return result, best


def zero_best_month(trades: List[dict], fields: Sequence[str]) -> tuple[List[dict], str]:
    months: Dict[str, List[dict]] = {}
    for trade in trades:
        month = dt.datetime.fromtimestamp(int(trade["entry_ts"]) / 1000, tz=dt.timezone.utc).strftime("%Y-%m")
        months.setdefault(month, []).append(trade)
    def month_value(month: str) -> float:
        return major.product(float(trade["base_pct"]) / 100.0 for trade in months[month])
    best_month = max(months, key=month_value)
    result = []
    for trade in trades:
        item = deepcopy(trade)
        month = dt.datetime.fromtimestamp(int(item["entry_ts"]) / 1000, tz=dt.timezone.utc).strftime("%Y-%m")
        if month == best_month:
            for field in fields:
                item[field] = 0.0
        result.append(item)
    return result, best_month


def trade_metrics(trades: Sequence[dict], field: str) -> dict:
    values = [float(trade[field]) / 100.0 for trade in trades]
    equity = peak = 1.0
    max_dd = 0.0
    for value in values:
        equity *= max(0.001, 1.0 + value)
        peak = max(peak, equity)
        max_dd = min(max_dd, equity / peak - 1.0)
    return {
        "trades": len(values),
        "compoundedReturnPct": (equity - 1.0) * 100.0,
        "maxDrawdownPct": max_dd * 100.0,
        "profitFactor": major.profit_factor(values),
        "winRatePct": sum(value > 0 for value in values) / len(values) * 100.0 if values else None,
    }


def rounded(value):
    return major.rounded(value)


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    major_payload = json.loads((state_dir / "major-core-nested-v73.json").read_text(encoding="utf-8"))
    v57_payload = json.loads((state_dir / "pengu-wave-sleeve-v57.json").read_text(encoding="utf-8"))
    v67_payload = json.loads((state_dir / "pengu-v67-distribution-floor.json").read_text(encoding="utf-8"))

    bars, funding, times, _coverage = major.fetch_data()
    features = major.build_features(bars)
    signal_members = [major.SignalConfig(**item) for item in major_payload["selectedSignalMembers"]]
    risk = major.RiskConfig(**major_payload["selectedRisk"])
    targets = major.average_targets(
        [major.signal_targets(config, bars, times, features) for config in signal_members], times
    )
    core_normal = major.simulate(targets, risk, bars, features, funding, times, False)
    core_severe = major.simulate(targets, risk, bars, features, funding, times, True)

    end = times[-1] + BAR
    original_start = v47.START
    v47.START = int(dt.datetime(2024, 1, 1, tzinfo=dt.timezone.utc).timestamp() * 1000)
    pengu_rows = v47.fetch_klines("PENGUUSDT", end)
    v47.START = original_start

    confirmed_long = [trade for trade in v57_payload["longTrades"] if bool(trade.get("confirmed"))]
    confirmed_long = add_long_exclusions(confirmed_long, pengu_rows)
    v67_short = [deepcopy(trade) for trade in v67_payload["aster"]["trades"]]
    for trade in v67_short:
        trade.setdefault("excluded_base_pct", trade.get("base_pct", 0.0))
        trade.setdefault("excluded_severe_pct", trade.get("severe_pct", 0.0))

    full_start, full_end = times[0], end
    holdout_start = int(dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc).timestamp() * 1000)
    fields = ("base_pct", "severe_pct", "excluded_base_pct", "excluded_severe_pct")
    candidate_results = {}
    for config in balance_space():
        long_scaled = [rescale_trade(trade, config.long_scale, fields) for trade in confirmed_long]
        short_scaled = [rescale_trade(trade, config.short_scale, fields) for trade in v67_short]
        trades = combine_pengu_trades(long_scaled, short_scaled)
        series = pengu_series(pengu_rows, trades)
        normal = combine_rows(core_normal, series, "base", config)
        severe = combine_rows(core_severe, series, "severe", config)
        excluded = combine_rows(core_normal, series, "excludedBase", config)
        excluded_severe = combine_rows(core_severe, series, "excludedSevere", config)
        candidate_results[config.config_id] = {
            "config": asdict(config),
            "full": metrics(normal, full_start, full_end),
            "fullSevere": metrics(severe, full_start, full_end),
            "excluded": metrics(excluded, full_start, full_end),
            "excludedSevere": metrics(excluded_severe, full_start, full_end),
            "holdout": metrics(normal, holdout_start, full_end),
            "holdoutSevere": metrics(severe, holdout_start, full_end),
            "holdoutExcluded": metrics(excluded, holdout_start, full_end),
            "holdoutExcludedSevere": metrics(excluded_severe, holdout_start, full_end),
            "trades": trades,
        }

    core_full = metrics(core_normal, full_start, full_end)
    core_full_severe = metrics(core_severe, full_start, full_end)
    passed = []
    for config_id, item in candidate_results.items():
        if (
            item["full"]["compoundedReturnPct"] > core_full["compoundedReturnPct"]
            and item["excluded"]["compoundedReturnPct"] >= core_full["compoundedReturnPct"]
            and item["fullSevere"]["compoundedReturnPct"] > 0
            and item["excludedSevere"]["compoundedReturnPct"] > 0
            and item["full"]["maxDrawdownPct"] >= core_full["maxDrawdownPct"] - 2.0
            and item["full"]["observedMaxConcurrentGross"] <= TOTAL_GROSS_CAP + 1e-9
            and item["holdout"]["compoundedReturnPct"] > 0
            and item["holdoutSevere"]["compoundedReturnPct"] >= 0
            and item["holdoutExcluded"]["compoundedReturnPct"] >= 0
            and item["holdoutExcludedSevere"]["compoundedReturnPct"] >= 0
        ):
            passed.append(config_id)
    passed.sort(key=lambda key: (
        candidate_results[key]["excludedSevere"]["compoundedReturnPct"],
        candidate_results[key]["excluded"]["compoundedReturnPct"],
        candidate_results[key]["fullSevere"]["compoundedReturnPct"],
        candidate_results[key]["full"]["compoundedReturnPct"],
        candidate_results[key]["full"]["maxDrawdownPct"],
        -candidate_results[key]["config"]["long_scale"],
        -candidate_results[key]["config"]["short_scale"],
    ), reverse=True)
    selected_id = passed[0] if passed else None
    selected = candidate_results[selected_id] if selected_id else None

    concentration = None
    if selected:
        config = BalanceConfig(**selected["config"])
        trades = selected["trades"]
        without_best, best_trade = zero_best_trade(trades, fields)
        without_month, best_month = zero_best_month(trades, fields)
        def scenario(trade_rows: List[dict]) -> dict:
            series = pengu_series(pengu_rows, trade_rows)
            return {
                "full": metrics(combine_rows(core_normal, series, "base", config), full_start, full_end),
                "severe": metrics(combine_rows(core_severe, series, "severe", config), full_start, full_end),
                "excluded": metrics(combine_rows(core_normal, series, "excludedBase", config), full_start, full_end),
                "excludedSevere": metrics(combine_rows(core_severe, series, "excludedSevere", config), full_start, full_end),
            }
        concentration = {
            "removeBestTrade": {"trade": best_trade, "result": scenario(without_best)},
            "removeBestMonth": {"month": best_month, "result": scenario(without_month)},
        }

    status = "BALANCED_FULL_PASS" if selected else "NO_BALANCED_PORTFOLIO"
    result = rounded({
        "version": 74,
        "strategyId": "MAJOR_CORE_PLUS_PENGU_BALANCED_V74",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": status,
        "selected": selected_id,
        "majorCoreRobustPass": major_payload.get("robustPass", False),
        "majorCore": {"full": core_full, "fullSevere": core_full_severe},
        "pengu": {
            "longRule": "V57 confirmed Long only; max 0.15 gross before balance scaling; no probe-only trades.",
            "shortRule": "V67 Distribution Floor: 0.10 floor / 0.30 high gross before balance scaling; Short priority.",
            "longConfirmedTrades": len(confirmed_long),
            "shortV67Trades": len(v67_short),
            "longStandalone": trade_metrics(confirmed_long, "base_pct"),
            "shortStandalone": trade_metrics(v67_short, "base_pct"),
        },
        "candidateCount": len(candidate_results),
        "passed": passed,
        "selectedResult": selected,
        "concentrationStress": concentration,
        "riskSpecification": {
            "portfolioGrossCap": TOTAL_GROSS_CAP,
            "cashReservePct": major.CASH_RESERVE * 100.0,
            "core": major_payload["riskSpecification"],
            "penguLong": {
                "signal": "V57 one-hour Washout/Break Long, confirmed entries only.",
                "baseMaxGross": 0.15,
                "probeOnly": "DISABLED",
                "extremeConfirmedEntry": "0.05 probe plus 0.10 add after confirmation; never left as unconfirmed probe.",
                "stop": "FAST profile: 1.2 ATR hard stop, 2.0 ATR partial take-profit, 1.8 ATR trail, 24h maximum hold.",
                "funding": "Long fails closed if funding is unavailable or above the configured cap.",
            },
            "penguShort": {
                "signal": "V67 Flash and Distribution Short; Short priority over Long conflicts.",
                "baseGross": "0.10 Distribution floor, 0.30 qualifying Distribution/Flash.",
                "stop": "Flash: 3.5 ATR hard stop, 36h hold/delayed trail. Distribution: 2.5 ATR hard stop, 24h hold/delayed trail.",
                "funding": "Short remains funding-independent.",
            },
            "portfolioDrawdownBrake": "At selected DD threshold, Core scales to 0.85 and PENGU to 0.60; an additional 8% DD scales to 0.65/0.35.",
            "grossPriority": "Core receives capacity first; PENGU is clipped to keep observed concurrent Gross <=2.0.",
            "reversal": "PENGU Long and Short never overlap; Short has priority. Production reversal must close reduce-only and open opposite side on the next tick.",
        },
        "validation": {
            "largeWaveIncludedAndExcludedBothReported": True,
            "selectionPriority": "Large-wave-excluded Severe, then large-wave-excluded normal, then full Severe and drawdown.",
            "futureFreeze": major_payload["forwardFreeze"],
        },
        "safety": {"productionChanged": False, "liveChanged": False, "vpsChanged": False, "ordersSent": False},
        "limitations": [
            "PENGU Long V57 and Short V67 are historical research candidates, not pristine forward evidence.",
            "The important robustness metric is the large-wave-excluded result; large-wave capture is retained as a separate upside sleeve.",
            "Promotion requires the V73 forward-freeze period and operational implementation review by Codex.",
        ],
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "major-pengu-balanced-v74.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    report = [
        "# Major Core + PENGU Balanced V74",
        "",
        f"- Status: **{status}**",
        f"- Selected: **{selected_id or 'NONE'}**",
        f"- Major Core robust pass: **{'YES' if result['majorCoreRobustPass'] else 'NO'}**",
        f"- Major Core: {core_full['compoundedReturnPct']}% / Severe {core_full_severe['compoundedReturnPct']}% / DD {core_full['maxDrawdownPct']}%",
    ]
    if selected:
        report.extend([
            f"- Combined full: {selected['full']['compoundedReturnPct']}% / CAGR {selected['full']['cagrPct']}% / DD {selected['full']['maxDrawdownPct']}%",
            f"- Combined Severe: {selected['fullSevere']['compoundedReturnPct']}% / DD {selected['fullSevere']['maxDrawdownPct']}%",
            f"- Large-wave excluded: {selected['excluded']['compoundedReturnPct']}%",
            f"- Large-wave excluded Severe: {selected['excludedSevere']['compoundedReturnPct']}%",
            f"- Holdout: {selected['holdout']['compoundedReturnPct']}% / Severe {selected['holdoutSevere']['compoundedReturnPct']}%",
            f"- Holdout waves excluded: {selected['holdoutExcluded']['compoundedReturnPct']}% / Severe {selected['holdoutExcludedSevere']['compoundedReturnPct']}%",
            f"- Observed max Gross: {selected['full']['observedMaxConcurrentGross']}",
        ])
    report.extend(["", "- Production / LIVE / VPS changed: **NO**"])
    (state_dir / "major-pengu-balanced-v74.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
