"""Fail-closed, deterministic event kernel for Codex's canonical BT implementation.

IMPORTANT: the synthetic kernel validates event ordering, gross reservations,
actual fills and PENGU Q60/DD17 mechanics. It DOES NOT supply original Top3,
FET, Q102 or V52 historical causal ledgers, original allocation precedence,
source-specific funding or the verified 7.41e8 JPY anchor. The formal CLI
refuses to report a comparison until the evidence manifest is complete.
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Mapping, Sequence

STRATEGIES = frozenset({"V12", "PENGU", "FET", "Q102", "V52"})
KINDS = frozenset({"DEPOSIT", "RESERVE", "CANCEL", "ENTRY", "EXIT", "MARK", "FUNDING"})
PHASES = frozenset({"DEPOSIT", "SETTLE", "RISK", "CANDIDATE"})
D = Decimal
ZERO = D("0")
ONE = D("1")


class ReplayError(ValueError):
    """The requested replay is not sufficiently specified or violates a contract."""


def dec(value: Any, name: str) -> Decimal:
    if isinstance(value, bool) or value is None:
        raise ReplayError(f"INVALID_DECIMAL:{name}")
    try:
        result = D(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise ReplayError(f"INVALID_DECIMAL:{name}") from exc
    if not result.is_finite():
        raise ReplayError(f"NONFINITE_DECIMAL:{name}")
    return result


def instant(text: str) -> datetime:
    if not isinstance(text, str):
        raise ReplayError("TIMESTAMP_NOT_STRING")
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ReplayError(f"BAD_TIMESTAMP:{text}") from exc
    if parsed.tzinfo is None or parsed.utcoffset() != timedelta(0):
        raise ReplayError(f"TIMESTAMP_NOT_UTC:{text}")
    return parsed.astimezone(timezone.utc)


def required_anchor_evidence(manifest: Mapping[str, Any]) -> list[str]:
    """Reject reference values posing as proof of their underlying source."""
    required = (
        "original_run_id", "original_source_sha", "original_engine_sha",
        "formal_start_utc", "formal_end_utc", "market_data_sha256",
        "deposits_verified", "cost_model_verified", "tie_break_verified",
        "trade_count_definition_verified", "baseline_ledgers_sha256",
        "original_allocator_sha256", "fet_preemption_verified",
        "q102_governor_verified", "v52_calendar_verified",
    )
    missing = []
    for key in required:
        value = manifest.get(key)
        if value is None or value is False or value == "" or value == "UNVERIFIED":
            missing.append(key)
    strategy_shas = manifest.get("strategy_source_shas")
    for key in ("V12", "PENGU", "FET", "Q102", "V52"):
        if not isinstance(strategy_shas, dict) or not strategy_shas.get(key):
            missing.append(f"strategy_source_shas.{key}")
    if not missing:
        if instant(manifest["formal_start_utc"]) >= instant(manifest["formal_end_utc"]):
            raise ReplayError("INVALID_FORMAL_INTERVAL")
    return missing


@dataclass(slots=True)
class Position:
    id: str
    strategy: str
    symbol: str
    route: str
    side: int
    entry_price: Decimal
    notional: Decimal
    remaining: Decimal
    entry_equity: Decimal
    original_gross: Decimal
    leverage: Decimal
    accrued_realized: Decimal = ZERO


@dataclass(slots=True)
class Reservation:
    id: str
    strategy: str
    gross: Decimal


@dataclass(slots=True)
class State:
    cash: Decimal
    marks: dict[str, Decimal] = field(default_factory=dict)
    positions: dict[str, Position] = field(default_factory=dict)
    reservations: dict[str, Reservation] = field(default_factory=dict)
    counts: Counter = field(default_factory=Counter)
    rejected: list[dict[str, str]] = field(default_factory=list)
    journal: list[dict[str, str]] = field(default_factory=list)
    route_quarantine_until: dict[str, datetime] = field(default_factory=dict)
    pengu_closed_equity: Decimal = ONE
    pengu_peak: Decimal = ONE
    pengu_pause_until: datetime | None = None

    def equity(self) -> Decimal:
        result = self.cash
        for p in self.positions.values():
            mark = self.marks.get(p.symbol, p.entry_price)
            result += p.notional * p.remaining * D(p.side) * (mark / p.entry_price - ONE)
        if result <= ZERO:
            raise ReplayError("NONPOSITIVE_EQUITY")
        return result

    def used_gross(self, classification: str | None = None) -> Decimal:
        gross = sum((p.original_gross * p.remaining for p in self.positions.values()
                     if classification is None or _class(p.strategy) == classification), ZERO)
        gross += sum((r.gross for r in self.reservations.values()
                      if classification is None or _class(r.strategy) == classification), ZERO)
        return gross


def _class(strategy: str) -> str:
    return "STOCK" if strategy == "V52" else "CRYPTO"


def _ident(event: Mapping[str, Any], key: str) -> str:
    value = event.get(key)
    if not isinstance(value, str) or not value:
        raise ReplayError(f"MISSING_{key.upper()}")
    return value


def replay_synthetic(events: Sequence[Mapping[str, Any]], policy: Mapping[str, Any]) -> dict[str, Any]:
    """Test-only event processing; never certify this as the 2026 formal engine.

    Events require explicit unique IDs, UTC timestamps, sequential tie-break
    'seq' at equal timestamps, kind and source-strategy fields. The selected
    candidate enforces PENGU Gross1/Q60/DD17/H72 on *actual accepted fills*.
    Caller must supply preemption and source-specific causal decisions as
    explicit documented event records; absent data is NEVER fabricated.
    """
    capital = dec(policy.get("initial_capital"), "initial_capital")
    if capital <= ZERO:
        raise ReplayError("INVALID_INITIAL_CAPITAL")
    crypto_cap = dec(policy.get("crypto_gross_cap"), "crypto_gross_cap")
    stock_cap = dec(policy.get("stock_gross_cap"), "stock_gross_cap")
    total_cap = dec(policy.get("total_gross_cap"), "total_gross_cap")
    if min(crypto_cap, stock_cap, total_cap) <= ZERO:
        raise ReplayError("INVALID_CAP")
    flat_peng = policy.get("pengu_variant") == "Q60_DD170_H72"
    state = State(cash=capital)
    seen: set[str] = set()
    items = []
    for event in events:
        if not isinstance(event, Mapping):
            raise ReplayError("EVENT_NOT_OBJECT")
        eid = _ident(event, "event_id")
        if eid in seen:
            raise ReplayError(f"DUPLICATE_EVENT_ID:{eid}")
        seen.add(eid)
        ts = instant(_ident(event, "ts"))
        seq = event.get("seq")
        if isinstance(seq, bool) or not isinstance(seq, int) or seq < 0:
            raise ReplayError(f"INVALID_EVENT_SEQ:{eid}")
        kind = _ident(event, "kind")
        if kind not in KINDS:
            raise ReplayError(f"UNKNOWN_KIND:{kind}")
        items.append((ts, seq, eid, event))
    items.sort(key=lambda x: (x[0], x[1], x[2]))
    for ts, _seq, eid, e in items:
        kind = e["kind"]
        strategy = e.get("strategy")
        if kind not in {"DEPOSIT", "MARK"} and strategy not in STRATEGIES:
            raise ReplayError(f"UNKNOWN_STRATEGY:{eid}")
        if kind == "DEPOSIT":
            amount = dec(e.get("amount"), "deposit_amount")
            if amount <= ZERO:
                raise ReplayError("INVALID_DEPOSIT")
            state.cash += amount
        elif kind == "MARK":
            symbol = _ident(e, "symbol")
            px = dec(e.get("price"), "mark_price")
            if px <= ZERO:
                raise ReplayError("INVALID_MARK_PRICE")
            state.marks[symbol] = px
        elif kind == "FUNDING":
            # amount is signed JPY; every funding event must be source-backed.
            state.cash += dec(e.get("amount"), "funding_amount")
        elif kind == "RESERVE":
            rid = _ident(e, "reservation_id")
            if rid in state.reservations:
                raise ReplayError(f"DUPLICATE_RESERVATION:{rid}")
            amount = dec(e.get("gross"), "reserve_gross")
            if amount <= ZERO:
                raise ReplayError("INVALID_RESERVE")
            if (state.used_gross(_class(strategy)) + amount >
                    (stock_cap if _class(strategy) == "STOCK" else crypto_cap)
                    or state.used_gross() + amount > total_cap):
                state.rejected.append({"event_id": eid, "reason": "RESERVATION_CAP"})
            else:
                state.reservations[rid] = Reservation(rid, strategy, amount)
        elif kind == "CANCEL":
            rid = _ident(e, "reservation_id")
            if rid not in state.reservations:
                raise ReplayError(f"UNKNOWN_RESERVATION:{rid}")
            del state.reservations[rid]
        elif kind == "ENTRY":
            pid = _ident(e, "position_id")
            symbol = _ident(e, "symbol")
            route = _ident(e, "route")
            if pid in state.positions:
                raise ReplayError(f"DUPLICATE_POSITION:{pid}")
            gross = dec(e.get("gross"), "entry_gross")
            price = dec(e.get("price"), "entry_price")
            lev = dec(e.get("leverage"), "leverage")
            fee_rate = dec(e.get("fee_rate", "0"), "entry_fee_rate")
            side = e.get("side")
            if gross <= ZERO or price <= ZERO or lev < ONE or not ZERO <= fee_rate < ONE or side not in (1, -1) or isinstance(side, bool):
                raise ReplayError(f"INVALID_ENTRY:{eid}")
            reservation_id = e.get("reservation_id")
            reserved = ZERO
            if reservation_id is not None:
                reservation = state.reservations.get(reservation_id)
                if not reservation or reservation.strategy != strategy:
                    raise ReplayError(f"INVALID_ENTRY_RESERVATION:{eid}")
                reserved = reservation.gross
                if reserved != gross:
                    raise ReplayError(f"RESERVATION_GROSS_MISMATCH:{eid}")
            reason = None
            if flat_peng and strategy == "PENGU":
                if gross != ONE:
                    raise ReplayError(f"PENGU_NOT_FLAT_GROSS1:{eid}")
                if ts < state.route_quarantine_until.get(route, datetime.min.replace(tzinfo=timezone.utc)):
                    reason = "PENGU_SAME_ROUTE_Q60"
                elif state.pengu_pause_until is not None and ts < state.pengu_pause_until:
                    reason = "PENGU_REALIZED_DD_H72"
                elif any(p.strategy == "PENGU" for p in state.positions.values()):
                    reason = "PENGU_SLOT_OCCUPIED"
            if reason is None:
                incremental = gross - reserved
                group = _class(strategy)
                cap = stock_cap if group == "STOCK" else crypto_cap
                if (state.used_gross(group) + incremental > cap or
                        state.used_gross() + incremental > total_cap):
                    reason = "SHARED_GROSS_CAP"
            if reason is not None:
                state.rejected.append({"event_id": eid, "reason": reason})
                # Rejected intent does not consume a reservation or update
                # PENGU realized equity, quarantine, or executed-trade count.
            else:
                equity = state.equity()
                notional = equity * gross
                if reservation_id is not None:
                    del state.reservations[reservation_id]
                state.cash -= notional * fee_rate
                state.positions[pid] = Position(pid, strategy, symbol, route, int(side), price, notional,
                                                ONE, equity, gross, lev)
                state.marks.setdefault(symbol, price)
                state.counts[f"{strategy}.entries"] += 1
        elif kind == "EXIT":
            pid = _ident(e, "position_id")
            p = state.positions.get(pid)
            if p is None or p.strategy != strategy:
                raise ReplayError(f"UNKNOWN_POSITION:{pid}")
            fraction = dec(e.get("fraction", "1"), "exit_fraction")
            price = dec(e.get("price"), "exit_price")
            fee_rate = dec(e.get("fee_rate", "0"), "exit_fee_rate")
            reason = _ident(e, "reason")
            if fraction <= ZERO or fraction > p.remaining or price <= ZERO or not ZERO <= fee_rate < ONE:
                raise ReplayError(f"INVALID_EXIT:{eid}")
            pnl = p.notional * fraction * D(p.side) * (price / p.entry_price - ONE)
            fee = p.notional * fraction * fee_rate
            state.cash += pnl - fee
            p.accrued_realized += pnl - fee
            p.remaining -= fraction
            state.marks[p.symbol] = price
            if p.remaining == ZERO:
                del state.positions[pid]
                state.counts[f"{p.strategy}.closed"] += 1
                if flat_peng and p.strategy == "PENGU":
                    account_return = p.accrued_realized / p.entry_equity
                    if account_return <= -ONE:
                        raise ReplayError("PENGU_ACCOUNT_RETURN_INVALID")
                    state.pengu_closed_equity *= ONE + account_return
                    state.pengu_peak = max(state.pengu_peak, state.pengu_closed_equity)
                    if reason == "HARD_STOP":
                        state.route_quarantine_until[p.route] = max(
                            state.route_quarantine_until.get(p.route, ts), ts + timedelta(hours=60))
                    dd = ONE - state.pengu_closed_equity / state.pengu_peak
                    if dd >= D("0.17"):
                        state.pengu_pause_until = max(
                            state.pengu_pause_until or ts, ts + timedelta(hours=72))
        state.journal.append({"event_id": eid, "kind": kind, "timestamp": ts.isoformat(),
                              "equity": str(state.equity()),
                              "gross_total": str(state.used_gross()),
                              "gross_crypto": str(state.used_gross("CRYPTO"))})
    return {
        "status": "SYNTHETIC_KERNEL_ONLY_NOT_FORMAL_BT",
        "equity": str(state.equity()),
        "counts": dict(state.counts),
        "rejected": state.rejected,
        "journal": state.journal,
        "open_positions": sorted(state.positions),
        "open_reservations": sorted(state.reservations),
        "pengu_realized_equity": str(state.pengu_closed_equity),
        "pengu_route_quarantine": {k: v.isoformat() for k, v in sorted(state.route_quarantine_until.items())},
        "pengu_pause_until": state.pengu_pause_until.isoformat() if state.pengu_pause_until else None,
    }
