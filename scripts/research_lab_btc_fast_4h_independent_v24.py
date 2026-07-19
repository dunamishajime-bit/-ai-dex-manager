from __future__ import annotations

import datetime as dt
import json
import os
import statistics
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

import research_lab_parameter_bagged_rotation_v4 as v4
import research_lab_precomputed_multi_regime_v6 as v6
import research_lab_fixed_candidate_robustness_v7 as v7
import research_lab_btc_variable_leverage_v21 as v21


FOUR_HOURS = 4 * v4.HOUR


@dataclass(frozen=True)
class Logic4H:
    logic_id: str
    family: str
    fast_days: int = 0
    slow_days: int = 0
    momentum_days: int = 0
    shock_exit_pct: float = -3.0
    breakout_days: int = 0
    exit_days: int = 0
    confirm_bars: int = 1
    long_gross: float = 0.75
    short_gross: float = 0.0


@dataclass(frozen=True)
class Scenario4H:
    scenario_id: str
    cost_bps_per_side: float
    extra_delay_bars: int
    adverse_funding_bps_per_12h: float


def scenarios() -> List[Scenario4H]:
    return [
        Scenario4H("BASE_10BPS_4H", 10, 0, 0),
        Scenario4H("COST30_4H", 30, 0, 0),
        Scenario4H("DELAY8H", 10, 1, 0),
        Scenario4H("SEVERE_50BPS_DELAY8H_FUND3", 50, 1, 3),
    ]


def resample_4h(candles: List[dict]) -> List[dict]:
    groups: Dict[int, List[dict]] = {}
    for candle in candles:
        bucket = int(int(candle["ts"]) // FOUR_HOURS * FOUR_HOURS)
        groups.setdefault(bucket, []).append(candle)
    rows: List[dict] = []
    for ts, items in sorted(groups.items()):
        items = sorted(items, key=lambda item: int(item["ts"]))
        if len(items) != 4:
            continue
        rows.append({
            "ts": ts,
            "open": float(items[0]["open"]),
            "high": max(float(item["high"]) for item in items),
            "low": min(float(item["low"]) for item in items),
            "close": float(items[-1]["close"]),
            "volume": sum(float(item.get("volume", 0)) for item in items),
        })
    return rows


def funding_buckets_4h(points: List[dict]) -> Dict[int, float]:
    result: Dict[int, float] = {}
    for point in points:
        ts = int(point["ts"])
        bucket = ts // FOUR_HOURS * FOUR_HOURS
        result[bucket] = result.get(bucket, 0.0) + float(point["rate"]) * 100.0
    return result


def prior_extreme(rows: List[dict], index: int, length: int, field: str) -> Optional[float]:
    start = index - length
    if start < 0:
        return None
    values = [float(row[field]) for row in rows[start:index]]
    if not values:
        return None
    return max(values) if field == "high" else min(values)


def logic_targets(logic: Logic4H, times: List[int], rows: List[dict], index_map: Dict[int, int]) -> Dict[int, Dict[str, float]]:
    result: Dict[int, Dict[str, float]] = {}
    state = 0
    pending_sign = 0
    pending_count = 0
    bars_per_day = 6

    for ts in times:
        index = index_map.get(ts)
        if index is None:
            result[ts] = {}
            continue
        close = float(rows[index]["close"])
        raw = 0
        long_exit = False
        short_exit = False

        if logic.family == "FAST_SMA_SHOCK":
            fast = v4.sma(rows, index, logic.fast_days * bars_per_day)
            slow = v4.sma(rows, index, logic.slow_days * bars_per_day)
            momentum = v4.momentum(rows, index, logic.momentum_days * bars_per_day)
            one_day = v4.momentum(rows, index, bars_per_day)
            if fast is None or slow is None or momentum is None or one_day is None:
                result[ts] = {"BTC": logic.long_gross} if state > 0 else {"BTC": -logic.short_gross} if state < 0 and logic.short_gross > 0 else {}
                continue
            raw = 1 if close > fast > slow and momentum > 0 else -1 if close < fast < slow and momentum < 0 else 0
            long_exit = close < fast or one_day <= logic.shock_exit_pct
            short_exit = close > fast or one_day >= abs(logic.shock_exit_pct)
        elif logic.family == "BREAKOUT_4H":
            upper = prior_extreme(rows, index, logic.breakout_days * bars_per_day, "high")
            lower = prior_extreme(rows, index, logic.breakout_days * bars_per_day, "low")
            exit_low = prior_extreme(rows, index, logic.exit_days * bars_per_day, "low")
            exit_high = prior_extreme(rows, index, logic.exit_days * bars_per_day, "high")
            if upper is None or lower is None or exit_low is None or exit_high is None:
                result[ts] = {"BTC": logic.long_gross} if state > 0 else {"BTC": -logic.short_gross} if state < 0 and logic.short_gross > 0 else {}
                continue
            raw = 1 if close > upper else -1 if close < lower else 0
            long_exit = close < exit_low
            short_exit = close > exit_high
        else:
            raise ValueError(logic.family)

        if state > 0 and long_exit:
            state = 0
        elif state < 0 and short_exit:
            state = 0

        if raw != 0:
            if raw == pending_sign:
                pending_count += 1
            else:
                pending_sign = raw
                pending_count = 1
            if pending_count >= logic.confirm_bars:
                state = raw
        else:
            pending_sign = 0
            pending_count = 0

        if state > 0:
            result[ts] = {"BTC": logic.long_gross}
        elif state < 0 and logic.short_gross > 0:
            result[ts] = {"BTC": -logic.short_gross}
        else:
            result[ts] = {}
    return result


def logic_grid() -> List[Logic4H]:
    result: List[Logic4H] = []
    for fast in [3, 5, 7, 10]:
        for slow in [15, 30, 60]:
            if fast >= slow:
                continue
            for momentum in [1, 3, 5, 10]:
                for shock in [-2.0, -4.0, -6.0]:
                    for confirm in [1, 2]:
                        for long_gross in [0.5, 0.75, 1.0]:
                            for short_gross in [0.0, 0.25]:
                                logic_id = f"S4_F{fast}_S{slow}_M{momentum}_X{abs(int(shock))}_Q{confirm}_L{long_gross}_H{short_gross}"
                                result.append(Logic4H(logic_id, "FAST_SMA_SHOCK", fast, slow, momentum, shock, 0, 0, confirm, long_gross, short_gross))
    for breakout in [5, 10, 20, 30]:
        for exit_days in [2, 5, 10]:
            if exit_days >= breakout:
                continue
            for confirm in [1, 2]:
                for long_gross in [0.5, 0.75, 1.0]:
                    for short_gross in [0.0, 0.25]:
                        logic_id = f"B4_E{breakout}_X{exit_days}_Q{confirm}_L{long_gross}_H{short_gross}"
                        result.append(Logic4H(logic_id, "BREAKOUT_4H", 0, 0, 0, -3.0, breakout, exit_days, confirm, long_gross, short_gross))
    return result


def simulate(
    scenario: Scenario4H,
    targets: Dict[int, Dict[str, float]],
    times: List[int],
    rows: List[dict],
    index_map: Dict[int, int],
    funding: Dict[int, float],
    start: int,
    end: int,
) -> dict:
    active_times = [ts for ts in times if start <= ts < end]
    global_index = {ts: index for index, ts in enumerate(times)}
    portfolio: Dict[str, float] = {}
    output: List[dict] = []
    cycles: List[v4.Cycle] = []
    cycle_start = -1
    cycle_returns: List[float] = []

    def close_cycle(end_ts: int) -> None:
        nonlocal cycle_start, cycle_returns
        if cycle_start >= 0 and cycle_returns:
            value = v4.product_return(cycle_returns)
            cycles.append(v4.Cycle(cycle_start, end_ts, value, value))
        cycle_start = -1
        cycle_returns = []

    for ts in active_times:
        source_index = global_index[ts] - 1 - scenario.extra_delay_bars
        next_portfolio = targets.get(times[source_index], {}) if source_index >= 0 else {}
        turnover = 0.0
        if next_portfolio != portfolio:
            close_cycle(ts - 1)
            turnover = v4.turnover(portfolio, next_portfolio)
            portfolio = next_portfolio
            if v4.gross_exposure(portfolio) > 0:
                cycle_start = ts
        weight = float(portfolio.get("BTC", 0.0))
        row_index = index_map.get(ts)
        gross = 0.0
        if row_index is not None:
            row = rows[row_index]
            gross = weight * ((float(row["close"]) / float(row["open"]) - 1.0) * 100.0)
        actual_funding = weight * funding.get(ts, 0.0)
        cost = turnover * scenario.cost_bps_per_side / 100.0
        adverse = v4.gross_exposure(portfolio) * (scenario.adverse_funding_bps_per_12h / 3.0) / 100.0
        value = gross - actual_funding - cost - adverse
        output.append({"ts": ts, "normal_pct": value, "stress_pct": value, "exposure": v4.gross_exposure(portfolio), "turnover": turnover})
        if cycle_start >= 0:
            cycle_returns.append(value)

    final_turnover = v4.gross_exposure(portfolio)
    if output and final_turnover > 0:
        final_cost = final_turnover * scenario.cost_bps_per_side / 100.0
        output[-1]["normal_pct"] -= final_cost
        output[-1]["stress_pct"] -= final_cost
        output[-1]["turnover"] += final_turnover
        if cycle_returns:
            cycle_returns[-1] -= final_cost
    close_cycle(end - 1)
    return v4.metrics(output, cycles, start, end)


def cluster_key(logic: Logic4H) -> Tuple:
    if logic.family == "FAST_SMA_SHOCK":
        return (logic.family, logic.fast_days, logic.slow_days, logic.momentum_days, logic.shock_exit_pct, logic.confirm_bars)
    return (logic.family, logic.breakout_days, logic.exit_days, logic.confirm_bars)


def dev_pass(base: dict, severe: dict) -> bool:
    annual = base.get("annualReturnsPct", {})
    return (
        base["cycles"] >= 10
        and base["compoundedReturnPct"] > 0
        and (base["profitFactor"] or 0) >= 1.1
        and base["maxDrawdownPct"] >= -25
        and annual.get("2024", -100) > 0
        and annual.get("2025", -100) > 0
        and (severe["profitFactor"] or 0) >= 0.9
        and severe["maxDrawdownPct"] >= -35
    )


def rounded(value):
    if isinstance(value, float):
        return round(value, 4)
    if isinstance(value, dict):
        return {key: rounded(item) for key, item in value.items()}
    if isinstance(value, list):
        return [rounded(item) for item in value]
    return value


def fmt_date(ts: int) -> str:
    return dt.datetime.fromtimestamp(ts / 1000, tz=dt.timezone.utc).strftime("%Y-%m-%d")


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    raw = {symbol: v21.fetch_aster_symbol(pair) for symbol, pair in v21.SYMBOL_PAIRS.items()}
    btc_rows = resample_4h(raw["BTC"]["candles"])
    btc_index = {int(row["ts"]): index for index, row in enumerate(btc_rows)}
    funding = funding_buckets_4h(raw["BTC"]["funding"])
    times = [int(row["ts"]) for row in btc_rows if v21.FETCH_START <= int(row["ts"]) < v21.END]

    twelve_bars = {symbol: v4.resample_12h(item["candles"]) for symbol, item in raw.items()}
    twelve_indexes = {symbol: {int(row["ts"]): index for index, row in enumerate(rows)} for symbol, rows in twelve_bars.items()}
    twelve_funding = v6.funding_buckets({symbol: item["funding"] for symbol, item in raw.items()})
    twelve_times = [int(row["ts"]) for row in twelve_bars["BTC"] if v21.FETCH_START <= int(row["ts"]) < v21.END]

    first_common = max(min(int(row["ts"]) for row in twelve_bars[symbol]) for symbol in v21.SYMBOL_PAIRS)
    test_start = next(ts for ts in times if ts >= first_common + 140 * 12 * v4.HOUR)
    development_end = v4.START_2026
    final_end = v21.END

    base_scenario = scenarios()[0]
    severe_scenario = scenarios()[-1]
    evaluated: List[dict] = []
    for logic in logic_grid():
        targets = logic_targets(logic, times, btc_rows, btc_index)
        base = simulate(base_scenario, targets, times, btc_rows, btc_index, funding, test_start, development_end)
        severe = simulate(severe_scenario, targets, times, btc_rows, btc_index, funding, test_start, development_end)
        evaluated.append({"logic": asdict(logic), "developmentBase": base, "developmentSevere": severe, "passed": dev_pass(base, severe)})

    clusters: Dict[Tuple, List[dict]] = {}
    for item in evaluated:
        logic = Logic4H(**item["logic"])
        clusters.setdefault(cluster_key(logic), []).append(item)
    for item in evaluated:
        logic = Logic4H(**item["logic"])
        passed_members = [member for member in clusters[cluster_key(logic)] if member["passed"]]
        item["clusterPassCount"] = len(passed_members)
        item["clusterMedianCagrPct"] = statistics.median(member["developmentBase"]["cagrPct"] for member in passed_members) if passed_members else -999.0
        item["robust"] = bool(item["passed"] and len(passed_members) >= 3)

    robust = [item for item in evaluated if item["robust"]]
    robust.sort(key=lambda item: (item["clusterMedianCagrPct"], item["developmentBase"]["cagrPct"]), reverse=True)
    exploratory = [item for item in evaluated if item["developmentBase"]["compoundedReturnPct"] > 0 and (item["developmentBase"]["profitFactor"] or 0) >= 1.15 and item["developmentBase"]["maxDrawdownPct"] >= -25]
    exploratory.sort(key=lambda item: item["developmentBase"]["cagrPct"], reverse=True)
    selected_item = robust[0] if robust else exploratory[0] if exploratory else None
    selected = Logic4H(**selected_item["logic"]) if selected_item else None
    tier = "ROBUST" if robust else "EXPLORATORY" if selected else "NONE"

    independent = None
    if selected:
        targets = logic_targets(selected, times, btc_rows, btc_index)
        independent = {
            "logic": asdict(selected),
            "development": {item.scenario_id: simulate(item, targets, times, btc_rows, btc_index, funding, test_start, development_end) for item in scenarios()},
            "holdout2026H1": {item.scenario_id: simulate(item, targets, times, btc_rows, btc_index, funding, development_end, final_end) for item in scenarios()},
            "full": {item.scenario_id: simulate(item, targets, times, btc_rows, btc_index, funding, test_start, final_end) for item in scenarios()},
        }
        holdout = independent["holdout2026H1"]["BASE_10BPS_4H"]
        holdout_severe = independent["holdout2026H1"]["SEVERE_50BPS_DELAY8H_FUND3"]
        independent["holdoutPassed"] = bool(
            holdout["compoundedReturnPct"] > 0
            and (holdout["profitFactor"] or 0) >= 1.0
            and holdout["maxDrawdownPct"] >= -15
            and holdout_severe["maxDrawdownPct"] >= -25
        )

    baseline_targets = v21.v6_targets(twelve_times, twelve_bars, twelve_indexes)
    baseline = {
        "full": v21.run_scenarios(baseline_targets, twelve_times, twelve_bars, twelve_indexes, twelve_funding, test_start, final_end),
        "holdout2026H1": v21.run_scenarios(baseline_targets, twelve_times, twelve_bars, twelve_indexes, twelve_funding, development_end, final_end),
    }

    if independent and independent["holdoutPassed"] and tier == "ROBUST":
        status = "BTC_FAST_4H_ROBUST_CANDIDATE_FOUND"
    elif independent and independent["holdoutPassed"]:
        status = "BTC_FAST_4H_EXPLORATORY_POSITIVE_HOLDOUT"
    elif independent:
        status = "BTC_FAST_4H_HOLDOUT_REJECTED"
    else:
        status = "BTC_FAST_4H_NO_DEVELOPMENT_CANDIDATE"

    evaluated.sort(key=lambda item: item["developmentBase"]["cagrPct"], reverse=True)
    result = rounded({
        "version": 24,
        "strategyId": "BTC_FAST_4H_INDEPENDENT_V24",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": status,
        "selectionTier": tier,
        "candidateCount": len(evaluated),
        "selectedLogic": asdict(selected) if selected else None,
        "windows": {
            "full": {"startDate": fmt_date(test_start), "endDate": fmt_date(final_end)},
            "development": {"startDate": fmt_date(test_start), "endDate": fmt_date(development_end)},
            "holdout": {"startDate": fmt_date(development_end), "endDate": fmt_date(final_end)},
        },
        "source": {"venue": "ASTER_DEX_PUBLIC_FUTURES_API", "authenticationUsed": False, "btc4hBars": len(btc_rows), "btcFundingRows": len(raw["BTC"]["funding"])},
        "baselineV6_12H": baseline,
        "independentBtc4H": independent,
        "topDevelopment": evaluated[:20],
        "productionChanged": False,
        "realTradingEnabled": False,
        "paperEligible": False,
        "liveEligible": False,
        "limitations": [
            "The 4h signal uses a one-bar 4h execution delay; severe mode uses an 8h delay.",
            "Selection uses 2024-2025 only; 2026 H1 remains a holdout.",
            "Public OHLCV and funding are modeled; order-book calibration remains pending V19 freeze.",
            "No production, VPS, account, order, position, .env, or live-runner setting was changed.",
        ],
    })

    report = [
        "# BTC Fast 4H Independent Logic V24",
        "",
        f"- Status: **{status}**",
        f"- Selection tier: **{tier}**",
        f"- Candidate count: {len(evaluated)}",
        f"- Selected: **{selected.logic_id if selected else 'NONE'}**",
        "- Production changed: NO",
        "- Real trading: DISABLED",
        "",
        "| Strategy | Development return | 2025 return | Holdout return | Holdout PF | Holdout DD | Full return | Full CAGR | Full PF | Full DD | Severe full DD |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    baseline_full = result["baselineV6_12H"]["full"]["BASE_10BPS"]
    baseline_holdout = result["baselineV6_12H"]["holdout2026H1"]["BASE_10BPS"]
    baseline_severe = result["baselineV6_12H"]["full"]["SEVERE_50BPS_DELAY12H_FUND3"]
    report.append(
        f"| V6_12H | n/a | n/a | {baseline_holdout['compoundedReturnPct']} | {baseline_holdout['profitFactor']} | {baseline_holdout['maxDrawdownPct']} | "
        f"{baseline_full['compoundedReturnPct']} | {baseline_full['cagrPct']} | {baseline_full['profitFactor']} | {baseline_full['maxDrawdownPct']} | {baseline_severe['maxDrawdownPct']} |"
    )
    if result["independentBtc4H"]:
        development = result["independentBtc4H"]["development"]["BASE_10BPS_4H"]
        holdout = result["independentBtc4H"]["holdout2026H1"]["BASE_10BPS_4H"]
        full = result["independentBtc4H"]["full"]["BASE_10BPS_4H"]
        severe = result["independentBtc4H"]["full"]["SEVERE_50BPS_DELAY8H_FUND3"]
        report.append(
            f"| BTC_4H | {development['compoundedReturnPct']} | {development['annualReturnsPct'].get('2025')} | {holdout['compoundedReturnPct']} | "
            f"{holdout['profitFactor']} | {holdout['maxDrawdownPct']} | {full['compoundedReturnPct']} | {full['cagrPct']} | "
            f"{full['profitFactor']} | {full['maxDrawdownPct']} | {severe['maxDrawdownPct']} |"
        )
    report.extend(["", "## Limitations", "", *[f"- {item}" for item in result["limitations"]]])

    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "btc-fast-4h-independent-v24.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    (state_dir / "btc-fast-4h-independent-v24.md").write_text("\n".join(report), encoding="utf-8")
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
