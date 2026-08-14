"""Priority Router V6: surgical preemption and lifecycle-guard ablation.

Research-only.  V1 Champion trade streams and the V1 complement ranking are
frozen.  V6 changes only occupied-slot preemption and narrowly scoped
portfolio lifecycle guards; it adds no entry indicator or Shadow gate.
"""

from __future__ import annotations

import json
import math
import os
import statistics
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import research_lab_pair_specific_v109 as v109
import research_priority_router_one_year as base
import research_priority_router_v3 as v3
import research_priority_router_v5 as v5


V1_BASELINE = "V1_BASELINE"
V1_REENTRY = "V1_REENTRY_GUARD_ONLY"
V1_SAME_DAY = "V1_SAME_DAY_GUARD_ONLY"
V1_SWITCH = "V1_COMPLEMENT_SWITCH_GUARD_ONLY"
V1_CHURN = "V1_PREEMPTION_CHURN_GUARD_ONLY"
V6_SOL = "V6_SOL_CONDITIONAL_PREEMPT_ONLY"
V6_FULL = "V6_SURGICAL_FULL"

GUARD_REENTRY = "REENTRY_GUARD"
GUARD_SAME_DAY = "SAME_DAY_ROUNDTRIP_GUARD"
GUARD_SWITCH = "COMPLEMENT_SWITCH_GUARD"
GUARD_CHURN = "PREEMPTION_CHURN_GUARD"
GUARDS = (GUARD_REENTRY, GUARD_SAME_DAY, GUARD_SWITCH, GUARD_CHURN)
GUARD_BARS = 24

STRESS_BPS = float(v109.STRESS_BPS)
STRESS_DELAY_BARS = 1
SOL_SIGNAL_WEIGHT = 0.50
SOL_EXPECTANCY_WEIGHT = 0.30
SOL_PF_WEIGHT = 0.20
HELD_CURRENT_WEIGHT = 0.60
HELD_EXPECTANCY_WEIGHT = 0.40
POLICY_ID = "V6_DV_FIXED_SOL_SCORE_LINK_V1_AND_SURGICAL_LIFECYCLE_GUARDS"


def _trade_return(position: dict[str, Any], exit_price: float) -> float:
    move = float(position["sideSign"]) * (
        exit_price / float(position["entryPrice"]) - 1.0
    ) * 100.0
    return float(position["riskMultiplier"]) * (move - base.NORMAL_BPS / 100.0)


def _mfe_at(position: dict[str, Any], candles: dict[str, list[dict[str, Any]]], index: dict[str, dict[int, int]], ts: int) -> float | None:
    symbol = str(position["symbol"])
    start = index[symbol].get(int(position["entryTs"]))
    end = index[symbol].get(int(ts))
    if start is None or end is None or end < start:
        return None
    rows = candles[symbol][start:end + 1]
    entry = float(position["entryPrice"])
    if position["sideSign"] > 0:
        return (max(float(row["high"]) for row in rows) / entry - 1.0) * 100.0
    return (entry / min(float(row["low"]) for row in rows) - 1.0) * 100.0


def _candidate_return(candidate: dict[str, Any], entry_price: float, exit_price: float) -> float:
    move = float(candidate["sideSign"]) * (exit_price / entry_price - 1.0) * 100.0
    return float(candidate["riskMultiplier"]) * (move - base.NORMAL_BPS / 100.0)


def _common_times_relaxed(candles: dict[str, list[dict[str, Any]]], index: dict[str, dict[int, int]], periods: dict[str, Any]) -> list[int]:
    """D/V screening may be shorter than the one-year loader guardrail."""
    start = int(periods["fixedWindowStart"])
    end = int(periods["fixedWindowEndExclusive"])
    symbols = ("BTC",) + tuple(base.TRADE_SYMBOLS)
    return [int(row["ts"]) for row in candles["BTC"] if start <= int(row["ts"]) < end and all(index[s].get(int(row["ts"])) is not None for s in symbols)]


def _dv_expectancy(records: dict[str, list[dict[str, Any]]], periods: dict[str, Any]) -> dict[str, dict[str, Any]]:
    start = int(periods["development"][0])
    end = int(periods["validation"][1])
    out: dict[str, dict[str, Any]] = {}
    for symbol, rows in records.items():
        values = [float(row["netReturnPct"]) for row in rows if start <= int(row["entryTs"]) < end]
        out[symbol] = {
            "trades": len(values),
            "expectancyPct": statistics.fmean(values) if values else 0.0,
            "pf": base.profit_factor(values),
            "returnPct": base.compound(values),
        }
    return out


def _dv_candidates(candles: dict[str, list[dict[str, Any]]], index: dict[str, dict[int, int]], periods: dict[str, Any], models: dict[str, dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    start = int(periods["development"][0])
    end = int(periods["validation"][1])
    out: dict[str, list[dict[str, Any]]] = {}
    for symbol in base.TRADE_SYMBOLS:
        raw = base._champion_records(symbol, candles, index, start, end, models[symbol])
        rows = [base.normalize_record(symbol, row, candles, index, models[symbol]) for row in raw]
        out[symbol] = sorted(rows, key=lambda row: (int(row["entryTs"]), int(row["exitTs"])))
    return out


def _sol_score(candidate: dict[str, Any], dv: dict[str, Any]) -> float:
    signal = min(3.0, max(0.0, float(candidate["signalStrength"]))) / 3.0
    expectancy = math.tanh(float(dv.get("expectancyPct", 0.0)) / 10.0)
    pf = dv.get("pf")
    pf_score = math.tanh((float(pf) - 1.0) * 2.0) if pf is not None else 0.0
    return SOL_SIGNAL_WEIGHT * signal + SOL_EXPECTANCY_WEIGHT * expectancy + SOL_PF_WEIGHT * pf_score


def _held_score(held: dict[str, Any], ts: int, current_price: float, dv: dict[str, Any]) -> tuple[float, dict[str, Any]]:
    current = _trade_return(held, current_price)
    total_bars = max(1.0, (int(held["plannedExitTs"]) - int(held["entryTs"])) / base.HOUR)
    remaining_bars = max(0.0, (int(held["plannedExitTs"]) - int(ts)) / base.HOUR)
    fraction = min(1.0, remaining_bars / total_bars)
    expected = float(dv.get("expectancyPct", 0.0)) * fraction
    score = HELD_CURRENT_WEIGHT * math.tanh(current / 10.0) + HELD_EXPECTANCY_WEIGHT * math.tanh(expected / 10.0)
    return score, {"heldCurrentReturnPct": current, "heldExpectedRemainingPct": expected, "heldRemainingFraction": fraction}


def _should_preempt(challenger: dict[str, Any], held: dict[str, Any], ts: int, candles: dict[str, list[dict[str, Any]]], index: dict[str, dict[int, int]], dv: dict[str, dict[str, Any]]) -> tuple[bool, str, dict[str, Any]]:
    symbol = str(challenger["symbol"])
    if symbol == "LINK":
        return True, "LINK_V1_PRIORITY", {"challengerSignalStrength": float(challenger["signalStrength"])}
    current_price = base._price(candles, index, str(held["symbol"]), ts, "open")
    challenger_score = _sol_score(challenger, dv.get("SOL", {}))
    held_score, held_details = _held_score(held, ts, current_price, dv.get(str(held["symbol"]), {}))
    mfe = _mfe_at(held, candles, index, ts)
    current = held_details["heldCurrentReturnPct"]
    details = {
        "challengerSignalStrength": float(challenger["signalStrength"]),
        "challengerScore": challenger_score,
        "heldContinuationScore": held_score,
        "heldMfePct": mfe,
        "mfeCaptureRatio": (current / mfe if mfe and mfe > 0 else None),
        **held_details,
    }
    allowed = challenger_score > held_score
    return allowed, ("SOL_SCORE_PASS" if allowed else "SOL_SCORE_REJECT"), details


def _audit_event(held: dict[str, Any], challenger: dict[str, Any], ts: int, candles: dict[str, list[dict[str, Any]]], index: dict[str, dict[int, int]]) -> dict[str, Any]:
    return v5._audit_event(held, challenger, ts, candles, index)


def _record_guard(stats: dict[str, dict[str, Counter | float]], guard: str, candidate: dict[str, Any]) -> None:
    symbol = str(candidate["symbol"])
    if symbol not in stats[guard]:
        stats[guard][symbol] = Counter()
        stats[guard][symbol]["preventedWinnerPnlPctPoints"] = 0.0
        stats[guard][symbol]["preventedLoserPnlPctPoints"] = 0.0
    row = stats[guard][symbol]
    value = float(candidate["netReturnPct"])
    row["preventedTrades"] += 1
    if value > 0:
        row["preventedWinners"] += 1
        row["preventedWinnerPnlPctPoints"] += value
    else:
        row["preventedLosers"] += 1
        row["preventedLoserPnlPctPoints"] += value
    row["netAvoidedPnlPctPoints"] = row["preventedWinnerPnlPctPoints"] + row["preventedLoserPnlPctPoints"]


def _guard_stats_json(stats: dict[str, dict[str, Counter | float]]) -> dict[str, Any]:
    return {guard: {symbol: dict(values) for symbol, values in symbols.items()} for guard, symbols in stats.items()}


def _guard_for_candidate(candidate: dict[str, Any], ts: int, flags: set[str], last_close: dict[tuple[str, str], int], same_day_closed: dict[tuple[str, str], int], last_closed_complement: tuple[str, int] | None, recent_preemptions: dict[str, int]) -> str | None:
    symbol = str(candidate["symbol"])
    side = str(candidate["side"])
    previous = last_close.get((symbol, side))
    if GUARD_REENTRY in flags and previous is not None and ts - previous <= GUARD_BARS * base.HOUR:
        return GUARD_REENTRY
    closed_same_day = same_day_closed.get((symbol, side))
    if GUARD_SAME_DAY in flags and closed_same_day is not None and int(closed_same_day) // base.DAY == int(ts) // base.DAY:
        return GUARD_SAME_DAY
    if GUARD_SWITCH in flags and last_closed_complement is not None:
        previous_symbol, previous_ts = last_closed_complement
        if symbol in base.COMPLEMENTS and previous_symbol != symbol and ts - previous_ts <= GUARD_BARS * base.HOUR:
            return GUARD_SWITCH
    if GUARD_CHURN in flags:
        previous_preempt = recent_preemptions.get(symbol)
        if previous_preempt is not None and ts - previous_preempt <= GUARD_BARS * base.HOUR:
            return GUARD_CHURN
    return None


def run_router(candles: dict[str, list[dict[str, Any]]], index: dict[str, dict[int, int]], periods: dict[str, Any], candidates: dict[str, list[dict[str, Any]]], policy: str, dv_expectancy: dict[str, dict[str, Any]], shadow_records: dict[str, list[dict[str, Any]]], *, guard_flags: set[str] | None = None, audit: bool = False) -> dict[str, Any]:
    guard_flags = set(guard_flags or ())
    try:
        times = base._common_times(candles, index, periods)
    except RuntimeError as exc:
        if "INSUFFICIENT_COMMON_HOURLY_MARKS" not in str(exc):
            raise
        times = _common_times_relaxed(candles, index, periods)
    events: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for rows in candidates.values():
        for row in rows:
            events[int(row["entryTs"])].append(row)
    slots = [{"capital": base.SLOT_INITIAL_CAPITAL, "position": None}, {"capital": base.SLOT_INITIAL_CAPITAL, "position": None}]
    real_trades: list[dict[str, Any]] = []
    skipped: Counter[str] = Counter()
    adopted: Counter[str] = Counter()
    preempted: Counter[str] = Counter()
    equity_curve: list[dict[str, Any]] = []
    state_counts: Counter[str] = Counter()
    turnover = 0.0
    turnover_breakdown: Counter[str] = Counter()
    last_close: dict[tuple[str, str], int] = {}
    same_day_closed: dict[tuple[str, str], int] = {}
    last_closed_complement: tuple[str, int] | None = None
    recent_preemptions: dict[str, int] = {}
    audit_events: list[dict[str, Any]] = []
    decisions: list[dict[str, Any]] = []
    guard_stats: dict[str, dict[str, Counter | float]] = {guard: {} for guard in GUARDS}

    def positions() -> list[dict[str, Any]]:
        return [slot["position"] for slot in slots if slot["position"] is not None]

    def close_slot(slot: dict[str, Any], ts: int, reason: str, price: float | None = None) -> None:
        nonlocal turnover, last_closed_complement
        position = slot["position"]
        if position is None:
            return
        entry_notional = float(position.get("entryCapital", position["capital"]))
        exit_price = price if price is not None else float(position["plannedExitPrice"])
        position["closeTs"] = ts
        trade = base._close_position(position, exit_price, reason)
        exit_notional = float(position["capital"])
        turnover += abs(exit_notional)
        if reason.startswith("PREEMPTED_BY_"):
            turnover_breakdown["preemption_exit"] += abs(exit_notional)
        else:
            turnover_breakdown["normal_exit"] += abs(exit_notional)
        key = (str(position["symbol"]), str(position["side"]))
        last_close[key] = ts
        if int(position["entryTs"]) // base.DAY == int(ts) // base.DAY:
            same_day_closed[key] = ts
            turnover_breakdown["same_day_roundtrip"] += abs(entry_notional) + abs(exit_notional)
        if str(position["symbol"]) in base.COMPLEMENTS:
            last_closed_complement = (str(position["symbol"]), ts)
        real_trades.append(trade)
        slot["capital"] = position["capital"]
        slot["position"] = None

    def open_slot(slot: dict[str, Any], candidate: dict[str, Any], ts: int, kind: str = "normal") -> None:
        nonlocal turnover
        capital = float(slot["capital"])
        turnover += capital
        symbol_side = (str(candidate["symbol"]), str(candidate["side"]))
        previous = last_close.get(symbol_side)
        if previous is not None and ts - previous <= GUARD_BARS * base.HOUR:
            turnover_breakdown["re_entry_turnover"] += capital
        elif last_closed_complement is not None and str(candidate["symbol"]) in base.COMPLEMENTS:
            previous_symbol, previous_ts = last_closed_complement
            if previous_symbol != str(candidate["symbol"]) and ts - previous_ts <= GUARD_BARS * base.HOUR:
                turnover_breakdown["complement_switch_turnover"] += capital
        if kind == "preemption_replacement":
            turnover_breakdown["preemption_entry"] += capital
        else:
            turnover_breakdown["normal_entry"] += capital
        slot["position"] = {
            "symbol": candidate["symbol"], "side": candidate["side"], "sideSign": candidate["sideSign"],
            "entryTs": ts, "entryPrice": candidate["entryPrice"], "plannedExitTs": candidate["exitTs"],
            "plannedExitPrice": candidate["exitPrice"], "capital": capital, "entryCapital": capital,
            "riskMultiplier": candidate["riskMultiplier"], "signalStrength": candidate["signalStrength"],
            "champion": candidate["champion"], "entryKind": kind,
        }
        adopted[str(candidate["symbol"])] += 1

    def free_slot() -> dict[str, Any] | None:
        return next((slot for slot in slots if slot["position"] is None), None)

    def held_symbols() -> set[str]:
        return {str(position["symbol"]) for position in positions()}

    for ts in times:
        for slot in slots:
            position = slot["position"]
            if position is not None and int(position["plannedExitTs"]) <= ts:
                close_slot(slot, ts, "CHAMPION_EXIT", float(position["plannedExitPrice"]))
        held = held_symbols()
        at_ts = events.get(ts, [])
        priorities = [row for row in at_ts if row["symbol"] in base.PRIORITY]
        priorities.sort(key=lambda row: (0 if row["symbol"] == "SOL" else 1, row["symbol"]))
        for challenger in priorities:
            symbol = str(challenger["symbol"])
            if symbol in held:
                skipped["priority_already_held"] += 1
                continue
            slot = free_slot()
            if slot is None:
                complement_slots = [slot for slot in slots if slot["position"] is not None and slot["position"]["symbol"] in base.COMPLEMENTS]
                if not complement_slots:
                    skipped["priority_no_slot"] += 1
                    continue
                target = complement_slots[0]
                old = target["position"]
                assert old is not None
                if policy == V6_SOL and symbol == "SOL" or policy == V6_FULL and symbol == "SOL":
                    allowed, reason, details = _should_preempt(challenger, old, ts, candles, index, dv_expectancy)
                elif symbol == "LINK":
                    allowed, reason, details = True, "LINK_V1_PRIORITY", {"challengerSignalStrength": float(challenger["signalStrength"])}
                else:
                    allowed, reason, details = True, "V1_ALWAYS_PREEMPT", {}
                decisions.append({"timestamp": ts, "challenger": symbol, "held": old["symbol"], "allowed": allowed, "reason": reason, **details})
                if not allowed:
                    skipped[reason] += 1
                    continue
                if audit:
                    audit_events.append(_audit_event(old, challenger, ts, candles, index))
                old_symbol = str(old["symbol"])
                close_slot(target, ts, f"PREEMPTED_BY_{symbol}", base._price(candles, index, old_symbol, ts, "open"))
                recent_preemptions[old_symbol] = ts
                preempted[f"PREEMPTED_BY_{symbol}"] += 1
                open_slot(target, challenger, ts, "preemption_replacement")
                held.add(symbol)
                continue
            open_slot(slot, challenger, ts)
            held.add(symbol)

        complement_events = [row for row in at_ts if row["symbol"] in base.COMPLEMENTS and row["symbol"] not in held]
        complement_events = base._rank_complements(complement_events, "SHADOW_YTD_RANK", shadow_records, ts)
        for candidate in complement_events:
            guard = _guard_for_candidate(candidate, ts, guard_flags, last_close, same_day_closed, last_closed_complement, recent_preemptions)
            if guard is not None:
                _record_guard(guard_stats, guard, candidate)
                skipped[guard] += 1
                continue
            slot = free_slot()
            if slot is None:
                skipped["complement_no_slot"] += 1
                continue
            open_slot(slot, candidate, ts)
            held.add(str(candidate["symbol"]))

        marks = []
        for slot in slots:
            position = slot["position"]
            if position is None:
                marks.append(float(slot["capital"]))
            else:
                marks.append(v3._position_value(position, base._price(candles, index, str(position["symbol"]), ts, "close")))
        equity = sum(marks)
        state = base._state_label(positions())
        state_counts[state] += 1
        equity_curve.append({"ts": ts, "equity": equity, "cash": sum(float(slot["capital"]) for slot in slots if slot["position"] is None), "state": state, "positions": [str(p["symbol"]) for p in positions()]})

    final_ts = times[-1]
    for slot in slots:
        if slot["position"] is not None:
            position = slot["position"]
            close_slot(slot, final_ts, "PERIOD_END", base._price(candles, index, str(position["symbol"]), final_ts, "close"))
    equities = [float(row["equity"]) for row in equity_curve]
    peak = equities[0]
    max_dd = 0.0
    for value in equities:
        peak = max(peak, value)
        max_dd = min(max_dd, (value / peak - 1.0) * 100.0)
    final_equity = sum(float(slot["capital"]) for slot in slots)
    contributions = [float(row["portfolioPnlPctPoints"]) for row in real_trades]
    metrics = base.metric_from_trade_contributions(contributions)
    start, end = int(periods["fixedWindowStart"]), int(periods["fixedWindowEndExclusive"])
    years = (end - start) / (365.0 * base.DAY)
    state_keys = ("cash", "SOL only", "LINK only", "SOL+LINK", "complement only", "SOL/complement", "LINK/complement")
    allocation = {key: state_counts[key] / len(equity_curve) * 100.0 for key in state_keys}
    allocation["averageCashPct"] = sum(float(row["cash"]) / max(float(row["equity"]), 1e-12) * 100.0 for row in equity_curve) / len(equity_curve)
    turnover_breakdown["preemption_turnover"] = turnover_breakdown["preemption_exit"] + turnover_breakdown["preemption_entry"]
    return {
        "mode": policy, "window": {"start": start, "endExclusive": end, "hours": len(equity_curve)},
        "metrics": {**metrics, "oneYearReturnPct": (final_equity - 1.0) * 100.0, "cagrPct": (final_equity ** (1.0 / years) - 1.0) * 100.0 if final_equity > 0 else -100.0, "maxDrawdownHourlyMtmPct": max_dd, "returnToAbsDrawdown": ((final_equity - 1.0) * 100.0) / abs(max_dd) if abs(max_dd) > 1e-12 else None, "realTradeCount": len(real_trades), "portfolioTurnoverPctOfInitialEquity": turnover * 100.0},
        "allocationTimePct": {"cashPct": allocation["cash"], "SOL_onlyPct": allocation["SOL only"], "LINK_onlyPct": allocation["LINK only"], "SOL_LINKPct": allocation["SOL+LINK"], "complement_onlyPct": allocation["complement only"], "SOL_complementPct": allocation["SOL/complement"], "LINK_complementPct": allocation["LINK/complement"], "averageCashPct": allocation["averageCashPct"]},
        "realTrades": real_trades, "skippedEventCounts": dict(skipped), "adoptedCounts": dict(adopted), "preemptedCounts": dict(preempted), "equityCurve": equity_curve, "turnoverBreakdown": dict(turnover_breakdown), "preemptionEvents": audit_events, "preemptionDecisions": decisions, "guardAttribution": _guard_stats_json(guard_stats),
        "policy": {"policyId": POLICY_ID, "guardFlags": sorted(guard_flags), "shadowUsedForEntryRejection": False, "entryLogicChanged": False, "championsFrozen": True, "btcPositionWeightPct": 0.0, "dvExpectancy": dv_expectancy, "normalCostBpsRoundTrip": base.NORMAL_BPS, "executionDelayBars": base.EXECUTION_DELAY_BARS},
    }


def _summary(run: dict[str, Any], stress: dict[str, Any]) -> dict[str, Any]:
    metrics, sm = run["metrics"], stress["metrics"]
    real = run["realTrades"]
    values = [float(row["portfolioPnlPctPoints"]) for row in real]
    contributions = {symbol: sum(float(row["portfolioPnlPctPoints"]) for row in real if row["symbol"] == symbol) for symbol in base.TRADE_SYMBOLS}
    return {"returnPct": metrics["oneYearReturnPct"], "cagrPct": metrics["cagrPct"], "pf": metrics["pf"], "pfWithoutBest": metrics["pfWithoutBest"], "maxDDPct": metrics["maxDrawdownHourlyMtmPct"], "stressReturnPct": sm["oneYearReturnPct"], "stressPf": sm["pf"], "stressDDPct": sm["maxDrawdownHourlyMtmPct"], "trades": metrics["realTradeCount"], "winRatePct": metrics["winRatePct"], "turnoverPct": metrics["portfolioTurnoverPctOfInitialEquity"], "cashPct": run["allocationTimePct"]["averageCashPct"], "top5ContributionPctPoints": sum(sorted(values, reverse=True)[:5]) if values else 0.0, "returnToDD": metrics["returnToAbsDrawdown"], "contributionPctPoints": contributions, "preemptionCount": sum(run["preemptedCounts"].values()), "preemptionPnlPctPoints": sum(float(row["portfolioPnlPctPoints"]) for row in real if str(row["exitReason"]).startswith("PREEMPTED_BY_")), "turnoverBreakdown": run["turnoverBreakdown"], "guardAttribution": run["guardAttribution"], "stressGuardAttribution": stress["guardAttribution"], "stressTradeCount": stress["metrics"]["realTradeCount"], "normalToStressReturnDeltaPctPoints": sm["oneYearReturnPct"] - metrics["oneYearReturnPct"]}


def _dv_selection(candles: dict[str, list[dict[str, Any]]], index: dict[str, dict[int, int]], periods: dict[str, Any], candidates: dict[str, list[dict[str, Any]]], models: dict[str, dict[str, Any]]) -> dict[str, Any]:
    dv_candidates = _dv_candidates(candles, index, periods, models)
    dv_periods = dict(periods)
    dv_periods["fixedWindowStart"] = int(periods["development"][0])
    dv_periods["fixedWindowEndExclusive"] = int(periods["validation"][1])
    dv_expectancy = _dv_expectancy(dv_candidates, periods)
    shadow = {symbol: list(dv_candidates[symbol]) for symbol in base.COMPLEMENTS}
    baseline = run_router(candles, index, dv_periods, dv_candidates, V1_BASELINE, dv_expectancy, shadow)
    tests: dict[str, Any] = {}
    for guard, label in ((GUARD_REENTRY, V1_REENTRY), (GUARD_SAME_DAY, V1_SAME_DAY), (GUARD_SWITCH, V1_SWITCH), (GUARD_CHURN, V1_CHURN)):
        tests[guard] = run_router(candles, index, dv_periods, dv_candidates, V1_BASELINE, dv_expectancy, shadow, guard_flags={guard})
    tests["SOL_CONDITIONAL"] = run_router(candles, index, dv_periods, dv_candidates, V6_SOL, dv_expectancy, shadow)
    def decision(run: dict[str, Any], require_turnover: bool = True) -> dict[str, Any]:
        ret_delta = run["metrics"]["oneYearReturnPct"] - baseline["metrics"]["oneYearReturnPct"]
        dd_delta = run["metrics"]["maxDrawdownHourlyMtmPct"] - baseline["metrics"]["maxDrawdownHourlyMtmPct"]
        turnover_delta = run["metrics"]["portfolioTurnoverPctOfInitialEquity"] - baseline["metrics"]["portfolioTurnoverPctOfInitialEquity"]
        selected = ret_delta >= 0.0 and dd_delta >= 0.0 and (not require_turnover or turnover_delta <= 0.0)
        return {"selected": selected, "returnDeltaPctPoints": ret_delta, "ddDeltaPctPoints": dd_delta, "turnoverDeltaPct": turnover_delta}
    decisions = {guard: decision(tests[guard]) for guard in GUARDS}
    sol_decision = decision(tests["SOL_CONDITIONAL"], require_turnover=False)
    selected_guards = [guard for guard in GUARDS if decisions[guard]["selected"]]
    return {"period": {"start": dv_periods["fixedWindowStart"], "endExclusive": dv_periods["fixedWindowEndExclusive"]}, "rule": "select only if D/V return>=baseline, DD no worse, and turnover non-increasing", "baseline": {"returnPct": baseline["metrics"]["oneYearReturnPct"], "ddPct": baseline["metrics"]["maxDrawdownHourlyMtmPct"], "turnoverPct": baseline["metrics"]["portfolioTurnoverPctOfInitialEquity"]}, "guards": decisions, "solConditional": sol_decision, "selectedGuards": selected_guards, "selectedSolConditional": sol_decision["selected"], "dvExpectancy": dv_expectancy}


def _turnover_attribution(summaries: dict[str, Any]) -> dict[str, Any]:
    baseline = summaries[V1_BASELINE]
    out = {}
    for label, summary in summaries.items():
        b = baseline["turnoverBreakdown"]
        c = summary["turnoverBreakdown"]
        categories = {}
        direct_pnl = {"normal_entry": 0.0, "normal_exit": 0.0, "preemption_turnover": summary["preemptionPnlPctPoints"] - baseline["preemptionPnlPctPoints"]}
        for guard, category in ((GUARD_REENTRY, "re_entry_turnover"), (GUARD_SAME_DAY, "same_day_roundtrip"), (GUARD_SWITCH, "complement_switch_turnover"), (GUARD_CHURN, "preemption_turnover")):
            total = 0.0
            for values in summary["guardAttribution"].get(guard, {}).values():
                total += float(values.get("netAvoidedPnlPctPoints", 0.0))
            if category != "preemption_turnover":
                direct_pnl[category] = total
        for key in ("normal_entry", "normal_exit", "preemption_turnover", "re_entry_turnover", "same_day_roundtrip", "complement_switch_turnover"):
            removed = float(b.get(key, 0.0)) - float(c.get(key, 0.0))
            categories[key] = {"turnoverRemovedPct": removed, "pnlLostSavedPctPoints": direct_pnl.get(key, 0.0), "note": "direct guard/counterfactual diagnostic; lifecycle categories can overlap"}
        return_delta = summary["returnPct"] - baseline["returnPct"]
        total_removed = baseline["turnoverPct"] - summary["turnoverPct"]
        out[label] = {"categories": categories, "totalTurnoverRemovedPct": total_removed, "returnDeltaPctPoints": return_delta, "returnDeltaPer1000TurnoverPctPoints": return_delta / (total_removed / 1000.0) if total_removed > 0 else None}
    return out


def run_selftest() -> None:
    assert _sol_score({"signalStrength": 3.0}, {"expectancyPct": 1.0, "pf": 1.2}) > 0
    assert _guard_for_candidate({"symbol": "ETH", "side": "LONG"}, 100, {GUARD_REENTRY}, {("ETH", "LONG"): 90}, {}, None, {}) == GUARD_REENTRY
    assert POLICY_ID.startswith("V6_")
    print("PRIORITY_ROUTER_V6_SELFTEST_PASS")


def main() -> None:
    candles, index, _ = v109.b.base.load()
    periods = base._periods(candles)
    candidates, models = base.load_candidates(candles, index, periods)
    dv_expectancy = _dv_expectancy(_dv_candidates(candles, index, periods, models), periods)
    dv_selection = _dv_selection(candles, index, periods, candidates, models)
    shadow_records = {symbol: list(candidates[symbol]) for symbol in base.COMPLEMENTS}
    labels = (V1_BASELINE, V1_REENTRY, V1_SAME_DAY, V1_SWITCH, V1_CHURN, V6_SOL, V6_FULL)
    flags_by_label = {V1_BASELINE: set(), V1_REENTRY: {GUARD_REENTRY}, V1_SAME_DAY: {GUARD_SAME_DAY}, V1_SWITCH: {GUARD_SWITCH}, V1_CHURN: {GUARD_CHURN}, V6_SOL: set(), V6_FULL: set(dv_selection["selectedGuards"])}
    normal = {}
    for label in labels:
        normal[label] = run_router(candles, index, periods, candidates, label, dv_expectancy, shadow_records, guard_flags=flags_by_label[label], audit=True)
    stress_candidates = v3._stress_candidates(candles, index, periods, models)
    stress_shadow = {symbol: list(stress_candidates[symbol]) for symbol in base.COMPLEMENTS}
    original_bps, original_delay = base.NORMAL_BPS, base.EXECUTION_DELAY_BARS
    base.NORMAL_BPS, base.EXECUTION_DELAY_BARS = STRESS_BPS, STRESS_DELAY_BARS
    try:
        stress = {label: run_router(candles, index, periods, stress_candidates, label, dv_expectancy, stress_shadow, guard_flags=flags_by_label[label], audit=False) for label in labels}
    finally:
        base.NORMAL_BPS, base.EXECUTION_DELAY_BARS = original_bps, original_delay
    summaries = {label: _summary(normal[label], stress[label]) for label in labels}
    audit_by_variant = {label: {"events": normal[label]["preemptionEvents"], **v5._aggregate_audit(normal[label]["preemptionEvents"])} for label in labels}
    result = {
        "status": "RESEARCH_ONLY", "productionChanged": False, "vpsChanged": False, "realTradingEnabled": False, "btcRole": "REFERENCE_ONLY; position/order/PnL/allocation=0", "champions": base.CHAMPION,
        "periods": {key: value for key, value in periods.items() if key in ("development", "validation", "confirmation", "holdout", "fixedWindowStart", "fixedWindowEndExclusive")},
        "normalAssumptions": {"roundTripBps": original_bps, "executionDelayBars": original_delay}, "stressAssumptions": {"roundTripBps": STRESS_BPS, "executionDelayBars": STRESS_DELAY_BARS},
        "variants": summaries, "dvSelection": dv_selection, "preemptionAudit": audit_by_variant[V1_BASELINE], "preemptionAuditByVariant": audit_by_variant, "turnoverAttribution": _turnover_attribution(summaries),
        "profitAttribution": {label: summaries[label]["returnPct"] - summaries[V1_BASELINE]["returnPct"] for label in labels if label != V1_BASELINE},
        "guardAttribution": {label: {"normal": summaries[label]["guardAttribution"], "stress": summaries[label]["stressGuardAttribution"]} for label in labels},
        "stressImpactAttribution": {label: {"normalReturnPct": summaries[label]["returnPct"], "stressReturnPct": summaries[label]["stressReturnPct"], "normalReturnDeltaVsV1PctPoints": summaries[label]["returnPct"] - summaries[V1_BASELINE]["returnPct"], "stressReturnDeltaVsV1PctPoints": summaries[label]["stressReturnPct"] - summaries[V1_BASELINE]["stressReturnPct"], "normalToStressDeltaPctPoints": summaries[label]["normalToStressReturnDeltaPctPoints"], "tradeCountDeltaVsV1": summaries[label]["stressTradeCount"] - summaries[V1_BASELINE]["stressTradeCount"]} for label in labels},
        "diagnostics": {"shadowUsedForEntryRejection": False, "entryLogicChanged": False, "championEntryExitChanged": False, "allComplementCandidatesEligible": True, "bnbExcluded": False, "realPortfolioPnlIncludesShadow": False, "realPortfolioPnlIncludesBtc": False, "counterfactualUsedForRealtime": False, "thresholdSource": "development_validation_predeclared", "knownOosExcludedFromTuning": True, "oosIsNewEvidence": False, "knownOos": "2025-07-01 08:00 JST through 2026-07-01 08:00 JST; re-evaluation only"},
    }
    root = Path(os.environ.get("RESEARCH_STATE_DIR", ".research-state"))
    root.mkdir(parents=True, exist_ok=True)
    path = root / "priority-router-v6-surgical-preemption-1y.json"
    path.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({"status": result["status"], "dvSelection": dv_selection, "variants": summaries, "preemptionAudit": result["preemptionAudit"], "profitAttribution": result["profitAttribution"]}, indent=2))


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    run_selftest() if args.self_test else main()
