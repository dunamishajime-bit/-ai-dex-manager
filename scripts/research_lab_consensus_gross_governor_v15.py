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
class Governor:
    governor_id: str
    low_threshold: float
    low_scale: float
    high_threshold: float
    mid_scale: float
    adverse_funding_cap_bps: float
    funding_scale: float


def governors() -> List[Governor]:
    # Fixed prior to 2025/2026 evaluation.  The V6 direction and selected
    # symbols are unchanged; only gross exposure is reduced in low-consensus
    # or unusually adverse-carry states.
    return [
        Governor("CG_L60S40_H70S75_F3S75", 0.60, 0.40, 0.70, 0.75, 3.0, 0.75),
        Governor("CG_L60S50_H70S80_F4S75", 0.60, 0.50, 0.70, 0.80, 4.0, 0.75),
        Governor("CG_L55S50_H70S80_F4S75", 0.55, 0.50, 0.70, 0.80, 4.0, 0.75),
        Governor("CG_L60S60_H80S85_F5S80", 0.60, 0.60, 0.80, 0.85, 5.0, 0.80),
        Governor("CG_L55S60_H65S85_F4S80", 0.55, 0.60, 0.65, 0.85, 4.0, 0.80),
        Governor("CG_L65S50_H80S80_F3S70", 0.65, 0.50, 0.80, 0.80, 3.0, 0.70),
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


def scale(weights: Dict[str, float], factor: float) -> Dict[str, float]:
    return {symbol: weight * factor for symbol, weight in weights.items() if abs(weight * factor) >= 1e-6}


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


def weighted_support(target: Dict[str, float], votes: Dict[str, float]) -> float:
    gross = v4.gross_exposure(target)
    if gross <= 0:
        return 0.0
    return sum(abs(weight) * votes.get(symbol, 0.0) for symbol, weight in target.items()) / gross


def adverse_funding_bps(target: Dict[str, float], ts: int, funding: Dict[str, Dict[int, float]]) -> float:
    prior = ts - 12 * v4.HOUR
    adverse_pct = 0.0
    for symbol, weight in target.items():
        trailing = (funding.get(symbol, {}).get(ts, 0.0) + funding.get(symbol, {}).get(prior, 0.0)) / 2.0
        adverse_pct += max(0.0, weight * trailing)
    return adverse_pct * 100.0


def governed_targets(
    raw_targets: Dict[int, Dict[str, float]],
    projected: Dict[int, List[Dict[str, float]]],
    funding: Dict[str, Dict[int, float]],
    times: List[int],
    governor: Governor,
) -> Dict[int, Dict[str, float]]:
    votes = vote_maps(projected, times)
    result: Dict[int, Dict[str, float]] = {}
    for ts in times:
        target = raw_targets.get(ts, {})
        # Preserve cash and the fixed BTC bear hedge exactly.
        if side(target) <= 0:
            result[ts] = dict(target)
            continue
        support = weighted_support(target, votes.get(ts, {}))
        if support < governor.low_threshold:
            gross_scale = governor.low_scale
        elif support < governor.high_threshold:
            gross_scale = governor.mid_scale
        else:
            gross_scale = 1.0
        controlled = scale(target, gross_scale)
        if adverse_funding_bps(controlled, ts, funding) > governor.adverse_funding_cap_bps:
            controlled = scale(controlled, governor.funding_scale)
        result[ts] = controlled
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
        "exposureReductionPct": (
            (1.0 - controlled["BASE_10BPS"]["exposurePct"] / baseline["BASE_10BPS"]["exposurePct"]) * 100.0
            if baseline["BASE_10BPS"]["exposurePct"] > 0 else 0.0
        ),
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
        results["BASE_10BPS"]["cagrPct"] >= 50
        and (results["BASE_10BPS"]["profitFactor"] or 0) >= 1.45
        and all(results["BASE_10BPS"]["annualReturnsPct"].get(year, -100) > 0 for year in ["2023", "2024"])
        and results["COST30"]["compoundedReturnPct"] > 0
        and (results["COST30"]["profitFactor"] or 0) >= 1.40
        and results["DELAY12H"]["compoundedReturnPct"] > 0
        and (results["DELAY12H"]["profitFactor"] or 0) >= 1.33
        and severe["compoundedReturnPct"] > 0
        and (severe["profitFactor"] or 0) >= 1.20
        and severe["maxDrawdownPct"] >= -40
        and comp["exposureReductionPct"] >= 8
        and comp["baseCagrRetentionPct"] >= 65
        and comp["severeDdImprovementPct"] >= 2
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
        and severe["compoundedReturnPct"] >= -2
        and (severe["profitFactor"] or 0) >= 1.08
        and severe["maxDrawdownPct"] >= -27
        and comp["exposureReductionPct"] >= 8
        and comp["baseReturnRetentionPct"] >= 65
        and comp["severeReturnDeltaPct"] >= 4
        and comp["severeDdImprovementPct"] >= 3
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
    for governor in governors():
        targets = governed_targets(raw_targets, projected, funding, times, governor)
        controlled_map[governor.governor_id] = targets
        dev = run_scenarios(targets, times, bars, indexes, funding, v4.START_2023, v4.START_2025)
        comp = comparison(dev, baseline_dev)
        candidates.append({
            "governor": governor.__dict__,
            "development": dev,
            "developmentComparison": comp,
            "developmentPassed": development_pass(dev, baseline_dev, comp),
        })

    passed = [item for item in candidates if item["developmentPassed"]]
    passed.sort(key=lambda item: (
        item["development"]["SEVERE_50BPS_DELAY12H_FUND3"]["profitFactor"] or 0,
        item["developmentComparison"]["severeDdImprovementPct"],
        item["development"]["BASE_10BPS"]["cagrPct"],
    ), reverse=True)

    selected = passed[0] if passed else None
    validation = None
    val_comp = None
    val_ok = False
    holdout = None
    final_ok = False
    if selected:
        governor_id = selected["governor"]["governor_id"]
        targets = controlled_map[governor_id]
        validation = run_scenarios(targets, times, bars, indexes, funding, v4.START_2025, v4.START_2026)
        val_comp = comparison(validation, baseline_val)
        val_ok = validation_pass(validation, baseline_val, val_comp)
        if val_ok:
            holdout = run_scenarios(targets, times, bars, indexes, funding, v4.START_2026, v4.END)
            final_ok = holdout_pass(holdout)

    if final_ok:
        status = "FORWARD_PAPER_CANDIDATE_GROSS_IMPROVED"
    elif val_ok:
        status = "FINAL_2026_GROSS_STRESS_REJECTED"
    elif selected:
        status = "VALIDATION_2025_GROSS_REJECTED"
    else:
        status = "NO_DEVELOPMENT_GROSS_IMPROVEMENT"

    result = rounded({
        "version": 15,
        "strategyId": "CONSENSUS_GROSS_GOVERNOR_V15",
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
            "governorCount": len(governors()),
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
            "governors": [governor.__dict__ for governor in governors()],
            "components": [component.__dict__ for component in COMPONENTS],
            "overlay": OVERLAY.__dict__,
            "hedge": HEDGE.__dict__,
            "scenarios": [scenario.__dict__ for scenario in scenarios()],
        }, sort_keys=True).encode()).hexdigest(),
        "limitations": [
            "V6の方向と選択銘柄を変更せず、低Consensus時のGrossだけを縮小する。",
            "Funding負担が固定上限を超える場合のみ追加縮小する。",
            "2025結果を見て同一RunのGovernor値を変更せず、通過時だけ2026H1を開く。",
            "通過してもFresh Forward Paperが必要でLiveは禁止する。",
            "本番コード、VPS、.env、実売買runnerは変更していない。",
        ],
    })

    report = [
        "# Consensus Gross Governor V15",
        "",
        f"- Status: **{status}**",
        f"- Governors: {len(governors())}",
        f"- Development passed: {len(passed)}",
        "- V6 direction/symbols preserved: YES",
        "- Production changed: NO",
        "- Real trading: DISABLED",
        "",
    ]
    if result["selected"]:
        item = result["selected"]
        report.extend([
            "## Selected Governor",
            "",
            f"- ID: **{item['governor']['governor_id']}**",
            f"- Development exposure reduction: {item['developmentComparison']['exposureReductionPct']}%",
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
        report.extend(["## Selected Governor", "", "Development Gateを通るConsensus Gross案はありませんでした。"])

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
    (state_dir / "consensus-gross-governor-v15.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    (state_dir / "consensus-gross-governor-v15.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
