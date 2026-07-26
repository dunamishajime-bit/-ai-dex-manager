from __future__ import annotations

import argparse
import json
from collections import Counter
from dataclasses import asdict
from pathlib import Path
from typing import List, Sequence, Tuple

import research_lab_aster_only_v29_frozen_multi_signal_router as v29

STRATEGY_ID = "DISDEX_ASTER_ONLY_V35_POST_V11_SEQUENTIAL_ROUTER"


def finite(value, fallback: float = 0.0) -> float:
    return v29.finite(value, fallback)


def sequential_route(
    policy: v29.Policy,
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
        daily_return = 0.0
        next_free_ts = -1

        primary = maps["v11"].get(day)
        if primary is not None:
            value = v29.v22.trade_value(primary, cost_bps)
            if value is not None:
                events.append({**primary, "netReturn": value, "route": "V11_EQ_PRIMARY"})
                stats["V11_EQ_SELECTED"] += 1
                daily_return = (1.0 + daily_return) * (1.0 + value) - 1.0
                next_free_ts = int(primary["exitTs"])
            else:
                stats["V11_EQ_COST_GATE_REJECTED"] += 1

        micro = None
        micro_route = None
        if policy.micro == "Z2":
            micro, micro_route = maps["micro_z"].get(day), "V35_MICRO_Z2"
        elif policy.micro == "ACCEL":
            micro, micro_route = maps["micro_accel"].get(day), "V35_MICRO_ACCEL"
        if micro is not None and daily_return > v29.DAILY_LOSS_LOCK:
            if int(micro["entryTs"]) >= next_free_ts:
                value = v29.v22.trade_value(micro, cost_bps)
                if value is not None:
                    events.append({**micro, "netReturn": value, "route": micro_route})
                    stats[micro_route + "_SELECTED"] += 1
                    daily_return = (1.0 + daily_return) * (1.0 + value) - 1.0
                    next_free_ts = int(micro["exitTs"])
                else:
                    stats[micro_route + "_COST_GATE_REJECTED"] += 1
            else:
                stats[micro_route + "_OVERLAP_BLOCKED"] += 1

        if daily_return > v29.DAILY_LOSS_LOCK:
            selected_mid = v29.choose_mid(policy, maps["v19"].get(day), maps["orb"].get(day), cost_bps)
            if selected_mid is not None:
                mid, route_name = selected_mid
                route_name = "V35_" + route_name
                if int(mid["entryTs"]) >= next_free_ts:
                    value = v29.v22.trade_value(mid, cost_bps)
                    if value is not None:
                        events.append({**mid, "netReturn": value, "route": route_name})
                        stats[route_name + "_SELECTED"] += 1
                        daily_return = (1.0 + daily_return) * (1.0 + value) - 1.0
                        next_free_ts = int(mid["exitTs"])
                else:
                    stats["MID_OVERLAP_BLOCKED"] += 1
        else:
            stats["DAILY_LOSS_LOCK_BLOCKED_MID"] += 1

        if policy.late_breadth and daily_return > v29.DAILY_LOSS_LOCK:
            breadth = maps["breadth"].get(day)
            if breadth is not None:
                if int(breadth["entryTs"]) >= next_free_ts:
                    value = v29.v22.trade_value(breadth, cost_bps)
                    if value is not None:
                        events.append({**breadth, "netReturn": value, "route": "V35_BREADTH_LATE"})
                        stats["V35_BREADTH_LATE_SELECTED"] += 1
                else:
                    stats["BREADTH_OVERLAP_BLOCKED"] += 1

    return sorted(events, key=lambda row: (int(row["entryTs"]), int(row["exitTs"]), str(row["route"]))), dict(stats)


def analyze(cache_root: Path) -> dict:
    v29.v14.base.verify_source(v29.v14.base.V11_ROOT, v29.v14.base.V11_SOURCE_SHA)
    v29.v14.base.verify_source(v29.v14.base.V13_ROOT, v29.v14.base.V13_SOURCE_SHA)
    v29.v19.configure_exact_data_window()
    days, aligned, diagnostics = v29.v19.v17.load_all(cache_root / "stock")
    yahoo, yahoo_diag = v29.v27.load_yahoo_context(cache_root / "yahoo")
    warmup = [day for day in days if v29.v19.WARMUP_START.date().isoformat() <= day < v29.v19.BT_END_DAY_EXCLUSIVE]
    target = [day for day in warmup if v29.v19.BT_START_DAY <= day < v29.v19.BT_END_DAY_EXCLUSIVE]
    pre_holdout = [day for day in target if day < v29.HOLDOUT_START]
    holdout = [day for day in target if day >= v29.HOLDOUT_START]
    splits = v29.v14.split_days(pre_holdout)

    v15_features = v29.v15.build_slot_features(warmup, aligned)
    v26_features = v29.v26.build_features(warmup, aligned)
    v27_features = v29.v27.build_features(warmup, aligned, yahoo)
    v11_rows, v11_diag = v29.v22.build_v11eq(warmup, aligned)
    v19_rows = v29.v22.build_fallback(warmup, aligned)
    rows = {
        "v11_rows": v11_rows,
        "v19_rows": v19_rows,
        "micro_z_rows": v29.label_rows(v29.v15.build_trades(v29.MICRO_Z, warmup, v15_features), "V35_MICRO_Z2"),
        "micro_accel_rows": v29.label_rows(v29.v15.build_trades(v29.MICRO_ACCEL, warmup, v15_features), "V35_MICRO_ACCEL"),
        "orb_rows": v29.label_rows(v29.v27.build_trades(v29.ORB, warmup, v27_features), "V35_ORB_FALLBACK"),
        "breadth_rows": v29.label_rows(v29.v26.build_trades(v29.BREADTH, warmup, v26_features), "V35_BREADTH_LATE"),
    }
    baseline = v29.v22.audit(
        v11_rows,
        v19_rows,
        target,
        splits["DEVELOPMENT"],
        splits["VALIDATION"],
        splits["FINAL_REUSED"],
        holdout,
        True,
    )

    original_route = v29.combined_route
    v29.combined_route = sequential_route
    try:
        development_survivors = []
        diagnostics_rows = []
        for policy in v29.POLICIES:
            result = v29.audit(
                policy,
                rows,
                target,
                splits["DEVELOPMENT"],
                splits["VALIDATION"],
                splits["FINAL_REUSED"],
                holdout,
            )
            diagnostics_rows.append({"policy": asdict(policy), "audit": result})
            if v29.development_pass(result, baseline):
                development_survivors.append((policy, result))
        development_survivors.sort(key=lambda item: v29.selection_score(item[1]), reverse=True)
        validation_survivors = [
            item for item in development_survivors[:6]
            if v29.validation_pass(item[1], baseline)
        ]
        validation_survivors.sort(key=lambda item: v29.selection_score(item[1]), reverse=True)
    finally:
        v29.combined_route = original_route

    winner = validation_survivors[0] if validation_survivors else None
    status = "ASTER_ONLY_V35_NO_VALIDATED_POST_V11_ROUTER"
    winner_payload = None
    if winner is not None:
        policy, result = winner
        accepted = result["allStrictHurdlesPassed"]
        status = "ASTER_ONLY_V35_VALIDATED_SHADOW_LEAD" if accepted else "ASTER_ONLY_V35_WINNER_DID_NOT_CLEAR_FINAL_AUDIT"
        winner_payload = {"policy": asdict(policy), "audit": result, "accepted": accepted}

    diagnostics_rows.sort(
        key=lambda row: row["audit"]["development"]["NORMAL"]["compoundedReturnPct"] + row["audit"]["development"]["P95"]["compoundedReturnPct"],
        reverse=True,
    )
    return v29.rounded({
        "version": 35,
        "strategyId": STRATEGY_ID,
        "status": status,
        "policyCount": len(v29.POLICIES),
        "developmentSurvivors": len(development_survivors),
        "validationSurvivors": len(validation_survivors),
        "baseline": baseline,
        "winner": winner_payload,
        "topPolicies": diagnostics_rows[:8],
        "period": {
            "startInclusiveUtc": v29.v19.BT_START.isoformat(),
            "endExclusiveUtc": v29.v19.BT_END_EXCLUSIVE.isoformat(),
            "calendarDays": 365,
            "sessions": len(target),
            "holdoutSessions": len(holdout),
        },
        "architecture": {
            "venue": "ASTER_ONLY",
            "maximumConcurrentGross": 1.0,
            "maximumConcurrentPositions": 1,
            "actualExitTimeReleasesCapital": True,
            "sequentialPostV11EntriesAllowed": True,
            "v11EqPriority": True,
            "hyperliquidUsed": False,
        },
        "selectionDiscipline": {
            "componentsRetuned": False,
            "policyCountFrozenBeforeExecution": True,
            "validationSelectsAtMostOne": True,
            "finalAndHoldoutUsedForSelection": False,
            "productionPromotionAllowed": False,
        },
        "data": {"stock": diagnostics, "yahooContext": yahoo_diag},
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
        "# Aster-only V35 Post-V11 Sequential Router",
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
        lines.extend([
            f"Winner: `{winner['policy']['policy_id']}`",
            f"Accepted: {winner['accepted']}",
            f"Normal: {winner['audit']['full']['NORMAL']['compoundedReturnPct']:.6f}%",
            f"P95: {winner['audit']['full']['P95']['compoundedReturnPct']:.6f}%",
            f"Validation trades: {winner['audit']['validation']['NORMAL']['trades']}",
            f"Validation fallback trades: {winner['audit']['fallbackValidationTrades']}",
            "",
        ])
    lines.extend(["Research only. No Production, LIVE, VPS or order state was changed.", ""])
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
        "developmentSurvivors": result["developmentSurvivors"],
        "validationSurvivors": result["validationSurvivors"],
        "winner": result["winner"],
        "topPolicies": result["topPolicies"][:3],
    }, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
