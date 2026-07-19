from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Set, Tuple

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
class PersistenceGate:
    gate_id: str
    challenger_confirm_bars: int
    min_vote_advantage: float
    planning_cost_bps: float
    edge_scale_bps: float
    reserve_bps: float
    same_set_blend: float
    urgent_vote_advantage: float


def gates() -> List[PersistenceGate]:
    return [
        PersistenceGate("PC_Q2_V05_C30_E250_R5_B75_U30", 2, 0.05, 30, 250, 5, 0.75, 0.30),
        PersistenceGate("PC_Q2_V10_C30_E300_R5_B50_U30", 2, 0.10, 30, 300, 5, 0.50, 0.30),
        PersistenceGate("PC_Q3_V05_C30_E300_R5_B75_U35", 3, 0.05, 30, 300, 5, 0.75, 0.35),
        PersistenceGate("PC_Q3_V10_C40_E350_R8_B50_U35", 3, 0.10, 40, 350, 8, 0.50, 0.35),
        PersistenceGate("PC_Q2_V08_C25_E250_R3_B100_U25", 2, 0.08, 25, 250, 3, 1.00, 0.25),
        PersistenceGate("PC_Q4_V05_C30_E350_R5_B75_U40", 4, 0.05, 30, 350, 5, 0.75, 0.40),
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


def signature(weights: Dict[str, float]) -> Tuple[str, ...]:
    return tuple(sorted(active_set(weights)))


def scale_to_gross(weights: Dict[str, float], target_gross: float) -> Dict[str, float]:
    gross = v4.gross_exposure(weights)
    if gross <= 0 or target_gross <= 0:
        return {}
    factor = target_gross / gross
    return clean({symbol: weight * factor for symbol, weight in weights.items()})


def blend(left: Dict[str, float], right: Dict[str, float], fraction: float) -> Dict[str, float]:
    symbols = set(left) | set(right)
    return clean({
        symbol: left.get(symbol, 0.0) + (right.get(symbol, 0.0) - left.get(symbol, 0.0)) * fraction
        for symbol in symbols
    })


def vote_maps(projected: Dict[int, List[Dict[str, float]]], times: List[int]) -> Dict[int, Dict[str, float]]:
    result: Dict[int, Dict[str, float]] = {}
    for ts in times:
        members = projected[ts]
        denominator = max(1, len(members))
        result[ts] = {
            symbol: sum(1 for member in members if member.get(symbol, 0.0) > 0.01) / denominator
            for symbol in ["ETH", "BNB", "SOL"]
        }
    return result


def conviction(weights: Dict[str, float], votes: Dict[str, float]) -> float:
    gross = v4.gross_exposure(weights)
    if gross <= 0:
        return 0.0
    return sum(abs(weight) * votes.get(symbol, 0.0) for symbol, weight in weights.items()) / gross


def persistent_targets(
    raw_targets: Dict[int, Dict[str, float]],
    projected: Dict[int, List[Dict[str, float]]],
    times: List[int],
    gate: PersistenceGate,
) -> Dict[int, Dict[str, float]]:
    votes_by_ts = vote_maps(projected, times)
    current: Dict[str, float] = {}
    challenger_signature: Tuple[str, ...] = tuple()
    challenger_count = 0
    result: Dict[int, Dict[str, float]] = {}

    for ts in times:
        desired = raw_targets.get(ts, {})
        current_side = side(current)
        desired_side = side(desired)

        # Never delay V6 cash exits, entries or Bull/Bear direction changes.
        if current_side != desired_side or current_side <= 0 or desired_side <= 0:
            current = clean(dict(desired))
            challenger_signature = tuple()
            challenger_count = 0
            result[ts] = dict(current)
            continue

        current_signature = signature(current)
        desired_signature = signature(desired)
        if current_signature == desired_signature:
            current = blend(current, desired, gate.same_set_blend)
            challenger_signature = tuple()
            challenger_count = 0
            result[ts] = dict(current)
            continue

        if desired_signature == challenger_signature:
            challenger_count += 1
        else:
            challenger_signature = desired_signature
            challenger_count = 1

        votes = votes_by_ts.get(ts, {})
        current_conviction = conviction(current, votes)
        desired_conviction = conviction(desired, votes)
        vote_advantage = desired_conviction - current_conviction
        requested_turnover = v4.turnover(current, desired)
        expected_edge_bps = max(0.0, vote_advantage) * gate.edge_scale_bps
        required_edge_bps = gate.reserve_bps + requested_turnover * gate.planning_cost_bps
        urgent = vote_advantage >= gate.urgent_vote_advantage
        confirmed = challenger_count >= gate.challenger_confirm_bars
        economical = vote_advantage >= gate.min_vote_advantage and expected_edge_bps >= required_edge_bps

        if urgent or (confirmed and economical):
            current = clean(dict(desired))
            challenger_signature = tuple()
            challenger_count = 0
        else:
            # Maintain trend gross while waiting for the challenger to prove
            # persistence. This avoids the V13 loss of market exposure.
            current = scale_to_gross(current, v4.gross_exposure(desired))
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
    return {
        "turnoverReductionPct": (
            (1.0 - controlled["BASE_10BPS"]["turnover"] / baseline["BASE_10BPS"]["turnover"]) * 100.0
            if baseline["BASE_10BPS"]["turnover"] > 0 else 0.0
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
    severe = results["SEVERE_50BPS_DELAY12H_FUND3"]
    return (
        results["BASE_10BPS"]["cagrPct"] >= 55
        and (results["BASE_10BPS"]["profitFactor"] or 0) >= 1.47
        and all(results["BASE_10BPS"]["annualReturnsPct"].get(year, -100) > 0 for year in ["2023", "2024"])
        and results["COST30"]["compoundedReturnPct"] > 0
        and (results["COST30"]["profitFactor"] or 0) >= 1.43
        and results["DELAY12H"]["compoundedReturnPct"] > 0
        and (results["DELAY12H"]["profitFactor"] or 0) >= 1.35
        and severe["compoundedReturnPct"] > 0
        and (severe["profitFactor"] or 0) >= 1.20
        and severe["maxDrawdownPct"] >= -42
        and comp["turnoverReductionPct"] >= 10
        and comp["baseCagrRetentionPct"] >= 75
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
        and (severe["profitFactor"] or 0) >= 1.07
        and severe["maxDrawdownPct"] >= -28
        and comp["turnoverReductionPct"] >= 10
        and comp["baseReturnRetentionPct"] >= 70
        and comp["severeReturnDeltaPct"] >= 2
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

    controlled_map = {}
    candidates = []
    for gate in gates():
        targets = persistent_targets(raw_targets, projected, times, gate)
        controlled_map[gate.gate_id] = targets
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
        targets = controlled_map[gate_id]
        validation = run_scenarios(targets, times, bars, indexes, funding, v4.START_2025, v4.START_2026)
        val_comp = comparison(validation, baseline_val)
        val_ok = validation_pass(validation, baseline_val, val_comp)
        if val_ok:
            holdout = run_scenarios(targets, times, bars, indexes, funding, v4.START_2026, v4.END)
            final_ok = holdout_pass(holdout)

    if final_ok:
        status = "FORWARD_PAPER_CANDIDATE_PERSISTENCE_IMPROVED"
    elif val_ok:
        status = "FINAL_2026_PERSISTENCE_STRESS_REJECTED"
    elif selected:
        status = "VALIDATION_2025_PERSISTENCE_REJECTED"
    else:
        status = "NO_DEVELOPMENT_PERSISTENCE_IMPROVEMENT"

    result = rounded({
        "version": 16,
        "strategyId": "PERSISTENT_CHALLENGER_ROTATION_V16",
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
            "V6のEntry、Exit、Bull/Bear切替とGrossを維持し、Long銘柄交代だけに持続確認を加える。",
            "新しい銘柄集合が2-4本連続し、投票差が予定コストを超えた場合だけ交代する。",
            "2025結果を見て同一RunのGate値を変更せず、通過時だけ2026H1を開く。",
            "通過してもFresh Forward Paperが必要でLiveは禁止する。",
            "本番コード、VPS、.env、実売買runnerは変更していない。",
        ],
    })

    report = [
        "# Persistent Challenger Rotation V16",
        "",
        f"- Status: **{status}**",
        f"- Gates: {len(gates())}",
        f"- Development passed: {len(passed)}",
        "- V6 direction/gross preserved: YES",
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
        report.extend(["## Selected Gate", "", "Development Gateを通るPersistent Challenger案はありませんでした。"])

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
    (state_dir / "persistent-challenger-rotation-v16.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    (state_dir / "persistent-challenger-rotation-v16.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
