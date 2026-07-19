from __future__ import annotations

import datetime as dt
import json
import os
import statistics
from dataclasses import asdict
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import research_lab_parameter_bagged_rotation_v4 as v4
import research_lab_precomputed_multi_regime_v6 as v6
import research_lab_btc_variable_leverage_v21 as v21
import research_lab_btc_fast_4h_independent_v24 as v24


def rolling_sma(values: List[float], length: int) -> List[Optional[float]]:
    result: List[Optional[float]] = [None] * len(values)
    running = 0.0
    for index, value in enumerate(values):
        running += value
        if index >= length:
            running -= values[index - length]
        if index >= length - 1:
            result[index] = running / length
    return result


def momentum(values: List[float], length: int) -> List[Optional[float]]:
    result: List[Optional[float]] = [None] * len(values)
    for index in range(length, len(values)):
        prior = values[index - length]
        if prior > 0:
            result[index] = (values[index] / prior - 1.0) * 100.0
    return result


def prior_extreme(values: List[float], length: int, want_max: bool) -> List[Optional[float]]:
    result: List[Optional[float]] = [None] * len(values)
    for index in range(length, len(values)):
        window = values[index - length:index]
        result[index] = max(window) if want_max else min(window)
    return result


def build_cache(rows: List[dict], grid: List[v24.Logic4H]) -> dict:
    closes = [float(row["close"]) for row in rows]
    highs = [float(row["high"]) for row in rows]
    lows = [float(row["low"]) for row in rows]
    sma_lengths = sorted({days * 6 for logic in grid for days in [logic.fast_days, logic.slow_days] if days > 0})
    mom_lengths = sorted({logic.momentum_days * 6 for logic in grid if logic.momentum_days > 0} | {6})
    extreme_lengths = sorted({days * 6 for logic in grid for days in [logic.breakout_days, logic.exit_days] if days > 0})
    return {
        "close": closes,
        "sma": {length: rolling_sma(closes, length) for length in sma_lengths},
        "momentum": {length: momentum(closes, length) for length in mom_lengths},
        "high": {length: prior_extreme(highs, length, True) for length in extreme_lengths},
        "low": {length: prior_extreme(lows, length, False) for length in extreme_lengths},
    }


def targets_fast(logic: v24.Logic4H, times: List[int], index_map: Dict[int, int], cache: dict) -> Dict[int, Dict[str, float]]:
    result: Dict[int, Dict[str, float]] = {}
    state = 0
    pending_sign = 0
    pending_count = 0
    for ts in times:
        index = index_map[ts]
        close = cache["close"][index]
        raw = 0
        long_exit = False
        short_exit = False
        if logic.family == "FAST_SMA_SHOCK":
            fast = cache["sma"][logic.fast_days * 6][index]
            slow = cache["sma"][logic.slow_days * 6][index]
            mom = cache["momentum"][logic.momentum_days * 6][index]
            one_day = cache["momentum"][6][index]
            if fast is not None and slow is not None and mom is not None and one_day is not None:
                raw = 1 if close > fast > slow and mom > 0 else -1 if close < fast < slow and mom < 0 else 0
                long_exit = close < fast or one_day <= logic.shock_exit_pct
                short_exit = close > fast or one_day >= abs(logic.shock_exit_pct)
        else:
            upper = cache["high"][logic.breakout_days * 6][index]
            lower = cache["low"][logic.breakout_days * 6][index]
            exit_low = cache["low"][logic.exit_days * 6][index]
            exit_high = cache["high"][logic.exit_days * 6][index]
            if upper is not None and lower is not None and exit_low is not None and exit_high is not None:
                raw = 1 if close > upper else -1 if close < lower else 0
                long_exit = close < exit_low
                short_exit = close > exit_high

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
        result[ts] = {"BTC": logic.long_gross} if state > 0 else {"BTC": -logic.short_gross} if state < 0 and logic.short_gross > 0 else {}
    return result


def cluster_key(logic: v24.Logic4H) -> Tuple:
    return v24.cluster_key(logic)


def rounded(value):
    return v24.rounded(value)


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    raw = {symbol: v21.fetch_aster_symbol(pair) for symbol, pair in v21.SYMBOL_PAIRS.items()}
    rows = v24.resample_4h(raw["BTC"]["candles"])
    index_map = {int(row["ts"]): index for index, row in enumerate(rows)}
    funding = v24.funding_buckets_4h(raw["BTC"]["funding"])
    times = [int(row["ts"]) for row in rows if v21.FETCH_START <= int(row["ts"]) < v21.END]
    grid = v24.logic_grid()
    cache = build_cache(rows, grid)

    twelve_bars = {symbol: v4.resample_12h(item["candles"]) for symbol, item in raw.items()}
    twelve_indexes = {symbol: {int(row["ts"]): index for index, row in enumerate(symbol_rows)} for symbol, symbol_rows in twelve_bars.items()}
    twelve_funding = v6.funding_buckets({symbol: item["funding"] for symbol, item in raw.items()})
    twelve_times = [int(row["ts"]) for row in twelve_bars["BTC"] if v21.FETCH_START <= int(row["ts"]) < v21.END]
    first_common = max(min(int(row["ts"]) for row in twelve_bars[symbol]) for symbol in v21.SYMBOL_PAIRS)
    test_start = next(ts for ts in times if ts >= first_common + 140 * 12 * v4.HOUR)
    development_end = v4.START_2026
    final_end = v21.END

    base_scenario = v24.scenarios()[0]
    severe_scenario = v24.scenarios()[-1]
    evaluated: List[dict] = []
    for logic in grid:
        targets = targets_fast(logic, times, index_map, cache)
        base = v24.simulate(base_scenario, targets, times, rows, index_map, funding, test_start, development_end)
        severe = v24.simulate(severe_scenario, targets, times, rows, index_map, funding, test_start, development_end)
        evaluated.append({"logic": asdict(logic), "developmentBase": base, "developmentSevere": severe, "passed": v24.dev_pass(base, severe)})

    clusters: Dict[Tuple, List[dict]] = {}
    for item in evaluated:
        logic = v24.Logic4H(**item["logic"])
        clusters.setdefault(cluster_key(logic), []).append(item)
    for item in evaluated:
        logic = v24.Logic4H(**item["logic"])
        passed = [member for member in clusters[cluster_key(logic)] if member["passed"]]
        item["clusterPassCount"] = len(passed)
        item["clusterMedianCagrPct"] = statistics.median(member["developmentBase"]["cagrPct"] for member in passed) if passed else -999.0
        item["robust"] = bool(item["passed"] and len(passed) >= 3)

    robust = [item for item in evaluated if item["robust"]]
    robust.sort(key=lambda item: (item["clusterMedianCagrPct"], item["developmentBase"]["cagrPct"]), reverse=True)
    exploratory = [item for item in evaluated if item["developmentBase"]["compoundedReturnPct"] > 0 and (item["developmentBase"]["profitFactor"] or 0) >= 1.15 and item["developmentBase"]["maxDrawdownPct"] >= -25]
    exploratory.sort(key=lambda item: item["developmentBase"]["cagrPct"], reverse=True)
    selected_item = robust[0] if robust else exploratory[0] if exploratory else None
    selected = v24.Logic4H(**selected_item["logic"]) if selected_item else None
    tier = "ROBUST" if robust else "EXPLORATORY" if selected else "NONE"

    independent = None
    if selected:
        targets = targets_fast(selected, times, index_map, cache)
        independent = {
            "logic": asdict(selected),
            "development": {item.scenario_id: v24.simulate(item, targets, times, rows, index_map, funding, test_start, development_end) for item in v24.scenarios()},
            "holdout2026H1": {item.scenario_id: v24.simulate(item, targets, times, rows, index_map, funding, development_end, final_end) for item in v24.scenarios()},
            "full": {item.scenario_id: v24.simulate(item, targets, times, rows, index_map, funding, test_start, final_end) for item in v24.scenarios()},
        }
        holdout = independent["holdout2026H1"]["BASE_10BPS_4H"]
        severe_holdout = independent["holdout2026H1"]["SEVERE_50BPS_DELAY8H_FUND3"]
        independent["holdoutPassed"] = bool(
            holdout["compoundedReturnPct"] > 0
            and (holdout["profitFactor"] or 0) >= 1.0
            and holdout["maxDrawdownPct"] >= -15
            and severe_holdout["maxDrawdownPct"] >= -25
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
        "version": 25,
        "strategyId": "BTC_FAST_4H_OPTIMIZED_V25",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": status,
        "selectionTier": tier,
        "candidateCount": len(evaluated),
        "selectedLogic": asdict(selected) if selected else None,
        "windows": {
            "full": {"startDate": v24.fmt_date(test_start), "endDate": v24.fmt_date(final_end)},
            "development": {"startDate": v24.fmt_date(test_start), "endDate": v24.fmt_date(development_end)},
            "holdout": {"startDate": v24.fmt_date(development_end), "endDate": v24.fmt_date(final_end)},
        },
        "baselineV6_12H": baseline,
        "independentBtc4H": independent,
        "topDevelopment": evaluated[:20],
        "source": {"venue": "ASTER_DEX_PUBLIC_FUTURES_API", "btc4hBars": len(rows), "btcFundingRows": len(raw["BTC"]["funding"]), "authenticationUsed": False},
        "productionChanged": False,
        "realTradingEnabled": False,
        "paperEligible": False,
        "liveEligible": False,
        "limitations": [
            "Development-only selection; 2026 H1 is an untouched holdout.",
            "Base execution is one completed 4h bar late; severe execution is 8h late.",
            "Public OHLCV and funding only; V19 order-book calibration is not frozen.",
            "No production, VPS, account, order, position, .env, or live-runner changes.",
        ],
    })

    report = [
        "# BTC Fast 4H Optimized V25",
        "",
        f"- Status: **{status}**",
        f"- Selection tier: **{tier}**",
        f"- Candidates: {len(evaluated)}",
        f"- Selected: **{selected.logic_id if selected else 'NONE'}**",
        "- Production changed: NO",
        "- Real trading: DISABLED",
        "",
        "| Strategy | Development return | 2025 return | Holdout return | Holdout PF | Holdout DD | Full return | CAGR | PF | DD | Severe DD |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    baseline_full = result["baselineV6_12H"]["full"]["BASE_10BPS"]
    baseline_holdout = result["baselineV6_12H"]["holdout2026H1"]["BASE_10BPS"]
    baseline_severe = result["baselineV6_12H"]["full"]["SEVERE_50BPS_DELAY12H_FUND3"]
    report.append(
        f"| V6_12H | n/a | n/a | {baseline_holdout['compoundedReturnPct']} | {baseline_holdout['profitFactor']} | {baseline_holdout['maxDrawdownPct']} | "
        f"{baseline_full['compoundedReturnPct']} | {baseline_full['cagrPct']} | {baseline_full['profitFactor']} | {baseline_full['maxDrawdownPct']} | {baseline_severe['maxDrawdownPct']} |"
    )
    if independent:
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
    (state_dir / "btc-fast-4h-optimized-v25.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    (state_dir / "btc-fast-4h-optimized-v25.md").write_text("\n".join(report), encoding="utf-8")
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
