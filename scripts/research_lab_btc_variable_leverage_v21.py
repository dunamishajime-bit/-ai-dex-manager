from __future__ import annotations

import datetime as dt
import json
import os
import statistics
from pathlib import Path
from typing import Dict, List, Optional

import research_lab_parameter_bagged_rotation_v4 as v4
import research_lab_precomputed_multi_regime_v6 as v6
import research_lab_fixed_candidate_robustness_v7 as v7
import research_lab_pengu_main_currency_v20 as v20


SYMBOL_PAIRS = {
    "BTC": "BTCUSDT",
    "ETH": "ETHUSDT",
    "BNB": "BNBUSDT",
    "SOL": "SOLUSDT",
}
FETCH_START = v20.FETCH_START
END = v4.END


def fetch_aster_symbol(pair: str) -> dict:
    original_pair = v20.PENGU_PAIR
    try:
        v20.PENGU_PAIR = pair
        return {"candles": v20.fetch_klines(), "funding": v20.fetch_funding()}
    finally:
        v20.PENGU_PAIR = original_pair


def v6_targets(times: List[int], bars: Dict[str, List[dict]], indexes: Dict[str, Dict[int, int]]) -> Dict[int, Dict[str, float]]:
    projected = v20.precompute_projected(v20.COMPONENTS, times, bars, indexes, ["ETH", "BNB", "SOL"])
    base = {ts: v4.overlay_target(v20.OVERLAY, ts, projected[ts], bars, indexes) for ts in times}
    bear = v6.precompute_bear_targets([v20.HEDGE], times, bars, indexes)[v20.HEDGE.hedge_id]
    return v20.desired_targets(base, bear, times)


def confirmed_direction(times: List[int], bars: Dict[str, List[dict]], indexes: Dict[str, Dict[int, int]]) -> Dict[int, int]:
    raw: Dict[int, int] = {}
    for ts in times:
        index = indexes["BTC"].get(ts)
        if index is None:
            raw[ts] = 0
            continue
        rows = bars["BTC"]
        slow = v4.sma(rows, index, 120)  # 60 days on 12h bars
        momentum = v4.momentum(rows, index, 60)  # 30 days
        if slow is None or momentum is None:
            raw[ts] = 0
            continue
        close = float(rows[index]["close"])
        raw[ts] = 1 if close > slow and momentum > 0 else -1 if close < slow and momentum < 0 else 0

    result: Dict[int, int] = {}
    last = 0
    count = 0
    for ts in times:
        value = raw.get(ts, 0)
        if value != 0 and value == last:
            count += 1
        elif value != 0:
            last = value
            count = 1
        else:
            last = 0
            count = 0
        result[ts] = value if value != 0 and count >= 2 else 0
    return result


def btc_targets(mode: str, times: List[int], bars: Dict[str, List[dict]], indexes: Dict[str, Dict[int, int]]) -> Dict[int, Dict[str, float]]:
    direction = confirmed_direction(times, bars, indexes)
    result: Dict[int, Dict[str, float]] = {}
    for ts in times:
        sign = direction.get(ts, 0)
        if sign == 0:
            result[ts] = {}
            continue
        if mode == "BTC_DIRECTIONAL_1X":
            leverage = 1.0
        elif mode == "BTC_DIRECTIONAL_2X":
            leverage = 2.0
        else:
            index = indexes["BTC"].get(ts)
            vol = v4.realized_annual_vol(bars["BTC"], index, 60) if index is not None else None
            if vol is None or vol <= 0:
                result[ts] = {}
                continue
            if mode == "BTC_VOL60_ASYM_0P5_TO_3X":
                raw, floor = 60.0 / vol, 0.5
            elif mode == "BTC_VOL80_ASYM_1_TO_3X":
                raw, floor = 80.0 / vol, 1.0
            else:
                raise ValueError(f"unknown mode: {mode}")
            cap = 3.0 if sign > 0 else 2.0
            leverage = min(cap, max(floor, raw))
        result[ts] = {"BTC": sign * leverage}
    return result


def btc_core_targets(mode: str, times: List[int], bars: Dict[str, List[dict]], indexes: Dict[str, Dict[int, int]]) -> Dict[int, Dict[str, float]]:
    bull = confirmed_direction(times, bars, indexes)
    raw_bear = v6.precompute_bear_targets([v20.HEDGE], times, bars, indexes)[v20.HEDGE.hedge_id]
    bear = v6.confirmed_bear_series(raw_bear, times, v20.CONFIRM_BARS)
    result: Dict[int, Dict[str, float]] = {}
    current: Dict[str, float] = {}
    last_resize = -10_000
    for position, ts in enumerate(times):
        if bull.get(ts, 0) > 0:
            if mode == "BTC_LONG_1X_HEDGE0P4":
                desired_leverage = 1.0
            elif mode == "BTC_LONG_2X_HEDGE0P4":
                desired_leverage = 2.0
            else:
                index = indexes["BTC"].get(ts)
                vol = v4.realized_annual_vol(bars["BTC"], index, 60) if index is not None else None
                if vol is None or vol <= 0:
                    result[ts] = dict(current)
                    continue
                if mode == "BTC_VOL60_WEEKLY_LONG_CAP3_HEDGE0P4":
                    desired_leverage = min(3.0, max(0.5, 60.0 / vol))
                elif mode == "BTC_VOL80_WEEKLY_LONG_CAP3_HEDGE0P4":
                    desired_leverage = min(3.0, max(1.0, 80.0 / vol))
                else:
                    raise ValueError(f"unknown core mode: {mode}")
            current_leverage = float(current.get("BTC", 0.0)) if float(current.get("BTC", 0.0)) > 0 else 0.0
            fixed_mode = mode in {"BTC_LONG_1X_HEDGE0P4", "BTC_LONG_2X_HEDGE0P4"}
            should_resize = current_leverage <= 0 or fixed_mode or (position - last_resize >= 14 and abs(desired_leverage - current_leverage) >= 0.25)
            if should_resize:
                current = {"BTC": desired_leverage}
                last_resize = position
        else:
            desired = bear.get(ts, {})
            if desired != current:
                current = dict(desired)
                last_resize = position
        result[ts] = dict(current)
    return result


def scenarios() -> List[v7.ExecutionScenario]:
    return [
        v7.ExecutionScenario("BASE_10BPS", 10, 0, 0),
        v7.ExecutionScenario("COST30", 30, 0, 0),
        v7.ExecutionScenario("DELAY12H", 10, 1, 0),
        v7.ExecutionScenario("SEVERE_50BPS_DELAY12H_FUND3", 50, 1, 3),
    ]


def run_scenarios(targets, times, bars, indexes, funding, start, end) -> Dict[str, dict]:
    return {
        scenario.scenario_id: v7.simulate_scenario(scenario, targets, times, bars, indexes, funding, start, end)
        for scenario in scenarios()
    }


def exposure_stats(targets: Dict[int, Dict[str, float]], times: List[int], start: int, end: int) -> dict:
    values = [v4.gross_exposure(targets.get(ts, {})) for ts in times if start <= ts < end]
    ordered = sorted(values)
    p90 = ordered[min(len(ordered) - 1, int(len(ordered) * 0.9))] if ordered else 0.0
    return {"mean": statistics.fmean(values) if values else 0.0, "p90": p90, "max": max(values) if values else 0.0}


def liquidation_proxy(targets, times, bars, indexes, start, end) -> dict:
    global_index = {ts: index for index, ts in enumerate(times)}
    breaches = 0
    max_leveraged_adverse = 0.0
    min_buffer: Optional[float] = None
    observed = 0
    for ts in times:
        if not (start <= ts < end):
            continue
        source_index = global_index[ts] - 1
        portfolio = targets.get(times[source_index], {}) if source_index >= 0 else {}
        weight = float(portfolio.get("BTC", 0.0))
        leverage = abs(weight)
        if leverage <= 0:
            continue
        index = indexes["BTC"].get(ts)
        if index is None:
            continue
        bar = bars["BTC"][index]
        opening = float(bar["open"])
        if opening <= 0:
            continue
        adverse = max(0.0, 1.0 - float(bar["low"]) / opening) if weight > 0 else max(0.0, float(bar["high"]) / opening - 1.0)
        liquidation_distance = 0.90 / leverage
        buffer = (liquidation_distance - adverse) * 100.0
        breaches += int(adverse >= liquidation_distance)
        max_leveraged_adverse = max(max_leveraged_adverse, adverse * leverage * 100.0)
        min_buffer = buffer if min_buffer is None else min(min_buffer, buffer)
        observed += 1
    return {
        "observedBars": observed,
        "proxyBreaches": breaches,
        "maxLeveragedIntrabarAdversePct": max_leveraged_adverse,
        "minimumEstimatedMarginBufferPct": min_buffer,
        "note": "Proxy only: liquidation distance is approximated as 90% of initial margin; maintenance tiers and cross-margin wallet equity are not modeled.",
    }


def fmt_date(ts: int) -> str:
    return dt.datetime.fromtimestamp(ts / 1000, tz=dt.timezone.utc).strftime("%Y-%m-%d")


def rounded(value):
    if isinstance(value, float):
        return round(value, 4)
    if isinstance(value, dict):
        return {key: rounded(item) for key, item in value.items()}
    if isinstance(value, list):
        return [rounded(item) for item in value]
    return value


def robust_candidate(item: dict, baseline: dict) -> bool:
    base = item["scenarios"]["BASE_10BPS"]
    severe = item["scenarios"]["SEVERE_50BPS_DELAY12H_FUND3"]
    baseline_base = baseline["scenarios"]["BASE_10BPS"]
    return (
        base["compoundedReturnPct"] > 0
        and (base["profitFactor"] or 0) >= 1.1
        and base["maxDrawdownPct"] >= -35
        and (severe["profitFactor"] or 0) >= 0.95
        and severe["maxDrawdownPct"] >= -45
        and item["liquidationProxy"]["proxyBreaches"] == 0
        and base["cagrPct"] >= baseline_base["cagrPct"]
    )


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    raw = {symbol: fetch_aster_symbol(pair) for symbol, pair in SYMBOL_PAIRS.items()}
    counts = {symbol: {"hourlyCandles": len(item["candles"]), "fundingRows": len(item["funding"])} for symbol, item in raw.items()}
    bars = {symbol: v4.resample_12h(item["candles"]) for symbol, item in raw.items()}
    indexes = {symbol: {int(bar["ts"]): index for index, bar in enumerate(rows)} for symbol, rows in bars.items()}
    funding = v6.funding_buckets({symbol: item["funding"] for symbol, item in raw.items()})
    times = [int(bar["ts"]) for bar in bars["BTC"] if FETCH_START <= int(bar["ts"]) < END]

    first_common = max(min(int(row["ts"]) for row in bars[symbol]) for symbol in SYMBOL_PAIRS)
    test_start = first_common + 140 * 12 * v4.HOUR
    test_start = next((ts for ts in times if ts >= test_start), test_start)
    if END - test_start < 120 * v4.DAY:
        raise RuntimeError(f"insufficient Aster common window: {fmt_date(test_start)} to {fmt_date(END)}")

    targets_by_strategy = {"V6_CORE3_WITH_BTC_HEDGE": v6_targets(times, bars, indexes)}
    for mode in ["BTC_DIRECTIONAL_1X", "BTC_DIRECTIONAL_2X", "BTC_VOL60_ASYM_0P5_TO_3X", "BTC_VOL80_ASYM_1_TO_3X"]:
        targets_by_strategy[mode] = btc_targets(mode, times, bars, indexes)
    for mode in ["BTC_LONG_1X_HEDGE0P4", "BTC_LONG_2X_HEDGE0P4", "BTC_VOL60_WEEKLY_LONG_CAP3_HEDGE0P4", "BTC_VOL80_WEEKLY_LONG_CAP3_HEDGE0P4"]:
        targets_by_strategy[mode] = btc_core_targets(mode, times, bars, indexes)

    strategies: Dict[str, dict] = {}
    for strategy_id, targets in targets_by_strategy.items():
        strategies[strategy_id] = {
            "scenarios": run_scenarios(targets, times, bars, indexes, funding, test_start, END),
            "exposure": exposure_stats(targets, times, test_start, END),
            "liquidationProxy": liquidation_proxy(targets, times, bars, indexes, test_start, END),
        }

    baseline = strategies["V6_CORE3_WITH_BTC_HEDGE"]
    eligible = [sid for sid, item in strategies.items() if sid != "V6_CORE3_WITH_BTC_HEDGE" and robust_candidate(item, baseline)]
    eligible.sort(key=lambda sid: strategies[sid]["scenarios"]["BASE_10BPS"]["cagrPct"], reverse=True)
    selected = eligible[0] if eligible else None
    status = "BTC_VARIABLE_LEVERAGE_CANDIDATE_FOUND" if selected else "BTC_VARIABLE_LEVERAGE_NOT_ROBUSTLY_BETTER"

    result = rounded({
        "version": 21,
        "strategyId": "BTC_VARIABLE_LEVERAGE_ASTER_V21",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": status,
        "testWindow": {"start": test_start, "end": END, "startDate": fmt_date(test_start), "endDate": fmt_date(END)},
        "source": {"venue": "ASTER_DEX_PUBLIC_FUTURES_API", "symbols": SYMBOL_PAIRS, "authenticationUsed": False, "counts": counts},
        "signal": {
            "timeframeHours": 12,
            "long": "BTC close > SMA60d and 30d momentum > 0 for 2 bars",
            "short": "BTC close < SMA60d and 30d momentum < 0 for 2 bars",
            "volatilityLookbackDays": 30,
            "variableLongCap": 3.0,
            "variableShortCap": 2.0,
            "practicalCoreBearHedgeGross": 0.4,
            "practicalVariableResizeBars": 14,
            "practicalResizeThreshold": 0.25,
        },
        "strategies": strategies,
        "eligibleVariableStrategies": eligible,
        "selected": selected,
        "productionChanged": False,
        "realTradingEnabled": False,
        "paperEligible": False,
        "liveEligible": False,
        "limitations": [
            "Public Aster OHLCV and funding only; order-book slippage remains fixed until V19 calibration is frozen.",
            "Liquidation analysis is a proxy and does not reproduce Aster maintenance tiers or cross-margin wallet equity.",
            "No stop-loss optimization was performed; this isolates leverage sizing.",
            "No production, VPS, .env, account, order, position, or live runner changes were made.",
        ],
    })

    report = [
        "# BTC Variable Leverage Aster Backtest V21",
        "",
        f"- Status: **{status}**",
        f"- Aster common window: {result['testWindow']['startDate']} to {result['testWindow']['endDate']}",
        f"- Selected: **{selected or 'NONE'}**",
        "- Production changed: NO",
        "- Real trading: DISABLED",
        "",
        "| Strategy | Return | CAGR | PF | Win rate | Max DD | Severe return | Severe PF | Severe DD | Avg gross | Max gross | Liq proxy |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for strategy_id, item in result["strategies"].items():
        base = item["scenarios"]["BASE_10BPS"]
        severe = item["scenarios"]["SEVERE_50BPS_DELAY12H_FUND3"]
        report.append(
            f"| {strategy_id} | {base['compoundedReturnPct']} | {base['cagrPct']} | {base['profitFactor']} | {base['winRatePct']} | "
            f"{base['maxDrawdownPct']} | {severe['compoundedReturnPct']} | {severe['profitFactor']} | {severe['maxDrawdownPct']} | "
            f"{item['exposure']['mean']} | {item['exposure']['max']} | {item['liquidationProxy']['proxyBreaches']} |"
        )
    report.extend(["", "## Verdict", "", "Selection requires beating frozen V6 CAGR while passing PF, DD, severe-stress, and liquidation-proxy gates.", "", "## Limitations", "", *[f"- {item}" for item in result["limitations"]]])

    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "btc-variable-leverage-aster-v21.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    (state_dir / "btc-variable-leverage-aster-v21.md").write_text("\n".join(report), encoding="utf-8")
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
