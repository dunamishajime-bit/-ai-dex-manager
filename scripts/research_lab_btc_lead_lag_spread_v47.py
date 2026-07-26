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

STRATEGY_ID = "BTC_LEAD_LAG_SPREAD_V47"
LEADER = "BTC"
FOLLOWERS = ["ETH", "BNB", "SOL", "LINK", "AVAX"]
SYMBOLS = [LEADER, *FOLLOWERS]
SHOCK_WINDOWS = [1, 2, 4]
SHOCK_Z = [1.5, 2.0, 2.5]
GAP_Z = [0.5, 1.0, 1.5]
HOLD_HOURS = [2, 4, 8, 12]
BETA_LOOKBACKS = [336, 720]
NORMAL_ROUND_TRIP_BPS_PER_LEG = 10.0
STRESS_ROUND_TRIP_BPS_PER_LEG = 30.0
STRESS_DELAY_HOURS = 1
MIN_BETA_OBSERVATIONS = 168


@dataclass(frozen=True)
class Variant:
    variant_id: str
    shock_window: int
    shock_z: float
    gap_z: float
    hold_hours: int
    beta_lookback: int


@dataclass(frozen=True)
class Trade:
    follower: str
    signal_ts: int
    entry_ts: int
    exit_ts: int
    direction: int
    normal_pct: float
    stress_pct: float


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
    drawdown = 0.0
    for value in values:
        equity *= max(0.001, 1.0 + value / 100.0)
        peak = max(peak, equity)
        drawdown = min(drawdown, (equity / peak - 1.0) * 100.0)
    return drawdown


def quantile(values: List[float], q: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    position = (len(ordered) - 1) * q
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    return ordered[lower] * (upper - position) + ordered[upper] * (position - lower)


def mean(values: List[float]) -> float:
    return statistics.fmean(values) if values else 0.0


def std(values: List[float]) -> float:
    return statistics.pstdev(values) if len(values) >= 2 else 0.0


def funding_pct(points: List[dict], start_ts: int, end_ts: int, direction: int, weight: float) -> float:
    paid = sum(float(point["rate"]) * 100.0 for point in points if start_ts <= int(point["ts"]) < end_ts)
    return -direction * weight * paid


def clean(raw: Dict[str, dict]) -> Dict[str, dict]:
    result: Dict[str, dict] = {}
    for symbol in SYMBOLS:
        candles = sorted(raw[symbol]["candles"], key=lambda row: int(row["ts"]))
        deduped = []
        last = None
        for row in candles:
            ts = int(row["ts"])
            if ts == last:
                continue
            deduped.append(row)
            last = ts
        result[symbol] = {"candles": deduped, "funding": raw[symbol].get("funding", [])}
    return result


def common_timestamps(raw: Dict[str, dict]) -> List[int]:
    sets = [{int(row["ts"]) for row in raw[symbol]["candles"]} for symbol in SYMBOLS]
    common = sets[0]
    for item in sets[1:]:
        common &= item
    return sorted(common)


def aligned(raw: Dict[str, dict]) -> Tuple[List[int], Dict[str, List[dict]]]:
    timestamps = common_timestamps(raw)
    maps = {symbol: {int(row["ts"]): row for row in raw[symbol]["candles"]} for symbol in SYMBOLS}
    return timestamps, {symbol: [maps[symbol][ts] for ts in timestamps] for symbol in SYMBOLS}


def log_returns(rows: List[dict]) -> List[float]:
    values = [0.0]
    for index in range(1, len(rows)):
        previous = float(rows[index - 1]["close"])
        current = float(rows[index]["close"])
        values.append(math.log(current / previous) if previous > 0 and current > 0 else 0.0)
    return values


def cumulative_return(returns: List[float], end: int, window: int) -> Optional[float]:
    if end - window + 1 < 1:
        return None
    return sum(returns[end - window + 1:end + 1])


def rolling_beta_and_residual(
    leader_returns: List[float],
    follower_returns: List[float],
    end: int,
    lookback: int,
) -> Optional[Tuple[float, float]]:
    start = end - lookback + 1
    if start < 1:
        return None
    x = leader_returns[start:end + 1]
    y = follower_returns[start:end + 1]
    if len(x) < MIN_BETA_OBSERVATIONS:
        return None
    mx = mean(x)
    my = mean(y)
    variance = mean([(value - mx) ** 2 for value in x])
    if variance <= 1e-12:
        return None
    covariance = mean([(left - mx) * (right - my) for left, right in zip(x, y)])
    beta = max(0.15, min(3.0, covariance / variance))
    residuals = [right - beta * left for left, right in zip(x, y)]
    residual_std = std(residuals)
    if residual_std <= 1e-8:
        return None
    return beta, residual_std


def forward_leg_return(rows: List[dict], signal_index: int, hold: int, delay: int) -> Optional[Tuple[float, int, int]]:
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
            f"SW{window}_SZ{str(shock).replace('.', 'p')}_GZ{str(gap).replace('.', 'p')}_H{hold}_B{lookback}",
            window,
            shock,
            gap,
            hold,
            lookback,
        )
        for window in SHOCK_WINDOWS
        for shock in SHOCK_Z
        for gap in GAP_Z
        for hold in HOLD_HOURS
        for lookback in BETA_LOOKBACKS
    ]


def simulate(
    variant: Variant,
    raw: Dict[str, dict],
    timestamps: List[int],
    rows: Dict[str, List[dict]],
    returns: Dict[str, List[float]],
    start: int,
    end: int,
) -> dict:
    trades: List[Trade] = []
    cycle_normal: List[float] = []
    cycle_stress: List[float] = []
    follower_values: Dict[str, List[float]] = {symbol: [] for symbol in FOLLOWERS}
    year_values: Dict[str, List[float]] = {}
    next_free_index = 0
    rolling_shocks: List[float] = []

    for index, ts in enumerate(timestamps):
        if ts < start or ts >= end or index < next_free_index:
            continue
        shock = cumulative_return(returns[LEADER], index, variant.shock_window)
        if shock is None:
            continue
        history_start = index - variant.beta_lookback + 1
        if history_start < variant.shock_window:
            continue
        historical_shocks = [
            value
            for cursor in range(history_start, index)
            if (value := cumulative_return(returns[LEADER], cursor, variant.shock_window)) is not None
        ]
        shock_scale = std(historical_shocks)
        if shock_scale <= 1e-8 or abs(shock) / shock_scale < variant.shock_z:
            continue

        candidates = []
        for follower in FOLLOWERS:
            beta_residual = rolling_beta_and_residual(returns[LEADER], returns[follower], index, variant.beta_lookback)
            follower_move = cumulative_return(returns[follower], index, variant.shock_window)
            if beta_residual is None or follower_move is None:
                continue
            beta, residual_std = beta_residual
            gap = beta * shock - follower_move
            gap_score = abs(gap) / (residual_std * math.sqrt(variant.shock_window))
            if gap_score < variant.gap_z or gap * shock <= 0:
                continue
            candidates.append((gap_score, follower, beta, 1 if gap > 0 else -1))
        if not candidates:
            continue
        _, follower, beta, direction = max(candidates)

        follower_normal = forward_leg_return(rows[follower], index, variant.hold_hours, 0)
        leader_normal = forward_leg_return(rows[LEADER], index, variant.hold_hours, 0)
        follower_stress = forward_leg_return(rows[follower], index, variant.hold_hours, STRESS_DELAY_HOURS)
        leader_stress = forward_leg_return(rows[LEADER], index, variant.hold_hours, STRESS_DELAY_HOURS)
        if None in (follower_normal, leader_normal, follower_stress, leader_stress):
            continue
        assert follower_normal and leader_normal and follower_stress and leader_stress
        follower_weight = 0.5
        leader_weight = 0.5
        normal = direction * follower_weight * follower_normal[0] - direction * leader_weight * leader_normal[0]
        stress = direction * follower_weight * follower_stress[0] - direction * leader_weight * leader_stress[0]
        normal -= 2 * NORMAL_ROUND_TRIP_BPS_PER_LEG / 100.0
        stress -= 2 * STRESS_ROUND_TRIP_BPS_PER_LEG / 100.0
        entry_ts = timestamps[follower_normal[1]]
        exit_ts = timestamps[follower_normal[2]] + v4.HOUR
        stress_entry_ts = timestamps[follower_stress[1]]
        stress_exit_ts = timestamps[follower_stress[2]] + v4.HOUR
        normal += funding_pct(raw[follower].get("funding", []), entry_ts, exit_ts, direction, follower_weight)
        normal += funding_pct(raw[LEADER].get("funding", []), entry_ts, exit_ts, -direction, leader_weight)
        stress += funding_pct(raw[follower].get("funding", []), stress_entry_ts, stress_exit_ts, direction, follower_weight)
        stress += funding_pct(raw[LEADER].get("funding", []), stress_entry_ts, stress_exit_ts, -direction, leader_weight)

        trade = Trade(follower, ts, entry_ts, exit_ts, direction, normal, stress)
        trades.append(trade)
        cycle_normal.append(normal)
        cycle_stress.append(stress)
        follower_values[follower].append(normal)
        year = str(datetime.fromtimestamp(ts / 1000, tz=timezone.utc).year)
        year_values.setdefault(year, []).append(normal)
        next_free_index = follower_normal[2] + 1
        rolling_shocks.append(abs(shock) / shock_scale)

    values = [trade.normal_pct for trade in trades]
    stress_values = [trade.stress_pct for trade in trades]
    low = quantile(values, 0.01) if values else 0.0
    high = quantile(values, 0.99) if values else 0.0
    winsorized = [min(high, max(low, value)) for value in values]
    without_best = sorted(values)[:-1] if len(values) > 1 else []
    return {
        "trades": len(trades),
        "winRatePct": 100.0 * sum(value > 0 for value in values) / len(values) if values else 0.0,
        "averagePct": mean(values),
        "winsorizedAveragePct": mean(winsorized),
        "compoundedReturnPct": product_return(values),
        "stressCompoundedReturnPct": product_return(stress_values),
        "profitFactor": profit_factor(values),
        "stressProfitFactor": profit_factor(stress_values),
        "profitFactorWithoutBest": profit_factor(without_best),
        "maxDrawdownPct": max_drawdown(values),
        "medianShockZ": statistics.median(rolling_shocks) if rolling_shocks else 0.0,
        "followerBreakdown": {
            symbol: {
                "trades": len(items),
                "averagePct": mean(items),
                "profitFactor": profit_factor(items),
            }
            for symbol, items in follower_values.items()
        },
        "yearBreakdown": {
            year: {
                "trades": len(items),
                "returnPct": product_return(items),
                "profitFactor": profit_factor(items),
                "maxDrawdownPct": max_drawdown(items),
            }
            for year, items in sorted(year_values.items())
        },
    }


def gate(metrics: dict, stage: str) -> bool:
    minimum_trades = {"development": 24, "validation": 18, "confirmation": 18, "final": 6}[stage]
    pf_floor = {"development": 1.15, "validation": 1.08, "confirmation": 1.05, "final": 1.00}[stage]
    dd_floor = {"development": -20.0, "validation": -20.0, "confirmation": -20.0, "final": -15.0}[stage]
    return (
        metrics["trades"] >= minimum_trades
        and metrics["averagePct"] > 0
        and metrics["winsorizedAveragePct"] > 0
        and (metrics["profitFactor"] or 0) >= pf_floor
        and (metrics["stressProfitFactor"] or 0) >= 1.0
        and (metrics["profitFactorWithoutBest"] or 0) >= 0.95
        and metrics["maxDrawdownPct"] >= dd_floor
    )


def is_neighbor(left: Variant, right: Variant) -> bool:
    dimensions = [
        (SHOCK_WINDOWS, left.shock_window, right.shock_window),
        (SHOCK_Z, left.shock_z, right.shock_z),
        (GAP_Z, left.gap_z, right.gap_z),
        (HOLD_HOURS, left.hold_hours, right.hold_hours),
        (BETA_LOOKBACKS, left.beta_lookback, right.beta_lookback),
    ]
    differences = 0
    for values, a, b in dimensions:
        if a == b:
            continue
        if abs(values.index(a) - values.index(b)) == 1:
            differences += 1
        else:
            return False
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
    tested = []
    model_map = {variant.variant_id: variant for variant in variants()}

    for variant in variants():
        development = simulate(variant, raw, timestamps, rows, returns, v4.START_2023, v4.START_2024)
        validation = simulate(variant, raw, timestamps, rows, returns, v4.START_2024, v4.START_2025)
        tested.append({
            "variant": variant.__dict__,
            "development2023": development,
            "validation2024": validation,
            "developmentPassed": gate(development, "development"),
            "validationPassed": gate(validation, "validation"),
            "neighborCount": 0,
            "neighborhoodScore": -999.0,
        })

    passed = [item for item in tested if item["developmentPassed"] and item["validationPassed"]]
    for item in passed:
        current = model_map[item["variant"]["variant_id"]]
        neighbors = [other for other in passed if is_neighbor(current, model_map[other["variant"]["variant_id"]])]
        item["neighborCount"] = len(neighbors)
        if neighbors:
            item["neighborhoodScore"] = statistics.median(
                min(other["development2023"]["stressProfitFactor"] or 0, other["validation2024"]["stressProfitFactor"] or 0)
                for other in neighbors
            )
    robust = [item for item in passed if item["neighborCount"] >= 2]
    robust.sort(key=lambda item: (
        item["neighborhoodScore"],
        min(item["development2023"]["profitFactor"] or 0, item["validation2024"]["profitFactor"] or 0),
        item["validation2024"]["winsorizedAveragePct"],
    ), reverse=True)
    selected = robust[0] if robust else None
    confirmation = None
    final = None
    confirmation_passed = False
    final_passed = False
    if selected:
        variant = model_map[selected["variant"]["variant_id"]]
        confirmation = simulate(variant, raw, timestamps, rows, returns, v4.START_2025, v4.START_2026)
        confirmation_passed = gate(confirmation, "confirmation")
        if confirmation_passed:
            final = simulate(variant, raw, timestamps, rows, returns, v4.START_2026, v4.END)
            final_passed = gate(final, "final")

    status = (
        "NO_ROBUST_LEAD_LAG_EDGE" if not selected else
        "CONFIRMATION_REJECTED" if not confirmation_passed else
        "FINAL_PERIOD_REJECTED" if not final_passed else
        "FORWARD_PAPER_CANDIDATE"
    )
    result = rounded({
        "version": 47,
        "strategyId": STRATEGY_ID,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "economicRationale": "Large BTC shocks can diffuse through fragmented crypto liquidity with delay. The strategy buys the under-reacting follower and hedges BTC, or sells the lagging follower and buys BTC, targeting convergence rather than market direction.",
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
        "fingerprint": hashlib.sha256(json.dumps({
            "strategy": STRATEGY_ID,
            "variants": [variant.__dict__ for variant in variants()],
            "periods": [v4.START_2023, v4.START_2024, v4.START_2025, v4.START_2026, v4.END],
            "costPerLeg": [NORMAL_ROUND_TRIP_BPS_PER_LEG, STRESS_ROUND_TRIP_BPS_PER_LEG],
            "stressDelayHours": STRESS_DELAY_HOURS,
        }, sort_keys=True).encode()).hexdigest(),
        "constraints": [
            "既存WIN80/V6 Entry時刻、Entry確認、損切り、利益延長、Cash時mean-reversionを使用しない。",
            "BTC急変後の相対的な反応遅延だけを対象とし、FollowerとBTCを等ドルでヘッジする。",
            "DevelopmentとValidation通過後に近接パラメータ安定性を要求し、Confirmation通過前は最終期間を参照しない。",
            "両脚Fee・Slippage・Funding、1時間遅延Stress、1%/99% Winsorize、最良取引除外PFを含む。",
            "同じ回でHoldout結果を見た条件変更を行わない。",
            "本番コード、VPS、.env、実売買runner、realTradingEnabledを変更しない。",
        ],
    })
    selected_id = selected["variant"]["variant_id"] if selected else "NONE"
    report = [
        "# BTC Lead-Lag Spread V47",
        "",
        f"- Status: **{status}**",
        f"- Evaluated variants: {len(tested)}",
        f"- Development + Validation passed: {len(passed)}",
        f"- Robust neighborhood candidates: {len(robust)}",
        f"- Selected: `{selected_id}`",
        f"- Confirmation 2025: **{'PASS' if confirmation_passed else 'FAIL / NOT RUN'}**",
        f"- Final period: **{'PASS' if final_passed else 'FAIL / NOT RUN'}**",
        f"- Paper eligible: **{'YES' if result['paperEligible'] else 'NO'}**",
        "- Live eligible: NO",
        "- Production changed: NO",
        "",
        "## Economic rationale",
        "",
        "BTC shocks can be incorporated first in the deepest market, while fragmented alt liquidity reacts later. V47 trades only the residual convergence spread and hedges BTC directionally.",
        "",
        "## Constraints",
        "",
        *[f"- {item}" for item in result["constraints"]],
    ]
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "btc-lead-lag-spread-v47.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    (state_dir / "btc-lead-lag-spread-v47.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
