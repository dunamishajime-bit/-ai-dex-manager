from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import research_lab_v52_parallel_opportunity_v4 as v4

STRATEGY_ID = "DISDEX_V52_PARALLEL_OPPORTUNITY_V41_CONSERVATIVE_RESEARCH_ONLY"
BASELINE = v4.ParallelSpec(65.0, 5.0, 1, 1, 1.0)
CHALLENGER = v4.ParallelSpec(65.0, 5.0, 2, 2, 1.0)


def checks(baseline: dict, challenger: dict) -> dict:
    b = baseline["full"]["NORMAL"]
    c = challenger["full"]["NORMAL"]
    bp = baseline["full"]["P95"]
    cp = challenger["full"]["P95"]
    bh = baseline["holdout"]["NORMAL"]
    ch = challenger["holdout"]["NORMAL"]
    return {
        "sameStrategyThresholds": challenger["spec"]["minimum_basis_bps"] == baseline["spec"]["minimum_basis_bps"] == 65.0 and challenger["spec"]["minimum_net_edge_bps"] == baseline["spec"]["minimum_net_edge_bps"] == 5.0,
        "normalTradesIncreaseAtLeast20Pct": c["trades"] >= math.ceil(b["trades"] * 1.20),
        "normalReturnNotLowerThanBaseline": c["compoundedReturnPct"] >= b["compoundedReturnPct"],
        "normalProfitFactorAtLeast3": (c["profitFactor"] or 0.0) >= 3.0,
        "normalDrawdownNoWorseThanBaseline": c["maxDrawdownPct"] >= b["maxDrawdownPct"],
        "p95ReturnAtLeast95PctBaseline": cp["compoundedReturnPct"] >= 0.95 * bp["compoundedReturnPct"],
        "p95ProfitFactorAtLeast2_5": (cp["profitFactor"] or 0.0) >= 2.5,
        "holdoutTradesNotLowerThanBaseline": ch["trades"] >= bh["trades"],
        "holdoutNormalPositive": ch["compoundedReturnPct"] > 0,
        "holdoutProfitFactorAtLeast1_5": (ch["profitFactor"] or 0.0) >= 1.5,
        "holdoutP95Positive": challenger["holdout"]["P95"]["compoundedReturnPct"] > 0,
        "severeFailClosedNonnegative": challenger["full"]["SEVERE"]["compoundedReturnPct"] >= 0,
        "positiveProfitConcentrationAtMost40Pct": c["maximumPositiveProfitSymbolShare"] <= 0.40,
        "grossCapRespected": c["routing"].get("maximumObservedGross", 0.0) <= 1.5 + 1e-9,
        "slotCapRespected": c["routing"].get("maximumObservedV50Concurrent", 0) <= 2,
        "dailyTradeCapRespected": c["routing"].get("maximumObservedV50DailyTrades", 0) <= 3,
    }


def analyze(cache_root: Path) -> dict:
    v4.x.base.v19.configure_exact_data_window()
    days, aligned, data_diag = v4.x.base.v19.v17.load_all(cache_root / "aligned")
    warmup = [day for day in days if v4.x.base.v19.WARMUP_START.date().isoformat() <= day < v4.x.base.v19.BT_END_DAY_EXCLUSIVE]
    target = [day for day in warmup if v4.x.base.v19.BT_START_DAY <= day < v4.x.base.v19.BT_END_DAY_EXCLUSIVE]
    pre_holdout = [day for day in target if day < v4.x.base.v20.HOLDOUT_START_DAY]
    holdout = [day for day in target if day >= v4.x.base.v20.HOLDOUT_START_DAY]
    splits = v4.x.base.v14.split_days(pre_holdout)
    dev, val, final = splits["DEVELOPMENT"], splits["VALIDATION"], splits["FINAL_REUSED"]
    selection_days = sorted(set(dev) | set(val))
    v11_rows = v4.x.build_v11_rows(v4.BASELINE_V11, warmup, aligned)

    baseline_rows = v4.build_parallel_v50_rows(BASELINE, target, aligned)
    challenger_rows = v4.build_parallel_v50_rows(CHALLENGER, target, aligned)
    baseline = v4.block(BASELINE, v11_rows, baseline_rows, target, dev, val, final, holdout, selection_days)
    challenger = v4.block(CHALLENGER, v11_rows, challenger_rows, target, dev, val, final, holdout, selection_days)
    final_checks = checks(baseline, challenger)
    passed = all(final_checks.values())
    return v4.x.base.v14.rounded({
        "version": 41,
        "strategyId": STRATEGY_ID,
        "status": "V52_CONSERVATIVE_TOP2_PASS_RESEARCH_ONLY" if passed else "V52_CONSERVATIVE_TOP2_NO_PROMOTION",
        "period": {
            "startInclusiveUtc": v4.x.base.v19.BT_START.isoformat(),
            "endExclusiveUtc": v4.x.base.v19.BT_END_EXCLUSIVE.isoformat(),
            "calendarDays": 365,
            "holdoutStartDay": v4.x.base.v20.HOLDOUT_START_DAY,
        },
        "precommit": {
            "reason": "prefer structural opportunity harvesting before lowering the 65bps/5bps strategy thresholds",
            "candidateChosenBeforeThisHoldoutInspection": True,
            "selectionSource": "V4 development+validation eligible set",
            "thresholdRelaxationVsCurrent": False,
        },
        "baseline": baseline,
        "challenger": challenger,
        "finalChecks": final_checks,
        "recommendation": {
            "preferredResearchArchitecture": "65bps edge5 Top2 max2 V50 slots" if passed else None,
            "promoteToForwardValidation": passed,
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
    assert BASELINE.minimum_basis_bps == CHALLENGER.minimum_basis_bps == 65.0
    assert BASELINE.minimum_net_edge_bps == CHALLENGER.minimum_net_edge_bps == 5.0
    assert BASELINE.maximum_v50_slots == 1 and CHALLENGER.maximum_v50_slots == 2
    print("V52 conservative Top2 v4.1 self-test: PASS")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-root", default=".cache/aster-only-v39-overnight-open")
    parser.add_argument("--output-dir", default=".research-state/v52-parallel-opportunity-v41")
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
        "baseline": result["baseline"]["full"]["NORMAL"],
        "challenger": result["challenger"]["full"]["NORMAL"],
        "challengerP95": result["challenger"]["full"]["P95"],
        "baselineHoldout": result["baseline"]["holdout"]["NORMAL"],
        "challengerHoldout": result["challenger"]["holdout"]["NORMAL"],
        "checks": result["finalChecks"],
    }, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
