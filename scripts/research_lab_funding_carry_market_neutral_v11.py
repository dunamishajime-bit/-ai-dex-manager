from __future__ import annotations

import hashlib
import json
import os
import statistics
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional

import research_lab_parameter_bagged_rotation_v4 as v4
import research_lab_precomputed_multi_regime_v6 as v6
import research_lab_cross_sectional_market_neutral_v10 as v10

ALT_SYMBOLS = ["ETH", "BNB", "SOL", "LINK", "AVAX"]


@dataclass(frozen=True)
class Variant:
    variant_id: str
    funding_days: int
    momentum_days: int
    momentum_weight: float
    rebalance_days: int
    top_k: int
    gross: float
    beta_neutral: bool
    min_funding_spread_bps: float


@dataclass(frozen=True)
class Execution:
    execution_id: str
    normal_cost_bps: float
    stress_cost_bps: float
    delay_bars: int
    adverse_funding_bps_per_12h: float


def trailing_funding_pct(
    buckets: Dict[int, float],
    times: List[int],
    time_index: int,
    length: int,
) -> Optional[float]:
    if time_index - length + 1 < 0:
        return None
    values = [float(buckets.get(times[index], 0.0)) for index in range(time_index - length + 1, time_index + 1)]
    return statistics.fmean(values) if values else None


def feature_cache(
    times: List[int],
    bars: Dict[str, List[dict]],
    indexes: Dict[str, Dict[int, int]],
    funding: Dict[str, Dict[int, float]],
) -> Dict[str, Dict[int, dict]]:
    result: Dict[str, Dict[int, dict]] = {symbol: {} for symbol in ALT_SYMBOLS}
    btc_rows = bars["BTC"]
    for time_index, ts in enumerate(times):
        btc_index = indexes["BTC"].get(ts)
        if btc_index is None:
            continue
        for symbol in ALT_SYMBOLS:
            symbol_index = indexes[symbol].get(ts)
            if symbol_index is None:
                continue
            rows = bars[symbol]
            item = {
                "beta": v10.beta_to_btc(rows, btc_rows, symbol_index, btc_index),
                "mom_5": v4.momentum(rows, symbol_index, 10),
                "mom_10": v4.momentum(rows, symbol_index, 20),
            }
            for days in [3, 7, 14]:
                item[f"fund_{days}"] = trailing_funding_pct(
                    funding.get(symbol, {}),
                    times,
                    time_index,
                    days * 2,
                )
            result[symbol][ts] = item
    return result


def signal_target(
    variant: Variant,
    ts: int,
    features: Dict[str, Dict[int, dict]],
) -> Dict[str, float]:
    funding_values: Dict[str, float] = {}
    momentum_values: Dict[str, float] = {}
    for symbol in ALT_SYMBOLS:
        item = features[symbol].get(ts)
        if not item:
            continue
        funding_value = item.get(f"fund_{variant.funding_days}")
        momentum_value = item.get(f"mom_{variant.momentum_days}")
        beta = item.get("beta")
        if None in (funding_value, momentum_value, beta):
            continue
        funding_values[symbol] = float(funding_value)
        momentum_values[symbol] = float(momentum_value)
    if len(funding_values) < variant.top_k * 2:
        return {}

    funding_spread_bps = (max(funding_values.values()) - min(funding_values.values())) * 100.0
    if funding_spread_bps < variant.min_funding_spread_bps:
        return {}

    funding_z = v10.standardized(funding_values)
    momentum_z = v10.standardized(momentum_values)
    scores = {
        symbol: -funding_z[symbol] + variant.momentum_weight * momentum_z.get(symbol, 0.0)
        for symbol in funding_values
    }
    ranked = sorted(scores.items(), key=lambda item: item[1], reverse=True)
    longs = ranked[:variant.top_k]
    shorts = ranked[-variant.top_k:]
    if set(symbol for symbol, _ in longs) & set(symbol for symbol, _ in shorts):
        return {}

    long_gross = variant.gross / 2.0
    short_gross = variant.gross / 2.0
    if variant.beta_neutral:
        long_betas = [float(features[symbol][ts]["beta"]) for symbol, _ in longs]
        short_betas = [float(features[symbol][ts]["beta"]) for symbol, _ in shorts]
        average_long_beta = statistics.fmean(long_betas)
        average_short_beta = statistics.fmean(short_betas)
        denominator = average_long_beta + average_short_beta
        if denominator > 1e-9:
            long_gross = variant.gross * average_short_beta / denominator
            short_gross = variant.gross - long_gross

    target: Dict[str, float] = {}
    for symbol, _ in longs:
        target[symbol] = long_gross / len(longs)
    for symbol, _ in shorts:
        target[symbol] = -short_gross / len(shorts)
    return target


def scheduled_targets(
    variant: Variant,
    times: List[int],
    features: Dict[str, Dict[int, dict]],
) -> Dict[int, Dict[str, float]]:
    interval = max(1, variant.rebalance_days * 2)
    current: Dict[str, float] = {}
    result: Dict[int, Dict[str, float]] = {}
    for index, ts in enumerate(times):
        if index % interval == 0:
            current = signal_target(variant, ts, features)
        result[ts] = dict(current)
    return result


def simulate(
    targets: Dict[int, Dict[str, float]],
    execution: Execution,
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
    cycle_normal: List[float] = []
    cycle_stress: List[float] = []

    def close_cycle(end_ts: int) -> None:
        nonlocal cycle_start, cycle_normal, cycle_stress
        if cycle_start >= 0 and cycle_normal:
            cycles.append(v4.Cycle(
                cycle_start,
                end_ts,
                v4.product_return(cycle_normal),
                v4.product_return(cycle_stress),
            ))
        cycle_start = -1
        cycle_normal = []
        cycle_stress = []

    for ts in active_times:
        source_index = global_index[ts] - 1 - execution.delay_bars
        next_portfolio = targets.get(times[source_index], {}) if source_index >= 0 else {}
        turnover = 0.0
        if next_portfolio != portfolio:
            close_cycle(ts - 1)
            turnover = v4.turnover(portfolio, next_portfolio)
            portfolio = next_portfolio
            if v4.gross_exposure(portfolio) > 0:
                cycle_start = ts

        gross_return = 0.0
        actual_funding = 0.0
        for symbol, weight in portfolio.items():
            symbol_index = indexes[symbol].get(ts)
            if symbol_index is None:
                continue
            bar = bars[symbol][symbol_index]
            gross_return += weight * ((float(bar["close"]) / float(bar["open"]) - 1.0) * 100.0)
            actual_funding += weight * funding.get(symbol, {}).get(ts, 0.0)

        adverse = v4.gross_exposure(portfolio) * execution.adverse_funding_bps_per_12h / 100.0
        normal_value = gross_return - actual_funding - adverse - turnover * execution.normal_cost_bps / 100.0
        stress_value = gross_return - actual_funding - adverse - turnover * execution.stress_cost_bps / 100.0
        rows.append({
            "ts": ts,
            "normal_pct": normal_value,
            "stress_pct": stress_value,
            "exposure": v4.gross_exposure(portfolio),
            "turnover": turnover,
        })
        if cycle_start >= 0:
            cycle_normal.append(normal_value)
            cycle_stress.append(stress_value)

    final_turnover = v4.gross_exposure(portfolio)
    if final_turnover > 0 and rows:
        normal_cost = final_turnover * execution.normal_cost_bps / 100.0
        stress_cost = final_turnover * execution.stress_cost_bps / 100.0
        rows[-1]["normal_pct"] -= normal_cost
        rows[-1]["stress_pct"] -= stress_cost
        rows[-1]["turnover"] += final_turnover
        if cycle_normal:
            cycle_normal[-1] -= normal_cost
            cycle_stress[-1] -= stress_cost
    close_cycle(end - 1)
    return v4.metrics(rows, cycles, start, end)


def variants() -> List[Variant]:
    result: List[Variant] = []
    for funding_days in [3, 7, 14]:
        for momentum_days in [5, 10]:
            for momentum_weight in [0.0, 0.3]:
                for rebalance_days in [1, 2, 3]:
                    for top_k in [1, 2]:
                        for gross in [0.6, 0.9]:
                            for beta_neutral in [False, True]:
                                for minimum_spread in [0.0, 1.0, 2.0]:
                                    result.append(Variant(
                                        variant_id=(
                                            f"FCARRY_F{funding_days}_M{momentum_days}_W{momentum_weight}"
                                            f"_R{rebalance_days}_K{top_k}_G{gross}"
                                            f"_B{1 if beta_neutral else 0}_S{minimum_spread}"
                                        ),
                                        funding_days=funding_days,
                                        momentum_days=momentum_days,
                                        momentum_weight=momentum_weight,
                                        rebalance_days=rebalance_days,
                                        top_k=top_k,
                                        gross=gross,
                                        beta_neutral=beta_neutral,
                                        min_funding_spread_bps=minimum_spread,
                                    ))
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


def neighbor(left: Variant, right: Variant) -> bool:
    return (
        left.top_k == right.top_k
        and left.beta_neutral == right.beta_neutral
        and abs(left.funding_days - right.funding_days) <= 7
        and abs(left.momentum_days - right.momentum_days) <= 5
        and abs(left.momentum_weight - right.momentum_weight) <= 0.31
        and abs(left.rebalance_days - right.rebalance_days) <= 1
        and abs(left.gross - right.gross) <= 0.31
        and abs(left.min_funding_spread_bps - right.min_funding_spread_bps) <= 1.01
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
    features = feature_cache(times, bars, indexes, funding)

    base_execution = Execution("BASE_10_30", 10, 30, 0, 0)
    severe_execution = Execution("SEVERE_50_DELAY12_FUND3", 50, 50, 1, 3)
    variant_list = variants()
    target_cache: Dict[str, Dict[int, Dict[str, float]]] = {}
    evaluations: List[dict] = []

    for variant in variant_list:
        targets = scheduled_targets(variant, times, features)
        target_cache[variant.variant_id] = targets
        development = simulate(
            targets, base_execution, times, bars, indexes, funding,
            v4.START_2023, v4.START_2024,
        )
        validation = simulate(
            targets, base_execution, times, bars, indexes, funding,
            v4.START_2024, v4.START_2025,
        )
        evaluations.append({
            "variant": variant.__dict__,
            "development2023": development,
            "validation2024": validation,
            "developmentPassed": development_pass(development),
            "validationPassed": validation_pass(validation),
            "neighborCount": 0,
            "neighborhoodScore": -999.0,
        })

    variant_map = {variant.variant_id: variant for variant in variant_list}
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
        targets = target_cache[variant.variant_id]
        confirmation_2025 = simulate(
            targets, base_execution, times, bars, indexes, funding,
            v4.START_2025, v4.START_2026,
        )
        confirmation_ok = confirmation_pass(confirmation_2025)
        if confirmation_ok:
            final_2026 = simulate(
                targets, base_execution, times, bars, indexes, funding,
                v4.START_2026, v4.END,
            )
            severe_2026 = simulate(
                targets, severe_execution, times, bars, indexes, funding,
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
        status = "NO_ROBUST_FUNDING_CARRY"
    elif not confirmation_ok:
        status = "CONFIRMATION_2025_REJECTED"
    elif not final_ok:
        status = "FINAL_2026_REJECTED"
    elif not severe_ok:
        status = "SEVERE_STRESS_REJECTED"
    else:
        status = "FORWARD_PAPER_CANDIDATE_ADAPTIVE"

    result = rounded({
        "version": 11,
        "strategyId": "FUNDING_CARRY_MARKET_NEUTRAL_V11",
        "generatedAt": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
        "status": status,
        "evaluatedVariants": len(variant_list),
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
            "variants": [variant.__dict__ for variant in variant_list],
            "periods": [v4.START_2023, v4.START_2024, v4.START_2025, v4.START_2026, v4.END],
            "baseExecution": base_execution.__dict__,
            "severeExecution": severe_execution.__dict__,
        }, sort_keys=True).encode()).hexdigest(),
        "limitations": [
            "価格モメンタム単独ではなく、Funding需給差を主因とする市場中立戦略。",
            "2023 Development、2024 Validationで選定し、2025確認後に2026上期を一度だけ評価する。",
            "Binance USD-M Fundingを使用しており、AsterのFunding・建玉制約とは一致しない。",
            "プロジェクト全体では2026相場を既に観測済みのため、通過してもadaptive Forward Paper候補に限定する。",
            "本番コード、VPS、.env、実売買runnerは変更しない。",
        ],
    })

    selected_label = selected["variant"]["variant_id"] if selected else "NONE"
    report = [
        "# Funding Carry Market Neutral V11",
        "",
        f"- Status: **{status}**",
        f"- Evaluated variants: {len(variant_list)}",
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
            "Funding Carry型が全時系列GateとSevere stressを通過しました。"
            "ただしAster実データでの固定Forward Paper以外には進めません。"
            if result["paperEligible"]
            else "全時系列Gateを通るFunding Carry型は見つかりませんでした。"
        ),
        "",
        "## Limitations",
        "",
        *[f"- {item}" for item in result["limitations"]],
    ])

    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "funding-carry-market-neutral-v11.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (state_dir / "funding-carry-market-neutral-v11.md").write_text(
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
