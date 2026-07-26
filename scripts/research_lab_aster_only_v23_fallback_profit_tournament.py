from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import research_lab_aster_only_v14_replacement_tournament as v14
import research_lab_aster_only_v15_intraday_shock_tournament as v15
import research_lab_aster_only_v19_trailing_one_year_bt as v19
import research_lab_aster_only_v20_strict_hurdle_tournament as v20
import research_lab_aster_only_v22_v11eq_primary_v19_fallback as v22

STRATEGY_ID = "DISDEX_ASTER_ONLY_V23_DEDICATED_FALLBACK_PROFIT_TOURNAMENT"
SCENARIOS = v14.SCENARIOS
MAX_DEVELOPMENT_SURVIVORS = 40
MIN_VALIDATION_ROUTER_TRADES = 8
MIN_VALIDATION_FALLBACK_TRADES = 4


def finite(value: Any, fallback: float = 0.0) -> float:
    return v14.finite(value, fallback)


def candidate_dict(candidate: v15.Candidate) -> dict:
    return {
        "candidateId": candidate.candidate_id,
        "family": candidate.family,
        "threshold": candidate.threshold,
        "entryPolicy": candidate.entry_policy,
        "maximumHoldingHours": candidate.maximum_holding_hours,
        "previousSymbolCooldown": candidate.previous_symbol_cooldown,
    }


def build_candidate_rows(
    candidate: v15.Candidate,
    warmup_days: Sequence[str],
    features: Dict[str, dict],
) -> List[dict]:
    return [
        {
            **row,
            "strategy": "V23_FALLBACK_CANDIDATE",
            "fallbackCandidateId": candidate.candidate_id,
        }
        for row in v15.build_trades(candidate, warmup_days, features)
    ]


def scenario_summary(
    v11_rows: Sequence[dict],
    fallback_rows: Sequence[dict],
    days: Sequence[str],
) -> Tuple[dict, dict]:
    return v22.scenario_set(v11_rows, fallback_rows, days, True)


def fallback_component(
    v11_rows: Sequence[dict],
    fallback_rows: Sequence[dict],
    days: Sequence[str],
    cost_bps: float,
) -> dict:
    events, _stats = v22.route(v11_rows, fallback_rows, cost_bps, days, True)
    selected = [row for row in events if row.get("route") == "V19_FALLBACK"]
    return v22.metrics(selected)


def development_pass(
    result: dict,
    routing: dict,
    v11_only: dict,
) -> bool:
    normal = result["NORMAL"]
    p95 = result["P95"]
    normal_count = int(routing["NORMAL"].get("V19_FALLBACK_SELECTED", 0))
    return bool(
        normal_count >= 8
        and normal["compoundedReturnPct"] > v11_only["NORMAL"]["compoundedReturnPct"]
        and p95["compoundedReturnPct"] > v11_only["P95"]["compoundedReturnPct"]
        and (normal["profitFactor"] or 0.0) >= 1.30
        and normal["maxDrawdownPct"] >= -8.0
        and result["SEVERE"]["compoundedReturnPct"] >= 0
    )


def validation_pass(
    result: dict,
    routing: dict,
    v11_only: dict,
) -> bool:
    normal = result["NORMAL"]
    p95 = result["P95"]
    fallback_count = int(routing["NORMAL"].get("V19_FALLBACK_SELECTED", 0))
    return bool(
        normal["trades"] >= MIN_VALIDATION_ROUTER_TRADES
        and fallback_count >= MIN_VALIDATION_FALLBACK_TRADES
        and normal["compoundedReturnPct"] > v11_only["NORMAL"]["compoundedReturnPct"]
        and p95["compoundedReturnPct"] > v11_only["P95"]["compoundedReturnPct"]
        and normal["compoundedReturnPct"] > 0
        and p95["compoundedReturnPct"] > 0
        and (normal["profitFactor"] or 0.0) >= 1.20
        and normal["maxDrawdownPct"] >= -5.0
        and result["SEVERE"]["compoundedReturnPct"] >= 0
    )


def selection_score(result: dict, routing: dict, v11_only: dict) -> float:
    normal = result["NORMAL"]
    p95 = result["P95"]
    normal_improvement = normal["compoundedReturnPct"] - v11_only["NORMAL"]["compoundedReturnPct"]
    p95_improvement = p95["compoundedReturnPct"] - v11_only["P95"]["compoundedReturnPct"]
    fallback_count = int(routing["NORMAL"].get("V19_FALLBACK_SELECTED", 0))
    return (
        normal_improvement
        + p95_improvement
        + 0.05 * normal["netBpsPerCapitalHour"]
        + 0.02 * fallback_count
        - 0.25 * abs(normal["maxDrawdownPct"])
    )


def diagnostic_row(
    candidate: v15.Candidate,
    development: dict,
    development_routing: dict,
    validation: dict,
    validation_routing: dict,
    dev_v11_only: dict,
    val_v11_only: dict,
) -> dict:
    return {
        "candidate": candidate_dict(candidate),
        "development": development,
        "developmentRouting": development_routing,
        "developmentPass": development_pass(development, development_routing, dev_v11_only),
        "developmentScore": selection_score(development, development_routing, dev_v11_only),
        "validation": validation,
        "validationRouting": validation_routing,
        "validationPass": validation_pass(validation, validation_routing, val_v11_only),
        "validationScore": selection_score(validation, validation_routing, val_v11_only),
    }


def improvement_checks(selected: dict, baseline: dict, selected_fallback: dict, baseline_fallback: dict) -> dict:
    selected_normal = selected["full"]["NORMAL"]
    selected_p95 = selected["full"]["P95"]
    baseline_normal = baseline["full"]["NORMAL"]
    baseline_p95 = baseline["full"]["P95"]
    return {
        "selectedPassesExistingV22StrictHurdles": selected["allStrictHurdlesPassed"],
        "annualNormalImprovesV19FallbackRouter": (
            selected_normal["compoundedReturnPct"] > baseline_normal["compoundedReturnPct"]
        ),
        "annualP95ImprovesV19FallbackRouter": (
            selected_p95["compoundedReturnPct"] > baseline_p95["compoundedReturnPct"]
        ),
        "fallbackComponentNormalImproves": (
            selected_fallback["NORMAL"]["compoundedReturnPct"]
            > baseline_fallback["NORMAL"]["compoundedReturnPct"]
        ),
        "fallbackComponentP95Improves": (
            selected_fallback["P95"]["compoundedReturnPct"]
            > baseline_fallback["P95"]["compoundedReturnPct"]
        ),
        "normalDrawdownNotWorseByMoreThanOnePoint": (
            selected_normal["maxDrawdownPct"] >= baseline_normal["maxDrawdownPct"] - 1.0
        ),
        "normalProfitFactorAtLeast1_5": (selected_normal["profitFactor"] or 0.0) >= 1.50,
        "positiveProfitConcentrationAtMost40Pct": (
            selected_normal["maximumPositiveProfitSymbolShare"] <= 0.40
        ),
    }


def analyze(cache_root: Path) -> dict:
    v14.base.verify_source(v14.base.V11_ROOT, v14.base.V11_SOURCE_SHA)
    v14.base.verify_source(v14.base.V13_ROOT, v14.base.V13_SOURCE_SHA)
    v19.configure_exact_data_window()

    days, aligned, diagnostics = v19.v17.load_all(cache_root)
    warmup = [
        day for day in days
        if v19.WARMUP_START.date().isoformat() <= day < v19.BT_END_DAY_EXCLUSIVE
    ]
    target = [day for day in warmup if v19.BT_START_DAY <= day < v19.BT_END_DAY_EXCLUSIVE]
    pre_holdout = [day for day in target if day < v20.HOLDOUT_START_DAY]
    holdout = [day for day in target if day >= v20.HOLDOUT_START_DAY]
    splits = v14.split_days(pre_holdout)
    development_days = splits["DEVELOPMENT"]
    validation_days = splits["VALIDATION"]
    final_days = splits["FINAL_REUSED"]

    v11_rows, v11_diagnostics = v22.build_v11eq(warmup, aligned)
    features = v15.build_slot_features(warmup, aligned)
    baseline_rows = v22.build_fallback(warmup, aligned)

    empty_rows: List[dict] = []
    dev_v11_only, _ = v22.scenario_set(v11_rows, empty_rows, development_days, False)
    val_v11_only, _ = v22.scenario_set(v11_rows, empty_rows, validation_days, False)

    development_survivors = []
    for candidate in v15.CANDIDATES:
        rows = build_candidate_rows(candidate, warmup, features)
        development, development_routing = scenario_summary(v11_rows, rows, development_days)
        if not development_pass(development, development_routing, dev_v11_only):
            continue
        development_survivors.append({
            "candidate": candidate,
            "rows": rows,
            "development": development,
            "developmentRouting": development_routing,
            "developmentScore": selection_score(development, development_routing, dev_v11_only),
        })

    development_survivors.sort(
        key=lambda row: (-row["developmentScore"], row["candidate"].candidate_id)
    )
    development_survivors = development_survivors[:MAX_DEVELOPMENT_SURVIVORS]

    validated = []
    diagnostics_rows = []
    for row in development_survivors:
        validation, validation_routing = scenario_summary(
            v11_rows, row["rows"], validation_days
        )
        diag = diagnostic_row(
            row["candidate"], row["development"], row["developmentRouting"],
            validation, validation_routing, dev_v11_only, val_v11_only,
        )
        diagnostics_rows.append(diag)
        if diag["validationPass"]:
            validated.append({
                **row,
                "validation": validation,
                "validationRouting": validation_routing,
                "validationScore": diag["validationScore"],
            })

    validated.sort(
        key=lambda row: (
            -row["validationScore"],
            -row["developmentScore"],
            row["candidate"].candidate_id,
        )
    )
    selected = validated[0] if validated else None

    baseline_audit = v22.audit(
        v11_rows, baseline_rows, target, development_days, validation_days,
        final_days, holdout, True,
    )
    baseline_fallback = {
        name: fallback_component(v11_rows, baseline_rows, target, cost)
        for name, cost in SCENARIOS.items()
    }

    if selected is None:
        status = "ASTER_ONLY_V23_NO_VALIDATED_FALLBACK_IMPROVEMENT"
        return v14.rounded({
            "version": 23,
            "strategyId": STRATEGY_ID,
            "status": status,
            "period": {
                "startInclusiveUtc": v19.BT_START.isoformat(),
                "endExclusiveUtc": v19.BT_END_EXCLUSIVE.isoformat(),
                "calendarDays": 365,
                "sessions": len(target),
            },
            "candidateUniverse": len(v15.CANDIDATES),
            "developmentSurvivors": len(development_survivors),
            "validationSurvivors": 0,
            "baselineV19Router": baseline_audit,
            "baselineV19FallbackComponent": baseline_fallback,
            "topDiagnostics": diagnostics_rows[:20],
            "selectionDiscipline": {
                "candidateGridPredeclared": True,
                "developmentMaximumSurvivors": MAX_DEVELOPMENT_SURVIVORS,
                "validationSelectsAtMostOne": True,
                "finalAndHoldoutUsedForSelection": False,
                "v11EqParametersChanged": False,
                "v19BaselineParametersChanged": False,
                "productionPromotionAllowed": False,
            },
            "data": diagnostics,
            "v11Diagnostics": v11_diagnostics,
            "safety": {
                "mode": "RESEARCH_ONLY",
                "orderSubmissionAllowed": False,
                "productionChanged": False,
                "liveChanged": False,
                "vpsChanged": False,
                "cryptoV96Changed": False,
                "v11EqChanged": False,
                "v13dProductionChanged": False,
            },
        })

    selected_audit = v22.audit(
        v11_rows, selected["rows"], target, development_days, validation_days,
        final_days, holdout, True,
    )
    selected_fallback = {
        name: fallback_component(v11_rows, selected["rows"], target, cost)
        for name, cost in SCENARIOS.items()
    }
    checks = improvement_checks(
        selected_audit, baseline_audit, selected_fallback, baseline_fallback
    )
    all_checks = all(checks.values())
    status = (
        "ASTER_ONLY_V23_FALLBACK_STRICT_IMPROVEMENT_SHADOW_ONLY"
        if all_checks
        else "ASTER_ONLY_V23_VALIDATED_CANDIDATE_DID_NOT_STRICTLY_IMPROVE"
    )

    return v14.rounded({
        "version": 23,
        "strategyId": STRATEGY_ID,
        "status": status,
        "period": {
            "startInclusiveUtc": v19.BT_START.isoformat(),
            "endExclusiveUtc": v19.BT_END_EXCLUSIVE.isoformat(),
            "calendarDays": 365,
            "sessions": len(target),
            "developmentSessions": len(development_days),
            "validationSessions": len(validation_days),
            "finalReusedSessions": len(final_days),
            "holdoutSessions": len(holdout),
        },
        "candidateUniverse": len(v15.CANDIDATES),
        "developmentSurvivors": len(development_survivors),
        "validationSurvivors": len(validated),
        "selectedCandidate": candidate_dict(selected["candidate"]),
        "baselineV19Router": baseline_audit,
        "selectedRouter": selected_audit,
        "baselineV19FallbackComponent": baseline_fallback,
        "selectedFallbackComponent": selected_fallback,
        "improvementChecks": checks,
        "allImprovementChecksPassed": all_checks,
        "topDiagnostics": diagnostics_rows[:20],
        "selectionDiscipline": {
            "candidateGridPredeclared": True,
            "developmentMaximumSurvivors": MAX_DEVELOPMENT_SURVIVORS,
            "validationSelectsAtMostOne": True,
            "finalAndHoldoutUsedForSelection": False,
            "v11EqParametersChanged": False,
            "v19BaselineParametersChanged": False,
            "selectedCandidateRetunedAfterValidation": False,
            "productionPromotionAllowed": False,
        },
        "architecture": {
            "venue": "ASTER_ONLY",
            "hyperliquidUsed": False,
            "primary": "Frozen V11-EQ at 10:30 New York",
            "fallback": "One frozen V15-family causal candidate only when V11-EQ is not accepted",
            "maximumOneStockPositionPerDay": True,
            "maximumGross": 1.0,
            "maximumFallbackHoldingHours": 2,
        },
        "limitations": [
            "The fallback families and thresholds were previously explored on overlapping history.",
            "Final and July results are reused diagnostics, not a new independent Holdout.",
            "Cash history is Yahoo 60-minute data rather than historical Pyth ticks.",
            "Aster history is candle and Funding data without exact historical spread or fill reconstruction.",
            "Any passing result remains Forward-Shadow only until untouched live no-order evidence accumulates.",
        ],
        "data": diagnostics,
        "v11Diagnostics": v11_diagnostics,
        "safety": {
            "mode": "RESEARCH_ONLY",
            "orderSubmissionAllowed": False,
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "cryptoV96Changed": False,
            "v11EqChanged": False,
            "v13dProductionChanged": False,
        },
    })


def report(result: dict) -> str:
    lines = [
        "# Aster-only V23 Dedicated Fallback Profit Tournament",
        "",
        f"Status: **{result['status']}**",
        "",
        f"Candidate universe: {result['candidateUniverse']}",
        f"Development survivors: {result['developmentSurvivors']}",
        f"Validation survivors: {result['validationSurvivors']}",
        "",
    ]
    baseline = result["baselineV19Router"]["full"]
    lines += [
        "## Baseline V19 router",
        "",
        f"- Normal: {baseline['NORMAL']['compoundedReturnPct']:.6f}% / PF {baseline['NORMAL']['profitFactor']} / DD {baseline['NORMAL']['maxDrawdownPct']:.6f}% / {baseline['NORMAL']['trades']} trades",
        f"- P95: {baseline['P95']['compoundedReturnPct']:.6f}% / PF {baseline['P95']['profitFactor']} / DD {baseline['P95']['maxDrawdownPct']:.6f}% / {baseline['P95']['trades']} trades",
        "",
    ]
    if "selectedCandidate" in result:
        selected = result["selectedRouter"]["full"]
        lines += [
            "## Selected fallback",
            "",
            f"Candidate: `{result['selectedCandidate']['candidateId']}`",
            f"- Normal: {selected['NORMAL']['compoundedReturnPct']:.6f}% / PF {selected['NORMAL']['profitFactor']} / DD {selected['NORMAL']['maxDrawdownPct']:.6f}% / {selected['NORMAL']['trades']} trades",
            f"- P95: {selected['P95']['compoundedReturnPct']:.6f}% / PF {selected['P95']['profitFactor']} / DD {selected['P95']['maxDrawdownPct']:.6f}% / {selected['P95']['trades']} trades",
            "",
            "## Improvement checks",
            "",
        ]
        for key, value in result["improvementChecks"].items():
            lines.append(f"- {key}: {value}")
    else:
        lines += [
            "No candidate passed the frozen chronological Validation gate.",
        ]
    lines += [
        "",
        "Research only. Production, LIVE, VPS, credentials, orders and positions were not changed.",
        "",
    ]
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-dir", required=True)
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()
    output = Path(args.output_dir).resolve()
    output.mkdir(parents=True, exist_ok=True)
    result = analyze(Path(args.cache_dir).resolve())
    (output / "result.json").write_text(
        json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    (output / "report.md").write_text(report(result), encoding="utf-8")
    print(json.dumps({
        "status": result["status"],
        "candidateUniverse": result["candidateUniverse"],
        "developmentSurvivors": result["developmentSurvivors"],
        "validationSurvivors": result["validationSurvivors"],
        "selectedCandidate": result.get("selectedCandidate"),
        "baselineNormal": result["baselineV19Router"]["full"]["NORMAL"],
        "selectedNormal": result.get("selectedRouter", {}).get("full", {}).get("NORMAL"),
    }, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
