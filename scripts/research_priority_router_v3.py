"""Research-only comparison for the Priority Router V3 proposal.

This script reuses the frozen Champion trade streams produced by
``research_priority_router_one_year``.  It changes portfolio routing only:

* SOL/LINK remain priority symbols and can preempt a complement.
* ETH/BNB/AVAX are all valid complement candidates.
* Shadow history is used only to order oversubscribed complement candidates.
* The optional risk-scaled variant changes allocation size, never eligibility.

No production runner, approval, VPS, account, order, or LIVE path is imported.
All ranking decisions are causal: only shadow trades whose exit timestamp is at
or before the current decision timestamp are used.
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


RANKING_ONLY = "ROUTER_V3_RANKING_ONLY"
RANKING_RISK = "ROUTER_V3_RANKING_RISK_SCALING"
STRESS_BPS = float(v109.STRESS_BPS)
STRESS_DELAY_BARS = 1

# Pre-declared before the requested OOS was evaluated.  These are deliberately
# not fitted to the 2025-07-01..2026-07-01 result.  A weak complement signal
# receives half of its available sleeve; it remains eligible and is still
# shadow-tracked.  Strong/normal signals use the full available sleeve.
WEAK_SIGNAL_STRENGTH_LT = 1.0
WEAK_COMPLEMENT_SCALE = 0.5
NORMAL_COMPLEMENT_SCALE = 1.0
RISK_POLICY_ID = "V3_PREDECLARED_SIGNAL_STRENGTH_LT_1_HALF_SIZE"


def _candidate_key(row: dict[str, Any]) -> tuple[str, int, str]:
    return str(row["symbol"]), int(row["entryTs"]), str(row["side"])


def _risk_scale(candidate: dict[str, Any]) -> float:
    if float(candidate["signalStrength"]) < WEAK_SIGNAL_STRENGTH_LT:
        return WEAK_COMPLEMENT_SCALE
    return NORMAL_COMPLEMENT_SCALE


def _position_value(position: dict[str, Any], price: float) -> float:
    move_pct = position["sideSign"] * (
        price / position["entryPrice"] - 1.0
    ) * 100.0
    return position["capital"] * (
        1.0 + position["riskMultiplier"] * move_pct / 100.0
    )


def _close_position(
    slot: dict[str, Any],
    ts: int,
    exit_price: float,
    reason: str,
) -> dict[str, Any]:
    position = slot["position"]
    if position is None:
        raise RuntimeError("CLOSE_EMPTY_SLOT")
    before = float(position["capital"])
    move_pct = position["sideSign"] * (
        exit_price / position["entryPrice"] - 1.0
    ) * 100.0
    net_return = position["riskMultiplier"] * (
        move_pct - base.NORMAL_BPS / 100.0
    ) / 100.0
    after = before * max(0.001, 1.0 + net_return)
    slot["cash"] += after
    trade = {
        "symbol": position["symbol"],
        "side": position["side"],
        "entryTs": position["entryTs"],
        "exitTs": ts,
        "entryPrice": position["entryPrice"],
        "exitPrice": exit_price,
        "netReturnPct": net_return * 100.0,
        "portfolioPnlPctPoints": (after - before) * 100.0,
        "exitReason": reason,
        "signalStrength": position["signalStrength"],
        "champion": position["champion"],
        "allocationScale": position["allocationScale"],
    }
    slot["position"] = None
    return trade


def run_scaled_router(
    candles: dict[str, list[dict[str, Any]]],
    index: dict[str, dict[int, int]],
    periods: dict[str, Any],
    candidates: dict[str, list[dict[str, Any]]],
) -> dict[str, Any]:
    """Run V3 with ranking-only admission and predeclared size scaling."""

    times = base._common_times(candles, index, periods)
    events: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for symbol, rows in candidates.items():
        for row in rows:
            events[int(row["entryTs"])].append(row)

    shadow_records = {s: list(candidates[s]) for s in base.COMPLEMENTS}
    slots: list[dict[str, Any]] = [
        {"cash": base.SLOT_INITIAL_CAPITAL, "position": None},
        {"cash": base.SLOT_INITIAL_CAPITAL, "position": None},
    ]
    real_trades: list[dict[str, Any]] = []
    skipped: Counter[str] = Counter()
    adopted: Counter[str] = Counter()
    preempted: Counter[str] = Counter()
    selected: list[dict[str, Any]] = []
    decisions: dict[tuple[str, int, str], dict[str, Any]] = {}
    equity_curve: list[dict[str, Any]] = []
    state_counts: Counter[str] = Counter()
    turnover = 0.0

    def positions() -> list[dict[str, Any]]:
        return [s["position"] for s in slots if s["position"] is not None]

    def close_slot(slot: dict[str, Any], ts: int, reason: str, price: float | None = None) -> None:
        nonlocal turnover
        pos = slot["position"]
        if pos is None:
            return
        exit_price = price if price is not None else float(pos["plannedExitPrice"])
        real_trades.append(_close_position(slot, ts, exit_price, reason))
        turnover += float(pos["capital"])

    def open_slot(slot: dict[str, Any], candidate: dict[str, Any], ts: int, scale: float) -> None:
        nonlocal turnover
        if slot["position"] is not None:
            raise RuntimeError("SLOT_NOT_EMPTY")
        available_cash = float(slot["cash"])
        capital = available_cash * scale
        if capital <= 0:
            raise RuntimeError("NON_POSITIVE_ALLOCATION")
        slot["cash"] = available_cash - capital
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
        adopted[candidate["symbol"]] += 1

    def free_slot() -> dict[str, Any] | None:
        return next((s for s in slots if s["position"] is None), None)

    def held_symbols() -> set[str]:
        return {p["symbol"] for p in positions()}

    for ts in times:
        for slot in slots:
            pos = slot["position"]
            if pos is not None and int(pos["plannedExitTs"]) <= ts:
                close_slot(slot, ts, "CHAMPION_EXIT", float(pos["plannedExitPrice"]))

        at_ts = events.get(ts, [])
        priority = [x for x in at_ts if x["symbol"] in base.PRIORITY]
        priority.sort(key=lambda x: (0 if x["symbol"] == "SOL" else 1, x["symbol"]))
        held = held_symbols()
        for candidate in priority:
            symbol = str(candidate["symbol"])
            if symbol in held:
                skipped["priority_already_held"] += 1
                continue
            slot = free_slot()
            if slot is None:
                complement_slots = [
                    s for s in slots
                    if s["position"] is not None
                    and s["position"]["symbol"] in base.COMPLEMENTS
                ]
                if complement_slots:
                    slot = complement_slots[0]
                    old = slot["position"]
                    assert old is not None
                    old_symbol = old["symbol"]
                    exit_price = base._price(candles, index, old_symbol, ts, "open")
                    close_slot(slot, ts, f"PREEMPTED_BY_{symbol}", exit_price)
                    preempted[f"PREEMPTED_BY_{symbol}"] += 1
                    held.discard(old_symbol)
                else:
                    skipped["priority_no_slot"] += 1
                    continue
            open_slot(slot, candidate, ts, NORMAL_COMPLEMENT_SCALE)
            held.add(symbol)

        complement_events = [x for x in at_ts if x["symbol"] in base.COMPLEMENTS]
        complement_candidates = [x for x in complement_events if x["symbol"] not in held]
        ranked, rank_decisions = base._rank_complements_with_decisions(
            complement_candidates,
            "SHADOW_YTD_RANK",
            shadow_records,
            ts,
        )
        for decision in rank_decisions:
            decisions[
                (
                    str(decision["symbol"]),
                    int(decision["entryTs"]),
                    str(decision["side"]),
                )
            ] = decision
        for rank, candidate in enumerate(ranked):
            key = _candidate_key(candidate)
            if candidate["symbol"] in held:
                decisions[key]["allowed"] = False
                decisions[key]["reason"] = "COMPLEMENT_ALREADY_HELD"
                skipped["complement_already_held"] += 1
                continue
            slot = free_slot()
            if slot is None:
                decisions[key]["allowed"] = False
                decisions[key]["reason"] = "NO_FREE_SLOT"
                skipped["complement_no_slot"] += 1
                continue
            scale = _risk_scale(candidate)
            open_slot(slot, candidate, ts, scale)
            held.add(candidate["symbol"])
            decisions[key]["allowed"] = True
            decisions[key]["reason"] = "ADOPTED"
            decisions[key]["allocationScale"] = scale
            selected.append({
                "ts": ts,
                "symbol": candidate["symbol"],
                "rank": rank + 1,
                "signalStrength": candidate["signalStrength"],
                "allocationScale": scale,
                "shadowStats": base._shadow_stats(shadow_records[candidate["symbol"]], ts),
            })

        marks = []
        for slot in slots:
            mark = float(slot["cash"])
            pos = slot["position"]
            if pos is not None:
                mark += _position_value(
                    pos,
                    base._price(candles, index, pos["symbol"], ts, "close"),
                )
            marks.append(mark)
        equity = sum(marks)
        state = base._state_label(positions())
        state_counts[state] += 1
        equity_curve.append({
            "ts": ts,
            "equity": equity,
            "cash": sum(float(s["cash"]) for s in slots),
            "state": state,
            "positions": [p["symbol"] for p in positions()],
        })

    final_ts = times[-1]
    for slot in slots:
        if slot["position"] is not None:
            pos = slot["position"]
            close_slot(slot, final_ts, "PERIOD_END", base._price(
                candles, index, pos["symbol"], final_ts, "close"
            ))

    equities = [float(row["equity"]) for row in equity_curve]
    peak = equities[0]
    max_dd = 0.0
    for value in equities:
        peak = max(peak, value)
        max_dd = min(max_dd, (value / peak - 1.0) * 100.0)
    contributions = [float(x["portfolioPnlPctPoints"]) for x in real_trades]
    metrics = base.metric_from_trade_contributions(contributions)
    final_equity = sum(float(s["cash"]) for s in slots)
    start = int(periods["fixedWindowStart"])
    end = int(periods["fixedWindowEndExclusive"])
    years = (end - start) / (365.0 * base.DAY)
    return_pct = (final_equity - 1.0) * 100.0
    cagr = (final_equity ** (1.0 / years) - 1.0) * 100.0 if final_equity > 0 else -100.0
    category_keys = (
        "cash", "SOL only", "LINK only", "SOL+LINK", "complement only",
        "SOL/complement", "LINK/complement",
    )
    allocation = {
        key: state_counts[key] / len(equity_curve) * 100.0
        for key in category_keys
    }
    allocation["averageCashPct"] = sum(
        float(row["cash"]) / max(float(row["equity"]), 1e-12) * 100.0
        for row in equity_curve
    ) / len(equity_curve)
    return {
        "mode": RANKING_RISK,
        "window": {
            "start": start,
            "endExclusive": end,
            "hours": len(equity_curve),
        },
        "metrics": {
            **metrics,
            "oneYearReturnPct": return_pct,
            "cagrPct": cagr,
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
        "selectedComplementEvents": selected,
        "complementDecisions": list(decisions.values()),
        "skippedEventCounts": dict(skipped),
        "adoptedCounts": dict(adopted),
        "preemptedCounts": dict(preempted),
        "equityCurve": equity_curve,
        "finalEquity": final_equity,
        "policy": {
            "priority": list(base.PRIORITY),
            "complements": list(base.COMPLEMENTS),
            "allComplementsEligible": True,
            "shadowUsedFor": "RANKING_ONLY",
            "riskPolicyId": RISK_POLICY_ID,
            "weakSignalStrengthLt": WEAK_SIGNAL_STRENGTH_LT,
            "weakComplementScale": WEAK_COMPLEMENT_SCALE,
            "normalComplementScale": NORMAL_COMPLEMENT_SCALE,
            "btcPositionWeightPct": 0.0,
            "normalCostBpsRoundTrip": base.NORMAL_BPS,
            "executionDelayBars": base.EXECUTION_DELAY_BARS,
        },
    }


def _stress_candidates(candles: dict[str, list[dict[str, Any]]], index: dict[str, dict[int, int]], periods: dict[str, Any], models: dict[str, dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    original_bps = base.NORMAL_BPS
    original_delay = base.EXECUTION_DELAY_BARS
    base.NORMAL_BPS = STRESS_BPS
    base.EXECUTION_DELAY_BARS = STRESS_DELAY_BARS
    try:
        start = int(periods["fixedWindowStart"])
        end = int(periods["fixedWindowEndExclusive"])
        out = {}
        for symbol in base.TRADE_SYMBOLS:
            raw = base._champion_records(symbol, candles, index, start, end, models[symbol])
            out[symbol] = sorted(
                [base.normalize_record(symbol, row, candles, index, models[symbol]) for row in raw],
                key=lambda row: (row["entryTs"], row["exitTs"]),
            )
        return out
    finally:
        base.NORMAL_BPS = original_bps
        base.EXECUTION_DELAY_BARS = original_delay


def _summary(run: dict[str, Any], stress: dict[str, Any], shadow: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    metrics = run["metrics"]
    sm = stress["metrics"]
    symbols = base.TRADE_SYMBOLS
    real = run["realTrades"]
    by_symbol = {
        symbol: sum(float(x["portfolioPnlPctPoints"]) for x in real if x["symbol"] == symbol)
        for symbol in symbols
    }
    values = [float(x["portfolioPnlPctPoints"]) for x in real]
    top5 = sum(sorted(values, reverse=True)[:5]) if values else 0.0
    supplement = {}
    for symbol in base.COMPLEMENTS:
        all_shadow = shadow[symbol]
        adopted = [x for x in real if x["symbol"] == symbol]
        missed_keys = {_candidate_key(x) for x in adopted}
        missed = [x for x in all_shadow if _candidate_key(x) not in missed_keys]
        supplement[symbol] = {
            "realTrades": len(adopted),
            "realPnlPctPoints": by_symbol[symbol],
            "shadowTrades": len(all_shadow),
            "shadowHypotheticalReturnPct": base.compound([x["netReturnPct"] for x in all_shadow]),
            "shadowPf": base.profit_factor([x["netReturnPct"] for x in all_shadow]),
            "shadowPfWithoutBest": base.profit_factor(base._without_best([x["netReturnPct"] for x in all_shadow])),
            "adoptedCount": len(adopted),
            "notAdoptedCount": len(missed),
            "notAdoptedShadowHypotheticalPnlPct": base.compound([x["netReturnPct"] for x in missed]),
            "preemptedBySolCount": sum(x["exitReason"] == "PREEMPTED_BY_SOL" for x in adopted),
            "preemptedBySolPnlPctPoints": sum(x["portfolioPnlPctPoints"] for x in adopted if x["exitReason"] == "PREEMPTED_BY_SOL"),
            "preemptedByLinkCount": sum(x["exitReason"] == "PREEMPTED_BY_LINK" for x in adopted),
            "preemptedByLinkPnlPctPoints": sum(x["portfolioPnlPctPoints"] for x in adopted if x["exitReason"] == "PREEMPTED_BY_LINK"),
        }
    return {
        "returnPct": metrics["oneYearReturnPct"],
        "cagrPct": metrics["cagrPct"],
        "pf": metrics["pf"],
        "pfWithoutBest": metrics["pfWithoutBest"],
        "maxDDPct": metrics["maxDrawdownHourlyMtmPct"],
        "returnToDD": metrics["returnToAbsDrawdown"],
        "stressReturnPct": sm["oneYearReturnPct"],
        "stressPf": sm["pf"],
        "stressDDPct": sm["maxDrawdownHourlyMtmPct"],
        "trades": metrics["realTradeCount"],
        "winRatePct": metrics["winRatePct"],
        "turnoverPct": metrics["portfolioTurnoverPctOfInitialEquity"],
        "allocation": run["allocationTimePct"],
        "contributionPctPoints": by_symbol,
        "top5ContributionPctPoints": top5,
        "preemptionCount": sum(run["preemptedCounts"].values()),
        "preemptionPnlPctPoints": sum(
            x["portfolioPnlPctPoints"] for x in real if x["exitReason"].startswith("PREEMPTED_BY_")
        ),
        "supplement": supplement,
    }


def run_selftest() -> None:
    assert set(base.COMPLEMENTS) == {"ETH", "BNB", "AVAX"}
    assert base.PRIORITY == ("SOL", "LINK")
    assert _risk_scale({"signalStrength": 0.99}) == 0.5
    assert _risk_scale({"signalStrength": 1.0}) == 1.0
    history = {
        "ETH": [{"netReturnPct": 10.0, "exitTs": 1, "signalStrength": 1.0}] * 3,
        "BNB": [{"netReturnPct": -1.0, "exitTs": 1, "signalStrength": 4.0}] * 3,
        "AVAX": [],
    }
    rows = [
        {"symbol": "ETH", "entryTs": 2, "side": "LONG", "signalStrength": 1.0},
        {"symbol": "BNB", "entryTs": 2, "side": "LONG", "signalStrength": 4.0},
    ]
    ranked, decisions = base._rank_complements_with_decisions(rows, "SHADOW_YTD_RANK", history, 2)
    assert ranked[0]["symbol"] == "ETH"
    assert all(x["allowed"] for x in decisions)
    assert base._rank_complements_with_decisions(rows, "SHADOW_YTD_RANK", history, 2)[0][-1]["symbol"] == "BNB"
    assert RANKING_ONLY != RANKING_RISK
    print("PRIORITY_ROUTER_V3_SELFTEST_PASS")


def main() -> None:
    candles, index, _ = v109.b.base.load()
    periods = base._periods(candles)
    candidates, models = base.load_candidates(candles, index, periods)
    stress_candidates = _stress_candidates(candles, index, periods, models)

    normal = {
        "Router V1": base.run_router("SHADOW_YTD_RANK", candles, index, periods, candidates),
        "Router V2": base.run_router(base.RECENT_SHADOW_GATED_MODE, candles, index, periods, candidates),
        "SOL/LINK-only": base.run_router("SOL_LINK_FIXED_50_50", candles, index, periods, candidates),
        "Router V3 Ranking-only": base.run_router("SHADOW_YTD_RANK", candles, index, periods, candidates),
        "Router V3 Ranking + Risk Scaling": run_scaled_router(candles, index, periods, candidates),
    }
    original_bps = base.NORMAL_BPS
    original_delay = base.EXECUTION_DELAY_BARS
    base.NORMAL_BPS = STRESS_BPS
    base.EXECUTION_DELAY_BARS = STRESS_DELAY_BARS
    try:
        stress = {
            "Router V1": base.run_router("SHADOW_YTD_RANK", candles, index, periods, stress_candidates),
            "Router V2": base.run_router(base.RECENT_SHADOW_GATED_MODE, candles, index, periods, stress_candidates),
            "SOL/LINK-only": base.run_router("SOL_LINK_FIXED_50_50", candles, index, periods, stress_candidates),
            "Router V3 Ranking-only": base.run_router("SHADOW_YTD_RANK", candles, index, periods, stress_candidates),
            "Router V3 Ranking + Risk Scaling": run_scaled_router(candles, index, periods, stress_candidates),
        }
    finally:
        base.NORMAL_BPS = original_bps
        base.EXECUTION_DELAY_BARS = original_delay

    summaries = {
        label: _summary(normal[label], stress[label], candidates)
        for label in normal
    }
    result = {
        "status": "RESEARCH_ONLY",
        "productionChanged": False,
        "vpsChanged": False,
        "realTradingEnabled": False,
        "btcRole": "REFERENCE_ONLY; position/order/PnL/allocation=0",
        "champions": base.CHAMPION,
        "periods": {k: v for k, v in periods.items() if k in (
            "development", "validation", "confirmation", "holdout",
            "fixedWindowStart", "fixedWindowEndExclusive",
        )},
        "normalAssumptions": {"roundTripBps": original_bps, "executionDelayBars": original_delay},
        "stressAssumptions": {"roundTripBps": STRESS_BPS, "executionDelayBars": STRESS_DELAY_BARS},
        "variants": summaries,
        "comparison": {
            "SOL_LINK_SHARED_STRENGTH_DECLARED_BASELINE": {
                "returnPct": 83.78,
                "maxDDPct": -18.88,
                "source": "user-provided prior BT result; not used for tuning",
            },
            **{
                label: {
                    "returnPct": summary["returnPct"],
                    "pf": summary["pf"],
                    "maxDDPct": summary["maxDDPct"],
                    "stressPf": summary["stressPf"],
                }
                for label, summary in summaries.items()
            },
        },
        "diagnostics": {
            "shadowRankIsCausal": True,
            "rankingUsesOnlyCompletedShadowTrades": True,
            "shadowUsedForEntryRejection": False,
            "allComplementCandidatesEligible": True,
            "bnbExcluded": False,
            "championEntryExitChanged": False,
            "realPortfolioPnlIncludesShadow": False,
            "realPortfolioPnlIncludesBtc": False,
            "riskScalingPolicy": RISK_POLICY_ID,
            "riskScalingThresholdSource": "predeclared; not fitted to requested OOS",
            "confirmationOrHoldoutUsedForRanking": False,
            "oosIsNewEvidence": False,
        },
        "rawVariants": normal,
    }
    root = Path(os.environ.get("RESEARCH_STATE_DIR", ".research-state"))
    root.mkdir(parents=True, exist_ok=True)
    path = root / "priority-router-v3-ranking-risk-1y.json"
    path.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({"status": result["status"], "periods": result["periods"], "variants": summaries}, indent=2))


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        run_selftest()
    else:
        main()
