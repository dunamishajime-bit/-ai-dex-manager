from __future__ import annotations

import calendar
import hashlib
import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from .fet_rebuild import generate_fet_candidates
from .pengu_rebuild import generate_pengu_candidates
from .models import Funding, coerce_bar, coerce_funding
from .q102_rebuild import generate_q102_candidates
from .v12_rebuild import generate_v12_candidates
from .v52_rebuild import generate_v52_candidates
from .pengu_rebuild import apply_pengu_q60_dd17_h72


@dataclass(frozen=True)
class CapitalContract:
    initial: float = 10_000.0
    monthly: float = 10_000.0
    months: int = 12
    start_ts_ms: int = 1_754_784_000_000  # 2025-08-10T00:00:00Z


@dataclass
class Position:
    position_id: str
    strategy: str
    symbol: str
    side: str
    gross: float
    entry_price: float
    qty: float
    notional: float
    priority: int = 2
    preemptible: bool = False
    route: str = ""
    entry_ts: int = 0
    max_hold_hours: int = 24
    hard_stop_pct: float | None = None
    take_profit_pct: float | None = None
    asset_class: str = "crypto"
    profit_floor_trigger_pct: float | None = None
    profit_floor_stop_pct: float | None = None
    profit_floor_armed: bool = False


@dataclass(frozen=True)
class ReservationResult:
    accepted: bool
    reserved_gross: float = 0.0
    reason: str | None = None


@dataclass
class PortfolioState:
    cash: float = 10_000.0
    crypto_gross_cap: float = 3.0
    stock_gross_cap: float = 4.0
    total_gross_cap: float = 4.25
    positions: dict[str, Position] = field(default_factory=dict)
    pending_reservations: dict[str, float] = field(default_factory=dict)
    realized_pnl: float = 0.0
    fees: float = 0.0
    funding: float = 0.0
    events: list[dict[str, Any]] = field(default_factory=list)
    preemptions: list[dict[str, Any]] = field(default_factory=list)
    equity_timeline: list[dict[str, Any]] = field(default_factory=list)
    pending_asset_classes: dict[str, str] = field(default_factory=dict)


def _open_gross(state: PortfolioState, asset_class: str | None = None) -> float:
    position_gross = sum(position.gross for position in state.positions.values())
    pending_gross = sum(state.pending_reservations.values())
    if asset_class is None:
        return position_gross + pending_gross
    pending_gross = sum(gross for position_id, gross in state.pending_reservations.items() if state.pending_asset_classes.get(position_id, "crypto") == asset_class)
    return sum(position.gross for position in state.positions.values() if position.asset_class == asset_class) + pending_gross


def reserve_entry(state: PortfolioState, candidate: dict[str, Any]) -> ReservationResult:
    position_id = str(candidate["positionId"])
    if position_id in state.pending_reservations or position_id in state.positions:
        return ReservationResult(False, reason="PENDING_DUPLICATE")
    requested = float(candidate.get("requestedGross", 0.0))
    if requested <= 0:
        return ReservationResult(False, reason="NON_POSITIVE_GROSS")
    asset_class = str(candidate.get("assetClass", "stock" if str(candidate.get("symbol", "")).startswith("STOCK") else "crypto"))
    asset_cap = state.stock_gross_cap if asset_class == "stock" else state.crypto_gross_cap
    if _open_gross(state, asset_class) + requested > asset_cap + 1e-12:
        return ReservationResult(False, reason="STOCK_GROSS_CAP" if asset_class == "stock" else "CRYPTO_GROSS_CAP")
    if _open_gross(state) + requested > state.total_gross_cap + 1e-12:
        return ReservationResult(False, reason="TOTAL_GROSS_CAP")
    state.pending_reservations[position_id] = requested
    state.pending_asset_classes[position_id] = asset_class
    return ReservationResult(True, requested)


def commit_entry(state: PortfolioState, candidate: dict[str, Any], entry_price: float, qty: float = 1.0) -> Position:
    reservation = state.pending_reservations.pop(str(candidate["positionId"]), None)
    state.pending_asset_classes.pop(str(candidate["positionId"]), None)
    if reservation is None:
        raise ValueError("ENTRY_RESERVATION_MISSING")
    position = Position(
        position_id=str(candidate["positionId"]),
        strategy=str(candidate.get("strategy", candidate.get("strategyId", "UNKNOWN"))),
        symbol=str(candidate["symbol"]),
        side=str(candidate.get("side", "LONG")),
        gross=reservation,
        entry_price=float(entry_price),
        qty=float(qty),
        notional=float(entry_price) * float(qty),
        priority=int(candidate.get("priority", 2)),
        preemptible=bool(candidate.get("preemptible", False)),
        route=str(candidate.get("route", "")),
        entry_ts=int(candidate.get("entryTs", 0)),
        max_hold_hours=int(candidate.get("maxHoldHours", 72 if str(candidate.get("strategy", candidate.get("strategyId", ""))).startswith("PENGU") else 24)),
        hard_stop_pct=_optional_float(candidate, "hardStopPct", "hard_stop_pct"),
        take_profit_pct=_optional_float(candidate, "takeProfitPct", "take_profit_pct"),
        asset_class=str(candidate.get("assetClass", "stock" if str(candidate.get("symbol", "")).startswith("STOCK") else "crypto")),
        profit_floor_trigger_pct=_optional_float(candidate, "profitFloorTriggerPct"),
        profit_floor_stop_pct=_optional_float(candidate, "profitFloorStopPct"),
    )
    state.positions[position.position_id] = position
    return position


def preempt_fet(
    state: PortfolioState,
    candidate: dict[str, Any],
    *,
    fill_bars: dict[str, Any] | None = None,
    ts_ms: int | None = None,
    fee_rate: float = 0.0,
    slippage_bps: float = 0.0,
    funding: list[Funding] | None = None,
    funding_multiplier: float = 1.0,
) -> bool:
    """Settle FET at the decision bar OPEN before releasing its gross.

    No quote/fill timestamp means no preemption: deleting a live position
    without accounting for its PnL, costs and liquidation price is forbidden.
    """
    candidate_priority = int(candidate.get("priority", 2))
    targets = [
        position for position in state.positions.values()
        if position.preemptible and position.strategy.startswith("FET")
        and position.priority > candidate_priority
    ]
    if not targets or fill_bars is None or ts_ms is None:
        return False
    if str(candidate.get("assetClass", "crypto")) != "crypto":
        return False
    if not all(position.symbol in fill_bars and float(fill_bars[position.symbol].open) > 0 for position in targets):
        return False
    requested = float(candidate.get("requestedGross", 0.0))
    released = sum(position.gross for position in targets)
    if (requested <= 0 or
        _open_gross(state, "crypto") - released + requested > state.crypto_gross_cap + 1e-12 or
        _open_gross(state) - released + requested > state.total_gross_cap + 1e-12):
        return False
    for position in targets:
        before_cash = state.cash
        bar = fill_bars[position.symbol]
        exit_price = _slip(float(bar.open), position.side, slippage_bps, False)
        exit_fee = abs(exit_price * position.qty) * fee_rate
        funding_cash = _funding_cash(funding or [], position, ts_ms) * funding_multiplier
        settle_exit(state, position, {
            "exitPrice": exit_price, "qty": position.qty,
            "fee": exit_fee, "funding": funding_cash, "exitTs": ts_ms,
        })
        state.events[-1].update({
            "strategy": position.strategy, "symbol": position.symbol,
            "route": position.route, "exitReason": "CORE_PREEMPTION",
            "closed": True, "fillSource": "current-next-bar-open",
        })
        receipt = {
            "positionId": position.position_id, "releasedGross": position.gross,
            "reason": "CORE_PREEMPTION", "exitPrice": exit_price,
            "pnlNet": state.cash - before_cash, "fee": exit_fee,
            "funding": funding_cash, "exitTs": ts_ms,
        }
        state.preemptions.append(receipt)
    return True


def settle_exit(state: PortfolioState, position: Position, fill: dict[str, Any]) -> None:
    if position.position_id not in state.positions:
        return
    old_qty = position.qty
    fill_qty = min(float(fill["qty"]), old_qty)
    if fill_qty <= 0:
        return
    exit_price = float(fill["exitPrice"])
    direction = 1.0 if position.side in ("LONG", "L") else -1.0
    pnl = (exit_price - position.entry_price) * fill_qty * direction
    fee = float(fill.get("fee", 0.0))
    funding = float(fill.get("funding", 0.0))
    state.cash += pnl - fee + funding
    state.realized_pnl += pnl - fee + funding
    state.fees += fee
    state.funding += funding
    state.events.append({"type": "EXIT", "positionId": position.position_id, "qty": fill_qty, "pnl": pnl, "fee": fee, "funding": funding, "exitTs": fill.get("exitTs")})
    remaining = old_qty - fill_qty
    if remaining <= 1e-12:
        state.positions.pop(position.position_id, None)
    else:
        position.qty = remaining
        position.notional = position.entry_price * remaining
        position.gross *= remaining / old_qty


def _optional_float(candidate: dict[str, Any], *keys: str) -> float | None:
    for key in keys:
        if candidate.get(key) is not None:
            return float(candidate[key])
    return None


def _position_equity(state: PortfolioState, marks: dict[str, float]) -> float:
    equity = state.cash
    for position in state.positions.values():
        mark = marks.get(position.symbol, position.entry_price)
        direction = 1.0 if position.side in ("LONG", "L") else -1.0
        equity += (mark - position.entry_price) * position.qty * direction
    return equity


def _all_bars(raw_bundle: dict[str, Any]) -> dict[str, dict[int, Any]]:
    result: dict[str, dict[int, Any]] = {}
    for source_name in ("bars", "stock_bars"):
        for symbol, rows in raw_bundle.get(source_name, {}).items():
            for row in rows:
                try:
                    bar = coerce_bar(row)
                except (KeyError, TypeError, ValueError):
                    continue
                result.setdefault(symbol, {})[bar.ts_ms] = bar
    return result


def _all_funding(raw_bundle: dict[str, Any]) -> list[Funding]:
    raw = raw_bundle.get("funding", [])
    if isinstance(raw, dict):
        raw = [item for rows in raw.values() for item in rows]
    result: list[Funding] = []
    for row in raw:
        try:
            result.append(coerce_funding(row))
        except (KeyError, TypeError, ValueError):
            continue
    return sorted(result, key=lambda item: (item.ts_ms, item.symbol))


def _funding_cash(funding: list[Funding], position: Position, exit_ts: int) -> float:
    direction = 1.0 if position.side in ("LONG", "L") else -1.0
    total = 0.0
    for item in funding:
        if item.symbol == position.symbol and position.entry_ts < item.ts_ms <= exit_ts:
            total += -direction * position.notional * float(item.rate)
    return total


def _slip(price: float, side: str, bps: float, is_entry: bool) -> float:
    direction = 1.0 if side in ("LONG", "L") else -1.0
    signed = direction if is_entry else -direction
    return price * (1.0 + signed * bps / 10_000.0)


def _exit_for_bar(position: Position, bar: Any, ts_ms: int) -> tuple[str, float] | None:
    direction = 1.0 if position.side in ("LONG", "L") else -1.0
    # A profit floor may arm only after the previous bar has closed; intrabar
    # trigger-and-stop ordering is unknowable from OHLC. Never use that
    # same bar's high to retroactively arm a stop at its low.
    if position.profit_floor_armed and position.profit_floor_stop_pct is not None:
        floor = position.entry_price * (1.0 + direction * position.profit_floor_stop_pct)
        if direction > 0 and bar.open <= floor:
            return "PROFIT_FLOOR_GAP", bar.open
        if direction < 0 and bar.open >= floor:
            return "PROFIT_FLOOR_GAP", bar.open
        if (direction > 0 and bar.low <= floor) or (direction < 0 and bar.high >= floor):
            return "PROFIT_FLOOR", floor
    if position.hard_stop_pct is not None:
        stop = position.entry_price * (1.0 - direction * position.hard_stop_pct)
        if direction > 0 and bar.open <= stop:
            return "HARD_STOP_GAP", bar.open
        if direction < 0 and bar.open >= stop:
            return "HARD_STOP_GAP", bar.open
        if (direction > 0 and bar.low <= stop) or (direction < 0 and bar.high >= stop):
            return "HARD_STOP", stop
    if position.entry_ts and ts_ms - position.entry_ts >= position.max_hold_hours * 3_600_000:
        return "MAX_HOLD", bar.open
    if position.take_profit_pct is not None:
        target = position.entry_price * (1.0 + direction * position.take_profit_pct)
        if (direction > 0 and bar.high >= target) or (direction < 0 and bar.low <= target):
            return "TAKE_PROFIT", target
    return None


def run_replay(
    mode: str,
    raw_bundle: dict[str, Any],
    candidates: list[dict[str, Any]],
    capital: CapitalContract,
    *,
    fee_rate: float = 0.0006,
    funding_per_day: float = 0.0,
    slippage_bps: float = 0.0,
    funding_multiplier: float = 1.0,
    pengu_variant: str = "Q60_DD170_H72",
) -> dict[str, Any]:
    """Independent research replay, not an exchange or Production parity model.

    Each UTC bar: deposits -> opening gap/hold exits -> NEXT-bar opening
    entries and accounted preemptions -> intrabar stop/TP (stop first) ->
    close-only profit-floor arming -> mark-to-market equity. No later bar
    can affect a fill at this bar's open.
    """
    if min(fee_rate, slippage_bps, funding_multiplier) < 0:
        raise ValueError("NEGATIVE_COST_ASSUMPTION")
    bars = _all_bars(raw_bundle)
    funding = _all_funding(raw_bundle)
    state = PortfolioState(cash=0.0)
    normalized: list[dict[str, Any]] = []
    for candidate in candidates:
        item = dict(candidate)
        item.setdefault("entryTs", item.get("signalTs", 0))
        normalized.append(item)
    normalized.sort(key=lambda item: (
        int(item.get("entryTs", 0)), int(item.get("priority", 2)),
        int(item.get("signalTs", 0)), str(item.get("positionId", "")),
    ))
    deposits = [{"ts_ms": capital.start_ts_ms, "amount": capital.initial}]
    deposits.extend(
        {"ts_ms": _month_add(capital.start_ts_ms, month), "amount": capital.monthly}
        for month in range(1, capital.months + 1)
    )
    timeline = {item["ts_ms"] for item in deposits}
    timeline.update(bar.ts_ms for symbol_bars in bars.values() for bar in symbol_bars.values())
    timeline.update(int(item.get("entryTs", 0)) for item in normalized if int(item.get("entryTs", 0)) > 0)
    deposit_index = 0
    candidate_index = 0
    pengu_state: dict[str, Any] = {
        "startingEquity": capital.initial,
        "realizedEquity": capital.initial,
        "peakRealizedEquity": capital.initial,
        "routeQuarantineUntil": {},
    }
    accepted_entries = rejected_entries = closed_trades = 0
    marks: dict[str, float] = {}

    def close_position(position: Position, price: float, ts: int, reason: str) -> None:
        nonlocal closed_trades, pengu_state
        exit_price = _slip(price, position.side, slippage_bps, False)
        fee = abs(exit_price * position.qty) * fee_rate
        cash_funding = _funding_cash(funding, position, ts) * funding_multiplier
        if funding_per_day and position.entry_ts:
            days = max(0.0, (ts - position.entry_ts) / 86_400_000.0)
            direction = 1.0 if position.side in ("LONG", "L") else -1.0
            cash_funding += -direction * position.notional * funding_per_day * days
        before = len(state.events)
        settle_exit(state, position, {
            "exitPrice": exit_price, "qty": position.qty,
            "fee": fee, "funding": cash_funding, "exitTs": ts,
        })
        if len(state.events) == before:
            return
        event = state.events[-1]
        event.update({
            "strategy": position.strategy, "route": position.route,
            "symbol": position.symbol, "exitReason": reason, "closed": True,
        })
        closed_trades += 1
        if pengu_variant == "Q60_DD170_H72" and position.strategy.startswith("PENGU"):
            pengu_state = apply_pengu_q60_dd17_h72(pengu_state, {
                "accepted": True, "filled": True, "closed": True,
                "pnl": event["pnl"] - event["fee"] + event["funding"],
                "exitTs": ts, "exitReason": reason, "route": position.route or "UNKNOWN",
            })

    for ts_ms in sorted(timeline):
        while deposit_index < len(deposits) and deposits[deposit_index]["ts_ms"] <= ts_ms:
            deposit = deposits[deposit_index]
            state.cash += float(deposit["amount"])
            state.events.append({"type": "DEPOSIT", **deposit})
            deposit_index += 1

        this_bar = {symbol: rows[ts_ms] for symbol, rows in bars.items() if ts_ms in rows}
        open_marks = dict(marks)
        open_marks.update({symbol: bar.open for symbol, bar in this_bar.items()})

        # Only today's OPEN is available before next-bar entries. A stop or
        # max-hold due at that opening releases its gross before reservations.
        for position in list(state.positions.values()):
            bar = this_bar.get(position.symbol)
            if bar is None:
                continue
            direction = 1.0 if position.side in ("LONG", "L") else -1.0
            opened_exit: tuple[str, float] | None = None
            if position.profit_floor_armed and position.profit_floor_stop_pct is not None:
                floor = position.entry_price * (1 + direction * position.profit_floor_stop_pct)
                if (direction > 0 and bar.open <= floor) or (direction < 0 and bar.open >= floor):
                    opened_exit = ("PROFIT_FLOOR_GAP", bar.open)
            if opened_exit is None and position.hard_stop_pct is not None:
                stop = position.entry_price * (1 - direction * position.hard_stop_pct)
                if (direction > 0 and bar.open <= stop) or (direction < 0 and bar.open >= stop):
                    opened_exit = ("HARD_STOP_GAP", bar.open)
            if opened_exit is None and position.entry_ts and ts_ms - position.entry_ts >= position.max_hold_hours * 3_600_000:
                opened_exit = ("MAX_HOLD", bar.open)
            if opened_exit:
                close_position(position, opened_exit[1], ts_ms, opened_exit[0])

        while candidate_index < len(normalized) and int(normalized[candidate_index].get("entryTs", 0)) == ts_ms:
            candidate = dict(normalized[candidate_index])
            candidate_index += 1
            ident = str(candidate.get("strategy", candidate.get("strategyId", "")))
            requested = float(candidate.get("acceptedGross", candidate.get("requestedGross", 0.0)))
            candidate["requestedGross"] = requested
            candidate["assetClass"] = str(candidate.get(
                "assetClass", "stock" if candidate.get("signalFamily") in ("V11", "V50") else "crypto",
            ))
            if int(candidate.get("signalTs", 0)) >= ts_ms or int(candidate.get("featureSourceTs", candidate.get("signalTs", 0))) >= ts_ms:
                reason = "FUTURE_OR_SAME_BAR_SIGNAL"
            elif not candidate.get("accepted", True) or requested <= 0:
                reason = candidate.get("rejectionReason") or "CANDIDATE_REJECTED"
            elif ident.startswith("PENGU") and pengu_variant == "Q60_DD170_H72" and (
                ts_ms < int(pengu_state.get("routeQuarantineUntil", {}).get(str(candidate.get("route", "")), 0))
                or ts_ms < int(pengu_state.get("governorHoldUntil", 0))
            ):
                reason = "PENGU_Q60_DD17_H72"
            else:
                reason = None
            if reason is None:
                max_positions = (
                    int(candidate.get("maximumPositions", 1)) if ident.startswith("QUALITY102")
                    else 3 if ident.startswith("V12")
                    else 1 if ident.startswith(("FET", "PENGU")) else 2
                )
                same_logic = sum(1 for p in state.positions.values() if p.strategy == ident)
                if same_logic >= max_positions:
                    reason = "STRATEGY_POSITION_CAP"
            bar = this_bar.get(str(candidate.get("symbol", "")))
            if reason is None and bar is None:
                reason = "MISSING_ENTRY_BAR"
            if reason is None and _position_equity(state, open_marks) <= 0:
                reason = "NON_POSITIVE_EQUITY"
            if reason is not None:
                rejected_entries += 1
                state.events.append({
                    "type": "REJECT", "positionId": candidate.get("positionId"),
                    "reason": reason, "entryTs": ts_ms, "strategy": ident,
                })
                continue
            reservation = reserve_entry(state, candidate)
            if (not reservation.accepted
                and reservation.reason in ("CRYPTO_GROSS_CAP", "TOTAL_GROSS_CAP")
                and int(candidate.get("priority", 2)) < 3):
                preemptions_before = len(state.preemptions)
                if preempt_fet(
                    state, candidate, fill_bars=this_bar, ts_ms=ts_ms,
                    fee_rate=fee_rate, slippage_bps=slippage_bps,
                    funding=funding, funding_multiplier=funding_multiplier,
                ):
                    closed_trades += len(state.preemptions) - preemptions_before
                    reservation = reserve_entry(state, candidate)
            if not reservation.accepted:
                rejected_entries += 1
                state.events.append({
                    "type": "REJECT", "positionId": candidate.get("positionId"),
                    "reason": reservation.reason, "entryTs": ts_ms, "strategy": ident,
                })
                continue
            entry_price = _slip(float(bar.open), str(candidate.get("side", "LONG")), slippage_bps, True)
            equity = _position_equity(state, open_marks)
            qty = equity * reservation.reserved_gross / entry_price if entry_price > 0 else 0
            if qty <= 0:
                state.pending_reservations.pop(str(candidate["positionId"]), None)
                state.pending_asset_classes.pop(str(candidate["positionId"]), None)
                rejected_entries += 1
                state.events.append({
                    "type": "REJECT", "positionId": candidate.get("positionId"),
                    "reason": "NON_POSITIVE_QTY", "entryTs": ts_ms, "strategy": ident,
                })
                continue
            position = commit_entry(state, candidate, entry_price, qty)
            entry_fee = abs(entry_price * qty) * fee_rate
            state.cash -= entry_fee
            state.fees += entry_fee
            state.events.append({
                "type": "ENTRY", "positionId": position.position_id,
                "strategy": position.strategy, "route": position.route,
                "symbol": position.symbol, "side": position.side,
                "qty": qty, "gross": position.gross, "entryPrice": entry_price,
                "entryTs": ts_ms, "fee": entry_fee, "accepted": True, "filled": True,
                "fillSource": "next-bar-open",
            })
            accepted_entries += 1

        # This bar's high/low becomes known only AFTER its opening fills.
        # Stop wins an OHLC stop/TP collision (conservative). A profit floor
        # arms at the CLOSE and cannot fill retroactively in the same bar.
        for position in list(state.positions.values()):
            bar = this_bar.get(position.symbol)
            if bar is None:
                continue
            exit_decision = _exit_for_bar(position, bar, ts_ms)
            if exit_decision is not None:
                close_position(position, exit_decision[1], ts_ms, exit_decision[0])
                continue
            if (not position.profit_floor_armed
                and position.profit_floor_trigger_pct is not None
                and position.profit_floor_stop_pct is not None):
                direction = 1.0 if position.side in ("LONG", "L") else -1.0
                trigger = position.entry_price * (1 + direction * position.profit_floor_trigger_pct)
                if (direction > 0 and bar.high >= trigger) or (direction < 0 and bar.low <= trigger):
                    position.profit_floor_armed = True
                    state.events.append({
                        "type": "PROFIT_FLOOR_ARMED", "positionId": position.position_id,
                        "strategy": position.strategy, "ts_ms": ts_ms + 3_600_000,
                    })

        marks.update({symbol: bar.close for symbol, bar in this_bar.items()})
        state.equity_timeline.append({
            "ts_ms": ts_ms, "equity": _position_equity(state, marks),
            "cryptoGross": _open_gross(state, "crypto"),
            "stockGross": _open_gross(state, "stock"),
            "totalGross": _open_gross(state),
        })

    if timeline:
        final_ts = max(timeline)
        for position in list(state.positions.values()):
            rows = bars.get(position.symbol, {})
            known = [ts for ts in rows if ts <= final_ts]
            if not known:
                continue
            last_ts = max(known)
            close_position(position, rows[last_ts].close, final_ts, "END_OF_TEST")
        if state.equity_timeline:
            last = state.equity_timeline[-1]
            last.update({
                "equity": _position_equity(state, marks),
                "cryptoGross": _open_gross(state, "crypto"),
                "stockGross": _open_gross(state, "stock"),
                "totalGross": _open_gross(state),
            })
    final_equity = _position_equity(state, marks)
    return {
        "mode": mode,
        "contributionCount": len(deposits),
        "totalContributed": sum(item["amount"] for item in deposits),
        "candidateCount": len(normalized),
        "acceptedEntryCount": accepted_entries,
        "rejectedEntryCount": rejected_entries,
        "tradeCount": closed_trades,
        "events": list(state.events),
        "equityTimeline": list(state.equity_timeline),
        "pendingReservations": dict(state.pending_reservations),
        "realizedPnl": state.realized_pnl,
        "fees": state.fees,
        "funding": state.funding,
        "finalEquity": final_equity,
        "penguState": pengu_state,
        "preemptions": list(state.preemptions),
        "stressAssumptions": {
            "feeRate": fee_rate, "slippageBps": slippage_bps,
            "fundingMultiplier": funding_multiplier,
            "fundingPerDay": funding_per_day,
            "classification": "ILLUSTRATIVE_INDEPENDENT_NOT_FORMAL",
        },
        "source": "raw-bars-replay",
    }


def _month_add(ts_ms: int, months: int) -> int:
    value = datetime.fromtimestamp(ts_ms / 1000, timezone.utc)
    month_index = value.month - 1 + months
    year = value.year + month_index // 12
    month = month_index % 12 + 1
    day = min(value.day, calendar.monthrange(year, month)[1])
    result = value.replace(year=year, month=month, day=day)
    return int(result.timestamp() * 1000)


def _apply_deposits(state: PortfolioState, capital: CapitalContract) -> list[dict[str, Any]]:
    deposits = [{"ts_ms": capital.start_ts_ms, "amount": capital.initial}]
    deposits.extend({"ts_ms": _month_add(capital.start_ts_ms, index), "amount": capital.monthly} for index in range(1, capital.months + 1))
    # Deposits are applied by timestamp in run_replay.  Keep this helper
    # side-effect free so callers cannot accidentally front-load future cash.
    return deposits


def _candidate_sets(raw_bundle: dict[str, Any], mode: str) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    candidates.extend(generate_v12_candidates(raw_bundle.get("bars", {}), raw_bundle.get("contracts", {}).get("V12", {}), mode))
    candidates.extend(generate_pengu_candidates(raw_bundle.get("bars", {}), raw_bundle.get("funding", []), mode))
    candidates.extend(generate_q102_candidates(raw_bundle, mode))
    candidates.extend(generate_fet_candidates(raw_bundle, mode))
    candidates.extend(generate_v52_candidates(raw_bundle.get("stock_bars", {}), mode))
    return sorted(candidates, key=lambda candidate: (int(candidate.get("signalTs", 0)), str(candidate.get("strategyId", candidate.get("strategy", ""))), str(candidate.get("positionId", ""))))


def run_integrated(mode: str, raw_bundle: dict[str, Any], capital: CapitalContract) -> dict[str, Any]:
    candidates = _candidate_sets(raw_bundle, mode)
    result = run_replay(mode, raw_bundle, candidates, capital, pengu_variant=str(raw_bundle.get("penguVariant", "Q60_DD170_H72")))
    result["acceptedCandidateCount"] = result["acceptedEntryCount"]
    result["rejectedCandidateCount"] = result["rejectedEntryCount"]
    result["source"] = "raw-bars-and-stock-bars-replay"
    return result


def build_source_manifest(bundle: dict[str, Any], result: dict[str, Any]) -> dict[str, Any]:
    encoded = json.dumps(bundle, sort_keys=True, default=lambda value: value.to_dict(), separators=(",", ":"))
    result_encoded = json.dumps(result, sort_keys=True, separators=(",", ":"))
    return {"bundleSha256": hashlib.sha256(encoded.encode()).hexdigest(), "resultSha256": hashlib.sha256(result_encoded.encode()).hexdigest(), "source": result.get("source")}
