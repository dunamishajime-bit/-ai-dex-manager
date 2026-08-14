"""Priority Router V4 research-only ablation.

V4 keeps the frozen Champion trade streams and the V1 SOL/LINK priority
router.  Shadow records are causal: only records whose exit timestamp is at
or before the current decision timestamp are visible.  Shadow performance is
used only for promotion state, candidate ordering, and (in the scaling
ablations) complement sleeve size.  No complement is ever disabled.

This module never imports a production, LIVE, VPS, account, approval, or order
path.  BTC remains reference-only.
"""

from __future__ import annotations

import json
import math
import os
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import research_lab_pair_specific_v109 as v109
import research_priority_router_one_year as base
import research_priority_router_v3 as v3


V1_BASELINE = "V1_BASELINE"
V4_PROMOTION_ONLY = "V4_PROMOTION_ONLY"
V4_PROMOTION_PLUS_MISSED_WINNER = "V4_PROMOTION_PLUS_MISSED_WINNER"
V4_PROMOTION_PLUS_PAIR_SCALING = "V4_PROMOTION_PLUS_PAIR_SCALING"
V4_FULL = "V4_FULL"

STRESS_BPS = float(v109.STRESS_BPS)
STRESS_DELAY_BARS = 1

# Fixed before the requested OOS was evaluated.  These values are policy
# constants, not parameters fitted to 2025-07-01..2026-07-01.
PROMOTION_MIN_COMPLETED = 5
PROMOTION_RECENT_SHORT = 5
PROMOTION_RECENT_LONG = 10
PROMOTION_PF_WITHOUT_BEST_MIN = 1.0
PROMOTION_MFE_MAE_RATIO_MIN = 1.0
PROMOTION_VOTE_MIN = 3

# Candidate-score weights are predeclared for development/validation.  The
# score is only a ranking key when multiple complements compete for a slot.
SCORE_WEIGHTS = {
    "signal": 0.35,
    "recent5": 0.20,
    "recent10": 0.10,
    "ytd": 0.10,
    "pfWithoutBest": 0.10,
    "mfeMae": 0.05,
    "missedEdge": 0.10,
}
PROMOTION_BONUS = 0.20
FULL_SIZE = 1.0  # 50% of initial portfolio (one complete sleeve)
HALF_SIZE = 0.5  # 25% of initial portfolio (half of one sleeve)
POLICY_ID = "V4_DV_PREDECLARED_PROMOTION_VOTES_SCORE_AND_PAIR_SCALE"


def _key(row: dict[str, Any]) -> tuple[str, int, str]:
    return str(row["symbol"]), int(row["entryTs"]), str(row["side"])


def _compound(values: list[float]) -> float:
    return base.compound(values)


def _pf(values: list[float]) -> float | None:
    return base.profit_factor(values)


def _without_best(values: list[float]) -> list[float]:
    return base._without_best(values)


def _median(values: list[float]) -> float | None:
    return sum(values) / len(values) if not values else sorted(values)[len(values) // 2]


def _row_median(records: list[dict[str, Any]], field: str) -> float | None:
    values = [float(row[field]) for row in records if row.get(field) is not None]
    if not values:
        return None
    values.sort()
    mid = len(values) // 2
    return values[mid] if len(values) % 2 else (values[mid - 1] + values[mid]) / 2.0


def _return_stats(records: list[dict[str, Any]]) -> dict[str, Any]:
    values = [float(row["netReturnPct"]) for row in records]
    return {
        "trades": len(values),
        "returnPct": _compound(values),
        "pf": _pf(values),
        "pfWithoutBest": _pf(_without_best(values)),
    }


def _causal_shadow_stats(
    records: list[dict[str, Any]],
    now: int,
    accepted_keys: set[tuple[str, int, str]],
    missed_keys: set[tuple[str, int, str]],
) -> dict[str, Any]:
    completed = [row for row in records if int(row["exitTs"]) <= now]
    recent5 = completed[-PROMOTION_RECENT_SHORT:]
    recent10 = completed[-PROMOTION_RECENT_LONG:]
    accepted = [row for row in completed if _key(row) in accepted_keys]
    missed = [row for row in completed if _key(row) in missed_keys]
    ytd = _return_stats(completed)
    short = _return_stats(recent5)
    long = _return_stats(recent10)
    accepted_stats = _return_stats(accepted)
    missed_stats = _return_stats(missed)
    median_mfe = _row_median(completed, "mfePct")
    median_mae = _row_median(completed, "maePct")
    ratio = None
    if median_mfe is not None and median_mae is not None and abs(median_mae) > 1e-12:
        ratio = median_mfe / abs(median_mae)
    return {
        "completedTrades": len(completed),
        "recent5Trades": len(recent5),
        "recent10Trades": len(recent10),
        "ytdReturnPct": ytd["returnPct"],
        "ytdPf": ytd["pf"],
        "ytdPfWithoutBest": ytd["pfWithoutBest"],
        "recent5ReturnPct": short["returnPct"],
        "recent5Pf": short["pf"],
        "recent5PfWithoutBest": short["pfWithoutBest"],
        "recent10ReturnPct": long["returnPct"],
        "recent10Pf": long["pf"],
        "recent10PfWithoutBest": long["pfWithoutBest"],
        "medianMfePct": median_mfe,
        "medianMaePct": median_mae,
        "mfeMaeRatio": ratio,
        "acceptedShadowTrades": accepted_stats["trades"],
        "acceptedShadowReturnPct": accepted_stats["returnPct"],
        "acceptedShadowPf": accepted_stats["pf"],
        "missedShadowTrades": missed_stats["trades"],
        "missedShadowReturnPct": missed_stats["returnPct"],
        "missedShadowPf": missed_stats["pf"],
        "missedWinnerEdgePctPoints": missed_stats["returnPct"] - accepted_stats["returnPct"],
        "signalStrength": float(completed[-1]["signalStrength"]) if completed else 0.0,
    }


def _promotion_state(stats: dict[str, Any]) -> tuple[str, dict[str, bool]]:
    if int(stats["completedTrades"]) < PROMOTION_MIN_COMPLETED:
        return "NEUTRAL", {
            "recent5Positive": False,
            "ytdPositive": False,
            "pfWithoutBestPass": False,
            "mfeMaePass": False,
            "missedWinnerPass": False,
        }
    votes = {
        "recent5Positive": float(stats["recent5ReturnPct"]) > 0.0,
        "ytdPositive": float(stats["ytdReturnPct"]) > 0.0,
        "pfWithoutBestPass": (stats["ytdPfWithoutBest"] or 0.0) >= PROMOTION_PF_WITHOUT_BEST_MIN,
        "mfeMaePass": (stats["mfeMaeRatio"] or 0.0) >= PROMOTION_MFE_MAE_RATIO_MIN,
        "missedWinnerPass": (
            int(stats["missedShadowTrades"]) > 0
            and int(stats["acceptedShadowTrades"]) > 0
            and float(stats["missedWinnerEdgePctPoints"]) > 0.0
        ),
    }
    return ("PROMOTED" if sum(votes.values()) >= PROMOTION_VOTE_MIN else "NEUTRAL"), votes


def _squash(value: float | None, scale: float) -> float:
    if value is None:
        return 0.0
    return math.tanh(float(value) / scale)


def _candidate_score(
    candidate: dict[str, Any],
    stats: dict[str, Any],
    state: str,
    use_missed_winner: bool,
) -> float:
    signal = min(3.0, max(0.0, float(candidate["signalStrength"]))) / 3.0
    score = (
        SCORE_WEIGHTS["signal"] * signal
        + SCORE_WEIGHTS["recent5"] * _squash(stats["recent5ReturnPct"], 10.0)
        + SCORE_WEIGHTS["recent10"] * _squash(stats["recent10ReturnPct"], 15.0)
        + SCORE_WEIGHTS["ytd"] * _squash(stats["ytdReturnPct"], 25.0)
        + SCORE_WEIGHTS["pfWithoutBest"] * _squash(
            (stats["ytdPfWithoutBest"] or 0.0) - 1.0, 0.5
        )
        + SCORE_WEIGHTS["mfeMae"] * _squash(
            (stats["mfeMaeRatio"] or 1.0) - 1.0, 1.0
        )
    )
    if use_missed_winner:
        score += SCORE_WEIGHTS["missedEdge"] * _squash(
            stats["missedWinnerEdgePctPoints"], 10.0
        )
    if state == "PROMOTED":
        score += PROMOTION_BONUS
    return score


def _rank_candidates(
    candidates: list[dict[str, Any]],
    shadow_records: dict[str, list[dict[str, Any]]],
    now: int,
    accepted_keys: dict[str, set[tuple[str, int, str]]],
    missed_keys: dict[str, set[tuple[str, int, str]]],
    use_missed_winner: bool,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    rows: list[tuple[dict[str, Any], dict[str, Any]]] = []
    decisions: list[dict[str, Any]] = []
    for candidate in candidates:
        symbol = str(candidate["symbol"])
        stats = _causal_shadow_stats(
            shadow_records[symbol],
            now,
            accepted_keys[symbol],
            missed_keys[symbol],
        )
        state, votes = _promotion_state(stats)
        score = _candidate_score(candidate, stats, state, use_missed_winner)
        decision = {
            "symbol": symbol,
            "entryTs": int(candidate["entryTs"]),
            "side": candidate["side"],
            "allowed": True,
            "reason": "RANKED_ONLY",
            "promotionState": state,
            "promotionVotes": votes,
            "candidateScore": score,
            "signalStrength": float(candidate["signalStrength"]),
            "shadowStats": stats,
        }
        decisions.append(decision)
        rows.append((candidate, decision))
    rows.sort(
        key=lambda item: (
            float(item[1]["candidateScore"]),
            1 if item[1]["promotionState"] == "PROMOTED" else 0,
            float(item[0]["signalStrength"]),
            str(item[0]["symbol"]),
        ),
        reverse=True,
    )
    return [item[0] for item in rows], decisions


def _pair_scale(symbol: str, state: str, enabled: bool) -> float:
    if not enabled:
        return FULL_SIZE
    # Pair-specific policy: every complement remains eligible; a promoted
    # state receives a complete 50% sleeve and neutral state receives 25%.
    if symbol in base.COMPLEMENTS and state == "PROMOTED":
        return FULL_SIZE
    return HALF_SIZE


def _selection_accuracy(
    groups: list[dict[str, Any]],
    candidates_by_key: dict[tuple[str, int, str], dict[str, Any]],
) -> dict[str, Any]:
    total = len(groups)
    hits = 0
    for group in groups:
        rows = [candidates_by_key[key] for key in group["candidateKeys"] if key in candidates_by_key]
        if not rows:
            continue
        best = max(float(row["netReturnPct"]) for row in rows)
        best_keys = {
            _key(row) for row in rows if abs(float(row["netReturnPct"]) - best) < 1e-12
        }
        if best_keys & set(group["selectedKeys"]):
            hits += 1
    return {
        "competitiveEvents": total,
        "hitEvents": hits,
        "accuracyPct": hits / total * 100.0 if total else None,
        "usesFutureForRouting": False,
        "diagnosticOnly": True,
    }


def run_v4_router(
    candles: dict[str, list[dict[str, Any]]],
    index: dict[str, dict[int, int]],
    periods: dict[str, Any],
    candidates: dict[str, list[dict[str, Any]]],
    mode: str,
    *,
    use_missed_winner: bool,
    use_pair_scaling: bool,
) -> dict[str, Any]:
    times = base._common_times(candles, index, periods)
    events: dict[int, list[dict[str, Any]]] = defaultdict(list)
    candidates_by_key = {_key(row): row for rows in candidates.values() for row in rows}
    for rows in candidates.values():
        for row in rows:
            events[int(row["entryTs"])].append(row)

    shadow_records = {symbol: list(candidates[symbol]) for symbol in base.COMPLEMENTS}
    accepted_keys = {symbol: set() for symbol in base.COMPLEMENTS}
    missed_keys = {symbol: set() for symbol in base.COMPLEMENTS}
    slots: list[dict[str, Any]] = [
        {"cash": base.SLOT_INITIAL_CAPITAL, "position": None},
        {"cash": base.SLOT_INITIAL_CAPITAL, "position": None},
    ]
    real_trades: list[dict[str, Any]] = []
    skipped: Counter[str] = Counter()
    adopted: Counter[str] = Counter()
    preempted: Counter[str] = Counter()
    selected_events: list[dict[str, Any]] = []
    decisions: dict[tuple[str, int, str], dict[str, Any]] = {}
    promotion_counts: dict[str, Counter[str]] = {
        symbol: Counter() for symbol in base.COMPLEMENTS
    }
    size_counts: dict[str, Counter[str]] = {
        symbol: Counter() for symbol in base.COMPLEMENTS
    }
    competition_groups: list[dict[str, Any]] = []
    equity_curve: list[dict[str, Any]] = []
    state_counts: Counter[str] = Counter()
    turnover = 0.0

    def positions() -> list[dict[str, Any]]:
        return [slot["position"] for slot in slots if slot["position"] is not None]

    def close_slot(slot: dict[str, Any], ts: int, reason: str, price: float | None = None) -> None:
        nonlocal turnover
        position = slot["position"]
        if position is None:
            return
        exit_price = price if price is not None else float(position["plannedExitPrice"])
        real_trades.append(v3._close_position(slot, ts, exit_price, reason))
        turnover += float(position["capital"])

    def open_slot(slot: dict[str, Any], candidate: dict[str, Any], ts: int, scale: float) -> None:
        nonlocal turnover
        if slot["position"] is not None:
            raise RuntimeError("SLOT_NOT_EMPTY")
        available = float(slot["cash"])
        capital = available * scale
        if capital <= 0.0:
            raise RuntimeError("NON_POSITIVE_ALLOCATION")
        slot["cash"] = available - capital
        slot["position"] = {
            "symbol": candidate["symbol"],
            "side": candidate["side"],
            "sideSign": candidate["sideSign"],
            "entryTs": ts,
            "entryPrice": candidate["entryPrice"],
            "plannedExitTs": candidate["exitTs"],
            "plannedExitPrice": candidate["exitPrice"],
            "capital": capital,
            "riskMultiplier": candidate["riskMultiplier"],
            "signalStrength": candidate["signalStrength"],
            "champion": candidate["champion"],
            "allocationScale": scale,
        }
        turnover += capital
        adopted[str(candidate["symbol"])] += 1
        if candidate["symbol"] in base.COMPLEMENTS:
            size_counts[str(candidate["symbol"])]
            size_counts[str(candidate["symbol"])]["50pct" if scale == FULL_SIZE else "25pct"] += 1

    def free_slot() -> dict[str, Any] | None:
        return next((slot for slot in slots if slot["position"] is None), None)

    def held_symbols() -> set[str]:
        return {str(position["symbol"]) for position in positions()}

    for ts in times:
        for slot in slots:
            position = slot["position"]
            if position is not None and int(position["plannedExitTs"]) <= ts:
                close_slot(slot, ts, "CHAMPION_EXIT", float(position["plannedExitPrice"]))

        at_ts = events.get(ts, [])
        held = held_symbols()
        priorities = [row for row in at_ts if row["symbol"] in base.PRIORITY]
        priorities.sort(key=lambda row: (0 if row["symbol"] == "SOL" else 1, row["symbol"]))
        for candidate in priorities:
            symbol = str(candidate["symbol"])
            if symbol in held:
                skipped["priority_already_held"] += 1
                continue
            slot = free_slot()
            if slot is None:
                complement_slots = [
                    slot for slot in slots
                    if slot["position"] is not None
                    and slot["position"]["symbol"] in base.COMPLEMENTS
                ]
                if complement_slots:
                    slot = complement_slots[0]
                    old = slot["position"]
                    assert old is not None
                    old_symbol = str(old["symbol"])
                    exit_price = base._price(candles, index, old_symbol, ts, "open")
                    close_slot(slot, ts, f"PREEMPTED_BY_{symbol}", exit_price)
                    preempted[f"PREEMPTED_BY_{symbol}"] += 1
                    held.discard(old_symbol)
                else:
                    skipped["priority_no_slot"] += 1
                    continue
            open_slot(slot, candidate, ts, FULL_SIZE)
            held.add(symbol)

        complement_events = [row for row in at_ts if row["symbol"] in base.COMPLEMENTS]
        rankable = [row for row in complement_events if row["symbol"] not in held]
        ranked, rank_decisions = _rank_candidates(
            rankable,
            shadow_records,
            ts,
            accepted_keys,
            missed_keys,
            use_missed_winner,
        )
        decision_by_key = {
            (_key(row)[0], _key(row)[1], _key(row)[2]): row
            for row in rank_decisions
        }
        for decision in rank_decisions:
            key = (str(decision["symbol"]), int(decision["entryTs"]), str(decision["side"]))
            decisions[key] = decision
            promotion_counts[decision["symbol"]][decision["promotionState"]] += 1
        for candidate in complement_events:
            key = _key(candidate)
            if candidate["symbol"] in held:
                decisions[key] = {
                    "symbol": candidate["symbol"],
                    "entryTs": int(candidate["entryTs"]),
                    "side": candidate["side"],
                    "allowed": False,
                    "reason": "COMPLEMENT_ALREADY_HELD",
                    "promotionState": "NEUTRAL",
                    "candidateScore": None,
                }
                promotion_counts[str(candidate["symbol"])] ["NEUTRAL"] += 1
                missed_keys[str(candidate["symbol"])].add(key)

        available = sum(1 for slot in slots if slot["position"] is None)
        selected_keys_at_ts: list[tuple[str, int, str]] = []
        for candidate in ranked:
            key = _key(candidate)
            decision = decisions[key]
            symbol = str(candidate["symbol"])
            if symbol in held:
                decision["allowed"] = False
                decision["reason"] = "COMPLEMENT_ALREADY_HELD"
                missed_keys[symbol].add(key)
                skipped["complement_already_held"] += 1
                continue
            if available <= 0:
                decision["allowed"] = False
                decision["reason"] = "NO_FREE_SLOT"
                missed_keys[symbol].add(key)
                skipped["complement_no_slot"] += 1
                continue
            slot = free_slot()
            if slot is None:
                decision["allowed"] = False
                decision["reason"] = "NO_FREE_SLOT"
                missed_keys[symbol].add(key)
                skipped["complement_no_slot"] += 1
                continue
            scale = _pair_scale(symbol, str(decision["promotionState"]), use_pair_scaling)
            open_slot(slot, candidate, ts, scale)
            held.add(symbol)
            accepted_keys[symbol].add(key)
            selected_keys_at_ts.append(key)
            available -= 1
            decision["allowed"] = True
            decision["reason"] = "ADOPTED"
            decision["allocationScale"] = scale
            selected_events.append({
                "ts": ts,
                "symbol": symbol,
                "mode": mode,
                "rank": ranked.index(candidate) + 1,
                "promotionState": decision["promotionState"],
                "candidateScore": decision["candidateScore"],
                "allocationScale": scale,
                "shadowStats": decision["shadowStats"],
            })
        for candidate in rankable:
            key = _key(candidate)
            if key not in accepted_keys[str(candidate["symbol"])] and key not in missed_keys[str(candidate["symbol"])] :
                missed_keys[str(candidate["symbol"])].add(key)
        if len(rankable) > 1:
            competition_groups.append({
                "ts": ts,
                "candidateKeys": [_key(row) for row in rankable],
                "selectedKeys": selected_keys_at_ts,
            })

        marks: list[float] = []
        for slot in slots:
            position = slot["position"]
            mark = float(slot["cash"])
            if position is not None:
                mark += v3._position_value(
                    position,
                    base._price(candles, index, str(position["symbol"]), ts, "close"),
                )
            marks.append(mark)
        equity = sum(marks)
        state = base._state_label(positions())
        state_counts[state] += 1
        equity_curve.append({
            "ts": ts,
            "equity": equity,
            "cash": sum(float(slot["cash"]) for slot in slots),
            "state": state,
            "positions": [str(position["symbol"]) for position in positions()],
        })

    final_ts = times[-1]
    for slot in slots:
        if slot["position"] is not None:
            position = slot["position"]
            close_slot(slot, final_ts, "PERIOD_END", base._price(
                candles, index, str(position["symbol"]), final_ts, "close"
            ))

    equities = [float(row["equity"]) for row in equity_curve]
    peak = equities[0]
    max_dd = 0.0
    for value in equities:
        peak = max(peak, value)
        max_dd = min(max_dd, (value / peak - 1.0) * 100.0)
    final_equity = sum(float(slot["cash"]) for slot in slots)
    contributions = [float(row["portfolioPnlPctPoints"]) for row in real_trades]
    metrics = base.metric_from_trade_contributions(contributions)
    start = int(periods["fixedWindowStart"])
    end = int(periods["fixedWindowEndExclusive"])
    years = (end - start) / (365.0 * base.DAY)
    return_pct = (final_equity - 1.0) * 100.0
    allocation = {
        "cash": state_counts["cash"] / len(equity_curve) * 100.0,
        "SOL only": state_counts["SOL only"] / len(equity_curve) * 100.0,
        "LINK only": state_counts["LINK only"] / len(equity_curve) * 100.0,
        "SOL+LINK": state_counts["SOL+LINK"] / len(equity_curve) * 100.0,
        "complement only": state_counts["complement only"] / len(equity_curve) * 100.0,
        "SOL/complement": state_counts["SOL/complement"] / len(equity_curve) * 100.0,
        "LINK/complement": state_counts["LINK/complement"] / len(equity_curve) * 100.0,
    }
    allocation["averageCashPct"] = sum(
        float(row["cash"]) / max(float(row["equity"]), 1e-12) * 100.0
        for row in equity_curve
    ) / len(equity_curve)
    return {
        "mode": mode,
        "window": {"start": start, "endExclusive": end, "hours": len(equity_curve)},
        "metrics": {
            **metrics,
            "oneYearReturnPct": return_pct,
            "cagrPct": (final_equity ** (1.0 / years) - 1.0) * 100.0 if final_equity > 0 else -100.0,
            "maxDrawdownHourlyMtmPct": max_dd,
            "returnToAbsDrawdown": return_pct / abs(max_dd) if abs(max_dd) > 1e-12 else None,
            "realTradeCount": len(real_trades),
            "portfolioTurnoverPctOfInitialEquity": turnover * 100.0,
        },
        "allocationTimePct": {
            "cashPct": allocation["cash"],
            "SOL_onlyPct": allocation["SOL only"],
            "LINK_onlyPct": allocation["LINK only"],
            "SOL_LINKPct": allocation["SOL+LINK"],
            "complement_onlyPct": allocation["complement only"],
            "SOL_complementPct": allocation["SOL/complement"],
            "LINK_complementPct": allocation["LINK/complement"],
            "averageCashPct": allocation["averageCashPct"],
        },
        "realTrades": real_trades,
        "selectedComplementEvents": selected_events,
        "complementDecisions": list(decisions.values()),
        "skippedEventCounts": dict(skipped),
        "adoptedCounts": dict(adopted),
        "preemptedCounts": dict(preempted),
        "equityCurve": equity_curve,
        "finalEquity": final_equity,
        "routerDiagnostics": {
            "acceptedKeys": {symbol: sorted(accepted_keys[symbol]) for symbol in base.COMPLEMENTS},
            "missedKeys": {symbol: sorted(missed_keys[symbol]) for symbol in base.COMPLEMENTS},
            "promotionCounts": {symbol: dict(promotion_counts[symbol]) for symbol in base.COMPLEMENTS},
            "sizeCounts": {symbol: dict(size_counts[symbol]) for symbol in base.COMPLEMENTS},
            "selectionAccuracy": _selection_accuracy(competition_groups, candidates_by_key),
            "useMissedWinner": use_missed_winner,
            "usePairScaling": use_pair_scaling,
        },
        "policy": {
            "policyId": POLICY_ID,
            "promotionStates": ["PROMOTED", "NEUTRAL"],
            "completelyDisabled": [],
            "promotionMinCompleted": PROMOTION_MIN_COMPLETED,
            "promotionVoteMin": PROMOTION_VOTE_MIN,
            "promotionPfWithoutBestMin": PROMOTION_PF_WITHOUT_BEST_MIN,
            "promotionMfeMaeRatioMin": PROMOTION_MFE_MAE_RATIO_MIN,
            "scoreWeights": SCORE_WEIGHTS,
            "promotionBonus": PROMOTION_BONUS,
            "complementSizeByState": {"PROMOTED": "50%", "NEUTRAL": "25%"},
            "shadowUsedFor": ["PROMOTION", "RANKING", "SIZE_ONLY"],
            "shadowUsedForEntryRejection": False,
            "rankingUsesCompletedShadowOnly": True,
            "priority": list(base.PRIORITY),
            "complements": list(base.COMPLEMENTS),
            "btcPositionWeightPct": 0.0,
            "normalCostBpsRoundTrip": base.NORMAL_BPS,
            "executionDelayBars": base.EXECUTION_DELAY_BARS,
        },
    }


def _supplement_summary(
    symbol: str,
    run: dict[str, Any],
    candidates: dict[str, list[dict[str, Any]]],
) -> dict[str, Any]:
    diagnostics = run.get("routerDiagnostics", {})
    accepted = {_tuple for _tuple in diagnostics.get("acceptedKeys", {}).get(symbol, [])}
    missed = {_tuple for _tuple in diagnostics.get("missedKeys", {}).get(symbol, [])}
    # JSON turns tuple keys into lists; normalize them before matching.
    accepted = {tuple(row) for row in accepted}
    missed = {tuple(row) for row in missed}
    all_shadow = candidates[symbol]
    real = [row for row in run["realTrades"] if row["symbol"] == symbol]
    accepted_shadow = [row for row in all_shadow if _key(row) in accepted]
    missed_shadow = [row for row in all_shadow if _key(row) in missed]
    if not accepted and not missed:
        accepted_shadow = [row for row in all_shadow if any(
            trade["symbol"] == symbol
            and int(trade["entryTs"]) == int(row["entryTs"])
            and str(trade["side"]) == str(row["side"])
            for trade in real
        )]
        accepted = {_key(row) for row in accepted_shadow}
        missed_shadow = [row for row in all_shadow if _key(row) not in accepted]
    contribution = sum(float(row["portfolioPnlPctPoints"]) for row in real)
    promotions = diagnostics.get("promotionCounts", {}).get(symbol, {})
    sizes = diagnostics.get("sizeCounts", {}).get(symbol, {})
    return {
        "realTrades": len(real),
        "realPnlPctPoints": contribution,
        "shadowTrades": len(all_shadow),
        "shadowHypotheticalReturnPct": _compound([float(row["netReturnPct"]) for row in all_shadow]),
        "shadowPf": _pf([float(row["netReturnPct"]) for row in all_shadow]),
        "shadowPfWithoutBest": _pf(_without_best([float(row["netReturnPct"]) for row in all_shadow])),
        "acceptedCount": len(accepted_shadow),
        "missedCount": len(missed_shadow),
        "missedHypotheticalReturnPct": _compound([float(row["netReturnPct"]) for row in missed_shadow]),
        "acceptedHypotheticalReturnPct": _compound([float(row["netReturnPct"]) for row in accepted_shadow]),
        "missedWinnerEdgePctPoints": _compound([float(row["netReturnPct"]) for row in missed_shadow])
        - _compound([float(row["netReturnPct"]) for row in accepted_shadow]),
        "promotionCount": int(promotions.get("PROMOTED", 0)),
        "neutralCount": int(promotions.get("NEUTRAL", 0)),
        "size50PctCount": int(sizes.get("50pct", 0)),
        "size25PctCount": int(sizes.get("25pct", 0)),
        "preemptionCount": sum(
            1 for row in real
            if str(row["exitReason"]).startswith("PREEMPTED_BY_")
        ),
        "preemptionPnlPctPoints": sum(
            float(row["portfolioPnlPctPoints"]) for row in real
            if str(row["exitReason"]).startswith("PREEMPTED_BY_")
        ),
    }


def _summary(
    run: dict[str, Any],
    stress: dict[str, Any],
    candidates: dict[str, list[dict[str, Any]]],
) -> dict[str, Any]:
    metrics = run["metrics"]
    stress_metrics = stress["metrics"]
    real = run["realTrades"]
    contributions = {
        symbol: sum(float(row["portfolioPnlPctPoints"]) for row in real if row["symbol"] == symbol)
        for symbol in base.TRADE_SYMBOLS
    }
    values = [float(row["portfolioPnlPctPoints"]) for row in real]
    return {
        "returnPct": metrics["oneYearReturnPct"],
        "cagrPct": metrics["cagrPct"],
        "pf": metrics["pf"],
        "pfWithoutBest": metrics["pfWithoutBest"],
        "maxDDPct": metrics["maxDrawdownHourlyMtmPct"],
        "returnToDD": metrics["returnToAbsDrawdown"],
        "stressReturnPct": stress_metrics["oneYearReturnPct"],
        "stressPf": stress_metrics["pf"],
        "stressDDPct": stress_metrics["maxDrawdownHourlyMtmPct"],
        "trades": metrics["realTradeCount"],
        "winRatePct": metrics["winRatePct"],
        "turnoverPct": metrics["portfolioTurnoverPctOfInitialEquity"],
        "allocation": run["allocationTimePct"],
        "contributionPctPoints": contributions,
        "top5ContributionPctPoints": sum(sorted(values, reverse=True)[:5]) if values else 0.0,
        "preemptionCount": sum(run["preemptedCounts"].values()),
        "preemptionPnlPctPoints": sum(
            float(row["portfolioPnlPctPoints"]) for row in real
            if str(row["exitReason"]).startswith("PREEMPTED_BY_")
        ),
        "supplement": {
            symbol: _supplement_summary(symbol, run, candidates)
            for symbol in base.COMPLEMENTS
        },
        "candidateSelectionAccuracy": run.get("routerDiagnostics", {}).get("selectionAccuracy"),
    }


def _baseline_summary(
    run: dict[str, Any],
    stress: dict[str, Any],
    candidates: dict[str, list[dict[str, Any]]],
) -> dict[str, Any]:
    summary = v3._summary(run, stress, candidates)
    for symbol in base.COMPLEMENTS:
        summary["supplement"][symbol].update({
            "acceptedCount": summary["supplement"][symbol].pop("adoptedCount"),
            "missedCount": summary["supplement"][symbol].pop("notAdoptedCount"),
            "missedHypotheticalReturnPct": summary["supplement"][symbol].pop("notAdoptedShadowHypotheticalPnlPct"),
            "acceptedHypotheticalReturnPct": None,
            "missedWinnerEdgePctPoints": None,
            "promotionCount": 0,
            "neutralCount": 0,
            "size50PctCount": summary["supplement"][symbol]["realTrades"],
            "size25PctCount": 0,
            "preemptionCount": summary["supplement"][symbol].pop("preemptedBySolCount") + summary["supplement"][symbol].pop("preemptedByLinkCount"),
            "preemptionPnlPctPoints": summary["supplement"][symbol].pop("preemptedBySolPnlPctPoints") + summary["supplement"][symbol].pop("preemptedByLinkPnlPctPoints"),
        })
    summary["candidateSelectionAccuracy"] = None
    return summary


def _attribution(summaries: dict[str, dict[str, Any]]) -> dict[str, Any]:
    return {
        "promotionEffectPctPoints": summaries[V4_PROMOTION_ONLY]["returnPct"] - summaries[V1_BASELINE]["returnPct"],
        "missedWinnerRecoveryEffectPctPoints": summaries[V4_PROMOTION_PLUS_MISSED_WINNER]["returnPct"] - summaries[V4_PROMOTION_ONLY]["returnPct"],
        "pairScalingEffectPctPoints": summaries[V4_PROMOTION_PLUS_PAIR_SCALING]["returnPct"] - summaries[V4_PROMOTION_ONLY]["returnPct"],
        "fullVsMissedWinnerScalingEffectPctPoints": summaries[V4_FULL]["returnPct"] - summaries[V4_PROMOTION_PLUS_MISSED_WINNER]["returnPct"],
        "fullVsBaselinePctPoints": summaries[V4_FULL]["returnPct"] - summaries[V1_BASELINE]["returnPct"],
        "ddChangeVsBaselinePctPoints": summaries[V4_FULL]["maxDDPct"] - summaries[V1_BASELINE]["maxDDPct"],
        "stressPfChangeVsBaseline": summaries[V4_FULL]["stressPf"] - summaries[V1_BASELINE]["stressPf"],
    }


def _shadow_attribution(summary: dict[str, Any]) -> dict[str, Any]:
    return {
        symbol: {
            "acceptedHypotheticalReturnPct": summary["supplement"][symbol]["acceptedHypotheticalReturnPct"],
            "missedHypotheticalReturnPct": summary["supplement"][symbol]["missedHypotheticalReturnPct"],
            "missedWinnerEdgePctPoints": summary["supplement"][symbol]["missedWinnerEdgePctPoints"],
            "realPnlPctPoints": summary["supplement"][symbol]["realPnlPctPoints"],
        }
        for symbol in base.COMPLEMENTS
    }


def run_selftest() -> None:
    assert set(base.COMPLEMENTS) == {"ETH", "BNB", "AVAX"}
    assert _pair_scale("BNB", "PROMOTED", True) == 1.0
    assert _pair_scale("ETH", "NEUTRAL", True) == 0.5
    assert _pair_scale("AVAX", "NEUTRAL", False) == 1.0
    records = [
        {"symbol": "ETH", "entryTs": i, "exitTs": i, "side": "LONG", "netReturnPct": 1.0, "signalStrength": 1.0, "mfePct": 2.0, "maePct": -1.0}
        for i in range(1, 7)
    ]
    stats = _causal_shadow_stats(records, 3, {("ETH", 1, "LONG")}, {("ETH", 2, "LONG")})
    assert stats["completedTrades"] == 3
    assert stats["acceptedShadowTrades"] == 1
    assert stats["missedShadowTrades"] == 1
    state, votes = _promotion_state(_causal_shadow_stats(records, 6, set(), set()))
    assert state in {"PROMOTED", "NEUTRAL"}
    assert set(votes) == {"recent5Positive", "ytdPositive", "pfWithoutBestPass", "mfeMaePass", "missedWinnerPass"}
    print("PRIORITY_ROUTER_V4_SELFTEST_PASS")


def main() -> None:
    candles, index, _ = v109.b.base.load()
    periods = base._periods(candles)
    candidates, models = base.load_candidates(candles, index, periods)
    stress_candidates = v3._stress_candidates(candles, index, periods, models)

    normal_runs = {
        V1_BASELINE: base.run_router("SHADOW_YTD_RANK", candles, index, periods, candidates),
        "SOL/LINK-only": base.run_router("SOL_LINK_FIXED_50_50", candles, index, periods, candidates),
        V4_PROMOTION_ONLY: run_v4_router(candles, index, periods, candidates, V4_PROMOTION_ONLY, use_missed_winner=False, use_pair_scaling=False),
        V4_PROMOTION_PLUS_MISSED_WINNER: run_v4_router(candles, index, periods, candidates, V4_PROMOTION_PLUS_MISSED_WINNER, use_missed_winner=True, use_pair_scaling=False),
        V4_PROMOTION_PLUS_PAIR_SCALING: run_v4_router(candles, index, periods, candidates, V4_PROMOTION_PLUS_PAIR_SCALING, use_missed_winner=False, use_pair_scaling=True),
        V4_FULL: run_v4_router(candles, index, periods, candidates, V4_FULL, use_missed_winner=True, use_pair_scaling=True),
    }
    original_bps = base.NORMAL_BPS
    original_delay = base.EXECUTION_DELAY_BARS
    base.NORMAL_BPS = STRESS_BPS
    base.EXECUTION_DELAY_BARS = STRESS_DELAY_BARS
    try:
        stress_runs = {
            V1_BASELINE: base.run_router("SHADOW_YTD_RANK", candles, index, periods, stress_candidates),
            "SOL/LINK-only": base.run_router("SOL_LINK_FIXED_50_50", candles, index, periods, stress_candidates),
            V4_PROMOTION_ONLY: run_v4_router(candles, index, periods, stress_candidates, V4_PROMOTION_ONLY, use_missed_winner=False, use_pair_scaling=False),
            V4_PROMOTION_PLUS_MISSED_WINNER: run_v4_router(candles, index, periods, stress_candidates, V4_PROMOTION_PLUS_MISSED_WINNER, use_missed_winner=True, use_pair_scaling=False),
            V4_PROMOTION_PLUS_PAIR_SCALING: run_v4_router(candles, index, periods, stress_candidates, V4_PROMOTION_PLUS_PAIR_SCALING, use_missed_winner=False, use_pair_scaling=True),
            V4_FULL: run_v4_router(candles, index, periods, stress_candidates, V4_FULL, use_missed_winner=True, use_pair_scaling=True),
        }
    finally:
        base.NORMAL_BPS = original_bps
        base.EXECUTION_DELAY_BARS = original_delay

    summaries = {
        label: (
            _baseline_summary(normal_runs[label], stress_runs[label], candidates)
            if label in {V1_BASELINE, "SOL/LINK-only"}
            else _summary(normal_runs[label], stress_runs[label], candidates)
        )
        for label in normal_runs
    }
    result = {
        "status": "RESEARCH_ONLY",
        "productionChanged": False,
        "vpsChanged": False,
        "realTradingEnabled": False,
        "btcRole": "REFERENCE_ONLY; position/order/PnL/allocation=0",
        "champions": base.CHAMPION,
        "periods": {key: value for key, value in periods.items() if key in (
            "development", "validation", "confirmation", "holdout",
            "fixedWindowStart", "fixedWindowEndExclusive",
        )},
        "normalAssumptions": {"roundTripBps": original_bps, "executionDelayBars": original_delay},
        "stressAssumptions": {"roundTripBps": STRESS_BPS, "executionDelayBars": STRESS_DELAY_BARS},
        "variants": summaries,
        "ablation": {
            "V1_BASELINE": "Frozen V1 Wide Participation",
            "V4_PROMOTION_ONLY": "Promotion state + V4 score, no missed-winner term, full size",
            "V4_PROMOTION_PLUS_MISSED_WINNER": "Promotion + missed-winner score, full size",
            "V4_PROMOTION_PLUS_PAIR_SCALING": "Promotion score + pair-specific 50/25% size",
            "V4_FULL": "Promotion + missed-winner score + pair-specific scaling",
        },
        "profitAttribution": _attribution(summaries),
        "shadowAttribution": {
            label: _shadow_attribution(summaries[label])
            for label in (V4_PROMOTION_ONLY, V4_PROMOTION_PLUS_MISSED_WINNER, V4_PROMOTION_PLUS_PAIR_SCALING, V4_FULL)
        },
        "diagnostics": {
            "shadowRankIsCausal": True,
            "rankingUsesOnlyCompletedShadowTrades": True,
            "shadowUsedForEntryRejection": False,
            "allComplementCandidatesEligible": True,
            "completelyDisabledSymbols": [],
            "bnbExcluded": False,
            "championEntryExitChanged": False,
            "realPortfolioPnlIncludesShadow": False,
            "realPortfolioPnlIncludesBtc": False,
            "thresholdSource": "development_validation_predeclared",
            "knownOosExcludedFromTuning": True,
            "oosIsNewEvidence": False,
            "knownOos": "2025-07-01 08:00 JST through 2026-07-01 08:00 JST; re-evaluation only",
            "candidateSelectionAccuracyIsDiagnosticOnly": True,
        },
    }
    root = Path(os.environ.get("RESEARCH_STATE_DIR", ".research-state"))
    root.mkdir(parents=True, exist_ok=True)
    path = root / "priority-router-v4-promotion-regime-1y.json"
    path.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({"status": result["status"], "periods": result["periods"], "variants": summaries, "profitAttribution": result["profitAttribution"]}, indent=2))


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        run_selftest()
    else:
        main()
