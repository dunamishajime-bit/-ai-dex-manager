from __future__ import annotations

import hashlib
import json
import os
import statistics
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List

import research_lab_parameter_bagged_rotation_v4 as v4
import research_lab_precomputed_multi_regime_v6 as v6
import research_lab_cross_sectional_market_neutral_v10 as v10


@dataclass(frozen=True)
class TimedVariant:
    variant_id: str
    base_variant: v10.Variant
    selector_days: int
    selector_threshold_pct: float


def base_variants() -> List[v10.Variant]:
    result: List[v10.Variant] = []
    for score_mode in ["RISK_ADJ_MOM", "BTC_RESIDUAL"]:
        for short_days in [5, 10]:
            for long_days in [20, 30]:
                for rebalance_days in [1, 2, 3]:
                    for top_k in [1, 2]:
                        for gross in [0.6, 0.9]:
                            for beta_neutral in [False, True]:
                                result.append(v10.Variant(
                                    variant_id=(
                                        f"FBASE_{score_mode}_S{short_days}_L{long_days}"
                                        f"_R{rebalance_days}_K{top_k}_G{gross}"
                                        f"_B{1 if beta_neutral else 0}"
                                    ),
                                    score_mode=score_mode,
                                    short_days=short_days,
                                    long_days=long_days,
                                    rebalance_days=rebalance_days,
                                    top_k=top_k,
                                    gross=gross,
                                    beta_neutral=beta_neutral,
                                    min_spread_z=0.0,
                                ))
    return result


def timed_variants(bases: List[v10.Variant]) -> List[TimedVariant]:
    result: List[TimedVariant] = []
    for base in bases:
        for selector_days in [30, 60, 90]:
            for threshold in [0.0, 2.0, 5.0]:
                result.append(TimedVariant(
                    variant_id=f"{base.variant_id}_T{selector_days}_H{threshold}",
                    base_variant=base,
                    selector_days=selector_days,
                    selector_threshold_pct=threshold,
                ))
    return result


def negate(weights: Dict[str, float]) -> Dict[str, float]:
    return {symbol: -weight for symbol, weight in weights.items()}


def precompute_factor_returns(
    targets: Dict[int, Dict[str, float]],
    times: List[int],
    bars: Dict[str, List[dict]],
    indexes: Dict[str, Dict[int, int]],
    funding: Dict[str, Dict[int, float]],
) -> Dict[int, float]:
    result: Dict[int, float] = {}
    previous_portfolio: Dict[str, float] = {}
    for index, ts in enumerate(times):
        if index == 0:
            result[ts] = 0.0
            continue
        portfolio = targets.get(times[index - 1], {})
        turnover = v4.turnover(previous_portfolio, portfolio)
        gross = 0.0
        funding_cost = 0.0
        for symbol, weight in portfolio.items():
            symbol_index = indexes[symbol].get(ts)
            if symbol_index is None:
                continue
            bar = bars[symbol][symbol_index]
            gross += weight * ((float(bar["close"]) / float(bar["open"]) - 1.0) * 100.0)
            funding_cost += weight * funding.get(symbol, {}).get(ts, 0.0)
        result[ts] = gross - funding_cost - turnover * 10.0 / 100.0
        previous_portfolio = portfolio
    return result


def build_timed_targets(
    variant: TimedVariant,
    times: List[int],
    momentum_targets: Dict[int, Dict[str, float]],
    factor_returns: Dict[int, float],
) -> Dict[int, Dict[str, float]]:
    selector_bars = variant.selector_days * 2
    rebalance_bars = max(1, variant.base_variant.rebalance_days * 2)
    current: Dict[str, float] = {}
    result: Dict[int, Dict[str, float]] = {}
    trailing_values: List[float] = []
    for index, ts in enumerate(times):
        trailing_values.append(float(factor_returns.get(ts, 0.0)))
        if len(trailing_values) > selector_bars:
            trailing_values.pop(0)
        if index % rebalance_bars == 0:
            if len(trailing_values) < selector_bars:
                current = {}
            else:
                trailing_return = v4.product_return(trailing_values)
                candidate = momentum_targets.get(ts, {})
                if trailing_return > variant.selector_threshold_pct:
                    current = candidate
                elif trailing_return < -variant.selector_threshold_pct:
                    current = negate(candidate)
                else:
                    current = {}
        result[ts] = dict(current)
    return result


def development_pass(metrics: dict) -> bool:
    return (
        metrics["cycles"] >= 20
        and metrics["compoundedReturnPct"] > 0
        and metrics["stressCompoundedReturnPct"] > 0
        and (metrics["profitFactor"] or 0) >= 1.12
        and (metrics["stressProfitFactor"] or 0) >= 1.02
        and metrics["maxDrawdownPct"] >= -20
        and (metrics["bestCycleProfitSharePct"] or 100) <= 35
        and (metrics["profitFactorWithoutBest"] or 0) >= 1.0
    )


def validation_pass(metrics: dict) -> bool:
    return (
        metrics["cycles"] >= 15
        and metrics["compoundedReturnPct"] > 0
        and metrics["stressCompoundedReturnPct"] > 0
        and (metrics["profitFactor"] or 0) >= 1.08
        and (metrics["stressProfitFactor"] or 0) >= 1.0
        and metrics["maxDrawdownPct"] >= -20
        and (metrics["profitFactorWithoutBest"] or 0) >= 0.95
    )


def confirmation_pass(metrics: dict) -> bool:
    return (
        metrics["cycles"] >= 12
        and metrics["compoundedReturnPct"] > 0
        and metrics["stressCompoundedReturnPct"] > 0
        and (metrics["profitFactor"] or 0) >= 1.05
        and (metrics["stressProfitFactor"] or 0) >= 1.0
        and metrics["maxDrawdownPct"] >= -20
        and (metrics["profitFactorWithoutBest"] or 0) >= 0.9
    )


def final_pass(metrics: dict) -> bool:
    return (
        metrics["cycles"] >= 5
        and metrics["compoundedReturnPct"] > 0
        and metrics["stressCompoundedReturnPct"] >= -2
        and (metrics["profitFactor"] or 0) >= 1.0
        and metrics["maxDrawdownPct"] >= -15
        and (metrics["bestCycleProfitSharePct"] or 100) <= 50
    )


def neighbor(left: TimedVariant, right: TimedVariant) -> bool:
    l = left.base_variant
    r = right.base_variant
    return (
        l.score_mode == r.score_mode
        and l.top_k == r.top_k
        and l.beta_neutral == r.beta_neutral
        and abs(l.short_days - r.short_days) <= 5
        and abs(l.long_days - r.long_days) <= 10
        and abs(l.rebalance_days - r.rebalance_days) <= 1
        and abs(l.gross - r.gross) <= 0.31
        and abs(left.selector_days - right.selector_days) <= 30
        and abs(left.selector_threshold_pct - right.selector_threshold_pct) <= 3.01
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
    raw = {symbol: v4.load_symbol(cache_root, symbol) for symbol in v4.SYMBOLS}
    bars = {symbol: v4.resample_12h(raw[symbol]["candles"]) for symbol in v4.SYMBOLS}
    indexes = {
        symbol: {int(bar["ts"]): index for index, bar in enumerate(rows)}
        for symbol, rows in bars.items()
    }
    funding = v6.funding_buckets({symbol: raw[symbol]["funding"] for symbol in v4.SYMBOLS})
    times = [int(bar["ts"]) for bar in bars["BTC"] if v4.START_2023 <= int(bar["ts"]) < v4.END]
    features = v10.feature_cache(times, bars, indexes)

    base_execution = v10.Execution("BASE_10_30", 10, 30, 0, 0)
    severe_execution = v10.Execution("SEVERE_50_DELAY12_FUND3", 50, 50, 1, 3)
    bases = base_variants()
    variants = timed_variants(bases)
    variant_map = {variant.variant_id: variant for variant in variants}
    timed_target_cache: Dict[str, Dict[int, Dict[str, float]]] = {}
    evaluations: List[dict] = []

    for base in bases:
        momentum_targets = v10.scheduled_targets(base, times, features)
        factor_returns = precompute_factor_returns(momentum_targets, times, bars, indexes, funding)
        related = [variant for variant in variants if variant.base_variant.variant_id == base.variant_id]
        for variant in related:
            targets = build_timed_targets(variant, times, momentum_targets, factor_returns)
            timed_target_cache[variant.variant_id] = targets
            development = v10.simulate(
                base, targets, base_execution, times, bars, indexes, funding,
                v4.START_2023, v4.START_2024,
            )
            validation = v10.simulate(
                base, targets, base_execution, times, bars, indexes, funding,
                v4.START_2024, v4.START_2025,
            )
            evaluations.append({
                "variant": {
                    "variant_id": variant.variant_id,
                    "base_variant": base.__dict__,
                    "selector_days": variant.selector_days,
                    "selector_threshold_pct": variant.selector_threshold_pct,
                },
                "development2023": development,
                "validation2024": validation,
                "developmentPassed": development_pass(development),
                "validationPassed": validation_pass(validation),
                "neighborCount": 0,
                "neighborhoodScore": -999.0,
            })

    passed = [
        item for item in evaluations
        if item["developmentPassed"] and item["validationPassed"]
    ]
    for item in passed:
        current = variant_map[item["variant"]["variant_id"]]
        neighbors = [
            other for other in passed
            if neighbor(current, variant_map[other["variant"]["variant_id"]])
        ]
        item["neighborCount"] = len(neighbors)
        if neighbors:
            floor_returns = [
                min(
                    float(other["development2023"]["stressCompoundedReturnPct"]),
                    float(other["validation2024"]["stressCompoundedReturnPct"]),
                )
                for other in neighbors
            ]
            pf_without_best = [
                min(
                    float(other["development2023"]["profitFactorWithoutBest"] or 0),
                    float(other["validation2024"]["profitFactorWithoutBest"] or 0),
                )
                for other in neighbors
            ]
            turnover = [
                float(other["development2023"]["turnover"]) + float(other["validation2024"]["turnover"])
                for other in neighbors
            ]
            item["neighborhoodScore"] = (
                statistics.median(floor_returns)
                + statistics.median(pf_without_best) * 5.0
                - statistics.median(turnover) * 0.01
            )

    robust = [item for item in passed if item["neighborCount"] >= 8]
    robust.sort(
        key=lambda item: (
            item["neighborhoodScore"],
            min(
                item["development2023"]["stressCompoundedReturnPct"],
                item["validation2024"]["stressCompoundedReturnPct"],
            ),
            item["development2023"]["profitFactorWithoutBest"] or 0,
            -item["development2023"]["turnover"],
        ),
        reverse=True,
    )
    selected = robust[0] if robust else None
    confirmation_2025 = None
    final_2026 = None
    severe_2026 = None
    confirmation_ok = False
    final_ok = False
    severe_ok = False

    if selected:
        variant = variant_map[selected["variant"]["variant_id"]]
        targets = timed_target_cache[variant.variant_id]
        confirmation_2025 = v10.simulate(
            variant.base_variant, targets, base_execution, times, bars, indexes, funding,
            v4.START_2025, v4.START_2026,
        )
        confirmation_ok = confirmation_pass(confirmation_2025)
        if confirmation_ok:
            final_2026 = v10.simulate(
                variant.base_variant, targets, base_execution, times, bars, indexes, funding,
                v4.START_2026, v4.END,
            )
            severe_2026 = v10.simulate(
                variant.base_variant, targets, severe_execution, times, bars, indexes, funding,
                v4.START_2026, v4.END,
            )
            final_ok = final_pass(final_2026)
            severe_ok = (
                severe_2026["cycles"] >= 5
                and severe_2026["compoundedReturnPct"] >= -5
                and severe_2026["maxDrawdownPct"] >= -20
                and (severe_2026["profitFactor"] or 0) >= 0.9
            )

    if not selected:
        status = "NO_ROBUST_FACTOR_TIMING"
    elif not confirmation_ok:
        status = "CONFIRMATION_2025_REJECTED"
    elif not final_ok:
        status = "FINAL_2026_REJECTED"
    elif not severe_ok:
        status = "SEVERE_STRESS_REJECTED"
    else:
        status = "FORWARD_PAPER_CANDIDATE_ADAPTIVE"

    result = rounded({
        "version": 12,
        "strategyId": "CROSS_SECTIONAL_FACTOR_REGIME_V12",
        "generatedAt": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
        "status": status,
        "evaluatedVariants": len(variants),
        "developmentValidationPassed": len(passed),
        "robustNeighborhoodCandidates": len(robust),
        "selected": selected,
        "confirmation2025": confirmation_2025,
        "confirmationPassed": confirmation_ok,
        "final2026H1": final_2026,
        "finalPassed": final_ok,
        "severe2026H1": severe_2026,
        "severePassed": severe_ok,
        "paperEligible": status == "FORWARD_PAPER_CANDIDATE_ADAPTIVE",
        "liveEligible": False,
        "productionChanged": False,
        "realTradingEnabled": False,
        "topRobust": robust[:20],
        "fingerprint": hashlib.sha256(json.dumps({
            "bases": [base.__dict__ for base in bases],
            "selectors": [
                {"days": days, "threshold": threshold}
                for days in [30, 60, 90]
                for threshold in [0.0, 2.0, 5.0]
            ],
            "periods": [v4.START_2023, v4.START_2024, v4.START_2025, v4.START_2026, v4.END],
            "baseExecution": base_execution.__dict__,
            "severeExecution": severe_execution.__dict__,
        }, sort_keys=True).encode()).hexdigest(),
        "limitations": [
            "直近の実現Factor損益だけを使い、Momentum・Reversal・Cashを因果的に切り替える。",
            "2023 Development、2024 Validationで選定し、2025確認後に2026上期を一度だけ評価する。",
            "Factor timingは急な転換時に遅延し、往復コストが増える可能性がある。",
            "プロジェクト全体では2026相場を既に観測済みのため、通過してもadaptive Forward Paper候補に限定する。",
            "本番コード、VPS、.env、実売買runnerは変更しない。",
        ],
    })

    selected_label = selected["variant"]["variant_id"] if selected else "NONE"
    report = [
        "# Cross-Sectional Factor Regime V12",
        "",
        f"- Status: **{status}**",
        f"- Evaluated variants: {len(variants)}",
        f"- Development + Validation passed: {len(passed)}",
        f"- Robust neighborhood candidates: {len(robust)}",
        f"- Selected: `{selected_label}`",
        f"- Confirmation 2025: **{'PASS' if confirmation_ok else 'FAIL / NOT RUN'}**",
        f"- Final 2026 H1: **{'PASS' if final_ok else 'FAIL / NOT RUN'}**",
        f"- Severe stress: **{'PASS' if severe_ok else 'FAIL / NOT RUN'}**",
        f"- Paper eligible: **{'YES' if result['paperEligible'] else 'NO'}**",
        "- Live eligible: NO",
        "- Production changed: NO",
        "",
        "## Period results",
        "",
        "| Period | N | Compound | Stress | PF | Stress PF | DD | PF ex-best |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    if selected:
        for label, metrics in [
            ("2023 Development", selected["development2023"]),
            ("2024 Validation", selected["validation2024"]),
            ("2025 Confirmation", confirmation_2025),
            ("2026 H1 Final", final_2026),
            ("2026 H1 Severe", severe_2026),
        ]:
            if metrics:
                report.append(
                    f"| {label} | {metrics['cycles']} | {metrics['compoundedReturnPct']}% | "
                    f"{metrics['stressCompoundedReturnPct']}% | {metrics['profitFactor']} | "
                    f"{metrics['stressProfitFactor']} | {metrics['maxDrawdownPct']}% | "
                    f"{metrics['profitFactorWithoutBest']} |"
                )
    report.extend([
        "",
        "## Verdict",
        "",
        (
            "Factor Regime型が全時系列GateとSevere stressを通過しました。"
            "ただし固定Forward Paper以外には進めません。"
            if result["paperEligible"]
            else "全時系列Gateを通るFactor Regime型は見つかりませんでした。"
        ),
        "",
        "## Limitations",
        "",
        *[f"- {item}" for item in result["limitations"]],
    ])

    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "cross-sectional-factor-regime-v12.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (state_dir / "cross-sectional-factor-regime-v12.md").write_text(
        "\n".join(report),
        encoding="utf-8",
    )
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
