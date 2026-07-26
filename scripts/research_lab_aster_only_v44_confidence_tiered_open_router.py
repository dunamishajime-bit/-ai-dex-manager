from __future__ import annotations

import argparse
import json
from collections import Counter
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import research_lab_aster_only_v39_overnight_open_router as v39
import research_lab_aster_only_v40_overnight_residual_router as v40
import research_lab_aster_only_v42_idiosyncratic_open_residual as v42
import research_lab_aster_only_v43_filtered_open_reversal as v43

STRATEGY_ID = "DISDEX_ASTER_ONLY_V44_CONFIDENCE_TIERED_OPEN_ROUTER"
SCENARIOS = v39.SCENARIOS
CORE = v42.Candidate(
    "R100__ONMAX100__OPENMAX10000__LONG_ONLY__REL_ANY__DOM1",
    100.0,
    100.0,
    10_000.0,
    "LONG_ONLY",
    "ANY",
    1.0,
)


@dataclass(frozen=True)
class Candidate:
    candidate_id: str
    reversal_confirmation_bps: float
    reversal_holding_hours: int
    reversal_direction: str
    reversal_overnight_cap_bps: float
    reversal_relation: str
    reversal_gross: float
    selection_policy: str


CANDIDATES: Tuple[Candidate, ...] = tuple(
    Candidate(
        f"REV_C{confirm:g}_H{hours}_{direction}_ONMAX{overnight:g}_REL_{relation}_G{gross:g}__{selection}",
        confirm,
        hours,
        direction,
        overnight,
        relation,
        gross,
        selection,
    )
    for confirm in (25.0, 75.0)
    for hours in (1, 2)
    for direction in ("BOTH", "LONG_ONLY")
    for overnight in (100.0, 150.0)
    for relation in ("ANY", "SAME_AS_BROAD", "OPPOSITE_BROAD")
    for gross in (0.25, 0.50, 0.75)
    for selection in ("CORE_FIRST", "MAX_EDGE")
)


def reversal_definition(candidate: Candidate) -> v43.Candidate:
    return v43.Candidate(
        candidate_id=candidate.candidate_id,
        minimum_confirmation_bps=candidate.reversal_confirmation_bps,
        maximum_holding_hours=candidate.reversal_holding_hours,
        direction_mode=candidate.reversal_direction,
        maximum_broad_overnight_bps=candidate.reversal_overnight_cap_bps,
        maximum_broad_first_hour_bps=10_000.0,
        first_hour_relation=candidate.reversal_relation,
    )


def scaled_value(row: dict, cost_bps: float, gross: float) -> Optional[float]:
    if cost_bps > v39.v14.MAX_OBSERVABLE_ROUND_TRIP_BPS:
        return None
    if v39.finite(row.get("edgeProxyBps")) - cost_bps < v39.v14.MIN_NET_EDGE_BPS:
        return None
    return gross * (v39.finite(row.get("grossReturn")) - cost_bps / 10_000.0)


def adjusted_row(row: dict, gross: float, value: float, route: str) -> dict:
    return {
        **row,
        "gross": gross,
        "holdingHours": gross * v39.finite(row.get("holdingHours")),
        "netReturn": value,
        "route": route,
    }


def choose_open(
    candidate: Candidate,
    core: Optional[dict],
    reversal: Optional[dict],
    cost_bps: float,
) -> Optional[Tuple[dict, str, float, float]]:
    choices: List[Tuple[dict, str, float, float]] = []
    if core is not None:
        value = v39.v22.trade_value(core, cost_bps)
        if value is not None:
            choices.append((core, "V44_CORE_RESIDUAL", 1.0, value))
    if reversal is not None:
        value = scaled_value(reversal, cost_bps, candidate.reversal_gross)
        if value is not None:
            choices.append((reversal, "V44_REVERSAL_AUX", candidate.reversal_gross, value))
    if not choices:
        return None
    if candidate.selection_policy == "CORE_FIRST":
        return next((item for item in choices if item[1] == "V44_CORE_RESIDUAL"), choices[0])
    return sorted(
        choices,
        key=lambda item: (-(v39.finite(item[0].get("edgeProxyBps")) - cost_bps) * item[2], item[1]),
    )[0]


def route(
    candidate: Candidate,
    v11_rows: Sequence[dict],
    v19_rows: Sequence[dict],
    core_rows: Sequence[dict],
    reversal_rows: Sequence[dict],
    cost_bps: float,
    days: Sequence[str],
) -> Tuple[List[dict], dict]:
    allowed = set(days)
    maps = {
        "v11": {str(row["day"]): row for row in v11_rows if str(row["day"]) in allowed},
        "v19": {str(row["day"]): row for row in v19_rows if str(row["day"]) in allowed},
        "core": {str(row["day"]): row for row in core_rows if str(row["day"]) in allowed},
        "reversal": {str(row["day"]): row for row in reversal_rows if str(row["day"]) in allowed},
    }
    events: List[dict] = []
    stats: Counter = Counter()
    for day in sorted(allowed):
        primary = maps["v11"].get(day)
        if primary is not None:
            value = v39.v22.trade_value(primary, cost_bps)
            if value is not None:
                events.append({**primary, "netReturn": value, "route": "V11_EQ_PRIMARY"})
                stats["V11_EQ_SELECTED"] += 1
                continue
            stats["V11_EQ_COST_GATE_REJECTED"] += 1

        daily_return = 0.0
        selected = choose_open(candidate, maps["core"].get(day), maps["reversal"].get(day), cost_bps)
        selected_row = None
        if selected is not None:
            row, route_name, gross, value = selected
            selected_row = adjusted_row(row, gross, value, route_name)
            events.append(selected_row)
            stats[route_name + "_SELECTED"] += 1
            daily_return = value

        fallback = maps["v19"].get(day)
        if fallback is not None and daily_return > -0.02:
            if selected_row is None or int(selected_row["exitTs"]) <= int(fallback["entryTs"]):
                value = v39.v22.trade_value(fallback, cost_bps)
                if value is not None:
                    events.append({**fallback, "netReturn": value, "route": "V19_FALLBACK"})
                    stats["V19_FALLBACK_SELECTED"] += 1
                else:
                    stats["V19_FALLBACK_COST_GATE_REJECTED"] += 1
            else:
                stats["V19_OVERLAP_BLOCKED"] += 1
        elif fallback is not None:
            stats["V19_DAILY_LOSS_BLOCKED"] += 1
    return sorted(events, key=lambda row: (int(row["entryTs"]), int(row["exitTs"]), str(row["route"]))), dict(stats)


def scenario_set(candidate, rows, days):
    results, routing = {}, {}
    for name, cost in SCENARIOS.items():
        events, stats = route(candidate, cost_bps=cost, days=days, **rows)
        results[name] = v39.v22.metrics(events)
        routing[name] = stats
    return results, routing


def audit(candidate, rows, target, development, validation, final, holdout):
    full, routing = scenario_set(candidate, rows, target)
    dev, dev_route = scenario_set(candidate, rows, development)
    val, val_route = scenario_set(candidate, rows, validation)
    fin, _ = scenario_set(candidate, rows, final)
    hol, _ = scenario_set(candidate, rows, holdout)
    normal_events, _ = route(candidate, cost_bps=SCENARIOS["NORMAL"], days=target, **rows)
    p95_events, _ = route(candidate, cost_bps=SCENARIOS["P95"], days=target, **rows)
    normal_month_events, normal_month = v39.v22.remove_best_month(normal_events)
    p95_month_events, p95_month = v39.v22.remove_best_month(p95_events)
    fallback_normal = v39.v22.metrics([row for row in normal_events if row.get("route") != "V11_EQ_PRIMARY"])
    fallback_p95 = v39.v22.metrics([row for row in p95_events if row.get("route") != "V11_EQ_PRIMARY"])
    dev_aux = int(dev_route["NORMAL"].get("V44_CORE_RESIDUAL_SELECTED", 0)) + int(dev_route["NORMAL"].get("V44_REVERSAL_AUX_SELECTED", 0))
    val_aux = int(val_route["NORMAL"].get("V44_CORE_RESIDUAL_SELECTED", 0)) + int(val_route["NORMAL"].get("V44_REVERSAL_AUX_SELECTED", 0))
    checks = {
        "developmentNormalAndP95Positive": dev["NORMAL"]["compoundedReturnPct"] > 0 and dev["P95"]["compoundedReturnPct"] > 0,
        "validationMinimumEightNormalTrades": val["NORMAL"]["trades"] >= 8,
        "validationMinimumFourAuxTrades": val_aux >= 4,
        "validationNormalProfitFactorAtLeast1_2": (val["NORMAL"]["profitFactor"] or 0.0) >= 1.20,
        "validationNormalAndP95Positive": val["NORMAL"]["compoundedReturnPct"] > 0 and val["P95"]["compoundedReturnPct"] > 0,
        "finalNormalAndP95Positive": fin["NORMAL"]["compoundedReturnPct"] > 0 and fin["P95"]["compoundedReturnPct"] > 0,
        "holdoutMinimumTrades": hol["NORMAL"]["trades"] >= v39.v20.STRICT_HURDLES["minimumHoldoutTrades"],
        "holdoutNormalAndP95Positive": hol["NORMAL"]["compoundedReturnPct"] > 0 and hol["P95"]["compoundedReturnPct"] > 0,
        "normalAboveV22": full["NORMAL"]["compoundedReturnPct"] > v39.BASELINE_NORMAL,
        "p95AboveV22": full["P95"]["compoundedReturnPct"] > v39.BASELINE_P95,
        "fallbackNormalAboveV19": fallback_normal["compoundedReturnPct"] > v39.BASELINE_FALLBACK_NORMAL,
        "fallbackP95AboveV19": fallback_p95["compoundedReturnPct"] > v39.BASELINE_FALLBACK_P95,
        "normalProfitFactorAtLeast1_5": (full["NORMAL"]["profitFactor"] or 0.0) >= 1.50,
        "normalDrawdownNoWorseThanMinus15Pct": full["NORMAL"]["maxDrawdownPct"] >= -15.0,
        "normalMinimumFiftyTrades": full["NORMAL"]["trades"] >= 50,
        "positiveProfitConcentrationAtMost40Pct": full["NORMAL"]["maximumPositiveProfitSymbolShare"] <= 0.40,
        "bestTradeRemovedNormalAndP95Positive": v39.v22.metrics(v39.v22.remove_best(normal_events))["compoundedReturnPct"] > 0 and v39.v22.metrics(v39.v22.remove_best(p95_events))["compoundedReturnPct"] > 0,
        "bestMonthRemovedNormalAndP95Positive": v39.v22.metrics(normal_month_events)["compoundedReturnPct"] > 0 and v39.v22.metrics(p95_month_events)["compoundedReturnPct"] > 0,
        "severeFailClosedNonnegative": full["SEVERE"]["compoundedReturnPct"] >= 0,
    }
    return {
        "full": full,
        "development": dev,
        "validation": val,
        "finalReused": fin,
        "holdout": hol,
        "routing": routing,
        "developmentRouting": dev_route,
        "validationRouting": val_route,
        "developmentAuxTrades": dev_aux,
        "validationAuxTrades": val_aux,
        "fallbackFull": {"NORMAL": fallback_normal, "P95": fallback_p95},
        "checks": checks,
        "allStrictHurdlesPassed": all(checks.values()),
        "robustness": {
            "normalBestTradeRemoved": v39.v22.metrics(v39.v22.remove_best(normal_events)),
            "p95BestTradeRemoved": v39.v22.metrics(v39.v22.remove_best(p95_events)),
            "normalBestMonthRemoved": {"month": normal_month, "metrics": v39.v22.metrics(normal_month_events)},
            "p95BestMonthRemoved": {"month": p95_month, "metrics": v39.v22.metrics(p95_month_events)},
        },
    }


def development_pass(result: dict, baseline: dict) -> bool:
    return (
        result["developmentAuxTrades"] >= 6
        and result["development"]["NORMAL"]["compoundedReturnPct"] > baseline["development"]["NORMAL"]["compoundedReturnPct"]
        and result["development"]["P95"]["compoundedReturnPct"] > baseline["development"]["P95"]["compoundedReturnPct"]
        and (result["development"]["NORMAL"]["profitFactor"] or 0.0) >= 1.30
    )


def validation_pass(result: dict, baseline: dict) -> bool:
    return (
        result["validation"]["NORMAL"]["trades"] >= 8
        and result["validationAuxTrades"] >= 4
        and result["validation"]["NORMAL"]["compoundedReturnPct"] > baseline["validation"]["NORMAL"]["compoundedReturnPct"]
        and result["validation"]["P95"]["compoundedReturnPct"] > baseline["validation"]["P95"]["compoundedReturnPct"]
        and (result["validation"]["NORMAL"]["profitFactor"] or 0.0) >= 1.20
    )


def selection_score(result: dict, baseline: dict) -> float:
    return (
        result["validation"]["NORMAL"]["compoundedReturnPct"] - baseline["validation"]["NORMAL"]["compoundedReturnPct"]
        + result["validation"]["P95"]["compoundedReturnPct"] - baseline["validation"]["P95"]["compoundedReturnPct"]
        + 0.20 * result["validationAuxTrades"]
        - 0.25 * abs(result["validation"]["NORMAL"]["maxDrawdownPct"])
    )


def analyze(cache_root: Path) -> dict:
    v39.v14.base.verify_source(v39.v14.base.V11_ROOT, v39.v14.base.V11_SOURCE_SHA)
    v39.v14.base.verify_source(v39.v14.base.V13_ROOT, v39.v14.base.V13_SOURCE_SHA)
    v39.v19.configure_exact_data_window()
    days, aligned, aligned_diag = v39.v19.v17.load_all(cache_root / "aligned")
    warmup = [day for day in days if v39.v19.WARMUP_START.date().isoformat() <= day < v39.v19.BT_END_DAY_EXCLUSIVE]
    market = v39.v14.v11.v9.load_market(cache_root / "aster-market")
    market_rows, market_diag = v39.parse_market(market, warmup)
    common = [day for day in warmup if all(day in market_rows[symbol] for symbol in v39.v14.SYMBOLS)]
    funding_raw = v39.v14.funding_mod.load_funding(cache_root / "funding")
    funding = {symbol: v39.v14.funding_mod.funding_points(rows) for symbol, rows in funding_raw.items()}
    absolute_features = v39.build_features(common, market_rows, funding)
    residual_features = v40.build_features(common, market_rows, funding)
    core_rows = v42.build_trades(CORE, common, residual_features)
    target = [day for day in common if v39.v19.BT_START_DAY <= day < v39.v19.BT_END_DAY_EXCLUSIVE]
    pre_holdout = [day for day in target if day < v39.HOLDOUT_START]
    holdout = [day for day in target if day >= v39.HOLDOUT_START]
    splits = v39.v14.split_days(pre_holdout)
    v11_rows, v11_diag = v39.v22.build_v11eq(warmup, aligned)
    v19_rows = v39.v22.build_fallback(warmup, aligned)
    baseline = v39.v22.audit(v11_rows, v19_rows, target, splits["DEVELOPMENT"], splits["VALIDATION"], splits["FINAL_REUSED"], holdout, True)

    development_survivors = []
    diagnostics = []
    for candidate in CANDIDATES:
        reversal_rows = v43.build_trades(reversal_definition(candidate), common, absolute_features, residual_features)
        rows = {"v11_rows": v11_rows, "v19_rows": v19_rows, "core_rows": core_rows, "reversal_rows": reversal_rows}
        result = audit(candidate, rows, target, splits["DEVELOPMENT"], splits["VALIDATION"], splits["FINAL_REUSED"], holdout)
        diagnostics.append({
            "candidate": asdict(candidate),
            "rawCoreTrades": len(core_rows),
            "rawReversalTrades": len(reversal_rows),
            "development": result["development"],
            "validation": result["validation"],
            "developmentAuxTrades": result["developmentAuxTrades"],
            "validationAuxTrades": result["validationAuxTrades"],
            "full": result["full"],
            "fallbackFull": result["fallbackFull"],
            "finalReused": result["finalReused"],
            "holdout": result["holdout"],
            "checks": result["checks"],
        })
        if development_pass(result, baseline):
            development_survivors.append((candidate, result))
    development_survivors.sort(key=lambda item: item[1]["development"]["NORMAL"]["compoundedReturnPct"] + item[1]["development"]["P95"]["compoundedReturnPct"], reverse=True)
    validation_survivors = [item for item in development_survivors[:50] if validation_pass(item[1], baseline)]
    validation_survivors.sort(key=lambda item: selection_score(item[1], baseline), reverse=True)
    winner = validation_survivors[0] if validation_survivors else None
    status = "ASTER_ONLY_V44_NO_VALIDATED_CONFIDENCE_TIERED_ROUTER"
    winner_payload = None
    if winner is not None:
        candidate, result = winner
        accepted = result["allStrictHurdlesPassed"]
        status = "ASTER_ONLY_V44_VALIDATED_SHADOW_LEAD" if accepted else "ASTER_ONLY_V44_WINNER_DID_NOT_CLEAR_FINAL_AUDIT"
        winner_payload = {"candidate": asdict(candidate), "accepted": accepted, "audit": result}

    diagnostics.sort(key=lambda row: row["development"]["NORMAL"]["compoundedReturnPct"] + row["development"]["P95"]["compoundedReturnPct"], reverse=True)
    return v39.v14.rounded({
        "version": 44,
        "strategyId": STRATEGY_ID,
        "status": status,
        "candidateCount": len(CANDIDATES),
        "developmentSurvivors": len(development_survivors),
        "validationSurvivors": len(validation_survivors),
        "winner": winner_payload,
        "baseline": baseline,
        "core": asdict(CORE),
        "topDevelopmentDiagnostics": diagnostics[:20],
        "period": {"startInclusiveUtc": v39.v19.BT_START.isoformat(), "endExclusiveUtc": v39.v19.BT_END_EXCLUSIVE.isoformat(), "calendarDays": 365, "targetSessions": len(target), "holdoutSessions": len(holdout)},
        "architecture": {"venue": "ASTER_ONLY", "signalSource": "CONFIDENCE_TIERED_RESIDUAL_AND_OPEN_REVERSAL", "entryNy": "10:30", "maximumConcurrentGross": 1.0, "maximumConcurrentPositions": 1, "fractionalAuxGross": True, "v11EqPriority": True, "v19SequentialWhenNonOverlapping": True, "hyperliquidUsed": False},
        "selectionDiscipline": {"candidateCountFrozenBeforeExecution": True, "developmentSelectsTopFifty": True, "validationSelectsAtMostOne": True, "finalAndHoldoutUsedForSelection": False, "productionPromotionAllowed": False},
        "data": {"aligned": aligned_diag, "aster24h": market_diag, "commonSessions": len(common)},
        "v11Diagnostics": v11_diag,
        "safety": {"mode": "RESEARCH_ONLY", "orderSubmissionAllowed": False, "productionChanged": False, "liveChanged": False, "vpsChanged": False, "cryptoV96Changed": False, "v11EqChanged": False, "v19Changed": False, "v13dProductionChanged": False},
    })


def report(result: dict) -> str:
    lines = ["# Aster-only V44 Confidence-Tiered Open Router", "", f"Status: **{result['status']}**", "", f"Candidates: {result['candidateCount']}", f"Development survivors: {result['developmentSurvivors']}", f"Validation survivors: {result['validationSurvivors']}", ""]
    if result["winner"]:
        w=result["winner"]; a=w["audit"]
        lines += [f"Winner: `{w['candidate']['candidate_id']}`", f"Accepted: {w['accepted']}", f"Normal: {a['full']['NORMAL']['compoundedReturnPct']:.6f}%", f"P95: {a['full']['P95']['compoundedReturnPct']:.6f}%", f"Fallback Normal: {a['fallbackFull']['NORMAL']['compoundedReturnPct']:.6f}%", f"Fallback P95: {a['fallbackFull']['P95']['compoundedReturnPct']:.6f}%", f"Validation auxiliary trades: {a['validationAuxTrades']}", ""]
    lines += ["Research only. No Production, LIVE, VPS or order state was changed.", ""]
    return "\n".join(lines)


def main() -> int:
    parser=argparse.ArgumentParser(); parser.add_argument("--cache-dir",required=True); parser.add_argument("--output-dir",required=True); args=parser.parse_args()
    output=Path(args.output_dir).resolve(); output.mkdir(parents=True,exist_ok=True)
    result=analyze(Path(args.cache_dir).resolve())
    (output/"result.json").write_text(json.dumps(result,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
    (output/"report.md").write_text(report(result),encoding="utf-8")
    print(json.dumps({"status":result["status"],"developmentSurvivors":result["developmentSurvivors"],"validationSurvivors":result["validationSurvivors"],"winner":result["winner"],"topDevelopmentDiagnostics":result["topDevelopmentDiagnostics"][:5]},indent=2,ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
