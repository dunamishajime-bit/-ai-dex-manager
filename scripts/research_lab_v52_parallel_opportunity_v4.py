from __future__ import annotations

import argparse
import json
import math
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import research_lab_v52_frequency_expansion_v2 as x

STRATEGY_ID = "DISDEX_V52_PARALLEL_OPPORTUNITY_V4_RESEARCH_ONLY"
SCENARIOS = x.SCENARIOS
GROSS_CAP = 1.5
DAILY_LOSS_LIMIT = -0.02
MINIMUM_ALLOCATED_GROSS = 0.25
MAX_ROUND_TRIP_COST_BPS = 60.0
V11_MAX_COST_BASIS_RATIO = 0.75
V50_MAX_DAILY_TRADES = 3

# Keep the proven economic thesis and timing. This experiment changes only how
# many independently qualified symbols may be harvested from the same window.
V50_WINDOW_SET = "POST_EARLY3"
V50_HOLD_HOURS = 3
V50_ADVERSE_BPS = 10.0
V50_BASIS_SWEEP = (60.0, 65.0)
V50_EDGE_SWEEP = (2.5, 5.0)
TOP_K_SWEEP = (1, 2, 3)
V50_SLOT_SWEEP = (1, 2)
V50_TARGET_GROSS_SWEEP = (0.5, 0.75, 1.0)

BASELINE_V11 = x.V11Spec(50.0, 10.0, 10.0)
BASELINE_V50_BASIS = 65.0
BASELINE_V50_EDGE = 5.0
BASELINE_TOP_K = 1
BASELINE_V50_SLOTS = 1
BASELINE_TARGET_GROSS = 1.0


@dataclass(frozen=True)
class ParallelSpec:
    minimum_basis_bps: float
    minimum_net_edge_bps: float
    top_k: int
    maximum_v50_slots: int
    target_gross: float


def finite(value, fallback: float = 0.0) -> float:
    return x.finite(value, fallback)


def qualified_states(spec: ParallelSpec, states: Dict[str, dict]) -> List[Tuple[str, dict]]:
    eligible: List[Tuple[float, str, dict]] = []
    for symbol, state in states.items():
        signal_basis = finite(state["signalBasisBps"])
        entry_basis = finite(state["entryBasisBps"])
        if abs(entry_basis) < spec.minimum_basis_bps:
            continue
        if signal_basis * entry_basis <= 0:
            continue
        adverse = max(0.0, abs(entry_basis) - abs(signal_basis))
        if adverse > V50_ADVERSE_BPS:
            continue
        eligible.append((abs(entry_basis), symbol, {**state, "adverseBasisMoveBps": adverse}))
    eligible.sort(key=lambda item: (-item[0], item[1]))
    return [(symbol, state) for _score, symbol, state in eligible[: spec.top_k]]


def build_symbol_trade(day: str, window_name: str, state: dict, rank: int) -> Optional[dict]:
    symbol = str(state.get("symbol") or "")
    entry_basis = finite(state["entryBasisBps"])
    side = -1 if entry_basis > 0 else 1
    future = list(state["futureCheckpoints"])
    if not future:
        return None
    maximum_index = min(len(future) - 1, V50_HOLD_HOURS - 1)
    chosen = future[maximum_index]
    exit_reason = f"TIME_{V50_HOLD_HOURS}H"
    for checkpoint in future[: maximum_index + 1]:
        current_basis = finite(checkpoint["basisBps"])
        converged = abs(current_basis) <= x.base.v50.CONVERGENCE_BPS or current_basis * entry_basis <= 0
        stopped = abs(current_basis) >= x.base.v50.BASIS_STOP_MULTIPLE * abs(entry_basis)
        if converged or stopped:
            chosen = checkpoint
            exit_reason = "BASIS_CONVERGED" if converged else "BASIS_STOP"
            break
    entry_price = finite(state["entryPrice"])
    exit_price = finite(chosen["exit"])
    entry_ts = int(state["entryTs"])
    exit_ts = int(chosen["exitTs"])
    price_return = side * (exit_price / entry_price - 1.0)
    funding_return = (-side) * x.base.v14.funding_mod.funding_between(
        state["row"]["perp"]["fundingPoints"], entry_ts, exit_ts
    )
    return {
        "strategy": "V50_POST_OPEN_BASIS",
        "route": f"POST_{window_name}",
        "day": day,
        "symbol": symbol,
        "rank": rank,
        "side": side,
        "gross": 1.0,
        "entryTs": entry_ts,
        "exitTs": exit_ts,
        "holdingHours": max(0.0, (exit_ts - entry_ts) / 3_600_000.0),
        "signalBasisBps": finite(state["signalBasisBps"]),
        "entryBasisBps": entry_basis,
        "adverseBasisMoveBps": finite(state["adverseBasisMoveBps"]),
        "edgeProxyBps": abs(entry_basis) - x.base.v50.CONVERGENCE_BPS,
        "priceReturn": price_return,
        "fundingReturn": funding_return,
        "grossReturn": price_return + funding_return,
        "exitReason": exit_reason,
    }


def build_parallel_v50_rows(spec: ParallelSpec, days: Sequence[str], aligned: Dict[str, Dict[str, dict]]) -> List[dict]:
    rows: List[dict] = []
    allowed_indices = set(x.base.v50.WINDOW_SETS[V50_WINDOW_SET])
    for day in days:
        for window_name, checkpoint_index in x.base.v50.WINDOWS:
            if checkpoint_index not in allowed_indices:
                continue
            states = x.base.v50.window_state(aligned, day, checkpoint_index)
            for rank, (symbol, state) in enumerate(qualified_states(spec, states), start=1):
                trade = build_symbol_trade(day, window_name, {**state, "symbol": symbol}, rank)
                if trade is not None:
                    rows.append(trade)
    return sorted(rows, key=lambda row: (str(row["day"]), int(row["entryTs"]), int(row["rank"]), str(row["symbol"])))


def trade_value(row: dict, cost_bps: float, v50_edge_bps: float) -> Optional[float]:
    if cost_bps > MAX_ROUND_TRIP_COST_BPS:
        return None
    strategy = str(row["strategy"])
    edge = finite(row.get("edgeProxyBps"))
    if strategy == "V11_EQ":
        basis = abs(finite(row.get("entryBasisBps")))
        if cost_bps > min(MAX_ROUND_TRIP_COST_BPS, V11_MAX_COST_BASIS_RATIO * basis):
            return None
        if edge - cost_bps < BASELINE_V11.minimum_net_edge_bps:
            return None
        return finite(row.get("grossReturn")) - finite(row.get("gross"), 1.0) * cost_bps / 10_000.0
    if strategy == "V50_POST_OPEN_BASIS":
        if edge - cost_bps < v50_edge_bps:
            return None
        return finite(row.get("grossReturn")) - cost_bps / 10_000.0
    raise RuntimeError(f"unexpected strategy {strategy}")


def route(
    spec: ParallelSpec,
    v11_rows: Sequence[dict],
    v50_rows: Sequence[dict],
    days: Sequence[str],
    cost_bps: float,
) -> Tuple[List[dict], dict]:
    allowed = set(days)
    by_day: Dict[str, List[dict]] = defaultdict(list)
    for row in list(v11_rows) + list(v50_rows):
        if str(row["day"]) in allowed:
            by_day[str(row["day"])].append(row)

    events: List[dict] = []
    stats: Counter[str] = Counter()
    maximum_observed_gross = 0.0
    maximum_v50_concurrent = 0
    maximum_v50_daily_trades = 0

    for day in sorted(allowed):
        active: List[dict] = []
        daily_net = 0.0
        day_locked = False
        v50_daily_trades = 0
        ordered = sorted(
            by_day.get(day, []),
            key=lambda row: (
                int(row["entryTs"]),
                0 if str(row["strategy"]) == "V11_EQ" else 1,
                int(row.get("rank", 1)),
                str(row["symbol"]),
            ),
        )
        for raw in ordered:
            entry_ts = int(raw["entryTs"])
            still_active: List[dict] = []
            for position in sorted(active, key=lambda item: (int(item["exitTs"]), str(item["strategy"]), str(item["symbol"]))):
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
            if any(str(position["symbol"]) == str(raw["symbol"]) for position in active):
                stats["SAME_SYMBOL_ACTIVE_BLOCKED"] += 1
                continue
            if strategy == "V11_EQ" and any(str(position["strategy"]) == "V11_EQ" for position in active):
                stats["V11_EQ_SLOT_OCCUPIED"] += 1
                continue
            if strategy == "V50_POST_OPEN_BASIS":
                active_v50 = sum(str(position["strategy"]) == "V50_POST_OPEN_BASIS" for position in active)
                if active_v50 >= spec.maximum_v50_slots:
                    stats["V50_SLOT_CAP_BLOCKED"] += 1
                    continue
                if v50_daily_trades >= V50_MAX_DAILY_TRADES:
                    stats["V50_MAX_DAILY_TRADES_BLOCKED"] += 1
                    continue

            unit = trade_value(raw, cost_bps, spec.minimum_net_edge_bps)
            if unit is None:
                stats[f"{strategy}_COST_EDGE_REJECTED"] += 1
                continue

            active_gross = sum(finite(position["allocatedGross"]) for position in active)
            available = max(0.0, GROSS_CAP - active_gross)
            desired = 1.0 if strategy == "V11_EQ" else spec.target_gross
            allocated = min(desired, available)
            if allocated + 1e-12 < MINIMUM_ALLOCATED_GROSS:
                stats["CAPACITY_BLOCKED"] += 1
                continue
            if allocated < desired - 1e-12:
                stats["SCALED_ENTRY"] += 1

            position = {**raw, "allocatedGross": allocated, "netReturn": unit * allocated}
            active.append(position)
            stats[f"{strategy}_ENTERED"] += 1
            if strategy == "V50_POST_OPEN_BASIS":
                stats[f"V50_RANK_{int(raw.get('rank', 1))}_ENTERED"] += 1
                v50_daily_trades += 1
                maximum_v50_daily_trades = max(maximum_v50_daily_trades, v50_daily_trades)
                current_v50 = sum(str(item["strategy"]) == "V50_POST_OPEN_BASIS" for item in active)
                maximum_v50_concurrent = max(maximum_v50_concurrent, current_v50)
            maximum_observed_gross = max(maximum_observed_gross, sum(finite(item["allocatedGross"]) for item in active))

        for position in sorted(active, key=lambda item: (int(item["exitTs"]), str(item["strategy"]), str(item["symbol"]))):
            events.append(dict(position))
            stats[f"{position['strategy']}_EXITED"] += 1

    events.sort(key=lambda row: (int(row["exitTs"]), int(row["entryTs"]), str(row["strategy"]), str(row["symbol"])))
    return events, {
        **dict(stats),
        "maximumObservedGross": round(maximum_observed_gross, 6),
        "configuredGrossCap": GROSS_CAP,
        "maximumObservedV50Concurrent": maximum_v50_concurrent,
        "configuredMaximumV50Slots": spec.maximum_v50_slots,
        "maximumObservedV50DailyTrades": maximum_v50_daily_trades,
        "configuredV50MaxDailyTrades": V50_MAX_DAILY_TRADES,
    }


def metrics_for(spec: ParallelSpec, v11_rows, v50_rows, days: Sequence[str]) -> Dict[str, dict]:
    out: Dict[str, dict] = {}
    for name, cost in SCENARIOS.items():
        events, routing = route(spec, v11_rows, v50_rows, days, cost)
        out[name] = x.base.v52.metrics(events, routing)
    return out


def selection_gate(candidate: dict, baseline: dict) -> bool:
    c = candidate["selection"]
    b = baseline["selection"]
    return bool(
        candidate["development"]["NORMAL"]["compoundedReturnPct"] > 0
        and candidate["development"]["P95"]["compoundedReturnPct"] > 0
        and candidate["validation"]["NORMAL"]["compoundedReturnPct"] > 0
        and candidate["validation"]["P95"]["compoundedReturnPct"] > 0
        and candidate["validation"]["NORMAL"]["trades"] >= baseline["validation"]["NORMAL"]["trades"]
        and c["NORMAL"]["trades"] >= math.ceil(b["NORMAL"]["trades"] * 1.05)
        and c["NORMAL"]["compoundedReturnPct"] >= b["NORMAL"]["compoundedReturnPct"]
        and (c["NORMAL"]["profitFactor"] or 0.0) >= 3.0
        and c["NORMAL"]["maxDrawdownPct"] >= b["NORMAL"]["maxDrawdownPct"] - 1.5
        and c["P95"]["compoundedReturnPct"] >= 0.95 * b["P95"]["compoundedReturnPct"]
        and (c["P95"]["profitFactor"] or 0.0) >= 2.5
        and c["SEVERE"]["compoundedReturnPct"] >= 0
    )


def ranking_score(candidate: dict, baseline: dict) -> float:
    c = candidate["selection"]
    b = baseline["selection"]
    trade_gain_pct = (c["NORMAL"]["trades"] / max(1, b["NORMAL"]["trades"]) - 1.0) * 100.0
    return c["NORMAL"]["compoundedReturnPct"] + 0.5 * trade_gain_pct + 0.25 * c["P95"]["compoundedReturnPct"]


def block(spec: ParallelSpec, v11_rows, v50_rows, target, dev, val, final, holdout, selection_days) -> dict:
    return {
        "spec": asdict(spec),
        "selection": metrics_for(spec, v11_rows, v50_rows, selection_days),
        "development": metrics_for(spec, v11_rows, v50_rows, dev),
        "validation": metrics_for(spec, v11_rows, v50_rows, val),
        "finalReused": metrics_for(spec, v11_rows, v50_rows, final),
        "holdout": metrics_for(spec, v11_rows, v50_rows, holdout),
        "full": metrics_for(spec, v11_rows, v50_rows, target),
    }


def final_checks(baseline: dict, winner: dict) -> dict:
    b = baseline["full"]["NORMAL"]
    w = winner["full"]["NORMAL"]
    bp = baseline["full"]["P95"]
    wp = winner["full"]["P95"]
    bh = baseline["holdout"]["NORMAL"]
    wh = winner["holdout"]["NORMAL"]
    return {
        "normalTradesIncreaseAtLeast5Pct": w["trades"] >= math.ceil(b["trades"] * 1.05),
        "normalReturnNotLowerThanBaseline": w["compoundedReturnPct"] >= b["compoundedReturnPct"],
        "normalProfitFactorAtLeast3": (w["profitFactor"] or 0.0) >= 3.0,
        "normalDrawdownNoMoreThan1_5PointsWorse": w["maxDrawdownPct"] >= b["maxDrawdownPct"] - 1.5,
        "p95ReturnAtLeast95PctBaseline": wp["compoundedReturnPct"] >= 0.95 * bp["compoundedReturnPct"],
        "p95ProfitFactorAtLeast2_5": (wp["profitFactor"] or 0.0) >= 2.5,
        "holdoutTradesNotLowerThanBaseline": wh["trades"] >= bh["trades"],
        "holdoutNormalPositive": wh["compoundedReturnPct"] > 0,
        "holdoutProfitFactorAtLeast1_5": (wh["profitFactor"] or 0.0) >= 1.5,
        "holdoutP95Positive": winner["holdout"]["P95"]["compoundedReturnPct"] > 0,
        "severeFailClosedNonnegative": winner["full"]["SEVERE"]["compoundedReturnPct"] >= 0,
        "positiveProfitConcentrationAtMost40Pct": w["maximumPositiveProfitSymbolShare"] <= 0.40,
        "grossCapRespected": w["routing"].get("maximumObservedGross", 0.0) <= GROSS_CAP + 1e-9,
        "slotCapRespected": w["routing"].get("maximumObservedV50Concurrent", 0) <= winner["spec"]["maximum_v50_slots"],
        "dailyTradeCapRespected": w["routing"].get("maximumObservedV50DailyTrades", 0) <= V50_MAX_DAILY_TRADES,
    }


def analyze(cache_root: Path) -> dict:
    x.base.v19.configure_exact_data_window()
    days, aligned, data_diag = x.base.v19.v17.load_all(cache_root / "aligned")
    warmup = [day for day in days if x.base.v19.WARMUP_START.date().isoformat() <= day < x.base.v19.BT_END_DAY_EXCLUSIVE]
    target = [day for day in warmup if x.base.v19.BT_START_DAY <= day < x.base.v19.BT_END_DAY_EXCLUSIVE]
    pre_holdout = [day for day in target if day < x.base.v20.HOLDOUT_START_DAY]
    holdout = [day for day in target if day >= x.base.v20.HOLDOUT_START_DAY]
    splits = x.base.v14.split_days(pre_holdout)
    dev, val, final = splits["DEVELOPMENT"], splits["VALIDATION"], splits["FINAL_REUSED"]
    selection_days = sorted(set(dev) | set(val))
    v11_rows = x.build_v11_rows(BASELINE_V11, warmup, aligned)

    baseline_spec = ParallelSpec(BASELINE_V50_BASIS, BASELINE_V50_EDGE, BASELINE_TOP_K, BASELINE_V50_SLOTS, BASELINE_TARGET_GROSS)
    baseline_v50_rows = build_parallel_v50_rows(baseline_spec, target, aligned)
    baseline = block(baseline_spec, v11_rows, baseline_v50_rows, target, dev, val, final, holdout, selection_days)

    diagnostics: List[dict] = []
    for basis in V50_BASIS_SWEEP:
        for edge in V50_EDGE_SWEEP:
            for top_k in TOP_K_SWEEP:
                for slots in V50_SLOT_SWEEP:
                    for target_gross in V50_TARGET_GROSS_SWEEP:
                        spec = ParallelSpec(basis, edge, top_k, slots, target_gross)
                        rows = build_parallel_v50_rows(spec, target, aligned)
                        candidate = {
                            "spec": asdict(spec),
                            "rawV50Rows": len(rows),
                            "selection": metrics_for(spec, v11_rows, rows, selection_days),
                            "development": metrics_for(spec, v11_rows, rows, dev),
                            "validation": metrics_for(spec, v11_rows, rows, val),
                        }
                        candidate["qualityPass"] = selection_gate(candidate, baseline)
                        candidate["score"] = ranking_score(candidate, baseline)
                        diagnostics.append(candidate)

    eligible = [row for row in diagnostics if row["qualityPass"]]
    eligible.sort(key=lambda row: (row["score"], row["selection"]["NORMAL"]["trades"]), reverse=True)
    selected = eligible[0] if eligible else None
    if selected:
        s = selected["spec"]
        winner_spec = ParallelSpec(s["minimum_basis_bps"], s["minimum_net_edge_bps"], s["top_k"], s["maximum_v50_slots"], s["target_gross"])
    else:
        winner_spec = baseline_spec
    winner_rows = build_parallel_v50_rows(winner_spec, target, aligned)
    winner = block(winner_spec, v11_rows, winner_rows, target, dev, val, final, holdout, selection_days)
    checks = final_checks(baseline, winner)
    promoted = winner_spec != baseline_spec and all(checks.values())

    diagnostics.sort(key=lambda row: (row["qualityPass"], row["score"]), reverse=True)
    return x.base.v14.rounded({
        "version": 4,
        "strategyId": STRATEGY_ID,
        "status": "V52_PARALLEL_OPPORTUNITY_CANDIDATE_PASS_RESEARCH_ONLY" if promoted else "V52_PARALLEL_OPPORTUNITY_NO_PROMOTION",
        "period": {
            "startInclusiveUtc": x.base.v19.BT_START.isoformat(),
            "endExclusiveUtc": x.base.v19.BT_END_EXCLUSIVE.isoformat(),
            "calendarDays": 365,
            "holdoutStartDay": x.base.v20.HOLDOUT_START_DAY,
        },
        "architecture": {
            "economicThesisChanged": False,
            "entryWindowsChanged": False,
            "holdingRuleChanged": False,
            "adverseBasisGateChanged": False,
            "v11Changed": False,
            "globalGrossCap": GROSS_CAP,
            "maximumV50DailyTrades": V50_MAX_DAILY_TRADES,
            "experiment": "ranked independently qualified V50 symbols with one or two V50 slots",
        },
        "selectionDiscipline": {
            "holdoutUsedForSelection": False,
            "selectionUsesDevelopmentAndValidationOnly": True,
            "productionPromotionAllowed": False,
        },
        "searchSpace": {
            "candidateCount": len(diagnostics),
            "basisBps": list(V50_BASIS_SWEEP),
            "netEdgeBps": list(V50_EDGE_SWEEP),
            "topK": list(TOP_K_SWEEP),
            "maximumV50Slots": list(V50_SLOT_SWEEP),
            "targetGross": list(V50_TARGET_GROSS_SWEEP),
        },
        "baseline": baseline,
        "eligibleCount": len(eligible),
        "topCandidates": diagnostics[:20],
        "lockedWinner": winner,
        "finalChecks": checks,
        "recommendation": {
            "promoteToForwardValidation": promoted,
            "productionChangeAllowed": False,
            "liveChanged": False,
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
    assert len(V50_BASIS_SWEEP) * len(V50_EDGE_SWEEP) * len(TOP_K_SWEEP) * len(V50_SLOT_SWEEP) * len(V50_TARGET_GROSS_SWEEP) == 72
    baseline = ParallelSpec(65.0, 5.0, 1, 1, 1.0)
    assert baseline.minimum_basis_bps == 65.0
    assert baseline.top_k == 1
    print("V52 parallel opportunity v4 self-test: PASS")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-root", default=".cache/aster-only-v39-overnight-open")
    parser.add_argument("--output-dir", default=".research-state/v52-parallel-opportunity-v4")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return 0
    result = analyze(Path(args.cache_root))
    out = Path(args.output_dir)
    out.mkdir(parents=True, exist_ok=True)
    (out / "result.json").write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "status": result["status"],
        "eligibleCount": result["eligibleCount"],
        "baseline": result["baseline"]["full"]["NORMAL"],
        "winner": result["lockedWinner"]["full"]["NORMAL"],
        "winnerP95": result["lockedWinner"]["full"]["P95"],
        "winnerHoldout": result["lockedWinner"]["holdout"]["NORMAL"],
        "winnerSpec": result["lockedWinner"]["spec"],
        "checks": result["finalChecks"],
    }, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
