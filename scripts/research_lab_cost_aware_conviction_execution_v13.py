from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List

import research_lab_parameter_bagged_rotation_v4 as v4
import research_lab_asymmetric_bear_hedge_v5 as v5
import research_lab_precomputed_multi_regime_v6 as v6
import research_lab_fixed_candidate_robustness_v7 as v7


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


@dataclass(frozen=True)
class Controller:
    controller_id: str
    planning_cost_bps: float
    edge_scale_bps: float
    reserve_bps: float
    max_turnover_per_bar: float
    max_turnover_per_day: float
    adverse_funding_cap_bps: float
    min_entry_support: float
    entry_confirm_bars: int


def controllers() -> List[Controller]:
    # Small, economically motivated neighborhood.  No 2025/2026 result is used
    # to alter these values in the same research run.
    return [
        Controller("CA_C30_E150_R5_S25_D50_F2_Q1", 30, 150, 5, 0.25, 0.50, 2.0, 0.60, 1),
        Controller("CA_C30_E180_R5_S25_D40_F2_Q1", 30, 180, 5, 0.25, 0.40, 2.0, 0.60, 1),
        Controller("CA_C40_E180_R5_S20_D35_F1.5_Q1", 40, 180, 5, 0.20, 0.35, 1.5, 0.60, 1),
        Controller("CA_C25_E150_R5_S30_D60_F3_Q1", 25, 150, 5, 0.30, 0.60, 3.0, 0.55, 1),
        Controller("CA_C30_E150_R8_S20_D35_F2_Q2", 30, 150, 8, 0.20, 0.35, 2.0, 0.60, 2),
    ]


def scenarios() -> List[v7.ExecutionScenario]:
    return [
        v7.ExecutionScenario("BASE_10BPS", 10, 0, 0),
        v7.ExecutionScenario("COST30", 30, 0, 0),
        v7.ExecutionScenario("DELAY12H", 10, 1, 0),
        v7.ExecutionScenario("SEVERE_50BPS_DELAY12H_FUND3", 50, 1, 3),
    ]


def target_side(weights: Dict[str, float]) -> int:
    net = sum(weights.values())
    if net > 0.02:
        return 1
    if net < -0.02:
        return -1
    return 0


def clean(weights: Dict[str, float]) -> Dict[str, float]:
    return {symbol: value for symbol, value in weights.items() if abs(value) >= 1e-6}


def scale_weights(weights: Dict[str, float], scale: float) -> Dict[str, float]:
    return clean({symbol: weight * scale for symbol, weight in weights.items()})


def move_toward(current: Dict[str, float], desired: Dict[str, float], allowed_turnover: float) -> Dict[str, float]:
    required = v4.turnover(current, desired)
    if required <= allowed_turnover + 1e-12:
        return clean(dict(desired))
    if required <= 0 or allowed_turnover <= 0:
        return clean(dict(current))
    fraction = allowed_turnover / required
    symbols = set(current) | set(desired)
    return clean({
        symbol: current.get(symbol, 0.0) + (desired.get(symbol, 0.0) - current.get(symbol, 0.0)) * fraction
        for symbol in symbols
    })


def vote_maps(projected: Dict[int, List[Dict[str, float]]], times: List[int]) -> Dict[int, Dict[str, float]]:
    result: Dict[int, Dict[str, float]] = {}
    for ts in times:
        members = projected[ts]
        denominator = max(1, len(members))
        symbols = set().union(*(weights.keys() for weights in members)) if members else set()
        result[ts] = {
            symbol: sum(1 for weights in members if weights.get(symbol, 0.0) > 0.01) / denominator
            for symbol in symbols
        }
    return result


def weighted_conviction(weights: Dict[str, float], votes: Dict[str, float]) -> float:
    gross = v4.gross_exposure(weights)
    if gross <= 0:
        return 0.0
    if target_side(weights) < 0:
        # Bear hedge has already passed the fixed four-bar confirmation gate.
        return 1.0
    return sum(abs(weight) * votes.get(symbol, 0.0) for symbol, weight in weights.items()) / gross


def trailing_adverse_funding_bps(
    target: Dict[str, float],
    ts: int,
    funding: Dict[str, Dict[int, float]],
) -> float:
    # Funding buckets are percentage points per 12h.  Only information at or
    # before the signal bar is used.
    previous_ts = ts - 12 * v4.HOUR
    adverse_pct = 0.0
    for symbol, weight in target.items():
        current_rate = funding.get(symbol, {}).get(ts, 0.0)
        previous_rate = funding.get(symbol, {}).get(previous_ts, 0.0)
        trailing_rate = (current_rate + previous_rate) / 2.0
        adverse_pct += max(0.0, weight * trailing_rate)
    return adverse_pct * 100.0


def funding_adjusted_target(
    desired: Dict[str, float],
    ts: int,
    funding: Dict[str, Dict[int, float]],
    cap_bps: float,
) -> Dict[str, float]:
    adverse = trailing_adverse_funding_bps(desired, ts, funding)
    if adverse <= cap_bps or adverse <= 0:
        return desired
    # Preserve the signal direction but reduce gross exposure when carry is
    # already worse than the controller's economic budget.
    return scale_weights(desired, max(0.40, cap_bps / adverse))


def controlled_targets(
    raw_targets: Dict[int, Dict[str, float]],
    projected: Dict[int, List[Dict[str, float]]],
    funding: Dict[str, Dict[int, float]],
    times: List[int],
    controller: Controller,
) -> Dict[int, Dict[str, float]]:
    votes_by_ts = vote_maps(projected, times)
    current: Dict[str, float] = {}
    result: Dict[int, Dict[str, float]] = {}
    last_side = 0
    side_stable_bars = 0
    recent_turnover = [0.0, 0.0]

    for ts in times:
        raw = raw_targets.get(ts, {})
        desired = funding_adjusted_target(raw, ts, funding, controller.adverse_funding_cap_bps)
        desired_side = target_side(desired)
        current_side = target_side(current)

        if desired_side == last_side:
            side_stable_bars += 1
        else:
            last_side = desired_side
            side_stable_bars = 1

        executed_turnover = 0.0

        # Risk-off is immediate. Opposite-side transitions first flatten the
        # old position instead of paying a full long-to-short rotation in one bar.
        if desired_side == 0:
            next_target = {}
        elif current_side != 0 and desired_side != current_side:
            next_target = move_toward(current, {}, controller.max_turnover_per_bar)
        elif current_side == 0:
            support = weighted_conviction(desired, votes_by_ts.get(ts, {}))
            if side_stable_bars >= controller.entry_confirm_bars and (
                desired_side < 0 or support >= controller.min_entry_support
            ):
                remaining_daily = max(0.0, controller.max_turnover_per_day - sum(recent_turnover))
                next_target = move_toward(current, desired, min(controller.max_turnover_per_bar, remaining_daily))
            else:
                next_target = current
        else:
            requested = v4.turnover(current, desired)
            if requested < 0.08:
                next_target = current
            elif desired_side > 0:
                current_conviction = weighted_conviction(current, votes_by_ts.get(ts, {}))
                desired_conviction = weighted_conviction(desired, votes_by_ts.get(ts, {}))
                expected_edge_bps = max(0.0, desired_conviction - current_conviction) * controller.edge_scale_bps
                required_edge_bps = controller.reserve_bps + requested * controller.planning_cost_bps
                if expected_edge_bps < required_edge_bps:
                    next_target = current
                else:
                    remaining_daily = max(0.0, controller.max_turnover_per_day - sum(recent_turnover))
                    next_target = move_toward(current, desired, min(controller.max_turnover_per_bar, remaining_daily))
            else:
                remaining_daily = max(0.0, controller.max_turnover_per_day - sum(recent_turnover))
                next_target = move_toward(current, desired, min(controller.max_turnover_per_bar, remaining_daily))

        executed_turnover = v4.turnover(current, next_target)
        current = clean(next_target)
        recent_turnover = [recent_turnover[-1], executed_turnover]
        result[ts] = dict(current)

    return result


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
        for scenario in scenarios()
    }


def improvement_snapshot(controlled: Dict[str, dict], baseline: Dict[str, dict]) -> dict:
    return {
        "turnoverReductionPct": (
            (1.0 - controlled["BASE_10BPS"]["turnover"] / baseline["BASE_10BPS"]["turnover"]) * 100.0
            if baseline["BASE_10BPS"]["turnover"] > 0 else 0.0
        ),
        "baseCagrRetentionPct": (
            controlled["BASE_10BPS"]["cagrPct"] / baseline["BASE_10BPS"]["cagrPct"] * 100.0
            if baseline["BASE_10BPS"]["cagrPct"] > 0 else 0.0
        ),
        "cost30PfDelta": (controlled["COST30"]["profitFactor"] or 0) - (baseline["COST30"]["profitFactor"] or 0),
        "delayPfDelta": (controlled["DELAY12H"]["profitFactor"] or 0) - (baseline["DELAY12H"]["profitFactor"] or 0),
        "severeReturnDeltaPct": (
            controlled["SEVERE_50BPS_DELAY12H_FUND3"]["compoundedReturnPct"]
            - baseline["SEVERE_50BPS_DELAY12H_FUND3"]["compoundedReturnPct"]
        ),
    }


def development_pass(results: Dict[str, dict], baseline: Dict[str, dict], improvement: dict) -> bool:
    base = results["BASE_10BPS"]
    severe = results["SEVERE_50BPS_DELAY12H_FUND3"]
    return (
        base["cycles"] >= 30
        and base["cagrPct"] >= 20
        and (base["profitFactor"] or 0) >= 1.25
        and base["maxDrawdownPct"] >= -30
        and all(base["annualReturnsPct"].get(year, -100) > 0 for year in ["2023", "2024"])
        and all(item["compoundedReturnPct"] > 0 for item in results.values())
        and (results["COST30"]["profitFactor"] or 0) >= 1.15
        and (results["DELAY12H"]["profitFactor"] or 0) >= 1.10
        and (severe["profitFactor"] or 0) >= 1.05
        and improvement["turnoverReductionPct"] >= 20
        and improvement["baseCagrRetentionPct"] >= 70
        and improvement["severeReturnDeltaPct"] > 0
    )


def validation_pass(results: Dict[str, dict], baseline: Dict[str, dict], improvement: dict) -> bool:
    return (
        results["BASE_10BPS"]["compoundedReturnPct"] > 0
        and (results["BASE_10BPS"]["profitFactor"] or 0) >= 1.20
        and results["COST30"]["compoundedReturnPct"] > 0
        and (results["COST30"]["profitFactor"] or 0) >= 1.10
        and results["DELAY12H"]["compoundedReturnPct"] > 0
        and (results["DELAY12H"]["profitFactor"] or 0) >= 1.05
        and results["SEVERE_50BPS_DELAY12H_FUND3"]["compoundedReturnPct"] > 0
        and (results["SEVERE_50BPS_DELAY12H_FUND3"]["profitFactor"] or 0) >= 1.00
        and all(item["maxDrawdownPct"] >= -25 for item in results.values())
        and improvement["turnoverReductionPct"] >= 20
        and improvement["baseCagrRetentionPct"] >= 65
        and improvement["severeReturnDeltaPct"] > 0
    )


def holdout_pass(results: Dict[str, dict]) -> bool:
    return (
        results["BASE_10BPS"]["compoundedReturnPct"] > 0
        and (results["BASE_10BPS"]["profitFactor"] or 0) >= 1.15
        and results["COST30"]["compoundedReturnPct"] > 0
        and (results["COST30"]["profitFactor"] or 0) >= 1.10
        and results["DELAY12H"]["compoundedReturnPct"] > 0
        and (results["DELAY12H"]["profitFactor"] or 0) >= 1.05
        and results["SEVERE_50BPS_DELAY12H_FUND3"]["compoundedReturnPct"] >= 0
        and (results["SEVERE_50BPS_DELAY12H_FUND3"]["profitFactor"] or 0) >= 1.00
        and all(item["maxDrawdownPct"] >= -20 for item in results.values())
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
    cache_root = Path.cwd() / ".cache" / "perp-research-usdm"
    raw_data = {symbol: v4.load_symbol(cache_root, symbol) for symbol in v4.SYMBOLS}
    bars = {symbol: v4.resample_12h(raw_data[symbol]["candles"]) for symbol in v4.SYMBOLS}
    indexes = {symbol: {int(bar["ts"]): index for index, bar in enumerate(rows)} for symbol, rows in bars.items()}
    funding = v6.funding_buckets({symbol: raw_data[symbol]["funding"] for symbol in v4.SYMBOLS})
    times = [int(bar["ts"]) for bar in bars["BTC"] if v4.START_2023 <= int(bar["ts"]) < v4.END]

    projected = v6.precompute_projected_members(COMPONENTS, times, bars, indexes)
    base_targets = v6.precompute_base_targets([OVERLAY], times, projected, bars, indexes)
    bear_targets = v6.precompute_bear_targets([HEDGE], times, bars, indexes)
    raw_targets = v7.desired_targets(OVERLAY, HEDGE, CONFIRM_BARS, times, base_targets, bear_targets)

    baseline_development = run_scenarios(raw_targets, times, bars, indexes, funding, v4.START_2023, v4.START_2025)
    baseline_validation = run_scenarios(raw_targets, times, bars, indexes, funding, v4.START_2025, v4.START_2026)

    candidates: List[dict] = []
    controlled_map: Dict[str, Dict[int, Dict[str, float]]] = {}
    controller_map = {controller.controller_id: controller for controller in controllers()}
    for controller in controllers():
        controlled = controlled_targets(raw_targets, projected, funding, times, controller)
        controlled_map[controller.controller_id] = controlled
        development = run_scenarios(controlled, times, bars, indexes, funding, v4.START_2023, v4.START_2025)
        improvement = improvement_snapshot(development, baseline_development)
        candidates.append({
            "controller": controller.__dict__,
            "development": development,
            "developmentImprovement": improvement,
            "developmentPassed": development_pass(development, baseline_development, improvement),
        })

    passed = [item for item in candidates if item["developmentPassed"]]
    passed.sort(key=lambda item: (
        min((metrics["profitFactor"] or 0) for metrics in item["development"].values()),
        item["developmentImprovement"]["severeReturnDeltaPct"],
        item["developmentImprovement"]["turnoverReductionPct"],
        item["development"]["BASE_10BPS"]["cagrPct"],
    ), reverse=True)

    selected = passed[0] if passed else None
    validation = None
    validation_improvement = None
    validation_ok = False
    holdout = None
    holdout_ok = False
    if selected:
        controller_id = selected["controller"]["controller_id"]
        controlled = controlled_map[controller_id]
        validation = run_scenarios(controlled, times, bars, indexes, funding, v4.START_2025, v4.START_2026)
        validation_improvement = improvement_snapshot(validation, baseline_validation)
        validation_ok = validation_pass(validation, baseline_validation, validation_improvement)
        if validation_ok:
            holdout = run_scenarios(controlled, times, bars, indexes, funding, v4.START_2026, v4.END)
            holdout_ok = holdout_pass(holdout)

    if holdout_ok:
        status = "FORWARD_PAPER_CANDIDATE_EXECUTION_IMPROVED"
    elif validation_ok:
        status = "FINAL_2026_EXECUTION_STRESS_REJECTED"
    elif selected:
        status = "VALIDATION_2025_EXECUTION_REJECTED"
    else:
        status = "NO_DEVELOPMENT_EXECUTION_IMPROVEMENT"

    result = rounded({
        "version": 13,
        "strategyId": "COST_AWARE_CONVICTION_EXECUTION_V13",
        "generatedAt": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
        "status": status,
        "fixedSignal": {
            "components": [component.__dict__ for component in COMPONENTS],
            "overlay": OVERLAY.__dict__,
            "hedge": HEDGE.__dict__,
            "confirmBars": CONFIRM_BARS,
        },
        "researchDesign": {
            "development": "2023-2024",
            "validation": "2025",
            "holdout": "2026H1 opened only after validation pass",
            "controllerCount": len(controllers()),
            "scenarios": [scenario.__dict__ for scenario in scenarios()],
        },
        "baselineDevelopment": baseline_development,
        "baselineValidation": baseline_validation,
        "developmentPassed": len(passed),
        "selected": {
            **selected,
            "validation": validation,
            "validationImprovement": validation_improvement,
            "validationPassed": validation_ok,
            "holdout2026H1": holdout,
            "holdoutPassed": holdout_ok,
            "paperEligible": holdout_ok,
            "liveEligible": False,
        } if selected else None,
        "allCandidates": candidates,
        "productionChanged": False,
        "realTradingEnabled": False,
        "fingerprint": hashlib.sha256(json.dumps({
            "controllers": [controller.__dict__ for controller in controllers()],
            "components": [component.__dict__ for component in COMPONENTS],
            "overlay": OVERLAY.__dict__,
            "hedge": HEDGE.__dict__,
            "scenarios": [scenario.__dict__ for scenario in scenarios()],
        }, sort_keys=True).encode()).hexdigest(),
        "limitations": [
            "V6のEntry/Regime/銘柄スコアは変更せず、執行層のみ改善する。",
            "投票差を期待Edgeの代理とし、予定コストと安全余裕を超えない変更を拒否する。",
            "2025結果を見て同一RunのController値を変更しない。Validation通過時だけ2026H1を開く。",
            "通過してもFresh Forward Paperが必要でLiveは禁止する。",
            "本番コード、VPS、.env、実売買runnerは変更していない。",
        ],
    })

    report = [
        "# Cost-Aware Conviction Execution V13",
        "",
        f"- Status: **{status}**",
        f"- Controllers: {len(controllers())}",
        f"- Development passed: {len(passed)}",
        "- Fixed V6 signal generation: YES",
        "- Production changed: NO",
        "- Real trading: DISABLED",
        "",
    ]
    if result["selected"]:
        selected_result = result["selected"]
        report.extend([
            "## Selected Controller",
            "",
            f"- ID: **{selected_result['controller']['controller_id']}**",
            f"- Development turnover reduction: {selected_result['developmentImprovement']['turnoverReductionPct']}%",
            f"- Development base CAGR retention: {selected_result['developmentImprovement']['baseCagrRetentionPct']}%",
            f"- Validation passed: **{'YES' if selected_result['validationPassed'] else 'NO'}**",
            f"- Holdout opened: **{'YES' if selected_result['holdout2026H1'] else 'NO'}**",
            f"- Paper eligible: **{'YES' if selected_result['paperEligible'] else 'NO'}**",
            "",
            "| Scenario | Dev compound | Dev PF | Dev DD | 2025 compound | 2025 PF | 2025 DD | 2026H1 compound | 2026H1 PF |",
            "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
        ])
        for scenario in scenarios():
            scenario_id = scenario.scenario_id
            dev = selected_result["development"][scenario_id]
            val = selected_result["validation"][scenario_id] if selected_result["validation"] else None
            final = selected_result["holdout2026H1"][scenario_id] if selected_result["holdout2026H1"] else None
            report.append(
                f"| {scenario_id} | {dev['compoundedReturnPct']}% | {dev['profitFactor']} | {dev['maxDrawdownPct']}% | "
                f"{val['compoundedReturnPct'] if val else 'NA'}% | {val['profitFactor'] if val else 'NA'} | {val['maxDrawdownPct'] if val else 'NA'}% | "
                f"{final['compoundedReturnPct'] if final else 'LOCKED'} | {final['profitFactor'] if final else 'LOCKED'} |"
            )
    else:
        report.extend(["## Selected Controller", "", "Development Gateを通る執行改善案はありませんでした。"])

    report.extend([
        "",
        "## Verdict",
        "",
        "Fresh Forward Paper候補です。Liveは禁止です。" if holdout_ok else "執行改善Gateを完走できず、Paper/Liveは禁止を維持します。",
        "",
        "## Limitations",
        "",
        *[f"- {item}" for item in result["limitations"]],
    ])

    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "cost-aware-conviction-execution-v13.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    (state_dir / "cost-aware-conviction-execution-v13.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
