from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import research_lab_v52_gate_sensitivity as g

STRATEGY_ID = "DISDEX_V52_GATE_SENSITIVITY_RELATIVE_RESEARCH_ONLY"


def preholdout_quality_pass(dev: dict, val: dict) -> bool:
    return bool(
        dev["NORMAL"]["compoundedReturnPct"] > 0
        and dev["P95"]["compoundedReturnPct"] > 0
        and (dev["NORMAL"]["profitFactor"] or 0.0) >= 1.2
        and val["NORMAL"]["trades"] >= 3
        and val["NORMAL"]["compoundedReturnPct"] > 0
        and val["P95"]["compoundedReturnPct"] > 0
        and (val["NORMAL"]["profitFactor"] or 0.0) >= 1.2
        and val["SEVERE"]["compoundedReturnPct"] >= 0
    )


def final_hurdles(baseline: dict, winner: dict) -> dict:
    b = baseline["full"]["NORMAL"]
    w = winner["full"]["NORMAL"]
    required = max(b["trades"] + 1, math.ceil(b["trades"] * 1.05))
    return {
        "normalTradesIncreaseAtLeast5Pct": w["trades"] >= required,
        "normalProfitFactorAtLeast1_5": (w["profitFactor"] or 0.0) >= 1.5,
        "normalDrawdownNoWorseThanMinus15Pct": w["maxDrawdownPct"] >= -15.0,
        "normalReturnPositive": w["compoundedReturnPct"] > 0,
        "p95ReturnPositive": winner["full"]["P95"]["compoundedReturnPct"] > 0,
        "severeFailClosedNonnegative": winner["full"]["SEVERE"]["compoundedReturnPct"] >= 0,
        "holdoutAtLeastThreeTrades": winner["holdout"]["NORMAL"]["trades"] >= 3,
        "holdoutNormalPositive": winner["holdout"]["NORMAL"]["compoundedReturnPct"] > 0,
        "holdoutP95Positive": winner["holdout"]["P95"]["compoundedReturnPct"] > 0,
        "holdoutNormalProfitFactorAtLeast1_2": (winner["holdout"]["NORMAL"]["profitFactor"] or 0.0) >= 1.2,
        "grossCapRespected": winner["full"]["NORMAL"]["routing"].get("maximumObservedGross", 0.0) <= g.GROSS_CAP + 1e-9,
    }


def analyze(cache_root: Path) -> dict:
    g.v19.configure_exact_data_window()
    days, aligned, data_diag = g.v19.v17.load_all(cache_root / "aligned")
    warmup = [day for day in days if g.v19.WARMUP_START.date().isoformat() <= day < g.v19.BT_END_DAY_EXCLUSIVE]
    target = [day for day in warmup if g.v19.BT_START_DAY <= day < g.v19.BT_END_DAY_EXCLUSIVE]
    pre_holdout = [day for day in target if day < g.v20.HOLDOUT_START_DAY]
    holdout = [day for day in target if day >= g.v20.HOLDOUT_START_DAY]
    splits = g.v14.split_days(pre_holdout)
    v11_rows, v11_diag = g.v22.build_v11eq(warmup, aligned)

    variants = []
    raw_cache = {}
    for basis in g.V50_BASIS_SWEEP:
        raw_cache[basis] = g.build_v50_rows(basis, target, aligned)
        for edge in g.MIN_NET_EDGE_SWEEP:
            dev = g.metrics_for(v11_rows, raw_cache[basis], splits["DEVELOPMENT"], edge)
            val = g.metrics_for(v11_rows, raw_cache[basis], splits["VALIDATION"], edge)
            variants.append({
                "id": f"V50_B{basis:g}_EDGE{edge:g}",
                "v50MinimumBasisBps": basis,
                "minimumNetEdgeBps": edge,
                "development": dev,
                "validation": val,
                "preHoldoutQualityPass": preholdout_quality_pass(dev, val),
                "selectionScore": g.selection_score(dev, val),
            })

    baseline_meta = next(
        row for row in variants
        if row["v50MinimumBasisBps"] == g.BASELINE_V50_BASIS_BPS
        and row["minimumNetEdgeBps"] == g.BASELINE_MIN_NET_EDGE_BPS
    )
    baseline_dev_trades = baseline_meta["development"]["NORMAL"]["trades"]
    baseline_val_trades = baseline_meta["validation"]["NORMAL"]["trades"]
    baseline_pre_trades = baseline_dev_trades + baseline_val_trades

    eligible = []
    for row in variants:
        pre_trades = row["development"]["NORMAL"]["trades"] + row["validation"]["NORMAL"]["trades"]
        if (
            row["preHoldoutQualityPass"]
            and row["validation"]["NORMAL"]["trades"] >= baseline_val_trades + 1
            and pre_trades >= baseline_pre_trades + 1
        ):
            eligible.append(row)

    winner_meta = max(eligible, key=lambda row: (row["selectionScore"], row["id"])) if eligible else baseline_meta

    def locked_evaluation(meta: dict) -> dict:
        basis = float(meta["v50MinimumBasisBps"])
        edge = float(meta["minimumNetEdgeBps"])
        rows = raw_cache[basis]
        return {
            "id": meta["id"],
            "v50MinimumBasisBps": basis,
            "minimumNetEdgeBps": edge,
            "full": g.metrics_for(v11_rows, rows, target, edge),
            "development": meta["development"],
            "validation": meta["validation"],
            "finalReused": g.metrics_for(v11_rows, rows, splits["FINAL_REUSED"], edge),
            "holdout": g.metrics_for(v11_rows, rows, holdout, edge),
            "rawV50Rows": len(rows),
        }

    baseline = locked_evaluation(baseline_meta)
    winner = locked_evaluation(winner_meta)
    checks = final_hurdles(baseline, winner)
    promoted = winner["id"] != baseline["id"] and all(checks.values())

    ranked = sorted(
        variants,
        key=lambda row: (row["preHoldoutQualityPass"], row["selectionScore"]),
        reverse=True,
    )
    return g.v14.rounded({
        "version": 2,
        "strategyId": STRATEGY_ID,
        "status": "V52_GATE_RELAXATION_CANDIDATE_PASS_RESEARCH_ONLY" if promoted else "V52_GATE_RELAXATION_NO_PROMOTION",
        "period": {
            "startInclusiveUtc": g.v19.BT_START.isoformat(),
            "endExclusiveUtc": g.v19.BT_END_EXCLUSIVE.isoformat(),
            "calendarDays": 365,
            "holdoutStartDay": g.v20.HOLDOUT_START_DAY,
        },
        "selection": {
            "usesHoldout": False,
            "baselineDevelopmentNormalTrades": baseline_dev_trades,
            "baselineValidationNormalTrades": baseline_val_trades,
            "baselinePreHoldoutNormalTrades": baseline_pre_trades,
            "candidateMustBeatBaselineValidationTradesByAtLeast": 1,
            "candidateMustBeatBaselinePreHoldoutTradesByAtLeast": 1,
        },
        "fixed": {
            "v11MinimumBasisBps": g.V11_MIN_BASIS_BPS,
            "v11MaximumCostBasisRatio": g.V11_MAX_COST_BASIS_RATIO,
            "maximumRoundTripCostBps": g.MAX_ROUND_TRIP_COST_BPS,
            "v50WindowSet": "POST_EARLY3",
            "v50MaximumHoldingHours": 3,
            "v50Direction": "BOTH",
            "v50AdverseBasisMoveBps": 10.0,
            "grossCap": g.GROSS_CAP,
            "dailyLossLimitPct": g.DAILY_LOSS_LIMIT * 100.0,
        },
        "sweep": {
            "v50MinimumBasisBps": list(g.V50_BASIS_SWEEP),
            "minimumNetEdgeBps": list(g.MIN_NET_EDGE_SWEEP),
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


def self_test() -> None:
    baseline = {"full": {"NORMAL": {"trades": 100}}}
    winner = {
        "full": {
            "NORMAL": {"trades": 105, "profitFactor": 2.0, "maxDrawdownPct": -5.0, "compoundedReturnPct": 20.0, "routing": {"maximumObservedGross": 1.5}},
            "P95": {"compoundedReturnPct": 10.0},
            "SEVERE": {"compoundedReturnPct": 0.0},
        },
        "holdout": {"NORMAL": {"trades": 3, "compoundedReturnPct": 1.0, "profitFactor": 2.0}, "P95": {"compoundedReturnPct": 0.5}},
    }
    assert all(final_hurdles(baseline, winner).values())
    print("V52 relative gate sensitivity self-test: PASS")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-root", default=".cache/aster-only-v39-overnight-open")
    parser.add_argument("--output-dir", default=".research-state/v52-gate-sensitivity-relative")
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
        "candidate": result["recommendation"]["candidateId"],
        "baselineNormal": result["baseline"]["full"]["NORMAL"],
        "winnerNormal": result["lockedWinner"]["full"]["NORMAL"],
        "winnerP95": result["lockedWinner"]["full"]["P95"],
        "winnerSevere": result["lockedWinner"]["full"]["SEVERE"],
        "winnerHoldoutNormal": result["lockedWinner"]["holdout"]["NORMAL"],
        "winnerHoldoutP95": result["lockedWinner"]["holdout"]["P95"],
        "checks": result["finalChecks"],
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
