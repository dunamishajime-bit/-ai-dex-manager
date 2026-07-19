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

STRATEGY_ID = "UTC_SESSION_LIQUIDITY_PREMIUM_V26"
SYMBOLS = ["BTC", "ETH", "BNB", "SOL", "LINK", "AVAX"]
SESSION_HOURS = [0, 4, 8, 12, 16, 20]
HOLD_HOURS = [1, 2, 4, 6]
VOLUME_QUANTILES = [0.0, 0.5, 0.65]
NORMAL_ROUND_TRIP_BPS = 10.0
STRESS_ROUND_TRIP_BPS = 30.0
STRESS_DELAY_HOURS = 1
MIN_DIRECTION_OBSERVATIONS = 40


@dataclass(frozen=True)
class Variant:
    variant_id: str
    session_hour: int
    hold_hours: int
    volume_quantile: float


@dataclass(frozen=True)
class FrozenModel:
    variant: Variant
    directions: Dict[str, int]
    volume_floors: Dict[str, float]


@dataclass(frozen=True)
class Trade:
    symbol: str
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


def trimmed_mean(values: List[float], trim: float = 0.05) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    cut = int(len(ordered) * trim)
    core = ordered[cut:len(ordered) - cut] if cut and len(ordered) > cut * 2 else ordered
    return statistics.fmean(core)


def funding_pct(points: List[dict], start_ts: int, end_ts: int, direction: int) -> float:
    paid = sum(float(point["rate"]) * 100.0 for point in points if start_ts <= int(point["ts"]) < end_ts)
    return -direction * paid


def build_indexes(raw: Dict[str, dict]) -> Dict[str, Dict[int, int]]:
    return {
        symbol: {int(row["ts"]): index for index, row in enumerate(raw[symbol]["candles"])}
        for symbol in SYMBOLS
    }


def candidate_signal_rows(raw: Dict[str, dict], symbol: str, session_hour: int, start: int, end: int) -> List[Tuple[int, int]]:
    rows = raw[symbol]["candles"]
    result: List[Tuple[int, int]] = []
    for index, row in enumerate(rows):
        ts = int(row["ts"])
        if not (start <= ts < end):
            continue
        if datetime.fromtimestamp(ts / 1000, tz=timezone.utc).hour == session_hour:
            result.append((ts, index))
    return result


def forward_raw_return(rows: List[dict], signal_index: int, hold_hours: int, delay_hours: int = 0) -> Optional[float]:
    entry_index = signal_index + 1 + delay_hours
    exit_index = entry_index + hold_hours - 1
    if entry_index >= len(rows) or exit_index >= len(rows):
        return None
    entry = float(rows[entry_index]["open"])
    exit_price = float(rows[exit_index]["close"])
    if entry <= 0:
        return None
    return (exit_price / entry - 1.0) * 100.0


def learn_model(variant: Variant, raw: Dict[str, dict]) -> FrozenModel:
    directions: Dict[str, int] = {}
    volume_floors: Dict[str, float] = {}
    for symbol in SYMBOLS:
        rows = raw[symbol]["candles"]
        observations: List[float] = []
        volumes: List[float] = []
        for _, index in candidate_signal_rows(raw, symbol, variant.session_hour, v4.START_2023, v4.START_2024):
            value = forward_raw_return(rows, index, variant.hold_hours)
            if value is None:
                continue
            observations.append(value)
            volumes.append(float(rows[index].get("volume", 0.0)))
        if len(observations) < MIN_DIRECTION_OBSERVATIONS:
            continue
        edge = trimmed_mean(observations)
        if abs(edge) < 0.01:
            continue
        directions[symbol] = 1 if edge > 0 else -1
        volume_floors[symbol] = quantile(volumes, variant.volume_quantile)
    return FrozenModel(variant=variant, directions=directions, volume_floors=volume_floors)


def simulate(model: FrozenModel, raw: Dict[str, dict], start: int, end: int) -> dict:
    trades: List[Trade] = []
    daily_normal: Dict[int, List[float]] = {}
    daily_stress: Dict[int, List[float]] = {}
    symbol_returns: Dict[str, List[float]] = {symbol: [] for symbol in SYMBOLS}

    for symbol, direction in model.directions.items():
        rows = raw[symbol]["candles"]
        points = raw[symbol].get("funding", [])
        floor = model.volume_floors.get(symbol, 0.0)
        for signal_ts, signal_index in candidate_signal_rows(raw, symbol, model.variant.session_hour, start, end):
            if float(rows[signal_index].get("volume", 0.0)) < floor:
                continue
            normal_raw = forward_raw_return(rows, signal_index, model.variant.hold_hours, 0)
            stress_raw = forward_raw_return(rows, signal_index, model.variant.hold_hours, STRESS_DELAY_HOURS)
            if normal_raw is None or stress_raw is None:
                continue
            entry_index = signal_index + 1
            stress_entry_index = signal_index + 1 + STRESS_DELAY_HOURS
            exit_index = entry_index + model.variant.hold_hours - 1
            stress_exit_index = stress_entry_index + model.variant.hold_hours - 1
            entry_ts = int(rows[entry_index]["ts"])
            exit_ts = int(rows[exit_index]["ts"]) + v4.HOUR
            stress_entry_ts = int(rows[stress_entry_index]["ts"])
            stress_exit_ts = int(rows[stress_exit_index]["ts"]) + v4.HOUR
            normal = direction * normal_raw - NORMAL_ROUND_TRIP_BPS / 100.0
            normal += funding_pct(points, entry_ts, exit_ts, direction)
            stress = direction * stress_raw - STRESS_ROUND_TRIP_BPS / 100.0
            stress += funding_pct(points, stress_entry_ts, stress_exit_ts, direction)
            trade = Trade(symbol, signal_ts, entry_ts, exit_ts, direction, normal, stress)
            trades.append(trade)
            day = signal_ts // v4.DAY * v4.DAY
            daily_normal.setdefault(day, []).append(normal)
            daily_stress.setdefault(day, []).append(stress)
            symbol_returns[symbol].append(normal)

    cycle_normal = [statistics.fmean(values) for _, values in sorted(daily_normal.items())]
    cycle_stress = [statistics.fmean(values) for _, values in sorted(daily_stress.items())]
    trade_values = [trade.normal_pct for trade in trades]
    stress_values = [trade.stress_pct for trade in trades]
    without_best = sorted(cycle_normal)[:-1] if len(cycle_normal) > 1 else []
    outlier_floor = quantile(trade_values, 0.01) if trade_values else 0.0
    outlier_ceiling = quantile(trade_values, 0.99) if trade_values else 0.0
    winsorized = [min(outlier_ceiling, max(outlier_floor, value)) for value in trade_values]

    return {
        "trades": len(trades),
        "cycles": len(cycle_normal),
        "winRatePct": 100.0 * sum(value > 0 for value in trade_values) / len(trade_values) if trade_values else 0.0,
        "averagePct": statistics.fmean(trade_values) if trade_values else 0.0,
        "winsorizedAveragePct": statistics.fmean(winsorized) if winsorized else 0.0,
        "compoundedReturnPct": product_return(cycle_normal),
        "stressCompoundedReturnPct": product_return(cycle_stress),
        "profitFactor": profit_factor(cycle_normal),
        "stressProfitFactor": profit_factor(cycle_stress),
        "profitFactorWithoutBest": profit_factor(without_best),
        "maxDrawdownPct": max_drawdown(cycle_normal),
        "symbolBreakdown": {
            symbol: {
                "trades": len(values),
                "averagePct": statistics.fmean(values) if values else 0.0,
                "profitFactor": profit_factor(values),
            }
            for symbol, values in symbol_returns.items()
        },
    }


def variants() -> List[Variant]:
    return [
        Variant(f"H{hour:02d}_HOLD{hold}_VQ{int(volume_q * 100):02d}", hour, hold, volume_q)
        for hour in SESSION_HOURS
        for hold in HOLD_HOURS
        for volume_q in VOLUME_QUANTILES
    ]


def gate(metrics: dict, stage: str) -> bool:
    minimum_cycles = {"development": 120, "validation": 120, "confirmation": 120, "final": 45}[stage]
    pf_floor = {"development": 1.08, "validation": 1.05, "confirmation": 1.05, "final": 1.00}[stage]
    stress_floor = {"development": 1.00, "validation": 1.00, "confirmation": 1.00, "final": 1.00}[stage]
    dd_floor = {"development": -25.0, "validation": -25.0, "confirmation": -25.0, "final": -20.0}[stage]
    return (
        metrics["cycles"] >= minimum_cycles
        and metrics["averagePct"] > 0
        and metrics["winsorizedAveragePct"] > 0
        and (metrics["profitFactor"] or 0) >= pf_floor
        and (metrics["stressProfitFactor"] or 0) >= stress_floor
        and (metrics["profitFactorWithoutBest"] or 0) >= 0.95
        and metrics["maxDrawdownPct"] >= dd_floor
    )


def is_neighbor(left: Variant, right: Variant) -> bool:
    hour_distance = min((left.session_hour - right.session_hour) % 24, (right.session_hour - left.session_hour) % 24)
    hold_index = {value: index for index, value in enumerate(HOLD_HOURS)}
    volume_index = {value: index for index, value in enumerate(VOLUME_QUANTILES)}
    differences = 0
    if hour_distance == 4:
        differences += 1
    elif hour_distance != 0:
        return False
    if abs(hold_index[left.hold_hours] - hold_index[right.hold_hours]) == 1:
        differences += 1
    elif left.hold_hours != right.hold_hours:
        return False
    if abs(volume_index[left.volume_quantile] - volume_index[right.volume_quantile]) == 1:
        differences += 1
    elif left.volume_quantile != right.volume_quantile:
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
    raw = {symbol: v4.load_symbol(cache_root, symbol) for symbol in SYMBOLS}
    models: Dict[str, FrozenModel] = {}
    discovery: List[dict] = []

    for variant in variants():
        model = learn_model(variant, raw)
        models[variant.variant_id] = model
        development = simulate(model, raw, v4.START_2023, v4.START_2024)
        validation = simulate(model, raw, v4.START_2024, v4.START_2025)
        discovery.append({
            "variant": variant.__dict__,
            "directions": model.directions,
            "development2023": development,
            "validation2024": validation,
            "developmentPassed": gate(development, "development"),
            "validationPassed": gate(validation, "validation"),
            "neighborCount": 0,
            "neighborhoodScore": -999.0,
        })

    passed = [item for item in discovery if item["developmentPassed"] and item["validationPassed"]]
    variant_map = {variant.variant_id: variant for variant in variants()}
    for item in passed:
        current = variant_map[item["variant"]["variant_id"]]
        neighbors = [
            other for other in passed
            if is_neighbor(current, variant_map[other["variant"]["variant_id"]])
        ]
        item["neighborCount"] = len(neighbors)
        if neighbors:
            item["neighborhoodScore"] = statistics.median(
                min(
                    other["development2023"]["stressCompoundedReturnPct"],
                    other["validation2024"]["stressCompoundedReturnPct"],
                )
                for other in neighbors
            )

    robust = [item for item in passed if item["neighborCount"] >= 2]
    robust.sort(key=lambda item: (
        item["neighborhoodScore"],
        min(item["development2023"]["stressProfitFactor"] or 0, item["validation2024"]["stressProfitFactor"] or 0),
        item["validation2024"]["winsorizedAveragePct"],
    ), reverse=True)
    selected = robust[0] if robust else None
    confirmation = None
    final = None
    confirmation_passed = False
    final_passed = False

    if selected:
        model = models[selected["variant"]["variant_id"]]
        confirmation = simulate(model, raw, v4.START_2025, v4.START_2026)
        confirmation_passed = gate(confirmation, "confirmation")
        if confirmation_passed:
            final = simulate(model, raw, v4.START_2026, v4.END)
            final_passed = gate(final, "final")

    status = (
        "NO_ROBUST_SESSION_EDGE" if not selected else
        "CONFIRMATION_REJECTED" if not confirmation_passed else
        "FINAL_PERIOD_REJECTED" if not final_passed else
        "FORWARD_PAPER_CANDIDATE"
    )
    result = rounded({
        "version": 26,
        "strategyId": STRATEGY_ID,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "economicRationale": "Regional liquidity hand-offs can create recurring inventory transfer and hedging pressure at fixed UTC session boundaries; direction and volume floor are learned only in Development and then frozen.",
        "status": status,
        "evaluatedVariants": len(discovery),
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
            "normalCostBps": NORMAL_ROUND_TRIP_BPS,
            "stressCostBps": STRESS_ROUND_TRIP_BPS,
            "stressDelayHours": STRESS_DELAY_HOURS,
        }, sort_keys=True).encode()).hexdigest(),
        "constraints": [
            "既存WIN80/V6 Entry時刻、OHLCV Entry確認、損切り、利益延長、Cash時mean-reversionを使用しない。",
            "Developmentで銘柄別方向と出来高floorを固定し、Validation以降は再調整しない。",
            "Confirmation通過前は最終期間を評価しない。",
            "Fee、Slippage、Funding、1時間遅延Stressを含む。",
            "1%/99% winsorized平均、最良cycle除外PF、近接パラメータ安定性を必須とする。",
            "本番コード、VPS、.env、実売買runner、realTradingEnabledを変更しない。",
        ],
    })

    selected_id = selected["variant"]["variant_id"] if selected else "NONE"
    report = [
        "# UTC Session Liquidity Premium V26",
        "",
        f"- Status: **{status}**",
        f"- Evaluated variants: {len(discovery)}",
        f"- Development + Validation passed: {len(passed)}",
        f"- Robust neighborhood candidates: {len(robust)}",
        f"- Selected: `{selected_id}`",
        f"- Confirmation 2025: **{'PASS' if confirmation_passed else 'FAIL / NOT RUN'}**",
        f"- Final 2026 H1: **{'PASS' if final_passed else 'FAIL / NOT RUN'}**",
        f"- Paper eligible: **{'YES' if result['paperEligible'] else 'NO'}**",
        "- Live eligible: NO",
        "- Production changed: NO",
        "",
        "## Economic rationale",
        "",
        "Regional liquidity hand-offs can create recurring inventory transfer and hedging pressure at fixed UTC session boundaries. Direction and volume floor are learned in 2023 Development only and frozen thereafter.",
        "",
        "## Constraints",
        "",
        *[f"- {item}" for item in result["constraints"]],
    ]
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "utc-session-liquidity-premium-v26.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    (state_dir / "utc-session-liquidity-premium-v26.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
