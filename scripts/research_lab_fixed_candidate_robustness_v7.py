from __future__ import annotations

import hashlib
import json
import os
import statistics
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional

import research_lab_parameter_bagged_rotation_v4 as v4
import research_lab_asymmetric_bear_hedge_v5 as v5
import research_lab_precomputed_multi_regime_v6 as v6


@dataclass(frozen=True)
class ExecutionScenario:
    scenario_id: str
    cost_bps_per_side: float
    extra_delay_bars: int
    adverse_funding_bps_per_12h: float


def scenario_list() -> List[ExecutionScenario]:
    return [
        ExecutionScenario("BASE", 10, 0, 0),
        ExecutionScenario("COST20", 20, 0, 0),
        ExecutionScenario("COST30", 30, 0, 0),
        ExecutionScenario("COST50", 50, 0, 0),
        ExecutionScenario("DELAY12H", 10, 1, 0),
        ExecutionScenario("DELAY24H", 10, 2, 0),
        ExecutionScenario("COST30_DELAY12H", 30, 1, 0),
        ExecutionScenario("ADVERSE_FUNDING_3BPS", 10, 0, 3),
        ExecutionScenario("SEVERE_COMBINED", 50, 1, 3),
    ]


def desired_targets(
    overlay: v4.Overlay,
    hedge: v5.Hedge,
    confirm_bars: int,
    times: List[int],
    base_targets: Dict[str, Dict[int, Dict[str, float]]],
    bear_targets: Dict[str, Dict[int, Dict[str, float]]],
) -> Dict[int, Dict[str, float]]:
    confirmed = v6.confirmed_bear_series(bear_targets[hedge.hedge_id], times, confirm_bars)
    result: Dict[int, Dict[str, float]] = {}
    for ts in times:
        base = base_targets[overlay.overlay_id].get(ts, {})
        result[ts] = base if v4.gross_exposure(base) > 0.05 else confirmed.get(ts, {})
    return result


def simulate_scenario(
    scenario: ExecutionScenario,
    targets: Dict[int, Dict[str, float]],
    times: List[int],
    bars: Dict[str, List[dict]],
    indexes: Dict[str, Dict[int, int]],
    funding: Dict[str, Dict[int, float]],
    start: int,
    end: int,
) -> dict:
    active_times = [ts for ts in times if start <= ts < end]
    if len(active_times) < 2:
        return v4.metrics([], [], start, end)
    global_index = {ts: index for index, ts in enumerate(times)}
    portfolio: Dict[str, float] = {}
    rows: List[dict] = []
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
        bar_turnover = 0.0
        if next_portfolio != portfolio:
            close_cycle(ts - 1)
            bar_turnover = v4.turnover(portfolio, next_portfolio)
            portfolio = next_portfolio
            if v4.gross_exposure(portfolio) > 0:
                cycle_start = ts

        gross = 0.0
        actual_funding = 0.0
        for symbol, weight in portfolio.items():
            symbol_index = indexes[symbol].get(ts)
            if symbol_index is None:
                continue
            bar = bars[symbol][symbol_index]
            gross += weight * ((float(bar["close"]) / float(bar["open"]) - 1.0) * 100.0)
            actual_funding += weight * funding.get(symbol, {}).get(ts, 0.0)
        cost_pct = bar_turnover * scenario.cost_bps_per_side / 100.0
        adverse_funding_pct = v4.gross_exposure(portfolio) * scenario.adverse_funding_bps_per_12h / 100.0
        value = gross - actual_funding - cost_pct - adverse_funding_pct
        rows.append({
            "ts": ts,
            "normal_pct": value,
            "stress_pct": value,
            "exposure": v4.gross_exposure(portfolio),
            "turnover": bar_turnover,
        })
        if cycle_start >= 0:
            cycle_returns.append(value)

    final_turnover = v4.gross_exposure(portfolio)
    if final_turnover > 0 and rows:
        final_cost = final_turnover * scenario.cost_bps_per_side / 100.0
        rows[-1]["normal_pct"] -= final_cost
        rows[-1]["stress_pct"] -= final_cost
        rows[-1]["turnover"] += final_turnover
        if cycle_returns:
            cycle_returns[-1] -= final_cost
    close_cycle(end - 1)
    return v4.metrics(rows, cycles, start, end)


def audit_pass(history: dict, final: dict) -> bool:
    return (
        history["compoundedReturnPct"] > 0
        and (history["profitFactor"] or 0) >= 1.1
        and history["maxDrawdownPct"] >= -40
        and final["compoundedReturnPct"] > 0
        and (final["profitFactor"] or 0) >= 1.0
        and final["maxDrawdownPct"] >= -20
    )


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
    v3_result = json.loads((state_dir / "multi-horizon-regime-rotation-v3.json").read_text(encoding="utf-8"))
    v6_result = json.loads((state_dir / "precomputed-multi-regime-rotation-v6.json").read_text(encoding="utf-8"))
    selected = v6_result.get("selected")
    if not selected or not selected.get("finalPassed"):
        raise RuntimeError("V6 fixed candidate is unavailable")

    variant = selected["variant"]
    fixed_overlay = v4.Overlay(**variant["overlay"])
    fixed_hedge = v5.Hedge(**variant["hedge"])
    fixed_confirm = int(variant["confirm_bars"])
    components = v4.parse_components(v3_result)
    cache_root = Path.cwd() / ".cache" / "perp-research-usdm"
    raw = {symbol: v4.load_symbol(cache_root, symbol) for symbol in v4.SYMBOLS}
    bars = {symbol: v4.resample_12h(raw[symbol]["candles"]) for symbol in v4.SYMBOLS}
    indexes = {symbol: {int(bar["ts"]): index for index, bar in enumerate(rows)} for symbol, rows in bars.items()}
    funding = v6.funding_buckets({symbol: raw[symbol]["funding"] for symbol in v4.SYMBOLS})
    times = [int(bar["ts"]) for bar in bars["BTC"] if v4.START_2023 <= int(bar["ts"]) < v4.END]
    hedges = [
        v5.Hedge(
            hedge_id=f"AUDIT_BTC_S{slow}_M{momentum}_G{gross}",
            slow_days=slow,
            momentum_days=momentum,
            gross=gross,
            mode="BTC",
        )
        for slow in [60, 90]
        for momentum in [20, 30]
        for gross in [0.25, 0.4, 0.6]
    ]
    hedge_map = {hedge.hedge_id: hedge for hedge in hedges}
    if fixed_hedge.hedge_id not in hedge_map:
        hedge_map[fixed_hedge.hedge_id] = fixed_hedge
    all_hedges = list(hedge_map.values())

    projected = v6.precompute_projected_members(components, times, bars, indexes)
    base_targets = v6.precompute_base_targets([fixed_overlay], times, projected, bars, indexes)
    bear_targets = v6.precompute_bear_targets(all_hedges, times, bars, indexes)
    fixed_targets = desired_targets(fixed_overlay, fixed_hedge, fixed_confirm, times, base_targets, bear_targets)

    execution_results: List[dict] = []
    for scenario in scenario_list():
        history = simulate_scenario(scenario, fixed_targets, times, bars, indexes, funding, v4.START_2023, v4.START_2026)
        final = simulate_scenario(scenario, fixed_targets, times, bars, indexes, funding, v4.START_2026, v4.END)
        execution_results.append({
            "scenario": scenario.__dict__,
            "history": history,
            "final2026H1": final,
            "passed": audit_pass(history, final),
        })

    dropout_results: List[dict] = []
    for dropped_index, dropped in enumerate(components):
        subset = [component for index, component in enumerate(components) if index != dropped_index]
        subset_projected = v6.precompute_projected_members(subset, times, bars, indexes)
        subset_base = v6.precompute_base_targets([fixed_overlay], times, subset_projected, bars, indexes)
        subset_targets = desired_targets(fixed_overlay, fixed_hedge, fixed_confirm, times, subset_base, bear_targets)
        scenario = ExecutionScenario("BASE", 10, 0, 0)
        history = simulate_scenario(scenario, subset_targets, times, bars, indexes, funding, v4.START_2023, v4.START_2026)
        final = simulate_scenario(scenario, subset_targets, times, bars, indexes, funding, v4.START_2026, v4.END)
        dropout_results.append({
            "droppedComponent": dropped.model_id,
            "history": history,
            "final2026H1": final,
            "passed": audit_pass(history, final),
        })

    neighbor_results: List[dict] = []
    base_scenario = ExecutionScenario("BASE", 10, 0, 0)
    for hedge in all_hedges:
        for confirm in [2, 4, 6]:
            targets = desired_targets(fixed_overlay, hedge, confirm, times, base_targets, bear_targets)
            history = simulate_scenario(base_scenario, targets, times, bars, indexes, funding, v4.START_2023, v4.START_2026)
            final = simulate_scenario(base_scenario, targets, times, bars, indexes, funding, v4.START_2026, v4.END)
            neighbor_results.append({
                "hedge": hedge.__dict__,
                "confirmBars": confirm,
                "history": history,
                "final2026H1": final,
                "passed": audit_pass(history, final),
            })

    execution_passes = sum(1 for item in execution_results if item["passed"])
    dropout_passes = sum(1 for item in dropout_results if item["passed"])
    neighbor_passes = sum(1 for item in neighbor_results if item["passed"])
    execution_final_values = [item["final2026H1"]["compoundedReturnPct"] for item in execution_results]
    dropout_final_values = [item["final2026H1"]["compoundedReturnPct"] for item in dropout_results]
    neighbor_final_values = [item["final2026H1"]["compoundedReturnPct"] for item in neighbor_results]
    severe = next(item for item in execution_results if item["scenario"]["scenario_id"] == "SEVERE_COMBINED")
    gates = {
        "executionPassRate": execution_passes / len(execution_results),
        "dropoutPassRate": dropout_passes / len(dropout_results),
        "neighborPassRate": neighbor_passes / len(neighbor_results),
        "executionMedianFinalPct": statistics.median(execution_final_values),
        "dropoutMedianFinalPct": statistics.median(dropout_final_values),
        "neighborMedianFinalPct": statistics.median(neighbor_final_values),
        "executionWorstFinalPct": min(execution_final_values),
        "severeFinalPct": severe["final2026H1"]["compoundedReturnPct"],
    }
    passed = (
        gates["executionPassRate"] >= 0.66
        and gates["dropoutPassRate"] >= 0.8
        and gates["neighborPassRate"] >= 0.66
        and gates["executionMedianFinalPct"] > 0
        and gates["dropoutMedianFinalPct"] > 0
        and gates["neighborMedianFinalPct"] > 0
        and gates["executionWorstFinalPct"] >= -10
        and gates["severeFinalPct"] >= -5
    )
    status = "FORWARD_PAPER_READY_ADAPTIVE" if passed else "ROBUSTNESS_AUDIT_REJECTED"
    result = rounded({
        "version": 7,
        "strategyId": "FIXED_V6_ROBUSTNESS_AUDIT_V7",
        "generatedAt": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        "status": status,
        "fixedVariant": variant,
        "productionChanged": False,
        "realTradingEnabled": False,
        "gates": gates,
        "executionScenarios": execution_results,
        "componentDropouts": dropout_results,
        "parameterNeighbors": neighbor_results,
        "passed": passed,
        "paperEligible": passed,
        "liveEligible": False,
        "liveBlockReasons": [
            "V6/V7は過去Holdout確認後のadaptive研究",
            "独立した将来Forward Paper 100 cycles未達",
            "Aster実約定Spread/Slippage未検証",
            "CIO承認前",
        ],
        "fingerprint": hashlib.sha256(json.dumps({
            "variant": variant,
            "scenarios": [scenario.__dict__ for scenario in scenario_list()],
            "dropouts": [component.model_id for component in components],
            "neighbors": [hedge.__dict__ for hedge in all_hedges],
            "confirm": [2, 4, 6],
        }, sort_keys=True).encode()).hexdigest(),
        "limitations": [
            "固定済みV6を再最適化せず、実行条件・構成脱落・近接Hedgeだけを監査する。",
            "過去データを使うadaptive監査のため、Forward Paperの代替にはならない。",
            "通過してもLiveではなくForward Paper開始資格のみ。",
            "本番コード、VPS、.env、実売買runnerは変更していない。",
        ],
    })

    report = [
        "# Fixed V6 Robustness Audit V7",
        "",
        f"- Status: **{status}**",
        f"- Fixed variant: **{variant['variant_id']}**",
        f"- Execution scenarios passed: {execution_passes}/{len(execution_results)}",
        f"- Component dropouts passed: {dropout_passes}/{len(dropout_results)}",
        f"- Parameter neighbors passed: {neighbor_passes}/{len(neighbor_results)}",
        f"- Execution median 2026H1: {result['gates']['executionMedianFinalPct']}%",
        f"- Execution worst 2026H1: {result['gates']['executionWorstFinalPct']}%",
        f"- Severe combined 2026H1: {result['gates']['severeFinalPct']}%",
        f"- Dropout median 2026H1: {result['gates']['dropoutMedianFinalPct']}%",
        f"- Neighbor median 2026H1: {result['gates']['neighborMedianFinalPct']}%",
        "- Production changed: NO",
        "- Real trading: DISABLED",
        "",
        "## Execution scenarios",
        "",
        "| Scenario | 2023-2025 | PF | DD | 2026H1 | PF | DD | Pass |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
        *[
            f"| {item['scenario']['scenario_id']} | {round(item['history']['compoundedReturnPct'], 2)}% | {round(item['history']['profitFactor'] or 0, 2)} | {round(item['history']['maxDrawdownPct'], 2)}% | {round(item['final2026H1']['compoundedReturnPct'], 2)}% | {round(item['final2026H1']['profitFactor'] or 0, 2)} | {round(item['final2026H1']['maxDrawdownPct'], 2)}% | {'YES' if item['passed'] else 'NO'} |"
            for item in result["executionScenarios"]
        ],
        "",
        "## Verdict",
        "",
        "固定候補はRobustness Auditを通過しました。Forward Paper開始資格がありますが、Liveは禁止です。" if passed else "固定候補はRobustness Auditを通過できず、Paper候補を撤回します。",
        "",
        "## Limitations",
        "",
        *[f"- {item}" for item in result["limitations"]],
    ]
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "fixed-v6-robustness-audit-v7.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    (state_dir / "fixed-v6-robustness-audit-v7.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
