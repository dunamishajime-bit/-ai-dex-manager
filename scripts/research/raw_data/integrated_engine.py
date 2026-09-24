from __future__ import annotations

import calendar
import hashlib
import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from .fet_rebuild import generate_fet_candidates
from .pengu_rebuild import generate_pengu_candidates
from .q102_rebuild import generate_q102_candidates
from .v12_rebuild import generate_v12_candidates
from .v52_rebuild import generate_v52_candidates


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


def _open_gross(state: PortfolioState, asset_class: str | None = None) -> float:
    position_gross = sum(position.gross for position in state.positions.values())
    pending_gross = sum(state.pending_reservations.values())
    if asset_class is None:
        return position_gross + pending_gross
    return sum(position.gross for position in state.positions.values() if ("stock" if position.symbol.startswith("STOCK") else "crypto") == asset_class) + sum(state.pending_reservations.values())


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
    return ReservationResult(True, requested)


def commit_entry(state: PortfolioState, candidate: dict[str, Any], entry_price: float, qty: float = 1.0) -> Position:
    reservation = state.pending_reservations.pop(str(candidate["positionId"]), None)
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
    )
    state.positions[position.position_id] = position
    return position


def preempt_fet(state: PortfolioState, candidate: dict[str, Any]) -> bool:
    candidate_priority = int(candidate.get("priority", 2))
    targets = [position for position in state.positions.values() if position.preemptible and position.strategy.startswith("FET") and position.priority > candidate_priority]
    if not targets:
        return False
    for position in targets:
        del state.positions[position.position_id]
        state.preemptions.append({"positionId": position.position_id, "releasedGross": position.gross, "reason": "CORE_PREEMPTION"})
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
    state.cash = sum(item["amount"] for item in deposits)
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
    state = PortfolioState(cash=capital.initial)
    deposits = _apply_deposits(state, capital)
    accepted = 0
    rejected = 0
    for candidate in _candidate_sets(raw_bundle, mode):
        if not candidate.get("accepted", True) or float(candidate.get("acceptedGross", candidate.get("requestedGross", 0.0))) <= 0:
            rejected += 1
            continue
        candidate = dict(candidate)
        candidate.setdefault("assetClass", "stock" if candidate.get("signalFamily") in ("V11", "V50") else "crypto")
        reservation = reserve_entry(state, candidate)
        if reservation.accepted:
            accepted += 1
        else:
            rejected += 1
    return {
        "mode": mode,
        "contributionCount": len(deposits),
        "totalContributed": sum(item["amount"] for item in deposits),
        "acceptedCandidateCount": accepted,
        "rejectedCandidateCount": rejected,
        "events": list(state.events),
        "pendingReservations": dict(state.pending_reservations),
        "realizedPnl": state.realized_pnl,
        "fees": state.fees,
        "funding": state.funding,
        "source": "raw-bars-and-stock-bars",
    }


def build_source_manifest(bundle: dict[str, Any], result: dict[str, Any]) -> dict[str, Any]:
    encoded = json.dumps(bundle, sort_keys=True, default=lambda value: value.to_dict(), separators=(",", ":"))
    result_encoded = json.dumps(result, sort_keys=True, separators=(",", ":"))
    return {"bundleSha256": hashlib.sha256(encoded.encode()).hexdigest(), "resultSha256": hashlib.sha256(result_encoded.encode()).hexdigest(), "source": result.get("source")}

