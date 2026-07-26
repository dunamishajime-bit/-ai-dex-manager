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

STRATEGY_ID = "DISDEX_ASTER_ONLY_V34_BASIS_BASKET_ROUTER"
SCENARIOS = v14.SCENARIOS
HOLDOUT_START = v20.HOLDOUT_START_DAY
ENTRY_SLOT = 2
TP_PCT = 0.75
SL_PCT = 1.00
BASELINE_NORMAL = 72.276908
BASELINE_P95 = 68.080022
BASELINE_FALLBACK_NORMAL = 7.813259
BASELINE_FALLBACK_P95 = 7.400908


@dataclass(frozen=True)
class Candidate:
    candidate_id: str
    basket_size: int
    z_threshold: float
    minimum_residual_bps: float
    maximum_holding_hours: int
    weight_mode: str
    direction_mode: str
    edge_mode: str


CANDIDATES: Tuple[Candidate, ...] = tuple(
    Candidate(
        f"K{k}__Z{z:g}__R{residual:g}__H{hours}__{weight}__{direction}__EDGE_{edge}",
        k,
        z,
        residual,
        hours,
        weight,
        direction,
        edge,
    )
    for k in (2, 3)
    for z in (1.5, 2.0, 2.5)
    for residual in (25.0, 35.0, 50.0)
    for hours in (1, 2, 3)
    for weight in ("EQUAL", "SCORE")
    for direction in ("BOTH", "PREMIUM_ONLY", "DISCOUNT_ONLY")
    for edge in ("WEIGHTED", "MINIMUM")
)


def finite(value: Any, fallback: float = 0.0) -> float:
    return v14.finite(value, fallback)


def allowed_direction(mode: str, residual: float) -> bool:
    return (
        mode == "BOTH"
        or (mode == "PREMIUM_ONLY" and residual > 0)
        or (mode == "DISCOUNT_ONLY" and residual < 0)
    )


def select_legs(candidate: Candidate, day_feature: dict) -> List[dict]:
    eligible: List[dict] = []
    for symbol in v14.SYMBOLS:
        symbol_row = day_feature["symbols"][symbol]
        point = symbol_row["points"][ENTRY_SLOT]
        residual = finite(point.get("residualBps"))
        zscore = finite(point.get("zscore"))
        if not point.get("historyReady"):
            continue
        if abs(zscore) < candidate.z_threshold or abs(residual) < candidate.minimum_residual_bps:
            continue
        if not allowed_direction(candidate.direction_mode, residual):
            continue
        eligible.append({
            "symbol": symbol,
            "side": -1 if residual > 0 else 1,
            "score": abs(zscore) * 100.0 + abs(residual),
            "edgeProxyBps": max(0.0, abs(residual) - 10.0),
            "residualBps": residual,
            "zscore": zscore,
            "symbolRow": symbol_row,
        })
    eligible.sort(key=lambda row: (-finite(row["score"]), str(row["symbol"])))
    return eligible[: candidate.basket_size] if len(eligible) >= candidate.basket_size else []


def weights(candidate: Candidate, legs: Sequence[dict]) -> List[float]:
    if candidate.weight_mode == "EQUAL":
        return [1.0 / len(legs)] * len(legs)
    total = sum(max(1e-9, finite(leg["score"])) for leg in legs)
    return [max(1e-9, finite(leg["score"])) / total for leg in legs]


def simulate_leg(candidate: Candidate, leg: dict, weight: float) -> dict:
    symbol_row = leg["symbolRow"]
    points = symbol_row["points"]
    entry = points[ENTRY_SLOT]
    final_index = min(len(points) - 1, ENTRY_SLOT + candidate.maximum_holding_hours)
    chosen = points[final_index]
    reason = f"TIME_{candidate.maximum_holding_hours}H"
    side = int(leg["side"])
    entry_price = finite(entry["price"])
    for point in points[ENTRY_SLOT + 1: final_index + 1]:
        value = side * (finite(point["price"]) / entry_price - 1.0)
        if value >= TP_PCT / 100.0:
            chosen, reason = point, "PRICE_TAKE_PROFIT"
            break
        if value <= -SL_PCT / 100.0:
            chosen, reason = point, "PRICE_STOP"
            break
    entry_ts = int(entry["ts"])
    exit_ts = int(chosen["ts"])
    price_return = side * (finite(chosen["price"]) / entry_price - 1.0)
    funding_return = (-side) * v14.funding_mod.funding_between(
        symbol_row["fundingPoints"], entry_ts, exit_ts
    )
    return {
        "symbol": str(leg["symbol"]),
        "side": side,
        "weight": weight,
        "entryTs": entry_ts,
        "exitTs": exit_ts,
        "holdingHours": max(0.0, (exit_ts - entry_ts) / 3_600_000.0),
        "priceReturn": price_return,
        "fundingReturn": funding_return,
        "grossReturn": price_return + funding_return,
        "edgeProxyBps": finite(leg["edgeProxyBps"]),
        "residualBps": finite(leg["residualBps"]),
        "zscore": finite(leg["zscore"]),
        "exitReason": reason,
    }


def build_trade(candidate: Candidate, day: str, day_feature: dict) -> Optional[dict]:
    selected = select_legs(candidate, day_feature)
    if not selected:
        return None
    leg_weights = weights(candidate, selected)
    legs = [simulate_leg(candidate, leg, weight) for leg, weight in zip(selected, leg_weights)]
    weighted_edge = sum(leg["weight"] * leg["edgeProxyBps"] for leg in legs)
    minimum_edge = min(leg["edgeProxyBps"] for leg in legs)
    return {
        "strategy": "V34_BASIS_BASKET_FALLBACK",
        "candidateId": candidate.candidate_id,
        "day": day,
        "symbol": "+".join(leg["symbol"] for leg in legs),
        "side": 0,
        "gross": 1.0,
        "entryTs": min(leg["entryTs"] for leg in legs),
        "exitTs": max(leg["exitTs"] for leg in legs),
        "holdingHours": sum(leg["weight"] * leg["holdingHours"] for leg in legs),
        "grossReturn": sum(leg["weight"] * leg["grossReturn"] for leg in legs),
        "priceReturn": sum(leg["weight"] * leg["priceReturn"] for leg in legs),
        "fundingReturn": sum(leg["weight"] * leg["fundingReturn"] for leg in legs),
        "edgeProxyBps": weighted_edge if candidate.edge_mode == "WEIGHTED" else minimum_edge,
        "exitReason": "BASKET_LEGS",
        "legs": legs,
    }


def build_trades(candidate: Candidate, days: Sequence[str], features: Dict[str, dict]) -> List[dict]:
    return [
        trade
        for day in days
        if (trade := build_trade(candidate, day, features[day])) is not None
    ]


def event_metrics(events: Sequence[dict]) -> dict:
    result = v22.metrics(events)
    gains: Dict[str, float] = defaultdict(float)
    total_gain = 0.0
    underlying_counts: Counter = Counter()
    for row in events:
        value = finite(row.get("netReturn"))
        if row.get("legs"):
            for leg in row["legs"]:
                symbol = str(leg["symbol"])
                underlying_counts[symbol] += 1
                if value > 0:
                    share = value * finite(leg["weight"])
                    gains[symbol] += share
                    total_gain += share
        else:
            symbol = str(row.get("symbol") or "UNKNOWN")
            underlying_counts[symbol] += 1
            if value > 0:
                gains[symbol] += value
                total_gain += value
    result["maximumPositiveProfitSymbolShare"] = (
        max(gains.values()) / total_gain if gains and total_gain > 0 else 0.0
    )
    result["underlyingSymbolCounts"] = dict(sorted(underlying_counts.items()))
    return result


def route_candidate(
    v11_rows: Sequence[dict], basket_rows: Sequence[dict], cost_bps: float, days: Sequence[str]
) -> Tuple[List[dict], dict]:
    events, stats = v22.route(v11_rows, basket_rows, cost_bps, days, True)
    relabeled = [
        {**row, "route": "V34_BASIS_BASKET_FALLBACK"}
        if row.get("route") == "V19_FALLBACK" else row
        for row in events
    ]
    if "V19_FALLBACK_SELECTED" in stats:
        stats["V34_BASIS_BASKET_SELECTED"] = stats.pop("V19_FALLBACK_SELECTED")
    if "V19_FALLBACK_COST_GATE_REJECTED" in stats:
        stats["V34_BASIS_BASKET_COST_GATE_REJECTED"] = stats.pop("V19_FALLBACK_COST_GATE_REJECTED")
    return relabeled, stats


def scenario_set(v11_rows: Sequence[dict], rows: Sequence[dict], days: Sequence[str]) -> Tuple[dict, dict]:
    results, routing = {}, {}
    for name, cost in SCENARIOS.items():
        events, stats = route_candidate(v11_rows, rows, cost, days)
        results[name] = event_metrics(events)
        routing[name] = stats
    return results, routing


def component_metrics(events: Sequence[dict]) -> dict:
    return event_metrics([
        row for row in events if row.get("route") == "V34_BASIS_BASKET_FALLBACK"
    ])


def audit(
    v11_rows: Sequence[dict], rows: Sequence[dict], target: Sequence[str],
    development: Sequence[str], validation: Sequence[str], final: Sequence[str],
    holdout: Sequence[str],
) -> dict:
    full, routing = scenario_set(v11_rows, rows, target)
    dev, _ = scenario_set(v11_rows, rows, development)
    val, val_routing = scenario_set(v11_rows, rows, validation)
    fin, _ = scenario_set(v11_rows, rows, final)
    hol, _ = scenario_set(v11_rows, rows, holdout)
    normal_events, _ = route_candidate(v11_rows, rows, SCENARIOS["NORMAL"], target)
    p95_events, _ = route_candidate(v11_rows, rows, SCENARIOS["P95"], target)
    normal_month_events, normal_month = v22.remove_best_month(normal_events)
    p95_month_events, p95_month = v22.remove_best_month(p95_events)
    fallback_normal = component_metrics(normal_events)
    fallback_p95 = component_metrics(p95_events)
    validation_basket_trades = int(
        val_routing["NORMAL"].get("V34_BASIS_BASKET_SELECTED", 0)
    )
    normal, p95 = full["NORMAL"], full["P95"]
    checks = {
        "developmentNormalAndP95Positive": dev["NORMAL"]["compoundedReturnPct"] > 0 and dev["P95"]["compoundedReturnPct"] > 0,
        "validationMinimumEightNormalTrades": val["NORMAL"]["trades"] >= 8,
        "validationMinimumFourBasketTrades": validation_basket_trades >= 4,
        "validationNormalProfitFactorAtLeast1_2": (val["NORMAL"]["profitFactor"] or 0.0) >= 1.20,
        "validationNormalAndP95Positive": val["NORMAL"]["compoundedReturnPct"] > 0 and val["P95"]["compoundedReturnPct"] > 0,
        "finalNormalAndP95Positive": fin["NORMAL"]["compoundedReturnPct"] > 0 and fin["P95"]["compoundedReturnPct"] > 0,
        "holdoutMinimumTrades": hol["NORMAL"]["trades"] >= v20.STRICT_HURDLES["minimumHoldoutTrades"],
        "holdoutNormalAndP95Positive": hol["NORMAL"]["compoundedReturnPct"] > 0 and hol["P95"]["compoundedReturnPct"] > 0,
        "normalAboveV22": normal["compoundedReturnPct"] > BASELINE_NORMAL,
        "p95AboveV22": p95["compoundedReturnPct"] > BASELINE_P95,
        "fallbackNormalAboveV19": fallback_normal["compoundedReturnPct"] > BASELINE_FALLBACK_NORMAL,
        "fallbackP95AboveV19": fallback_p95["compoundedReturnPct"] > BASELINE_FALLBACK_P95,
        "normalProfitFactorAtLeast1_5": (normal["profitFactor"] or 0.0) >= 1.50,
        "normalDrawdownNoWorseThanMinus15Pct": normal["maxDrawdownPct"] >= -15.0,
        "normalMinimumFiftyTrades": normal["trades"] >= 50,
        "positiveProfitConcentrationAtMost40Pct": normal["maximumPositiveProfitSymbolShare"] <= 0.40,
        "bestTradeRemovedNormalAndP95Positive": event_metrics(v22.remove_best(normal_events))["compoundedReturnPct"] > 0 and event_metrics(v22.remove_best(p95_events))["compoundedReturnPct"] > 0,
        "bestMonthRemovedNormalAndP95Positive": event_metrics(normal_month_events)["compoundedReturnPct"] > 0 and event_metrics(p95_month_events)["compoundedReturnPct"] > 0,
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
        "validationBasketTrades": validation_basket_trades,
        "fallbackFull": {"NORMAL": fallback_normal, "P95": fallback_p95},
        "checks": checks,
        "allStrictHurdlesPassed": all(checks.values()),
        "robustness": {
            "normalBestTradeRemoved": event_metrics(v22.remove_best(normal_events)),
            "p95BestTradeRemoved": event_metrics(v22.remove_best(p95_events)),
            "normalBestMonthRemoved": {"month": normal_month, "metrics": event_metrics(normal_month_events)},
            "p95BestMonthRemoved": {"month": p95_month, "metrics": event_metrics(p95_month_events)},
        },
    }


def development_pass(result: dict, baseline: dict) -> bool:
    dev, base = result["development"], baseline["development"]
    return (
        dev["NORMAL"]["trades"] >= base["NORMAL"]["trades"]
        and dev["NORMAL"]["compoundedReturnPct"] > base["NORMAL"]["compoundedReturnPct"]
        and dev["P95"]["compoundedReturnPct"] > base["P95"]["compoundedReturnPct"]
        and (dev["NORMAL"]["profitFactor"] or 0.0) >= 1.30
    )


def validation_pass(result: dict, baseline: dict) -> bool:
    val, base = result["validation"], baseline["validation"]
    return (
        val["NORMAL"]["trades"] >= 8
        and result["validationBasketTrades"] >= 4
        and val["NORMAL"]["compoundedReturnPct"] > base["NORMAL"]["compoundedReturnPct"]
        and val["P95"]["compoundedReturnPct"] > base["P95"]["compoundedReturnPct"]
        and (val["NORMAL"]["profitFactor"] or 0.0) >= 1.20
    )


def selection_score(result: dict, baseline: dict) -> float:
    val, base = result["validation"], baseline["validation"]
    return (
        val["NORMAL"]["compoundedReturnPct"] - base["NORMAL"]["compoundedReturnPct"]
        + val["P95"]["compoundedReturnPct"] - base["P95"]["compoundedReturnPct"]
        + 0.10 * result["validationBasketTrades"]
        - 0.25 * abs(val["NORMAL"]["maxDrawdownPct"])
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
        v11_rows,
        v19_rows,
        target,
        splits["DEVELOPMENT"],
        splits["VALIDATION"],
        splits["FINAL_REUSED"],
        holdout,
        True,
    )

    development_survivors = []
    diagnostics = []
    for candidate in CANDIDATES:
        rows = build_trades(candidate, warmup, features)
        result = audit(
            v11_rows,
            rows,
            target,
            splits["DEVELOPMENT"],
            splits["VALIDATION"],
            splits["FINAL_REUSED"],
            holdout,
        )
        diagnostics.append({
            "candidate": asdict(candidate),
            "rawTrades": len(rows),
            "development": result["development"],
            "validation": result["validation"],
            "validationBasketTrades": result["validationBasketTrades"],
        })
        if development_pass(result, baseline):
            development_survivors.append((candidate, rows, result))

    development_survivors.sort(
        key=lambda item: item[2]["development"]["NORMAL"]["compoundedReturnPct"] + item[2]["development"]["P95"]["compoundedReturnPct"],
        reverse=True,
    )
    validation_survivors = [
        item for item in development_survivors[:60]
        if validation_pass(item[2], baseline)
    ]
    validation_survivors.sort(key=lambda item: selection_score(item[2], baseline), reverse=True)
    winner = validation_survivors[0] if validation_survivors else None
    status = "ASTER_ONLY_V34_NO_VALIDATED_BASIS_BASKET"
    winner_payload = None
    if winner is not None:
        candidate, rows, result = winner
        accepted = result["allStrictHurdlesPassed"]
        status = "ASTER_ONLY_V34_VALIDATED_SHADOW_LEAD" if accepted else "ASTER_ONLY_V34_WINNER_DID_NOT_CLEAR_FINAL_AUDIT"
        winner_payload = {
            "candidate": asdict(candidate),
            "rawTrades": len(rows),
            "accepted": accepted,
            "audit": result,
        }

    diagnostics.sort(
        key=lambda item: item["development"]["NORMAL"]["compoundedReturnPct"] + item["development"]["P95"]["compoundedReturnPct"],
        reverse=True,
    )
    return v14.rounded({
        "version": 34,
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
            "calendarDays": (v19.BT_END_EXCLUSIVE - v19.BT_START).days,
            "targetSessions": len(target),
            "holdoutSessions": len(holdout),
        },
        "architecture": {
            "venue": "ASTER_ONLY",
            "entryNy": "12:30",
            "maximumConcurrentGross": 1.0,
            "maximumConcurrentPositions": 3,
            "basketGrossSharedAcrossLegs": True,
            "v11EqPriority": True,
            "hyperliquidUsed": False,
        },
        "selectionDiscipline": {
            "candidateCountFrozenBeforeExecution": True,
            "developmentSelectsTopSixty": True,
            "validationSelectsAtMostOne": True,
            "finalAndHoldoutUsedForSelection": False,
            "sameHistoryReusedNotIndependent": True,
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
        "# Aster-only V34 Basis Basket Router",
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
            f"Router Normal: {audit_result['full']['NORMAL']['compoundedReturnPct']:.6f}%",
            f"Router P95: {audit_result['full']['P95']['compoundedReturnPct']:.6f}%",
            f"Basket Normal: {audit_result['fallbackFull']['NORMAL']['compoundedReturnPct']:.6f}%",
            f"Basket P95: {audit_result['fallbackFull']['P95']['compoundedReturnPct']:.6f}%",
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
        "candidateCount": result["candidateCount"],
        "developmentSurvivors": result["developmentSurvivors"],
        "validationSurvivors": result["validationSurvivors"],
        "winner": result["winner"],
        "topDevelopmentDiagnostics": result["topDevelopmentDiagnostics"][:5],
    }, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
