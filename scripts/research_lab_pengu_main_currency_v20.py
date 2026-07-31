from __future__ import annotations

import datetime as dt
import hashlib
import json
import math
import os
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import research_lab_parameter_bagged_rotation_v4 as v4
import research_lab_asymmetric_bear_hedge_v5 as v5
import research_lab_precomputed_multi_regime_v6 as v6
import research_lab_fixed_candidate_robustness_v7 as v7


ASTER_BASE = "https://fapi.asterdex.com"
PENGU_SYMBOL = "PENGU"
PENGU_PAIR = "PENGUUSDT"
FETCH_START = 1704067200000  # 2024-01-01 UTC
END = v4.END

COMPONENTS = [
    v4.Component("MH_12H_LONG_CASH_CORE3_R30_M10_B3.5_K1", 30, 10, 3.5, 1),
    v4.Component("MH_12H_LONG_CASH_CORE3_R30_M10_B5.5_K1", 30, 10, 5.5, 1),
    v4.Component("MH_12H_LONG_CASH_CORE3_R42_M10_B3.5_K1", 42, 10, 3.5, 1),
    v4.Component("MH_12H_LONG_CASH_CORE3_R30_M30_B3.5_K2", 30, 30, 3.5, 2),
    v4.Component("MH_12H_LONG_CASH_CORE3_R42_M30_B3.5_K2", 42, 30, 3.5, 2),
    v4.Component("MH_12H_LONG_CASH_CORE3_R30_M10_B3.5_K2", 30, 10, 3.5, 2),
    v4.Component("MH_12H_LONG_CASH_CORE3_R30_M10_B5.5_K2", 30, 10, 5.5, 2),
    v4.Component("MH_12H_LONG_CASH_CORE3_R30_M20_B3.5_K2", 30, 20, 3.5, 2),
    v4.Component("MH_12H_LONG_CASH_CORE3_R42_M10_B3.5_K2", 42, 10, 3.5, 2),
    v4.Component("MH_12H_LONG_CASH_CORE3_R42_M20_B3.5_K2", 42, 20, 3.5, 2),
]
OVERLAY = v4.Overlay("BAG_V50_S0_TV45_G1.1_CNONE", 0.5, 0, 45, 1.1, None)
HEDGE = v5.Hedge("H_BTC_S60_M30_G0.4", 60, 30, 0.4, "BTC")
CONFIRM_BARS = 4

UNIVERSES = {
    "BASE_V6_CORE3": ["ETH", "BNB", "SOL"],
    "PENGU_MAIN_ONLY": ["PENGU"],
    "PENGU_REPLACES_SOL": ["ETH", "BNB", "PENGU"],
    "PENGU_PLUS_CORE3": ["ETH", "BNB", "SOL", "PENGU"],
}


def fetch_json(path: str, params: Optional[dict] = None, timeout: int = 20) -> object:
    query = urllib.parse.urlencode(params or {})
    url = f"{ASTER_BASE}{path}" + (f"?{query}" if query else "")
    request = urllib.request.Request(url, headers={"User-Agent": "GoldCat-PENGU-Main-BT/1.0"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_klines() -> List[dict]:
    rows: List[dict] = []
    cursor = FETCH_START
    empty_windows = 0
    while cursor < END:
        payload = fetch_json(
            "/fapi/v1/klines",
            {
                "symbol": PENGU_PAIR,
                "interval": "1h",
                "startTime": cursor,
                "endTime": END - 1,
                "limit": 1500,
            },
        )
        if not isinstance(payload, list):
            raise RuntimeError(f"unexpected kline payload: {type(payload).__name__}")
        if not payload:
            empty_windows += 1
            cursor += 30 * v4.DAY
            if empty_windows > 24:
                break
            continue
        empty_windows = 0
        added = 0
        for item in payload:
            if not isinstance(item, list) or len(item) < 6:
                continue
            ts = int(item[0])
            if ts >= END:
                continue
            rows.append({
                "ts": ts,
                "open": float(item[1]),
                "high": float(item[2]),
                "low": float(item[3]),
                "close": float(item[4]),
                "volume": float(item[5]),
            })
            added += 1
        last_ts = int(payload[-1][0])
        next_cursor = last_ts + v4.HOUR
        if next_cursor <= cursor:
            break
        cursor = next_cursor
        if added == 0:
            break
        time.sleep(0.05)
    unique = {int(row["ts"]): row for row in rows}
    result = [unique[key] for key in sorted(unique)]
    if len(result) < 1000:
        raise RuntimeError(f"insufficient PENGU hourly candles from Aster: {len(result)}")
    return result


def fetch_funding() -> List[dict]:
    rows: List[dict] = []
    cursor = FETCH_START
    empty_windows = 0
    while cursor < END:
        payload = fetch_json(
            "/fapi/v1/fundingRate",
            {
                "symbol": PENGU_PAIR,
                "startTime": cursor,
                "endTime": END - 1,
                "limit": 1000,
            },
        )
        if not isinstance(payload, list):
            raise RuntimeError(f"unexpected funding payload: {type(payload).__name__}")
        if not payload:
            empty_windows += 1
            cursor += 90 * v4.DAY
            if empty_windows > 12:
                break
            continue
        empty_windows = 0
        for item in payload:
            if not isinstance(item, dict):
                continue
            ts = int(item.get("fundingTime", item.get("time", 0)) or 0)
            rate = float(item.get("fundingRate", item.get("rate", 0)) or 0)
            if 0 < ts < END:
                rows.append({"ts": ts, "rate": rate})
        last_ts = int(payload[-1].get("fundingTime", payload[-1].get("time", 0)) or 0)
        next_cursor = last_ts + 1
        if next_cursor <= cursor:
            break
        cursor = next_cursor
        if len(payload) < 1000:
            break
        time.sleep(0.05)
    unique = {int(row["ts"]): row for row in rows}
    return [unique[key] for key in sorted(unique)]


def component_target_universe(
    component: v4.Component,
    ts: int,
    bars: Dict[str, List[dict]],
    indexes: Dict[str, Dict[int, int]],
    universe: List[str],
) -> Dict[str, float]:
    btc_index = indexes["BTC"].get(ts)
    if btc_index is None:
        return {}
    btc = bars["BTC"]
    regime_bars = component.regime_days * 2
    momentum_bars = component.momentum_days * 2
    asset_sma_bars = 44
    btc_average = v4.sma(btc, btc_index, regime_bars)
    btc_momentum = v4.momentum(btc, btc_index, momentum_bars)
    if btc_average is None or btc_momentum is None:
        return {}
    if not (float(btc[btc_index]["close"]) > btc_average and btc_momentum > 0):
        return {}

    candidates: List[Tuple[str, float]] = []
    breadth = 0
    for symbol in universe:
        index = indexes.get(symbol, {}).get(ts)
        if index is None:
            continue
        rows = bars[symbol]
        average = v4.sma(rows, index, asset_sma_bars)
        symbol_momentum = v4.momentum(rows, index, momentum_bars)
        vol = v4.realized_annual_vol(rows, index, momentum_bars)
        volume = v4.volume_ratio(rows, index)
        if average is None or symbol_momentum is None or vol is None or volume is None:
            continue
        close = float(rows[index]["close"])
        if close > average and symbol_momentum > 0:
            breadth += 1
            if volume >= 0.7:
                relative = symbol_momentum - btc_momentum
                score = symbol_momentum + relative * 0.3 - (vol / math.sqrt(36.5)) * 0.18 + min(2.0, volume)
                candidates.append((symbol, score))
    if breadth < 1 or not candidates:
        return {}
    selected = sorted(candidates, key=lambda item: item[1], reverse=True)[: min(component.top_k, len(candidates))]
    each = v4.BASE_ALLOCATION / len(selected)
    return {symbol: each for symbol, _ in selected}


def precompute_projected(
    components: List[v4.Component],
    times: List[int],
    bars: Dict[str, List[dict]],
    indexes: Dict[str, Dict[int, int]],
    universe: List[str],
) -> Dict[int, List[Dict[str, float]]]:
    current: List[Dict[str, float]] = [{} for _ in components]
    pending: List[Optional[Dict[str, float]]] = [None for _ in components]
    result: Dict[int, List[Dict[str, float]]] = {}
    for ts in times:
        for index, value in enumerate(pending):
            if value is not None:
                current[index] = value
                pending[index] = None
        projected: List[Dict[str, float]] = []
        for index, component in enumerate(components):
            candidate = component_target_universe(component, ts, bars, indexes, universe)
            rebalance_bars = max(1, round(component.rebalance_days * 2))
            scheduled = round((ts - v4.START_2023) / (12 * v4.HOUR)) % rebalance_bars == 0
            regime_exit = v4.gross_exposure(current[index]) > 0 and v4.gross_exposure(candidate) == 0
            if scheduled or regime_exit:
                pending[index] = candidate
                projected.append(candidate)
            else:
                projected.append(current[index])
        result[ts] = projected
    return result


def desired_targets(
    base: Dict[int, Dict[str, float]],
    bear: Dict[int, Dict[str, float]],
    times: List[int],
) -> Dict[int, Dict[str, float]]:
    confirmed = v6.confirmed_bear_series(bear, times, CONFIRM_BARS)
    return {
        ts: base.get(ts, {}) if v4.gross_exposure(base.get(ts, {})) > 0.05 else confirmed.get(ts, {})
        for ts in times
    }


def scenario_list() -> List[v7.ExecutionScenario]:
    return [
        v7.ExecutionScenario("BASE_10BPS", 10, 0, 0),
        v7.ExecutionScenario("COST30", 30, 0, 0),
        v7.ExecutionScenario("DELAY12H", 10, 1, 0),
        v7.ExecutionScenario("SEVERE_50BPS_DELAY12H_FUND3", 50, 1, 3),
    ]


def run_scenarios(
    targets: Dict[int, Dict[str, float]],
    times: List[int],
    bars: Dict[str, List[dict]],
    indexes: Dict[str, Dict[int, int]],
    funding: Dict[str, Dict[int, float]],
    start: int,
    end: int,
) -> Dict[str, dict]:
    return {
        scenario.scenario_id: v7.simulate_scenario(
            scenario, targets, times, bars, indexes, funding, start, end,
        )
        for scenario in scenario_list()
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


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    cache_root = Path.cwd() / ".cache" / "perp-research-usdm"
    raw = {symbol: v4.load_symbol(cache_root, symbol) for symbol in v4.SYMBOLS}

    pengu_candles = fetch_klines()
    pengu_funding = fetch_funding()
    raw[PENGU_SYMBOL] = {"candles": pengu_candles, "funding": pengu_funding}

    symbols = list(v4.SYMBOLS) + [PENGU_SYMBOL]
    bars = {symbol: v4.resample_12h(raw[symbol]["candles"]) for symbol in symbols}
    indexes = {symbol: {int(bar["ts"]): index for index, bar in enumerate(rows)} for symbol, rows in bars.items()}
    funding = v6.funding_buckets({symbol: raw[symbol]["funding"] for symbol in symbols})
    times = [int(bar["ts"]) for bar in bars["BTC"] if FETCH_START <= int(bar["ts"]) < END]

    first_pengu = min(int(bar["ts"]) for bar in bars[PENGU_SYMBOL])
    warmup_bars = 84
    common_start = first_pengu + warmup_bars * 12 * v4.HOUR
    common_start = next((ts for ts in times if ts >= common_start), common_start)
    if END - common_start < 120 * v4.DAY:
        raise RuntimeError(f"insufficient common PENGU test window: {fmt_date(common_start)} to {fmt_date(END)}")

    bear_map = v6.precompute_bear_targets([HEDGE], times, bars, indexes)[HEDGE.hedge_id]
    results: Dict[str, dict] = {}

    for strategy_id, universe in UNIVERSES.items():
        if strategy_id == "BASE_V6_CORE3":
            projected = v6.precompute_projected_members(COMPONENTS, times, bars, indexes)
        else:
            projected = precompute_projected(COMPONENTS, times, bars, indexes, universe)
        base_map = {
            ts: v4.overlay_target(OVERLAY, ts, projected[ts], bars, indexes)
            for ts in times
        }
        targets = desired_targets(base_map, bear_map, times)
        results[strategy_id] = {
            "universe": universe,
            "fullCommonWindow": run_scenarios(targets, times, bars, indexes, funding, common_start, END),
            "year2025": run_scenarios(
                targets, times, bars, indexes, funding,
                max(common_start, v4.START_2025), min(END, v4.START_2026),
            ),
            "year2026H1": run_scenarios(
                targets, times, bars, indexes, funding,
                max(common_start, v4.START_2026), END,
            ),
        }

    baseline = results["BASE_V6_CORE3"]["fullCommonWindow"]["BASE_10BPS"]
    comparisons: Dict[str, dict] = {}
    for strategy_id, item in results.items():
        metrics = item["fullCommonWindow"]["BASE_10BPS"]
        comparisons[strategy_id] = {
            "returnDeltaPct": metrics["compoundedReturnPct"] - baseline["compoundedReturnPct"],
            "cagrDeltaPct": metrics["cagrPct"] - baseline["cagrPct"],
            "winRateDeltaPct": (metrics["winRatePct"] or 0) - (baseline["winRatePct"] or 0),
            "profitFactorDelta": (metrics["profitFactor"] or 0) - (baseline["profitFactor"] or 0),
            "maxDrawdownImprovementPct": metrics["maxDrawdownPct"] - baseline["maxDrawdownPct"],
            "cycleDelta": metrics["cycles"] - baseline["cycles"],
        }

    pengu_main = results["PENGU_MAIN_ONLY"]
    pengu_main_base = pengu_main["fullCommonWindow"]["BASE_10BPS"]
    pengu_main_severe = pengu_main["fullCommonWindow"]["SEVERE_50BPS_DELAY12H_FUND3"]
    baseline_severe = results["BASE_V6_CORE3"]["fullCommonWindow"]["SEVERE_50BPS_DELAY12H_FUND3"]
    passed = (
        pengu_main_base["compoundedReturnPct"] > baseline["compoundedReturnPct"]
        and (pengu_main_base["profitFactor"] or 0) >= (baseline["profitFactor"] or 0)
        and pengu_main_base["maxDrawdownPct"] >= baseline["maxDrawdownPct"]
        and pengu_main_severe["compoundedReturnPct"] >= baseline_severe["compoundedReturnPct"]
        and (pengu_main_severe["profitFactor"] or 0) >= 1.0
    )
    status = "PENGU_MAIN_OUTPERFORMS_COMMON_WINDOW" if passed else "PENGU_MAIN_NOT_ROBUSTLY_BETTER"

    result = rounded({
        "version": 20,
        "strategyId": "PENGU_MAIN_CURRENCY_BACKTEST_V20",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": status,
        "data": {
            "penguSource": ASTER_BASE,
            "penguPair": PENGU_PAIR,
            "penguHourlyCandles": len(pengu_candles),
            "penguFundingPoints": len(pengu_funding),
            "penguFirstHourly": fmt_date(int(pengu_candles[0]["ts"])),
            "penguLastHourly": fmt_date(int(pengu_candles[-1]["ts"])),
            "commonStart": fmt_date(common_start),
            "commonEndExclusive": fmt_date(END),
            "note": "All strategies are compared only over the common PENGU data window.",
        },
        "fixedV6": {
            "components": [component.__dict__ for component in COMPONENTS],
            "overlay": OVERLAY.__dict__,
            "hedge": HEDGE.__dict__,
            "confirmBars": CONFIRM_BARS,
        },
        "strategies": results,
        "comparisonVsV6": comparisons,
        "penguMainPassed": passed,
        "productionChanged": False,
        "realTradingEnabled": False,
        "paperEligible": False,
        "liveEligible": False,
        "limitations": [
            "PENGU history is shorter than the original 2023-2026 V6 test history, so only the common available window is compared.",
            "PENGU candles and funding are sourced from Aster public futures endpoints; existing symbols use the frozen USD-M research cache.",
            "No parameters were optimized after seeing PENGU results.",
            "This is a research backtest only and does not modify production, VPS, account, positions or live runners.",
        ],
        "fingerprint": hashlib.sha256(json.dumps({
            "components": [component.__dict__ for component in COMPONENTS],
            "overlay": OVERLAY.__dict__,
            "hedge": HEDGE.__dict__,
            "confirmBars": CONFIRM_BARS,
            "universes": UNIVERSES,
            "scenarios": [scenario.__dict__ for scenario in scenario_list()],
        }, sort_keys=True).encode()).hexdigest(),
    })

    report = [
        "# PENGU Main Currency Backtest V20",
        "",
        f"- Status: **{status}**",
        f"- PENGU data: {result['data']['penguFirstHourly']} to {result['data']['penguLastHourly']}",
        f"- Common comparison window: {result['data']['commonStart']} to {result['data']['commonEndExclusive']}",
        f"- PENGU hourly candles: {result['data']['penguHourlyCandles']}",
        f"- PENGU funding points: {result['data']['penguFundingPoints']}",
        "- BTC regime and BTC bear hedge: UNCHANGED",
        "- Production changed: NO",
        "- Real trading: DISABLED",
        "",
        "## Common-window BASE 10bps",
        "",
        "| Strategy | Universe | Cycles | Win | CAGR | Compound | PF | DD | Stress PF |",
        "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for strategy_id in UNIVERSES:
        metrics = result["strategies"][strategy_id]["fullCommonWindow"]["BASE_10BPS"]
        report.append(
            f"| {strategy_id} | {','.join(UNIVERSES[strategy_id])} | {metrics['cycles']} | "
            f"{metrics['winRatePct']}% | {metrics['cagrPct']}% | {metrics['compoundedReturnPct']}% | "
            f"{metrics['profitFactor']} | {metrics['maxDrawdownPct']}% | {metrics['stressProfitFactor']} |"
        )

    report.extend([
        "",
        "## Severe execution stress",
        "",
        "| Strategy | Compound | PF | DD |",
        "| --- | ---: | ---: | ---: |",
    ])
    for strategy_id in UNIVERSES:
        metrics = result["strategies"][strategy_id]["fullCommonWindow"]["SEVERE_50BPS_DELAY12H_FUND3"]
        report.append(
            f"| {strategy_id} | {metrics['compoundedReturnPct']}% | {metrics['profitFactor']} | {metrics['maxDrawdownPct']}% |"
        )

    report.extend([
        "",
        "## Verdict",
        "",
        "PENGU-only main currency is robustly better than the frozen V6 over the common window."
        if passed else
        "PENGU-only main currency does not beat the frozen V6 across return, PF, DD and severe stress simultaneously.",
        "",
        "## Limitations",
        "",
        *[f"- {item}" for item in result["limitations"]],
    ])

    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "pengu-main-currency-backtest-v20.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8",
    )
    (state_dir / "pengu-main-currency-backtest-v20.md").write_text(
        "\n".join(report), encoding="utf-8",
    )
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
