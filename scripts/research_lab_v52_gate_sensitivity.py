from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import research_lab_aster_only_v14_replacement_tournament as v14
import research_lab_aster_only_v19_trailing_one_year_bt as v19
import research_lab_aster_only_v20_strict_hurdle_tournament as v20
import research_lab_aster_only_v22_v11eq_primary_v19_fallback as v22
import research_lab_aster_only_v50_post_open_basis_engine as v50
import research_lab_aster_only_v52_dual_slot_basis_engine as v52

STRATEGY_ID = "DISDEX_V52_GATE_SENSITIVITY_RESEARCH_ONLY"
SCENARIOS = v14.SCENARIOS
GROSS_CAP = 1.5
DAILY_LOSS_LIMIT = -0.02
MINIMUM_ALLOCATED_GROSS = 0.25
V11_MIN_BASIS_BPS = 50.0
V11_MAX_COST_BASIS_RATIO = 0.75
MAX_ROUND_TRIP_COST_BPS = 60.0
BASELINE_V50_BASIS_BPS = 75.0
BASELINE_MIN_NET_EDGE_BPS = 10.0
V50_BASIS_SWEEP = (50.0, 60.0, 65.0, 70.0, 75.0)
MIN_NET_EDGE_SWEEP = (5.0, 7.5, 10.0)


def finite(value: Any, fallback: float = 0.0) -> float:
    return v14.finite(value, fallback)


def trade_value(row: dict, cost_bps: float, min_net_edge_bps: float) -> Optional[float]:
    if cost_bps > MAX_ROUND_TRIP_COST_BPS:
        return None
    strategy = str(row["strategy"])
    edge = finite(row.get("edgeProxyBps"))
    if edge - cost_bps < min_net_edge_bps:
        return None
    if strategy == "V11_EQ":
        basis = abs(finite(row.get("entryBasisBps")))
        if basis < V11_MIN_BASIS_BPS:
            return None
        if cost_bps > min(MAX_ROUND_TRIP_COST_BPS, V11_MAX_COST_BASIS_RATIO * basis):
            return None
        gross = finite(row.get("gross"), 1.0)
        return finite(row.get("grossReturn")) - gross * cost_bps / 10_000.0
    if strategy == "V50_POST_OPEN_BASIS":
        return finite(row.get("grossReturn")) - cost_bps / 10_000.0
    raise RuntimeError(f"unexpected strategy {strategy}")


def route_variant(
    v11_rows: Sequence[dict],
    v50_rows: Sequence[dict],
    days: Sequence[str],
    cost_bps: float,
    min_net_edge_bps: float,
) -> Tuple[List[dict], dict]:
    allowed = set(days)
    by_day: Dict[str, List[dict]] = defaultdict(list)
    for row in list(v11_rows) + list(v50_rows):
        if str(row["day"]) in allowed:
            by_day[str(row["day"])].append(row)

    events: List[dict] = []
    stats: Counter[str] = Counter()
    maximum_observed_gross = 0.0

    for day in sorted(allowed):
        active: List[dict] = []
        daily_net = 0.0
        day_locked = False
        for raw in sorted(by_day.get(day, []), key=lambda item: (int(item["entryTs"]), str(item["strategy"]))):
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
            if any(str(position["strategy"]) == strategy for position in active):
                stats[f"{strategy}_SLOT_OCCUPIED"] += 1
                continue
            if any(str(position["symbol"]) == str(raw["symbol"]) for position in active):
                stats["SAME_SYMBOL_ACTIVE_BLOCKED"] += 1
                continue

            unit = trade_value(raw, cost_bps, min_net_edge_bps)
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

            position = {
                **raw,
                "allocatedGross": allocated,
                "netReturn": unit * allocated,
                "gateMinNetEdgeBps": min_net_edge_bps,
            }
            active.append(position)
            stats[f"{strategy}_ENTERED"] += 1
            maximum_observed_gross = max(
                maximum_observed_gross,
                sum(finite(item["allocatedGross"]) for item in active),
            )

        for position in sorted(active, key=lambda item: (int(item["exitTs"]), str(item["strategy"]))):
            value = finite(position["netReturn"])
            events.append(dict(position))
            stats[f"{position['strategy']}_EXITED"] += 1
            daily_net = (1.0 + daily_net) * (1.0 + value) - 1.0
            if daily_net <= DAILY_LOSS_LIMIT:
                day_locked = True

    events.sort(key=lambda row: (int(row["exitTs"]), int(row["entryTs"]), str(row["strategy"])))
    return events, {
        **dict(stats),
        "maximumObservedGross": round(maximum_observed_gross, 6),
        "configuredGrossCap": GROSS_CAP,
    }


def metrics_for(
    v11_rows: Sequence[dict],
    v50_rows: Sequence[dict],
    days: Sequence[str],
    min_net_edge_bps: float,
) -> Dict[str, dict]:
    out: Dict[str, dict] = {}
    for name, cost in SCENARIOS.items():
        events, routing = route_variant(v11_rows, v50_rows, days, cost, min_net_edge_bps)
        out[name] = v52.metrics(events, routing)
    return out


def build_v50_rows(basis_bps: float, days: Sequence[str], aligned: Dict[str, Dict[str, dict]]) -> List[dict]:
    candidate = v50.Candidate(
        candidate_id=f"POST_EARLY3__B{basis_bps:g}__H3__BOTH__NONE__GATE_SWEEP",
        window_set="POST_EARLY3",
        minimum_entry_basis_bps=basis_bps,
        maximum_holding_hours=3,
        direction_mode="BOTH",
        same_symbol_cooldown=False,
    )
    return v50.build_raw_trades(candidate, days, aligned)


def preholdout_pass(dev: dict, val: dict) -> bool:
    return bool(
        dev["NORMAL"]["compoundedReturnPct"] > 0
        and dev["P95"]["compoundedReturnPct"] > 0
        and (dev["NORMAL"]["profitFactor"] or 0.0) >= 1.2
        and val["NORMAL"]["trades"] >= 8
        and val["NORMAL"]["compoundedReturnPct"] > 0
        and val["P95"]["compoundedReturnPct"] > 0
        and (val["NORMAL"]["profitFactor"] or 0.0) >= 1.2
        and val["SEVERE"]["compoundedReturnPct"] >= 0
    )


def selection_score(dev: dict, val: dict) -> float:
    # Selection uses development + validation only. Trade count is deliberately
    # rewarded because this experiment addresses chronic under-firing.
    return (
        2.0 * val["NORMAL"]["trades"]
        + 0.5 * dev["NORMAL"]["trades"]
        + val["NORMAL"]["compoundedReturnPct"]
        + 0.5 * val["P95"]["compoundedReturnPct"]
        - 2.0 * abs(val["NORMAL"]["maxDrawdownPct"])
    )


def final_hurdles(baseline: dict, winner: dict) -> dict:
    b = baseline["full"]["NORMAL"]
    w = winner["full"]["NORMAL"]
    return {
        "normalTradesIncreaseAtLeast20Pct": w["trades"] >= max(b["trades"] + 1, int(b["trades"] * 1.20)),
        "normalProfitFactorAtLeast1_5": (w["profitFactor"] or 0.0) >= 1.5,
        "normalDrawdownNoWorseThanMinus15Pct": w["maxDrawdownPct"] >= -15.0,
        "normalReturnPositive": w["compoundedReturnPct"] > 0,
        "p95ReturnPositive": winner["full"]["P95"]["compoundedReturnPct"] > 0,
        "severeFailClosedNonnegative": winner["full"]["SEVERE"]["compoundedReturnPct"] >= 0,
        "holdoutAtLeastThreeTrades": winner["holdout"]["NORMAL"]["trades"] >= 3,
        "holdoutNormalPositive": winner["holdout"]["NORMAL"]["compoundedReturnPct"] > 0,
        "holdoutP95Positive": winner["holdout"]["P95"]["compoundedReturnPct"] > 0,
        "grossCapRespected": winner["full"]["NORMAL"]["routing"].get("maximumObservedGross", 0.0) <= GROSS_CAP + 1e-9,
    }


def analyze(cache_root: Path) -> dict:
    v19.configure_exact_data_window()
    days, aligned, data_diag = v19.v17.load_all(cache_root / "aligned")
    warmup = [day for day in days if v19.WARMUP_START.date().isoformat() <= day < v19.BT_END_DAY_EXCLUSIVE]
    target = [day for day in warmup if v19.BT_START_DAY <= day < v19.BT_END_DAY_EXCLUSIVE]
    pre_holdout = [day for day in target if day < v20.HOLDOUT_START_DAY]
    holdout = [day for day in target if day >= v20.HOLDOUT_START_DAY]
    splits = v14.split_days(pre_holdout)
    v11_rows, v11_diag = v22.build_v11eq(warmup, aligned)

    variants = []
    raw_cache: Dict[float, List[dict]] = {}
    for basis in V50_BASIS_SWEEP:
        raw_cache[basis] = build_v50_rows(basis, target, aligned)
        for edge in MIN_NET_EDGE_SWEEP:
            dev = metrics_for(v11_rows, raw_cache[basis], splits["DEVELOPMENT"], edge)
            val = metrics_for(v11_rows, raw_cache[basis], splits["VALIDATION"], edge)
            variants.append({
                "id": f"V50_B{basis:g}_EDGE{edge:g}",
                "v50MinimumBasisBps": basis,
                "minimumNetEdgeBps": edge,
                "development": dev,
                "validation": val,
                "preHoldoutPass": preholdout_pass(dev, val),
                "selectionScore": selection_score(dev, val),
            })

    baseline_meta = next(
        row for row in variants
        if row["v50MinimumBasisBps"] == BASELINE_V50_BASIS_BPS
        and row["minimumNetEdgeBps"] == BASELINE_MIN_NET_EDGE_BPS
    )
    baseline_pre_trades = (
        baseline_meta["development"]["NORMAL"]["trades"]
        + baseline_meta["validation"]["NORMAL"]["trades"]
    )
    eligible = [
        row for row in variants
        if row["preHoldoutPass"]
        and (
            row["development"]["NORMAL"]["trades"]
            + row["validation"]["NORMAL"]["trades"]
        ) >= max(baseline_pre_trades + 1, int(baseline_pre_trades * 1.10))
    ]
    winner_meta = max(eligible, key=lambda row: (row["selectionScore"], row["id"])) if eligible else baseline_meta

    def locked_evaluation(meta: dict) -> dict:
        basis = float(meta["v50MinimumBasisBps"])
        edge = float(meta["minimumNetEdgeBps"])
        rows = raw_cache[basis]
        return {
            "id": meta["id"],
            "v50MinimumBasisBps": basis,
            "minimumNetEdgeBps": edge,
            "full": metrics_for(v11_rows, rows, target, edge),
            "development": meta["development"],
            "validation": meta["validation"],
            "finalReused": metrics_for(v11_rows, rows, splits["FINAL_REUSED"], edge),
            "holdout": metrics_for(v11_rows, rows, holdout, edge),
            "rawV50Rows": len(rows),
        }

    baseline = locked_evaluation(baseline_meta)
    winner = locked_evaluation(winner_meta)
    checks = final_hurdles(baseline, winner)
    promoted = winner["id"] != baseline["id"] and all(checks.values())

    ranked = sorted(variants, key=lambda row: (row["preHoldoutPass"], row["selectionScore"]), reverse=True)
    return v14.rounded({
        "version": 1,
        "strategyId": STRATEGY_ID,
        "status": "V52_GATE_RELAXATION_CANDIDATE_PASS_RESEARCH_ONLY" if promoted else "V52_GATE_RELAXATION_NO_PROMOTION",
        "period": {
            "startInclusiveUtc": v19.BT_START.isoformat(),
            "endExclusiveUtc": v19.BT_END_EXCLUSIVE.isoformat(),
            "calendarDays": 365,
            "holdoutStartDay": v20.HOLDOUT_START_DAY,
        },
        "fixed": {
            "v11MinimumBasisBps": V11_MIN_BASIS_BPS,
            "v11MaximumCostBasisRatio": V11_MAX_COST_BASIS_RATIO,
            "maximumRoundTripCostBps": MAX_ROUND_TRIP_COST_BPS,
            "v50WindowSet": "POST_EARLY3",
            "v50MaximumHoldingHours": 3,
            "v50Direction": "BOTH",
            "v50AdverseBasisMoveBps": 10.0,
            "grossCap": GROSS_CAP,
            "dailyLossLimitPct": DAILY_LOSS_LIMIT * 100.0,
        },
        "sweep": {
            "v50MinimumBasisBps": list(V50_BASIS_SWEEP),
            "minimumNetEdgeBps": list(MIN_NET_EDGE_SWEEP),
            "selectionUsesHoldout": False,
            "rankedPreHoldout": ranked,
        },
        "baseline": baseline,
        "lockedWinner": winner,
        "finalChecks": checks,
        "recommendation": {
            "promoteToForwardValidation": promoted,
            "candidateId": winner["id"] if promoted else None,
            "productionChangeAllowed": False,
            "liveGateChanged": False,
        },
        "data": {"aligned": data_diag, "v11": v11_diag, "rawV11Rows": len(v11_rows)},
        "safety": {
            "mode": "RESEARCH_ONLY",
            "orderSubmissionAllowed": False,
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "realPositionsChanged": False,
        },
    })


def report(result: dict) -> str:
    baseline = result["baseline"]["full"]["NORMAL"]
    winner = result["lockedWinner"]["full"]["NORMAL"]
    holdout = result["lockedWinner"]["holdout"]["NORMAL"]
    lines = [
        "# V52 Gate Sensitivity Research",
        "",
        f"Status: **{result['status']}**",
        "",
        "Selection uses development + validation only; holdout is inspected only after the winner is locked.",
        "",
        "| Variant | V50 basis | Min net edge | NORMAL trades | NORMAL return | PF | MaxDD |",
        "|---|---:|---:|---:|---:|---:|---:|",
        f"| Baseline | {result['baseline']['v50MinimumBasisBps']:.1f} | {result['baseline']['minimumNetEdgeBps']:.1f} | {baseline['trades']} | {baseline['compoundedReturnPct']:.2f}% | {baseline['profitFactor']} | {baseline['maxDrawdownPct']:.2f}% |",
        f"| Locked winner | {result['lockedWinner']['v50MinimumBasisBps']:.1f} | {result['lockedWinner']['minimumNetEdgeBps']:.1f} | {winner['trades']} | {winner['compoundedReturnPct']:.2f}% | {winner['profitFactor']} | {winner['maxDrawdownPct']:.2f}% |",
        "",
        f"Winner holdout NORMAL: {holdout['trades']} trades, {holdout['compoundedReturnPct']:.2f}% return, PF {holdout['profitFactor']}",
        "",
        "No LIVE/production/VPS/order changes are permitted by this experiment.",
    ]
    return "\n".join(lines) + "\n"


def self_test() -> None:
    assert 75.0 in V50_BASIS_SWEEP
    assert min(V50_BASIS_SWEEP) >= 50.0
    assert min(MIN_NET_EDGE_SWEEP) >= 5.0
    row = {
        "strategy": "V50_POST_OPEN_BASIS",
        "edgeProxyBps": 55.0,
        "grossReturn": 0.01,
    }
    assert trade_value(row, 40.0, 10.0) is not None
    assert trade_value(row, 50.0, 10.0) is None
    v11 = {
        "strategy": "V11_EQ",
        "edgeProxyBps": 35.0,
        "entryBasisBps": 50.0,
        "grossReturn": 0.01,
        "gross": 1.0,
    }
    assert trade_value(v11, 25.0, 10.0) is not None
    assert trade_value(v11, 30.0, 10.0) is None
    print("V52 gate sensitivity self-test: PASS")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-root", default=".cache/aster-only-v39-overnight-open")
    parser.add_argument("--output-dir", default=".research-state/v52-gate-sensitivity")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return 0
    result = analyze(Path(args.cache_root))
    out = Path(args.output_dir)
    out.mkdir(parents=True, exist_ok=True)
    (out / "result.json").write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (out / "report.md").write_text(report(result), encoding="utf-8")
    print(json.dumps({
        "status": result["status"],
        "baseline": result["baseline"]["full"]["NORMAL"],
        "winner": result["lockedWinner"]["full"]["NORMAL"],
        "candidate": result["recommendation"]["candidateId"],
        "checks": result["finalChecks"],
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
