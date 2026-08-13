"""Causal one-year Priority Portfolio Router research backtest.

Research-only.  This module deliberately reuses the frozen Champion drivers:

* SOL: SOL_PROFIT_LOCK_REVALIDATE
* LINK: LINK_V2_STAGED_HANDOFF
* ETH: V109 primary only
* AVAX: V109 primary only
* BNB: BNB_SPONSOR_ROTATION shadow candidate

The router is not a new entry/exit strategy.  It only decides which already
generated Champion trades occupy two independently-compounding 50% sleeves.
BTC is loaded by the frozen feature code but is never a candidate or position.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import statistics
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import research_lab_pair_specific_v109 as v109
import research_link_v109_staged_forecast_handoff_v7 as link_v7
import research_pairwise_profit_attribution_v4 as pairwise


HOUR = v109.HOUR
DAY = 24 * HOUR
NORMAL_BPS = float(v109.NORMAL_BPS)
EXECUTION_DELAY_BARS = 0
SLOT_COUNT = 2
SLOT_INITIAL_CAPITAL = 0.5
PRIORITY = ("SOL", "LINK")
COMPLEMENTS = ("ETH", "BNB", "AVAX")
TRADE_SYMBOLS = PRIORITY + COMPLEMENTS
ALL_REFERENCE_SYMBOLS = ("BTC",) + TRADE_SYMBOLS
RISK = {s: float(v109.RISK[s]) for s in TRADE_SYMBOLS}
MIN_SHADOW_RANK_TRADES = 3

CHAMPION = {
    "SOL": "SOL_PROFIT_LOCK_REVALIDATE",
    "LINK": "LINK_V2_STAGED_HANDOFF",
    "ETH": "ETH_PRIMARY_ONLY",
    "BNB": "BNB_SPONSOR_ROTATION",
    "AVAX": "AVAX_PRIMARY_ONLY",
}


def compound(returns_pct: list[float]) -> float:
    value = 1.0
    for value_pct in returns_pct:
        value *= max(0.001, 1.0 + float(value_pct) / 100.0)
    return (value - 1.0) * 100.0


def profit_factor(values: list[float]) -> float | None:
    gains = sum(x for x in values if x > 0)
    losses = abs(sum(x for x in values if x < 0))
    if losses <= 1e-12:
        return 999.0 if gains > 0 else None
    return gains / losses


def metric_from_trade_contributions(values: list[float]) -> dict[str, Any]:
    values = [float(x) for x in values]
    if not values:
        return {
            "trades": 0,
            "returnPct": 0.0,
            "pf": None,
            "pfWithoutBest": None,
            "winRatePct": 0.0,
        }
    best_index = max(range(len(values)), key=lambda i: values[i])
    without_best = values[:best_index] + values[best_index + 1 :]
    return {
        "trades": len(values),
        "returnPct": compound(values),
        "pf": profit_factor(values),
        "pfWithoutBest": profit_factor(without_best),
        "winRatePct": sum(x > 0 for x in values) / len(values) * 100.0,
        "bestTradeContributionPctPoints": values[best_index],
    }


def _periods(candles: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    """Use the repository's fixed one-year window, not a new date selection."""
    ps = v109.b.base.periods(candles)
    required = ("fixedWindowStart", "fixedWindowEndExclusive")
    if any(k not in ps for k in required):
        raise RuntimeError("FIXED_ONE_YEAR_WINDOW_UNAVAILABLE")
    return ps


def _model(pair: str, candles: dict[str, list[dict[str, Any]]],
           index: dict[str, dict[int, int]], periods: dict[str, Any]) -> dict[str, Any]:
    return v109.train(
        "regime_wave",
        pair,
        candles,
        index,
        *periods["development"],
    )


def _champion_records(
    pair: str,
    candles: dict[str, list[dict[str, Any]]],
    index: dict[str, dict[int, int]],
    start: int,
    end: int,
    model: dict[str, Any],
) -> list[dict[str, Any]]:
    """Return the frozen Champion's independent trades for the fixed window."""
    if pair == "LINK":
        _, records = link_v7.simulate_new(
            link_v7.CID,
            "LINK",
            candles,
            index,
            start,
            end,
            NORMAL_BPS,
            EXECUTION_DELAY_BARS,
            model,
        )
    else:
        arch = {
            "SOL": "SOL_PROFIT_LOCK_REVALIDATE",
            "ETH": "ETH_NONE",
            "BNB": "BNB_SPONSOR_ROTATION",
            "AVAX": "AVAX_NONE",
        }[pair]
        _, records = pairwise.simulate(
            pair,
            arch,
            candles,
            index,
            start,
            end,
            NORMAL_BPS,
            EXECUTION_DELAY_BARS,
            model,
        )
    return records


def _record_strength(
    pair: str,
    record: dict[str, Any],
    candles: dict[str, list[dict[str, Any]]],
    index: dict[str, dict[int, int]],
    model: dict[str, Any],
) -> float:
    if record.get("entryPredictor") is not None and record.get("threshold"):
        return abs(float(record["entryPredictor"])) / max(float(record["threshold"]), 1e-9)
    signal_ts = int(record["entryTs"]) - HOUR
    prediction = v109.predict("regime_wave", pair, candles, index, signal_ts, model)
    return abs(float(prediction)) / max(float(model["threshold"]), 1e-9)


def normalize_record(
    pair: str,
    record: dict[str, Any],
    candles: dict[str, list[dict[str, Any]]],
    index: dict[str, dict[int, int]],
    model: dict[str, Any],
) -> dict[str, Any]:
    entry_ts = int(record.get("entryExecTs", record.get("entryTs")))
    exit_ts = int(record.get("exitExecTs", record.get("exitTs")))
    entry_index = index[pair].get(entry_ts)
    exit_index = index[pair].get(exit_ts)
    if entry_index is None or exit_index is None:
        raise RuntimeError(f"MISSING_TRADE_PRICE_MARK:{pair}:{entry_ts}:{exit_ts}")
    entry_price = float(record.get("entryPrice", candles[pair][entry_index]["open"]))
    exit_field = "close" if record.get("exitReason") == "PERIOD_END" else "open"
    exit_price = float(record.get("exitPrice", candles[pair][exit_index][exit_field]))
    side_text = str(record["side"]).upper()
    side = 1 if side_text in ("LONG", "1") else -1
    gross_pct = side * (exit_price / entry_price - 1.0) * 100.0
    calculated_net_pct = (gross_pct - NORMAL_BPS / 100.0) * RISK[pair]
    net_pct = float(record.get("netPnlPct", record.get("pnl", calculated_net_pct)))
    return {
        "symbol": pair,
        "side": "LONG" if side > 0 else "SHORT",
        "sideSign": side,
        "signalTs": int(record.get("signalTs", entry_ts - HOUR)),
        "entryTs": entry_ts,
        "exitTs": exit_ts,
        "entryPrice": entry_price,
        "exitPrice": exit_price,
        "grossReturnPct": gross_pct,
        "netReturnPct": net_pct,
        "championNetReturnPct": float(
            record.get("netPnlPct", record.get("pnl", net_pct))
        ),
        "riskMultiplier": RISK[pair],
        "mfePct": record.get("mfePct"),
        "maePct": record.get("maePct"),
        "exitReason": record.get("exitReason", "CHAMPION_EXIT"),
        "signalStrength": _record_strength(pair, record, candles, index, model),
        "champion": CHAMPION[pair],
    }


def load_candidates(
    candles: dict[str, list[dict[str, Any]]],
    index: dict[str, dict[int, int]],
    periods: dict[str, Any],
) -> tuple[dict[str, list[dict[str, Any]]], dict[str, dict[str, Any]]]:
    start = int(periods["fixedWindowStart"])
    end = int(periods["fixedWindowEndExclusive"])
    models = {pair: _model(pair, candles, index, periods) for pair in TRADE_SYMBOLS}
    candidates: dict[str, list[dict[str, Any]]] = {}
    for pair in TRADE_SYMBOLS:
        raw = _champion_records(pair, candles, index, start, end, models[pair])
        candidates[pair] = [
            normalize_record(pair, rec, candles, index, models[pair])
            for rec in raw
        ]
        candidates[pair].sort(key=lambda r: (r["entryTs"], r["exitTs"]))
    return candidates, models


def _shadow_stats(records: list[dict[str, Any]], now: int | None = None) -> dict[str, Any]:
    if now is not None:
        records = [r for r in records if int(r["exitTs"]) <= now]
    values = [float(r["netReturnPct"]) for r in records]
    return {
        "completedTrades": len(records),
        "cumulativeReturnPct": compound(values),
        "pf": profit_factor(values),
        "tradeCount": len(values),
        "signalStrength": float(records[-1]["signalStrength"]) if records else 0.0,
        "sampleSufficient": len(values) >= MIN_SHADOW_RANK_TRADES,
    }


def _rank_complements(
    candidates: list[dict[str, Any]],
    mode: str,
    shadow_records: dict[str, list[dict[str, Any]]],
    now: int,
) -> list[dict[str, Any]]:
    def key(record: dict[str, Any]) -> tuple[float, float, int, float, str]:
        if mode == "SIGNAL_STRENGTH_ONLY":
            stats = {
                "cumulativeReturnPct": 0.0,
                "pf": 0.0,
                "tradeCount": 0,
            }
        else:
            stats = _shadow_stats(shadow_records[record["symbol"]], now)
            # A single completed shadow win must not lock the router's ranking.
            if not stats["sampleSufficient"]:
                stats = {
                    "cumulativeReturnPct": 0.0,
                    "pf": 0.0,
                    "tradeCount": 0,
                }
        return (
            float(stats["cumulativeReturnPct"]),
            float(stats["pf"] or 0.0),
            int(stats["tradeCount"]),
            float(record["signalStrength"]),
            str(record["symbol"]),
        )

    return sorted(candidates, key=key, reverse=True)


def _price(
    candles: dict[str, list[dict[str, Any]]],
    index: dict[str, dict[int, int]],
    symbol: str,
    ts: int,
    field: str = "close",
) -> float:
    i = index[symbol].get(ts)
    if i is None:
        raise RuntimeError(f"MISSING_MARK:{symbol}:{ts}")
    return float(candles[symbol][i].get(field, candles[symbol][i]["close"]))


def _common_times(
    candles: dict[str, list[dict[str, Any]]],
    index: dict[str, dict[int, int]],
    periods: dict[str, Any],
) -> list[int]:
    start = int(periods["fixedWindowStart"])
    end = int(periods["fixedWindowEndExclusive"])
    times = []
    for row in candles["BTC"]:
        ts = int(row["ts"])
        if start <= ts < end and all(index[s].get(ts) is not None for s in ALL_REFERENCE_SYMBOLS):
            times.append(ts)
    if len(times) < 300 * 24:
        raise RuntimeError(f"INSUFFICIENT_COMMON_HOURLY_MARKS:{len(times)}")
    return times


def _position_value(position: dict[str, Any], price: float) -> float:
    move_pct = position["sideSign"] * (price / position["entryPrice"] - 1.0) * 100.0
    return position["capital"] * (1.0 + position["riskMultiplier"] * move_pct / 100.0)


def _trade_net_return(position: dict[str, Any], exit_price: float) -> float:
    move_pct = position["sideSign"] * (
        exit_price / position["entryPrice"] - 1.0
    ) * 100.0
    return position["riskMultiplier"] * (move_pct - NORMAL_BPS / 100.0) / 100.0


def _state_label(positions: list[dict[str, Any]]) -> str:
    symbols = {p["symbol"] for p in positions}
    priorities = symbols & set(PRIORITY)
    complements = symbols & set(COMPLEMENTS)
    if priorities == {"SOL", "LINK"}:
        return "SOL+LINK"
    if priorities == {"SOL"} and complements:
        return "SOL/complement"
    if priorities == {"LINK"} and complements:
        return "LINK/complement"
    if priorities == {"SOL"}:
        return "SOL only"
    if priorities == {"LINK"}:
        return "LINK only"
    if complements:
        return "complement only"
    return "cash"


def _close_position(
    position: dict[str, Any],
    exit_price: float,
    reason: str,
) -> dict[str, Any]:
    net_return = _trade_net_return(position, exit_price)
    before = position["capital"]
    after = before * max(0.001, 1.0 + net_return)
    rec = {
        "symbol": position["symbol"],
        "side": position["side"],
        "entryTs": position["entryTs"],
        "exitTs": position["closeTs"],
        "entryPrice": position["entryPrice"],
        "exitPrice": exit_price,
        "netReturnPct": net_return * 100.0,
        "portfolioPnlPctPoints": (after - before) * 100.0,
        "exitReason": reason,
        "signalStrength": position["signalStrength"],
        "champion": position["champion"],
    }
    position["capital"] = after
    return rec


def run_router(
    mode: str,
    candles: dict[str, list[dict[str, Any]]],
    index: dict[str, dict[int, int]],
    periods: dict[str, Any],
    candidates: dict[str, list[dict[str, Any]]],
) -> dict[str, Any]:
    if mode not in ("SHADOW_YTD_RANK", "SIGNAL_STRENGTH_ONLY", "SOL_LINK_FIXED_50_50"):
        raise ValueError(mode)
    times = _common_times(candles, index, periods)
    events: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for symbol, rows in candidates.items():
        for row in rows:
            events[int(row["entryTs"])].append(row)

    shadow_records = {s: list(candidates[s]) for s in COMPLEMENTS}
    slots: list[dict[str, Any]] = [
        {"capital": SLOT_INITIAL_CAPITAL, "position": None},
        {"capital": SLOT_INITIAL_CAPITAL, "position": None},
    ]
    real_trades: list[dict[str, Any]] = []
    skipped: Counter[str] = Counter()
    adopted: Counter[str] = Counter()
    preempted: Counter[str] = Counter()
    priority_events = Counter()
    selected_complement_events: list[dict[str, Any]] = []
    equity_curve: list[dict[str, Any]] = []
    state_counts: Counter[str] = Counter()
    turnover_notional = 0.0

    def positions() -> list[dict[str, Any]]:
        return [slot["position"] for slot in slots if slot["position"] is not None]

    def close_slot(slot: dict[str, Any], ts: int, reason: str, price: float | None = None) -> None:
        nonlocal turnover_notional
        pos = slot["position"]
        if pos is None:
            return
        exit_price = price if price is not None else float(pos["plannedExitPrice"])
        pos["closeTs"] = ts
        trade = _close_position(pos, exit_price, reason)
        turnover_notional += abs(pos["capital"])
        real_trades.append(trade)
        slot["position"] = None

    def open_slot(slot: dict[str, Any], candidate: dict[str, Any], ts: int) -> None:
        nonlocal turnover_notional
        if slot["position"] is not None:
            raise RuntimeError("SLOT_NOT_EMPTY")
        slot["position"] = {
            "symbol": candidate["symbol"],
            "side": candidate["side"],
            "sideSign": candidate["sideSign"],
            "entryTs": ts,
            "entryPrice": candidate["entryPrice"],
            "plannedExitTs": candidate["exitTs"],
            "plannedExitPrice": candidate["exitPrice"],
            "capital": slot["capital"],
            "riskMultiplier": candidate["riskMultiplier"],
            "signalStrength": candidate["signalStrength"],
            "champion": candidate["champion"],
        }
        turnover_notional += abs(slot["capital"])
        adopted[candidate["symbol"]] += 1

    def slot_for_candidate(candidate: dict[str, Any]) -> dict[str, Any] | None:
        empty = [slot for slot in slots if slot["position"] is None]
        return empty[0] if empty else None

    by_symbol_open: dict[str, dict[str, Any]] = {}
    for ts in times:
        # Normal exits at the planned next-open timestamp happen before new
        # entries at that timestamp, avoiding artificial preemption.
        for slot in slots:
            pos = slot["position"]
            if pos is not None and int(pos["plannedExitTs"]) <= ts:
                close_slot(slot, ts, "CHAMPION_EXIT", float(pos["plannedExitPrice"]))
                by_symbol_open.pop(pos["symbol"], None)

        at_ts = events.get(ts, [])
        priority_events[ts] = sum(x["symbol"] in PRIORITY for x in at_ts)
        priority_at_ts = [x for x in at_ts if x["symbol"] in PRIORITY]
        priority_at_ts.sort(key=lambda x: (0 if x["symbol"] == "SOL" else 1, x["symbol"]))

        for candidate in priority_at_ts:
            symbol = candidate["symbol"]
            if symbol in by_symbol_open:
                skipped["priority_already_held"] += 1
                continue
            slot = slot_for_candidate(candidate)
            if slot is None:
                complement_slots = [
                    (i, s) for i, s in enumerate(slots)
                    if s["position"] is not None
                    and s["position"]["symbol"] in COMPLEMENTS
                ]
                if complement_slots:
                    _, slot = complement_slots[0]
                    old = slot["position"]
                    old_symbol = old["symbol"]
                    exit_price = _price(candles, index, old_symbol, ts, "open")
                    close_slot(slot, ts, f"PREEMPTED_BY_{symbol}", exit_price)
                    preempted[f"PREEMPTED_BY_{symbol}"] += 1
                    by_symbol_open.pop(old_symbol, None)
                else:
                    skipped["priority_no_slot"] += 1
                    continue
            open_slot(slot, candidate, ts)
            by_symbol_open[symbol] = slot["position"]

        complements_at_ts = [
            x for x in at_ts
            if x["symbol"] in COMPLEMENTS and x["symbol"] not in by_symbol_open
        ]
        available = sum(1 for slot in slots if slot["position"] is None)
        if mode == "SOL_LINK_FIXED_50_50":
            complements_at_ts = []
        ranked = _rank_complements(
            complements_at_ts,
            "SIGNAL_STRENGTH_ONLY" if mode != "SHADOW_YTD_RANK" else mode,
            shadow_records,
            ts,
        )
        for rank, candidate in enumerate(ranked):
            if candidate["symbol"] in by_symbol_open:
                skipped["complement_already_held"] += 1
                continue
            if available <= 0:
                skipped["complement_no_slot"] += 1
                continue
            slot = slot_for_candidate(candidate)
            if slot is None:
                skipped["complement_no_slot"] += 1
                continue
            open_slot(slot, candidate, ts)
            by_symbol_open[candidate["symbol"]] = slot["position"]
            available -= 1
            selected_complement_events.append(
                {
                    "ts": ts,
                    "symbol": candidate["symbol"],
                    "mode": mode,
                    "rank": rank + 1,
                    "signalStrength": candidate["signalStrength"],
                    "shadowStats": _shadow_stats(shadow_records[candidate["symbol"]], ts),
                }
            )

        marks = []
        for slot in slots:
            pos = slot["position"]
            if pos is None:
                marks.append(slot["capital"])
            else:
                marks.append(
                    _position_value(
                        pos,
                        _price(candles, index, pos["symbol"], ts, "close"),
                    )
                )
        equity = sum(marks)
        label = _state_label(positions())
        state_counts[label] += 1
        equity_curve.append(
            {
                "ts": ts,
                "equity": equity,
                "cash": sum(
                    slot["capital"]
                    for slot in slots
                    if slot["position"] is None
                ),
                "state": label,
                "positions": [p["symbol"] for p in positions()],
            }
        )

    final_ts = times[-1]
    for slot in slots:
        if slot["position"] is not None:
            pos = slot["position"]
            close_slot(
                slot,
                final_ts,
                "PERIOD_END",
                _price(candles, index, pos["symbol"], final_ts, "close"),
            )

    if not equity_curve:
        raise RuntimeError("EMPTY_EQUITY_CURVE")
    final_equity = sum(slot["capital"] for slot in slots)
    equities = [float(x["equity"]) for x in equity_curve]
    peak = equities[0]
    max_dd = 0.0
    for value in equities:
        peak = max(peak, value)
        max_dd = min(max_dd, (value / peak - 1.0) * 100.0)

    contribution_values = [float(x["portfolioPnlPctPoints"]) for x in real_trades]
    metrics = metric_from_trade_contributions(contribution_values)
    start_ts = int(periods["fixedWindowStart"])
    end_ts = int(periods["fixedWindowEndExclusive"])
    years = (end_ts - start_ts) / (365.0 * DAY)
    return_pct = (final_equity - 1.0) * 100.0
    cagr = (final_equity ** (1.0 / years) - 1.0) * 100.0 if final_equity > 0 else -100.0
    avg_cash_pct = statistics.fmean(
        float(x["cash"]) / max(float(x["equity"]), 1e-12) * 100.0
        for x in equity_curve
    )
    category_pct = {
        key: state_counts[key] / len(equity_curve) * 100.0
        for key in (
            "cash",
            "SOL only",
            "LINK only",
            "SOL+LINK",
            "complement only",
            "SOL/complement",
            "LINK/complement",
        )
    }
    return {
        "mode": mode,
        "window": {
            "start": start_ts,
            "endExclusive": end_ts,
            "hours": len(equity_curve),
        },
        "metrics": {
            **metrics,
            "oneYearReturnPct": return_pct,
            "cagrPct": cagr,
            "maxDrawdownHourlyMtmPct": max_dd,
            "returnToAbsDrawdown": (
                return_pct / abs(max_dd) if abs(max_dd) > 1e-12 else None
            ),
            "realTradeCount": len(real_trades),
            "portfolioTurnoverPctOfInitialEquity": turnover_notional * 100.0,
        },
        "allocationTimePct": {
            "cashPct": category_pct["cash"],
            "SOL_onlyPct": category_pct["SOL only"],
            "LINK_onlyPct": category_pct["LINK only"],
            "SOL_LINKPct": category_pct["SOL+LINK"],
            "complement_onlyPct": category_pct["complement only"],
            "SOL_complementPct": category_pct["SOL/complement"],
            "LINK_complementPct": category_pct["LINK/complement"],
            "averageCashPct": avg_cash_pct,
        },
        "realTrades": real_trades,
        "selectedComplementEvents": selected_complement_events,
        "skippedEventCounts": dict(skipped),
        "adoptedCounts": dict(adopted),
        "preemptedCounts": dict(preempted),
        "equityCurve": equity_curve,
        "finalEquity": final_equity,
        "policy": {
            "slotCount": SLOT_COUNT,
            "initialSlotPct": SLOT_INITIAL_CAPITAL * 100.0,
            "priority": list(PRIORITY),
            "complements": list(COMPLEMENTS),
            "btcPositionWeightPct": 0.0,
            "normalCostBpsRoundTrip": NORMAL_BPS,
            "executionDelayBars": EXECUTION_DELAY_BARS,
            "rankingMinimumCompletedShadowTrades": MIN_SHADOW_RANK_TRADES,
        },
    }


def shadow_summary(
    candidates: dict[str, list[dict[str, Any]]],
    router: dict[str, Any],
) -> dict[str, Any]:
    def _without_best(values: list[float]) -> list[float]:
        if not values:
            return []
        best_index = max(range(len(values)), key=values.__getitem__)
        return values[:best_index] + values[best_index + 1 :]

    real_by_symbol = defaultdict(list)
    for trade in router["realTrades"]:
        real_by_symbol[trade["symbol"]].append(trade)
    out: dict[str, Any] = {}
    for symbol in TRADE_SYMBOLS:
        shadows = candidates[symbol]
        shadow_values = [float(x["netReturnPct"]) for x in shadows]
        real = real_by_symbol[symbol]
        real_contribution = sum(float(x["portfolioPnlPctPoints"]) for x in real)
        preempt = [
            x for x in real
            if str(x["exitReason"]).startswith("PREEMPTED_BY_")
        ]
        out[symbol] = {
            "realTrades": len(real),
            "realPnlContributionPctPoints": real_contribution,
            "shadowTrades": len(shadows),
            "shadowHypotheticalReturnPct": compound(shadow_values),
            "shadowPf": profit_factor(shadow_values),
            "shadowPfWithoutBest": profit_factor(_without_best(shadow_values)),
            "adoptedCount": len(real),
            "skippedCount": max(0, len(shadows) - len(real)),
            "preemptedBySolCount": sum(
                x["exitReason"] == "PREEMPTED_BY_SOL" for x in preempt
            ),
            "preemptedBySolPnlPctPoints": sum(
                x["portfolioPnlPctPoints"]
                for x in preempt
                if x["exitReason"] == "PREEMPTED_BY_SOL"
            ),
            "preemptedByLinkCount": sum(
                x["exitReason"] == "PREEMPTED_BY_LINK" for x in preempt
            ),
            "preemptedByLinkPnlPctPoints": sum(
                x["portfolioPnlPctPoints"]
                for x in preempt
                if x["exitReason"] == "PREEMPTED_BY_LINK"
            ),
        }
    return out


def missed_shadow_summary(
    candidates: dict[str, list[dict[str, Any]]],
    router: dict[str, Any],
) -> dict[str, Any]:
    adopted_keys = {
        (x["symbol"], int(x["entryTs"]), x["side"])
        for x in router["realTrades"]
    }
    out = {}
    for symbol in COMPLEMENTS:
        missed = [
            x for x in candidates[symbol]
            if (symbol, int(x["entryTs"]), x["side"]) not in adopted_keys
        ]
        vals = [float(x["netReturnPct"]) for x in missed]
        out[symbol] = {
            "shadowSignalsNotAdopted": len(missed),
            "hypotheticalCompoundReturnPct": compound(vals),
            "hypotheticalSumReturnPct": sum(vals),
            "pf": profit_factor(vals),
            "records": missed,
        }
    return out


def run_selftest() -> None:
    assert set(TRADE_SYMBOLS).isdisjoint({"BTC"})
    assert PRIORITY == ("SOL", "LINK")
    assert SLOT_COUNT == 2 and math.isclose(SLOT_INITIAL_CAPITAL, 0.5)
    assert compound([10.0, 10.0]) > 20.0
    assert profit_factor([2.0, -1.0]) == 2.0
    history = {
        "ETH": [
            {"netReturnPct": 10.0, "exitTs": 1, "signalStrength": 1.0}
        ] * MIN_SHADOW_RANK_TRADES,
        "BNB": [
            {"netReturnPct": -1.0, "exitTs": 1, "signalStrength": 4.0}
        ] * MIN_SHADOW_RANK_TRADES,
        "AVAX": [],
    }
    candidates = [
        {"symbol": "ETH", "signalStrength": 1.0},
        {"symbol": "BNB", "signalStrength": 4.0},
    ]
    ranked = _rank_complements(candidates, "SHADOW_YTD_RANK", history, 2)
    assert ranked[0]["symbol"] == "ETH"
    ranked_signal = _rank_complements(
        candidates, "SIGNAL_STRENGTH_ONLY", history, 2
    )
    assert ranked_signal[0]["symbol"] == "BNB"
    assert _state_label([]) == "cash"
    assert _state_label([{"symbol": "SOL"}]) == "SOL only"
    assert _state_label([{"symbol": "SOL"}, {"symbol": "AVAX"}]) == "SOL/complement"
    print("PRIORITY_ROUTER_SELFTEST_PASS")


def _run() -> dict[str, Any]:
    candles, index, _ = v109.b.base.load()
    periods = _periods(candles)
    candidates, models = load_candidates(candles, index, periods)
    fixed = run_router(
        "SOL_LINK_FIXED_50_50", candles, index, periods, candidates
    )
    signal = run_router(
        "SIGNAL_STRENGTH_ONLY", candles, index, periods, candidates
    )
    shadow = run_router(
        "SHADOW_YTD_RANK", candles, index, periods, candidates
    )
    result = {
        "researchLine": "SOL_LINK_PRIORITY_COMPLEMENT_SHADOW_ROUTER_1Y_V1",
        "status": "RESEARCH_ONLY",
        "productionChanged": False,
        "realTradingEnabled": False,
        "btcRole": "REFERENCE_FEATURES_ONLY; position/order/PnL/allocation=0",
        "champions": CHAMPION,
        "periods": {
            k: v for k, v in periods.items()
            if k in ("development", "validation", "confirmation", "holdout",
                     "fixedWindowStart", "fixedWindowEndExclusive")
        },
        "costBps": NORMAL_BPS,
        "executionDelayBars": EXECUTION_DELAY_BARS,
        "models": {
            symbol: {
                "threshold": model["threshold"],
                "calibration": model.get("calibration"),
            }
            for symbol, model in models.items()
        },
        "candidates": {
            symbol: {
                "count": len(rows),
                "signals": rows,
            }
            for symbol, rows in candidates.items()
        },
        "portfolios": {
            "SOL_LINK_FIXED_50_50": fixed,
            "SIGNAL_STRENGTH_ONLY": signal,
            "SHADOW_YTD_RANK": shadow,
        },
        "perSymbol": {
            mode: shadow_summary(candidates, router)
            for mode, router in (
                ("SIGNAL_STRENGTH_ONLY", signal),
                ("SHADOW_YTD_RANK", shadow),
            )
        },
        "missedComplementShadow": {
            mode: missed_shadow_summary(candidates, router)
            for mode, router in (
                ("SIGNAL_STRENGTH_ONLY", signal),
                ("SHADOW_YTD_RANK", shadow),
            )
        },
        "comparison": {
            "SOL_LINK_FIXED_50_50": {
                "returnPct": fixed["metrics"]["oneYearReturnPct"],
                "maxDDPct": fixed["metrics"]["maxDrawdownHourlyMtmPct"],
                "returnToDD": fixed["metrics"]["returnToAbsDrawdown"],
                "pf": fixed["metrics"]["pf"],
            },
            "SOL_LINK_SHARED_STRENGTH_DECLARED_BASELINE": {
                "returnPct": 83.78,
                "maxDDPct": -18.88,
                "source": "user-provided prior BT result; not rewritten by this run",
            },
            "PRIORITY_SIGNAL_STRENGTH_ONLY": {
                "returnPct": signal["metrics"]["oneYearReturnPct"],
                "maxDDPct": signal["metrics"]["maxDrawdownHourlyMtmPct"],
                "returnToDD": signal["metrics"]["returnToAbsDrawdown"],
                "pf": signal["metrics"]["pf"],
            },
            "PRIORITY_SHADOW_YTD_RANK": {
                "returnPct": shadow["metrics"]["oneYearReturnPct"],
                "maxDDPct": shadow["metrics"]["maxDrawdownHourlyMtmPct"],
                "returnToDD": shadow["metrics"]["returnToAbsDrawdown"],
                "pf": shadow["metrics"]["pf"],
            },
        },
        "diagnostics": {
            "shadowRankIsCausal": True,
            "rankingUsesOnlyCompletedShadowTrades": True,
            "rankingMinimumSample": MIN_SHADOW_RANK_TRADES,
            "confirmationOrHoldoutUsedForRanking": False,
            "championEntryExitChanged": False,
            "realPortfolioPnlIncludesShadow": False,
            "realPortfolioPnlIncludesBtc": False,
        },
    }
    root = Path(os.environ.get("RESEARCH_STATE_DIR", ".research-state"))
    root.mkdir(parents=True, exist_ok=True)
    path = root / "sol-link-priority-complement-shadow-router-1y.json"
    path.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result, indent=2))
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        run_selftest()
    else:
        _run()
