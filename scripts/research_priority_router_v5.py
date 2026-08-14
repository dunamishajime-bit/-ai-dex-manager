"""Priority Router V5: preemption-value audit and turnover reduction.

Research-only.  The frozen V1 Champion trade streams are reused without any
new entry indicator.  V5 changes only the decision to preempt an occupied
complement slot and an explicitly narrow short-turnover guard.
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


V1_BASELINE = "V1_BASELINE"
V5_A = "V5_LINK_ABSOLUTE_SOL_CONDITIONAL"
V5_B = "V5_PROFIT_PROTECTED_PREEMPT"
V5_C = "V5_REPLACEMENT_SCORE"
V5_D = "V5_REPLACEMENT_SCORE_PLUS_TURNOVER_GUARD"

STRESS_BPS = float(v109.STRESS_BPS)
STRESS_DELAY_BARS = 1

# Predeclared development/validation policy values.  They are not fitted to
# the known 2025-07-01..2026-07-01 OOS window.
SOL_PREEMPT_MIN_STRENGTH = 1.0
PROFIT_PROTECTED_MIN_STRENGTH = 1.25
REPLACEMENT_MIN_MARGIN = 0.0
REPLACEMENT_SIGNAL_WEIGHT = 0.60
REPLACEMENT_CONTINUATION_WEIGHT = 0.40
TURNOVER_GUARD_BARS = 24
REENTRY_WINDOW_BARS = 24
POLICY_ID = "V5_DV_PREDECLARED_PREEMPT_VALUE_AND_24BAR_TURNOVER_GUARD"


def _key(row: dict[str, Any]) -> tuple[str, int, str]:
    return str(row["symbol"]), int(row["entryTs"]), str(row["side"])


def _compound(values: list[float]) -> float:
    return base.compound(values)


def _pf(values: list[float]) -> float | None:
    return base.profit_factor(values)


def _trade_return(position: dict[str, Any], exit_price: float) -> float:
    move = float(position["sideSign"]) * (
        exit_price / float(position["entryPrice"]) - 1.0
    ) * 100.0
    return float(position["riskMultiplier"]) * (move - base.NORMAL_BPS / 100.0)


def _candidate_return(candidate: dict[str, Any], entry_price: float, exit_price: float) -> float:
    move = float(candidate["sideSign"]) * (exit_price / entry_price - 1.0) * 100.0
    return float(candidate["riskMultiplier"]) * (move - base.NORMAL_BPS / 100.0)


def _mfe_at(
    position: dict[str, Any],
    candles: dict[str, list[dict[str, Any]]],
    index: dict[str, dict[int, int]],
    ts: int,
) -> float | None:
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


def _dv_expectancy(
    candidates: dict[str, list[dict[str, Any]]],
    periods: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    # Only development + validation records are used to freeze the static
    # expectancy inputs for the OOS router.
    dv_start = int(periods["development"][0])
    dv_end = int(periods["validation"][1])
    out: dict[str, dict[str, Any]] = {}
    for symbol, rows in candidates.items():
        values = [
            float(row["netReturnPct"])
            for row in rows
            if dv_start <= int(row["entryTs"]) < dv_end
        ]
        out[symbol] = {
            "trades": len(values),
            "expectancyPct": statistics.fmean(values) if values else 0.0,
            "pf": _pf(values),
            "returnPct": _compound(values),
        }
    return out


def _continuation_score(
    held: dict[str, Any],
    now: int,
    current_price: float,
    dv: dict[str, Any],
) -> float:
    current_return = _trade_return(held, current_price)
    total_bars = max(1.0, (int(held["plannedExitTs"]) - int(held["entryTs"])) / base.HOUR)
    remaining_bars = max(0.0, (int(held["plannedExitTs"]) - int(now)) / base.HOUR)
    remaining_fraction = min(1.0, remaining_bars / total_bars)
    expected_remaining = float(dv.get("expectancyPct", 0.0)) * remaining_fraction
    return (
        REPLACEMENT_SIGNAL_WEIGHT * math.tanh(current_return / 10.0)
        + REPLACEMENT_CONTINUATION_WEIGHT * math.tanh(expected_remaining / 10.0)
    )


def _challenger_score(candidate: dict[str, Any], dv: dict[str, Any]) -> float:
    signal = min(3.0, max(0.0, float(candidate["signalStrength"]))) / 3.0
    expectancy = math.tanh(float(dv.get("expectancyPct", 0.0)) / 10.0)
    return REPLACEMENT_SIGNAL_WEIGHT * signal + REPLACEMENT_CONTINUATION_WEIGHT * expectancy


def _should_preempt(
    policy: str,
    challenger: dict[str, Any],
    held: dict[str, Any],
    ts: int,
    candles: dict[str, list[dict[str, Any]]],
    index: dict[str, dict[int, int]],
    dv_expectancy: dict[str, dict[str, Any]],
    recent_preemptions: dict[str, int],
) -> tuple[bool, str, dict[str, Any]]:
    challenger_symbol = str(challenger["symbol"])
    held_symbol = str(held["symbol"])
    current_price = base._price(candles, index, held_symbol, ts, "open")
    current_return = _trade_return(held, current_price)
    details: dict[str, Any] = {
        "challengerSignalStrength": float(challenger["signalStrength"]),
        "heldUnrealizedNetIfClosedPct": current_return,
        "heldMfePct": _mfe_at(held, candles, index, ts),
    }
    if policy == V1_BASELINE:
        return True, "V1_ALWAYS_PREEMPT_COMPLEMENT", details
    if policy == V5_A:
        if challenger_symbol == "LINK":
            return True, "LINK_ABSOLUTE_PRIORITY", details
        allowed = float(challenger["signalStrength"]) >= SOL_PREEMPT_MIN_STRENGTH
        return allowed, ("SOL_CONDITIONAL_PASS" if allowed else "SOL_CONDITIONAL_REJECT"), details
    if policy == V5_B:
        if current_return > 0.0 and float(challenger["signalStrength"]) < PROFIT_PROTECTED_MIN_STRENGTH:
            return False, "PROFIT_PROTECTED_CHALLENGER_TOO_WEAK", details
        return True, "PROFIT_PROTECTED_PASS", details
    challenger_score = _challenger_score(
        challenger, dv_expectancy.get(challenger_symbol, {})
    )
    held_score = _continuation_score(
        held,
        ts,
        current_price,
        dv_expectancy.get(held_symbol, {}),
    )
    details.update({"challengerScore": challenger_score, "heldContinuationScore": held_score})
    if policy == V5_C:
        allowed = challenger_score - held_score >= REPLACEMENT_MIN_MARGIN
        return allowed, ("REPLACEMENT_SCORE_PASS" if allowed else "REPLACEMENT_SCORE_REJECT"), details
    if policy == V5_D:
        previous = recent_preemptions.get(held_symbol)
        if previous is not None and ts - previous <= TURNOVER_GUARD_BARS * base.HOUR:
            return False, "TURNOVER_GUARD_RECENT_PREEMPT", details
        allowed = challenger_score - held_score >= REPLACEMENT_MIN_MARGIN
        return allowed, ("REPLACEMENT_SCORE_PASS" if allowed else "REPLACEMENT_SCORE_REJECT"), details
    raise ValueError(policy)


def _audit_event(
    held: dict[str, Any],
    challenger: dict[str, Any],
    ts: int,
    candles: dict[str, list[dict[str, Any]]],
    index: dict[str, dict[int, int]],
) -> dict[str, Any]:
    held_symbol = str(held["symbol"])
    challenger_symbol = str(challenger["symbol"])
    current_held_price = base._price(candles, index, held_symbol, ts, "open")
    held_native_exit_ts = int(held["plannedExitTs"])
    held_native_exit_price = float(held["plannedExitPrice"])
    held_actual_pct = _trade_return(held, current_held_price)
    held_remaining_pct = float(held["riskMultiplier"]) * (
        float(held["sideSign"]) * (held_native_exit_price / current_held_price - 1.0) * 100.0
        - base.NORMAL_BPS / 100.0
    )
    challenger_realized_pct = float(challenger["netReturnPct"])
    held_capital = float(held["capital"])
    actual_held_points = held_capital * held_actual_pct / 100.0 * 100.0
    actual_challenger_capital = held_capital * (1.0 + held_actual_pct / 100.0)
    actual_challenger_points = actual_challenger_capital * challenger_realized_pct / 100.0 * 100.0
    no_preempt_points = held_capital * held_remaining_pct / 100.0 * 100.0

    delayed_reason = "SIGNAL_EXPIRED"
    delayed_challenger_pct = 0.0
    delayed_challenger_points = 0.0
    if int(challenger["exitTs"]) > held_native_exit_ts:
        delayed_entry_price = base._price(
            candles, index, challenger_symbol, held_native_exit_ts, "open"
        )
        delayed_challenger_pct = _candidate_return(
            challenger, delayed_entry_price, float(challenger["exitPrice"])
        )
        delayed_capital = held_capital * (1.0 + held_remaining_pct / 100.0)
        delayed_challenger_points = delayed_capital * delayed_challenger_pct / 100.0 * 100.0
        delayed_reason = "SIGNAL_STILL_ACTIVE"

    replacement = actual_challenger_points - no_preempt_points
    return {
        "timestamp": int(ts),
        "currentHeldSymbol": held_symbol,
        "challengerSymbol": challenger_symbol,
        "heldEntryTs": int(held["entryTs"]),
        "heldNativeExitTs": held_native_exit_ts,
        "challengerEntryTs": int(challenger["entryTs"]),
        "challengerExitTs": int(challenger["exitTs"]),
        "heldUnrealizedPnlPct": held_actual_pct,
        "heldMfePct": _mfe_at(held, candles, index, ts),
        "heldRemainingCounterfactualPnlPct": held_remaining_pct,
        "challengerRealizedPnlPct": challenger_realized_pct,
        "delayedChallengerPnlPct": delayed_challenger_pct,
        "delayedSignalStatus": delayed_reason,
        "actualV1TotalPnlPctPoints": actual_held_points + actual_challenger_points,
        "noPreemptTotalPnlPctPoints": no_preempt_points,
        "delayedPreemptTotalPnlPctPoints": no_preempt_points + delayed_challenger_points,
        "replacementValuePctPoints": replacement,
        "actualHeldPnlPctPoints": actual_held_points,
        "challengerGainedPnlPctPoints": actual_challenger_points,
    }


def _aggregate_audit(events: list[dict[str, Any]]) -> dict[str, Any]:
    def group(rows: list[dict[str, Any]]) -> dict[str, Any]:
        replacements = [float(row["replacementValuePctPoints"]) for row in rows]
        return {
            "eventCount": len(rows),
            "positiveReplacementCount": sum(value > 0 for value in replacements),
            "negativeReplacementCount": sum(value < 0 for value in replacements),
            "cumulativeReplacementValuePctPoints": sum(replacements),
            "medianReplacementValuePctPoints": statistics.median(replacements) if replacements else 0.0,
            "meanReplacementValuePctPoints": statistics.fmean(replacements) if replacements else 0.0,
            "actualV1TotalPnlPctPoints": sum(float(row["actualV1TotalPnlPctPoints"]) for row in rows),
            "noPreemptTotalPnlPctPoints": sum(float(row["noPreemptTotalPnlPctPoints"]) for row in rows),
            "delayedPreemptTotalPnlPctPoints": sum(float(row["delayedPreemptTotalPnlPctPoints"]) for row in rows),
        }

    by_challenger = {
        symbol: group([row for row in events if row["challengerSymbol"] == symbol])
        for symbol in ("SOL", "LINK")
    }
    by_held = {}
    for symbol in base.COMPLEMENTS:
        rows = [row for row in events if row["currentHeldSymbol"] == symbol]
        by_held[symbol] = {
            "preemptCount": len(rows),
            "lostContinuationPnlPctPoints": sum(float(row["noPreemptTotalPnlPctPoints"]) for row in rows),
            "challengerGainedPnlPctPoints": sum(float(row["challengerGainedPnlPctPoints"]) for row in rows),
            "netReplacementValuePctPoints": sum(float(row["replacementValuePctPoints"]) for row in rows),
        }
    return {
        "eventCount": len(events),
        "actualV1Total": group(events)["actualV1TotalPnlPctPoints"],
        "noPreemptTotal": group(events)["noPreemptTotalPnlPctPoints"],
        "delayedPreemptTotal": group(events)["delayedPreemptTotalPnlPctPoints"],
        "replacementValueTotal": group(events)["cumulativeReplacementValuePctPoints"],
        "bySOL": by_challenger["SOL"],
        "byLINK": by_challenger["LINK"],
        "byHeldSymbol": by_held,
    }


def run_router(
    candles: dict[str, list[dict[str, Any]]],
    index: dict[str, dict[int, int]],
    periods: dict[str, Any],
    candidates: dict[str, list[dict[str, Any]]],
    policy: str,
    dv_expectancy: dict[str, dict[str, Any]],
    shadow_records: dict[str, list[dict[str, Any]]],
    *,
    audit: bool = False,
) -> dict[str, Any]:
    times = base._common_times(candles, index, periods)
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
    turnover_breakdown = Counter()
    last_close: dict[tuple[str, str], int] = {}
    last_closed_complement: tuple[str, int] | None = None
    recent_preemptions: dict[str, int] = {}
    audit_events: list[dict[str, Any]] = []
    decisions: list[dict[str, Any]] = []

    def positions() -> list[dict[str, Any]]:
        return [slot["position"] for slot in slots if slot["position"] is not None]

    def close_slot(slot: dict[str, Any], ts: int, reason: str, price: float | None = None) -> None:
        nonlocal turnover, last_closed_complement
        position = slot["position"]
        if position is None:
            return
        before = float(position["capital"])
        entry_notional = float(position.get("entryCapital", before))
        exit_price = price if price is not None else float(position["plannedExitPrice"])
        position["closeTs"] = ts
        trade = base._close_position(position, exit_price, reason)
        # Match the frozen V1 turnover convention: exit notional is the
        # post-trade slot capital (the value actually returned to the sleeve).
        exit_notional = float(position["capital"])
        turnover += abs(exit_notional)
        if reason.startswith("PREEMPTED_BY_"):
            turnover_breakdown["preemption_exit"] += abs(exit_notional)
        else:
            turnover_breakdown["normal_exit"] += abs(exit_notional)
        if int(position["entryTs"]) // base.DAY == int(ts) // base.DAY:
            # Diagnostic category is a round-trip notional (entry + exit).
            # The entry leg is counted here because it was classified before
            # the eventual close was known.
            turnover_breakdown["same_day_roundtrip"] += abs(entry_notional) + abs(exit_notional)
        last_close[(str(position["symbol"]), str(position["side"]))] = ts
        if str(position["symbol"]) in base.COMPLEMENTS:
            last_closed_complement = (str(position["symbol"]), ts)
        real_trades.append(trade)
        slot["capital"] = position["capital"]
        slot["position"] = None

    def entry_turnover_kind(candidate: dict[str, Any], ts: int, entry_kind: str) -> str:
        symbol_side = (str(candidate["symbol"]), str(candidate["side"]))
        previous = last_close.get(symbol_side)
        if previous is not None and ts - previous <= REENTRY_WINDOW_BARS * base.HOUR:
            return "re_entry_turnover"
        if last_closed_complement is not None and str(candidate["symbol"]) in base.COMPLEMENTS:
            previous_symbol, previous_ts = last_closed_complement
            if ts - previous_ts <= REENTRY_WINDOW_BARS * base.HOUR and previous_symbol != str(candidate["symbol"]):
                return "complement_switch_turnover"
        if entry_kind == "preemption_replacement":
            return "preemption_entry"
        return "normal_entry"

    def turnover_entry(candidate: dict[str, Any], ts: int, entry_kind: str, capital: float) -> None:
        kind = entry_turnover_kind(candidate, ts, entry_kind)
        turnover_breakdown[kind] += capital

    def open_slot(slot: dict[str, Any], candidate: dict[str, Any], ts: int, entry_kind: str = "normal") -> None:
        nonlocal turnover
        if slot["position"] is not None:
            raise RuntimeError("SLOT_NOT_EMPTY")
        capital = float(slot["capital"])
        turnover += capital
        turnover_entry(candidate, ts, entry_kind, capital)
        slot["position"] = {
            "symbol": candidate["symbol"],
            "side": candidate["side"],
            "sideSign": candidate["sideSign"],
            "entryTs": ts,
            "entryPrice": candidate["entryPrice"],
            "plannedExitTs": candidate["exitTs"],
            "plannedExitPrice": candidate["exitPrice"],
            "capital": capital,
            "entryCapital": capital,
            "riskMultiplier": candidate["riskMultiplier"],
            "signalStrength": candidate["signalStrength"],
            "champion": candidate["champion"],
            "entryKind": entry_kind,
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
                complements = [
                    s for s in slots
                    if s["position"] is not None and s["position"]["symbol"] in base.COMPLEMENTS
                ]
                if not complements:
                    skipped["priority_no_slot"] += 1
                    continue
                target = complements[0]
                old = target["position"]
                assert old is not None
                allowed, reason, details = _should_preempt(
                    policy, challenger, old, ts, candles, index, dv_expectancy, recent_preemptions
                )
                decisions.append({"timestamp": ts, "challenger": symbol, "held": old["symbol"], "allowed": allowed, "reason": reason, **details})
                if not allowed:
                    skipped[reason] += 1
                    continue
                if audit:
                    audit_events.append(_audit_event(old, challenger, ts, candles, index))
                old_symbol = str(old["symbol"])
                exit_price = base._price(candles, index, old_symbol, ts, "open")
                close_slot(target, ts, f"PREEMPTED_BY_{symbol}", exit_price)
                recent_preemptions[old_symbol] = ts
                preempted[f"PREEMPTED_BY_{symbol}"] += 1
                held.discard(old_symbol)
                open_slot(target, challenger, ts, "preemption_replacement")
                held.add(symbol)
                continue
            open_slot(slot, challenger, ts)
            held.add(symbol)

        complement_events = [row for row in at_ts if row["symbol"] in base.COMPLEMENTS and row["symbol"] not in held]
        # Preserve the V1 Wide Participation ranking exactly.  V5 only audits
        # and changes occupied-slot preemption; it does not introduce a new
        # complement entry indicator or ranking policy.
        complement_events = base._rank_complements(
            complement_events, "SHADOW_YTD_RANK", shadow_records, ts
        )
        for candidate in complement_events:
            symbol = str(candidate["symbol"])
            if policy == V5_D:
                previous = last_close.get((symbol, str(candidate["side"])))
                if previous is not None and ts - previous <= TURNOVER_GUARD_BARS * base.HOUR:
                    skipped["TURNOVER_GUARD_REENTRY"] += 1
                    continue
            slot = free_slot()
            if slot is None:
                skipped["complement_no_slot"] += 1
                continue
            open_slot(slot, candidate, ts)
            held.add(symbol)

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
        equity_curve.append({"ts": ts, "equity": equity, "cash": sum(float(s["capital"]) for s in slots if s["position"] is None), "state": state, "positions": [str(p["symbol"]) for p in positions()]})

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
    turnover_breakdown["same_day_roundtrip"] = float(turnover_breakdown["same_day_roundtrip"])
    turnover_breakdown["preemption_turnover"] = float(
        turnover_breakdown["preemption_exit"] + turnover_breakdown["preemption_entry"]
    )
    return {
        "mode": policy,
        "window": {"start": start, "endExclusive": end, "hours": len(equity_curve)},
        "metrics": {
            **metrics,
            "oneYearReturnPct": (final_equity - 1.0) * 100.0,
            "cagrPct": (final_equity ** (1.0 / years) - 1.0) * 100.0 if final_equity > 0 else -100.0,
            "maxDrawdownHourlyMtmPct": max_dd,
            "returnToAbsDrawdown": ((final_equity - 1.0) * 100.0) / abs(max_dd) if abs(max_dd) > 1e-12 else None,
            "realTradeCount": len(real_trades),
            "portfolioTurnoverPctOfInitialEquity": turnover * 100.0,
        },
        "allocationTimePct": {
            "cashPct": allocation["cash"], "SOL_onlyPct": allocation["SOL only"], "LINK_onlyPct": allocation["LINK only"],
            "SOL_LINKPct": allocation["SOL+LINK"], "complement_onlyPct": allocation["complement only"],
            "SOL_complementPct": allocation["SOL/complement"], "LINK_complementPct": allocation["LINK/complement"],
            "averageCashPct": allocation["averageCashPct"],
        },
        "realTrades": real_trades,
        "skippedEventCounts": dict(skipped),
        "adoptedCounts": dict(adopted),
        "preemptedCounts": dict(preempted),
        "equityCurve": equity_curve,
        "turnoverBreakdown": dict(turnover_breakdown),
        "preemptionEvents": audit_events,
        "preemptionDecisions": decisions,
        "policy": {
            "policyId": POLICY_ID,
            "shadowUsedForEntryRejection": False,
            "entryLogicChanged": False,
            "championsFrozen": True,
            "btcPositionWeightPct": 0.0,
            "dvExpectancy": dv_expectancy,
            "normalCostBpsRoundTrip": base.NORMAL_BPS,
            "executionDelayBars": base.EXECUTION_DELAY_BARS,
        },
    }


def _summary(run: dict[str, Any], stress: dict[str, Any], candidates: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    metrics, sm = run["metrics"], stress["metrics"]
    real = run["realTrades"]
    contributions = {symbol: sum(float(row["portfolioPnlPctPoints"]) for row in real if row["symbol"] == symbol) for symbol in base.TRADE_SYMBOLS}
    values = [float(row["portfolioPnlPctPoints"]) for row in real]
    return {
        "returnPct": metrics["oneYearReturnPct"], "cagrPct": metrics["cagrPct"], "pf": metrics["pf"], "pfWithoutBest": metrics["pfWithoutBest"],
        "maxDDPct": metrics["maxDrawdownHourlyMtmPct"], "stressReturnPct": sm["oneYearReturnPct"], "stressPf": sm["pf"], "stressDDPct": sm["maxDrawdownHourlyMtmPct"],
        "trades": metrics["realTradeCount"], "winRatePct": metrics["winRatePct"], "turnoverPct": metrics["portfolioTurnoverPctOfInitialEquity"],
        "cashPct": run["allocationTimePct"]["averageCashPct"], "top5ContributionPctPoints": sum(sorted(values, reverse=True)[:5]) if values else 0.0,
        "returnToDD": metrics["returnToAbsDrawdown"], "allocation": run["allocationTimePct"], "contributionPctPoints": contributions,
        "preemptionCount": sum(run["preemptedCounts"].values()), "preemptionPnlPctPoints": sum(float(row["portfolioPnlPctPoints"]) for row in real if str(row["exitReason"]).startswith("PREEMPTED_BY_")),
        "turnoverBreakdown": run["turnoverBreakdown"],
    }


def run_selftest() -> None:
    assert _should_preempt(V5_A, {"symbol": "LINK", "signalStrength": 0.1}, {"symbol": "BNB", "sideSign": 1, "entryPrice": 100, "riskMultiplier": 1, "entryTs": 1, "plannedExitTs": 10}, 2, {"BNB": [{"ts": 2, "open": 100, "close": 100, "high": 100, "low": 100}]}, {"BNB": {2: 0}}, {"BNB": {}}, {})[0]
    assert TURNOVER_GUARD_BARS == 24
    events = [{"replacementValuePctPoints": 2.0, "actualV1TotalPnlPctPoints": 3.0, "noPreemptTotalPnlPctPoints": 1.0, "delayedPreemptTotalPnlPctPoints": 2.0, "challengerSymbol": "SOL", "currentHeldSymbol": "BNB", "challengerGainedPnlPctPoints": 2.0}]
    assert _aggregate_audit(events)["replacementValueTotal"] == 2.0
    print("PRIORITY_ROUTER_V5_SELFTEST_PASS")


def main() -> None:
    candles, index, _ = v109.b.base.load()
    periods = base._periods(candles)
    candidates, models = base.load_candidates(candles, index, periods)
    stress_candidates = v3._stress_candidates(candles, index, periods, models)
    dv_expectancy = _dv_expectancy(candidates, periods)
    stress_original_bps, stress_original_delay = base.NORMAL_BPS, base.EXECUTION_DELAY_BARS

    shadow_records = {symbol: list(candidates[symbol]) for symbol in base.COMPLEMENTS}
    normal = {policy: run_router(candles, index, periods, candidates, policy, dv_expectancy, shadow_records, audit=policy == V1_BASELINE) for policy in (V1_BASELINE, V5_A, V5_B, V5_C, V5_D)}
    base.NORMAL_BPS, base.EXECUTION_DELAY_BARS = STRESS_BPS, STRESS_DELAY_BARS
    try:
        stress_shadow_records = {symbol: list(stress_candidates[symbol]) for symbol in base.COMPLEMENTS}
        stress = {policy: run_router(candles, index, periods, stress_candidates, policy, dv_expectancy, stress_shadow_records, audit=False) for policy in (V1_BASELINE, V5_A, V5_B, V5_C, V5_D)}
    finally:
        base.NORMAL_BPS, base.EXECUTION_DELAY_BARS = stress_original_bps, stress_original_delay

    summaries = {policy: _summary(normal[policy], stress[policy], candidates) for policy in normal}
    audit_events = normal[V1_BASELINE]["preemptionEvents"]
    result = {
        "status": "RESEARCH_ONLY",
        "productionChanged": False, "vpsChanged": False, "realTradingEnabled": False,
        "btcRole": "REFERENCE_ONLY; position/order/PnL/allocation=0",
        "champions": base.CHAMPION,
        "periods": {key: value for key, value in periods.items() if key in ("development", "validation", "confirmation", "holdout", "fixedWindowStart", "fixedWindowEndExclusive")},
        "normalAssumptions": {"roundTripBps": stress_original_bps, "executionDelayBars": stress_original_delay},
        "stressAssumptions": {"roundTripBps": STRESS_BPS, "executionDelayBars": STRESS_DELAY_BARS},
        "variants": summaries,
        "preemptionAudit": {"events": audit_events, **_aggregate_audit(audit_events)},
        "turnoverAttribution": {policy: summaries[policy]["turnoverBreakdown"] for policy in summaries},
        "profitAttribution": {
            "V5A_vs_V1_returnPctPoints": summaries[V5_A]["returnPct"] - summaries[V1_BASELINE]["returnPct"],
            "V5B_vs_V1_returnPctPoints": summaries[V5_B]["returnPct"] - summaries[V1_BASELINE]["returnPct"],
            "V5C_vs_V1_returnPctPoints": summaries[V5_C]["returnPct"] - summaries[V1_BASELINE]["returnPct"],
            "V5D_vs_V1_returnPctPoints": summaries[V5_D]["returnPct"] - summaries[V1_BASELINE]["returnPct"],
        },
        "diagnostics": {
            "shadowUsedForEntryRejection": False, "entryLogicChanged": False, "championEntryExitChanged": False,
            "allComplementCandidatesEligible": True, "bnbExcluded": False, "realPortfolioPnlIncludesShadow": False,
            "realPortfolioPnlIncludesBtc": False, "counterfactualUsedForRealtime": False,
            "thresholdSource": "development_validation_predeclared", "knownOosExcludedFromTuning": True,
            "oosIsNewEvidence": False, "knownOos": "2025-07-01 08:00 JST through 2026-07-01 08:00 JST; re-evaluation only",
        },
    }
    root = Path(os.environ.get("RESEARCH_STATE_DIR", ".research-state"))
    root.mkdir(parents=True, exist_ok=True)
    path = root / "priority-router-v5-preemption-turnover-1y.json"
    path.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({"status": result["status"], "periods": result["periods"], "variants": summaries, "preemptionAudit": result["preemptionAudit"], "profitAttribution": result["profitAttribution"]}, indent=2))


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        run_selftest()
    else:
        main()
