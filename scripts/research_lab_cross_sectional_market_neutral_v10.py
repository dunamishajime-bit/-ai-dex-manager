from __future__ import annotations

import hashlib
import json
import math
import os
import statistics
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

import research_lab_parameter_bagged_rotation_v4 as v4
import research_lab_precomputed_multi_regime_v6 as v6

ALT_SYMBOLS = ["ETH", "BNB", "SOL", "LINK", "AVAX"]
BETA_LOOKBACK_BARS = 60


@dataclass(frozen=True)
class Variant:
    variant_id: str
    score_mode: str
    short_days: int
    long_days: int
    rebalance_days: int
    top_k: int
    gross: float
    beta_neutral: bool
    min_spread_z: float


@dataclass(frozen=True)
class Execution:
    execution_id: str
    normal_cost_bps: float
    stress_cost_bps: float
    delay_bars: int
    adverse_funding_bps_per_12h: float


def log_returns(rows: List[dict], end: int, length: int) -> Optional[List[float]]:
    if end - length < 0:
        return None
    result: List[float] = []
    for index in range(end - length + 1, end + 1):
        previous = float(rows[index - 1]["close"])
        close = float(rows[index]["close"])
        if previous <= 0 or close <= 0:
            return None
        result.append(math.log(close / previous))
    return result


def beta_to_btc(
    asset_rows: List[dict],
    btc_rows: List[dict],
    asset_end: int,
    btc_end: int,
    length: int = BETA_LOOKBACK_BARS,
) -> Optional[float]:
    asset_returns = log_returns(asset_rows, asset_end, length)
    btc_returns = log_returns(btc_rows, btc_end, length)
    if not asset_returns or not btc_returns or len(asset_returns) != len(btc_returns):
        return None
    btc_mean = statistics.fmean(btc_returns)
    asset_mean = statistics.fmean(asset_returns)
    variance = sum((value - btc_mean) ** 2 for value in btc_returns)
    if variance <= 1e-12:
        return None
    covariance = sum(
        (asset - asset_mean) * (btc - btc_mean)
        for asset, btc in zip(asset_returns, btc_returns)
    )
    return max(0.1, min(3.0, covariance / variance))


def feature_cache(
    times: List[int],
    bars: Dict[str, List[dict]],
    indexes: Dict[str, Dict[int, int]],
) -> Dict[str, Dict[int, dict]]:
    days = [5, 10, 20, 30]
    result: Dict[str, Dict[int, dict]] = {symbol: {} for symbol in ["BTC", *ALT_SYMBOLS]}
    for ts in times:
        btc_index = indexes["BTC"].get(ts)
        if btc_index is None:
            continue
        btc_rows = bars["BTC"]
        btc_features = {
            f"mom_{day}": v4.momentum(btc_rows, btc_index, day * 2)
            for day in days
        }
        result["BTC"][ts] = btc_features
        for symbol in ALT_SYMBOLS:
            asset_index = indexes[symbol].get(ts)
            if asset_index is None:
                continue
            rows = bars[symbol]
            item = {
                f"mom_{day}": v4.momentum(rows, asset_index, day * 2)
                for day in days
            }
            item.update({
                f"vol_{day}": v4.realized_annual_vol(rows, asset_index, day * 2)
                for day in days
            })
            item["beta"] = beta_to_btc(rows, btc_rows, asset_index, btc_index)
            result[symbol][ts] = item
    return result


def standardized(values: Dict[str, float]) -> Dict[str, float]:
    if not values:
        return {}
    mean = statistics.fmean(values.values())
    deviation = statistics.pstdev(values.values()) if len(values) >= 2 else 0.0
    if deviation <= 1e-12:
        return {symbol: 0.0 for symbol in values}
    return {symbol: (value - mean) / deviation for symbol, value in values.items()}


def raw_scores(
    variant: Variant,
    ts: int,
    features: Dict[str, Dict[int, dict]],
) -> Dict[str, float]:
    btc = features["BTC"].get(ts)
    if not btc:
        return {}
    short_key = f"mom_{variant.short_days}"
    long_key = f"mom_{variant.long_days}"
    scores: Dict[str, float] = {}
    for symbol in ALT_SYMBOLS:
        item = features[symbol].get(ts)
        if not item:
            continue
        short_momentum = item.get(short_key)
        long_momentum = item.get(long_key)
        short_vol = item.get(f"vol_{variant.short_days}")
        long_vol = item.get(f"vol_{variant.long_days}")
        beta = item.get("beta")
        if None in (short_momentum, long_momentum, short_vol, long_vol, beta):
            continue
        if float(short_vol) <= 0 or float(long_vol) <= 0:
            continue
        if variant.score_mode == "BTC_RESIDUAL":
            btc_short = btc.get(short_key)
            btc_long = btc.get(long_key)
            if btc_short is None or btc_long is None:
                continue
            short_edge = float(short_momentum) - float(beta) * float(btc_short)
            long_edge = float(long_momentum) - float(beta) * float(btc_long)
        else:
            short_edge = float(short_momentum)
            long_edge = float(long_momentum)
        score = 0.35 * short_edge / max(10.0, float(short_vol))
        score += 0.65 * long_edge / max(10.0, float(long_vol))
        scores[symbol] = score
    return scores


def signal_target(
    variant: Variant,
    ts: int,
    features: Dict[str, Dict[int, dict]],
) -> Dict[str, float]:
    scores = standardized(raw_scores(variant, ts, features))
    if len(scores) < variant.top_k * 2:
        return {}
    ranked = sorted(scores.items(), key=lambda item: item[1], reverse=True)
    longs = ranked[:variant.top_k]
    shorts = ranked[-variant.top_k:]
    spread = statistics.fmean(score for _, score in longs) - statistics.fmean(score for _, score in shorts)
    if spread < variant.min_spread_z:
        return {}

    long_gross = variant.gross / 2.0
    short_gross = variant.gross / 2.0
    if variant.beta_neutral:
        long_betas = [
            float(features[symbol][ts]["beta"])
            for symbol, _ in longs
            if features[symbol][ts].get("beta") is not None
        ]
        short_betas = [
            float(features[symbol][ts]["beta"])
            for symbol, _ in shorts
            if features[symbol][ts].get("beta") is not None
        ]
        if long_betas and short_betas:
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
    result: Dict[int, Dict[str, float]] = {}
    current: Dict[str, float] = {}
    for index, ts in enumerate(times):
        if index % interval == 0:
            current = signal_target(variant, ts, features)
        result[ts] = dict(current)
    return result


def cycle_from_returns(start_ts: int, end_ts: int, normal: List[float], stress: List[float]) -> v4.Cycle:
    return v4.Cycle(
        start_ts=start_ts,
        end_ts=end_ts,
        normal_pct=v4.product_return(normal),
        stress_pct=v4.product_return(stress),
    )


def simulate(
    variant: Variant,
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
            cycles.append(cycle_from_returns(cycle_start, end_ts, cycle_normal, cycle_stress))
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
        funding_cost = 0.0
        for symbol, weight in portfolio.items():
            symbol_index = indexes[symbol].get(ts)
            if symbol_index is None:
                continue
            bar = bars[symbol][symbol_index]
            gross_return += weight * ((float(bar["close"]) / float(bar["open"]) - 1.0) * 100.0)
            funding_cost += weight * funding.get(symbol, {}).get(ts, 0.0)

        adverse = v4.gross_exposure(portfolio) * execution.adverse_funding_bps_per_12h / 100.0
        normal_value = gross_return - funding_cost - adverse - turnover * execution.normal_cost_bps / 100.0
        stress_value = gross_return - funding_cost - adverse - turnover * execution.stress_cost_bps / 100.0
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
    for score_mode in ["RISK_ADJ_MOM", "BTC_RESIDUAL"]:
        for short_days in [5, 10]:
            for long_days in [20, 30]:
                for rebalance_days in [1, 2, 3]:
                    for top_k in [1, 2]:
                        for gross in [0.6, 0.9]:
                            for beta_neutral in [False, True]:
                                for min_spread_z in [0.0, 1.5]:
                                    result.append(Variant(
                                        variant_id=(
                                            f"CSMN_{score_mode}_S{short_days}_L{long_days}"
                                            f"_R{rebalance_days}_K{top_k}_G{gross}"
                                            f"_B{1 if beta_neutral else 0}_D{min_spread_z}"
                                        ),
                                        score_mode=score_mode,
                                        short_days=short_days,
                                        long_days=long_days,
                                        rebalance_days=rebalance_days,
                                        top_k=top_k,
                                        gross=gross,
                                        beta_neutral=beta_neutral,
                                        min_spread_z=min_spread_z,
                                    ))
    return result


def discovery_pass(metrics: dict) -> bool:
    return (
        metrics["cycles"] >= 20
        and metrics["compoundedReturnPct"] > 0
        and metrics["stressCompoundedReturnPct"] > 0
        and (metrics["profitFactor"] or 0) >= 1.12
        and (metrics["stressProfitFactor"] or 0) >= 1.02
        and metrics["maxDrawdownPct"] >= -20
        and metrics["stressMaxDrawdownPct"] >= -25
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
        left.score_mode == right.score_mode
        and left.top_k == right.top_k
        and left.beta_neutral == right.beta_neutral
        and abs(left.short_days - right.short_days) <= 5
        and abs(left.long_days - right.long_days) <= 10
        and abs(left.rebalance_days - right.rebalance_days) <= 1
        and abs(left.gross - right.gross) <= 0.31
        and abs(left.min_spread_z - right.min_spread_z) <= 1.51
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
    features = feature_cache(times, bars, indexes)

    base_execution = Execution("BASE_10_30", 10, 30, 0, 0)
    severe_execution = Execution("SEVERE_50_DELAY12_FUND3", 50, 50, 1, 3)
    variant_list = variants()
    target_cache: Dict[str, Dict[int, Dict[str, float]]] = {}
    discovery: List[dict] = []

    for variant in variant_list:
        targets = scheduled_targets(variant, times, features)
        target_cache[variant.variant_id] = targets
        development = simulate(
            variant, targets, base_execution, times, bars, indexes, funding,
            v4.START_2023, v4.START_2024,
        )
        validation = simulate(
            variant, targets, base_execution, times, bars, indexes, funding,
            v4.START_2024, v4.START_2025,
        )
        discovery.append({
            "variant": variant.__dict__,
            "development2023": development,
            "validation2024": validation,
            "developmentPassed": discovery_pass(development),
            "validationPassed": validation_pass(validation),
            "neighborCount": 0,
            "neighborhoodScore": -999.0,
        })

    variant_map = {variant.variant_id: variant for variant in variant_list}
    passed = [
        item for item in discovery
        if item["developmentPassed"] and item["validationPassed"]
    ]
    for item in passed:
        current = variant_map[item["variant"]["variant_id"]]
        neighbors = [
            other for other in passed
            if neighbor(current, variant_map[other["variant"]["variant_id"]])
        ]
        item["neighborCount"] = len(neighbors)
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
        if neighbors:
            item["neighborhoodScore"] = (
                statistics.median(floor_returns)
                + statistics.median(pf_without_best) * 5.0
                - statistics.median(turnover) * 0.01
            )

    robust = [item for item in passed if item["neighborCount"] >= 6]
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
            variant, targets, base_execution, times, bars, indexes, funding,
            v4.START_2025, v4.START_2026,
        )
        confirmation_ok = confirmation_pass(confirmation_2025)
        if confirmation_ok:
            final_2026 = simulate(
                variant, targets, base_execution, times, bars, indexes, funding,
                v4.START_2026, v4.END,
            )
            severe_2026 = simulate(
                variant, targets, severe_execution, times, bars, indexes, funding,
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
        status = "NO_ROBUST_CROSS_SECTIONAL_EDGE"
    elif not confirmation_ok:
        status = "CONFIRMATION_2025_REJECTED"
    elif not final_ok:
        status = "FINAL_2026_REJECTED"
    elif not severe_ok:
        status = "SEVERE_STRESS_REJECTED"
    else:
        status = "FORWARD_PAPER_CANDIDATE_ADAPTIVE"

    result = rounded({
        "version": 10,
        "strategyId": "CROSS_SECTIONAL_MARKET_NEUTRAL_V10",
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
            "既存WIN80/V6 Entry時刻を使用しない独立クロスセクショナル戦略。",
            "2023 Development、2024 Validationで選定し、2025確認後に2026上期を一度だけ評価する。",
            "プロジェクト全体では2026相場を既に観測済みのため、通過してもadaptive Forward Paper候補に限定する。",
            "Aster実約定Spread/Slippage、借入制約、Short建玉上限は未検証。",
            "本番コード、VPS、.env、実売買runnerは変更しない。",
        ],
    })

    selected_label = selected["variant"]["variant_id"] if selected else "NONE"
    report = [
        "# Cross-Sectional Market Neutral V10",
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
            "独立した市場中立ロジックが全時系列GateとSevere stressを通過しました。"
            "ただし過去相場を既に観測したadaptive研究のため、固定Forward Paper以外には進めません。"
            if result["paperEligible"]
            else "全時系列Gateを通る市場中立ロジックは見つかりませんでした。"
        ),
        "",
        "## Limitations",
        "",
        *[f"- {item}" for item in result["limitations"]],
    ])

    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "cross-sectional-market-neutral-v10.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (state_dir / "cross-sectional-market-neutral-v10.md").write_text(
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
