from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import research_lab_aster_only_v14_replacement_tournament as v14
import research_lab_aster_only_v15_intraday_shock_tournament as v15
import research_lab_aster_only_v19_trailing_one_year_bt as v19
import research_lab_aster_only_v20_strict_hurdle_tournament as v20
import research_lab_aster_only_v22_v11eq_primary_v19_fallback as v22

STRATEGY_ID = "DISDEX_ASTER_ONLY_V37_ABSOLUTE_BASIS_IDLE_OVERLAY"
SCENARIOS = v14.SCENARIOS
HOLDOUT_START = v20.HOLDOUT_START_DAY
TARGET_BASIS_BPS = 15.0
STOP_MULTIPLE = 1.5
BASELINE_NORMAL = 72.276908
BASELINE_P95 = 68.080022
BASELINE_FALLBACK_NORMAL = 7.813259
BASELINE_FALLBACK_P95 = 7.400908


@dataclass(frozen=True)
class Candidate:
    candidate_id: str
    entry_slot: int
    minimum_basis_bps: float
    minimum_zscore: float
    maximum_holding_hours: int
    direction_mode: str


CANDIDATES: Tuple[Candidate, ...] = tuple(
    Candidate(
        f"SLOT_{slot}__B{basis:g}__Z{z:g}__H{hours}__{direction}",
        slot,
        basis,
        z,
        hours,
        direction,
    )
    for slot in (1, 2, 3)
    for basis in (50.0, 75.0, 100.0)
    for z in (0.0, 1.5, 2.0)
    for hours in (1, 2)
    for direction in ("BOTH", "PREMIUM_ONLY", "DISCOUNT_ONLY")
)


def finite(value: Any, fallback: float = 0.0) -> float:
    return v14.finite(value, fallback)


def direction_allowed(mode: str, basis: float) -> bool:
    return (
        mode == "BOTH"
        or (mode == "PREMIUM_ONLY" and basis > 0)
        or (mode == "DISCOUNT_ONLY" and basis < 0)
    )


def select_signal(candidate: Candidate, day_feature: dict) -> Optional[Tuple[str, dict]]:
    ranked: List[Tuple[float, str, dict]] = []
    for symbol in v14.SYMBOLS:
        symbol_row = day_feature["symbols"][symbol]
        point = symbol_row["points"][candidate.entry_slot]
        basis = finite(point.get("basisBps"))
        ranked.append((abs(basis), symbol, symbol_row))
    if not ranked:
        return None
    _strength, symbol, symbol_row = sorted(ranked, key=lambda item: (-item[0], item[1]))[0]
    point = symbol_row["points"][candidate.entry_slot]
    basis = finite(point.get("basisBps"))
    zscore = finite(point.get("zscore"))
    if not point.get("historyReady"):
        return None
    if abs(basis) < candidate.minimum_basis_bps:
        return None
    if candidate.minimum_zscore > 0 and abs(zscore) < candidate.minimum_zscore:
        return None
    if not direction_allowed(candidate.direction_mode, basis):
        return None
    return symbol, symbol_row


def build_trade(candidate: Candidate, day: str, day_feature: dict) -> Optional[dict]:
    selected = select_signal(candidate, day_feature)
    if selected is None:
        return None
    symbol, symbol_row = selected
    points = symbol_row["points"]
    entry = points[candidate.entry_slot]
    entry_basis = finite(entry["basisBps"])
    side = -1 if entry_basis > 0 else 1
    final_index = min(len(points) - 1, candidate.entry_slot + candidate.maximum_holding_hours)
    chosen = points[final_index]
    reason = f"TIME_{candidate.maximum_holding_hours}H"
    for point in points[candidate.entry_slot + 1: final_index + 1]:
        current_basis = finite(point["basisBps"])
        converged = abs(current_basis) <= TARGET_BASIS_BPS or current_basis * entry_basis <= 0
        stopped = abs(current_basis) >= STOP_MULTIPLE * abs(entry_basis)
        if converged or stopped:
            chosen = point
            reason = "BASIS_CONVERGED" if converged else "BASIS_STOP"
            break
    entry_ts = int(entry["ts"])
    exit_ts = int(chosen["ts"])
    entry_price = finite(entry["price"])
    exit_price = finite(chosen["price"])
    price_return = side * (exit_price / entry_price - 1.0)
    funding_return = (-side) * v14.funding_mod.funding_between(
        symbol_row["fundingPoints"], entry_ts, exit_ts
    )
    return {
        "strategy": "V37_ABSOLUTE_BASIS_OVERLAY",
        "candidateId": candidate.candidate_id,
        "day": day,
        "symbol": symbol,
        "side": side,
        "gross": 1.0,
        "entryTs": entry_ts,
        "exitTs": exit_ts,
        "holdingHours": max(0.0, (exit_ts - entry_ts) / 3_600_000.0),
        "entryBasisBps": entry_basis,
        "entryZscore": finite(entry.get("zscore")),
        "edgeProxyBps": max(0.0, abs(entry_basis) - TARGET_BASIS_BPS),
        "priceReturn": price_return,
        "fundingReturn": funding_return,
        "grossReturn": price_return + funding_return,
        "exitReason": reason,
    }


def build_trades(candidate: Candidate, days: Sequence[str], features: Dict[str, dict]) -> List[dict]:
    return [
        trade
        for day in days
        if (trade := build_trade(candidate, day, features[day])) is not None
    ]


def route(
    v11_rows: Sequence[dict],
    v19_rows: Sequence[dict],
    overlay_rows: Sequence[dict],
    cost_bps: float,
    days: Sequence[str],
) -> Tuple[List[dict], dict]:
    baseline_events, baseline_stats = v22.route(v11_rows, v19_rows, cost_bps, days, True)
    baseline_by_day = {str(row["day"]): row for row in baseline_events}
    overlay_by_day = {str(row["day"]): row for row in overlay_rows if str(row["day"]) in set(days)}
    events = list(baseline_events)
    stats = Counter(baseline_stats)
    for day in sorted(set(days)):
        overlay = overlay_by_day.get(day)
        if overlay is None:
            continue
        value = v22.trade_value(overlay, cost_bps)
        if value is None:
            stats["V37_COST_GATE_REJECTED"] += 1
            continue
        baseline = baseline_by_day.get(day)
        if baseline is not None:
            if int(overlay["entryTs"]) < int(baseline["exitTs"]):
                stats["V37_BASELINE_OVERLAP_BLOCKED"] += 1
                continue
            if finite(baseline.get("netReturn")) <= -0.02:
                stats["V37_DAILY_LOSS_BLOCKED"] += 1
                continue
        events.append({**overlay, "netReturn": value, "route": "V37_ABSOLUTE_BASIS_OVERLAY"})
        stats["V37_ABSOLUTE_BASIS_OVERLAY_SELECTED"] += 1
    return sorted(events, key=lambda row: (int(row["entryTs"]), int(row["exitTs"]), str(row["route"]))), dict(stats)


def metrics(events: Sequence[dict]) -> dict:
    return v22.metrics(events)


def scenario_set(
    v11_rows: Sequence[dict], v19_rows: Sequence[dict], overlay_rows: Sequence[dict], days: Sequence[str]
) -> Tuple[dict, dict]:
    results, routing = {}, {}
    for name, cost in SCENARIOS.items():
        events, stats = route(v11_rows, v19_rows, overlay_rows, cost, days)
        results[name] = metrics(events)
        routing[name] = stats
    return results, routing


def overlay_component(events: Sequence[dict]) -> dict:
    return metrics([row for row in events if row.get("route") != "V11_EQ_PRIMARY"])


def audit(
    v11_rows: Sequence[dict], v19_rows: Sequence[dict], overlay_rows: Sequence[dict],
    target: Sequence[str], development: Sequence[str], validation: Sequence[str],
    final: Sequence[str], holdout: Sequence[str],
) -> dict:
    full, routing = scenario_set(v11_rows, v19_rows, overlay_rows, target)
    dev, dev_routing = scenario_set(v11_rows, v19_rows, overlay_rows, development)
    val, val_routing = scenario_set(v11_rows, v19_rows, overlay_rows, validation)
    fin, _ = scenario_set(v11_rows, v19_rows, overlay_rows, final)
    hol, _ = scenario_set(v11_rows, v19_rows, overlay_rows, holdout)
    normal_events, _ = route(v11_rows, v19_rows, overlay_rows, SCENARIOS["NORMAL"], target)
    p95_events, _ = route(v11_rows, v19_rows, overlay_rows, SCENARIOS["P95"], target)
    normal_month_events, normal_month = v22.remove_best_month(normal_events)
    p95_month_events, p95_month = v22.remove_best_month(p95_events)
    fallback_normal = overlay_component(normal_events)
    fallback_p95 = overlay_component(p95_events)
    dev_overlay = int(dev_routing["NORMAL"].get("V37_ABSOLUTE_BASIS_OVERLAY_SELECTED", 0))
    val_overlay = int(val_routing["NORMAL"].get("V37_ABSOLUTE_BASIS_OVERLAY_SELECTED", 0))
    checks = {
        "developmentNormalAndP95Positive": dev["NORMAL"]["compoundedReturnPct"] > 0 and dev["P95"]["compoundedReturnPct"] > 0,
        "validationMinimumEightNormalTrades": val["NORMAL"]["trades"] >= 8,
        "validationMinimumFourOverlayTrades": val_overlay >= 4,
        "validationNormalProfitFactorAtLeast1_2": (val["NORMAL"]["profitFactor"] or 0.0) >= 1.20,
        "validationNormalAndP95Positive": val["NORMAL"]["compoundedReturnPct"] > 0 and val["P95"]["compoundedReturnPct"] > 0,
        "finalNormalAndP95Positive": fin["NORMAL"]["compoundedReturnPct"] > 0 and fin["P95"]["compoundedReturnPct"] > 0,
        "holdoutMinimumTrades": hol["NORMAL"]["trades"] >= v20.STRICT_HURDLES["minimumHoldoutTrades"],
        "holdoutNormalAndP95Positive": hol["NORMAL"]["compoundedReturnPct"] > 0 and hol["P95"]["compoundedReturnPct"] > 0,
        "normalAboveV22": full["NORMAL"]["compoundedReturnPct"] > BASELINE_NORMAL,
        "p95AboveV22": full["P95"]["compoundedReturnPct"] > BASELINE_P95,
        "fallbackNormalAboveV19": fallback_normal["compoundedReturnPct"] > BASELINE_FALLBACK_NORMAL,
        "fallbackP95AboveV19": fallback_p95["compoundedReturnPct"] > BASELINE_FALLBACK_P95,
        "normalProfitFactorAtLeast1_5": (full["NORMAL"]["profitFactor"] or 0.0) >= 1.50,
        "normalDrawdownNoWorseThanMinus15Pct": full["NORMAL"]["maxDrawdownPct"] >= -15.0,
        "normalMinimumFiftyTrades": full["NORMAL"]["trades"] >= 50,
        "positiveProfitConcentrationAtMost40Pct": full["NORMAL"]["maximumPositiveProfitSymbolShare"] <= 0.40,
        "bestTradeRemovedNormalAndP95Positive": metrics(v22.remove_best(normal_events))["compoundedReturnPct"] > 0 and metrics(v22.remove_best(p95_events))["compoundedReturnPct"] > 0,
        "bestMonthRemovedNormalAndP95Positive": metrics(normal_month_events)["compoundedReturnPct"] > 0 and metrics(p95_month_events)["compoundedReturnPct"] > 0,
        "severeFailClosedNonnegative": full["SEVERE"]["compoundedReturnPct"] >= 0,
    }
    return {
        "full": full,
        "development": dev,
        "validation": val,
        "finalReused": fin,
        "holdout": hol,
        "routing": routing,
        "developmentRouting": dev_routing,
        "validationRouting": val_routing,
        "developmentOverlayTrades": dev_overlay,
        "validationOverlayTrades": val_overlay,
        "fallbackFull": {"NORMAL": fallback_normal, "P95": fallback_p95},
        "checks": checks,
        "allStrictHurdlesPassed": all(checks.values()),
        "robustness": {
            "normalBestTradeRemoved": metrics(v22.remove_best(normal_events)),
            "p95BestTradeRemoved": metrics(v22.remove_best(p95_events)),
            "normalBestMonthRemoved": {"month": normal_month, "metrics": metrics(normal_month_events)},
            "p95BestMonthRemoved": {"month": p95_month, "metrics": metrics(p95_month_events)},
        },
    }


def development_pass(result: dict, baseline: dict) -> bool:
    return (
        result["developmentOverlayTrades"] >= 6
        and result["development"]["NORMAL"]["compoundedReturnPct"] > baseline["development"]["NORMAL"]["compoundedReturnPct"]
        and result["development"]["P95"]["compoundedReturnPct"] > baseline["development"]["P95"]["compoundedReturnPct"]
        and (result["development"]["NORMAL"]["profitFactor"] or 0.0) >= 1.30
    )


def validation_pass(result: dict, baseline: dict) -> bool:
    return (
        result["validation"]["NORMAL"]["trades"] >= 8
        and result["validationOverlayTrades"] >= 4
        and result["validation"]["NORMAL"]["compoundedReturnPct"] > baseline["validation"]["NORMAL"]["compoundedReturnPct"]
        and result["validation"]["P95"]["compoundedReturnPct"] > baseline["validation"]["P95"]["compoundedReturnPct"]
        and (result["validation"]["NORMAL"]["profitFactor"] or 0.0) >= 1.20
    )


def selection_score(result: dict, baseline: dict) -> float:
    return (
        result["validation"]["NORMAL"]["compoundedReturnPct"] - baseline["validation"]["NORMAL"]["compoundedReturnPct"]
        + result["validation"]["P95"]["compoundedReturnPct"] - baseline["validation"]["P95"]["compoundedReturnPct"]
        + 0.20 * result["validationOverlayTrades"]
        - 0.25 * abs(result["validation"]["NORMAL"]["maxDrawdownPct"])
    )


def analyze(cache_root: Path) -> dict:
    v14.base.verify_source(v14.base.V11_ROOT, v14.base.V11_SOURCE_SHA)
    v14.base.verify_source(v14.base.V13_ROOT, v14.base.V13_SOURCE_SHA)
    v19.configure_exact_data_window()
    days, aligned, data_diag = v19.v17.load_all(cache_root)
    warmup = [day for day in days if v19.WARMUP_START.date().isoformat() <= day < v19.BT_END_DAY_EXCLUSIVE]
    target = [day for day in warmup if v19.BT_START_DAY <= day < v19.BT_END_DAY_EXCLUSIVE]
    pre_holdout = [day for day in target if day < HOLDOUT_START]
    holdout = [day for day in target if day >= HOLDOUT_START]
    splits = v14.split_days(pre_holdout)
    features = v15.build_slot_features(warmup, aligned)
    v11_rows, v11_diag = v22.build_v11eq(warmup, aligned)
    v19_rows = v22.build_fallback(warmup, aligned)
    baseline = v22.audit(
        v11_rows, v19_rows, target,
        splits["DEVELOPMENT"], splits["VALIDATION"], splits["FINAL_REUSED"], holdout, True,
    )

    development_survivors = []
    diagnostics = []
    for candidate in CANDIDATES:
        rows = build_trades(candidate, warmup, features)
        result = audit(
            v11_rows, v19_rows, rows, target,
            splits["DEVELOPMENT"], splits["VALIDATION"], splits["FINAL_REUSED"], holdout,
        )
        diagnostics.append({
            "candidate": asdict(candidate),
            "rawTrades": len(rows),
            "development": result["development"],
            "validation": result["validation"],
            "developmentOverlayTrades": result["developmentOverlayTrades"],
            "validationOverlayTrades": result["validationOverlayTrades"],
        })
        if development_pass(result, baseline):
            development_survivors.append((candidate, rows, result))
    development_survivors.sort(
        key=lambda item: item[2]["development"]["NORMAL"]["compoundedReturnPct"] + item[2]["development"]["P95"]["compoundedReturnPct"],
        reverse=True,
    )
    validation_survivors = [
        item for item in development_survivors[:40]
        if validation_pass(item[2], baseline)
    ]
    validation_survivors.sort(key=lambda item: selection_score(item[2], baseline), reverse=True)
    winner = validation_survivors[0] if validation_survivors else None
    status = "ASTER_ONLY_V37_NO_VALIDATED_ABSOLUTE_BASIS_OVERLAY"
    winner_payload = None
    if winner is not None:
        candidate, rows, result = winner
        accepted = result["allStrictHurdlesPassed"]
        status = "ASTER_ONLY_V37_VALIDATED_SHADOW_LEAD" if accepted else "ASTER_ONLY_V37_WINNER_DID_NOT_CLEAR_FINAL_AUDIT"
        winner_payload = {
            "candidate": asdict(candidate),
            "rawTrades": len(rows),
            "accepted": accepted,
            "audit": result,
        }

    diagnostics.sort(
        key=lambda row: row["development"]["NORMAL"]["compoundedReturnPct"] + row["development"]["P95"]["compoundedReturnPct"],
        reverse=True,
    )
    return v14.rounded({
        "version": 37,
        "strategyId": STRATEGY_ID,
        "status": status,
        "candidateCount": len(CANDIDATES),
        "developmentSurvivors": len(development_survivors),
        "validationSurvivors": len(validation_survivors),
        "winner": winner_payload,
        "baseline": baseline,
        "topDevelopmentDiagnostics": diagnostics[:15],
        "period": {
            "startInclusiveUtc": v19.BT_START.isoformat(),
            "endExclusiveUtc": v19.BT_END_EXCLUSIVE.isoformat(),
            "calendarDays": 365,
            "targetSessions": len(target),
            "holdoutSessions": len(holdout),
        },
        "architecture": {
            "venue": "ASTER_ONLY",
            "baselineV11AndV19Preserved": True,
            "maximumConcurrentGross": 1.0,
            "maximumConcurrentPositions": 1,
            "maximumOneOverlayPerDay": True,
            "overlayOnlyWhenBaselineIdleOrExited": True,
            "v11EqPriority": True,
            "v19Priority": True,
            "hyperliquidUsed": False,
        },
        "selectionDiscipline": {
            "candidateCountFrozenBeforeExecution": True,
            "developmentSelectsTopForty": True,
            "validationSelectsAtMostOne": True,
            "finalAndHoldoutUsedForSelection": False,
            "productionPromotionAllowed": False,
        },
        "data": data_diag,
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
        "# Aster-only V37 Absolute Basis Idle Overlay",
        "",
        f"Status: **{result['status']}**",
        "",
        f"Candidates: {result['candidateCount']}",
        f"Development survivors: {result['developmentSurvivors']}",
        f"Validation survivors: {result['validationSurvivors']}",
        "",
    ]
    if result["winner"]:
        winner = result["winner"]
        audit_result = winner["audit"]
        lines.extend([
            f"Winner: `{winner['candidate']['candidate_id']}`",
            f"Accepted: {winner['accepted']}",
            f"Normal: {audit_result['full']['NORMAL']['compoundedReturnPct']:.6f}%",
            f"P95: {audit_result['full']['P95']['compoundedReturnPct']:.6f}%",
            f"Fallback Normal: {audit_result['fallbackFull']['NORMAL']['compoundedReturnPct']:.6f}%",
            f"Fallback P95: {audit_result['fallbackFull']['P95']['compoundedReturnPct']:.6f}%",
            f"Validation overlays: {audit_result['validationOverlayTrades']}",
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
        "topDevelopmentDiagnostics": result["topDevelopmentDiagnostics"][:5],
    }, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
