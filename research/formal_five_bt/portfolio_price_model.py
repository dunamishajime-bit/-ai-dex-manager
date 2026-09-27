"""Chronological contribution-aware portfolio replay for crypto H1 price candidates.

The replay is intentionally labeled a PRICE MODEL. It uses audited strategy
signals and Aster H1/funding, but does not claim historical L2 execution.
"""
from __future__ import annotations

import argparse
from bisect import bisect_right
from collections import Counter, defaultdict
from datetime import datetime, timezone
import heapq
import hashlib
import json
import math
from pathlib import Path
from typing import Any

from .crypto_price_model import HOUR, PERIOD_END_MS, PERIOD_START_MS, _funding, _rows
from .fx_ecb import asof_jpy_per_usd, load_ecb_cross

CRYPTO_CAP = 3.0
STOCK_CAP = 4.0
TOTAL_CAP = 4.25
V12_CAP = 2.0
PENGU_CAP = 1.0
Q102_CAP = 3.0
FET_CAP = 2.25
FET_MIN = 0.05
V52_CAP = 4.0
DAILY_LOSS_LIMIT = 0.075
STOCK_DAILY_LOSS_LIMIT = 0.035
PRIORITY = {"V52": 0, "PENGU": 1, "V12": 2, "Q102": 3, "FET": 4}


def _monthly_deposits() -> dict[int, float]:
    result = {}
    year, month = 2025, 8
    for index in range(13):
        if index:
            month += 1
            if month == 13:
                year += 1
                month = 1
        ts = int(datetime(year, month, 10, tzinfo=timezone.utc).timestamp() * 1000)
        result[ts] = 10_000.0
    return result


def _market(data_root: Path, symbols: set[str]) -> dict[str, dict[str, Any]]:
    output = {}
    for symbol in sorted(symbols):
        crypto = data_root / "normalized/aster/klines" / f"{symbol}.jsonl"
        stock = data_root / "normalized/aster_stock/klines" / f"{symbol}.jsonl"
        source = crypto if crypto.is_file() else stock
        rows = _rows(source)
        rows.sort(key=lambda row: int(row["event_time_ms"]))
        times = [int(row["event_time_ms"]) for row in rows]
        if len(times) != len(set(times)):
            raise ValueError(f"DUPLICATE_MARK_BAR:{symbol}")
        output[symbol] = {"rows": rows, "times": times}
    return output


def _mark(market: dict[str, dict[str, Any]], symbol: str, ts: int) -> float | None:
    series = market[symbol]
    index = bisect_right(series["times"], ts) - 1
    if index < 0:
        return None
    row = series["rows"][index]
    start = int(row["event_time_ms"])
    if start == ts:
        # The entry-time bar open is available at the H1 boundary.
        return float(row["open"])
    if ts >= start + HOUR:
        # A completed last bar remains usable only at its immediate close.
        return float(row["close"]) if ts == start + HOUR else None
    # The current H1 close is FUTURE information until the hour has finished.
    # Use the immediately preceding contiguous completed bar, or fail closed.
    if index < 1:
        return None
    previous = series["rows"][index - 1]
    if int(previous["event_time_ms"]) + HOUR != start:
        return None
    return float(previous["close"])


def _side_sign(side: str) -> float:
    return 1.0 if side == "LONG" else -1.0


def _equity(wallet: float, active: dict[int, dict[str, Any]],
            market: dict[str, dict[str, Any]], ts: int) -> float:
    value = wallet
    for position in active.values():
        mark = _mark(market, position["symbol"], ts)
        if mark is None:
            raise ValueError(f"UNVERIFIED_ACTIVE_POSITION_MARK:{position['symbol']}:{ts}")
        value += _side_sign(position["side"]) * position["quantity"] * (mark - position["entry_price"])
    return value


def _gross(position: dict[str, Any], market: dict[str, dict[str, Any]], ts: int, equity: float) -> float:
    mark = _mark(market, position["symbol"], ts)
    if mark is None or equity <= 0:
        return math.inf
    return abs(position["quantity"] * mark) / equity


def _strategy_cap(candidate: dict[str, Any]) -> float:
    return {"V12": V12_CAP, "PENGU": PENGU_CAP, "Q102": Q102_CAP, "FET": FET_CAP, "V52": V52_CAP}[candidate["strategy_id"]]


def _day(ts: int) -> str:
    return datetime.fromtimestamp(ts / 1000, timezone.utc).date().isoformat()


def _scheduled_funding(data_root: Path, symbol: str, entry: int, exit: int) -> list[tuple[int, float]]:
    path = data_root / "normalized/aster/funding" / f"{symbol}.jsonl"
    if not path.is_file():
        return []
    return [(ts, rate) for ts, rate in _funding(data_root, symbol) if entry < ts <= exit]



def _trade_outcome_aggregates(
    completed: list[dict[str, Any]], rate_at,
) -> dict[str, dict[str, dict[str, Any]]]:
    """Aggregate modeled *allocated and closed* trades without exposing trade rows.

    Positive/negative classifications include modeled entry and exit costs and
    funding. The same as-of exit FX rate as strategy_pnl_jpy is used; this is a
    delayed ECB reference conversion, not an executable FX rate.
    """
    def new_bucket() -> dict[str, Any]:
        return {
            "trades": 0, "winning_trades": 0, "losing_trades": 0,
            "flat_trades": 0, "gross_win_jpy": 0.0, "gross_loss_abs_jpy": 0.0,
            "net_pnl_jpy": 0.0, "price_pnl_jpy": 0.0,
            "funding_pnl_jpy": 0.0, "fees_jpy": 0.0,
            "largest_win_jpy": 0.0, "largest_loss_abs_jpy": 0.0,
        }

    strategy: dict[str, dict[str, Any]] = {}
    fet_reason: dict[str, dict[str, Any]] = {}
    pengu_route: dict[str, dict[str, Any]] = {}
    pengu_reason: dict[str, dict[str, Any]] = {}
    pengu_side: dict[str, dict[str, Any]] = {}

    def accumulate(group: dict[str, dict[str, Any]], key: str,
                   trade: dict[str, Any], rate: float) -> None:
        bucket = group.setdefault(key, new_bucket())
        pnl = float(trade["total_pnl_jpy"]) * rate
        bucket["trades"] += 1
        bucket["net_pnl_jpy"] += pnl
        bucket["price_pnl_jpy"] += float(trade["price_pnl"]) * rate
        bucket["funding_pnl_jpy"] += float(trade["funding_pnl"]) * rate
        bucket["fees_jpy"] += (float(trade["entry_fee"]) + float(trade["exit_fee"])) * rate
        if pnl > 0:
            bucket["winning_trades"] += 1
            bucket["gross_win_jpy"] += pnl
            bucket["largest_win_jpy"] = max(bucket["largest_win_jpy"], pnl)
        elif pnl < 0:
            loss = -pnl
            bucket["losing_trades"] += 1
            bucket["gross_loss_abs_jpy"] += loss
            bucket["largest_loss_abs_jpy"] = max(bucket["largest_loss_abs_jpy"], loss)
        else:
            bucket["flat_trades"] += 1

    for trade in completed:
        kind = str(trade["strategy_id"])
        rate = float(rate_at(int(trade["exit_ts_ms"])))
        accumulate(strategy, kind, trade, rate)
        if kind == "FET":
            accumulate(fet_reason, str(trade.get("exit_reason_actual") or "UNKNOWN"), trade, rate)
        elif kind == "PENGU":
            accumulate(pengu_route, str(trade.get("route") or "UNKNOWN"), trade, rate)
            accumulate(pengu_reason, str(trade.get("exit_reason_actual") or "UNKNOWN"), trade, rate)
            accumulate(pengu_side, str(trade.get("side") or "UNKNOWN"), trade, rate)

    def finish(group: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
        for bucket in group.values():
            wins, losses = bucket["winning_trades"], bucket["losing_trades"]
            bucket["average_win_jpy"] = bucket["gross_win_jpy"] / wins if wins else None
            bucket["average_loss_abs_jpy"] = bucket["gross_loss_abs_jpy"] / losses if losses else None
            bucket["win_rate"] = wins / bucket["trades"] if bucket["trades"] else None
            bucket["profit_factor"] = (
                bucket["gross_win_jpy"] / bucket["gross_loss_abs_jpy"]
                if bucket["gross_loss_abs_jpy"] > 0 else None
            )
        return dict(sorted(group.items()))

    return {
        "by_strategy": finish(strategy),
        "fet_by_exit_reason": finish(fet_reason),
        "pengu_by_route": finish(pengu_route),
        "pengu_by_exit_reason": finish(pengu_reason),
        "pengu_by_side": finish(pengu_side),
    }


def _portfolio_scenario(
    candidates: list[dict[str, Any]], data_root: Path, market: dict[str, dict[str, Any]],
    *, round_trip_cost_bps: float, scenario_id: str,
    fx_series: list[tuple[int, float]] | None = None,
) -> dict[str, Any]:
    cost_side = round_trip_cost_bps / 2 / 10_000
    deposits = _monthly_deposits()
    currency = "USD" if fx_series is not None else "NOMINAL_JPY"
    rate_at = (lambda ts: asof_jpy_per_usd(fx_series, ts)) if fx_series is not None else (lambda _ts: 1.0)
    deposited_units = 0.0
    # Immutable per-scenario audit: every upstream candidate must receive one
    # accepted, rejected, or pre-allocation-excluded decision. No inference
    # from aggregate reject counters is needed when researching opportunity cost.
    candidate_decisions: list[dict[str, Any]] = []
    events: list[dict[str, Any]] = []

    def record_decision(candidate: dict[str, Any], status: str, reason: str,
                        ts: int, **details: Any) -> None:
        candidate_decisions.append({
            "candidate_id": candidate["_model_candidate_id"],
            "strategy_id": candidate["strategy_id"],
            "symbol": candidate.get("symbol"), "side": candidate.get("side"),
            "route": candidate.get("route"), "entry_version": candidate.get("entry_version"),
            "family": candidate.get("family"), "rank": candidate.get("rank"),
            "signal_ts_ms": candidate.get("signal_ts_ms"),
            "entry_ts_ms": candidate.get("entry_ts_ms"),
            "candidate_entry_price_usd": candidate.get("entry_price"),
            "candidate_exit_ts_ms": candidate.get("exit_ts_ms"),
            "candidate_exit_price_usd": candidate.get("exit_price"),
            "candidate_exit_reason": candidate.get("exit_reason"),
            "requested_gross": candidate.get("requested_gross"),
            "upstream_status": candidate.get("status"),
            "v52_entry_basis_bps": candidate.get("v52_entry_basis_bps"),
            "v52_yahoo_entry_reference_usd": candidate.get("v52_yahoo_entry_reference_usd"),
            "v52_source_session": candidate.get("v52_source_session"),
            "decision_ts_ms": ts, "decision": status, "reason": reason,
            **details,
        })

    by_entry: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for row in candidates:
        if (row.get("status") == "MODELED_CLOSED_TRADE"
                and PERIOD_START_MS <= int(row["entry_ts_ms"]) < PERIOD_END_MS
                and int(row.get("exit_ts_ms") or 0) <= PERIOD_END_MS):
            by_entry[int(row["entry_ts_ms"])].append(row)
        else:
            reason = (
                str(row.get("exclusion_reason") or row.get("status") or "UNKNOWN")
                if row.get("status") != "MODELED_CLOSED_TRADE"
                else "LIFECYCLE_OUTSIDE_SAMPLE"
            )
            record_decision(row, "EXCLUDED_PREALLOCATION", reason,
                            int(row.get("signal_ts_ms") or row.get("entry_ts_ms") or PERIOD_START_MS))
    candidate_times = sorted(by_entry)
    deposit_times = sorted(deposits)
    candidate_i = deposit_i = 0
    scheduled: list[tuple[int, int, str, int, Any]] = []
    sequence = 0
    wallet = 0.0
    active: dict[int, dict[str, Any]] = {}
    next_id = 1
    completed: list[dict[str, Any]] = []
    rejected = Counter()
    event_cashflow: dict[int, float] = defaultdict(float)
    pengu_route_until: dict[str, int] = defaultdict(int)
    pengu_hold_until = 0
    pengu_cooldown_until = 0
    pengu_risk_equity = 1.0
    pengu_risk_peak = 1.0
    daily_pnl: dict[str, float] = defaultdict(float)
    daily_start_equity: dict[str, float] = {}
    daily_blocked: set[str] = set()
    v12_cooldown_by_symbol: dict[str, int] = defaultdict(int)

    def push(ts: int, order: int, kind: str, pid: int, payload: Any = None) -> None:
        nonlocal sequence
        sequence += 1
        heapq.heappush(scheduled, (ts, order, kind, pid, (sequence, payload)))

    def record_day_pnl(ts: int, amount: float) -> None:
        d = _day(ts)
        if d not in daily_start_equity:
            daily_start_equity[d] = max(1e-9, _equity(wallet, active, market, ts))
        daily_pnl[d] += amount
        if daily_pnl[d] / max(daily_start_equity[d], 1e-9) <= -DAILY_LOSS_LIMIT:
            daily_blocked.add(d)

    def finalize_position(pid: int, ts: int, exit_price: float, reason: str) -> None:
        nonlocal wallet, pengu_risk_equity, pengu_risk_peak, pengu_hold_until, pengu_cooldown_until
        position = active.pop(pid, None)
        if not position:
            return
        quantity = position["quantity"]
        price_pnl = _side_sign(position["side"]) * quantity * (exit_price - position["entry_price"])
        exit_fee = abs(quantity * exit_price) * cost_side
        cash = price_pnl - exit_fee
        wallet += cash
        event_cashflow[ts] += cash
        position["price_pnl"] += price_pnl
        position["exit_fee"] += exit_fee
        total = position["price_pnl"] + position["funding_pnl"] - position["entry_fee"] - position["exit_fee"]
        position.update({
            "exit_ts_ms": ts, "exit_price": exit_price, "exit_reason_actual": reason,
            "total_pnl_jpy": total, "wallet_after_exit": wallet,
        })
        position.update({
            "candidate_id": position.get("candidate_id"),
            "modeled_realized_pnl_jpy_at_exit_fx": total * rate_at(ts),
            "reference_fx_exit_jpy_per_usd": rate_at(ts),
            "settlement_currency": currency,
            "historical_fill_verified": False,
        })
        completed.append(position)
        events.append({
            "event_type": "MODELED_EXIT", "ts_ms": ts,
            "candidate_id": position.get("candidate_id"),
            "position_id": pid, "strategy_id": position["strategy_id"],
            "symbol": position["symbol"], "side": position["side"],
            "quantity": quantity, "modeled_price_usd": exit_price,
            "fee_settlement": exit_fee, "price_pnl_settlement": price_pnl,
            "net_cashflow_settlement": cash, "total_trade_pnl_settlement": total,
            "reference_fx_jpy_per_usd": rate_at(ts),
            "exit_reason": reason, "wallet_after_event": wallet,
            "historical_fill_verified": False,
        })
        record_day_pnl(ts, cash)
        if position["strategy_id"] == "V12":
            v12_cooldown_by_symbol[position["symbol"]] = ts + 2 * HOUR
        if position["strategy_id"] == "PENGU":
            account_return = total / max(position["entry_equity"], 1e-9)
            pengu_risk_equity *= 1 + account_return
            pengu_risk_peak = max(pengu_risk_peak, pengu_risk_equity)
            dd = pengu_risk_equity / pengu_risk_peak - 1
            if dd <= -0.17:
                pengu_hold_until = max(pengu_hold_until, ts + 72 * HOUR)
            hard = "HARD_STOP" in reason
            pengu_cooldown_until = max(pengu_cooldown_until, ts + (24 if hard else 6) * HOUR)
            if hard:
                pengu_route_until[position.get("route") or "BASE_V64_LONG"] = max(
                    pengu_route_until[position.get("route") or "BASE_V64_LONG"], ts + 60 * HOUR)

    def preempt_fet(ts: int, reason: str) -> bool:
        rows = [(pid, pos) for pid, pos in active.items() if pos["strategy_id"] == "FET"]
        if not rows:
            return False
        pid, position = rows[0]
        mark = _mark(market, position["symbol"], ts)
        if mark is None:
            return False
        finalize_position(pid, ts, mark, reason)
        return True

    while True:
        next_candidate = candidate_times[candidate_i] if candidate_i < len(candidate_times) else math.inf
        next_deposit = deposit_times[deposit_i] if deposit_i < len(deposit_times) else math.inf
        next_scheduled = scheduled[0][0] if scheduled else math.inf
        ts = min(next_candidate, next_deposit, next_scheduled)
        if not math.isfinite(ts) or ts >= PERIOD_END_MS:
            break

        while deposit_i < len(deposit_times) and deposit_times[deposit_i] == ts:
            amount_jpy = deposits[ts]
            amount_units = amount_jpy / rate_at(ts)
            wallet += amount_units
            deposited_units += amount_units
            event_cashflow[ts] += amount_units
            events.append({
                "event_type": "MONTHLY_CONTRIBUTION", "ts_ms": ts,
                "contribution_jpy": amount_jpy,
                "settlement_currency": currency, "settlement_cashflow": amount_units,
                "reference_fx_jpy_per_usd": rate_at(ts), "wallet_after_event": wallet,
            })
            deposit_i += 1
        d = _day(ts)
        if d not in daily_start_equity:
            daily_start_equity[d] = max(1e-9, _equity(wallet, active, market, ts))

        while scheduled and scheduled[0][0] == ts:
            _, _, kind, pid, wrapped = heapq.heappop(scheduled)
            _, payload = wrapped
            position = active.get(pid)
            if not position:
                continue
            if kind == "funding":
                mark = _mark(market, position["symbol"], ts)
                if mark is None:
                    position["coverage_failures"].append(f"FUNDING_MARK_MISSING:{ts}")
                    continue
                rate = float(payload)
                cash = -_side_sign(position["side"]) * abs(position["quantity"] * mark) * rate
                wallet += cash
                event_cashflow[ts] += cash
                position["funding_pnl"] += cash
                events.append({
                    "event_type": "FUNDING", "ts_ms": ts, "position_id": pid,
                    "candidate_id": position.get("candidate_id"),
                    "strategy_id": position["strategy_id"], "symbol": position["symbol"],
                    "funding_rate": rate, "modeled_mark_price_usd": mark,
                    "cashflow_settlement": cash,
                    "reference_fx_jpy_per_usd": rate_at(ts),
                    "wallet_after_event": wallet,
                })
                record_day_pnl(ts, cash)
            elif kind == "partial":
                fraction = float(payload.get("quantityFraction") or 0.5)
                fraction = min(1.0, max(0.0, fraction))
                close_qty = position["quantity"] * fraction
                price = float(payload["price"])
                price_pnl = _side_sign(position["side"]) * close_qty * (price - position["entry_price"])
                fee = abs(close_qty * price) * cost_side
                cash = price_pnl - fee
                wallet += cash
                event_cashflow[ts] += cash
                position["price_pnl"] += price_pnl
                position["exit_fee"] += fee
                position["quantity"] -= close_qty
                position["partial_actual"] = {"ts": ts, "price": price, "fraction": fraction}
                events.append({
                    "event_type": "MODELED_PARTIAL_EXIT", "ts_ms": ts,
                    "candidate_id": position.get("candidate_id"),
                    "position_id": pid, "strategy_id": position["strategy_id"],
                    "symbol": position["symbol"], "quantity": close_qty,
                    "modeled_price_usd": price, "fraction": fraction,
                    "price_pnl_settlement": price_pnl, "fee_settlement": fee,
                    "net_cashflow_settlement": cash,
                    "reference_fx_jpy_per_usd": rate_at(ts),
                    "wallet_after_event": wallet, "historical_fill_verified": False,
                })
                record_day_pnl(ts, cash)
            elif kind == "exit":
                price = float(position["planned_exit_price"])
                finalize_position(pid, ts, price, str(position["planned_exit_reason"]))

        if candidate_i < len(candidate_times) and candidate_times[candidate_i] == ts:
            rows = sorted(by_entry[ts], key=lambda row: (
                PRIORITY[row["strategy_id"]], int(row.get("rank") or 0), row["symbol"]))
            for candidate in rows:
                strategy = candidate["strategy_id"]
                if d in daily_blocked:
                    record_decision(candidate, "REJECTED_PORTFOLIO", f"{strategy}:SHARED_DAILY_LOSS", ts)
                    rejected[f"{strategy}:SHARED_DAILY_LOSS"] += 1
                    continue
                if strategy == "PENGU":
                    route = candidate.get("route") or "BASE_V64_LONG"
                    if ts < pengu_cooldown_until:
                        record_decision(candidate, "REJECTED_PORTFOLIO", "PENGU:COOLDOWN", ts)
                        rejected["PENGU:COOLDOWN"] += 1
                        continue
                    if ts < pengu_hold_until:
                        record_decision(candidate, "REJECTED_PORTFOLIO", "PENGU:DD_HOLD", ts)
                        rejected["PENGU:DD_HOLD"] += 1
                        continue
                    if ts < pengu_route_until[route]:
                        record_decision(candidate, "REJECTED_PORTFOLIO", "PENGU:ROUTE_QUARANTINE", ts)
                        rejected["PENGU:ROUTE_QUARANTINE"] += 1
                        continue
                if strategy == "V12" and ts < v12_cooldown_by_symbol[candidate["symbol"]]:
                    record_decision(candidate, "REJECTED_PORTFOLIO", "V12:SYMBOL_COOLDOWN", ts)
                    rejected["V12:SYMBOL_COOLDOWN"] += 1
                    continue

                active_same_strategy = [p for p in active.values() if p["strategy_id"] == strategy]
                if strategy in {"PENGU", "Q102", "FET", "V52"} and active_same_strategy:
                    record_decision(candidate, "REJECTED_PORTFOLIO", f"{strategy}:SLOT_OCCUPIED", ts)
                    rejected[f"{strategy}:SLOT_OCCUPIED"] += 1
                    continue
                if strategy == "V12":
                    if any(p["symbol"] == candidate["symbol"] for p in active_same_strategy):
                        record_decision(candidate, "REJECTED_PORTFOLIO", "V12:SAME_SYMBOL_ACTIVE", ts)
                        rejected["V12:SAME_SYMBOL_ACTIVE"] += 1
                        continue
                    rank3 = int(candidate.get("rank") or 0) == 3
                    if rank3 and any(int(p.get("rank") or 0) == 3 for p in active_same_strategy):
                        record_decision(candidate, "REJECTED_PORTFOLIO", "V12:RANK3_SLOT_OCCUPIED", ts)
                        rejected["V12:RANK3_SLOT_OCCUPIED"] += 1
                        continue
                    if not rank3 and sum(int(p.get("rank") or 0) != 3 for p in active_same_strategy) >= 2:
                        record_decision(candidate, "REJECTED_PORTFOLIO", "V12:BASE_SLOTS_FULL", ts)
                        rejected["V12:BASE_SLOTS_FULL"] += 1
                        continue
                    if len(active_same_strategy) >= 3:
                        record_decision(candidate, "REJECTED_PORTFOLIO", "V12:MAX_POSITIONS", ts)
                        rejected["V12:MAX_POSITIONS"] += 1
                        continue

                equity = _equity(wallet, active, market, ts)
                if not (equity > 0):
                    record_decision(candidate, "REJECTED_PORTFOLIO", f"{strategy}:EQUITY_INVALID", ts)
                    rejected[f"{strategy}:EQUITY_INVALID"] += 1
                    continue
                strategy_gross = sum(_gross(p, market, ts, equity) for p in active_same_strategy)
                total_gross = sum(_gross(p, market, ts, equity) for p in active.values())
                crypto_gross = sum(_gross(p, market, ts, equity) for p in active.values()
                                   if p["strategy_id"] != "V52")
                stock_gross = sum(_gross(p, market, ts, equity) for p in active.values()
                                  if p["strategy_id"] == "V52")
                requested = min(float(candidate["requested_gross"]), _strategy_cap(candidate))
                strategy_room = max(0.0, _strategy_cap(candidate) - strategy_gross)
                sleeve_room = max(0.0, (STOCK_CAP - stock_gross) if strategy == "V52"
                                  else (CRYPTO_CAP - crypto_gross))
                total_room = max(0.0, TOTAL_CAP - total_gross)
                room = min(strategy_room, sleeve_room, total_room)

                # FET is the residual sleeve and is preemptible by core crypto.
                if strategy in {"PENGU", "V12", "Q102"} and room + 1e-12 < requested:
                    if preempt_fet(ts, f"CORE_PREEMPT:{strategy}"):
                        equity = _equity(wallet, active, market, ts)
                        active_same_strategy = [p for p in active.values() if p["strategy_id"] == strategy]
                        strategy_gross = sum(_gross(p, market, ts, equity) for p in active_same_strategy)
                        total_gross = sum(_gross(p, market, ts, equity) for p in active.values())
                        crypto_gross = sum(_gross(p, market, ts, equity) for p in active.values()
                                           if p["strategy_id"] != "V52")
                        stock_gross = sum(_gross(p, market, ts, equity) for p in active.values()
                                          if p["strategy_id"] == "V52")
                        strategy_room = max(0.0, _strategy_cap(candidate) - strategy_gross)
                        sleeve_room = max(0.0, (STOCK_CAP - stock_gross) if strategy == "V52"
                                          else (CRYPTO_CAP - crypto_gross))
                        total_room = max(0.0, TOTAL_CAP - total_gross)
                        room = min(strategy_room, sleeve_room, total_room)

                accepted_gross = min(requested, room)
                if strategy == "PENGU" and accepted_gross + 1e-9 < requested:
                    record_decision(candidate, "REJECTED_PORTFOLIO", "PENGU:NO_LOT_SHRINK", ts)
                    rejected["PENGU:NO_LOT_SHRINK"] += 1
                    continue
                if strategy == "FET" and accepted_gross + 1e-9 < FET_MIN:
                    record_decision(candidate, "REJECTED_PORTFOLIO", "FET:RESIDUAL_LT_MIN", ts)
                    rejected["FET:RESIDUAL_LT_MIN"] += 1
                    continue
                if accepted_gross <= 1e-9:
                    record_decision(candidate, "REJECTED_PORTFOLIO", f"{strategy}:NO_GROSS_ROOM", ts)
                    rejected[f"{strategy}:NO_GROSS_ROOM"] += 1
                    continue

                entry_price = float(candidate["entry_price"])
                notional = equity * accepted_gross
                quantity = notional / entry_price
                entry_fee = notional * cost_side
                wallet -= entry_fee
                event_cashflow[ts] -= entry_fee
                record_day_pnl(ts, -entry_fee)
                pid = next_id
                next_id += 1
                position = {
                    "position_id": pid, "strategy_id": strategy, "symbol": candidate["symbol"],
                    "side": candidate["side"], "entry_ts_ms": ts, "entry_price": entry_price,
                    "entry_equity": equity, "accepted_gross": accepted_gross,
                    "notional_entry_jpy": notional, "quantity": quantity, "original_quantity": quantity,
                    "entry_fee": entry_fee, "exit_fee": 0.0, "price_pnl": 0.0, "funding_pnl": 0.0,
                    "planned_exit_ts_ms": int(candidate["exit_ts_ms"]),
                    "planned_exit_price": float(candidate["exit_price"]),
                    "planned_exit_reason": candidate["exit_reason"],
                    "rank": candidate.get("rank"), "route": candidate.get("route"),
                    "entry_version": candidate.get("entry_version"), "family": candidate.get("family"),
                    "candidate_id": candidate["_model_candidate_id"],
                    "source_runtime_sha": candidate.get("source_runtime_sha"),
                    "candidate_requested_gross": requested, "coverage_failures": [],
                }
                active[pid] = position
                record_decision(
                    candidate, "ACCEPTED_MODELED_ENTRY", "GROSS_ALLOCATED", ts,
                    position_id=pid, accepted_gross=accepted_gross,
                    modeled_entry_quantity=quantity, modeled_entry_price_usd=entry_price,
                    modeled_entry_notional_settlement=notional,
                    modeled_entry_fee_settlement=entry_fee,
                    entry_equity_settlement=equity,
                    reference_fx_jpy_per_usd=rate_at(ts),
                    historical_fill_verified=False,
                )
                events.append({
                    "event_type": "MODELED_ENTRY", "ts_ms": ts,
                    "candidate_id": candidate["_model_candidate_id"],
                    "position_id": pid, "strategy_id": strategy,
                    "symbol": candidate["symbol"], "side": candidate["side"],
                    "modeled_price_usd": entry_price, "quantity": quantity,
                    "accepted_gross": accepted_gross,
                    "notional_settlement": notional, "fee_settlement": entry_fee,
                    "reference_fx_jpy_per_usd": rate_at(ts),
                    "wallet_after_event": wallet, "historical_fill_verified": False,
                })
                push(position["planned_exit_ts_ms"], 2, "exit", pid)
                partial = candidate.get("partial")
                if partial and ts < int(partial["ts"]) < position["planned_exit_ts_ms"]:
                    push(int(partial["ts"]), 1, "partial", pid, partial)
                for funding_ts, rate in _scheduled_funding(
                        data_root, position["symbol"], ts, position["planned_exit_ts_ms"]):
                    push(funding_ts, 0, "funding", pid, rate)
            candidate_i += 1

    # Do not manufacture end-of-period closes for candidates whose audited
    # lifecycle extended outside the test period. Accepted positions here should
    # already have a modeled planned exit inside the period.
    for pid in list(active):
        position = active[pid]
        mark = _mark(market, position["symbol"], PERIOD_END_MS - HOUR)
        if mark is not None:
            finalize_position(pid, PERIOD_END_MS, mark, "PERIOD_END_MODEL_FLAT")

    if len(candidate_decisions) != len(candidates):
        raise ValueError(
            f"CANDIDATE_DECISION_LEDGER_INCOMPLETE:{len(candidate_decisions)}:{len(candidates)}"
        )
    by_decision = Counter(
        (row["strategy_id"], row["decision"], row["reason"])
        for row in candidate_decisions
    )
    decision_counts = {}
    for (strategy, decision, reason), count in sorted(by_decision.items()):
        decision_counts.setdefault(strategy, {}).setdefault(decision, {})[reason] = count

    total_contributed = sum(deposits.values())
    # Build an H1 MTM curve from actual accepted quantities and realized cash
    # events.  Entry/exit/funding events are already represented in event_cashflow.
    trades_by_entry: dict[int, list[dict[str, Any]]] = defaultdict(list)
    trades_by_exit: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for trade in completed:
        trades_by_entry[int(trade["entry_ts_ms"])].append(trade)
        trades_by_exit[int(trade["exit_ts_ms"])].append(trade)
    curve = []
    cash = 0.0
    open_curve: dict[int, dict[str, Any]] = {}
    peak = 0.0
    max_dd = 0.0
    monthly = {}
    missing_mtm = 0
    missing_mtm_examples: list[dict[str, Any]] = []
    # V52 enters and exits at NY :30. Replay every intra-hour cashflow
    # chronologically before H1 MTM, never omit its realized profit/fees.
    event_times = sorted(set(event_cashflow) | set(trades_by_entry) | set(trades_by_exit))
    event_index = 0
    for ts in range(PERIOD_START_MS, PERIOD_END_MS + 1, HOUR):
        while event_index < len(event_times) and event_times[event_index] <= ts:
            event_ts = event_times[event_index]
            cash += event_cashflow.get(event_ts, 0.0)
            for trade in trades_by_exit.get(event_ts, []):
                open_curve.pop(int(trade["position_id"]), None)
            for trade in trades_by_entry.get(event_ts, []):
                if int(trade["exit_ts_ms"]) > event_ts:
                    open_curve[int(trade["position_id"])] = trade
            event_index += 1
        unrealized = 0.0
        for trade in open_curve.values():
            mark = _mark(market, trade["symbol"], ts)
            if mark is None:
                # Omitting this unrealized exposure would make equity/DD look
                # better on precisely the hours whose prices are missing.
                missing_mtm += 1
                if len(missing_mtm_examples) < 20:
                    missing_mtm_examples.append({"symbol": trade["symbol"], "ts_ms": ts})
                continue
            qty = float(trade["original_quantity"])
            partial = trade.get("partial_actual")
            if partial and ts >= int(partial["ts"]):
                qty *= 1 - float(partial["fraction"])
            unrealized += _side_sign(trade["side"]) * qty * (mark - float(trade["entry_price"]))
        equity = (cash + unrealized) * rate_at(ts)
        peak = max(peak, equity)
        dd = equity / peak - 1 if peak > 0 else 0.0
        max_dd = min(max_dd, dd)
        month = datetime.fromtimestamp(ts / 1000, timezone.utc).strftime("%Y-%m")
        monthly[month] = equity
        curve.append((ts, equity))

    # Internal settlement unit is USD when official ECB reference is provided;
    # otherwise the legacy research-only nominal JPY unit is retained.
    pnls = [float(row["total_pnl_jpy"]) for row in completed]
    gains = sum(value for value in pnls if value > 0)
    losses = -sum(value for value in pnls if value < 0)
    strategy_pnl = defaultdict(float)
    strategy_trades = Counter()
    trade_outcome_aggregates = _trade_outcome_aggregates(completed, rate_at)
    for row in completed:
        strategy_pnl[row["strategy_id"]] += (
            float(row["total_pnl_jpy"]) * rate_at(int(row["exit_ts_ms"])))
        strategy_trades[row["strategy_id"]] += 1
    final_equity = curve[-1][1] if curve else wallet * rate_at(PERIOD_END_MS)
    final_rate = rate_at(PERIOD_END_MS)
    # Reconcile in actual settlement units (USD when ECB reference exists).
    closed_pnl = sum(pnls)
    cashflow_total = sum(event_cashflow.values())
    tolerance = max(1e-6, abs(wallet) * 1e-9)
    if abs((deposited_units + closed_pnl) - wallet) > tolerance:
        raise ValueError("PORTFOLIO_TRADE_PNL_WALLET_RECONCILIATION_FAILED")
    if abs(cashflow_total - wallet) > tolerance:
        raise ValueError("PORTFOLIO_CASHFLOW_WALLET_RECONCILIATION_FAILED")
    if not active and abs(final_equity / final_rate - wallet) > tolerance:
        raise ValueError("PORTFOLIO_EQUITY_WALLET_RECONCILIATION_FAILED")
    return {
        "scenario_id": scenario_id,
        "status": "INCOMPLETE_MTM_H1_PRICE_MODEL" if missing_mtm else "COMPLETE_H1_PRICE_MODEL_NOT_L2_VERIFIED",
        "missing_active_position_mtm_hours": missing_mtm,
        "missing_mtm_examples": missing_mtm_examples,
        "round_trip_cost_bps": round_trip_cost_bps,
        "settlement_currency": currency,
        "fx_reference": "ECB_USDJPY_EUR_CROSS_NEXT_DAY" if fx_series is not None else "NONE_NOMINAL_RESEARCH",
        "initial_jpy": 10_000.0, "monthly_jpy": 10_000.0, "contributed_jpy": total_contributed,
        "final_equity_jpy": final_equity,
        "net_profit_jpy": final_equity - total_contributed,
        "profit_factor": gains / losses if losses > 0 else None,
        "win_rate": sum(value > 0 for value in pnls) / len(pnls) if pnls else None,
        "maximum_mtm_drawdown": None if missing_mtm else max_dd,
        "closed_trades": len(completed),
        "accounting_reconciliation": {
            "status": "PASS", "wallet_settlement_units": wallet,
            "closed_trade_pnl_settlement_units": closed_pnl,
            "event_cashflow_settlement_units": cashflow_total,
            "deposit_settlement_units": deposited_units,
            "final_fx_jpy_per_usd": final_rate,
            "equity_minus_wallet_jpy": final_equity - wallet * final_rate,
            "equity_minus_wallet_nominal_jpy": (
                final_equity - wallet if fx_series is None else None),
            "intrahour_events": sum(event_ts % HOUR != 0 for event_ts in event_times),
        },
        "strategy_pnl_jpy": dict(strategy_pnl),
        "fx_cash_translation_pnl_jpy": (
            final_equity - total_contributed - sum(strategy_pnl.values())),
        "strategy_trades": dict(strategy_trades),
        "candidate_decision_counts": decision_counts,
        "candidate_decision_rows": len(candidate_decisions),
        "strategy_trade_outcome_aggregates": trade_outcome_aggregates,
        "rejected_entries": dict(rejected),
        "monthly_equity_jpy": monthly,
        "pengu_risk_overlay": {
            "realized_equity_index": pengu_risk_equity,
            "realized_drawdown": pengu_risk_equity / pengu_risk_peak - 1 if pengu_risk_peak > 0 else None,
            "global_hold_until_ms": pengu_hold_until,
            "route_quarantine_until_ms": dict(pengu_route_until),
        },
        "trade_rows": completed,
        "candidate_decision_rows_full": sorted(
            candidate_decisions, key=lambda row: (int(row["decision_ts_ms"]), row["candidate_id"])
        ),
        "event_rows": events,
    }


def run_portfolio_model(data_root: Path, candidate_root: Path, output_root: Path,
                        v52_ledger_root: Path | None = None,
                        ecb_fx_root: Path | None = None) -> dict[str, Any]:
    data_root, candidate_root, output_root = map(Path, (data_root, candidate_root, output_root))
    candidates = _rows(candidate_root / "crypto-price-model-candidates.jsonl")
    fx_series = load_ecb_cross(ecb_fx_root) if ecb_fx_root is not None else None
    v52_unresolved = 0
    v52_skipped = 0
    v52_missing_data_skipped = 0
    v52_model_status = "NOT_PROVIDED"
    v52_model_complete = v52_ledger_root is None
    unresolved_crypto = Counter(str(row["strategy_id"]) + ":" + str(row["status"])
                                for row in candidates if row.get("status") != "MODELED_CLOSED_TRADE")
    if v52_ledger_root is not None:
        v52_root = Path(v52_ledger_root)
        v52_rows = _rows(v52_root / "v52-model-ledger.jsonl")
        v52_summary = json.loads((v52_root / "v52-model-summary.json").read_text())
        v52_model_status = str(v52_summary.get("status") or "UNKNOWN")
        v52_unresolved = sum(row.get("status") in {"UNRESOLVED_MODEL_EXIT", "OPEN_AT_SAMPLE_END"}
                             for row in v52_rows)
        declared_unresolved = int(v52_summary.get("unresolved_exit_trades") or 0)
        if declared_unresolved > v52_unresolved:
            raise ValueError("V52_UNRESOLVED_SUMMARY_EXCEEDS_LEDGER")
        # Closing every *observed* V52 trade is insufficient to certify
        # the entire annual candidate sample when the vendor has missing
        # underlying-reference sessions or unverifiable price chains.
        v52_missing_data_skipped = sum(
            row.get("status") == "SKIPPED_CANDIDATE"
            and row.get("reason") in {
                "YAHOO_SESSION_COVERAGE_INCOMPLETE",
                "ENTRY_PRICE_CHAIN_UNVERIFIED",
                "PREVIOUS_EXIT_UNVERIFIED_SAME_SESSION",
            }
            for row in v52_rows
        )
        v52_model_complete = (
            v52_model_status == "RESEARCH_PRICE_MODEL_CLOSED_SAMPLE"
            and v52_unresolved == 0
            and v52_missing_data_skipped == 0
        )
        v52_skipped = sum(row.get("status") == "SKIPPED_CANDIDATE" for row in v52_rows)
        for row in v52_rows:
            if row.get("status") == "SKIPPED_CANDIDATE":
                candidates.append({
                    "strategy_id": "V52", "symbol": row["symbol"],
                    "side": row.get("side"), "route": "V50_POST_OPEN_BASIS",
                    "entry_ts_ms": int(row["decision_ts_ms"]),
                    "signal_ts_ms": int(row["decision_ts_ms"]),
                    "status": "V52_PREALLOCATION_SKIPPED",
                    "exclusion_reason": str(row["reason"]),
                    "requested_gross": float(v52_summary.get("assumed_single_slot_gross") or 2.0),
                    "entry_price": row.get("aster_entry_price_usd"),
                    "v52_source_session": row.get("session"),
                })
                continue
            if row.get("status") != "MODELED_CLOSED_TRADE":
                continue
            candidates.append({
                "strategy_id": "V52", "symbol": row["symbol"], "side": row["side"],
                "entry_ts_ms": int(row["entry_ts_ms"]), "signal_ts_ms": int(row["entry_ts_ms"]),
                "entry_price": float(row["aster_entry_price_usd"]),
                "requested_gross": float(row.get("slot_gross") or 2.0),
                "status": "MODELED_CLOSED_TRADE",
                "exit_ts_ms": int(row["exit_ts_ms"]),
                "exit_price": float(row["aster_exit_price_usd"]),
                "exit_reason": row.get("reason") or row.get("exit_reason") or "V52_MODELED_EXIT",
                "unit_price_return": float(row["gross_price_return"]),
                "route": "V50_POST_OPEN_BASIS",
                "v52_entry_basis_bps": row.get("entry_basis_bps"),
                "v52_yahoo_entry_reference_usd": row.get("yahoo_entry_reference_usd"),
            })
    candidates.sort(key=lambda row: (int(row.get("entry_ts_ms") or 0),
                                     PRIORITY.get(row["strategy_id"], 99), row["symbol"]))
    for candidate_index, candidate in enumerate(candidates, start=1):
        candidate["_model_candidate_id"] = f"C{candidate_index:06d}"
    # Pre-allocation exclusions are audit rows only and must not force market-data
    # availability. Only candidates that can actually enter the portfolio need marks.
    symbols = {str(row["symbol"]) for row in candidates
               if row.get("symbol") and row.get("status") == "MODELED_CLOSED_TRADE"}
    v52_funding_missing = []
    stock_coverage = data_root / "aster-stock-hourly-coverage.json"
    stock_meta = (
        json.loads(stock_coverage.read_text())["symbols"]
        if stock_coverage.is_file() else {}
    )
    for stock in sorted({row["symbol"] for row in candidates
                         if row.get("strategy_id") == "V52"
                         and row.get("status") == "MODELED_CLOSED_TRADE"}):
        meta = stock_meta.get(stock.removesuffix("USDT"), {})
        fpath = data_root / "normalized/aster/funding" / f"{stock}.jsonl"
        funding_hash = (
            hashlib.sha256(fpath.read_bytes()).hexdigest()
            if fpath.is_file() else None
        )
        if (meta.get("funding_status") != "ACQUIRED_PRICE_MODEL_ONLY"
                or funding_hash != meta.get("funding_normalized_sha256")):
            v52_funding_missing.append(stock)
    market = _market(data_root, symbols)
    scenarios = []
    for scenario_id, cost in (
        ("PRICE_MODEL_ASTER_TAKER_8BPS", 8.0),
        ("PRICE_MODEL_BASE_10BPS", 10.0),
        # 70bps is retained only as an intentionally extreme cost sensitivity;
        # it is not an Aster baseline assumption.
        ("PRICE_MODEL_EXTREME_COST_70BPS_NOT_BASELINE", 70.0),
    ):
        result = _portfolio_scenario(candidates, data_root, market, round_trip_cost_bps=cost, scenario_id=scenario_id, fx_series=fx_series)
        trade_rows = result.pop("trade_rows")
        candidate_rows = result.pop("candidate_decision_rows_full")
        event_rows = result.pop("event_rows")
        scenario_dir = output_root / scenario_id
        scenario_dir.mkdir(parents=True, exist_ok=True)
        (scenario_dir / "portfolio-trades.jsonl").write_text(
            "".join(json.dumps(row, sort_keys=True, allow_nan=False) + "\n" for row in trade_rows),
            encoding="utf-8")
        (scenario_dir / "candidate-decisions.jsonl").write_text(
            "".join(json.dumps(row, sort_keys=True, allow_nan=False) + "\n" for row in candidate_rows),
            encoding="utf-8")
        (scenario_dir / "portfolio-events.jsonl").write_text(
            "".join(json.dumps(row, sort_keys=True, allow_nan=False) + "\n" for row in event_rows),
            encoding="utf-8")
        (scenario_dir / "metrics.json").write_text(
            json.dumps(result, sort_keys=True, indent=2, allow_nan=False) + "\n", encoding="utf-8")
        scenarios.append(result)
    summary = {
        "status": ("INCOMPLETE_ALL_FIVE_PRICE_MODEL" if (
            not v52_model_complete or v52_unresolved or v52_funding_missing or unresolved_crypto
            or any(row["status"] == "INCOMPLETE_MTM_H1_PRICE_MODEL" for row in scenarios))
            else "ALL_FIVE_H1_PRICE_MODEL_NOT_FORMAL_L2_VERIFIED"),
        "unresolved_crypto_candidate_counts": dict(unresolved_crypto),
        "v52_model_status": v52_model_status,
        "v52_model_complete": v52_model_complete,
        "v52_funding_verified": not v52_funding_missing,
        "v52_missing_funding_symbols": v52_funding_missing,
        "period_start_ms": PERIOD_START_MS, "period_end_exclusive_ms": PERIOD_END_MS,
        "contribution_model": (
            "JPY deposits converted to USD with as-of next-day ECB reference cross; "
            "USD-marked account revalued to JPY each H1" if fx_series is not None else
            "JPY nominal contributions; FX translation unavailable, research-only"),
        "shared_crypto_gross_cap": CRYPTO_CAP, "stock_gross_cap": STOCK_CAP, "total_gross_cap": TOTAL_CAP,
        "v52_unresolved_exit_trades_excluded": v52_unresolved,
        "v52_skipped_candidates": v52_skipped,
        "v52_missing_market_data_selected_candidates_excluded": v52_missing_data_skipped,
        "daily_loss_limit": DAILY_LOSS_LIMIT,
        "scenarios": scenarios,
        "limitations": [
            "H1 bar-price fills are modeled, not historical order-book fills",
            "8bps and 10bps are the practical price-model cost sensitivities; 70bps is extreme-only and not an Aster baseline",
            ("ECB daily USDJPY is a delayed reference cross, not executable USDTJPY "
             "nor the mandated FRED DEXJPUS parity source" if fx_series is not None
             else "JPY notional returns do not include USDJPY translation"),
            "Margin-guard liquidation-buffer mechanics are not reconstructed from H1 OHLC",
            ("V52 stock-perpetual historical funding verified from official Aster"
             if not v52_funding_missing else
             "V52 missing stock-perpetual funding; portfolio PnL is incomplete"),
        ],
    }
    output_root.mkdir(parents=True, exist_ok=True)
    (output_root / "portfolio-price-model-summary.json").write_text(
        json.dumps(summary, sort_keys=True, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", type=Path, required=True)
    parser.add_argument("--candidate-root", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--v52-ledger-root", type=Path,
                        help="Optional modeled V52 ledger; unresolved rows remain excluded and reported")
    parser.add_argument("--ecb-fx-root", type=Path,
                        help="Optional official ECB EUR-cross USDJPY; FRED source parity is NOT claimed")
    args = parser.parse_args()
    result = run_portfolio_model(args.data_root, args.candidate_root, args.output_root,
                                 v52_ledger_root=args.v52_ledger_root,
                                 ecb_fx_root=args.ecb_fx_root)
    print(json.dumps({"status": result["status"], "scenarios": result["scenarios"]}, sort_keys=True, allow_nan=False))


if __name__ == "__main__":
    main()
