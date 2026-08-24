from __future__ import annotations

import argparse
import json
import math
from dataclasses import asdict
from pathlib import Path
from typing import Dict, List, Sequence

import research_lab_v52_frequency_expansion_v2 as x

STRATEGY_ID = "DISDEX_V52_PARETO_FREQUENCY_V3_RESEARCH_ONLY"
V50_WINDOWS = ("POST_EARLY3", "POST_ALL4")
V50_BASIS = (50.0, 55.0, 60.0, 65.0, 70.0)
V50_HOLD = (2, 3)
V50_EDGE = (2.5, 5.0, 7.5, 10.0)
V50_ADVERSE = 10.0
V11_BASIS = (40.0, 45.0, 50.0)
V11_EDGE = (7.5, 10.0)
V11_ADVERSE = 10.0


def evaluate(v11_spec: x.V11Spec, v11_rows, v50_spec: x.V50Spec, v50_rows, days: Sequence[str]) -> Dict[str, dict]:
    return x.metrics_for(v11_rows, v50_rows, days, v11_spec.minimum_net_edge_bps, v50_spec.minimum_net_edge_bps)


def quality_gate(candidate: dict, baseline: dict, baseline_val: dict) -> bool:
    c = candidate["selection"]
    b = baseline["selection"]
    return bool(
        candidate["development"]["NORMAL"]["compoundedReturnPct"] > 0
        and candidate["development"]["P95"]["compoundedReturnPct"] > 0
        and candidate["validation"]["NORMAL"]["compoundedReturnPct"] > 0
        and candidate["validation"]["P95"]["compoundedReturnPct"] > 0
        and candidate["validation"]["NORMAL"]["trades"] >= baseline_val["NORMAL"]["trades"]
        and c["NORMAL"]["trades"] >= math.ceil(b["NORMAL"]["trades"] * 1.05)
        and c["NORMAL"]["compoundedReturnPct"] >= b["NORMAL"]["compoundedReturnPct"]
        and (c["NORMAL"]["profitFactor"] or 0.0) >= max(2.5, 0.75 * (b["NORMAL"]["profitFactor"] or 0.0))
        and c["NORMAL"]["maxDrawdownPct"] >= b["NORMAL"]["maxDrawdownPct"] - 1.5
        and c["P95"]["compoundedReturnPct"] >= 0.90 * b["P95"]["compoundedReturnPct"]
        and (c["P95"]["profitFactor"] or 0.0) >= 2.0
        and c["SEVERE"]["compoundedReturnPct"] >= 0
    )


def ranking_score(candidate: dict, baseline: dict) -> float:
    c = candidate["selection"]
    b = baseline["selection"]
    trade_gain_pct = (c["NORMAL"]["trades"] / max(1, b["NORMAL"]["trades"]) - 1.0) * 100.0
    return (
        c["NORMAL"]["compoundedReturnPct"]
        + 0.40 * trade_gain_pct
        + 0.25 * c["P95"]["compoundedReturnPct"]
        + 2.0 * ((c["NORMAL"]["profitFactor"] or 0.0) - 2.0)
    )


def stage_b_gate(candidate: dict, locked_a: dict) -> bool:
    c = candidate["selection"]
    a = locked_a["selection"]
    return bool(
        candidate["development"]["NORMAL"]["compoundedReturnPct"] > 0
        and candidate["development"]["P95"]["compoundedReturnPct"] > 0
        and candidate["validation"]["NORMAL"]["compoundedReturnPct"] > 0
        and candidate["validation"]["P95"]["compoundedReturnPct"] > 0
        and c["NORMAL"]["trades"] >= a["NORMAL"]["trades"]
        and c["NORMAL"]["compoundedReturnPct"] >= a["NORMAL"]["compoundedReturnPct"]
        and (c["NORMAL"]["profitFactor"] or 0.0) >= 0.95 * (a["NORMAL"]["profitFactor"] or 0.0)
        and c["P95"]["compoundedReturnPct"] >= 0.95 * a["P95"]["compoundedReturnPct"]
        and c["NORMAL"]["maxDrawdownPct"] >= a["NORMAL"]["maxDrawdownPct"] - 0.5
        and c["SEVERE"]["compoundedReturnPct"] >= 0
    )


def locked_block(v11_spec, v11_rows, v50_spec, v50_rows, target, dev, val, final, holdout, selection_days):
    return {
        "v11": asdict(v11_spec),
        "v50": asdict(v50_spec),
        "selection": evaluate(v11_spec, v11_rows, v50_spec, v50_rows, selection_days),
        "development": evaluate(v11_spec, v11_rows, v50_spec, v50_rows, dev),
        "validation": evaluate(v11_spec, v11_rows, v50_spec, v50_rows, val),
        "finalReused": evaluate(v11_spec, v11_rows, v50_spec, v50_rows, final),
        "holdout": evaluate(v11_spec, v11_rows, v50_spec, v50_rows, holdout),
        "full": evaluate(v11_spec, v11_rows, v50_spec, v50_rows, target),
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
        "grossCapRespected": w["routing"].get("maximumObservedGross", 0.0) <= x.GROSS_CAP + 1e-9,
        "v50DailyTradeCapRespected": w["routing"].get("maximumObservedV50DailyTrades", 0) <= x.V50_MAX_DAILY_TRADES,
    }


def analyze(cache_root: Path) -> dict:
    x.base.v19.configure_exact_data_window()
    days, aligned, data_diag = x.base.v19.v17.load_all(cache_root / "aligned")
    warmup = [day for day in days if x.base.v19.WARMUP_START.date().isoformat() <= day < x.base.v19.BT_END_DAY_EXCLUSIVE]
    target = [day for day in warmup if x.base.v19.BT_START_DAY <= day < x.base.v19.BT_END_DAY_EXCLUSIVE]
    pre_holdout = [day for day in target if day < x.base.v20.HOLDOUT_START_DAY]
    holdout = [day for day in target if day >= x.base.v20.HOLDOUT_START_DAY]
    splits = x.base.v14.split_days(pre_holdout)
    dev = splits["DEVELOPMENT"]
    val = splits["VALIDATION"]
    final = splits["FINAL_REUSED"]
    selection_days = sorted(set(dev) | set(val))

    baseline_v11 = x.V11Spec(x.BASELINE_V11_BASIS_BPS, x.BASELINE_V11_ADVERSE_BPS, x.BASELINE_V11_EDGE_BPS)
    baseline_v50 = x.V50Spec(x.BASELINE_V50_WINDOW_SET, x.BASELINE_V50_BASIS_BPS, x.BASELINE_V50_HOLD_HOURS, x.BASELINE_V50_ADVERSE_BPS, x.BASELINE_V50_EDGE_BPS)
    baseline_v11_rows = x.build_v11_rows(baseline_v11, warmup, aligned)
    baseline_v50_rows = x.build_v50_rows(baseline_v50, target, aligned)
    baseline = locked_block(baseline_v11, baseline_v11_rows, baseline_v50, baseline_v50_rows, target, dev, val, final, holdout, selection_days)

    stage_a: List[dict] = []
    for window in V50_WINDOWS:
        for basis in V50_BASIS:
            for hold in V50_HOLD:
                for edge in V50_EDGE:
                    spec = x.V50Spec(window, basis, hold, V50_ADVERSE, edge)
                    rows = x.build_v50_rows(spec, target, aligned)
                    candidate = {
                        "spec": asdict(spec),
                        "selection": evaluate(baseline_v11, baseline_v11_rows, spec, rows, selection_days),
                        "development": evaluate(baseline_v11, baseline_v11_rows, spec, rows, dev),
                        "validation": evaluate(baseline_v11, baseline_v11_rows, spec, rows, val),
                    }
                    candidate["qualityPass"] = quality_gate(candidate, baseline, baseline["validation"])
                    candidate["score"] = ranking_score(candidate, baseline)
                    stage_a.append(candidate)
    eligible_a = [row for row in stage_a if row["qualityPass"]]
    eligible_a.sort(key=lambda row: (row["score"], row["selection"]["NORMAL"]["trades"]), reverse=True)
    a_winner = eligible_a[0] if eligible_a else None
    if a_winner:
        s = a_winner["spec"]
        locked_v50 = x.V50Spec(s["window_set"], s["minimum_basis_bps"], s["holding_hours"], s["maximum_adverse_basis_bps"], s["minimum_net_edge_bps"])
    else:
        locked_v50 = baseline_v50
    locked_v50_rows = x.build_v50_rows(locked_v50, target, aligned)
    locked_a = locked_block(baseline_v11, baseline_v11_rows, locked_v50, locked_v50_rows, target, dev, val, final, holdout, selection_days)

    stage_b: List[dict] = []
    for basis in V11_BASIS:
        for edge in V11_EDGE:
            spec = x.V11Spec(basis, V11_ADVERSE, edge)
            rows = x.build_v11_rows(spec, warmup, aligned)
            candidate = {
                "spec": asdict(spec),
                "selection": evaluate(spec, rows, locked_v50, locked_v50_rows, selection_days),
                "development": evaluate(spec, rows, locked_v50, locked_v50_rows, dev),
                "validation": evaluate(spec, rows, locked_v50, locked_v50_rows, val),
            }
            candidate["qualityPass"] = stage_b_gate(candidate, locked_a)
            candidate["score"] = ranking_score(candidate, baseline)
            stage_b.append(candidate)
    eligible_b = [row for row in stage_b if row["qualityPass"]]
    eligible_b.sort(key=lambda row: (row["score"], row["selection"]["NORMAL"]["trades"]), reverse=True)
    b_winner = eligible_b[0] if eligible_b else None
    if b_winner:
        s = b_winner["spec"]
        locked_v11 = x.V11Spec(s["minimum_basis_bps"], s["maximum_adverse_basis_bps"], s["minimum_net_edge_bps"])
    else:
        locked_v11 = baseline_v11
    locked_v11_rows = x.build_v11_rows(locked_v11, warmup, aligned)
    winner = locked_block(locked_v11, locked_v11_rows, locked_v50, locked_v50_rows, target, dev, val, final, holdout, selection_days)

    checks = final_checks(baseline, winner)
    promoted = (locked_v11 != baseline_v11 or locked_v50 != baseline_v50) and all(checks.values())
    return x.base.v14.rounded({
        "version": 3,
        "strategyId": STRATEGY_ID,
        "status": "V52_PARETO_FREQUENCY_CANDIDATE_PASS_RESEARCH_ONLY" if promoted else "V52_PARETO_FREQUENCY_NO_PROMOTION",
        "period": {
            "startInclusiveUtc": x.base.v19.BT_START.isoformat(),
            "endExclusiveUtc": x.base.v19.BT_END_EXCLUSIVE.isoformat(),
            "calendarDays": 365,
            "holdoutStartDay": x.base.v20.HOLDOUT_START_DAY,
        },
        "selectionDiscipline": {
            "holdoutUsedForSelection": False,
            "selectionUsesDevelopmentAndValidationOnly": True,
            "qualityFirstPareto": True,
            "clockGateChanged": False,
            "top1RuleChanged": False,
            "costRatioChanged": False,
            "grossCapChanged": False,
            "v50DailyTradeCapChanged": False,
        },
        "searchSpace": {
            "v50Candidates": len(stage_a),
            "v11Candidates": len(stage_b),
            "v50Windows": list(V50_WINDOWS),
            "v50BasisBps": list(V50_BASIS),
            "v50HoldHours": list(V50_HOLD),
            "v50NetEdgeBps": list(V50_EDGE),
            "v11BasisBps": list(V11_BASIS),
            "v11NetEdgeBps": list(V11_EDGE),
        },
        "baseline": baseline,
        "stageA": {"winner": a_winner, "eligibleCount": len(eligible_a), "top": eligible_a[:20]},
        "stageB": {"winner": b_winner, "eligibleCount": len(eligible_b), "top": eligible_b[:10]},
        "lockedWinner": winner,
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
    assert len(V50_WINDOWS) * len(V50_BASIS) * len(V50_HOLD) * len(V50_EDGE) == 80
    assert len(V11_BASIS) * len(V11_EDGE) == 6
    print("V52 Pareto frequency v3 self-test: PASS")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-root", default=".cache/aster-only-v39-overnight-open")
    parser.add_argument("--output-dir", default=".research-state/v52-pareto-frequency-v3")
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
        "eligibleV50": result["stageA"]["eligibleCount"],
        "eligibleV11": result["stageB"]["eligibleCount"],
        "baseline": result["baseline"]["full"]["NORMAL"],
        "winner": result["lockedWinner"]["full"]["NORMAL"],
        "winnerP95": result["lockedWinner"]["full"]["P95"],
        "winnerHoldout": result["lockedWinner"]["holdout"]["NORMAL"],
        "winnerV11": result["lockedWinner"]["v11"],
        "winnerV50": result["lockedWinner"]["v50"],
        "checks": result["finalChecks"],
    }, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
