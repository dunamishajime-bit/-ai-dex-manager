from __future__ import annotations

import argparse
import json
import statistics
from collections import Counter
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import research_lab_aster_only_v14_replacement_tournament as v14
import research_lab_aster_only_v15_intraday_shock_tournament as v15
import research_lab_aster_only_v19_trailing_one_year_bt as v19
import research_lab_aster_only_v20_strict_hurdle_tournament as v20
import research_lab_aster_only_v22_v11eq_primary_v19_fallback as v22

STRATEGY_ID = "DISDEX_ASTER_ONLY_V26_NONBASIS_FALLBACK_TOURNAMENT"
SCENARIOS = v14.SCENARIOS
SYMBOLS = v14.SYMBOLS
HOLDOUT_START = v20.HOLDOUT_START_DAY
BASELINE_NORMAL = 72.276908
BASELINE_P95 = 68.080022
BASELINE_FALLBACK_NORMAL = 7.813259
BASELINE_FALLBACK_P95 = 7.400908
TP_PCT = 0.75
SL_PCT = 1.00


@dataclass(frozen=True)
class Candidate:
    candidate_id: str
    family: str
    threshold: float
    lag_threshold: float
    slot: int
    maximum_holding_hours: int


CANDIDATES: Tuple[Candidate, ...] = tuple(
    [
        Candidate(f"CASH_LEAD_CONT__C{cash:g}__L{lag:g}__S{slot}__H{hours}", "CASH_LEAD_CONT", cash, lag, slot, hours)
        for cash in (40.0, 70.0, 100.0) for lag in (15.0, 30.0)
        for slot in (1, 2, 3) for hours in (1, 2)
    ]
    + [
        Candidate(f"CASH_PERP_DISAGREE__T{threshold:g}__S{slot}__H{hours}", "CASH_PERP_DISAGREE", threshold, 0.0, slot, hours)
        for threshold in (40.0, 70.0, 100.0) for slot in (1, 2, 3) for hours in (1, 2)
    ]
    + [
        Candidate(f"BREADTH_LAG__B{breadth:g}__L{lag:g}__S{slot}__H{hours}", "BREADTH_LAG", breadth, lag, slot, hours)
        for breadth in (25.0, 40.0, 60.0) for lag in (15.0, 30.0)
        for slot in (1, 2, 3) for hours in (1, 2)
    ]
    + [
        Candidate(f"CROSS_MOMENTUM__X{spread:g}__L{lag:g}__S{slot}__H{hours}", "CROSS_MOMENTUM", spread, lag, slot, hours)
        for spread in (80.0, 120.0, 160.0) for lag in (15.0, 30.0)
        for slot in (1, 2, 3) for hours in (1, 2)
    ]
    + [
        Candidate(f"GAP_CONT__G{gap:g}__C{confirm:g}__H{hours}", "GAP_CONT", gap, confirm, 1, hours)
        for gap in (50.0, 100.0, 150.0) for confirm in (20.0, 40.0) for hours in (1, 2)
    ]
    + [
        Candidate(f"GAP_REVERSAL__G{gap:g}__R{reversal:g}__H{hours}", "GAP_REVERSAL", gap, reversal, 1, hours)
        for gap in (50.0, 100.0, 150.0) for reversal in (20.0, 40.0) for hours in (1, 2)
    ]
)


def finite(value: Any, fallback: float = 0.0) -> float:
    return v14.finite(value, fallback)


def rounded(value: Any):
    return v14.rounded(value)


def cash_price(point: dict) -> float:
    return finite(point["price"]) / max(1e-12, 1.0 + finite(point["basisBps"]) / 10_000.0)


def build_features(days: Sequence[str], aligned: Dict[str, Dict[str, dict]]) -> Dict[str, dict]:
    features: Dict[str, dict] = {}
    previous_cash_close: Dict[str, Optional[float]] = {symbol: None for symbol in SYMBOLS}
    for day in days:
        rows: Dict[str, dict] = {}
        for symbol in SYMBOLS:
            points = v15.points_for(aligned[symbol][day])
            cash = [cash_price(point) for point in points]
            perp = [finite(point["price"]) for point in points]
            rows[symbol] = {
                "points": points,
                "cash": cash,
                "perp": perp,
                "previousCashClose": previous_cash_close[symbol],
                "gapBps": (
                    (cash[0] / previous_cash_close[symbol] - 1.0) * 10_000.0
                    if previous_cash_close[symbol] and previous_cash_close[symbol] > 0 else None
                ),
                "fundingPoints": aligned[symbol][day]["perp"]["fundingPoints"],
            }
            previous_cash_close[symbol] = cash[-1]
        features[day] = rows
    return features


def slot_state(row: dict, slot: int) -> dict:
    cash0, cash_now = finite(row["cash"][0]), finite(row["cash"][slot])
    perp0, perp_now = finite(row["perp"][0]), finite(row["perp"][slot])
    cash_return = (cash_now / cash0 - 1.0) * 10_000.0
    perp_return = (perp_now / perp0 - 1.0) * 10_000.0
    return {
        "cashReturnBps": cash_return,
        "perpReturnBps": perp_return,
        "leadBps": cash_return - perp_return,
        "gapBps": row.get("gapBps"),
    }


def signal(candidate: Candidate, day_rows: Dict[str, dict]) -> Optional[Tuple[str, int, float, dict]]:
    states = {symbol: slot_state(day_rows[symbol], candidate.slot) for symbol in SYMBOLS}
    eligible: List[Tuple[float, str, int, float, dict]] = []

    if candidate.family == "CASH_LEAD_CONT":
        for symbol, state in states.items():
            cash_ret, lead = state["cashReturnBps"], state["leadBps"]
            if abs(cash_ret) < candidate.threshold or abs(lead) < candidate.lag_threshold or cash_ret * lead <= 0:
                continue
            side = 1 if cash_ret > 0 else -1
            edge = max(0.0, min(abs(cash_ret), abs(lead)) - 5.0)
            eligible.append((abs(cash_ret) + abs(lead), symbol, side, edge, state))

    elif candidate.family == "CASH_PERP_DISAGREE":
        for symbol, state in states.items():
            cash_ret, perp_ret = state["cashReturnBps"], state["perpReturnBps"]
            if abs(cash_ret) < candidate.threshold or cash_ret * perp_ret >= 0:
                continue
            side = 1 if cash_ret > 0 else -1
            edge = max(0.0, abs(cash_ret - perp_ret) - 10.0)
            eligible.append((abs(cash_ret - perp_ret), symbol, side, edge, state))

    elif candidate.family == "BREADTH_LAG":
        cash_returns = [state["cashReturnBps"] for state in states.values()]
        median_cash = statistics.median(cash_returns)
        direction = 1 if median_cash > 0 else -1
        same_direction = sum(value * direction > 0 for value in cash_returns)
        if abs(median_cash) < candidate.threshold or same_direction < 4:
            return None
        for symbol, state in states.items():
            lead = state["leadBps"]
            if direction * lead <= 0 or abs(lead) < candidate.lag_threshold:
                continue
            edge = max(0.0, min(abs(median_cash), abs(lead)) - 5.0)
            detail = {**state, "medianCashBps": median_cash, "sameDirectionCount": same_direction}
            eligible.append((abs(lead), symbol, direction, edge, detail))

    elif candidate.family == "CROSS_MOMENTUM":
        ordered = sorted(states.items(), key=lambda item: item[1]["cashReturnBps"])
        low_symbol, low = ordered[0]
        high_symbol, high = ordered[-1]
        spread = high["cashReturnBps"] - low["cashReturnBps"]
        if spread < candidate.threshold:
            return None
        choices = [(high_symbol, high, 1), (low_symbol, low, -1)]
        for symbol, state, side in choices:
            lead = state["leadBps"]
            if side * lead <= 0 or abs(lead) < candidate.lag_threshold:
                continue
            edge = max(0.0, min(spread / 2.0, abs(lead)) - 5.0)
            detail = {**state, "crossSectionSpreadBps": spread}
            eligible.append((abs(lead) + spread, symbol, side, edge, detail))

    elif candidate.family in {"GAP_CONT", "GAP_REVERSAL"}:
        for symbol, state in states.items():
            gap = state.get("gapBps")
            first_hour = state["cashReturnBps"]
            if gap is None or abs(gap) < candidate.threshold:
                continue
            if candidate.family == "GAP_CONT":
                if gap * first_hour <= 0 or abs(first_hour) < candidate.lag_threshold:
                    continue
                side = 1 if gap > 0 else -1
                edge = max(0.0, min(abs(gap), abs(first_hour)) - 5.0)
                strength = abs(gap) + abs(first_hour)
            else:
                if gap * first_hour >= 0 or abs(first_hour) < candidate.lag_threshold:
                    continue
                side = 1 if first_hour > 0 else -1
                edge = max(0.0, min(abs(gap), abs(first_hour)) - 5.0)
                strength = abs(gap) + abs(first_hour)
            eligible.append((strength, symbol, side, edge, state))

    else:
        raise ValueError(candidate.family)

    if not eligible:
        return None
    _strength, symbol, side, edge, detail = sorted(eligible, key=lambda item: (-item[0], item[1]))[0]
    return symbol, side, edge, detail


def build_trade(candidate: Candidate, day: str, day_rows: Dict[str, dict]) -> Optional[dict]:
    selected = signal(candidate, day_rows)
    if selected is None:
        return None
    symbol, side, edge_proxy, detail = selected
    row = day_rows[symbol]
    points = row["points"]
    entry = points[candidate.slot]
    last_index = min(len(points) - 1, candidate.slot + candidate.maximum_holding_hours)
    chosen = points[last_index]
    exit_reason = f"TIME_{candidate.maximum_holding_hours}H"
    for point in points[candidate.slot + 1:last_index + 1]:
        price_return = side * (finite(point["price"]) / finite(entry["price"]) - 1.0)
        if price_return >= TP_PCT / 100.0:
            chosen, exit_reason = point, "PRICE_TAKE_PROFIT"
            break
        if price_return <= -SL_PCT / 100.0:
            chosen, exit_reason = point, "PRICE_STOP"
            break
    entry_ts, exit_ts = int(entry["ts"]), int(chosen["ts"])
    gross_return = side * (finite(chosen["price"]) / finite(entry["price"]) - 1.0)
    gross_return += (-side) * v14.funding_mod.funding_between(row["fundingPoints"], entry_ts, exit_ts)
    return {
        "strategy": "V26_NONBASIS_FALLBACK",
        "candidateId": candidate.candidate_id,
        "day": day,
        "symbol": symbol,
        "side": side,
        "gross": 1.0,
        "entryTs": entry_ts,
        "exitTs": exit_ts,
        "holdingHours": max(0.0, (exit_ts - entry_ts) / 3_600_000.0),
        "grossReturn": gross_return,
        "edgeProxyBps": edge_proxy,
        "exitReason": exit_reason,
        "signalDetail": detail,
    }


def build_trades(candidate: Candidate, days: Sequence[str], features: Dict[str, dict]) -> List[dict]:
    return [trade for day in days if (trade := build_trade(candidate, day, features[day])) is not None]


def selection_score(audit: dict) -> float:
    val = audit["validation"]["NORMAL"]
    val95 = audit["validation"]["P95"]
    return val["compoundedReturnPct"] + val95["compoundedReturnPct"] + 0.2 * val["trades"] - 0.5 * abs(val["maxDrawdownPct"])


def development_pass(audit: dict) -> bool:
    row = audit["development"]
    return (
        row["NORMAL"]["trades"] >= 12
        and row["NORMAL"]["compoundedReturnPct"] > 0
        and row["P95"]["compoundedReturnPct"] > 0
        and (row["NORMAL"]["profitFactor"] or 0.0) >= 1.2
    )


def validation_pass(audit: dict) -> bool:
    row = audit["validation"]
    return (
        row["NORMAL"]["trades"] >= 8
        and row["NORMAL"]["compoundedReturnPct"] > 0
        and row["P95"]["compoundedReturnPct"] > 0
        and (row["NORMAL"]["profitFactor"] or 0.0) >= 1.2
    )


def fallback_only_metrics(rows: Sequence[dict], days: Sequence[str]) -> dict:
    allowed = set(days)
    return {
        name: v14.metrics([row for row in rows if str(row["day"]) in allowed], cost)
        for name, cost in SCENARIOS.items()
    }


def analyze(cache_root: Path) -> dict:
    v14.base.verify_source(v14.base.V11_ROOT, v14.base.V11_SOURCE_SHA)
    v14.base.verify_source(v14.base.V13_ROOT, v14.base.V13_SOURCE_SHA)
    v19.configure_exact_data_window()
    days, aligned, diagnostics = v19.v17.load_all(cache_root)
    warmup = [day for day in days if v19.WARMUP_START.date().isoformat() <= day < v19.BT_END_DAY_EXCLUSIVE]
    target = [day for day in warmup if v19.BT_START_DAY <= day < v19.BT_END_DAY_EXCLUSIVE]
    pre_holdout = [day for day in target if day < HOLDOUT_START]
    holdout = [day for day in target if day >= HOLDOUT_START]
    splits = v14.split_days(pre_holdout)
    features = build_features(warmup, aligned)
    v11_rows, v11_diag = v22.build_v11eq(warmup, aligned)
    baseline_rows = v22.build_fallback(warmup, aligned)
    args = (v11_rows, baseline_rows, target, splits["DEVELOPMENT"], splits["VALIDATION"], splits["FINAL_REUSED"], holdout)
    baseline = v22.audit(*args, True)

    development_survivors = []
    for candidate in CANDIDATES:
        rows = build_trades(candidate, warmup, features)
        audit = v22.audit(v11_rows, rows, target, splits["DEVELOPMENT"], splits["VALIDATION"], splits["FINAL_REUSED"], holdout, True)
        if development_pass(audit):
            development_survivors.append((candidate, rows, audit))
    development_survivors.sort(key=lambda item: selection_score(item[2]), reverse=True)
    validation_survivors = [item for item in development_survivors[:40] if validation_pass(item[2])]
    validation_survivors.sort(key=lambda item: selection_score(item[2]), reverse=True)
    winner = validation_survivors[0] if validation_survivors else None

    winner_payload = None
    status = "ASTER_ONLY_V26_NO_VALIDATED_NONBASIS_FALLBACK"
    if winner is not None:
        candidate, rows, audit = winner
        fallback = fallback_only_metrics(rows, target)
        full = audit["full"]
        improvement_checks = {
            "normalAboveV22": full["NORMAL"]["compoundedReturnPct"] > BASELINE_NORMAL,
            "p95AboveV22": full["P95"]["compoundedReturnPct"] > BASELINE_P95,
            "fallbackNormalAboveV19": fallback["NORMAL"]["compoundedReturnPct"] > BASELINE_FALLBACK_NORMAL,
            "fallbackP95AboveV19": fallback["P95"]["compoundedReturnPct"] > BASELINE_FALLBACK_P95,
            "finalNormalAndP95Positive": audit["finalReused"]["NORMAL"]["compoundedReturnPct"] > 0 and audit["finalReused"]["P95"]["compoundedReturnPct"] > 0,
            "holdoutNormalAndP95Positive": audit["holdout"]["NORMAL"]["compoundedReturnPct"] > 0 and audit["holdout"]["P95"]["compoundedReturnPct"] > 0,
            "allV22StrictChecks": all(audit["checks"].values()),
        }
        accepted = all(improvement_checks.values())
        status = "ASTER_ONLY_V26_VALIDATED_NONBASIS_SHADOW_LEAD" if accepted else "ASTER_ONLY_V26_WINNER_DID_NOT_CLEAR_FINAL_AUDIT"
        winner_payload = {
            "candidate": asdict(candidate),
            "routerAudit": audit,
            "fallbackOnly": fallback,
            "improvementChecks": improvement_checks,
            "accepted": accepted,
        }

    return rounded({
        "version": 26,
        "strategyId": STRATEGY_ID,
        "status": status,
        "candidateCount": len(CANDIDATES),
        "developmentSurvivors": len(development_survivors),
        "validationSurvivors": len(validation_survivors),
        "baseline": baseline,
        "winner": winner_payload,
        "topDevelopment": [
            {
                "candidate": asdict(candidate),
                "development": audit["development"],
                "validation": audit["validation"],
            }
            for candidate, _rows, audit in development_survivors[:10]
        ],
        "period": {
            "startInclusiveUtc": v19.BT_START.isoformat(),
            "endExclusiveUtc": v19.BT_END_EXCLUSIVE.isoformat(),
            "calendarDays": 365,
            "sessions": len(target),
            "holdoutSessions": len(holdout),
        },
        "selectionDiscipline": {
            "developmentSelectsTopForty": True,
            "validationSelectsAtMostOne": True,
            "finalAndHoldoutUsedForSelection": False,
            "sameHistoryIsReusedAndNotIndependent": True,
            "productionPromotionAllowed": False,
        },
        "data": diagnostics,
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
        "# Aster-only V26 Non-Basis Fallback Tournament",
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
        lines += [
            f"Winner: `{winner['candidate']['candidate_id']}`",
            f"Accepted: {winner['accepted']}",
            f"Router Normal: {winner['routerAudit']['full']['NORMAL']['compoundedReturnPct']:.6f}%",
            f"Router P95: {winner['routerAudit']['full']['P95']['compoundedReturnPct']:.6f}%",
            f"Fallback Normal: {winner['fallbackOnly']['NORMAL']['compoundedReturnPct']:.6f}%",
            f"Fallback P95: {winner['fallbackOnly']['P95']['compoundedReturnPct']:.6f}%",
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
        "candidateCount": result["candidateCount"],
        "developmentSurvivors": result["developmentSurvivors"],
        "validationSurvivors": result["validationSurvivors"],
        "winner": result["winner"],
    }, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
