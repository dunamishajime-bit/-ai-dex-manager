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
import research_lab_cross_sectional_dispersion_reversal_v48 as v48

STRATEGY_ID = "VOLATILITY_BREAKOUT_BREADTH_V49"
SYMBOLS = ["BTC", "ETH", "BNB", "SOL", "LINK", "AVAX"]
TRADE_SYMBOLS = ["ETH", "BNB", "SOL", "LINK", "AVAX"]
BREAKOUT_HOURS = [24, 48, 72]
VOL_HOURS = [72, 168]
TARGET_VOL_ANNUAL = [35.0, 50.0]
BREADTH_MIN = [3, 4]
HOLD_HOURS = [12, 24]
REBALANCE_HOURS = [6, 12]
MAX_GROSS = 0.75
NORMAL_COST_BPS = 10.0
STRESS_COST_BPS = 30.0
STRESS_DELAY_HOURS = 1


@dataclass(frozen=True)
class Variant:
    variant_id: str
    breakout_hours: int
    vol_hours: int
    target_vol_annual: float
    breadth_min: int
    hold_hours: int
    rebalance_hours: int


def product_return(values: Iterable[float]) -> float:
    equity = 1.0
    for value in values:
        equity *= max(0.001, 1.0 + value / 100.0)
    return (equity - 1.0) * 100.0


def profit_factor(values: List[float]) -> Optional[float]:
    wins = sum(x for x in values if x > 0)
    losses = abs(sum(x for x in values if x < 0))
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


def variants() -> List[Variant]:
    result = []
    for b in BREAKOUT_HOURS:
        for v in VOL_HOURS:
            for tv in TARGET_VOL_ANNUAL:
                for breadth in BREADTH_MIN:
                    for hold in HOLD_HOURS:
                        for reb in REBALANCE_HOURS:
                            if reb <= hold:
                                result.append(Variant(f"B{b}_V{v}_T{int(tv)}_BR{breadth}_H{hold}_R{reb}", b, v, tv, breadth, hold, reb))
    return result


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


def funding_pct(points: List[dict], start_ts: int, end_ts: int, weight: float) -> float:
    paid = sum(float(point["rate"]) * 100.0 for point in points if start_ts <= int(point["ts"]) < end_ts)
    return -weight * paid


def realized_vol(logrets: List[float], index: int, hours: int) -> float:
    start = index - hours + 1
    if start < 1:
        return 0.0
    sample = logrets[start:index + 1]
    if len(sample) < max(24, hours // 2):
        return 0.0
    return statistics.pstdev(sample) * math.sqrt(24 * 365) * 100.0


def prior_high(rows: List[dict], index: int, hours: int) -> float:
    start = index - hours
    if start < 0:
        return float("inf")
    return max(float(row["high"]) for row in rows[start:index])


def build_features(rows: Dict[str, List[dict]]) -> Dict[str, Dict[str, List[float]]]:
    features: Dict[str, Dict[str, List[float]]] = {}
    for symbol in SYMBOLS:
        closes = [float(row["close"]) for row in rows[symbol]]
        lr = [0.0]
        for i in range(1, len(closes)):
            lr.append(math.log(closes[i] / closes[i - 1]) if closes[i - 1] > 0 and closes[i] > 0 else 0.0)
        features[symbol] = {"logret": lr}
    return features


def simulate(variant: Variant, raw: Dict[str, dict], timestamps: List[int], rows: Dict[str, List[dict]], features: Dict[str, Dict[str, List[float]]], start: int, end: int) -> dict:
    normal_values: List[float] = []
    stress_values: List[float] = []
    exposures: List[float] = []
    names: List[str] = []
    next_free = 0
    warmup = max(variant.breakout_hours, variant.vol_hours)

    for index, ts in enumerate(timestamps):
        if ts < start or ts >= end or index < warmup or index < next_free or index % variant.rebalance_hours != 0:
            continue

        breadth = 0
        candidates: List[Tuple[float, str, float]] = []
        for symbol in SYMBOLS:
            close = float(rows[symbol][index]["close"])
            high = prior_high(rows[symbol], index, variant.breakout_hours)
            if close > high:
                breadth += 1
            if symbol not in TRADE_SYMBOLS or close <= high:
                continue
            vol = realized_vol(features[symbol]["logret"], index, variant.vol_hours)
            if vol <= 1e-9:
                continue
            breakout_strength = (close / high - 1.0) / max(vol / 100.0 / math.sqrt(24 * 365), 1e-9)
            candidates.append((breakout_strength, symbol, vol))

        if breadth < variant.breadth_min or not candidates:
            continue

        _, symbol, vol = max(candidates, key=lambda item: item[0])
        gross = min(MAX_GROSS, variant.target_vol_annual / vol)
        if gross < 0.10:
            continue

        normal = forward_return(rows[symbol], index, variant.hold_hours, 0)
        stress = forward_return(rows[symbol], index, variant.hold_hours, STRESS_DELAY_HOURS)
        if normal is None or stress is None:
            continue

        nret = gross * normal[0] - gross * 2 * NORMAL_COST_BPS / 100.0
        sret = gross * stress[0] - gross * 2 * STRESS_COST_BPS / 100.0
        n_entry = timestamps[normal[1]]
        n_exit = timestamps[normal[2]] + v4.HOUR
        s_entry = timestamps[stress[1]]
        s_exit = timestamps[stress[2]] + v4.HOUR
        nret += funding_pct(raw[symbol].get("funding", []), n_entry, n_exit, gross)
        sret += funding_pct(raw[symbol].get("funding", []), s_entry, s_exit, gross)

        normal_values.append(nret)
        stress_values.append(sret)
        exposures.append(gross)
        names.append(symbol)
        next_free = normal[2] + 1

    without_best = sorted(normal_values)[:-1] if len(normal_values) > 1 else []
    top_share = 0.0
    positive_total = sum(x for x in normal_values if x > 0)
    if positive_total > 0 and normal_values:
        top_share = max(normal_values) / positive_total * 100.0
    return {
        "trades": len(normal_values),
        "winRatePct": 100.0 * sum(x > 0 for x in normal_values) / len(normal_values) if normal_values else 0.0,
        "averagePct": statistics.fmean(normal_values) if normal_values else 0.0,
        "compoundedReturnPct": product_return(normal_values),
        "stressCompoundedReturnPct": product_return(stress_values),
        "profitFactor": profit_factor(normal_values),
        "stressProfitFactor": profit_factor(stress_values),
        "profitFactorWithoutBest": profit_factor(without_best),
        "maxDrawdownPct": max_drawdown(normal_values),
        "bestTradeProfitSharePct": top_share,
        "medianGross": statistics.median(exposures) if exposures else 0.0,
        "symbols": {s: names.count(s) for s in TRADE_SYMBOLS},
    }


def gate(metrics: dict, stage: str) -> bool:
    min_trades = {"development": 20, "validation": 14, "confirmation": 14, "final": 6}[stage]
    pf_floor = {"development": 1.15, "validation": 1.10, "confirmation": 1.05, "final": 1.00}[stage]
    dd_floor = {"development": -20.0, "validation": -20.0, "confirmation": -20.0, "final": -20.0}[stage]
    return (
        metrics["trades"] >= min_trades
        and metrics["compoundedReturnPct"] > 0
        and (metrics["profitFactor"] or 0) >= pf_floor
        and (metrics["stressProfitFactor"] or 0) > 1.0
        and (metrics["profitFactorWithoutBest"] or 0) >= 0.95
        and metrics["bestTradeProfitSharePct"] <= 45.0
        and metrics["maxDrawdownPct"] > dd_floor
    )


def neighbor(a: Variant, b: Variant) -> bool:
    dims = 0
    for choices, x, y in [
        (BREAKOUT_HOURS, a.breakout_hours, b.breakout_hours),
        (VOL_HOURS, a.vol_hours, b.vol_hours),
        (TARGET_VOL_ANNUAL, a.target_vol_annual, b.target_vol_annual),
        (BREADTH_MIN, a.breadth_min, b.breadth_min),
        (HOLD_HOURS, a.hold_hours, b.hold_hours),
        (REBALANCE_HOURS, a.rebalance_hours, b.rebalance_hours),
    ]:
        if x == y:
            continue
        ix, iy = choices.index(x), choices.index(y)
        if abs(ix - iy) != 1:
            return False
        dims += 1
    return dims == 1


def rounded(value):
    if isinstance(value, float):
        return round(value, 4)
    if isinstance(value, dict):
        return {k: rounded(v) for k, v in value.items()}
    if isinstance(value, list):
        return [rounded(v) for v in value]
    return value


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    cache_root = Path.cwd() / ".cache" / "perp-research-usdm"
    raw = v48.clean({symbol: v4.load_symbol(cache_root, symbol) for symbol in SYMBOLS})
    timestamps, rows = v48.aligned(raw)
    features = build_features(rows)

    evaluated = []
    passed = []
    for variant in variants():
        development = simulate(variant, raw, timestamps, rows, features, v4.START_2023, v4.START_2024)
        if not gate(development, "development"):
            evaluated.append({"variant": variant.__dict__, "development": development, "validation": None})
            continue
        validation = simulate(variant, raw, timestamps, rows, features, v4.START_2024, v4.START_2025)
        item = {"variant": variant.__dict__, "development": development, "validation": validation}
        evaluated.append(item)
        if gate(validation, "validation"):
            passed.append((variant, item))

    robust = []
    for variant, item in passed:
        neighbor_passes = sum(1 for other, _ in passed if neighbor(variant, other))
        if neighbor_passes >= 1:
            score = min(item["development"]["profitFactor"] or 0, item["validation"]["profitFactor"] or 0)
            robust.append((score, neighbor_passes, variant, item))
    robust.sort(key=lambda x: (x[0], x[1]), reverse=True)

    selected = None
    confirmation = None
    final = None
    confirmation_passed = False
    final_passed = False
    if robust:
        _, neighbor_passes, variant, item = robust[0]
        selected = {"variant": variant.__dict__, "development": item["development"], "validation": item["validation"], "neighborPasses": neighbor_passes}
        confirmation = simulate(variant, raw, timestamps, rows, features, v4.START_2025, v4.START_2026)
        confirmation_passed = gate(confirmation, "confirmation")
        if confirmation_passed:
            final = simulate(variant, raw, timestamps, rows, features, v4.START_2026, v4.END)
            final_passed = gate(final, "final") and (final["profitFactor"] or 0) > 1.0 and final["compoundedReturnPct"] > 0

    robust_pass = bool(selected and confirmation_passed and final_passed and (selected["development"]["profitFactor"] or 0) >= 1.2 and (selected["validation"]["profitFactor"] or 0) >= 1.2)
    status = "ROBUST_NEXT_GEN_CANDIDATE" if robust_pass else "NO_ROBUST_VOLATILITY_BREAKOUT_EDGE"
    result = rounded({
        "version": 49,
        "strategyId": STRATEGY_ID,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "status": status,
        "evaluatedVariants": len(evaluated),
        "developmentValidationPassed": len(passed),
        "robustNeighborhoodCandidates": len(robust),
        "selected": selected,
        "confirmation2025": confirmation,
        "confirmationPassed": confirmation_passed,
        "final2026H1": final,
        "finalPassed": final_passed,
        "robustPassed": robust_pass,
        "paperEligible": robust_pass,
        "liveEligible": False,
        "productionChanged": False,
        "realTradingEnabled": False,
        "fingerprint": hashlib.sha256(json.dumps([v.__dict__ for v in variants()], sort_keys=True).encode()).hexdigest(),
        "constraints": [
            "V6/Fresh Forward V9条件と13 cyclesを最適化に使用しない。",
            "2023 Development -> 2024 Validation -> frozen 2025 Confirmation -> untouched 2026H1 Finalの順でのみ参照する。",
            "Normal/Stressコスト、Funding、1時間遅延Stress、最良取引除外PF、利益集中率を含む。",
            "本番コード、VPS、.env、実売買runner、realTradingEnabledを変更しない。",
        ],
    })
    report = [
        "# Volatility Breakout Breadth V49",
        "",
        f"- Status: **{status}**",
        f"- Evaluated variants: {len(evaluated)}",
        f"- Development + Validation passed: {len(passed)}",
        f"- Robust neighborhood candidates: {len(robust)}",
        f"- Selected: `{selected['variant']['variant_id'] if selected else 'NONE'}`",
        f"- Confirmation 2025: **{'PASS' if confirmation_passed else 'FAIL / NOT RUN'}**",
        f"- Final 2026H1: **{'PASS' if final_passed else 'FAIL / NOT RUN'}**",
        f"- Paper eligible: **{'YES' if robust_pass else 'NO'}**",
        "- Live eligible: NO",
        "- Production changed: NO",
    ]
    if selected:
        report += ["", "## Selected pre-holdout metrics", "", f"- Development PF: {result['selected']['development']['profitFactor']}", f"- Validation PF: {result['selected']['validation']['profitFactor']}", f"- Validation DD: {result['selected']['validation']['maxDrawdownPct']}%"]
    if confirmation:
        report += ["", "## Confirmation 2025", "", f"- Trades: {result['confirmation2025']['trades']}", f"- PF: {result['confirmation2025']['profitFactor']}", f"- Stress PF: {result['confirmation2025']['stressProfitFactor']}", f"- Return: {result['confirmation2025']['compoundedReturnPct']}%", f"- DD: {result['confirmation2025']['maxDrawdownPct']}%"]
    if final:
        report += ["", "## Untouched Final 2026H1", "", f"- Trades: {result['final2026H1']['trades']}", f"- PF: {result['final2026H1']['profitFactor']}", f"- Stress PF: {result['final2026H1']['stressProfitFactor']}", f"- Return: {result['final2026H1']['compoundedReturnPct']}%", f"- DD: {result['final2026H1']['maxDrawdownPct']}%"]
    report += ["", "## Constraints", ""] + [f"- {x}" for x in result["constraints"]]
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "volatility-breakout-breadth-v49.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    (state_dir / "volatility-breakout-breadth-v49.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
