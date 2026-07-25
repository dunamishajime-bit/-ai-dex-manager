from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import statistics
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import research_lab_aster_only_v14_replacement_tournament as v14
import research_lab_aster_only_v15_intraday_shock_tournament as v15
import research_lab_aster_only_v19_trailing_one_year_bt as v19

UTC = dt.timezone.utc
STRATEGY_ID = "DISDEX_ASTER_ONLY_V20_STRICT_HURDLE_TOURNAMENT"
SCENARIOS = v14.SCENARIOS
SYMBOLS = v14.SYMBOLS

BT_START = v19.BT_START
BT_END_EXCLUSIVE = v19.BT_END_EXCLUSIVE
BT_START_DAY = v19.BT_START_DAY
BT_END_DAY_EXCLUSIVE = v19.BT_END_DAY_EXCLUSIVE
WARMUP_START = v19.WARMUP_START
HOLDOUT_START_DAY = "2026-07-01"

MAX_ROUND_TRIP_BPS = 60.0
MIN_NET_EDGE_BPS = 10.0
MAX_GROSS = 1.0
MAX_HOLDING_HOURS = 2
DAILY_LOSS_LIMIT = -0.02

STRICT_HURDLES = {
    "minimumNormalReturnPct": 50.0,
    "minimumP95ReturnPct": 30.0,
    "minimumNormalProfitFactor": 1.50,
    "minimumNormalMaxDrawdownPct": -15.0,
    "minimumNormalTrades": 50,
    "maximumPositiveProfitSymbolShare": 0.40,
    "minimumHoldoutTrades": 3,
}

FAMILY_THRESHOLDS = {
    "TIME_SLOT_ZSCORE_FADE": (1.5, 2.0, 2.5),
    "TIME_SLOT_RESIDUAL_FADE": (40.0, 60.0, 80.0),
    "INTRADAY_SHOCK_FADE": (20.0, 35.0, 50.0),
    "BASIS_REJECTION_FADE": (10.0, 20.0, 30.0),
}

SLOT_POLICIES = {
    "ALL_1130_1230_1330": (1, 2, 3),
    "EARLY_1130_1230": (1, 2),
    "LATE_1230_1330": (2, 3),
}


@dataclass(frozen=True)
class Candidate:
    candidate_id: str
    family: str
    threshold: float
    slot_policy: str
    maximum_holding_hours: int
    previous_symbol_cooldown: bool


CANDIDATES = tuple(
    Candidate(
        candidate_id=f"{family}__T{threshold:g}__{slot_policy}__H{hours}__{'COOLDOWN' if cooldown else 'NONE'}",
        family=family,
        threshold=threshold,
        slot_policy=slot_policy,
        maximum_holding_hours=hours,
        previous_symbol_cooldown=cooldown,
    )
    for family, thresholds in FAMILY_THRESHOLDS.items()
    for threshold in thresholds
    for slot_policy in SLOT_POLICIES
    for hours in (1, 2)
    for cooldown in (False, True)
)


def finite(value: Any, fallback: float = 0.0) -> float:
    return v14.finite(value, fallback)


def rounded(value: Any):
    return v14.rounded(value)


def product(values: Iterable[float]) -> float:
    return v14.product(values)


def build_trade_at_slot(
    candidate: Candidate,
    day: str,
    day_feature: dict,
    slot: int,
    blocked_symbol: Optional[str],
) -> Optional[dict]:
    eligible = []
    signal_candidate = v15.Candidate(
        candidate_id=candidate.candidate_id,
        family=candidate.family,
        threshold=candidate.threshold,
        entry_policy="FIRST_ELIGIBLE",
        maximum_holding_hours=candidate.maximum_holding_hours,
        previous_symbol_cooldown=candidate.previous_symbol_cooldown,
    )
    for symbol in SYMBOLS:
        if candidate.previous_symbol_cooldown and symbol == blocked_symbol:
            continue
        symbol_row = day_feature["symbols"][symbol]
        signal = v15.signal_for(signal_candidate, symbol_row["points"], slot, symbol_row["fundingPoints"])
        if signal is None:
            continue
        strength, side, edge_proxy, detail = signal
        eligible.append((strength, symbol, side, edge_proxy, detail))
    if not eligible:
        return None

    _strength, symbol, side, edge_proxy, detail = sorted(
        eligible, key=lambda item: (-item[0], item[1])
    )[0]
    symbol_row = day_feature["symbols"][symbol]
    points = symbol_row["points"]
    entry = points[slot]
    final_index = min(len(points) - 1, slot + candidate.maximum_holding_hours)
    chosen = points[final_index]
    exit_reason = f"TIME_{candidate.maximum_holding_hours}H"

    for point in points[slot + 1 : final_index + 1]:
        price_return = side * (finite(point["price"]) / finite(entry["price"]) - 1.0)
        if price_return >= v15.TAKE_PROFIT_PCT / 100.0:
            chosen = point
            exit_reason = "PRICE_TAKE_PROFIT"
            break
        if price_return <= -v15.STOP_LOSS_PCT / 100.0:
            chosen = point
            exit_reason = "PRICE_STOP"
            break

    entry_ts = int(entry["ts"])
    exit_ts = int(chosen["ts"])
    price_return = side * (finite(chosen["price"]) / finite(entry["price"]) - 1.0)
    funding_return = (-side) * v14.funding_mod.funding_between(
        symbol_row["fundingPoints"], entry_ts, exit_ts
    )
    return {
        "strategy": "ASTER_ONLY_V20",
        "candidateId": candidate.candidate_id,
        "day": day,
        "symbol": symbol,
        "entrySlot": entry["label"],
        "side": side,
        "gross": MAX_GROSS,
        "entryTs": entry_ts,
        "exitTs": exit_ts,
        "holdingHours": max(0.0, (exit_ts - entry_ts) / 3_600_000.0),
        "entryPrice": finite(entry["price"]),
        "exitPrice": finite(chosen["price"]),
        "edgeProxyBps": edge_proxy,
        "grossReturn": price_return + funding_return,
        "priceReturn": price_return,
        "fundingReturn": funding_return,
        "exitReason": exit_reason,
        "signalDetail": detail,
    }


def build_trades(candidate: Candidate, days: Sequence[str], features: Dict[str, dict]) -> List[dict]:
    result: List[dict] = []
    previous_symbol: Optional[str] = None
    for day in days:
        next_free_ts = -1
        for slot in SLOT_POLICIES[candidate.slot_policy]:
            slot_ts = int(features[day]["symbols"][SYMBOLS[0]]["points"][slot]["ts"])
            if slot_ts < next_free_ts:
                continue
            trade = build_trade_at_slot(candidate, day, features[day], slot, previous_symbol)
            if trade is None:
                continue
            result.append(trade)
            next_free_ts = int(trade["exitTs"])
            previous_symbol = str(trade["symbol"])
    return sorted(result, key=lambda row: (int(row["entryTs"]), str(row["symbol"])))


def accepted_rows(
    trades: Sequence[dict],
    round_trip_bps: float,
    selected_days: Optional[Sequence[str]] = None,
) -> Tuple[List[Tuple[dict, float]], Counter]:
    allowed = None if selected_days is None else set(selected_days)
    rows = [
        trade
        for trade in sorted(trades, key=lambda item: (int(item["entryTs"]), str(item["symbol"])))
        if allowed is None or str(trade["day"]) in allowed
    ]
    accepted: List[Tuple[dict, float]] = []
    rejected: Counter = Counter()
    current_day: Optional[str] = None
    daily_return = 0.0
    daily_locked = False

    for trade in rows:
        day = str(trade["day"])
        if day != current_day:
            current_day = day
            daily_return = 0.0
            daily_locked = False
        if daily_locked:
            rejected["DAILY_LOSS_LOCK"] += 1
            continue
        value = v14.net_trade_return(trade, round_trip_bps)
        if value is None:
            if round_trip_bps > MAX_ROUND_TRIP_BPS:
                rejected["COST_OVER_60BPS"] += 1
            else:
                rejected["NET_EDGE_BELOW_10BPS"] += 1
            continue
        accepted.append((trade, value))
        daily_return = (1.0 + daily_return) * (1.0 + value) - 1.0
        if daily_return <= DAILY_LOSS_LIMIT:
            daily_locked = True
            rejected["DAILY_LOSS_LOCK_TRIGGERED"] += 1
    return accepted, rejected


def metrics(
    trades: Sequence[dict],
    round_trip_bps: float,
    selected_days: Optional[Sequence[str]] = None,
) -> dict:
    accepted, rejected = accepted_rows(trades, round_trip_bps, selected_days)
    values = [value for _trade, value in accepted]
    capital_hours = sum(finite(trade["holdingHours"]) for trade, _value in accepted)
    positive_by_symbol: Dict[str, float] = defaultdict(float)
    positive_total = 0.0
    for trade, value in accepted:
        if value > 0:
            positive_by_symbol[str(trade["symbol"])] += value
            positive_total += value
    concentration = (
        max(positive_by_symbol.values()) / positive_total
        if positive_total > 0 and positive_by_symbol
        else 0.0
    )
    return {
        "trades": len(values),
        "compoundedReturnPct": product(values) * 100.0,
        "profitFactor": v14.profit_factor(values),
        "winRatePct": sum(value > 0 for value in values) / len(values) * 100.0 if values else 0.0,
        "averageTradeBps": statistics.mean(values) * 10_000.0 if values else 0.0,
        "medianTradeBps": statistics.median(values) * 10_000.0 if values else 0.0,
        "maxDrawdownPct": v14.max_drawdown(values) * 100.0,
        "averageHoldingHours": (
            statistics.mean(finite(trade["holdingHours"]) for trade, _value in accepted)
            if accepted
            else 0.0
        ),
        "capitalHours": capital_hours,
        "netBpsPerCapitalHour": (
            sum(values) * 10_000.0 / capital_hours if capital_hours > 0 else 0.0
        ),
        "longTrades": sum(int(trade["side"]) > 0 for trade, _value in accepted),
        "shortTrades": sum(int(trade["side"]) < 0 for trade, _value in accepted),
        "symbolCounts": dict(sorted(Counter(str(trade["symbol"]) for trade, _value in accepted).items())),
        "slotCounts": dict(sorted(Counter(str(trade["entrySlot"]) for trade, _value in accepted).items())),
        "exitReasons": dict(sorted(Counter(str(trade["exitReason"]) for trade, _value in accepted).items())),
        "maximumPositiveProfitSymbolShare": concentration,
        "positiveProfitBySymbolPct": {
            symbol: value / positive_total * 100.0
            for symbol, value in sorted(positive_by_symbol.items())
        } if positive_total > 0 else {},
        "rejections": dict(rejected),
    }


def scenario_set(trades: Sequence[dict], days: Sequence[str]) -> dict:
    return {
        name: metrics(trades, cost, days)
        for name, cost in SCENARIOS.items()
    }


def selection_score(result: dict) -> float:
    normal = result["NORMAL"]
    p95 = result["P95"]
    return (
        normal["compoundedReturnPct"]
        + p95["compoundedReturnPct"]
        + 0.10 * normal["netBpsPerCapitalHour"]
        - 0.50 * abs(normal["maxDrawdownPct"])
    )


def development_pass(result: dict) -> bool:
    normal = result["NORMAL"]
    p95 = result["P95"]
    return bool(
        normal["trades"] >= 20
        and normal["compoundedReturnPct"] > 5.0
        and p95["compoundedReturnPct"] > 0
        and (normal["profitFactor"] or 0.0) > 1.20
        and normal["maxDrawdownPct"] >= -10.0
    )


def validation_pass(result: dict) -> bool:
    normal = result["NORMAL"]
    p95 = result["P95"]
    return bool(
        normal["trades"] >= 8
        and normal["compoundedReturnPct"] > 0
        and p95["compoundedReturnPct"] > 0
        and (normal["profitFactor"] or 0.0) > 1.20
        and normal["maxDrawdownPct"] >= -8.0
        and result["SEVERE"]["compoundedReturnPct"] >= 0
    )


def remove_best_trade(
    trades: Sequence[dict],
    cost_bps: float,
    days: Sequence[str],
) -> List[dict]:
    accepted, _rejected = accepted_rows(trades, cost_bps, days)
    if not accepted:
        return list(trades)
    best = max(accepted, key=lambda row: row[1])[0]
    removed = False
    result = []
    for trade in trades:
        if not removed and trade is best:
            removed = True
            continue
        result.append(trade)
    return result


def remove_best_month(
    trades: Sequence[dict],
    cost_bps: float,
    days: Sequence[str],
) -> Tuple[List[dict], Optional[str]]:
    accepted, _rejected = accepted_rows(trades, cost_bps, days)
    if not accepted:
        return list(trades), None
    monthly: Dict[str, float] = defaultdict(float)
    for trade, value in accepted:
        monthly[str(trade["day"])[:7]] += value
    month = max(monthly, key=lambda key: (monthly[key], key))
    return [trade for trade in trades if str(trade["day"])[:7] != month], month


def strict_checks(
    trades: Sequence[dict],
    full_days: Sequence[str],
    development: dict,
    validation: dict,
    final_reused: dict,
    holdout: dict,
) -> Tuple[dict, dict]:
    full = scenario_set(trades, full_days)
    normal = full["NORMAL"]
    p95 = full["P95"]

    normal_best_removed = scenario_set(
        remove_best_trade(trades, SCENARIOS["NORMAL"], full_days), full_days
    )
    p95_best_removed = scenario_set(
        remove_best_trade(trades, SCENARIOS["P95"], full_days), full_days
    )
    normal_month_rows, normal_best_month = remove_best_month(
        trades, SCENARIOS["NORMAL"], full_days
    )
    p95_month_rows, p95_best_month = remove_best_month(
        trades, SCENARIOS["P95"], full_days
    )
    normal_month_removed = scenario_set(normal_month_rows, full_days)
    p95_month_removed = scenario_set(p95_month_rows, full_days)

    checks = {
        "developmentNormalAndP95Positive": (
            development["NORMAL"]["compoundedReturnPct"] > 0
            and development["P95"]["compoundedReturnPct"] > 0
        ),
        "validationPassed": validation_pass(validation),
        "finalReusedNormalAndP95Positive": (
            final_reused["NORMAL"]["compoundedReturnPct"] > 0
            and final_reused["P95"]["compoundedReturnPct"] > 0
        ),
        "holdoutMinimumTrades": (
            holdout["NORMAL"]["trades"] >= STRICT_HURDLES["minimumHoldoutTrades"]
        ),
        "holdoutNormalAndP95Positive": (
            holdout["NORMAL"]["compoundedReturnPct"] > 0
            and holdout["P95"]["compoundedReturnPct"] > 0
        ),
        "normalReturnAtLeast50Pct": (
            normal["compoundedReturnPct"] >= STRICT_HURDLES["minimumNormalReturnPct"]
        ),
        "p95ReturnAtLeast30Pct": (
            p95["compoundedReturnPct"] >= STRICT_HURDLES["minimumP95ReturnPct"]
        ),
        "normalProfitFactorAtLeast1_5": (
            (normal["profitFactor"] or 0.0) >= STRICT_HURDLES["minimumNormalProfitFactor"]
        ),
        "normalDrawdownNoWorseThanMinus15Pct": (
            normal["maxDrawdownPct"] >= STRICT_HURDLES["minimumNormalMaxDrawdownPct"]
        ),
        "normalMinimumFiftyTrades": (
            normal["trades"] >= STRICT_HURDLES["minimumNormalTrades"]
        ),
        "positiveProfitConcentrationAtMost40Pct": (
            normal["maximumPositiveProfitSymbolShare"]
            <= STRICT_HURDLES["maximumPositiveProfitSymbolShare"]
        ),
        "bestTradeRemovedNormalAndP95Positive": (
            normal_best_removed["NORMAL"]["compoundedReturnPct"] > 0
            and normal_best_removed["P95"]["compoundedReturnPct"] > 0
            and p95_best_removed["NORMAL"]["compoundedReturnPct"] > 0
            and p95_best_removed["P95"]["compoundedReturnPct"] > 0
        ),
        "bestMonthRemovedNormalAndP95Positive": (
            normal_month_removed["NORMAL"]["compoundedReturnPct"] > 0
            and normal_month_removed["P95"]["compoundedReturnPct"] > 0
            and p95_month_removed["NORMAL"]["compoundedReturnPct"] > 0
            and p95_month_removed["P95"]["compoundedReturnPct"] > 0
        ),
        "severeFailClosedNonnegative": full["SEVERE"]["compoundedReturnPct"] >= 0,
    }
    robustness = {
        "normalBestTradeRemoved": normal_best_removed,
        "p95BestTradeRemoved": p95_best_removed,
        "normalBestMonthRemoved": {
            "month": normal_best_month,
            "metrics": normal_month_removed,
        },
        "p95BestMonthRemoved": {
            "month": p95_best_month,
            "metrics": p95_month_removed,
        },
    }
    return checks, robustness


def analyze(cache_root: Path) -> dict:
    v14.base.verify_source(v14.base.V11_ROOT, v14.base.V11_SOURCE_SHA)
    v14.base.verify_source(v14.base.V13_ROOT, v14.base.V13_SOURCE_SHA)
    v19.configure_exact_data_window()

    days, aligned, diagnostics = v19.v17.load_all(cache_root)
    warmup_days = [
        day
        for day in days
        if WARMUP_START.date().isoformat() <= day < BT_END_DAY_EXCLUSIVE
    ]
    target_days = [
        day for day in warmup_days if BT_START_DAY <= day < BT_END_DAY_EXCLUSIVE
    ]
    pre_holdout_days = [day for day in target_days if day < HOLDOUT_START_DAY]
    holdout_days = [day for day in target_days if day >= HOLDOUT_START_DAY]
    if len(warmup_days) < v14.LOOKBACK_DAYS + 20:
        raise RuntimeError(f"Insufficient aligned history: {len(warmup_days)}")
    if len(pre_holdout_days) < 60 or not holdout_days:
        raise RuntimeError("Insufficient chronological selection or holdout sessions")

    features = v15.build_slot_features(warmup_days, aligned)
    splits = v14.split_days(pre_holdout_days)
    all_trades = {
        candidate.candidate_id: build_trades(candidate, warmup_days, features)
        for candidate in CANDIDATES
    }

    development_rows = []
    for candidate in CANDIDATES:
        trades = all_trades[candidate.candidate_id]
        result = scenario_set(trades, splits["DEVELOPMENT"])
        development_rows.append({
            "candidate": asdict(candidate),
            "development": result,
            "score": selection_score(result),
            "passed": development_pass(result),
        })
    development_eligible = [row for row in development_rows if row["passed"]]
    top_development = sorted(
        development_eligible or development_rows,
        key=lambda row: (row["score"], row["candidate"]["candidate_id"]),
        reverse=True,
    )[:20]

    validation_rows = []
    for row in top_development:
        candidate_id = row["candidate"]["candidate_id"]
        result = scenario_set(all_trades[candidate_id], splits["VALIDATION"])
        validation_rows.append({
            **row,
            "validation": result,
            "validationScore": selection_score(result),
            "validationPassed": validation_pass(result),
        })
    validation_eligible = [row for row in validation_rows if row["validationPassed"]]
    selected = max(
        validation_eligible,
        key=lambda row: (row["validationScore"], row["candidate"]["candidate_id"]),
        default=None,
    )

    winner = None
    strict_passed = False
    if selected is not None:
        candidate_id = selected["candidate"]["candidate_id"]
        trades = all_trades[candidate_id]
        final_reused = scenario_set(trades, splits["FINAL_REUSED"])
        holdout = scenario_set(trades, holdout_days)
        full = scenario_set(trades, target_days)
        checks, robustness = strict_checks(
            trades,
            target_days,
            selected["development"],
            selected["validation"],
            final_reused,
            holdout,
        )
        strict_passed = all(checks.values())
        winner = {
            **selected,
            "finalReused": final_reused,
            "holdout": holdout,
            "full": full,
            "checks": checks,
            "allStrictHurdlesPassed": strict_passed,
            "robustness": robustness,
            "tradeAudit": [
                trade for trade in trades if str(trade["day"]) in set(target_days)
            ],
        }

    status = (
        "ASTER_ONLY_V20_STRICT_HURDLE_PASS_SHADOW_ONLY"
        if strict_passed
        else "ASTER_ONLY_V20_NO_STRICT_HURDLE_CANDIDATE"
    )
    return rounded({
        "version": 20,
        "strategyId": STRATEGY_ID,
        "status": status,
        "period": {
            "startInclusiveUtc": BT_START.isoformat(),
            "endExclusiveUtc": BT_END_EXCLUSIVE.isoformat(),
            "calendarDays": (BT_END_EXCLUSIVE - BT_START).days,
            "alignedSessions": len(target_days),
            "selectionSessions": len(pre_holdout_days),
            "holdoutStartInclusive": HOLDOUT_START_DAY,
            "holdoutSessions": len(holdout_days),
            "firstSession": target_days[0],
            "lastSession": target_days[-1],
        },
        "candidateCount": len(CANDIDATES),
        "familyCount": len(FAMILY_THRESHOLDS),
        "rules": {
            "venue": "ASTER_ONLY",
            "hyperliquidUsed": False,
            "maximumConcurrentGross": MAX_GROSS,
            "maximumHoldingHours": MAX_HOLDING_HOURS,
            "maximumOnePositionAtATime": True,
            "multipleChronologicalOpportunitiesPerDay": True,
            "entrySlotsNy": ["11:30", "12:30", "13:30"],
            "dailyLossLimitPct": abs(DAILY_LOSS_LIMIT) * 100.0,
            "maximumObservableRoundTripCostBps": MAX_ROUND_TRIP_BPS,
            "minimumObservableNetEdgeBps": MIN_NET_EDGE_BPS,
            "severeCostAction": "FAIL_CLOSED_NO_ENTRY",
            "v96CapitalPriorityRequiredBeforeProduction": True,
        },
        "strictHurdles": STRICT_HURDLES,
        "splits": {
            key: {
                "sessions": len(value),
                "first": value[0] if value else None,
                "last": value[-1] if value else None,
            }
            for key, value in splits.items()
        },
        "developmentTop": top_development,
        "validationRows": validation_rows,
        "winner": winner,
        "selectionDiscipline": {
            "candidateGridPredeclared": True,
            "developmentSelectsTop20": True,
            "validationSelectsAtMostOne": True,
            "finalReusedEvaluatedOnce": True,
            "julyHoldoutExcludedFromSelection": True,
            "holdoutRetuningAllowed": False,
            "productionPromotionAllowed": False,
        },
        "data": diagnostics,
        "limitations": [
            "Cash history is Yahoo 60-minute data rather than historical Pyth ticks.",
            "Aster inputs are 30-minute candles and Funding rather than exact spread, depth, queue and fills.",
            "The economic families reuse previously inspected concepts; only the sequential multi-opportunity architecture is new.",
            "The July holdout is short and cannot independently establish future expected return.",
            "Historical performance does not guarantee future profit.",
        ],
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
        "# Aster-only V20 Strict Hurdle Tournament",
        "",
        f"Status: **{result['status']}**",
        "",
        f"Candidates: {result['candidateCount']} across {result['familyCount']} families",
        f"Period: {result['period']['startInclusiveUtc']} to {result['period']['endExclusiveUtc']}",
        "",
        "## Strict hurdles",
        "",
    ]
    for key, value in result["strictHurdles"].items():
        lines.append(f"- {key}: {value}")
    lines += ["", "## Selected validation lead", ""]
    winner = result.get("winner")
    if winner is None:
        lines.append("No candidate passed chronological Validation.")
    else:
        lines.append(f"- Candidate: `{winner['candidate']['candidate_id']}`")
        normal = winner["full"]["NORMAL"]
        p95 = winner["full"]["P95"]
        lines.append(
            f"- Normal: {normal['compoundedReturnPct']:.6f}% / PF {normal['profitFactor']} / "
            f"{normal['trades']} trades / DD {normal['maxDrawdownPct']:.6f}%"
        )
        lines.append(
            f"- P95: {p95['compoundedReturnPct']:.6f}% / PF {p95['profitFactor']} / "
            f"{p95['trades']} trades / DD {p95['maxDrawdownPct']:.6f}%"
        )
        lines.append(
            f"- Holdout Normal/P95: {winner['holdout']['NORMAL']['compoundedReturnPct']:.6f}% / "
            f"{winner['holdout']['P95']['compoundedReturnPct']:.6f}%"
        )
        lines += ["", "Checks:", ""]
        for key, value in winner["checks"].items():
            lines.append(f"- {key}: {value}")
    lines += [
        "",
        "Research only. No Production, LIVE, VPS, credentials, orders or positions were changed.",
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
        json.dumps(result, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    (output / "report.md").write_text(report(result), encoding="utf-8")
    print(json.dumps({
        "status": result["status"],
        "period": result["period"],
        "candidateCount": result["candidateCount"],
        "winner": result.get("winner"),
    }, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
