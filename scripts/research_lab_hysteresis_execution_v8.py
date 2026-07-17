from __future__ import annotations

import hashlib
import json
import os
import statistics
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List

import research_lab_parameter_bagged_rotation_v4 as v4
import research_lab_asymmetric_bear_hedge_v5 as v5
import research_lab_precomputed_multi_regime_v6 as v6
import research_lab_fixed_candidate_robustness_v7 as v7


@dataclass(frozen=True)
class Controller:
    controller_id: str
    decision_interval_bars: int
    turnover_threshold: float
    min_hold_bars: int
    target_confirm_bars: int


def controller_list() -> List[Controller]:
    return [
        Controller(
            controller_id=f"HY_I{interval}_T{threshold}_H{hold}_Q{confirm}",
            decision_interval_bars=interval,
            turnover_threshold=threshold,
            min_hold_bars=hold,
            target_confirm_bars=confirm,
        )
        for interval in [1, 2, 4]
        for threshold in [0.1, 0.2, 0.3, 0.45]
        for hold in [0, 2, 4]
        for confirm in [1, 2]
    ]


def target_side(weights: Dict[str, float]) -> int:
    total = sum(weights.values())
    if total > 0.02:
        return 1
    if total < -0.02:
        return -1
    return 0


def control_targets(raw: Dict[int, Dict[str, float]], times: List[int], controller: Controller) -> Dict[int, Dict[str, float]]:
    current: Dict[str, float] = {}
    previous_raw: Dict[str, float] = {}
    stable_bars = 0
    bars_since_change = 10_000
    result: Dict[int, Dict[str, float]] = {}
    for index, ts in enumerate(times):
        desired = raw.get(ts, {})
        if v4.turnover(previous_raw, desired) <= 0.08:
            stable_bars += 1
        else:
            stable_bars = 1
        previous_raw = desired
        current_side = target_side(current)
        desired_side = target_side(desired)
        urgent_regime_change = current_side != desired_side
        scheduled = index % controller.decision_interval_bars == 0
        enough_hold = bars_since_change >= controller.min_hold_bars
        enough_confirm = stable_bars >= controller.target_confirm_bars
        material = v4.turnover(current, desired) >= controller.turnover_threshold
        if enough_confirm and material and (urgent_regime_change or (scheduled and enough_hold)):
            current = desired
            bars_since_change = 0
        else:
            bars_since_change += 1
        result[ts] = current
    return result


def scenarios() -> List[v7.ExecutionScenario]:
    return [
        v7.ExecutionScenario("BASE", 10, 0, 0),
        v7.ExecutionScenario("COST30", 30, 0, 0),
        v7.ExecutionScenario("DELAY12H", 10, 1, 0),
        v7.ExecutionScenario("SEVERE_COMBINED", 50, 1, 3),
    ]


def historical_pass(results: Dict[str, dict]) -> bool:
    base = results["BASE"]
    severe = results["SEVERE_COMBINED"]
    return (
        base["cycles"] >= 40
        and base["cagrPct"] >= 20
        and (base["profitFactor"] or 0) >= 1.25
        and base["maxDrawdownPct"] >= -30
        and all(base["annualReturnsPct"].get(year, -100) > 0 for year in ["2023", "2024", "2025"])
        and (base["bestCycleProfitSharePct"] or 100) <= 30
        and (base["profitFactorWithoutBest"] or 0) >= 1.15
        and all(item["compoundedReturnPct"] > 0 for item in results.values())
        and all((item["profitFactor"] or 0) >= 1.05 for item in results.values())
        and severe["cagrPct"] >= 5
        and severe["maxDrawdownPct"] >= -40
    )


def final_pass(results: Dict[str, dict]) -> bool:
    return (
        all(item["compoundedReturnPct"] > 0 for item in results.values())
        and all((item["profitFactor"] or 0) >= 1.0 for item in results.values())
        and all(item["maxDrawdownPct"] >= -20 for item in results.values())
        and results["SEVERE_COMBINED"]["compoundedReturnPct"] > 0
    )


def is_neighbor(left: Controller, right: Controller) -> bool:
    return (
        abs(left.decision_interval_bars - right.decision_interval_bars) <= 2
        and abs(left.turnover_threshold - right.turnover_threshold) <= 0.15
        and abs(left.min_hold_bars - right.min_hold_bars) <= 2
        and abs(left.target_confirm_bars - right.target_confirm_bars) <= 1
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
        raise RuntimeError("V6 candidate unavailable")
    variant = selected["variant"]
    overlay = v4.Overlay(**variant["overlay"])
    hedge = v5.Hedge(**variant["hedge"])
    confirm_bars = int(variant["confirm_bars"])
    components = v4.parse_components(v3_result)
    cache_root = Path.cwd() / ".cache" / "perp-research-usdm"
    raw_data = {symbol: v4.load_symbol(cache_root, symbol) for symbol in v4.SYMBOLS}
    bars = {symbol: v4.resample_12h(raw_data[symbol]["candles"]) for symbol in v4.SYMBOLS}
    indexes = {symbol: {int(bar["ts"]): index for index, bar in enumerate(rows)} for symbol, rows in bars.items()}
    funding = v6.funding_buckets({symbol: raw_data[symbol]["funding"] for symbol in v4.SYMBOLS})
    times = [int(bar["ts"]) for bar in bars["BTC"] if v4.START_2023 <= int(bar["ts"]) < v4.END]
    projected = v6.precompute_projected_members(components, times, bars, indexes)
    base_targets = v6.precompute_base_targets([overlay], times, projected, bars, indexes)
    bear_targets = v6.precompute_bear_targets([hedge], times, bars, indexes)
    raw_targets = v7.desired_targets(overlay, hedge, confirm_bars, times, base_targets, bear_targets)

    candidates: List[dict] = []
    controllers = controller_list()
    controller_map = {item.controller_id: item for item in controllers}
    for controller in controllers:
        controlled = control_targets(raw_targets, times, controller)
        history_results = {
            scenario.scenario_id: v7.simulate_scenario(
                scenario, controlled, times, bars, indexes, funding, v4.START_2023, v4.START_2026,
            )
            for scenario in scenarios()
        }
        candidates.append({
            "controller": controller.__dict__,
            "historyScenarios": history_results,
            "historicalPassed": historical_pass(history_results),
            "neighborCount": 0,
            "neighborhoodScore": -999.0,
        })

    passed = [item for item in candidates if item["historicalPassed"]]
    for item in passed:
        left = controller_map[item["controller"]["controller_id"]]
        neighbors = [other for other in passed if is_neighbor(left, controller_map[other["controller"]["controller_id"]])]
        item["neighborCount"] = len(neighbors)
        item["neighborhoodScore"] = statistics.median(
            min(result["cagrPct"] for result in other["historyScenarios"].values()) for other in neighbors
        ) if neighbors else -999.0

    robust = [item for item in passed if item["neighborCount"] >= 4]
    robust.sort(key=lambda item: (
        item["neighborhoodScore"],
        item["historyScenarios"]["SEVERE_COMBINED"]["profitFactor"] or 0,
        -item["historyScenarios"]["BASE"]["turnover"],
    ), reverse=True)
    selected_controller = robust[0] if robust else None
    final_results = None
    if selected_controller:
        controller = controller_map[selected_controller["controller"]["controller_id"]]
        controlled = control_targets(raw_targets, times, controller)
        final_results = {
            scenario.scenario_id: v7.simulate_scenario(
                scenario, controlled, times, bars, indexes, funding, v4.START_2026, v4.END,
            )
            for scenario in scenarios()
        }
    final_ok = final_pass(final_results) if final_results else False
    status = "FORWARD_PAPER_READY_ADAPTIVE" if final_ok else ("FINAL_TEMPORAL_STRESS_REJECTED" if selected_controller else "NO_ROBUST_EXECUTION_CONTROLLER")
    result = rounded({
        "version": 8,
        "strategyId": "HYSTERESIS_EXECUTION_STABILIZED_V8",
        "generatedAt": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        "status": status,
        "fixedSignalVariant": variant,
        "source": {
            "controllers": len(controllers),
            "executionScenarios": len(scenarios()),
            "historicalPassed": len(passed),
            "robustNeighborhoods": len(robust),
        },
        "selected": {
            **selected_controller,
            "final2026H1Scenarios": final_results,
            "finalPassed": final_ok,
            "paperEligible": final_ok,
            "liveEligible": False,
            "liveBlockReasons": [
                "V8は過去Holdout確認後のadaptive研究",
                "独立Forward Paper未実施",
                "Aster実約定Spread/Slippage未検証",
                "CIO承認前",
            ],
        } if selected_controller else None,
        "topHistorical": robust[:15] if robust else candidates[:15],
        "productionChanged": False,
        "realTradingEnabled": False,
        "fingerprint": hashlib.sha256(json.dumps({
            "variant": variant,
            "controllers": [controller.__dict__ for controller in controllers],
            "scenarios": [scenario.__dict__ for scenario in scenarios()],
        }, sort_keys=True).encode()).hexdigest(),
        "limitations": [
            "Entry/Regimeは固定し、実行Hysteresisだけを2023-2025で選定する。",
            "2026H1は選定後に一度だけ最終temporal stressとして評価する。",
            "adaptive研究なので通過してもForward Paper専用でLiveは禁止する。",
            "本番コード、VPS、.env、実売買runnerは変更していない。",
        ],
    })

    report = [
        "# Hysteresis Execution-Stabilized V8",
        "",
        f"- Status: **{status}**",
        f"- Controllers: {len(controllers)}",
        f"- Historical pass: {len(passed)}",
        f"- Robust neighborhoods: {len(robust)}",
        "- Production changed: NO",
        "- Real trading: DISABLED",
        "",
        "## Selected",
        "",
    ]
    if result["selected"]:
        report.extend([
            f"- Controller: **{result['selected']['controller']['controller_id']}**",
            f"- Neighbor count: {result['selected']['neighborCount']}",
            f"- Final 2026H1 pass: **{'YES' if result['selected']['finalPassed'] else 'NO'}**",
            f"- Paper eligible: **{'YES' if result['selected']['paperEligible'] else 'NO'}**",
            "",
            "| Scenario | 2023-2025 Compound | CAGR | PF | DD | 2026H1 Compound | PF | DD |",
            "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
            *[
                f"| {scenario.scenario_id} | {result['selected']['historyScenarios'][scenario.scenario_id]['compoundedReturnPct']}% | {result['selected']['historyScenarios'][scenario.scenario_id]['cagrPct']}% | {result['selected']['historyScenarios'][scenario.scenario_id]['profitFactor']} | {result['selected']['historyScenarios'][scenario.scenario_id]['maxDrawdownPct']}% | {result['selected']['final2026H1Scenarios'][scenario.scenario_id]['compoundedReturnPct']}% | {result['selected']['final2026H1Scenarios'][scenario.scenario_id]['profitFactor']} | {result['selected']['final2026H1Scenarios'][scenario.scenario_id]['maxDrawdownPct']}% |"
                for scenario in scenarios()
            ],
        ])
    else:
        report.append("2023-2025のExecution Ensembleを通るControllerはありませんでした。")
    report.extend([
        "",
        "## Verdict",
        "",
        "Forward Paper開始資格があります。Liveは禁止です。" if final_ok else "Paper候補なし。Liveは禁止を維持します。",
        "",
        "## Limitations",
        "",
        *[f"- {item}" for item in result["limitations"]],
    ])
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "hysteresis-execution-stabilized-v8.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    (state_dir / "hysteresis-execution-stabilized-v8.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
