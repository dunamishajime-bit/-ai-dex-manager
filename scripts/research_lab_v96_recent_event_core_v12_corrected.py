from __future__ import annotations

import argparse
import datetime as dt
import itertools
import json
import math
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import research_lab_v96_recent_event_core_v6 as v6

UTC = dt.timezone.utc
START_MS, END_MS = v6.START_MS, v6.END_MS
F1_MS, F2_MS, F3_MS = v6.F1_MS, v6.F2_MS, v6.F3_MS
BAR_HOURS, BAR_MS, DAY_MS = v6.BAR_HOURS, v6.BAR_MS, v6.DAY_MS
BASE_GROSS = 0.75
MAX_GROSS = 1.25
BENCHMARK_RETURN = 101.998210
A_CFG = v6.Config("A4H_EXACT", "SHORT_PULLBACK", 10, 5.0, 8, 1.0, 0.0, 84)


@dataclass(frozen=True)
class SizeConfig:
    config_id: str
    lookback_days: int
    weak_threshold_pct: float
    weak_gross: float
    strong_threshold_pct: float
    strong_gross: float
    dd_threshold_pct: float
    dd_gross: float
    loss_streak: int
    loss_streak_gross: float


@dataclass
class Position:
    symbol: str
    side: int
    entry_ts: int
    bars_held: int
    max_bars: int
    allocated_gross: float


def finite(value: Any, fallback: float = 0.0) -> float:
    try:
        x = float(value)
    except (TypeError, ValueError):
        return fallback
    return x if math.isfinite(x) else fallback


def compound(values: Iterable[float]) -> float:
    equity = 1.0
    for value in values:
        equity *= max(0.001, 1.0 + float(value))
    return equity - 1.0


def profit_factor(values: Sequence[float]) -> Optional[float]:
    wins = sum(v for v in values if v > 0)
    losses = -sum(v for v in values if v < 0)
    return wins / losses if losses > 1e-15 else (999.0 if wins > 0 else None)


def rounded(value: Any):
    if isinstance(value, float):
        return round(value, 6)
    if isinstance(value, dict):
        return {k: rounded(v) for k, v in value.items()}
    if isinstance(value, list):
        return [rounded(v) for v in value]
    return value


def configs() -> List[SizeConfig]:
    result = []
    for lb, weak, wg, strong, sg, dd, dg, streak, streak_gross in itertools.product(
        (15, 30, 45, 60),
        (-2.0, 0.0, 2.0, 4.0),
        (0.0, 0.25, 0.50),
        (3.0, 5.0, 8.0, 12.0),
        (0.90, 1.00, 1.25),
        (-4.0, -6.0, -8.0, -10.0),
        (0.0, 0.25, 0.50),
        (0, 2, 3),
        (0.0, 0.25, 0.50),
    ):
        signature = (
            lb * 3 + int((weak + 3) * 10) * 5 + int(wg * 100) * 7
            + int(strong) * 11 + int(sg * 100) * 13 + int(abs(dd)) * 17
            + int(dg * 100) * 19 + streak * 23 + int(streak_gross * 100) * 29
        )
        # Dense on fast 15/30d responses, bounded on slow 45/60d responses.
        modulus = 3 if lb <= 30 else 7
        if signature % modulus != 0:
            continue
        result.append(SizeConfig(
            f"V12C_LB{lb}_W{weak:g}_WG{wg:g}_S{strong:g}_SG{sg:g}_DD{dd:g}_DG{dg:g}_LS{streak}_LG{streak_gross:g}",
            lb, weak, wg, strong, sg, dd, dg, streak, streak_gross,
        ))
    # Hand-picked anchors around intuitive policies.
    anchors = [
        SizeConfig("ANCHOR_15_FAST", 15, 0.0, 0.25, 5.0, 1.00, -6.0, 0.0, 2, 0.25),
        SizeConfig("ANCHOR_15_AGGRESSIVE", 15, 0.0, 0.0, 5.0, 1.25, -6.0, 0.0, 2, 0.0),
        SizeConfig("ANCHOR_30_BALANCED", 30, 0.0, 0.25, 5.0, 1.00, -8.0, 0.25, 2, 0.25),
        SizeConfig("ANCHOR_30_AGGRESSIVE", 30, 2.0, 0.0, 5.0, 1.25, -6.0, 0.0, 2, 0.0),
        SizeConfig("ANCHOR_45_SMOOTH", 45, 0.0, 0.50, 8.0, 1.00, -8.0, 0.25, 3, 0.25),
        SizeConfig("ANCHOR_60_SMOOTH", 60, 0.0, 0.50, 8.0, 1.25, -10.0, 0.25, 3, 0.25),
    ]
    result.extend(anchors)
    return list({cfg.config_id: cfg for cfg in result}.values())


def trailing_stats(rows: Sequence[dict], ts: int, lookback_days: int) -> Tuple[float, float]:
    start = ts - lookback_days * DAY_MS
    values = [float(row["return"]) for row in rows if start <= int(row["ts"]) < ts]
    if not values:
        return 0.0, 0.0
    ret = compound(values) * 100.0
    equity = peak = 1.0
    max_dd = 0.0
    for value in values:
        equity *= max(0.001, 1.0 + value)
        peak = max(peak, equity)
        max_dd = min(max_dd, equity / peak - 1.0)
    return ret, max_dd * 100.0


def exact_trade_returns(entries: Sequence[dict], fixed_rows: Sequence[dict]) -> List[dict]:
    result = []
    for index, entry in enumerate(entries):
        start = int(entry["entryTs"])
        end = int(entries[index + 1]["entryTs"]) if index + 1 < len(entries) else END_MS
        # Because entries cannot overlap in V6, use the exact fixed-row contribution until next entry.
        values = [float(row["return"]) for row in fixed_rows if start <= int(row["ts"]) < end]
        result.append({"entryTs": start, "return": compound(values), "symbol": entry["symbol"]})
    return result


def consecutive_losses(trades: Sequence[dict], ts: int) -> int:
    completed = [row for row in trades if int(row["entryTs"]) < ts]
    count = 0
    for row in reversed(completed):
        if float(row["return"]) < 0:
            count += 1
        else:
            break
    return count


def allocation_for(cfg: SizeConfig, shadow_rows: Sequence[dict], shadow_trades: Sequence[dict], ts: int) -> Tuple[float, dict]:
    trailing_ret, trailing_dd = trailing_stats(shadow_rows, ts, cfg.lookback_days)
    loss_streak = consecutive_losses(shadow_trades, ts)
    gross = BASE_GROSS
    state = "NORMAL"
    if cfg.loss_streak > 0 and loss_streak >= cfg.loss_streak:
        gross = cfg.loss_streak_gross
        state = "LOSS_STREAK"
    elif trailing_dd <= cfg.dd_threshold_pct:
        gross = cfg.dd_gross
        state = "DD"
    elif trailing_ret <= cfg.weak_threshold_pct:
        gross = cfg.weak_gross
        state = "WEAK"
    elif trailing_ret >= cfg.strong_threshold_pct:
        gross = cfg.strong_gross
        state = "STRONG"
    gross = max(0.0, min(MAX_GROSS, gross))
    return gross, {
        "sizeState": state,
        "trailingReturnPct": trailing_ret,
        "trailingDDPct": trailing_dd,
        "lossStreak": loss_streak,
    }


def replay_exact_entries(
    entries: Sequence[dict],
    market: dict,
    allocations: Dict[int, Tuple[float, dict]],
    severe: bool,
) -> Tuple[List[dict], List[dict]]:
    entry_by_ts = {int(entry["entryTs"]): entry for entry in entries}
    times = [ts for ts in market["times"] if START_MS <= ts < END_MS]
    position: Optional[Position] = None
    rows = []
    realized_entries = []
    previous: Dict[str, float] = {}
    cost_bps = 50.0 if severe else 10.0
    adverse_bps = 3.0 if severe else 0.0

    for ts in times:
        if position is None and ts in entry_by_ts:
            entry = entry_by_ts[ts]
            gross, diagnostics = allocations[ts]
            # Keep the episode clock even at gross=0 so sizing never changes future signal timing.
            position = Position(
                symbol=str(entry["symbol"]), side=-1, entry_ts=ts,
                bars_held=0, max_bars=84 // BAR_HOURS, allocated_gross=gross,
            )
            realized_entries.append({**entry, "gross": gross, **diagnostics})

        weights: Dict[str, float] = {}
        value = 0.0
        if position is not None and position.allocated_gross > 0:
            weights[position.symbol] = position.side * position.allocated_gross
            idx = market["indexes"][position.symbol].get(ts)
            if idx is not None:
                bar = market["bars"][position.symbol][idx]
                value += position.side * position.allocated_gross * (float(bar["close"]) / float(bar["open"]) - 1.0)
                value -= position.side * position.allocated_gross * market["funding"][position.symbol].get(ts, 0.0)
                if severe:
                    value -= position.allocated_gross * adverse_bps / 10_000.0
        turnover = sum(abs(weights.get(s, 0.0) - previous.get(s, 0.0)) for s in set(weights) | set(previous))
        value -= turnover * cost_bps / 10_000.0
        gross_now = sum(abs(v) for v in weights.values())
        rows.append({"ts": ts, "return": value, "gross": gross_now, "maxGross": gross_now, "regime": -1 if weights else 0})
        previous = dict(weights)

        if position is not None:
            position.bars_held += 1
            if position.bars_held >= position.max_bars:
                position = None

    return rows, realized_entries


def metrics(rows: Sequence[dict], entries: Sequence[dict], start: int, end: int) -> dict:
    active = [row for row in rows if start <= int(row["ts"]) < end]
    values = [float(row["return"]) for row in active]
    equity = peak = 1.0
    max_dd = 0.0
    monthly: Dict[str, List[float]] = {}
    for row in active:
        equity *= max(0.001, 1.0 + float(row["return"]))
        peak = max(peak, equity)
        max_dd = min(max_dd, equity / peak - 1.0)
        key = dt.datetime.fromtimestamp(int(row["ts"]) / 1000, tz=UTC).strftime("%Y-%m")
        monthly.setdefault(key, []).append(float(row["return"]))
    monthly_ret = {key: compound(vals) * 100.0 for key, vals in monthly.items()}
    window_entries = [entry for entry in entries if start <= int(entry["entryTs"]) < end]
    years = max(1e-9, (end - start) / (365.25 * DAY_MS))
    return {
        "tradeEpisodes": len(window_entries),
        "compoundedReturnPct": (equity - 1.0) * 100.0,
        "cagrPct": (equity ** (1.0 / years) - 1.0) * 100.0 if equity > 0 else None,
        "maxDrawdownPct": max_dd * 100.0,
        "profitFactor": profit_factor(values),
        "positiveMonthRatio": sum(v > 0 for v in monthly_ret.values()) / len(monthly_ret) if monthly_ret else 0.0,
        "monthlyReturnsPct": monthly_ret,
        "averageAllocatedGross": sum(float(entry["gross"]) for entry in window_entries) / len(window_entries) if window_entries else 0.0,
        "maxAllocatedGross": max((float(entry["gross"]) for entry in window_entries), default=0.0),
    }


def evaluate(cfg: SizeConfig, market: dict, fixed_rows: Sequence[dict], fixed_entries: Sequence[dict], shadow_trades: Sequence[dict]) -> Tuple[dict, List[dict], List[dict], List[dict]]:
    allocations = {
        int(entry["entryTs"]): allocation_for(cfg, fixed_rows, shadow_trades, int(entry["entryTs"]))
        for entry in fixed_entries
    }
    normal, entries = replay_exact_entries(fixed_entries, market, allocations, False)
    severe, severe_entries = replay_exact_entries(fixed_entries, market, allocations, True)
    ranges = {
        "fold1": (START_MS, F1_MS), "fold2": (F1_MS, F2_MS), "fold3": (F2_MS, F3_MS),
        "lateEvaluation": (F3_MS, END_MS), "full": (START_MS, END_MS),
    }
    out = {"variantId": cfg.config_id, "config": asdict(cfg)}
    for name, (start, end) in ranges.items():
        out[name] = {"normal": metrics(normal, entries, start, end), "severe": metrics(severe, severe_entries, start, end)}
    normals = [out[name]["normal"] for name in ("fold1", "fold2", "fold3")]
    severes = [out[name]["severe"] for name in ("fold1", "fold2", "fold3")]
    pre = compound([finite(row["compoundedReturnPct"]) / 100.0 for row in normals]) * 100.0
    pre_s = compound([finite(row["compoundedReturnPct"]) / 100.0 for row in severes]) * 100.0
    pn = sum(finite(row["compoundedReturnPct"]) > 0 for row in normals)
    ps = sum(finite(row["compoundedReturnPct"]) > 0 for row in severes)
    worst_dd = min(finite(row["maxDrawdownPct"], -99.0) for row in normals)
    avg_pf = sum(min(5.0, finite(row.get("profitFactor"))) for row in normals) / 3.0
    eligible = bool(pn == 3 and ps >= 2 and pre >= 60.0 and pre_s >= 20.0 and worst_dd >= -15.0 and avg_pf >= 1.15)
    score = pre + 0.70 * pre_s + 5.0 * (pn + ps) + 6.0 * max(0.0, avg_pf - 1.0) - 0.25 * abs(worst_dd) if eligible else -1e12
    out["preSelection"] = {
        "eligible": eligible, "score": score, "compoundedReturnPct": pre,
        "severeCompoundedReturnPct": pre_s, "positiveFolds": pn,
        "positiveSevereFolds": ps, "worstFoldDrawdownPct": worst_dd,
        "averageFoldProfitFactor": avg_pf,
    }
    return out, normal, severe, entries


def compact(row: dict) -> dict:
    return {key: row[key] for key in ("variantId", "config", "preSelection", "fold1", "fold2", "fold3", "lateEvaluation", "full")}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", default=".research-state/v96-v12-corrected")
    args = parser.parse_args()
    output = Path(args.output_dir)
    output.mkdir(parents=True, exist_ok=True)

    market = v6.load_market()
    fixed_rows, fixed_entries = v6.simulate(A_CFG, market, severe=False)
    fixed_severe_rows, fixed_severe_entries = v6.simulate(A_CFG, market, severe=True)
    fixed_metrics = metrics(fixed_rows, [{**entry, "gross": BASE_GROSS} for entry in fixed_entries], START_MS, END_MS)
    fixed_severe_metrics = metrics(fixed_severe_rows, [{**entry, "gross": BASE_GROSS} for entry in fixed_severe_entries], START_MS, END_MS)
    if len(fixed_entries) != 48:
        raise RuntimeError(f"A4H parity failed: expected 48 entries, got {len(fixed_entries)}")
    if abs(fixed_metrics["compoundedReturnPct"] - BENCHMARK_RETURN) > 0.02:
        raise RuntimeError(f"A4H return parity failed: {fixed_metrics}")

    shadow_trades = exact_trade_returns(fixed_entries, fixed_rows)
    results = []
    replays = {}
    entry_ledgers = {}
    for cfg in configs():
        row, normal, severe, entries = evaluate(cfg, market, fixed_rows, fixed_entries, shadow_trades)
        results.append(row)
        replays[row["variantId"]] = (normal, severe)
        entry_ledgers[row["variantId"]] = entries

    eligible = sorted((row for row in results if row["preSelection"]["eligible"]), key=lambda row: (row["preSelection"]["score"], row["variantId"]), reverse=True)
    ranked = sorted(results, key=lambda row: (row["preSelection"]["score"], row["variantId"]), reverse=True)
    selected = eligible[0] if eligible else ranked[0]
    normal, severe = replays[selected["variantId"]]
    full = selected["full"]["normal"]
    full_s = selected["full"]["severe"]
    late = selected["lateEvaluation"]["normal"]
    late_s = selected["lateEvaluation"]["severe"]
    late_pass = bool(finite(late["compoundedReturnPct"]) > 0 and finite(late_s["compoundedReturnPct"]) > 0 and finite(late["maxDrawdownPct"], -99) >= -12.0 and finite(late.get("profitFactor")) > 1.05)
    beats = bool(finite(full["compoundedReturnPct"]) > BENCHMARK_RETURN and finite(full_s["compoundedReturnPct"]) > 25.0 and finite(full["maxDrawdownPct"], -99) >= -15.0 and finite(full.get("profitFactor")) > 1.22)
    status = "V96_RECENT_EVENT_CORE_V12_CORRECTED_PASS" if selected["preSelection"]["eligible"] and late_pass and beats else "V96_RECENT_EVENT_CORE_V12_CORRECTED_DIAGNOSTIC"
    top_full = sorted(results, key=lambda row: finite(row["full"]["normal"]["compoundedReturnPct"], -1e12), reverse=True)

    payload = rounded({
        "version": "12c",
        "strategyId": "V96_RECENT_EVENT_CORE_V12_CORRECTED_EXACT_ADAPTIVE_GROSS",
        "status": status,
        "parity": {
            "fixedTradeCount": len(fixed_entries),
            "fixedNormal": fixed_metrics,
            "fixedSevere": fixed_severe_metrics,
            "expectedNormalReturnPct": BENCHMARK_RETURN,
            "pass": len(fixed_entries) == 48 and abs(fixed_metrics["compoundedReturnPct"] - BENCHMARK_RETURN) <= 0.02,
        },
        "architecture": {
            "baseSignal": "exact V6 A4H SP4_L10_D5_B8_1_H84",
            "baseGross": BASE_GROSS,
            "runtimeGrossRange": [0.0, MAX_GROSS],
            "episodeScheduleFixedToExact48TradeReplay": True,
            "sizingUsesOnlyPastFixedShadowRowsAndCompletedEpisodes": True,
            "sameAllocationsNormalSevere": True,
        },
        "candidateCounts": {"tested": len(results), "eligible": len(eligible)},
        "selected": compact(selected),
        "selectedEntryLedger": entry_ledgers[selected["variantId"]],
        "selectedPassesLateEvaluation": late_pass,
        "selectedBeats101p998": beats,
        "topPreSelection": [compact(row) for row in ranked[:30]],
        "topFullDiagnosticOnly": [compact(row) for row in top_full[:30]],
        "selectionPolicy": {
            "rankingUsesOnlyFirstThreeFolds": True,
            "lateEvaluationUsedForRanking": False,
            "fullPeriodUsedForRanking": False,
            "target": "beat fixed +101.998210% with DD >= -15%, Severe >25%, Late Normal/Severe positive",
        },
        "selectedReplay": {
            "strategyId": "V96_RECENT_EVENT_CORE_V12_CORRECTED_EXACT_ADAPTIVE_GROSS",
            "variantId": selected["variantId"], "normal": normal, "severe": severe,
        },
        "safety": {"mode": "RESEARCH_ONLY", "ordersSent": False, "liveChanged": False, "vpsChanged": False, "productionChanged": False},
    })
    (output / "v96-recent-event-core-v12-corrected.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "status": status, "parity": payload["parity"], "candidateCounts": payload["candidateCounts"],
        "selected": selected["variantId"], "pre": selected["preSelection"], "full": selected["full"],
        "late": selected["lateEvaluation"], "beats": beats, "latePass": late_pass,
        "bestFullDiagnostic": compact(top_full[0]),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
