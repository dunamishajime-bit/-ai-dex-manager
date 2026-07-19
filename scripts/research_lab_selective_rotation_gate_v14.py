from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Set

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
class RotationGate:
    gate_id: str
    planning_cost_bps: float
    edge_scale_bps: float
    reserve_bps: float
    min_vote_advantage: float
    cooldown_bars: int
    same_set_blend: float
    adverse_funding_cap_bps: float


def gates() -> List[RotationGate]:
    # Entry, exit and regime direction are fixed. Only same-side long rotations
    # are gated. Values are fixed before 2025/2026 evaluation.
    return [
        RotationGate("RG_C30_E250_R5_V10_Q2_B50_F6", 30, 250, 5, 0.10, 2, 0.50, 6.0),
        RotationGate("RG_C30_E300_R5_V10_Q2_B50_F6", 30, 300, 5, 0.10, 2, 0.50, 6.0),
        RotationGate("RG_C30_E250_R5_V08_Q1_B75_F8", 30, 250, 5, 0.08, 1, 0.75, 8.0),
        RotationGate("RG_C40_E300_R8_V15_Q2_B50_F5", 40, 300, 8, 0.15, 2, 0.50, 5.0),
        RotationGate("RG_C25_E220_R3_V08_Q1_B75_F8", 25, 220, 3, 0.08, 1, 0.75, 8.0),
        RotationGate("RG_C30_E280_R5_V12_Q4_B50_F6", 30, 280, 5, 0.12, 4, 0.50, 6.0),
    ]


def scenarios() -> List[v7.ExecutionScenario]:
    return [
        v7.ExecutionScenario("BASE_10BPS", 10, 0, 0),
        v7.ExecutionScenario("COST30", 30, 0, 0),
        v7.ExecutionScenario("DELAY12H", 10, 1, 0),
        v7.ExecutionScenario("SEVERE_50BPS_DELAY12H_FUND3", 50, 1, 3),
    ]


def side(weights: Dict[str, float]) -> int:
    net = sum(weights.values())
    if net > 0.02:
        return 1
    if net < -0.02:
        return -1
    return 0


def clean(weights: Dict[str, float]) -> Dict[str, float]:
    return {symbol: value for symbol, value in weights.items() if abs(value) >= 1e-6}


def active_set(weights: Dict[str, float]) -> Set[str]:
    return {symbol for symbol, weight in weights.items() if abs(weight) >= 0.05}


def scale_to_gross(weights: Dict[str, float], target_gross: float) -> Dict[str, float]:
    gross = v4.gross_exposure(weights)
    if gross <= 0 or target_gross <= 0:
        return {}
    scale = target_gross / gross
    return clean({symbol: weight * scale for symbol, weight in weights.items()})


def blend(left: Dict[str, float], right: Dict[str, float], fraction: float) -> Dict[str, float]:
    symbols = set(left) | set(right)
    return clean({
        symbol: left.get(symbol, 0.0) + (right.get(symbol, 0.0) - left.get(symbol, 0.0)) * fraction
        for symbol in symbols
    })


def votes_by_time(projected: Dict[int, List[Dict[str, float]]], times: List[int]) -> Dict[int, Dict[str, float]]:
    result: Dict[int, Dict[str, float]] = {}
    for ts in times:
        members = projected[ts]
        count = max(1, len(members))
        result[ts] = {
            symbol: sum(1 for member in members if member.get(symbol, 0.0) > 0.01) / count
            for symbol in ["ETH", "BNB", "SOL"]
        }
    return result


def conviction(weights: Dict[str, float], votes: Dict[str, float]) -> float:
    gross = v4.gross_exposure(weights)
    if gross <= 0:
        return 0.0
    return sum(abs(weight) * votes.get(symbol, 0.0) for symbol, weight in weights.items()) / gross


def trailing_adverse_funding_bps(target: Dict[str, float], ts: int, funding: Dict[str, Dict[int, float]]) -> float:
    previous = ts - 12 * v4.HOUR
    adverse_pct = 0.0
    for symbol, weight in target.items():
        trailing = (funding.get(symbol, {}).get(ts, 0.0) + funding.get(symbol, {}).get(previous, 0.0)) / 2.0
        adverse_pct += max(0.0, weight * trailing)
    return adverse_pct * 100.0


def funding_cap(target: Dict[str, float], ts: int, funding: Dict[str, Dict[int, float]], cap_bps: float) -> Dict[str, float]:
    if side(target) <= 0:
        return target
    adverse = trailing_adverse_funding_bps(target, ts, funding)
    if adverse <= cap_bps:
        return target
    # Rare, high-carry state only. Keep the selected assets and reduce gross by
    # 25%; do not use funding to choose a different symbol.
    return scale_to_gross(target, v4.gross_exposure(target) * 0.75)


def apply_gate(
    raw_targets: Dict[int, Dict[str, float]],
    projected: Dict[int, List[Dict[str, float]]],
    funding: Dict[str, Dict[int, float]],
    times: List[int],
    gate: RotationGate,
) -> Dict[int, Dict[str, float]]:
    vote_map = votes_by_time(projected, times)
    current: Dict[str, float] = {}
    cooldown = 0
    result: Dict[int, Dict[str, float]] = {}

    for ts in times:
        raw = raw_targets.get(ts, {})
        desired = funding_cap(raw, ts, funding, gate.adverse_funding_cap_bps)
        current_side = side(current)
        desired_side = side(desired)

        # Preserve all V6 entries, exits and Bull/Bear direction changes.
        if current_side != desired_side or current_side <= 0 or desired_side <= 0:
            next_target = dict(desired)
            cooldown = gate.cooldown_bars if active_set(current) != active_set(desired) else max(0, cooldown - 1)
        else:
            current_assets = active_set(current)
            desired_assets = active_set(desired)
            if current_assets == desired_assets:
                # Volatility scaling and risk reductions are retained, but small
                # weight oscillations are blended rather than fully crossed.
                if v4.gross_exposure(desired) < v4.gross_exposure(current) * 0.90:
                    next_target = dict(desired)
                else:
                    next_target = blend(current, desired, gate.same_set_blend)
                cooldown = max(0, cooldown - 1)
            elif cooldown > 0:
                next_target = scale_to_gross(current, v4.gross_exposure(desired))
                cooldown -= 1
            else:
                votes = vote_map.get(ts, {})
                current_conviction = conviction(current, votes)
                desired_conviction = conviction(desired, votes)
                vote_advantage = desired_conviction - current_conviction
                requested_turnover = v4.turnover(current, desired)
                expected_edge_bps = max(0.0, vote_advantage) * gate.edge_scale_bps
                required_edge_bps = gate.reserve_bps + requested_turnover * gate.planning_cost_bps
                if vote_advantage >= gate.min_vote_advantage and expected_edge_bps >= required_edge_bps:
                    next_target = dict(desired)
                    cooldown = gate.cooldown_bars
                else:
                    # Reject the symbol rotation but preserve the V6 target gross,
                    # so trend exposure is not sacrificed as it was in V13.
                    next_target = scale_to_gross(current, v4.gross_exposure(desired))
                    cooldown = max(0, cooldown - 1)

        current = clean(next_target)
        result[ts] = dict(current)

    return result


def run_scenarios(targets, times, bars, indexes, funding, start, end) -> Dict[str, dict]:
    return {
        scenario.scenario_id: v7.simulate_scenario(
            scenario, targets, times, bars, indexes, funding, start, end,
        )
        for scenario in scenarios()
    }


def comparison(controlled: Dict[str, dict], baseline: Dict[str, dict]) -> dict:
    base_turnover = baseline["BASE_10BPS"]["turnover"]
    return {
        "turnoverReductionPct": (
            (1.0 - controlled["BASE_10BPS"]["turnover"] / base_turnover) * 100.0 if base_turnover > 0 else 0.0
        ),
        "baseCagrRetentionPct": (
            controlled["BASE_10BPS"]["cagrPct"] / baseline["BASE_10BPS"]["cagrPct"] * 100.0
            if baseline["BASE_10BPS"]["cagrPct"] > 0 else 0.0
        ),
        "baseReturnRetentionPct": (
            controlled["BASE_10BPS"]["compoundedReturnPct"] / baseline["BASE_10BPS"]["compoundedReturnPct"] * 100.0
            if baseline["BASE_10BPS"]["compoundedReturnPct"] > 0 else 0.0
        ),
        "cost30PfDelta": (controlled["COST30"]["profitFactor"] or 0) - (baseline["COST30"]["profitFactor"] or 0),
        "delayPfDelta": (controlled["DELAY12H"]["profitFactor"] or 0) - (baseline["DELAY12H"]["profitFactor"] or 0),
        "severeReturnDeltaPct": controlled["SEVERE_50BPS_DELAY12H_FUND3"]["compoundedReturnPct"] - baseline["SEVERE_50BPS_DELAY12H_FUND3"]["compoundedReturnPct"],
        "severeDdImprovementPct": controlled["SEVERE_50BPS_DELAY12H_FUND3"]["maxDrawdownPct"] - baseline["SEVERE_50BPS_DELAY12H_FUND3"]["maxDrawdownPct"],
    }


def development_pass(results: Dict[str, dict], baseline: Dict[str, dict], comp: dict) -> bool:
    return (
        results["BASE_10BPS"]["cagrPct"] >= 45
        and (results["BASE_10BPS"]["profitFactor"] or 0) >= 1.45
        and all(results["BASE_10BPS"]["annualReturnsPct"].get(year, -100) > 0 for year in ["2023", "2024"])
        and results["COST30"]["compoundedReturnPct"] > 0
        and (results["COST30"]["profitFactor"] or 0) >= (baseline["COST30"]["profitFactor"] or 0)
        and results["DELAY12H"]["compoundedReturnPct"] > 0
        and (results["DELAY12H"]["profitFactor"] or 0) >= 1.35
        and results["SEVERE_50BPS_DELAY12H_FUND3"]["compoundedReturnPct"] > 0
        and (results["SEVERE_50BPS_DELAY12H_FUND3"]["profitFactor"] or 0) >= 1.20
        and comp["turnoverReductionPct"] >= 10
        and comp["baseCagrRetentionPct"] >= 70
        and comp["severeDdImprovementPct"] >= 1
    )


def validation_pass(results: Dict[str, dict], baseline: Dict[str, dict], comp: dict) -> bool:
    severe = results["SEVERE_50BPS_DELAY12H_FUND3"]
    return (
        results["BASE_10BPS"]["compoundedReturnPct"] > 0
        and (results["BASE_10BPS"]["profitFactor"] or 0) >= 1.20
        and results["COST30"]["compoundedReturnPct"] > 0
        and (results["COST30"]["profitFactor"] or 0) >= 1.15
        and results["DELAY12H"]["compoundedReturnPct"] > 0
        and (results["DELAY12H"]["profitFactor"] or 0) >= 1.15
        and severe["compoundedReturnPct"] >= -3
        and (severe["profitFactor"] or 0) >= 1.05
        and severe["maxDrawdownPct"] >= -28
        and comp["turnoverReductionPct"] >= 10
        and comp["baseReturnRetentionPct"] >= 70
        and comp["severeReturnDeltaPct"] >= 3
        and comp["severeDdImprovementPct"] >= 2
    )


def holdout_pass(results: Dict[str, dict]) -> bool:
    return (
        results["BASE_10BPS"]["compoundedReturnPct"] > 0
        and (results["BASE_10BPS"]["profitFactor"] or 0) >= 1.20
        and results["COST30"]["compoundedReturnPct"] > 0
        and (results["COST30"]["profitFactor"] or 0) >= 1.15
        and results["DELAY12H"]["compoundedReturnPct"] > 0
        and (results["DELAY12H"]["profitFactor"] or 0) >= 1.10
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

    baseline_dev = run_scenarios(raw_targets, times, bars, indexes, funding, v4.START_2023, v4.START_2025)
    baseline_val = run_scenarios(raw_targets, times, bars, indexes, funding, v4.START_2025, v4.START_2026)

    target_map = {}
    candidates = []
    for gate in gates():
        targets = apply_gate(raw_targets, projected, funding, times, gate)
        target_map[gate.gate_id] = targets
        dev = run_scenarios(targets, times, bars, indexes, funding, v4.START_2023, v4.START_2025)
        comp = comparison(dev, baseline_dev)
        candidates.append({
            "gate": gate.__dict__,
            "development": dev,
            "developmentComparison": comp,
            "developmentPassed": development_pass(dev, baseline_dev, comp),
        })

    passed = [item for item in candidates if item["developmentPassed"]]
    passed.sort(key=lambda item: (
        item["development"]["SEVERE_50BPS_DELAY12H_FUND3"]["profitFactor"] or 0,
        item["developmentComparison"]["turnoverReductionPct"],
        item["development"]["BASE_10BPS"]["cagrPct"],
    ), reverse=True)

    selected = passed[0] if passed else None
    validation = None
    val_comp = None
    val_ok = False
    holdout = None
    final_ok = False
    if selected:
        gate_id = selected["gate"]["gate_id"]
        targets = target_map[gate_id]
        validation = run_scenarios(targets, times, bars, indexes, funding, v4.START_2025, v4.START_2026)
        val_comp = comparison(validation, baseline_val)
        val_ok = validation_pass(validation, baseline_val, val_comp)
        if val_ok:
            holdout = run_scenarios(targets, times, bars, indexes, funding, v4.START_2026, v4.END)
            final_ok = holdout_pass(holdout)

    if final_ok:
        status = "FORWARD_PAPER_CANDIDATE_ROTATION_IMPROVED"
    elif val_ok:
        status = "FINAL_2026_ROTATION_STRESS_REJECTED"
    elif selected:
        status = "VALIDATION_2025_ROTATION_REJECTED"
    else:
        status = "NO_DEVELOPMENT_ROTATION_IMPROVEMENT"

    result = rounded({
        "version": 14,
        "strategyId": "SELECTIVE_ROTATION_GATE_V14",
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
            "gateCount": len(gates()),
        },
        "baselineDevelopment": baseline_dev,
        "baselineValidation": baseline_val,
        "developmentPassed": len(passed),
        "selected": {
            **selected,
            "validation": validation,
            "validationComparison": val_comp,
            "validationPassed": val_ok,
            "holdout2026H1": holdout,
            "holdoutPassed": final_ok,
            "paperEligible": final_ok,
            "liveEligible": False,
        } if selected else None,
        "allCandidates": candidates,
        "productionChanged": False,
        "realTradingEnabled": False,
        "fingerprint": hashlib.sha256(json.dumps({
            "gates": [gate.__dict__ for gate in gates()],
            "components": [component.__dict__ for component in COMPONENTS],
            "overlay": OVERLAY.__dict__,
            "hedge": HEDGE.__dict__,
            "scenarios": [scenario.__dict__ for scenario in scenarios()],
        }, sort_keys=True).encode()).hexdigest(),
        "limitations": [
            "V6のEntry、Exit、Bull/Bear切替を完全維持し、Long保有中の銘柄入替だけを選別する。",
            "投票差が予定コストと安全余裕を上回らない銘柄変更を拒否する。",
            "2025結果を見て同一RunのGate値を変更せず、通過時だけ2026H1を開く。",
            "通過してもFresh Forward Paperが必要でLiveは禁止する。",
            "本番コード、VPS、.env、実売買runnerは変更していない。",
        ],
    })

    report = [
        "# Selective Rotation Gate V14",
        "",
        f"- Status: **{status}**",
        f"- Gates: {len(gates())}",
        f"- Development passed: {len(passed)}",
        "- V6 Entry/Exit/Regime preserved: YES",
        "- Production changed: NO",
        "- Real trading: DISABLED",
        "",
    ]
    if result["selected"]:
        item = result["selected"]
        report.extend([
            "## Selected Gate",
            "",
            f"- ID: **{item['gate']['gate_id']}**",
            f"- Development turnover reduction: {item['developmentComparison']['turnoverReductionPct']}%",
            f"- Development CAGR retention: {item['developmentComparison']['baseCagrRetentionPct']}%",
            f"- Validation passed: **{'YES' if item['validationPassed'] else 'NO'}**",
            f"- Holdout opened: **{'YES' if item['holdout2026H1'] else 'NO'}**",
            f"- Paper eligible: **{'YES' if item['paperEligible'] else 'NO'}**",
            "",
            "| Scenario | Dev compound | Dev PF | Dev DD | 2025 compound | 2025 PF | 2025 DD | 2026H1 compound | 2026H1 PF |",
            "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
        ])
        for scenario in scenarios():
            sid = scenario.scenario_id
            dev = item["development"][sid]
            val = item["validation"][sid] if item["validation"] else None
            final = item["holdout2026H1"][sid] if item["holdout2026H1"] else None
            report.append(
                f"| {sid} | {dev['compoundedReturnPct']}% | {dev['profitFactor']} | {dev['maxDrawdownPct']}% | "
                f"{val['compoundedReturnPct'] if val else 'NA'} | {val['profitFactor'] if val else 'NA'} | {val['maxDrawdownPct'] if val else 'NA'} | "
                f"{final['compoundedReturnPct'] if final else 'LOCKED'} | {final['profitFactor'] if final else 'LOCKED'} |"
            )
    else:
        report.extend(["## Selected Gate", "", "Development Gateを通るSelective Rotation案はありませんでした。"])

    report.extend([
        "",
        "## Verdict",
        "",
        "Fresh Forward Paper候補です。Liveは禁止です。" if final_ok else "改善Gateを完走できず、Paper/Liveは禁止を維持します。",
        "",
        "## Limitations",
        "",
        *[f"- {item}" for item in result["limitations"]],
    ])

    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "selective-rotation-gate-v14.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    (state_dir / "selective-rotation-gate-v14.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
