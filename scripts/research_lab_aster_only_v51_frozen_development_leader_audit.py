from __future__ import annotations

import argparse
import json
from collections import defaultdict
from dataclasses import asdict
from pathlib import Path
from typing import Dict, List, Sequence

import research_lab_aster_only_v50_post_open_basis_engine as v50

STRATEGY_ID = "DISDEX_ASTER_ONLY_V51_FROZEN_DEVELOPMENT_LEADER_AUDIT"
CUSTOM_COSTS = (50.0, 60.0)


def metrics_for(candidate, raw: Sequence[dict], cost_bps: float, days: Sequence[str]) -> dict:
    events, routing = v50.route(candidate, raw, cost_bps, days)
    return {"metrics": v50.v22.metrics(events), "routing": routing}


def monthly_metrics(candidate, raw: Sequence[dict], cost_bps: float, days: Sequence[str]) -> Dict[str, dict]:
    months = sorted({day[:7] for day in days})
    return {
        month: metrics_for(candidate, raw, cost_bps, [day for day in days if day.startswith(month)])["metrics"]
        for month in months
    }


def analyze(cache_root: Path) -> dict:
    v50.v19.configure_exact_data_window()
    days, aligned, aligned_diag = v50.v19.v17.load_all(cache_root / "aligned")
    target = [day for day in days if v50.v19.BT_START_DAY <= day < v50.v19.BT_END_DAY_EXCLUSIVE]
    pre_holdout = [day for day in target if day < v50.v20.HOLDOUT_START_DAY]
    holdout = [day for day in target if day >= v50.v20.HOLDOUT_START_DAY]
    splits = v50.v14.split_days(pre_holdout)

    development_candidates: List[dict] = []
    for candidate in v50.CANDIDATES:
        raw = v50.build_raw_trades(candidate, target, aligned)
        audit = v50.audit(candidate, raw, target, splits["DEVELOPMENT"], splits["VALIDATION"], splits["FINAL_REUSED"], holdout)
        if v50.development_pass(audit):
            score = (
                audit["development"]["NORMAL"]["compoundedReturnPct"]
                + audit["development"]["P95"]["compoundedReturnPct"]
            )
            development_candidates.append({"candidate": candidate, "raw": raw, "audit": audit, "score": score})
    development_candidates.sort(key=lambda item: (-item["score"], item["candidate"].candidate_id))
    if not development_candidates:
        return v50.v14.rounded({
            "version": 51,
            "strategyId": STRATEGY_ID,
            "status": "ASTER_ONLY_V51_NO_DEVELOPMENT_LEADER",
            "selection": {"developmentCandidates": 0},
            "safety": safety(),
        })

    selected = development_candidates[0]
    candidate = selected["candidate"]
    raw = selected["raw"]
    audit = selected["audit"]
    post_development = sorted(splits["VALIDATION"] + splits["FINAL_REUSED"] + holdout)
    post = {}
    for name, cost in v50.SCENARIOS.items():
        post[name] = metrics_for(candidate, raw, cost, post_development)["metrics"]

    custom_costs = {
        str(int(cost)): {
            "full": metrics_for(candidate, raw, cost, target)["metrics"],
            "postDevelopment": metrics_for(candidate, raw, cost, post_development)["metrics"],
        }
        for cost in CUSTOM_COSTS
    }

    leave_one_symbol_out = {}
    for symbol in v50.v14.SYMBOLS:
        filtered = [row for row in raw if str(row["symbol"]) != symbol]
        leave_one_symbol_out[symbol] = {
            "fullNormal": metrics_for(candidate, filtered, v50.SCENARIOS["NORMAL"], target)["metrics"],
            "fullP95": metrics_for(candidate, filtered, v50.SCENARIOS["P95"], target)["metrics"],
            "postNormal": metrics_for(candidate, filtered, v50.SCENARIOS["NORMAL"], post_development)["metrics"],
            "postP95": metrics_for(candidate, filtered, v50.SCENARIOS["P95"], post_development)["metrics"],
        }

    window_ablation = {}
    for window in ("POST_1130", "POST_1230", "POST_1330", "POST_1430"):
        filtered = [row for row in raw if str(row["route"]) != window]
        window_ablation[window] = {
            "fullNormal": metrics_for(candidate, filtered, v50.SCENARIOS["NORMAL"], target)["metrics"],
            "fullP95": metrics_for(candidate, filtered, v50.SCENARIOS["P95"], target)["metrics"],
            "postNormal": metrics_for(candidate, filtered, v50.SCENARIOS["NORMAL"], post_development)["metrics"],
            "postP95": metrics_for(candidate, filtered, v50.SCENARIOS["P95"], post_development)["metrics"],
        }

    monthly_normal = monthly_metrics(candidate, raw, v50.SCENARIOS["NORMAL"], target)
    monthly_p95 = monthly_metrics(candidate, raw, v50.SCENARIOS["P95"], target)
    positive_post_blocks = sum(
        audit[name]["NORMAL"]["compoundedReturnPct"] > 0 and audit[name]["P95"]["compoundedReturnPct"] > 0
        for name in ("validation", "finalReused", "holdout")
    )

    checks = {
        "selectedUsingDevelopmentOnly": True,
        "fullStandaloneNormalAtLeast50Pct": audit["full"]["NORMAL"]["compoundedReturnPct"] >= 50.0,
        "fullStandaloneP95AtLeast30Pct": audit["full"]["P95"]["compoundedReturnPct"] >= 30.0,
        "fullNormalProfitFactorAtLeast1_5": (audit["full"]["NORMAL"]["profitFactor"] or 0.0) >= 1.5,
        "fullNormalDrawdownNoWorseThanMinus15Pct": audit["full"]["NORMAL"]["maxDrawdownPct"] >= -15.0,
        "fullNormalMinimumFiftyTrades": audit["full"]["NORMAL"]["trades"] >= 50,
        "postDevelopmentMinimumTwentyTrades": post["NORMAL"]["trades"] >= 20,
        "postDevelopmentNormalAndP95Positive": post["NORMAL"]["compoundedReturnPct"] > 0 and post["P95"]["compoundedReturnPct"] > 0,
        "postDevelopmentNormalProfitFactorAtLeast1_2": (post["NORMAL"]["profitFactor"] or 0.0) >= 1.2,
        "postDevelopmentDrawdownNoWorseThanMinus10Pct": post["NORMAL"]["maxDrawdownPct"] >= -10.0,
        "allThreePostSelectionBlocksPositive": positive_post_blocks == 3,
        "validationPositiveDespiteOriginalCountFailure": audit["validation"]["NORMAL"]["compoundedReturnPct"] > 0 and audit["validation"]["P95"]["compoundedReturnPct"] > 0,
        "cost50FullAndPostPositive": custom_costs["50"]["full"]["compoundedReturnPct"] > 0 and custom_costs["50"]["postDevelopment"]["compoundedReturnPct"] > 0,
        "cost60FullAndPostPositive": custom_costs["60"]["full"]["compoundedReturnPct"] > 0 and custom_costs["60"]["postDevelopment"]["compoundedReturnPct"] > 0,
        "everyLeaveOneSymbolOutFullPositive": all(row["fullNormal"]["compoundedReturnPct"] > 0 and row["fullP95"]["compoundedReturnPct"] > 0 for row in leave_one_symbol_out.values()),
        "everyLeaveOneSymbolOutPostPositive": all(row["postNormal"]["compoundedReturnPct"] > 0 and row["postP95"]["compoundedReturnPct"] > 0 for row in leave_one_symbol_out.values()),
        "atLeastThreeWindowAblationsFullPositive": sum(row["fullNormal"]["compoundedReturnPct"] > 0 and row["fullP95"]["compoundedReturnPct"] > 0 for row in window_ablation.values()) >= 3,
        "atLeastThreeWindowAblationsPostPositive": sum(row["postNormal"]["compoundedReturnPct"] > 0 and row["postP95"]["compoundedReturnPct"] > 0 for row in window_ablation.values()) >= 3,
        "originalRemovalAndConcentrationChecksPassed": all(audit["checks"][key] for key in (
            "positiveProfitConcentrationAtMost40Pct",
            "bestTradeRemovedNormalAndP95Positive",
            "bestMonthRemovedNormalAndP95Positive",
            "severeFailClosedNonnegative",
        )),
    }
    passed = all(checks.values())
    status = (
        "ASTER_ONLY_V51_FROZEN_DEVELOPMENT_LEADER_EXTENDED_POST_SELECTION_PASS_SHADOW_ONLY"
        if passed
        else "ASTER_ONLY_V51_FROZEN_DEVELOPMENT_LEADER_STRESS_FAIL"
    )
    return v50.v14.rounded({
        "version": 51,
        "strategyId": STRATEGY_ID,
        "status": status,
        "selectedCandidate": asdict(candidate),
        "selection": {
            "method": "MAX_DEVELOPMENT_NORMAL_PLUS_P95_AMONG_PREDECLARED_DEVELOPMENT_SURVIVORS",
            "developmentCandidateCount": len(development_candidates),
            "developmentScore": selected["score"],
            "validationFinalHoldoutUsedForSelection": False,
        },
        "baseAudit": audit,
        "postDevelopment": post,
        "postDevelopmentSessions": len(post_development),
        "customCosts": custom_costs,
        "leaveOneSymbolOut": leave_one_symbol_out,
        "windowAblation": window_ablation,
        "monthlyNormal": monthly_normal,
        "monthlyP95": monthly_p95,
        "checks": checks,
        "allChecksPassed": passed,
        "originalV50ValidationMinimumEightPassed": audit["checks"]["validationMinimumEightTrades"],
        "interpretation": {
            "v50OriginalGateOverridden": False,
            "productionPromotionAllowed": False,
            "classification": "HISTORICAL_EXTENDED_POST_SELECTION_AUDIT_ONLY",
        },
        "data": aligned_diag,
        "safety": safety(),
    })


def safety() -> dict:
    return {
        "mode": "RESEARCH_ONLY",
        "orderSubmissionAllowed": False,
        "productionChanged": False,
        "liveChanged": False,
        "vpsChanged": False,
        "cryptoV96Changed": False,
        "v11EqChanged": False,
        "v19Changed": False,
        "v48Changed": False,
        "v50ProductionChanged": False,
    }


def report(result: dict) -> str:
    lines = [
        "# Aster-only V51 Frozen Development Leader Audit",
        "",
        f"Status: **{result['status']}**",
        "",
    ]
    if "selectedCandidate" not in result:
        lines.append("No Development leader existed.")
        return "\n".join(lines)
    lines += [
        f"Candidate: `{result['selectedCandidate']['candidate_id']}`",
        f"Development candidates: {result['selection']['developmentCandidateCount']}",
        "",
        "## Standalone full year",
        "",
    ]
    for name, row in result["baseAudit"]["full"].items():
        lines.append(f"- {name}: {row['compoundedReturnPct']:.6f}% / PF {row['profitFactor']} / DD {row['maxDrawdownPct']:.6f}% / {row['trades']} trades")
    lines += ["", "## Combined post-Development", ""]
    for name, row in result["postDevelopment"].items():
        lines.append(f"- {name}: {row['compoundedReturnPct']:.6f}% / PF {row['profitFactor']} / DD {row['maxDrawdownPct']:.6f}% / {row['trades']} trades")
    lines += [
        "",
        f"Original V50 Validation >=8 check: {result['originalV50ValidationMinimumEightPassed']}",
        f"Extended checks passed: {result['allChecksPassed']}",
        "",
        "This audit does not override the original V50 failure and does not authorize Production.",
        "",
    ]
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-dir", default="../.cache/aster-only-v39-overnight-open")
    parser.add_argument("--output-dir", default="../.research-state/aster-only-v51-frozen-development-leader")
    args = parser.parse_args()
    output = Path(args.output_dir).resolve()
    output.mkdir(parents=True, exist_ok=True)
    result = analyze(Path(args.cache_dir).resolve())
    (output / "result.json").write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (output / "report.md").write_text(report(result), encoding="utf-8")
    print(json.dumps({
        "status": result["status"],
        "selectedCandidate": result.get("selectedCandidate"),
        "full": result.get("baseAudit", {}).get("full"),
        "postDevelopment": result.get("postDevelopment"),
        "checks": result.get("checks"),
    }, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
