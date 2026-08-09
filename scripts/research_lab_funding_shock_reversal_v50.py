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

STRATEGY_ID = "FUNDING_SHOCK_REVERSAL_V50"
SYMBOLS = ["BTC", "ETH", "BNB", "SOL", "LINK", "AVAX"]
TRADE_SYMBOLS = ["ETH", "BNB", "SOL", "LINK", "AVAX"]
FUNDING_LOOKBACKS = [60, 90, 120]
FUNDING_Z = [1.5, 2.0, 2.5]
PRICE_WINDOWS = [8, 24, 48]
PRICE_Z = [0.5, 1.0]
HOLD_HOURS = [8, 16, 24, 48]
COOLDOWN_HOURS = [8, 24]
NORMAL_ROUND_TRIP_BPS = 10.0
STRESS_ROUND_TRIP_BPS = 30.0
STRESS_DELAY_HOURS = 1


@dataclass(frozen=True)
class Variant:
    variant_id: str
    funding_lookback: int
    funding_z: float
    price_window: int
    price_z: float
    hold_hours: int
    cooldown_hours: int


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
    pos = (len(ordered) - 1) * q
    lo = math.floor(pos)
    hi = math.ceil(pos)
    if lo == hi:
        return ordered[lo]
    return ordered[lo] * (hi - pos) + ordered[hi] * (pos - lo)


def clean(raw: Dict[str, dict]) -> Dict[str, dict]:
    out: Dict[str, dict] = {}
    for symbol in SYMBOLS:
        candles = sorted(raw[symbol]["candles"], key=lambda row: int(row["ts"]))
        funding = sorted(raw[symbol].get("funding", []), key=lambda row: int(row["ts"]))
        candle_seen = set()
        funding_seen = set()
        candles = [row for row in candles if not (int(row["ts"]) in candle_seen or candle_seen.add(int(row["ts"])))]
        funding = [row for row in funding if not (int(row["ts"]) in funding_seen or funding_seen.add(int(row["ts"])))]
        out[symbol] = {"candles": candles, "funding": funding}
    return out


def variants() -> List[Variant]:
    return [
        Variant(
            f"FL{lookback}_FZ{str(fz).replace('.', 'p')}_PW{window}_PZ{str(pz).replace('.', 'p')}_H{hold}_C{cooldown}",
            lookback, fz, window, pz, hold, cooldown,
        )
        for lookback in FUNDING_LOOKBACKS
        for fz in FUNDING_Z
        for window in PRICE_WINDOWS
        for pz in PRICE_Z
        for hold in HOLD_HOURS
        for cooldown in COOLDOWN_HOURS
    ]


def candle_maps(raw: Dict[str, dict]) -> Tuple[Dict[str, Dict[int, int]], Dict[str, List[dict]]]:
    rows = {symbol: raw[symbol]["candles"] for symbol in SYMBOLS}
    indexes = {symbol: {int(row["ts"]): i for i, row in enumerate(rows[symbol])} for symbol in SYMBOLS}
    return indexes, rows


def log_returns(rows: List[dict]) -> List[float]:
    out = [0.0]
    for i in range(1, len(rows)):
        a = float(rows[i - 1]["close"])
        b = float(rows[i]["close"])
        out.append(math.log(b / a) if a > 0 and b > 0 else 0.0)
    return out


def trailing_price_z(returns: List[float], index: int, window: int) -> Optional[float]:
    if index - max(window * 4, 96) < 1 or index - window + 1 < 1:
        return None
    current = sum(returns[index - window + 1:index + 1])
    hist = []
    start = index - max(window * 4, 96)
    for end in range(start + window - 1, index - window + 1, max(1, window // 4)):
        hist.append(sum(returns[end - window + 1:end + 1]))
    scale = std(hist)
    if len(hist) < 8 or scale <= 1e-12:
        return None
    return (current - mean(hist)) / scale


def event_cache(raw: Dict[str, dict], indexes: Dict[str, Dict[int, int]], rows: Dict[str, List[dict]]) -> Dict[Tuple[int, int], List[dict]]:
    returns = {symbol: log_returns(rows[symbol]) for symbol in TRADE_SYMBOLS}
    cache: Dict[Tuple[int, int], List[dict]] = {}
    for lookback in FUNDING_LOOKBACKS:
        for window in PRICE_WINDOWS:
            events: List[dict] = []
            for symbol in TRADE_SYMBOLS:
                points = raw[symbol]["funding"]
                rates = [float(p["rate"]) for p in points]
                for j in range(lookback, len(points)):
                    ts = int(points[j]["ts"])
                    idx = indexes[symbol].get(ts)
                    if idx is None:
                        continue
                    hist = rates[j - lookback:j]
                    scale = std(hist)
                    if scale <= 1e-12:
                        continue
                    funding_z = (rates[j] - mean(hist)) / scale
                    price_z = trailing_price_z(returns[symbol], idx, window)
                    if price_z is None:
                        continue
                    # Crowding confirmation: positive funding with upside extension -> contrarian short;
                    # negative funding with downside extension -> contrarian long.
                    if funding_z > 0 and price_z > 0:
                        direction = -1
                    elif funding_z < 0 and price_z < 0:
                        direction = 1
                    else:
                        continue
                    events.append({"ts": ts, "symbol": symbol, "index": idx, "fundingZ": funding_z, "priceZ": price_z, "direction": direction})
            cache[(lookback, window)] = sorted(events, key=lambda item: (item["ts"], item["symbol"]))
    return cache


def funding_pnl(points: List[dict], start_ts: int, end_ts: int, direction: int) -> float:
    paid = sum(float(point["rate"]) * 100.0 for point in points if start_ts <= int(point["ts"]) < end_ts)
    return -direction * paid


def trade_return(raw: Dict[str, dict], rows: Dict[str, List[dict]], event: dict, hold: int, delay: int, cost_bps: float) -> Optional[Tuple[float, int]]:
    symbol = event["symbol"]
    direction = int(event["direction"])
    entry_idx = int(event["index"]) + 1 + delay
    exit_idx = entry_idx + hold - 1
    series = rows[symbol]
    if entry_idx >= len(series) or exit_idx >= len(series):
        return None
    entry = float(series[entry_idx]["open"])
    exit_price = float(series[exit_idx]["close"])
    if entry <= 0:
        return None
    pnl = direction * (exit_price / entry - 1.0) * 100.0 - cost_bps / 100.0
    start_ts = int(series[entry_idx]["ts"])
    end_ts = int(series[exit_idx]["ts"]) + v4.HOUR
    pnl += funding_pnl(raw[symbol]["funding"], start_ts, end_ts, direction)
    return pnl, end_ts


def simulate(variant: Variant, raw: Dict[str, dict], rows: Dict[str, List[dict]], events: Dict[Tuple[int, int], List[dict]], start: int, end: int) -> dict:
    normal_values: List[float] = []
    stress_values: List[float] = []
    year_values: Dict[str, List[float]] = {}
    symbol_values: Dict[str, List[float]] = {symbol: [] for symbol in TRADE_SYMBOLS}
    next_free_ts = start
    selected_z: List[float] = []

    for event in events[(variant.funding_lookback, variant.price_window)]:
        ts = int(event["ts"])
        if ts < start or ts >= end or ts < next_free_ts:
            continue
        if abs(float(event["fundingZ"])) < variant.funding_z or abs(float(event["priceZ"])) < variant.price_z:
            continue
        normal = trade_return(raw, rows, event, variant.hold_hours, 0, NORMAL_ROUND_TRIP_BPS)
        stress = trade_return(raw, rows, event, variant.hold_hours, STRESS_DELAY_HOURS, STRESS_ROUND_TRIP_BPS)
        if normal is None or stress is None:
            continue
        normal_values.append(normal[0])
        stress_values.append(stress[0])
        symbol_values[event["symbol"]].append(normal[0])
        year = str(datetime.fromtimestamp(ts / 1000, tz=timezone.utc).year)
        year_values.setdefault(year, []).append(normal[0])
        selected_z.append(abs(float(event["fundingZ"])))
        next_free_ts = max(normal[1], stress[1]) + variant.cooldown_hours * v4.HOUR

    low = quantile(normal_values, 0.01) if normal_values else 0.0
    high = quantile(normal_values, 0.99) if normal_values else 0.0
    winsorized = [min(high, max(low, value)) for value in normal_values]
    without_best = sorted(normal_values)[:-1] if len(normal_values) > 1 else []
    return {
        "trades": len(normal_values),
        "winRatePct": 100.0 * sum(v > 0 for v in normal_values) / len(normal_values) if normal_values else 0.0,
        "averagePct": mean(normal_values),
        "winsorizedAveragePct": mean(winsorized),
        "compoundedReturnPct": product_return(normal_values),
        "stressCompoundedReturnPct": product_return(stress_values),
        "profitFactor": profit_factor(normal_values),
        "stressProfitFactor": profit_factor(stress_values),
        "profitFactorWithoutBest": profit_factor(without_best),
        "maxDrawdownPct": max_drawdown(normal_values),
        "medianAbsFundingZ": statistics.median(selected_z) if selected_z else 0.0,
        "symbolBreakdown": {s: {"trades": len(v), "returnPct": product_return(v), "profitFactor": profit_factor(v)} for s, v in symbol_values.items()},
        "yearBreakdown": {y: {"trades": len(v), "returnPct": product_return(v), "profitFactor": profit_factor(v), "maxDrawdownPct": max_drawdown(v)} for y, v in sorted(year_values.items())},
    }


def gate(metrics: dict, stage: str) -> bool:
    minimum = {"development": 18, "validation": 12, "confirmation": 12, "final": 5}[stage]
    pf_floor = {"development": 1.15, "validation": 1.08, "confirmation": 1.05, "final": 1.00}[stage]
    dd_floor = {"development": -25.0, "validation": -22.0, "confirmation": -22.0, "final": -18.0}[stage]
    return (
        metrics["trades"] >= minimum
        and metrics["averagePct"] > 0
        and metrics["winsorizedAveragePct"] > 0
        and (metrics["profitFactor"] or 0) >= pf_floor
        and (metrics["stressProfitFactor"] or 0) >= 1.0
        and (metrics["profitFactorWithoutBest"] or 0) >= 0.95
        and metrics["maxDrawdownPct"] >= dd_floor
    )


def is_neighbor(a: Variant, b: Variant) -> bool:
    dims = [
        (FUNDING_LOOKBACKS, a.funding_lookback, b.funding_lookback),
        (FUNDING_Z, a.funding_z, b.funding_z),
        (PRICE_WINDOWS, a.price_window, b.price_window),
        (PRICE_Z, a.price_z, b.price_z),
        (HOLD_HOURS, a.hold_hours, b.hold_hours),
        (COOLDOWN_HOURS, a.cooldown_hours, b.cooldown_hours),
    ]
    differences = 0
    for values, left, right in dims:
        if left == right:
            continue
        if abs(values.index(left) - values.index(right)) != 1:
            return False
        differences += 1
    return differences == 1


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
    raw = clean({symbol: v4.load_symbol(cache_root, symbol) for symbol in SYMBOLS})
    indexes, rows = candle_maps(raw)
    events = event_cache(raw, indexes, rows)
    model_map = {v.variant_id: v for v in variants()}
    tested = []

    for variant in variants():
        dev = simulate(variant, raw, rows, events, v4.START_2023, v4.START_2024)
        val = simulate(variant, raw, rows, events, v4.START_2024, v4.START_2025)
        tested.append({"variant": variant.__dict__, "development2023": dev, "validation2024": val, "developmentPassed": gate(dev, "development"), "validationPassed": gate(val, "validation"), "neighborCount": 0, "neighborhoodScore": -999.0})

    passed = [x for x in tested if x["developmentPassed"] and x["validationPassed"]]
    for item in passed:
        current = model_map[item["variant"]["variant_id"]]
        neighbors = [other for other in passed if is_neighbor(current, model_map[other["variant"]["variant_id"]])]
        item["neighborCount"] = len(neighbors)
        if neighbors:
            item["neighborhoodScore"] = statistics.median(min(other["development2023"]["stressProfitFactor"] or 0, other["validation2024"]["stressProfitFactor"] or 0) for other in neighbors)

    robust = [x for x in passed if x["neighborCount"] >= 2]
    robust.sort(key=lambda x: (x["neighborhoodScore"], min(x["development2023"]["profitFactor"] or 0, x["validation2024"]["profitFactor"] or 0), x["validation2024"]["winsorizedAveragePct"]), reverse=True)
    selected = robust[0] if robust else None
    confirmation = final = None
    confirmation_passed = final_passed = False

    if selected:
        variant = model_map[selected["variant"]["variant_id"]]
        confirmation = simulate(variant, raw, rows, events, v4.START_2025, v4.START_2026)
        confirmation_passed = gate(confirmation, "confirmation")
        if confirmation_passed:
            final = simulate(variant, raw, rows, events, v4.START_2026, v4.END)
            final_passed = gate(final, "final")

    status = "NO_ROBUST_FUNDING_SHOCK_EDGE" if not selected else "CONFIRMATION_REJECTED" if not confirmation_passed else "FINAL_PERIOD_REJECTED" if not final_passed else "FORWARD_PAPER_CANDIDATE"
    constraints = [
        "既存WIN80/V6のEntry確認・損切り・利益延長・Cash時mean-reversionを使用しない。",
        "Funding Carry V11とは異なり、極端なFundingと同方向の価格伸長が同時発生したイベント後の混雑解消だけを逆張りする。",
        "Development→Validationで候補固定後、近接パラメータ安定性を要求し、Confirmation通過前は最終期間を見ない。",
        "Fee・Slippage・Funding、1時間Entry遅延Stress、1/99% Winsorize、最良取引除外PFを含む。",
        "Holdout結果を見て同じ回の条件を変更しない。",
        "本番コード、VPS、.env、実売買runner、realTradingEnabledを変更しない。",
    ]
    result = rounded({
        "version": 50,
        "strategyId": STRATEGY_ID,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "economicRationale": "Extreme perpetual funding combined with same-direction price extension is a proxy for crowded leveraged positioning. When financing becomes unusually expensive after an extended move, forced deleveraging and profit-taking can create short-horizon reversal. V50 trades only those discrete crowding-shock events rather than harvesting funding carry continuously.",
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
        "fingerprint": hashlib.sha256(json.dumps({"strategy": STRATEGY_ID, "variants": [v.__dict__ for v in variants()], "periods": [v4.START_2023, v4.START_2024, v4.START_2025, v4.START_2026, v4.END], "costs": [NORMAL_ROUND_TRIP_BPS, STRESS_ROUND_TRIP_BPS], "delay": STRESS_DELAY_HOURS}, sort_keys=True).encode()).hexdigest(),
    })

    selected_id = selected["variant"]["variant_id"] if selected else "NONE"
    report = [
        "# Funding Shock Reversal V50", "",
        f"- Status: **{status}**",
        f"- Evaluated variants: {len(tested)}",
        f"- Development + Validation passed: {len(passed)}",
        f"- Robust neighborhood candidates: {len(robust)}",
        f"- Selected: `{selected_id}`",
        f"- Confirmation 2025: **{'PASS' if confirmation_passed else 'FAIL / NOT RUN'}**",
        f"- Final period: **{'PASS' if final_passed else 'FAIL / NOT RUN'}**",
        f"- Paper eligible: **{'YES' if result['paperEligible'] else 'NO'}**",
        "- Live eligible: NO",
        "- Production changed: NO", "",
        "## Economic rationale", "",
        "Extreme funding plus same-direction price extension can identify crowded leveraged positioning. V50 takes a discrete contrarian trade after the funding shock; it is not a continuous funding-carry strategy.", "",
        "## Constraints", "", *[f"- {item}" for item in constraints],
    ]
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "funding-shock-reversal-v50.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    (state_dir / "funding-shock-reversal-v50.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
