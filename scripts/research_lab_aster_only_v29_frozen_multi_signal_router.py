from __future__ import annotations

import argparse
import json
from collections import Counter
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import research_lab_aster_only_v14_replacement_tournament as v14
import research_lab_aster_only_v15_intraday_shock_tournament as v15
import research_lab_aster_only_v19_trailing_one_year_bt as v19
import research_lab_aster_only_v20_strict_hurdle_tournament as v20
import research_lab_aster_only_v22_v11eq_primary_v19_fallback as v22
import research_lab_aster_only_v25_early_micro_plus_v19 as v25
import research_lab_aster_only_v26_nonbasis_fallback_tournament as v26
import research_lab_aster_only_v27_beta_squeeze_orb_tournament as v27

STRATEGY_ID = "DISDEX_ASTER_ONLY_V29_FROZEN_MULTI_SIGNAL_ROUTER"
SCENARIOS = v14.SCENARIOS
HOLDOUT_START = v20.HOLDOUT_START_DAY
BASELINE_NORMAL = 72.276908
BASELINE_P95 = 68.080022
BASELINE_FALLBACK_NORMAL = 7.813259
BASELINE_FALLBACK_P95 = 7.400908
DAILY_LOSS_LOCK = -0.02

MICRO_Z = v15.Candidate(
    "TIME_SLOT_ZSCORE_FADE__T2__SLOT_1130__H1__NONE",
    "TIME_SLOT_ZSCORE_FADE", 2.0, "SLOT_1130", 1, False,
)
MICRO_ACCEL = v15.Candidate(
    "BASIS_ACCELERATION_FADE__T25__SLOT_1130__H1__COOLDOWN",
    "BASIS_ACCELERATION_FADE", 25.0, "SLOT_1130", 1, True,
)
BREADTH = v26.Candidate(
    "BREADTH_LAG__B25__L15__S3__H2",
    "BREADTH_LAG", 25.0, 15.0, 3, 2,
)
ORB = v27.Candidate(
    "OPENING_RANGE_VOLUME__B10__V1.25__L15__S2__H2",
    "OPENING_RANGE_VOLUME", 10.0, 1.25, 15.0, 2, 2, 20,
)


@dataclass(frozen=True)
class Policy:
    policy_id: str
    micro: str
    mid: str
    late_breadth: bool


POLICIES: Tuple[Policy, ...] = tuple(
    Policy(
        f"MICRO_{micro}__MID_{mid}__LATE_{'BREADTH' if late else 'NONE'}",
        micro, mid, late,
    )
    for micro in ("NONE", "Z2", "ACCEL")
    for mid in ("V19_PRIORITY", "ORB_PRIORITY", "MAX_EDGE")
    for late in (False, True)
)


def finite(value: Any, fallback: float = 0.0) -> float:
    return v14.finite(value, fallback)


def rounded(value: Any):
    return v14.rounded(value)


def label_rows(rows: Sequence[dict], strategy: str) -> List[dict]:
    return [{**row, "strategy": strategy} for row in rows]


def estimated_edge(row: dict, cost_bps: float) -> float:
    if row is None:
        return -1e18
    return finite(row.get("edgeProxyBps")) - cost_bps


def choose_mid(policy: Policy, v19_row: Optional[dict], orb_row: Optional[dict], cost_bps: float) -> Optional[Tuple[dict, str]]:
    candidates: List[Tuple[dict, str]] = []
    if v19_row is not None and v22.trade_value(v19_row, cost_bps) is not None:
        candidates.append((v19_row, "V19_FALLBACK"))
    if orb_row is not None and v22.trade_value(orb_row, cost_bps) is not None:
        candidates.append((orb_row, "V29_ORB_FALLBACK"))
    if not candidates:
        return None
    if policy.mid == "V19_PRIORITY":
        return next((item for item in candidates if item[1] == "V19_FALLBACK"), candidates[0])
    if policy.mid == "ORB_PRIORITY":
        return next((item for item in candidates if item[1] == "V29_ORB_FALLBACK"), candidates[0])
    return sorted(candidates, key=lambda item: (-estimated_edge(item[0], cost_bps), item[1]))[0]


def combined_route(
    policy: Policy,
    v11_rows: Sequence[dict],
    v19_rows: Sequence[dict],
    micro_z_rows: Sequence[dict],
    micro_accel_rows: Sequence[dict],
    orb_rows: Sequence[dict],
    breadth_rows: Sequence[dict],
    cost_bps: float,
    days: Sequence[str],
) -> Tuple[List[dict], dict]:
    allowed = set(days)
    maps = {
        "v11": {str(row["day"]): row for row in v11_rows if str(row["day"]) in allowed},
        "v19": {str(row["day"]): row for row in v19_rows if str(row["day"]) in allowed},
        "micro_z": {str(row["day"]): row for row in micro_z_rows if str(row["day"]) in allowed},
        "micro_accel": {str(row["day"]): row for row in micro_accel_rows if str(row["day"]) in allowed},
        "orb": {str(row["day"]): row for row in orb_rows if str(row["day"]) in allowed},
        "breadth": {str(row["day"]): row for row in breadth_rows if str(row["day"]) in allowed},
    }
    events: List[dict] = []
    stats: Counter = Counter()

    for day in sorted(allowed):
        primary = maps["v11"].get(day)
        if primary is not None:
            value = v22.trade_value(primary, cost_bps)
            if value is not None:
                events.append({**primary, "netReturn": value, "route": "V11_EQ_PRIMARY"})
                stats["V11_EQ_SELECTED"] += 1
                continue
            stats["V11_EQ_COST_GATE_REJECTED"] += 1

        daily_return = 0.0
        next_free_ts = -1

        micro = None
        micro_route = None
        if policy.micro == "Z2":
            micro, micro_route = maps["micro_z"].get(day), "V29_MICRO_Z2"
        elif policy.micro == "ACCEL":
            micro, micro_route = maps["micro_accel"].get(day), "V29_MICRO_ACCEL"
        if micro is not None:
            value = v22.trade_value(micro, cost_bps)
            if value is not None:
                events.append({**micro, "netReturn": value, "route": micro_route})
                stats[micro_route + "_SELECTED"] += 1
                daily_return = (1.0 + daily_return) * (1.0 + value) - 1.0
                next_free_ts = int(micro["exitTs"])
            else:
                stats[micro_route + "_COST_GATE_REJECTED"] += 1

        if daily_return > DAILY_LOSS_LOCK:
            selected_mid = choose_mid(policy, maps["v19"].get(day), maps["orb"].get(day), cost_bps)
            if selected_mid is not None:
                mid, route_name = selected_mid
                if int(mid["entryTs"]) >= next_free_ts:
                    value = v22.trade_value(mid, cost_bps)
                    if value is not None:
                        events.append({**mid, "netReturn": value, "route": route_name})
                        stats[route_name + "_SELECTED"] += 1
                        daily_return = (1.0 + daily_return) * (1.0 + value) - 1.0
                        next_free_ts = int(mid["exitTs"])
                else:
                    stats["MID_OVERLAP_BLOCKED"] += 1
        else:
            stats["DAILY_LOSS_LOCK_BLOCKED_MID"] += 1

        if policy.late_breadth and daily_return > DAILY_LOSS_LOCK:
            breadth = maps["breadth"].get(day)
            if breadth is not None:
                if int(breadth["entryTs"]) >= next_free_ts:
                    value = v22.trade_value(breadth, cost_bps)
                    if value is not None:
                        events.append({**breadth, "netReturn": value, "route": "V29_BREADTH_LATE"})
                        stats["V29_BREADTH_LATE_SELECTED"] += 1
                else:
                    stats["BREADTH_OVERLAP_BLOCKED"] += 1

    return sorted(events, key=lambda row: (int(row["entryTs"]), int(row["exitTs"]), str(row["route"]))), dict(stats)


def scenario_set(policy: Policy, rows: dict, days: Sequence[str]) -> Tuple[dict, dict]:
    results, routing = {}, {}
    for name, cost in SCENARIOS.items():
        events, stats = combined_route(policy, cost_bps=cost, days=days, **rows)
        results[name] = v22.metrics(events)
        routing[name] = stats
    return results, routing


def audit(policy: Policy, rows: dict, target: Sequence[str], development: Sequence[str], validation: Sequence[str], final: Sequence[str], holdout: Sequence[str]) -> dict:
    full, routing = scenario_set(policy, rows, target)
    dev, _ = scenario_set(policy, rows, development)
    val, val_routing = scenario_set(policy, rows, validation)
    fin, _ = scenario_set(policy, rows, final)
    hol, _ = scenario_set(policy, rows, holdout)
    normal_events, _ = combined_route(policy, cost_bps=SCENARIOS["NORMAL"], days=target, **rows)
    p95_events, _ = combined_route(policy, cost_bps=SCENARIOS["P95"], days=target, **rows)
    normal_month_events, normal_month = v22.remove_best_month(normal_events)
    p95_month_events, p95_month = v22.remove_best_month(p95_events)
    normal, p95 = full["NORMAL"], full["P95"]
    fallback_validation = sum(
        count for key, count in val_routing["NORMAL"].items()
        if key.endswith("_SELECTED") and key != "V11_EQ_SELECTED"
    )
    fallback_full_normal = v22.metrics([row for row in normal_events if row["route"] != "V11_EQ_PRIMARY"])
    fallback_full_p95 = v22.metrics([row for row in p95_events if row["route"] != "V11_EQ_PRIMARY"])
    checks = {
        "developmentNormalAndP95Positive": dev["NORMAL"]["compoundedReturnPct"] > 0 and dev["P95"]["compoundedReturnPct"] > 0,
        "validationMinimumEightNormalTrades": val["NORMAL"]["trades"] >= 8,
        "validationMinimumSevenFallbackTrades": fallback_validation >= 7,
        "validationNormalProfitFactorAtLeast1_2": (val["NORMAL"]["profitFactor"] or 0.0) >= 1.20,
        "validationNormalAndP95Positive": val["NORMAL"]["compoundedReturnPct"] > 0 and val["P95"]["compoundedReturnPct"] > 0,
        "finalReusedNormalAndP95Positive": fin["NORMAL"]["compoundedReturnPct"] > 0 and fin["P95"]["compoundedReturnPct"] > 0,
        "holdoutMinimumTrades": hol["NORMAL"]["trades"] >= v20.STRICT_HURDLES["minimumHoldoutTrades"],
        "holdoutNormalAndP95Positive": hol["NORMAL"]["compoundedReturnPct"] > 0 and hol["P95"]["compoundedReturnPct"] > 0,
        "normalReturnAboveV22": normal["compoundedReturnPct"] > BASELINE_NORMAL,
        "p95ReturnAboveV22": p95["compoundedReturnPct"] > BASELINE_P95,
        "fallbackNormalAboveV19": fallback_full_normal["compoundedReturnPct"] > BASELINE_FALLBACK_NORMAL,
        "fallbackP95AboveV19": fallback_full_p95["compoundedReturnPct"] > BASELINE_FALLBACK_P95,
        "normalProfitFactorAtLeast1_5": (normal["profitFactor"] or 0.0) >= 1.50,
        "normalDrawdownNoWorseThanMinus15Pct": normal["maxDrawdownPct"] >= -15.0,
        "normalMinimumFiftyTrades": normal["trades"] >= 50,
        "positiveProfitConcentrationAtMost40Pct": normal["maximumPositiveProfitSymbolShare"] <= 0.40,
        "bestTradeRemovedNormalAndP95Positive": v22.metrics(v22.remove_best(normal_events))["compoundedReturnPct"] > 0 and v22.metrics(v22.remove_best(p95_events))["compoundedReturnPct"] > 0,
        "bestMonthRemovedNormalAndP95Positive": v22.metrics(normal_month_events)["compoundedReturnPct"] > 0 and v22.metrics(p95_month_events)["compoundedReturnPct"] > 0,
        "severeFailClosedNonnegative": full["SEVERE"]["compoundedReturnPct"] >= 0,
    }
    return {
        "full": full,
        "development": dev,
        "validation": val,
        "finalReused": fin,
        "holdout": hol,
        "routing": routing,
        "validationRouting": val_routing,
        "fallbackValidationTrades": fallback_validation,
        "fallbackFull": {"NORMAL": fallback_full_normal, "P95": fallback_full_p95},
        "checks": checks,
        "allStrictHurdlesPassed": all(checks.values()),
        "robustness": {
            "normalBestTradeRemoved": v22.metrics(v22.remove_best(normal_events)),
            "p95BestTradeRemoved": v22.metrics(v22.remove_best(p95_events)),
            "normalBestMonthRemoved": {"month": normal_month, "metrics": v22.metrics(normal_month_events)},
            "p95BestMonthRemoved": {"month": p95_month, "metrics": v22.metrics(p95_month_events)},
        },
    }


def development_pass(result: dict, baseline: dict) -> bool:
    return (
        result["development"]["NORMAL"]["compoundedReturnPct"] > baseline["development"]["NORMAL"]["compoundedReturnPct"]
        and result["development"]["P95"]["compoundedReturnPct"] > baseline["development"]["P95"]["compoundedReturnPct"]
        and result["development"]["NORMAL"]["trades"] >= baseline["development"]["NORMAL"]["trades"]
        and (result["development"]["NORMAL"]["profitFactor"] or 0.0) >= 1.3
    )


def validation_pass(result: dict, baseline: dict) -> bool:
    return (
        result["validation"]["NORMAL"]["trades"] >= 8
        and result["fallbackValidationTrades"] >= 7
        and result["validation"]["NORMAL"]["compoundedReturnPct"] > baseline["validation"]["NORMAL"]["compoundedReturnPct"]
        and result["validation"]["P95"]["compoundedReturnPct"] > baseline["validation"]["P95"]["compoundedReturnPct"]
        and (result["validation"]["NORMAL"]["profitFactor"] or 0.0) >= 1.2
    )


def selection_score(result: dict) -> float:
    val = result["validation"]["NORMAL"]
    return (
        val["compoundedReturnPct"]
        + result["validation"]["P95"]["compoundedReturnPct"]
        + 0.3 * result["fallbackValidationTrades"]
        - 0.5 * abs(val["maxDrawdownPct"])
    )


def analyze(cache_root: Path) -> dict:
    v14.base.verify_source(v14.base.V11_ROOT, v14.base.V11_SOURCE_SHA)
    v14.base.verify_source(v14.base.V13_ROOT, v14.base.V13_SOURCE_SHA)
    v19.configure_exact_data_window()
    days, aligned, diagnostics = v19.v17.load_all(cache_root / "stock")
    yahoo, yahoo_diagnostics = v27.load_yahoo_context(cache_root / "yahoo")
    warmup = [day for day in days if v19.WARMUP_START.date().isoformat() <= day < v19.BT_END_DAY_EXCLUSIVE]
    target = [day for day in warmup if v19.BT_START_DAY <= day < v19.BT_END_DAY_EXCLUSIVE]
    pre_holdout = [day for day in target if day < HOLDOUT_START]
    holdout = [day for day in target if day >= HOLDOUT_START]
    splits = v14.split_days(pre_holdout)

    v15_features = v15.build_slot_features(warmup, aligned)
    v26_features = v26.build_features(warmup, aligned)
    v27_features = v27.build_features(warmup, aligned, yahoo)
    v11_rows, v11_diag = v22.build_v11eq(warmup, aligned)
    v19_rows = v22.build_fallback(warmup, aligned)
    micro_z_rows = label_rows(v15.build_trades(MICRO_Z, warmup, v15_features), "V29_MICRO_Z2")
    micro_accel_rows = label_rows(v15.build_trades(MICRO_ACCEL, warmup, v15_features), "V29_MICRO_ACCEL")
    orb_rows = label_rows(v27.build_trades(ORB, warmup, v27_features), "V29_ORB_FALLBACK")
    breadth_rows = label_rows(v26.build_trades(BREADTH, warmup, v26_features), "V29_BREADTH_LATE")
    rows = {
        "v11_rows": v11_rows,
        "v19_rows": v19_rows,
        "micro_z_rows": micro_z_rows,
        "micro_accel_rows": micro_accel_rows,
        "orb_rows": orb_rows,
        "breadth_rows": breadth_rows,
    }

    baseline = v22.audit(
        v11_rows, v19_rows, target,
        splits["DEVELOPMENT"], splits["VALIDATION"], splits["FINAL_REUSED"], holdout, True,
    )
    development_survivors = []
    for policy in POLICIES:
        result = audit(
            policy, rows, target,
            splits["DEVELOPMENT"], splits["VALIDATION"], splits["FINAL_REUSED"], holdout,
        )
        if development_pass(result, baseline):
            development_survivors.append((policy, result))
    development_survivors.sort(key=lambda item: selection_score(item[1]), reverse=True)
    validation_survivors = [
        item for item in development_survivors[:6]
        if validation_pass(item[1], baseline)
    ]
    validation_survivors.sort(key=lambda item: selection_score(item[1]), reverse=True)
    winner = validation_survivors[0] if validation_survivors else None

    winner_payload = None
    status = "ASTER_ONLY_V29_NO_VALIDATED_MULTI_SIGNAL_ROUTER"
    if winner is not None:
        policy, result = winner
        accepted = result["allStrictHurdlesPassed"]
        status = "ASTER_ONLY_V29_VALIDATED_SHADOW_LEAD" if accepted else "ASTER_ONLY_V29_WINNER_DID_NOT_CLEAR_FINAL_AUDIT"
        winner_payload = {
            "policy": asdict(policy),
            "audit": result,
            "accepted": accepted,
        }

    return rounded({
        "version": 29,
        "strategyId": STRATEGY_ID,
        "status": status,
        "policyCount": len(POLICIES),
        "developmentSurvivors": len(development_survivors),
        "validationSurvivors": len(validation_survivors),
        "baseline": baseline,
        "winner": winner_payload,
        "topPolicies": [
            {"policy": asdict(policy), "audit": result}
            for policy, result in development_survivors[:8]
        ],
        "frozenComponents": {
            "microZ": MICRO_Z.candidate_id,
            "microAcceleration": MICRO_ACCEL.candidate_id,
            "v19": v19.CANDIDATE.candidate_id,
            "openingRange": ORB.candidate_id,
            "lateBreadth": BREADTH.candidate_id,
        },
        "period": {
            "startInclusiveUtc": v19.BT_START.isoformat(),
            "endExclusiveUtc": v19.BT_END_EXCLUSIVE.isoformat(),
            "calendarDays": 365,
            "sessions": len(target),
            "holdoutSessions": len(holdout),
        },
        "selectionDiscipline": {
            "componentsRetuned": False,
            "developmentSelectsTopSix": True,
            "validationSelectsAtMostOne": True,
            "finalAndHoldoutUsedForSelection": False,
            "sameHistoryIsReusedAndNotIndependent": True,
            "productionPromotionAllowed": False,
        },
        "architecture": {
            "venue": "ASTER_ONLY",
            "maximumConcurrentGross": 1.0,
            "maximumConcurrentPositions": 1,
            "sequentialIntradayEntriesAllowed": True,
            "hyperliquidUsed": False,
        },
        "data": {"stock": diagnostics, "yahooContext": yahoo_diagnostics},
        "v11Diagnostics": v11_diag,
        "safety": {
            "mode": "RESEARCH_ONLY",
            "orderSubmissionAllowed": False,
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "cryptoV96Changed": False,
            "v11EqChanged": False,
            "v19Changed": False,
            "v13dProductionChanged": False,
        },
    })


def report(result: dict) -> str:
    lines = [
        "# Aster-only V29 Frozen Multi-Signal Router",
        "",
        f"Status: **{result['status']}**",
        "",
        f"Policies: {result['policyCount']}",
        f"Development survivors: {result['developmentSurvivors']}",
        f"Validation survivors: {result['validationSurvivors']}",
        "",
    ]
    if result["winner"]:
        winner = result["winner"]
        lines += [
            f"Winner: `{winner['policy']['policy_id']}`",
            f"Accepted: {winner['accepted']}",
            f"Normal: {winner['audit']['full']['NORMAL']['compoundedReturnPct']:.6f}%",
            f"P95: {winner['audit']['full']['P95']['compoundedReturnPct']:.6f}%",
            f"Validation trades: {winner['audit']['validation']['NORMAL']['trades']}",
            f"Validation fallback trades: {winner['audit']['fallbackValidationTrades']}",
            "",
        ]
    lines += ["Research only. No Production, LIVE, VPS or order state was changed.", ""]
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-dir", required=True)
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()
    output = Path(args.output_dir).resolve()
    output.mkdir(parents=True, exist_ok=True)
    result = analyze(Path(args.cache_dir).resolve())
    (output / "result.json").write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (output / "report.md").write_text(report(result), encoding="utf-8")
    print(json.dumps({
        "status": result["status"],
        "policyCount": result["policyCount"],
        "developmentSurvivors": result["developmentSurvivors"],
        "validationSurvivors": result["validationSurvivors"],
        "winner": result["winner"],
        "topPolicies": result["topPolicies"][:3],
    }, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
