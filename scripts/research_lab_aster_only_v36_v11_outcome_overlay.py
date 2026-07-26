from __future__ import annotations

import argparse
import json
from collections import Counter
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import List, Optional, Sequence, Tuple

import research_lab_aster_only_v29_frozen_multi_signal_router as v29

STRATEGY_ID = "DISDEX_ASTER_ONLY_V36_V11_OUTCOME_OVERLAY"


@dataclass(frozen=True)
class Policy:
    policy_id: str
    source: str
    gate: str
    block_same_symbol: bool


POLICIES: Tuple[Policy, ...] = tuple(
    Policy(
        f"SRC_{source}__GATE_{gate}__{'BLOCK_SAME' if block else 'ALLOW_SAME'}",
        source,
        gate,
        block,
    )
    for source in ("V19", "ORB", "BREADTH", "BEST_AVAILABLE")
    for gate in (
        "NET_POSITIVE",
        "GROSS_25BPS",
        "NON_STOP",
        "POSITIVE_NON_STOP",
        "EXIT_WITHIN_2H",
        "POSITIVE_WITHIN_2H",
        "POSITIVE_CONVERGENCE",
    )
    for block in (False, True)
)


def finite(value, fallback: float = 0.0) -> float:
    return v29.finite(value, fallback)


def gate_pass(policy: Policy, primary: dict, net_value: float) -> bool:
    gross = finite(primary.get("grossReturn"))
    reason = str(primary.get("exitReason") or "")
    hours = finite(primary.get("holdingHours"), 99.0)
    non_stop = "STOP" not in reason.upper()
    converged = "CONVERGENCE" in reason.upper() or "CONVERGED" in reason.upper()
    return {
        "NET_POSITIVE": net_value > 0,
        "GROSS_25BPS": gross >= 0.0025,
        "NON_STOP": non_stop,
        "POSITIVE_NON_STOP": net_value > 0 and non_stop,
        "EXIT_WITHIN_2H": hours <= 2.0,
        "POSITIVE_WITHIN_2H": net_value > 0 and hours <= 2.0,
        "POSITIVE_CONVERGENCE": net_value > 0 and converged,
    }[policy.gate]


def overlay_candidates(policy: Policy, maps: dict, day: str, cost_bps: float) -> List[Tuple[dict, str]]:
    available: List[Tuple[dict, str]] = []
    for key, route in (
        ("v19", "V36_V19_OVERLAY"),
        ("orb", "V36_ORB_OVERLAY"),
        ("breadth", "V36_BREADTH_OVERLAY"),
    ):
        row = maps[key].get(day)
        if row is not None and v29.v22.trade_value(row, cost_bps) is not None:
            available.append((row, route))
    if policy.source == "BEST_AVAILABLE":
        return sorted(
            available,
            key=lambda item: (-v29.estimated_edge(item[0], cost_bps), item[1]),
        )
    target = {
        "V19": "V36_V19_OVERLAY",
        "ORB": "V36_ORB_OVERLAY",
        "BREADTH": "V36_BREADTH_OVERLAY",
    }[policy.source]
    return [item for item in available if item[1] == target]


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
    del micro_z_rows, micro_accel_rows
    allowed = set(days)
    maps = {
        "v11": {str(row["day"]): row for row in v11_rows if str(row["day"]) in allowed},
        "v19": {str(row["day"]): row for row in v19_rows if str(row["day"]) in allowed},
        "orb": {str(row["day"]): row for row in orb_rows if str(row["day"]) in allowed},
        "breadth": {str(row["day"]): row for row in breadth_rows if str(row["day"]) in allowed},
    }
    events: List[dict] = []
    stats: Counter = Counter()

    for day in sorted(allowed):
        primary = maps["v11"].get(day)
        if primary is not None:
            primary_value = v29.v22.trade_value(primary, cost_bps)
            if primary_value is not None:
                events.append({**primary, "netReturn": primary_value, "route": "V11_EQ_PRIMARY"})
                stats["V11_EQ_SELECTED"] += 1
                if not gate_pass(policy, primary, primary_value):
                    stats["V36_OUTCOME_GATE_REJECTED"] += 1
                    continue
                selected = overlay_candidates(policy, maps, day, cost_bps)
                overlay = selected[0] if selected else None
                if overlay is None:
                    stats["V36_NO_OVERLAY_CANDIDATE"] += 1
                    continue
                row, route = overlay
                if int(row["entryTs"]) < int(primary["exitTs"]):
                    stats["V36_OVERLAP_BLOCKED"] += 1
                    continue
                if policy.block_same_symbol and str(row.get("symbol")) == str(primary.get("symbol")):
                    stats["V36_SAME_SYMBOL_BLOCKED"] += 1
                    continue
                value = v29.v22.trade_value(row, cost_bps)
                if value is None:
                    stats["V36_COST_GATE_REJECTED"] += 1
                    continue
                events.append({**row, "netReturn": value, "route": route})
                stats[route + "_SELECTED"] += 1
                continue
            stats["V11_EQ_COST_GATE_REJECTED"] += 1

        fallback = maps["v19"].get(day)
        if fallback is not None:
            value = v29.v22.trade_value(fallback, cost_bps)
            if value is not None:
                events.append({**fallback, "netReturn": value, "route": "V19_FALLBACK"})
                stats["V19_FALLBACK_SELECTED"] += 1
            else:
                stats["V19_FALLBACK_COST_GATE_REJECTED"] += 1

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

    v26_features = v29.v26.build_features(warmup, aligned)
    v27_features = v29.v27.build_features(warmup, aligned, yahoo)
    v11_rows, v11_diag = v29.v22.build_v11eq(warmup, aligned)
    v19_rows = v29.v22.build_fallback(warmup, aligned)
    rows = {
        "v11_rows": v11_rows,
        "v19_rows": v19_rows,
        "micro_z_rows": [],
        "micro_accel_rows": [],
        "orb_rows": v29.label_rows(v29.v27.build_trades(v29.ORB, warmup, v27_features), "V36_ORB_OVERLAY"),
        "breadth_rows": v29.label_rows(v29.v26.build_trades(v29.BREADTH, warmup, v26_features), "V36_BREADTH_OVERLAY"),
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
    v29.combined_route = combined_route
    try:
        development_survivors = []
        diagnostics_rows = []
        for policy in POLICIES:
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
            item for item in development_survivors[:12]
            if v29.validation_pass(item[1], baseline)
        ]
        validation_survivors.sort(key=lambda item: v29.selection_score(item[1]), reverse=True)
    finally:
        v29.combined_route = original_route

    winner = validation_survivors[0] if validation_survivors else None
    status = "ASTER_ONLY_V36_NO_VALIDATED_V11_OUTCOME_OVERLAY"
    winner_payload = None
    if winner is not None:
        policy, result = winner
        accepted = result["allStrictHurdlesPassed"]
        status = "ASTER_ONLY_V36_VALIDATED_SHADOW_LEAD" if accepted else "ASTER_ONLY_V36_WINNER_DID_NOT_CLEAR_FINAL_AUDIT"
        winner_payload = {"policy": asdict(policy), "audit": result, "accepted": accepted}

    diagnostics_rows.sort(
        key=lambda row: row["audit"]["development"]["NORMAL"]["compoundedReturnPct"] + row["audit"]["development"]["P95"]["compoundedReturnPct"],
        reverse=True,
    )
    return v29.rounded({
        "version": 36,
        "strategyId": STRATEGY_ID,
        "status": status,
        "policyCount": len(POLICIES),
        "developmentSurvivors": len(development_survivors),
        "validationSurvivors": len(validation_survivors),
        "baseline": baseline,
        "winner": winner_payload,
        "topPolicies": diagnostics_rows[:12],
        "period": {
            "startInclusiveUtc": v29.v19.BT_START.isoformat(),
            "endExclusiveUtc": v29.v19.BT_END_EXCLUSIVE.isoformat(),
            "calendarDays": 365,
            "sessions": len(target),
            "holdoutSessions": len(holdout),
        },
        "architecture": {
            "venue": "ASTER_ONLY",
            "baselineRoutingPreserved": True,
            "maximumConcurrentGross": 1.0,
            "maximumConcurrentPositions": 1,
            "maximumOnePostV11Overlay": True,
            "v11EqPriority": True,
            "hyperliquidUsed": False,
        },
        "selectionDiscipline": {
            "signalComponentsRetuned": False,
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
        "# Aster-only V36 V11 Outcome Overlay",
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
        "topPolicies": result["topPolicies"][:5],
    }, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
