from __future__ import annotations

import hashlib
import json
import math
import os
import statistics
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

import research_lab_parameter_bagged_rotation_v4 as v4

STRATEGY_ID = "CROSS_SECTIONAL_DISPERSION_REVERSAL_V48"
SYMBOLS = ["BTC", "ETH", "BNB", "SOL", "LINK", "AVAX"]
TRADE_SYMBOLS = ["ETH", "BNB", "SOL", "LINK", "AVAX"]
SIGNAL_WINDOWS = [12, 24, 48]
DISPERSION_LOOKBACKS = [168, 336, 720]
DISPERSION_Z = [1.5, 2.0, 2.5]
HOLD_HOURS = [12, 24, 48]
REBALANCE_HOURS = [12, 24]
NORMAL_ROUND_TRIP_BPS_PER_LEG = 10.0
STRESS_ROUND_TRIP_BPS_PER_LEG = 30.0
STRESS_DELAY_HOURS = 1


@dataclass(frozen=True)
class Variant:
    variant_id: str
    signal_window: int
    dispersion_lookback: int
    dispersion_z: float
    hold_hours: int
    rebalance_hours: int


def mean(values: List[float]) -> float:
    return statistics.fmean(values) if values else 0.0


def std(values: List[float]) -> float:
    return statistics.pstdev(values) if len(values) >= 2 else 0.0


def product_return(values: Iterable[float]) -> float:
    equity = 1.0
    for value in values:
        equity *= max(0.001, 1.0 + value / 100.0)
    return (equity - 1.0) * 100.0


def profit_factor(values: List[float]) -> Optional[float]:
    wins = sum(value for value in values if value > 0)
    losses = abs(sum(value for value in values if value < 0))
    if losses > 1e-12:
        return wins / losses
    return 999.0 if wins > 0 else None


def max_drawdown(values: List[float]) -> float:
    equity = 1.0
    peak = 1.0
    worst = 0.0
    for value in values:
        equity *= max(0.001, 1.0 + value / 100.0)
        peak = max(peak, equity)
        worst = min(worst, (equity / peak - 1.0) * 100.0)
    return worst


def quantile(values: List[float], q: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    position = (len(ordered) - 1) * q
    lo = math.floor(position)
    hi = math.ceil(position)
    if lo == hi:
        return ordered[lo]
    return ordered[lo] * (hi - position) + ordered[hi] * (position - lo)


def clean(raw: Dict[str, dict]) -> Dict[str, dict]:
    result: Dict[str, dict] = {}
    for symbol in SYMBOLS:
        rows = sorted(raw[symbol]["candles"], key=lambda row: int(row["ts"]))
        deduped = []
        last = None
        for row in rows:
            ts = int(row["ts"])
            if ts == last:
                continue
            deduped.append(row)
            last = ts
        result[symbol] = {"candles": deduped, "funding": raw[symbol].get("funding", [])}
    return result


def aligned(raw: Dict[str, dict]) -> Tuple[List[int], Dict[str, List[dict]]]:
    common = {int(row["ts"]) for row in raw[SYMBOLS[0]]["candles"]}
    for symbol in SYMBOLS[1:]:
        common &= {int(row["ts"]) for row in raw[symbol]["candles"]}
    timestamps = sorted(common)
    maps = {symbol: {int(row["ts"]): row for row in raw[symbol]["candles"]} for symbol in SYMBOLS}
    return timestamps, {symbol: [maps[symbol][ts] for ts in timestamps] for symbol in SYMBOLS}


def log_returns(rows: List[dict]) -> List[float]:
    values = [0.0]
    for index in range(1, len(rows)):
        previous = float(rows[index - 1]["close"])
        current = float(rows[index]["close"])
        values.append(math.log(current / previous) if previous > 0 and current > 0 else 0.0)
    return values


def prefix(values: List[float]) -> List[float]:
    result = [0.0]
    total = 0.0
    for value in values:
        total += value
        result.append(total)
    return result


def range_sum(pref: List[float], start: int, end: int) -> float:
    return pref[end + 1] - pref[start]


def funding_pct(points: List[dict], start_ts: int, end_ts: int, direction: int, weight: float) -> float:
    paid = sum(float(point["rate"]) * 100.0 for point in points if start_ts <= int(point["ts"]) < end_ts)
    return -direction * weight * paid


def forward_return(rows: List[dict], signal_index: int, hold: int, delay: int) -> Optional[Tuple[float, int, int]]:
    entry_index = signal_index + 1 + delay
    exit_index = entry_index + hold - 1
    if entry_index >= len(rows) or exit_index >= len(rows):
        return None
    entry = float(rows[entry_index]["open"])
    exit_price = float(rows[exit_index]["close"])
    if entry <= 0:
        return None
    return (exit_price / entry - 1.0) * 100.0, entry_index, exit_index


def variants() -> List[Variant]:
    return [
        Variant(
            f"W{window}_L{lookback}_Z{str(z).replace('.', 'p')}_H{hold}_R{rebalance}",
            window,
            lookback,
            z,
            hold,
            rebalance,
        )
        for window in SIGNAL_WINDOWS
        for lookback in DISPERSION_LOOKBACKS
        for z in DISPERSION_Z
        for hold in HOLD_HOURS
        for rebalance in REBALANCE_HOURS
        if rebalance <= hold
    ]


def build_signal_cache(returns: Dict[str, List[float]]) -> Dict[Tuple[int, int], List[Optional[Tuple[float, str, str]]]]:
    n = len(returns["BTC"])
    return_prefix = {symbol: prefix(returns[symbol]) for symbol in SYMBOLS}
    btc_sq_prefix = prefix([value * value for value in returns["BTC"]])
    cross_prefix = {
        symbol: prefix([a * b for a, b in zip(returns["BTC"], returns[symbol])])
        for symbol in TRADE_SYMBOLS
    }
    cache: Dict[Tuple[int, int], List[Optional[Tuple[float, str, str]]]] = {}

    for window in SIGNAL_WINDOWS:
        for lookback in DISPERSION_LOOKBACKS:
            residuals: List[Optional[Dict[str, float]]] = [None] * n
            dispersions: List[Optional[float]] = [None] * n
            for index in range(n):
                move_start = index - window + 1
                beta_start = index - lookback + 1
                if move_start < 1 or beta_start < 1:
                    continue
                btc_move = range_sum(return_prefix["BTC"], move_start, index)
                count = lookback
                sum_x = range_sum(return_prefix["BTC"], beta_start, index)
                sum_x2 = range_sum(btc_sq_prefix, beta_start, index)
                mx = sum_x / count
                variance = sum_x2 / count - mx * mx
                if variance <= 1e-12:
                    continue
                snapshot: Dict[str, float] = {}
                valid = True
                for symbol in TRADE_SYMBOLS:
                    move = range_sum(return_prefix[symbol], move_start, index)
                    sum_y = range_sum(return_prefix[symbol], beta_start, index)
                    sum_xy = range_sum(cross_prefix[symbol], beta_start, index)
                    my = sum_y / count
                    covariance = sum_xy / count - mx * my
                    beta = max(0.15, min(3.0, covariance / variance))
                    snapshot[symbol] = move - beta * btc_move
                if valid:
                    residuals[index] = snapshot
                    dispersions[index] = std(list(snapshot.values()))

            d_sum = [0.0]
            d_sq = [0.0]
            d_count = [0]
            for value in dispersions:
                if value is None:
                    d_sum.append(d_sum[-1])
                    d_sq.append(d_sq[-1])
                    d_count.append(d_count[-1])
                else:
                    d_sum.append(d_sum[-1] + value)
                    d_sq.append(d_sq[-1] + value * value)
                    d_count.append(d_count[-1] + 1)

            signals: List[Optional[Tuple[float, str, str]]] = [None] * n
            for index in range(n):
                snapshot = residuals[index]
                current = dispersions[index]
                if snapshot is None or current is None:
                    continue
                hist_start = max(window, index - lookback)
                hist_end = index - 1
                if hist_end < hist_start:
                    continue
                count_hist = d_count[hist_end + 1] - d_count[hist_start]
                if count_hist < 96:
                    continue
                total = d_sum[hist_end + 1] - d_sum[hist_start]
                total_sq = d_sq[hist_end + 1] - d_sq[hist_start]
                hist_mean = total / count_hist
                variance_hist = max(0.0, total_sq / count_hist - hist_mean * hist_mean)
                scale = math.sqrt(variance_hist)
                if scale <= 1e-10:
                    continue
                z_score = (current - hist_mean) / scale
                winner = max(snapshot, key=snapshot.get)
                loser = min(snapshot, key=snapshot.get)
                if winner != loser:
                    signals[index] = (z_score, winner, loser)
            cache[(window, lookback)] = signals
    return cache


def simulate(variant: Variant, raw: Dict[str, dict], timestamps: List[int], rows: Dict[str, List[dict]], signal_cache: Dict[Tuple[int, int], List[Optional[Tuple[float, str, str]]]], start: int, end: int) -> dict:
    normal_values: List[float] = []
    stress_values: List[float] = []
    year_values: Dict[str, List[float]] = {}
    symbol_values: Dict[str, List[float]] = {symbol: [] for symbol in TRADE_SYMBOLS}
    next_free_index = 0
    dispersion_scores: List[float] = []
    signals = signal_cache[(variant.signal_window, variant.dispersion_lookback)]

    for index, ts in enumerate(timestamps):
        if ts < start or ts >= end or index < next_free_index or index % variant.rebalance_hours != 0:
            continue
        signal = signals[index]
        if signal is None:
            continue
        z_score, winner, loser = signal
        if z_score < variant.dispersion_z:
            continue
        long_normal = forward_return(rows[loser], index, variant.hold_hours, 0)
        short_normal = forward_return(rows[winner], index, variant.hold_hours, 0)
        long_stress = forward_return(rows[loser], index, variant.hold_hours, STRESS_DELAY_HOURS)
        short_stress = forward_return(rows[winner], index, variant.hold_hours, STRESS_DELAY_HOURS)
        if None in (long_normal, short_normal, long_stress, short_stress):
            continue
        assert long_normal and short_normal and long_stress and short_stress
        weight = 0.5
        normal = weight * long_normal[0] - weight * short_normal[0]
        stress = weight * long_stress[0] - weight * short_stress[0]
        normal -= 2 * NORMAL_ROUND_TRIP_BPS_PER_LEG / 100.0
        stress -= 2 * STRESS_ROUND_TRIP_BPS_PER_LEG / 100.0

        entry_ts = timestamps[long_normal[1]]
        exit_ts = timestamps[long_normal[2]] + v4.HOUR
        stress_entry_ts = timestamps[long_stress[1]]
        stress_exit_ts = timestamps[long_stress[2]] + v4.HOUR
        normal += funding_pct(raw[loser].get("funding", []), entry_ts, exit_ts, 1, weight)
        normal += funding_pct(raw[winner].get("funding", []), entry_ts, exit_ts, -1, weight)
        stress += funding_pct(raw[loser].get("funding", []), stress_entry_ts, stress_exit_ts, 1, weight)
        stress += funding_pct(raw[winner].get("funding", []), stress_entry_ts, stress_exit_ts, -1, weight)

        normal_values.append(normal)
        stress_values.append(stress)
        symbol_values[loser].append(normal * weight)
        symbol_values[winner].append(normal * weight)
        year = str(datetime.fromtimestamp(ts / 1000, tz=timezone.utc).year)
        year_values.setdefault(year, []).append(normal)
        next_free_index = long_normal[2] + 1
        dispersion_scores.append(z_score)

    low = quantile(normal_values, 0.01) if normal_values else 0.0
    high = quantile(normal_values, 0.99) if normal_values else 0.0
    winsorized = [min(high, max(low, value)) for value in normal_values]
    without_best = sorted(normal_values)[:-1] if len(normal_values) > 1 else []
    return {
        "trades": len(normal_values),
        "winRatePct": 100.0 * sum(value > 0 for value in normal_values) / len(normal_values) if normal_values else 0.0,
        "averagePct": mean(normal_values),
        "winsorizedAveragePct": mean(winsorized),
        "compoundedReturnPct": product_return(normal_values),
        "stressCompoundedReturnPct": product_return(stress_values),
        "profitFactor": profit_factor(normal_values),
        "stressProfitFactor": profit_factor(stress_values),
        "profitFactorWithoutBest": profit_factor(without_best),
        "maxDrawdownPct": max_drawdown(normal_values),
        "medianDispersionZ": statistics.median(dispersion_scores) if dispersion_scores else 0.0,
        "symbolBreakdown": {symbol: {"observations": len(items), "averageContributionPct": mean(items)} for symbol, items in symbol_values.items()},
        "yearBreakdown": {year: {"trades": len(items), "returnPct": product_return(items), "profitFactor": profit_factor(items), "maxDrawdownPct": max_drawdown(items)} for year, items in sorted(year_values.items())},
    }


def gate(metrics: dict, stage: str) -> bool:
    minimum = {"development": 20, "validation": 14, "confirmation": 14, "final": 5}[stage]
    pf_floor = {"development": 1.15, "validation": 1.08, "confirmation": 1.05, "final": 1.00}[stage]
    dd_floor = {"development": -20.0, "validation": -20.0, "confirmation": -20.0, "final": -15.0}[stage]
    return (
        metrics["trades"] >= minimum
        and metrics["averagePct"] > 0
        and metrics["winsorizedAveragePct"] > 0
        and (metrics["profitFactor"] or 0) >= pf_floor
        and (metrics["stressProfitFactor"] or 0) >= 1.0
        and (metrics["profitFactorWithoutBest"] or 0) >= 0.95
        and metrics["maxDrawdownPct"] >= dd_floor
    )


def is_neighbor(left: Variant, right: Variant) -> bool:
    dimensions = [
        (SIGNAL_WINDOWS, left.signal_window, right.signal_window),
        (DISPERSION_LOOKBACKS, left.dispersion_lookback, right.dispersion_lookback),
        (DISPERSION_Z, left.dispersion_z, right.dispersion_z),
        (HOLD_HOURS, left.hold_hours, right.hold_hours),
        (REBALANCE_HOURS, left.rebalance_hours, right.rebalance_hours),
    ]
    differences = 0
    for values, a, b in dimensions:
        if a == b:
            continue
        if a not in values or b not in values or abs(values.index(a) - values.index(b)) != 1:
            return False
        differences += 1
    return differences == 1


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
    raw = clean({symbol: v4.load_symbol(cache_root, symbol) for symbol in SYMBOLS})
    timestamps, rows = aligned(raw)
    returns = {symbol: log_returns(rows[symbol]) for symbol in SYMBOLS}
    signal_cache = build_signal_cache(returns)
    model_map = {variant.variant_id: variant for variant in variants()}
    tested = []
    for variant in variants():
        development = simulate(variant, raw, timestamps, rows, signal_cache, v4.START_2023, v4.START_2024)
        validation = simulate(variant, raw, timestamps, rows, signal_cache, v4.START_2024, v4.START_2025)
        tested.append({"variant": variant.__dict__, "development2023": development, "validation2024": validation, "developmentPassed": gate(development, "development"), "validationPassed": gate(validation, "validation"), "neighborCount": 0, "neighborhoodScore": -999.0})

    passed = [item for item in tested if item["developmentPassed"] and item["validationPassed"]]
    for item in passed:
        current = model_map[item["variant"]["variant_id"]]
        neighbors = [other for other in passed if is_neighbor(current, model_map[other["variant"]["variant_id"]])]
        item["neighborCount"] = len(neighbors)
        if neighbors:
            item["neighborhoodScore"] = statistics.median(min(other["development2023"]["stressProfitFactor"] or 0, other["validation2024"]["stressProfitFactor"] or 0) for other in neighbors)
    robust = [item for item in passed if item["neighborCount"] >= 2]
    robust.sort(key=lambda item: (item["neighborhoodScore"], min(item["development2023"]["profitFactor"] or 0, item["validation2024"]["profitFactor"] or 0), item["validation2024"]["winsorizedAveragePct"]), reverse=True)
    selected = robust[0] if robust else None
    confirmation = final = None
    confirmation_passed = final_passed = False
    if selected:
        variant = model_map[selected["variant"]["variant_id"]]
        confirmation = simulate(variant, raw, timestamps, rows, signal_cache, v4.START_2025, v4.START_2026)
        confirmation_passed = gate(confirmation, "confirmation")
        if confirmation_passed:
            final = simulate(variant, raw, timestamps, rows, signal_cache, v4.START_2026, v4.END)
            final_passed = gate(final, "final")

    status = "NO_ROBUST_DISPERSION_REVERSAL_EDGE" if not selected else "CONFIRMATION_REJECTED" if not confirmation_passed else "FINAL_PERIOD_REJECTED" if not final_passed else "FORWARD_PAPER_CANDIDATE"
    constraints = [
        "既存WIN80/V6 Entry時刻、Entry確認、損切り、利益延長、Cash時mean-reversionを使用しない。",
        "BTCベータ控除後の極端なクロスセクション分散だけを対象に、残差上位をShort・下位をLongする等ドル中立構造。",
        "DevelopmentとValidation通過後に近接パラメータ安定性を要求し、Confirmation通過前は最終期間を参照しない。",
        "両脚Fee・Slippage・Funding、1時間遅延Stress、1%/99% Winsorize、最良取引除外PFを含む。",
        "同じ回でHoldout結果を見た条件変更を行わない。",
        "本番コード、VPS、.env、実売買runner、realTradingEnabledを変更しない。",
    ]
    result = rounded({
        "version": 48,
        "strategyId": STRATEGY_ID,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "economicRationale": "Forced deleveraging and fragmented liquidity can create temporary idiosyncratic overreaction among altcoin perpetuals. After removing BTC beta, the strategy buys the residual loser and shorts the residual winner, targeting convergence rather than directional beta.",
        "status": status,
        "evaluatedVariants": len(tested),
        "developmentValidationPassed": len(passed),
        "robustNeighborhoodCandidates": len(robust),
        "selected": selected,
        "confirmation2025": confirmation,
        "confirmationPassed": confirmation_passed,
        "final2026H1": final,
        "finalPassed": final_passed,
        "paperEligible": status == "FORWARD_PAPER_CANDIDATE",
        "liveEligible": False,
        "productionChanged": False,
        "realTradingEnabled": False,
        "topRobust": robust[:20],
        "constraints": constraints,
        "fingerprint": hashlib.sha256(json.dumps({"strategy": STRATEGY_ID, "variants": [variant.__dict__ for variant in variants()], "periods": [v4.START_2023, v4.START_2024, v4.START_2025, v4.START_2026, v4.END], "costs": [NORMAL_ROUND_TRIP_BPS_PER_LEG, STRESS_ROUND_TRIP_BPS_PER_LEG], "delay": STRESS_DELAY_HOURS}, sort_keys=True).encode()).hexdigest(),
    })
    selected_id = selected["variant"]["variant_id"] if selected else "NONE"
    report = [
        "# Cross-Sectional Dispersion Reversal V48", "",
        f"- Status: **{status}**",
        f"- Evaluated variants: {len(tested)}",
        f"- Development + Validation passed: {len(passed)}",
        f"- Robust neighborhood candidates: {len(robust)}",
        f"- Selected: `{selected_id}`",
        f"- Confirmation 2025: **{'PASS' if confirmation_passed else 'FAIL / NOT RUN'}**",
        f"- Final period: **{'PASS' if final_passed else 'FAIL / NOT RUN'}**",
        f"- Paper eligible: **{'YES' if result['paperEligible'] else 'NO'}**",
        "- Live eligible: NO", "- Production changed: NO", "",
        "## Economic rationale", "",
        "Extreme BTC-beta-adjusted dispersion can reflect forced liquidations and temporary liquidity imbalance. V48 trades only the convergence spread: residual loser Long versus residual winner Short.", "",
        "## Constraints", "", *[f"- {item}" for item in constraints],
    ]
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "cross-sectional-dispersion-reversal-v48.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    (state_dir / "cross-sectional-dispersion-reversal-v48.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
