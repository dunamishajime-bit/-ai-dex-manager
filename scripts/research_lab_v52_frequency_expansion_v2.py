from __future__ import annotations

import argparse
import json
import math
import statistics
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import research_lab_v52_gate_sensitivity as base

STRATEGY_ID = "DISDEX_V52_FREQUENCY_EXPANSION_V2_RESEARCH_ONLY"
SCENARIOS = base.SCENARIOS
GROSS_CAP = 1.5
DAILY_LOSS_LIMIT = -0.02
MINIMUM_ALLOCATED_GROSS = 0.25
MAX_ROUND_TRIP_COST_BPS = 60.0
V11_MAX_COST_BASIS_RATIO = 0.75
V50_MAX_DAILY_TRADES = 3

# Exact current LIVE strategy-selectivity baseline after PR #190.
BASELINE_V11_BASIS_BPS = 50.0
BASELINE_V11_ADVERSE_BPS = 10.0
BASELINE_V11_EDGE_BPS = 10.0
BASELINE_V50_WINDOW_SET = "POST_EARLY3"
BASELINE_V50_BASIS_BPS = 65.0
BASELINE_V50_HOLD_HOURS = 3
BASELINE_V50_ADVERSE_BPS = 10.0
BASELINE_V50_EDGE_BPS = 5.0

V50_WINDOW_SWEEP = ("POST_EARLY3", "POST_ALL4", "POST_LATE3")
V50_BASIS_SWEEP = (35.0, 40.0, 45.0, 50.0, 55.0, 60.0, 65.0, 70.0, 75.0)
V50_HOLD_SWEEP = (1, 2, 3)
V50_ADVERSE_SWEEP = (10.0, 15.0, 20.0)
V50_EDGE_SWEEP = (0.0, 2.5, 5.0, 7.5, 10.0)

V11_BASIS_SWEEP = (35.0, 40.0, 45.0, 50.0)
V11_ADVERSE_SWEEP = (10.0, 15.0, 20.0)
V11_EDGE_SWEEP = (5.0, 7.5, 10.0)


@dataclass(frozen=True)
class V50Spec:
    window_set: str
    minimum_basis_bps: float
    holding_hours: int
    maximum_adverse_basis_bps: float
    minimum_net_edge_bps: float


@dataclass(frozen=True)
class V11Spec:
    minimum_basis_bps: float
    maximum_adverse_basis_bps: float
    minimum_net_edge_bps: float


def finite(value: Any, fallback: float = 0.0) -> float:
    return base.v14.finite(value, fallback)


def product(values: Iterable[float]) -> float:
    total = 1.0
    for value in values:
        total *= 1.0 + value
    return total - 1.0


def build_v11_rows(spec: V11Spec, days: Sequence[str], aligned: Dict[str, Dict[str, dict]]) -> List[dict]:
    candidate = base.v14.v11.Candidate(
        "BOTH__FLAT__CONVERGENCE__ABS_TOP1", "BOTH", "FLAT", "CONVERGENCE", "ABS_TOP1"
    )
    scores = base.v14.v11.rolling_scores(days, aligned)
    rows: List[dict] = []
    for day in days:
        trade = base.v14.v11.build_trade(candidate, day, aligned, scores)
        if trade is None:
            continue
        leg = trade["legs"][0]
        symbol = str(leg["symbol"])
        entry_basis = {
            item: (finite(aligned[item][day]["perp"]["entry"]) / finite(aligned[item][day]["cash"]["entry"]) - 1.0) * 10_000.0
            for item in base.v14.SYMBOLS
        }
        actual = finite(entry_basis[symbol])
        signal = finite(leg["entryBasisBps"])
        top1 = max(entry_basis, key=lambda item: abs(entry_basis[item]))
        clock_ms = abs(
            int(aligned[symbol][day]["cash"]["entryTs"])
            - int(aligned[symbol][day]["perp"]["entryTs"])
        )
        adverse = max(0.0, abs(actual) - abs(signal))
        if abs(actual) < spec.minimum_basis_bps:
            continue
        if top1 != symbol:
            continue
        if clock_ms > 1500:
            continue
        if adverse > spec.maximum_adverse_basis_bps:
            continue
        entry_ts, exit_ts = int(leg["entryTs"]), int(leg["exitTs"])
        rows.append({
            "strategy": "V11_EQ",
            "day": day,
            "symbol": symbol,
            "side": int(leg["side"]),
            "gross": finite(trade["gross"], 1.0),
            "entryTs": entry_ts,
            "exitTs": exit_ts,
            "holdingHours": max(0.0, (exit_ts - entry_ts) / 3_600_000.0),
            "grossReturn": finite(trade["grossReturn"]),
            "edgeProxyBps": abs(actual) - 15.0,
            "entryBasisBps": actual,
            "adverseBasisMoveBps": adverse,
            "exitReason": str(leg["exitReason"]),
        })
    return sorted(rows, key=lambda row: (str(row["day"]), int(row["entryTs"])))


def _select_v50_state(spec: V50Spec, states: Dict[str, dict]) -> Optional[Tuple[str, dict]]:
    eligible: List[Tuple[float, str, dict]] = []
    for symbol, state in states.items():
        signal_basis = finite(state["signalBasisBps"])
        entry_basis = finite(state["entryBasisBps"])
        if abs(entry_basis) < spec.minimum_basis_bps:
            continue
        if signal_basis * entry_basis <= 0:
            continue
        adverse = max(0.0, abs(entry_basis) - abs(signal_basis))
        if adverse > spec.maximum_adverse_basis_bps:
            continue
        eligible.append((abs(entry_basis), symbol, {**state, "adverseBasisMoveBps": adverse}))
    if not eligible:
        return None
    _score, symbol, state = sorted(eligible, key=lambda item: (-item[0], item[1]))[0]
    return symbol, state


def _build_v50_trade(
    spec: V50Spec,
    day: str,
    window_name: str,
    checkpoint_index: int,
    aligned: Dict[str, Dict[str, dict]],
) -> Optional[dict]:
    states = base.v50.window_state(aligned, day, checkpoint_index)
    selected = _select_v50_state(spec, states)
    if selected is None:
        return None
    symbol, state = selected
    entry_basis = finite(state["entryBasisBps"])
    side = -1 if entry_basis > 0 else 1
    future = list(state["futureCheckpoints"])
    if not future:
        return None
    maximum_index = min(len(future) - 1, spec.holding_hours - 1)
    chosen = future[maximum_index]
    exit_reason = f"TIME_{spec.holding_hours}H"
    for checkpoint in future[: maximum_index + 1]:
        current_basis = finite(checkpoint["basisBps"])
        converged = abs(current_basis) <= base.v50.CONVERGENCE_BPS or current_basis * entry_basis <= 0
        stopped = abs(current_basis) >= base.v50.BASIS_STOP_MULTIPLE * abs(entry_basis)
        if converged or stopped:
            chosen = checkpoint
            exit_reason = "BASIS_CONVERGED" if converged else "BASIS_STOP"
            break
    entry_price = finite(state["entryPrice"])
    exit_price = finite(chosen["exit"])
    entry_ts = int(state["entryTs"])
    exit_ts = int(chosen["exitTs"])
    price_return = side * (exit_price / entry_price - 1.0)
    funding_return = (-side) * base.v14.funding_mod.funding_between(
        state["row"]["perp"]["fundingPoints"], entry_ts, exit_ts
    )
    return {
        "strategy": "V50_POST_OPEN_BASIS",
        "route": f"POST_{window_name}",
        "day": day,
        "symbol": symbol,
        "side": side,
        "gross": 1.0,
        "entryTs": entry_ts,
        "exitTs": exit_ts,
        "holdingHours": max(0.0, (exit_ts - entry_ts) / 3_600_000.0),
        "signalBasisBps": finite(state["signalBasisBps"]),
        "entryBasisBps": entry_basis,
        "adverseBasisMoveBps": finite(state["adverseBasisMoveBps"]),
        "edgeProxyBps": abs(entry_basis) - base.v50.CONVERGENCE_BPS,
        "priceReturn": price_return,
        "fundingReturn": funding_return,
        "grossReturn": price_return + funding_return,
        "exitReason": exit_reason,
    }


def build_v50_rows(spec: V50Spec, days: Sequence[str], aligned: Dict[str, Dict[str, dict]]) -> List[dict]:
    rows: List[dict] = []
    allowed_indices = set(base.v50.WINDOW_SETS[spec.window_set])
    for day in days:
        for window_name, checkpoint_index in base.v50.WINDOWS:
            if checkpoint_index not in allowed_indices:
                continue
            trade = _build_v50_trade(spec, day, window_name, checkpoint_index, aligned)
            if trade is not None:
                rows.append(trade)
    return sorted(rows, key=lambda row: (str(row["day"]), int(row["entryTs"]), str(row["route"])))


def trade_value(row: dict, cost_bps: float, v11_edge_bps: float, v50_edge_bps: float) -> Optional[float]:
    if cost_bps > MAX_ROUND_TRIP_COST_BPS:
        return None
    strategy = str(row["strategy"])
    edge_proxy = finite(row.get("edgeProxyBps"))
    if strategy == "V11_EQ":
        basis = abs(finite(row.get("entryBasisBps")))
        if cost_bps > min(MAX_ROUND_TRIP_COST_BPS, V11_MAX_COST_BASIS_RATIO * basis):
            return None
        if edge_proxy - cost_bps < v11_edge_bps:
            return None
        gross = finite(row.get("gross"), 1.0)
        return finite(row.get("grossReturn")) - gross * cost_bps / 10_000.0
    if strategy == "V50_POST_OPEN_BASIS":
        if edge_proxy - cost_bps < v50_edge_bps:
            return None
        return finite(row.get("grossReturn")) - cost_bps / 10_000.0
    raise RuntimeError(f"unexpected strategy {strategy}")


def route(
    v11_rows: Sequence[dict],
    v50_rows: Sequence[dict],
    days: Sequence[str],
    cost_bps: float,
    v11_edge_bps: float,
    v50_edge_bps: float,
) -> Tuple[List[dict], dict]:
    allowed = set(days)
    by_day: Dict[str, List[dict]] = defaultdict(list)
    for row in list(v11_rows) + list(v50_rows):
        if str(row["day"]) in allowed:
            by_day[str(row["day"])].append(row)

    events: List[dict] = []
    stats: Counter[str] = Counter()
    maximum_observed_gross = 0.0
    maximum_v50_daily_trades = 0

    for day in sorted(allowed):
        active: List[dict] = []
        daily_net = 0.0
        day_locked = False
        v50_daily_trades = 0
        for raw in sorted(by_day.get(day, []), key=lambda item: (int(item["entryTs"]), str(item["strategy"]), str(item.get("route", "")))):
            entry_ts = int(raw["entryTs"])
            still_active: List[dict] = []
            for position in sorted(active, key=lambda item: (int(item["exitTs"]), str(item["strategy"]))):
                if int(position["exitTs"]) <= entry_ts:
                    value = finite(position["netReturn"])
                    events.append(dict(position))
                    stats[f"{position['strategy']}_EXITED"] += 1
                    daily_net = (1.0 + daily_net) * (1.0 + value) - 1.0
                    if daily_net <= DAILY_LOSS_LIMIT:
                        day_locked = True
                else:
                    still_active.append(position)
            active = still_active

            strategy = str(raw["strategy"])
            if day_locked:
                stats["DAILY_LOSS_BLOCKED"] += 1
                continue
            if strategy == "V50_POST_OPEN_BASIS" and v50_daily_trades >= V50_MAX_DAILY_TRADES:
                stats["V50_MAX_DAILY_TRADES_BLOCKED"] += 1
                continue
            if any(str(position["strategy"]) == strategy for position in active):
                stats[f"{strategy}_SLOT_OCCUPIED"] += 1
                continue
            if any(str(position["symbol"]) == str(raw["symbol"]) for position in active):
                stats["SAME_SYMBOL_ACTIVE_BLOCKED"] += 1
                continue

            unit = trade_value(raw, cost_bps, v11_edge_bps, v50_edge_bps)
            if unit is None:
                stats[f"{strategy}_COST_EDGE_REJECTED"] += 1
                continue

            active_gross = sum(finite(position["allocatedGross"]) for position in active)
            available = max(0.0, GROSS_CAP - active_gross)
            allocated = min(1.0, available)
            if allocated + 1e-12 < MINIMUM_ALLOCATED_GROSS:
                stats["CAPACITY_BLOCKED"] += 1
                continue
            if allocated < 1.0 - 1e-12:
                stats["SCALED_ENTRY"] += 1
            if active:
                stats[f"{strategy}_ENTERED_WHILE_OTHER_ACTIVE"] += 1

            position = {**raw, "allocatedGross": allocated, "netReturn": unit * allocated}
            active.append(position)
            stats[f"{strategy}_ENTERED"] += 1
            if strategy == "V50_POST_OPEN_BASIS":
                v50_daily_trades += 1
                maximum_v50_daily_trades = max(maximum_v50_daily_trades, v50_daily_trades)
            maximum_observed_gross = max(
                maximum_observed_gross,
                sum(finite(item["allocatedGross"]) for item in active),
            )

        for position in sorted(active, key=lambda item: (int(item["exitTs"]), str(item["strategy"]))):
            value = finite(position["netReturn"])
            events.append(dict(position))
            stats[f"{position['strategy']}_EXITED"] += 1
            daily_net = (1.0 + daily_net) * (1.0 + value) - 1.0

    events.sort(key=lambda row: (int(row["exitTs"]), int(row["entryTs"]), str(row["strategy"])))
    return events, {
        **dict(stats),
        "maximumObservedGross": round(maximum_observed_gross, 6),
        "configuredGrossCap": GROSS_CAP,
        "maximumObservedV50DailyTrades": maximum_v50_daily_trades,
        "configuredV50MaxDailyTrades": V50_MAX_DAILY_TRADES,
    }


def metrics_for(
    v11_rows: Sequence[dict],
    v50_rows: Sequence[dict],
    days: Sequence[str],
    v11_edge_bps: float,
    v50_edge_bps: float,
) -> Dict[str, dict]:
    out: Dict[str, dict] = {}
    for name, cost in SCENARIOS.items():
        events, routing = route(v11_rows, v50_rows, days, cost, v11_edge_bps, v50_edge_bps)
        out[name] = base.v52.metrics(events, routing)
    return out


def preholdout_quality_pass(dev: dict, val: dict) -> bool:
    return bool(
        dev["NORMAL"]["trades"] >= 20
        and dev["NORMAL"]["compoundedReturnPct"] > 0
        and dev["P95"]["compoundedReturnPct"] > 0
        and (dev["NORMAL"]["profitFactor"] or 0.0) >= 1.2
        and val["NORMAL"]["trades"] >= 3
        and val["NORMAL"]["compoundedReturnPct"] > 0
        and val["P95"]["compoundedReturnPct"] > 0
        and (val["NORMAL"]["profitFactor"] or 0.0) >= 1.2
        and val["NORMAL"]["maxDrawdownPct"] >= -10.0
        and dev["SEVERE"]["compoundedReturnPct"] >= 0
        and val["SEVERE"]["compoundedReturnPct"] >= 0
    )


def score(dev: dict, val: dict) -> float:
    return (
        2.5 * val["NORMAL"]["trades"]
        + 0.75 * dev["NORMAL"]["trades"]
        + val["NORMAL"]["compoundedReturnPct"]
        + 0.35 * dev["NORMAL"]["compoundedReturnPct"]
        + 0.5 * val["P95"]["compoundedReturnPct"]
        - 2.0 * abs(val["NORMAL"]["maxDrawdownPct"])
    )


def remove_best(events: Sequence[dict]) -> List[dict]:
    if not events:
        return []
    index = max(range(len(events)), key=lambda i: finite(events[i]["netReturn"]))
    return [row for i, row in enumerate(events) if i != index]


def remove_best_month(events: Sequence[dict]) -> List[dict]:
    monthly: Dict[str, float] = defaultdict(float)
    for row in events:
        monthly[str(row["day"])[:7]] += finite(row["netReturn"])
    if not monthly:
        return []
    month = max(monthly, key=lambda key: (monthly[key], key))
    return [row for row in events if str(row["day"])[:7] != month]


def event_metrics(events: Sequence[dict]) -> dict:
    routing = {"maximumObservedGross": max((finite(row.get("allocatedGross")) for row in events), default=0.0)}
    return base.v52.metrics(events, routing)


def final_checks(baseline: dict, winner: dict, robustness: dict) -> dict:
    b = baseline["full"]["NORMAL"]
    w = winner["full"]["NORMAL"]
    bp95 = baseline["full"]["P95"]
    wp95 = winner["full"]["P95"]
    hold = winner["holdout"]["NORMAL"]
    base_hold = baseline["holdout"]["NORMAL"]
    return {
        "normalTradesIncreaseAtLeast15Pct": w["trades"] >= math.ceil(b["trades"] * 1.15),
        "normalReturnNotLowerThanBaseline": w["compoundedReturnPct"] >= b["compoundedReturnPct"],
        "normalProfitFactorAtLeast2": (w["profitFactor"] or 0.0) >= 2.0,
        "normalDrawdownWithinTwoPointsOfBaselineAndAboveMinus8": w["maxDrawdownPct"] >= max(-8.0, b["maxDrawdownPct"] - 2.0),
        "p95ReturnAtLeast90PctOfBaseline": wp95["compoundedReturnPct"] >= 0.90 * bp95["compoundedReturnPct"],
        "p95ProfitFactorAtLeast2": (wp95["profitFactor"] or 0.0) >= 2.0,
        "holdoutTradesNotLowerThanBaseline": hold["trades"] >= base_hold["trades"],
        "holdoutNormalPositive": hold["compoundedReturnPct"] > 0,
        "holdoutNormalProfitFactorAtLeast1_2": (hold["profitFactor"] or 0.0) >= 1.2,
        "holdoutP95Positive": winner["holdout"]["P95"]["compoundedReturnPct"] > 0,
        "severeFailClosedNonnegative": winner["full"]["SEVERE"]["compoundedReturnPct"] >= 0,
        "positiveProfitConcentrationAtMost40Pct": w["maximumPositiveProfitSymbolShare"] <= 0.40,
        "bestTradeRemovedNormalPositive": robustness["normalBestTradeRemoved"]["compoundedReturnPct"] > 0,
        "bestMonthRemovedNormalPositive": robustness["normalBestMonthRemoved"]["compoundedReturnPct"] > 0,
        "grossCapRespected": w["routing"].get("maximumObservedGross", 0.0) <= GROSS_CAP + 1e-9,
        "v50DailyTradeCapRespected": w["routing"].get("maximumObservedV50DailyTrades", 0) <= V50_MAX_DAILY_TRADES,
    }


def analyze(cache_root: Path) -> dict:
    base.v19.configure_exact_data_window()
    days, aligned, data_diag = base.v19.v17.load_all(cache_root / "aligned")
    warmup = [day for day in days if base.v19.WARMUP_START.date().isoformat() <= day < base.v19.BT_END_DAY_EXCLUSIVE]
    target = [day for day in warmup if base.v19.BT_START_DAY <= day < base.v19.BT_END_DAY_EXCLUSIVE]
    pre_holdout = [day for day in target if day < base.v20.HOLDOUT_START_DAY]
    holdout = [day for day in target if day >= base.v20.HOLDOUT_START_DAY]
    splits = base.v14.split_days(pre_holdout)

    baseline_v11_spec = V11Spec(BASELINE_V11_BASIS_BPS, BASELINE_V11_ADVERSE_BPS, BASELINE_V11_EDGE_BPS)
    baseline_v50_spec = V50Spec(
        BASELINE_V50_WINDOW_SET,
        BASELINE_V50_BASIS_BPS,
        BASELINE_V50_HOLD_HOURS,
        BASELINE_V50_ADVERSE_BPS,
        BASELINE_V50_EDGE_BPS,
    )
    baseline_v11_rows = build_v11_rows(baseline_v11_spec, warmup, aligned)
    baseline_v50_rows = build_v50_rows(baseline_v50_spec, target, aligned)

    def evaluate(v11_spec: V11Spec, v11_rows: Sequence[dict], v50_spec: V50Spec, v50_rows: Sequence[dict], days_: Sequence[str]) -> Dict[str, dict]:
        return metrics_for(v11_rows, v50_rows, days_, v11_spec.minimum_net_edge_bps, v50_spec.minimum_net_edge_bps)

    baseline_dev = evaluate(baseline_v11_spec, baseline_v11_rows, baseline_v50_spec, baseline_v50_rows, splits["DEVELOPMENT"])
    baseline_val = evaluate(baseline_v11_spec, baseline_v11_rows, baseline_v50_spec, baseline_v50_rows, splits["VALIDATION"])

    # Stage A: broad V50 search with V11 fixed exactly to current LIVE behavior.
    v50_rows_cache: Dict[Tuple[str, float, int, float], List[dict]] = {}
    stage_a: List[dict] = []
    for window_set in V50_WINDOW_SWEEP:
        for basis_bps in V50_BASIS_SWEEP:
            for holding_hours in V50_HOLD_SWEEP:
                for adverse_bps in V50_ADVERSE_SWEEP:
                    key = (window_set, basis_bps, holding_hours, adverse_bps)
                    raw_spec = V50Spec(window_set, basis_bps, holding_hours, adverse_bps, 0.0)
                    rows = build_v50_rows(raw_spec, target, aligned)
                    v50_rows_cache[key] = rows
                    for edge_bps in V50_EDGE_SWEEP:
                        spec = V50Spec(window_set, basis_bps, holding_hours, adverse_bps, edge_bps)
                        dev = evaluate(baseline_v11_spec, baseline_v11_rows, spec, rows, splits["DEVELOPMENT"])
                        val = evaluate(baseline_v11_spec, baseline_v11_rows, spec, rows, splits["VALIDATION"])
                        stage_a.append({
                            "spec": asdict(spec),
                            "rawV50Rows": len(rows),
                            "development": dev,
                            "validation": val,
                            "qualityPass": preholdout_quality_pass(dev, val),
                            "score": score(dev, val),
                        })

    baseline_pre_trades = baseline_dev["NORMAL"]["trades"] + baseline_val["NORMAL"]["trades"]
    eligible_a = [
        row for row in stage_a
        if row["qualityPass"]
        and row["development"]["NORMAL"]["trades"] + row["validation"]["NORMAL"]["trades"] >= math.ceil(baseline_pre_trades * 1.10)
        and row["validation"]["NORMAL"]["trades"] >= baseline_val["NORMAL"]["trades"]
    ]
    eligible_a.sort(key=lambda row: (row["score"], row["validation"]["NORMAL"]["trades"]), reverse=True)
    stage_a_winner = eligible_a[0] if eligible_a else None
    if stage_a_winner:
        a = stage_a_winner["spec"]
        locked_v50_spec = V50Spec(a["window_set"], a["minimum_basis_bps"], a["holding_hours"], a["maximum_adverse_basis_bps"], a["minimum_net_edge_bps"])
    else:
        locked_v50_spec = baseline_v50_spec
    locked_v50_rows = v50_rows_cache.get(
        (locked_v50_spec.window_set, locked_v50_spec.minimum_basis_bps, locked_v50_spec.holding_hours, locked_v50_spec.maximum_adverse_basis_bps)
    ) or build_v50_rows(locked_v50_spec, target, aligned)

    # Stage B: V11 gate search against the Stage-A locked V50. Clock/top1/cost ratio remain fixed.
    stage_b: List[dict] = []
    v11_rows_cache: Dict[Tuple[float, float], List[dict]] = {}
    for basis_bps in V11_BASIS_SWEEP:
        for adverse_bps in V11_ADVERSE_SWEEP:
            key = (basis_bps, adverse_bps)
            raw_spec = V11Spec(basis_bps, adverse_bps, 0.0)
            rows = build_v11_rows(raw_spec, warmup, aligned)
            v11_rows_cache[key] = rows
            for edge_bps in V11_EDGE_SWEEP:
                spec = V11Spec(basis_bps, adverse_bps, edge_bps)
                dev = evaluate(spec, rows, locked_v50_spec, locked_v50_rows, splits["DEVELOPMENT"])
                val = evaluate(spec, rows, locked_v50_spec, locked_v50_rows, splits["VALIDATION"])
                stage_b.append({
                    "spec": asdict(spec),
                    "rawV11Rows": len(rows),
                    "development": dev,
                    "validation": val,
                    "qualityPass": preholdout_quality_pass(dev, val),
                    "score": score(dev, val),
                })

    locked_a_dev = evaluate(baseline_v11_spec, baseline_v11_rows, locked_v50_spec, locked_v50_rows, splits["DEVELOPMENT"])
    locked_a_val = evaluate(baseline_v11_spec, baseline_v11_rows, locked_v50_spec, locked_v50_rows, splits["VALIDATION"])
    locked_a_pre_trades = locked_a_dev["NORMAL"]["trades"] + locked_a_val["NORMAL"]["trades"]
    eligible_b = [
        row for row in stage_b
        if row["qualityPass"]
        and row["development"]["NORMAL"]["trades"] + row["validation"]["NORMAL"]["trades"] >= locked_a_pre_trades
        and row["validation"]["NORMAL"]["trades"] >= locked_a_val["NORMAL"]["trades"]
    ]
    eligible_b.sort(key=lambda row: (row["score"], row["validation"]["NORMAL"]["trades"]), reverse=True)
    stage_b_winner = eligible_b[0] if eligible_b else None
    if stage_b_winner:
        b = stage_b_winner["spec"]
        locked_v11_spec = V11Spec(b["minimum_basis_bps"], b["maximum_adverse_basis_bps"], b["minimum_net_edge_bps"])
    else:
        locked_v11_spec = baseline_v11_spec
    locked_v11_rows = v11_rows_cache.get((locked_v11_spec.minimum_basis_bps, locked_v11_spec.maximum_adverse_basis_bps)) or build_v11_rows(locked_v11_spec, warmup, aligned)

    def locked_evaluation(v11_spec: V11Spec, v11_rows: Sequence[dict], v50_spec: V50Spec, v50_rows: Sequence[dict]) -> dict:
        return {
            "v11": asdict(v11_spec),
            "v50": asdict(v50_spec),
            "full": evaluate(v11_spec, v11_rows, v50_spec, v50_rows, target),
            "development": evaluate(v11_spec, v11_rows, v50_spec, v50_rows, splits["DEVELOPMENT"]),
            "validation": evaluate(v11_spec, v11_rows, v50_spec, v50_rows, splits["VALIDATION"]),
            "finalReused": evaluate(v11_spec, v11_rows, v50_spec, v50_rows, splits["FINAL_REUSED"]),
            "holdout": evaluate(v11_spec, v11_rows, v50_spec, v50_rows, holdout),
            "rawV11Rows": len(v11_rows),
            "rawV50Rows": len(v50_rows),
        }

    baseline = locked_evaluation(baseline_v11_spec, baseline_v11_rows, baseline_v50_spec, baseline_v50_rows)
    winner = locked_evaluation(locked_v11_spec, locked_v11_rows, locked_v50_spec, locked_v50_rows)

    normal_events, _ = route(locked_v11_rows, locked_v50_rows, target, SCENARIOS["NORMAL"], locked_v11_spec.minimum_net_edge_bps, locked_v50_spec.minimum_net_edge_bps)
    p95_events, _ = route(locked_v11_rows, locked_v50_rows, target, SCENARIOS["P95"], locked_v11_spec.minimum_net_edge_bps, locked_v50_spec.minimum_net_edge_bps)
    robustness = {
        "normalBestTradeRemoved": event_metrics(remove_best(normal_events)),
        "p95BestTradeRemoved": event_metrics(remove_best(p95_events)),
        "normalBestMonthRemoved": event_metrics(remove_best_month(normal_events)),
        "p95BestMonthRemoved": event_metrics(remove_best_month(p95_events)),
    }
    checks = final_checks(baseline, winner, robustness)
    promoted = (locked_v11_spec != baseline_v11_spec or locked_v50_spec != baseline_v50_spec) and all(checks.values())

    stage_a_ranked = sorted(stage_a, key=lambda row: (row["qualityPass"], row["score"]), reverse=True)[:20]
    stage_b_ranked = sorted(stage_b, key=lambda row: (row["qualityPass"], row["score"]), reverse=True)[:20]

    return base.v14.rounded({
        "version": 2,
        "strategyId": STRATEGY_ID,
        "status": "V52_FREQUENCY_EXPANSION_CANDIDATE_PASS_RESEARCH_ONLY" if promoted else "V52_FREQUENCY_EXPANSION_NO_PROMOTION",
        "period": {
            "startInclusiveUtc": base.v19.BT_START.isoformat(),
            "endExclusiveUtc": base.v19.BT_END_EXCLUSIVE.isoformat(),
            "calendarDays": 365,
            "holdoutStartDay": base.v20.HOLDOUT_START_DAY,
        },
        "selectionDiscipline": {
            "holdoutUsedForSelection": False,
            "stageA": "V50 broad sweep with exact current LIVE V11 fixed",
            "stageB": "V11 local sweep with Stage-A V50 locked",
            "clockGateChanged": False,
            "top1RuleChanged": False,
            "costRatioChanged": False,
            "grossCapChanged": False,
            "dailyLossGateChanged": False,
            "v50DailyTradeCapChanged": False,
        },
        "searchSpace": {
            "v50CandidateCount": len(stage_a),
            "v11CandidateCount": len(stage_b),
            "v50Windows": list(V50_WINDOW_SWEEP),
            "v50BasisBps": list(V50_BASIS_SWEEP),
            "v50HoldHours": list(V50_HOLD_SWEEP),
            "v50AdverseBps": list(V50_ADVERSE_SWEEP),
            "v50NetEdgeBps": list(V50_EDGE_SWEEP),
            "v11BasisBps": list(V11_BASIS_SWEEP),
            "v11AdverseBps": list(V11_ADVERSE_SWEEP),
            "v11NetEdgeBps": list(V11_EDGE_SWEEP),
        },
        "baseline": baseline,
        "lockedWinner": winner,
        "stageA": {
            "winner": stage_a_winner,
            "topPreHoldout": stage_a_ranked,
        },
        "stageB": {
            "winner": stage_b_winner,
            "topPreHoldout": stage_b_ranked,
        },
        "robustness": robustness,
        "finalChecks": checks,
        "recommendation": {
            "promoteToForwardValidation": promoted,
            "productionChangeAllowed": False,
            "liveGateChanged": False,
        },
        "data": data_diag,
        "safety": {
            "mode": "RESEARCH_ONLY",
            "orderSubmissionAllowed": False,
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "realPositionsChanged": False,
        },
    })


def self_test() -> None:
    assert len(V50_WINDOW_SWEEP) * len(V50_BASIS_SWEEP) * len(V50_HOLD_SWEEP) * len(V50_ADVERSE_SWEEP) * len(V50_EDGE_SWEEP) == 1215
    assert len(V11_BASIS_SWEEP) * len(V11_ADVERSE_SWEEP) * len(V11_EDGE_SWEEP) == 36
    v11 = {"strategy": "V11_EQ", "edgeProxyBps": 35.0, "entryBasisBps": 50.0, "gross": 1.0, "grossReturn": 0.01}
    assert trade_value(v11, 25.0, 10.0, 5.0) is not None
    assert trade_value(v11, 30.0, 10.0, 5.0) is None
    v50 = {"strategy": "V50_POST_OPEN_BASIS", "edgeProxyBps": 45.0, "grossReturn": 0.01}
    assert trade_value(v50, 40.0, 10.0, 5.0) is not None
    assert trade_value(v50, 40.0, 10.0, 7.5) is None
    print("V52 frequency expansion v2 self-test: PASS")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-root", default=".cache/aster-only-v39-overnight-open")
    parser.add_argument("--output-dir", default=".research-state/v52-frequency-expansion-v2")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return 0
    result = analyze(Path(args.cache_root))
    output = Path(args.output_dir)
    output.mkdir(parents=True, exist_ok=True)
    (output / "result.json").write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    summary = {
        "status": result["status"],
        "baseline": result["baseline"]["full"]["NORMAL"],
        "winner": result["lockedWinner"]["full"]["NORMAL"],
        "winnerP95": result["lockedWinner"]["full"]["P95"],
        "winnerHoldout": result["lockedWinner"]["holdout"]["NORMAL"],
        "winnerV11": result["lockedWinner"]["v11"],
        "winnerV50": result["lockedWinner"]["v50"],
        "checks": result["finalChecks"],
    }
    (output / "summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
