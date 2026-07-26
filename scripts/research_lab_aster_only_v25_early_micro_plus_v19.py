from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Dict, List, Sequence, Tuple

import research_lab_aster_only_v14_replacement_tournament as v14
import research_lab_aster_only_v15_intraday_shock_tournament as v15
import research_lab_aster_only_v19_trailing_one_year_bt as v19
import research_lab_aster_only_v20_strict_hurdle_tournament as v20
import research_lab_aster_only_v22_v11eq_primary_v19_fallback as v22

STRATEGY_ID = "DISDEX_ASTER_ONLY_V25_EARLY_MICRO_PLUS_V19"
SCENARIOS = v14.SCENARIOS
MAX_DEVELOPMENT_SURVIVORS = 20
MIN_VALIDATION_ROUTER_TRADES = 8
MIN_VALIDATION_MICRO_TRADES = 4
DAILY_LOSS_LOCK = -0.02
MICRO_CANDIDATES = tuple(
    candidate for candidate in v15.CANDIDATES
    if candidate.entry_policy == "SLOT_1130"
    and candidate.maximum_holding_hours == 1
)


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


def build_micro_rows(
    candidate: v15.Candidate,
    warmup_days: Sequence[str],
    features: Dict[str, dict],
) -> List[dict]:
    rows = []
    for row in v15.build_trades(candidate, warmup_days, features):
        rows.append({
            **row,
            "strategy": "V25_EARLY_MICRO_FALLBACK",
            "microCandidateId": candidate.candidate_id,
        })
    return rows


def combined_route(
    v11_rows: Sequence[dict],
    v19_rows: Sequence[dict],
    micro_rows: Sequence[dict],
    cost_bps: float,
    days: Sequence[str],
) -> Tuple[List[dict], dict]:
    allowed = set(days)
    by11 = {str(row["day"]): row for row in v11_rows if str(row["day"]) in allowed}
    by19 = {str(row["day"]): row for row in v19_rows if str(row["day"]) in allowed}
    by_micro = {str(row["day"]): row for row in micro_rows if str(row["day"]) in allowed}
    events: List[dict] = []
    stats: Counter = Counter()

    for day in sorted(allowed):
        primary = by11.get(day)
        if primary is not None:
            value = v22.trade_value(primary, cost_bps)
            if value is not None:
                events.append({**primary, "netReturn": value, "route": "V11_EQ_PRIMARY"})
                stats["V11_EQ_SELECTED"] += 1
                continue
            stats["V11_EQ_COST_GATE_REJECTED"] += 1

        daily_return = 0.0
        micro = by_micro.get(day)
        if micro is not None:
            value = v22.trade_value(micro, cost_bps)
            if value is not None:
                events.append({
                    **micro,
                    "netReturn": value,
                    "route": "V25_EARLY_MICRO_FALLBACK",
                })
                stats["V25_EARLY_MICRO_SELECTED"] += 1
                daily_return = (1.0 + daily_return) * (1.0 + value) - 1.0
            else:
                stats["V25_EARLY_MICRO_COST_GATE_REJECTED"] += 1

        baseline = by19.get(day)
        if baseline is None:
            continue
        if daily_return <= DAILY_LOSS_LOCK:
            stats["DAILY_LOSS_LOCK_BLOCKED_V19"] += 1
            continue
        if micro is not None and any(
            row.get("day") == day and row.get("route") == "V25_EARLY_MICRO_FALLBACK"
            for row in events[-1:]
        ):
            if int(micro["exitTs"]) > int(baseline["entryTs"]):
                stats["OVERLAP_BLOCKED_V19"] += 1
                continue
        value = v22.trade_value(baseline, cost_bps)
        if value is not None:
            events.append({**baseline, "netReturn": value, "route": "V19_FALLBACK"})
            stats["V19_FALLBACK_SELECTED"] += 1
        else:
            stats["V19_FALLBACK_COST_GATE_REJECTED"] += 1

    return sorted(events, key=lambda row: (int(row["entryTs"]), int(row["exitTs"]))), dict(stats)


def scenario_set(
    v11_rows: Sequence[dict],
    v19_rows: Sequence[dict],
    micro_rows: Sequence[dict],
    days: Sequence[str],
) -> Tuple[dict, dict]:
    results, routing = {}, {}
    for name, cost in SCENARIOS.items():
        events, stats = combined_route(v11_rows, v19_rows, micro_rows, cost, days)
        results[name] = v22.metrics(events)
        routing[name] = stats
    return results, routing


def route_component(
    v11_rows: Sequence[dict],
    v19_rows: Sequence[dict],
    micro_rows: Sequence[dict],
    days: Sequence[str],
    cost_bps: float,
    route_name: str,
) -> dict:
    events, _stats = combined_route(v11_rows, v19_rows, micro_rows, cost_bps, days)
    return v22.metrics([row for row in events if row.get("route") == route_name])


def audit(
    v11_rows: Sequence[dict],
    v19_rows: Sequence[dict],
    micro_rows: Sequence[dict],
    target: Sequence[str],
    development: Sequence[str],
    validation: Sequence[str],
    final: Sequence[str],
    holdout: Sequence[str],
) -> dict:
    full, routing = scenario_set(v11_rows, v19_rows, micro_rows, target)
    dev, _ = scenario_set(v11_rows, v19_rows, micro_rows, development)
    val, _ = scenario_set(v11_rows, v19_rows, micro_rows, validation)
    fin, _ = scenario_set(v11_rows, v19_rows, micro_rows, final)
    hol, _ = scenario_set(v11_rows, v19_rows, micro_rows, holdout)
    normal_events, _ = combined_route(
        v11_rows, v19_rows, micro_rows, SCENARIOS["NORMAL"], target
    )
    p95_events, _ = combined_route(
        v11_rows, v19_rows, micro_rows, SCENARIOS["P95"], target
    )
    normal_month_events, normal_month = v22.remove_best_month(normal_events)
    p95_month_events, p95_month = v22.remove_best_month(p95_events)
    normal, p95 = full["NORMAL"], full["P95"]
    checks = {
        "developmentNormalAndP95Positive": (
            dev["NORMAL"]["compoundedReturnPct"] > 0
            and dev["P95"]["compoundedReturnPct"] > 0
        ),
        "validationMinimumEightNormalTrades": val["NORMAL"]["trades"] >= 8,
        "validationNormalProfitFactorAtLeast1_2": (
            val["NORMAL"]["profitFactor"] or 0.0
        ) >= 1.20,
        "validationNormalAndP95Positive": (
            val["NORMAL"]["compoundedReturnPct"] > 0
            and val["P95"]["compoundedReturnPct"] > 0
        ),
        "finalReusedNormalAndP95Positive": (
            fin["NORMAL"]["compoundedReturnPct"] > 0
            and fin["P95"]["compoundedReturnPct"] > 0
        ),
        "holdoutMinimumTrades": (
            hol["NORMAL"]["trades"] >= v20.STRICT_HURDLES["minimumHoldoutTrades"]
        ),
        "holdoutNormalAndP95Positive": (
            hol["NORMAL"]["compoundedReturnPct"] > 0
            and hol["P95"]["compoundedReturnPct"] > 0
        ),
        "normalReturnAtLeast50Pct": normal["compoundedReturnPct"] >= 50.0,
        "p95ReturnAtLeast30Pct": p95["compoundedReturnPct"] >= 30.0,
        "normalProfitFactorAtLeast1_5": (normal["profitFactor"] or 0.0) >= 1.50,
        "normalDrawdownNoWorseThanMinus15Pct": normal["maxDrawdownPct"] >= -15.0,
        "normalMinimumFiftyTrades": normal["trades"] >= 50,
        "positiveProfitConcentrationAtMost40Pct": (
            normal["maximumPositiveProfitSymbolShare"] <= 0.40
        ),
        "bestTradeRemovedNormalAndP95Positive": (
            v22.metrics(v22.remove_best(normal_events))["compoundedReturnPct"] > 0
            and v22.metrics(v22.remove_best(p95_events))["compoundedReturnPct"] > 0
        ),
        "bestMonthRemovedNormalAndP95Positive": (
            v22.metrics(normal_month_events)["compoundedReturnPct"] > 0
            and v22.metrics(p95_month_events)["compoundedReturnPct"] > 0
        ),
        "severeFailClosedNonnegative": full["SEVERE"]["compoundedReturnPct"] >= 0,
    }
    return {
        "full": full,
        "development": dev,
        "validation": val,
        "finalReused": fin,
        "holdout": hol,
        "routing": routing,
        "checks": checks,
        "allStrictHurdlesPassed": all(checks.values()),
        "robustness": {
            "normalBestTradeRemoved": v22.metrics(v22.remove_best(normal_events)),
            "p95BestTradeRemoved": v22.metrics(v22.remove_best(p95_events)),
            "normalBestMonthRemoved": {
                "month": normal_month,
                "metrics": v22.metrics(normal_month_events),
            },
            "p95BestMonthRemoved": {
                "month": p95_month,
                "metrics": v22.metrics(p95_month_events),
            },
        },
    }


def development_pass(result: dict, routing: dict, baseline: dict) -> bool:
    normal, p95 = result["NORMAL"], result["P95"]
    micro_count = int(routing["NORMAL"].get("V25_EARLY_MICRO_SELECTED", 0))
    return bool(
        micro_count >= 6
        and normal["compoundedReturnPct"] > baseline["NORMAL"]["compoundedReturnPct"]
        and p95["compoundedReturnPct"] > baseline["P95"]["compoundedReturnPct"]
        and (normal["profitFactor"] or 0.0) >= 1.30
        and normal["maxDrawdownPct"] >= -8.0
        and result["SEVERE"]["compoundedReturnPct"] >= 0
    )


def validation_pass(result: dict, routing: dict, baseline: dict) -> bool:
    normal, p95 = result["NORMAL"], result["P95"]
    micro_count = int(routing["NORMAL"].get("V25_EARLY_MICRO_SELECTED", 0))
    return bool(
        normal["trades"] >= MIN_VALIDATION_ROUTER_TRADES
        and micro_count >= MIN_VALIDATION_MICRO_TRADES
        and normal["compoundedReturnPct"] > baseline["NORMAL"]["compoundedReturnPct"]
        and p95["compoundedReturnPct"] > baseline["P95"]["compoundedReturnPct"]
        and normal["compoundedReturnPct"] > 0
        and p95["compoundedReturnPct"] > 0
        and (normal["profitFactor"] or 0.0) >= 1.20
        and normal["maxDrawdownPct"] >= -5.0
        and result["SEVERE"]["compoundedReturnPct"] >= 0
    )


def score(result: dict, routing: dict, baseline: dict) -> float:
    normal, p95 = result["NORMAL"], result["P95"]
    n_delta = normal["compoundedReturnPct"] - baseline["NORMAL"]["compoundedReturnPct"]
    p_delta = p95["compoundedReturnPct"] - baseline["P95"]["compoundedReturnPct"]
    micro_count = int(routing["NORMAL"].get("V25_EARLY_MICRO_SELECTED", 0))
    return (
        n_delta + p_delta
        + 0.05 * normal["netBpsPerCapitalHour"]
        + 0.02 * micro_count
        - 0.25 * abs(normal["maxDrawdownPct"])
    )


def monthly_route_counts(events: Sequence[dict]) -> dict:
    by_month: Dict[str, Counter] = defaultdict(Counter)
    for row in events:
        by_month[str(row["day"])[:7]][str(row["route"])] += 1
    return {month: dict(sorted(counts.items())) for month, counts in sorted(by_month.items())}


def improvement_checks(selected: dict, baseline: dict, micro_component: dict) -> dict:
    selected_normal, selected_p95 = selected["full"]["NORMAL"], selected["full"]["P95"]
    baseline_normal, baseline_p95 = baseline["full"]["NORMAL"], baseline["full"]["P95"]
    return {
        "selectedPassesStrictHurdles": selected["allStrictHurdlesPassed"],
        "annualNormalImprovesBaseline": (
            selected_normal["compoundedReturnPct"] > baseline_normal["compoundedReturnPct"]
        ),
        "annualP95ImprovesBaseline": (
            selected_p95["compoundedReturnPct"] > baseline_p95["compoundedReturnPct"]
        ),
        "microNormalPositive": micro_component["NORMAL"]["compoundedReturnPct"] > 0,
        "microP95Positive": micro_component["P95"]["compoundedReturnPct"] > 0,
        "finalNormalNotWorseThanBaseline": (
            selected["finalReused"]["NORMAL"]["compoundedReturnPct"]
            >= baseline["finalReused"]["NORMAL"]["compoundedReturnPct"]
        ),
        "finalP95NotWorseThanBaseline": (
            selected["finalReused"]["P95"]["compoundedReturnPct"]
            >= baseline["finalReused"]["P95"]["compoundedReturnPct"]
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

    days, aligned, data_diagnostics = v19.v17.load_all(cache_root)
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
    v19_rows = v22.build_fallback(warmup, aligned)
    features = v15.build_slot_features(warmup, aligned)
    empty_micro: List[dict] = []

    baseline_audit = audit(
        v11_rows, v19_rows, empty_micro, target, development_days,
        validation_days, final_days, holdout,
    )
    baseline_dev, _ = scenario_set(v11_rows, v19_rows, empty_micro, development_days)
    baseline_val, _ = scenario_set(v11_rows, v19_rows, empty_micro, validation_days)

    development_survivors = []
    for candidate in MICRO_CANDIDATES:
        rows = build_micro_rows(candidate, warmup, features)
        development, development_routing = scenario_set(
            v11_rows, v19_rows, rows, development_days
        )
        if not development_pass(development, development_routing, baseline_dev):
            continue
        development_survivors.append({
            "candidate": candidate,
            "rows": rows,
            "development": development,
            "developmentRouting": development_routing,
            "developmentScore": score(development, development_routing, baseline_dev),
        })

    development_survivors.sort(
        key=lambda row: (-row["developmentScore"], row["candidate"].candidate_id)
    )
    development_survivors = development_survivors[:MAX_DEVELOPMENT_SURVIVORS]

    validated = []
    diagnostics = []
    for row in development_survivors:
        validation, validation_routing = scenario_set(
            v11_rows, v19_rows, row["rows"], validation_days
        )
        passed = validation_pass(validation, validation_routing, baseline_val)
        validation_score = score(validation, validation_routing, baseline_val)
        diagnostics.append({
            "candidate": candidate_dict(row["candidate"]),
            "development": row["development"],
            "developmentRouting": row["developmentRouting"],
            "developmentScore": row["developmentScore"],
            "validation": validation,
            "validationRouting": validation_routing,
            "validationScore": validation_score,
            "validationPass": passed,
        })
        if passed:
            validated.append({
                **row,
                "validation": validation,
                "validationRouting": validation_routing,
                "validationScore": validation_score,
            })

    validated.sort(
        key=lambda row: (
            -row["validationScore"],
            -row["developmentScore"],
            row["candidate"].candidate_id,
        )
    )
    selected = validated[0] if validated else None

    base_result = {
        "version": 25,
        "strategyId": STRATEGY_ID,
        "period": {
            "startInclusiveUtc": v19.BT_START.isoformat(),
            "endExclusiveUtc": v19.BT_END_EXCLUSIVE.isoformat(),
            "calendarDays": 365,
            "sessions": len(target),
        },
        "candidateUniverse": len(MICRO_CANDIDATES),
        "developmentSurvivors": len(development_survivors),
        "validationSurvivors": len(validated),
        "baselineRouter": baseline_audit,
        "topDiagnostics": diagnostics[:20],
        "selectionDiscipline": {
            "microCandidateGridPredeclared": True,
            "v19RemainsEnabledAfterMicroExit": True,
            "developmentMaximumSurvivors": MAX_DEVELOPMENT_SURVIVORS,
            "validationSelectsAtMostOne": True,
            "finalAndHoldoutUsedForSelection": False,
            "v11EqParametersChanged": False,
            "v19ParametersChanged": False,
            "productionPromotionAllowed": False,
        },
        "architecture": {
            "venue": "ASTER_ONLY",
            "hyperliquidUsed": False,
            "v11EqPriority": True,
            "microEntry": "11:30 New York, maximum one hour",
            "v19Entry": "12:30 New York after micro exit, if eligible",
            "maximumConcurrentStockPositions": 1,
            "maximumSequentialFallbackTradesPerDay": 2,
            "maximumGross": 1.0,
            "dailyLossLockPct": DAILY_LOSS_LOCK * 100.0,
        },
        "data": data_diagnostics,
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
    }

    if selected is None:
        return v14.rounded({
            **base_result,
            "status": "ASTER_ONLY_V25_NO_VALIDATED_EARLY_MICRO",
        })

    selected_audit = audit(
        v11_rows, v19_rows, selected["rows"], target, development_days,
        validation_days, final_days, holdout,
    )
    micro_component = {
        name: route_component(
            v11_rows, v19_rows, selected["rows"], target, cost,
            "V25_EARLY_MICRO_FALLBACK",
        )
        for name, cost in SCENARIOS.items()
    }
    checks = improvement_checks(selected_audit, baseline_audit, micro_component)
    all_checks = all(checks.values())
    normal_events, _ = combined_route(
        v11_rows, v19_rows, selected["rows"], SCENARIOS["NORMAL"], target
    )
    status = (
        "ASTER_ONLY_V25_EARLY_MICRO_STRICT_IMPROVEMENT_SHADOW_ONLY"
        if all_checks
        else "ASTER_ONLY_V25_VALIDATED_EARLY_MICRO_NOT_STRICT_IMPROVEMENT"
    )
    return v14.rounded({
        **base_result,
        "status": status,
        "selectedCandidate": candidate_dict(selected["candidate"]),
        "selectedRouter": selected_audit,
        "selectedMicroComponent": micro_component,
        "improvementChecks": checks,
        "allImprovementChecksPassed": all_checks,
        "monthlyRouteCountsNormal": monthly_route_counts(normal_events),
        "limitations": [
            "The candidate families were previously explored on overlapping history.",
            "Final and July results are reused diagnostics rather than a new independent Holdout.",
            "Cash history is Yahoo 60-minute data rather than historical Pyth ticks.",
            "Aster history cannot reconstruct exact historical spread, queue or fill probability.",
            "Two sequential fallback trades increase operational complexity and require Forward-Shadow evidence.",
        ],
    })


def report(result: dict) -> str:
    baseline = result["baselineRouter"]["full"]
    lines = [
        "# Aster-only V25 Early Micro Plus V19",
        "",
        f"Status: **{result['status']}**",
        "",
        f"Candidate universe: {result['candidateUniverse']}",
        f"Development survivors: {result['developmentSurvivors']}",
        f"Validation survivors: {result['validationSurvivors']}",
        "",
        "## Baseline router",
        "",
        f"- Normal: {baseline['NORMAL']['compoundedReturnPct']:.6f}% / PF {baseline['NORMAL']['profitFactor']} / DD {baseline['NORMAL']['maxDrawdownPct']:.6f}% / {baseline['NORMAL']['trades']} trades",
        f"- P95: {baseline['P95']['compoundedReturnPct']:.6f}% / PF {baseline['P95']['profitFactor']} / DD {baseline['P95']['maxDrawdownPct']:.6f}% / {baseline['P95']['trades']} trades",
        "",
    ]
    if "selectedCandidate" in result:
        selected = result["selectedRouter"]["full"]
        lines += [
            "## Selected micro fallback",
            "",
            f"Candidate: `{result['selectedCandidate']['candidateId']}`",
            f"- Normal: {selected['NORMAL']['compoundedReturnPct']:.6f}% / PF {selected['NORMAL']['profitFactor']} / DD {selected['NORMAL']['maxDrawdownPct']:.6f}% / {selected['NORMAL']['trades']} trades",
            f"- P95: {selected['P95']['compoundedReturnPct']:.6f}% / PF {selected['P95']['profitFactor']} / DD {selected['P95']['maxDrawdownPct']:.6f}% / {selected['P95']['trades']} trades",
            "",
            "## Checks",
            "",
        ]
        for key, value in result["improvementChecks"].items():
            lines.append(f"- {key}: {value}")
    else:
        lines.append("No early micro candidate passed chronological Validation.")
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
        "baselineNormal": result["baselineRouter"]["full"]["NORMAL"],
        "selectedNormal": result.get("selectedRouter", {}).get("full", {}).get("NORMAL"),
    }, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
