"""Pure, fail-closed final Stable4 new-entry gross decision.

Call under the shared account order lock, after venue size normalization and
immediately before submission. This module performs no I/O or order operations.
The caller must supply fresh signed account/position observations and the shared
pending registry read while holding that same lock. Timestamps are epoch ms.
"""
from __future__ import annotations

import math
import re
from decimal import Decimal, localcontext
from typing import Any, Callable


# Generic classifier classes plus the approved QHV and S34 assets solely for
# account admission accounting. This does not grant strategy eligibility.
_STOCK = frozenset({"AMZN", "META", "MSFT", "NVDA", "TSLA"})
_CRYPTO = frozenset({
    "BTC", "ETH", "BNB", "SOL", "LINK", "AVAX", "DOGE", "INJ", "XRP",
    "ADA", "LTC", "ATOM", "AAVE", "NEAR", "PENGU", "FET", "HYPE", "ZEC",
    "TAO", "TIA", "DOT", "JUP", "RENDER",
    "SUI", "SEI", "APT", "ARB", "OP", "ENA", "ONDO", "FIL", "TRX", "UNI", "LDO",
})
_ACTIVE = frozenset({"PENDING", "SUBMITTED", "UNKNOWN"})


class Stable4EntryGrossRejected(RuntimeError):
    """Typed refusal; callers must not send the candidate after this exception."""

    def __init__(self, code: str, details: Any = None):
        self.code = code
        self.details = details
        super().__init__(f"STABLE4_ENTRY_GROSS_{code}" + (f":{details}" if details is not None else ""))


def _reject(code: str, details: Any = None):
    raise Stable4EntryGrossRejected(code, details)


def _mapping(value: Any, field: str) -> dict:
    if not isinstance(value, dict):
        _reject("PAYLOAD_INVALID", field)
    return value


def _text(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        _reject("IDENTITY_INVALID", field)
    return value.strip()


def _number(value: Any, field: str, minimum: int | None = None, positive: bool = False) -> Decimal:
    if type(value) not in (int, float):
        _reject("NUMERIC_INVALID", field)
    try:
        valid = math.isfinite(value)
    except (OverflowError, ValueError):
        valid = False
    if not valid:
        _reject("NUMERIC_INVALID", field)
    result = Decimal(str(value))
    if (positive and result <= 0) or (minimum is not None and result < minimum):
        _reject("NUMERIC_INVALID", field)
    return result


def _symbol(value: Any) -> str:
    symbol = re.sub(r"[:/_-]", "", _text(value, "symbol").upper())
    return symbol[:-4] if symbol.endswith("USDT") else symbol


def _owner_sleeve(strategy: str) -> str:
    owner = strategy.upper()
    if owner in {"V11_EQ", "V50_POST_OPEN_BASIS", "V52"} or "V52" in owner:
        return "STOCK"
    if owner == "V12" or any(part in owner for part in ("V12_", "PENGU", "FET_BRK48", "QUALITY102")) or owner in {"HYPE_LONG", "ZEC_LONG", "IDLE_PRIORITY_SHORT"}:
        return "CRYPTO"
    _reject("PENDING_OWNER_UNKNOWN", strategy)


def evaluate_stable4_entry_gross(payload: dict, classifier: Callable[[str], str | dict] | None = None) -> dict:
    """Return allowed diagnostics or raise Stable4EntryGrossRejected.

    Numbers must be actual finite int/float values; normalize venue numeric
    strings explicitly at the signed snapshot boundary. Optional ``symbolSleeves``
    metadata or classifier results may classify additional symbols. Known symbol
    classes cannot be overridden. ``ownReservationId`` must identify an active
    same-symbol, same-side registry row; it alone is replaced by the candidate.
    """
    payload = _mapping(payload, "payload")
    now = _number(payload.get("now"), "now", positive=True)
    max_age = _number(payload.get("maxAgeMs", 120000), "maxAgeMs", minimum=0)

    def stamp(value: Any, field: str, fresh: bool = True) -> Decimal:
        try:
            result = _number(value, field, positive=True)
        except Stable4EntryGrossRejected:
            _reject("TIMESTAMP_INVALID", field)
        if result > now or (fresh and now - result > max_age):
            _reject("TIMESTAMP_INVALID", field)
        return result

    metadata = _mapping(payload.get("symbolSleeves", {}), "symbolSleeves")

    def asset(value: Any) -> tuple[str, str]:
        symbol = _symbol(value)
        known = "STOCK" if symbol in _STOCK else "CRYPTO" if symbol in _CRYPTO else None
        supplied = metadata.get(symbol + "USDT", metadata.get(symbol))
        if classifier is not None:
            try:
                classified = classifier(symbol + "USDT")
            except Exception as error:
                _reject("CLASSIFIER_INVALID", str(error))
            if isinstance(classified, dict):
                classified = classified.get("assetClass")
            if supplied is not None and supplied != classified:
                _reject("CLASSIFIER_INVALID", symbol)
            supplied = classified
        if supplied is not None and (not isinstance(supplied, str) or supplied not in {"STOCK", "CRYPTO"}):
            _reject("UNKNOWN_SYMBOL", symbol)
        if known and supplied and supplied != known:
            _reject("CLASSIFIER_INVALID", symbol)
        result = known or supplied
        if result is None:
            _reject("UNKNOWN_SYMBOL", symbol)
        return symbol, result

    account = _mapping(payload.get("account"), "account")
    equity = _number(account.get("equityUsd"), "account.equityUsd", positive=True)
    stamp(account.get("observedAt"), "account.observedAt")
    positions = payload.get("positions")
    if not isinstance(positions, list):
        _reject("PAYLOAD_INVALID", "positions")
    registry = _mapping(payload.get("pendingRegistry"), "pendingRegistry")
    if registry.get("schema") != "disdex-pending-exposure/v1" or not isinstance(registry.get("entries"), list):
        _reject("REGISTRY_INVALID")
    _text(registry.get("accountScope"), "registry.accountScope")
    stamp(registry.get("updatedAt"), "registry.updatedAt")
    candidate = _mapping(payload.get("candidate"), "candidate")
    candidate_symbol, sleeve = asset(candidate.get("symbol"))
    side = _text(candidate.get("side"), "candidate.side").upper()
    if side not in {"LONG", "SHORT"}:
        _reject("CANDIDATE_SIDE_INVALID")
    amount = _number(candidate.get("notionalUsd"), "candidate.notionalUsd", positive=True)
    own = candidate.get("ownReservationId")
    if own is not None:
        own = _text(own, "candidate.ownReservationId")
    # Decimal arithmetic avoids an epsilon that could admit above-cap orders.
    with localcontext() as context:
        context.prec = 768
        marked = {"CRYPTO": Decimal(0), "STOCK": Decimal(0)}
        pending = {"CRYPTO": Decimal(0), "STOCK": Decimal(0)}
        for index, row in enumerate(positions):
            row = _mapping(row, f"positions[{index}]")
            quantity = _number(row.get("quantity"), "position.quantity")
            stamp(row.get("observedAt"), "position.observedAt")
            if quantity == 0:
                continue
            _, category = asset(row.get("symbol"))
            mark = _number(row.get("markPrice"), "position.markPrice", positive=True)
            marked[category] += abs(quantity) * mark
        ids = set()
        own_found = False
        for row in registry["entries"]:
            row = _mapping(row, "pending.entry")
            reservation = _text(row.get("reservationId"), "pending.reservationId")
            if reservation in ids:
                _reject("PENDING_DUPLICATE", reservation)
            ids.add(reservation)
            owner = _owner_sleeve(_text(row.get("strategyId"), "pending.strategyId"))
            symbol, category = asset(row.get("symbol"))
            if row.get("sleeve") != category or owner != category:
                _reject("PENDING_CLASSIFICATION_MISMATCH", reservation)
            status = row.get("status")
            if not isinstance(status, str) or status not in _ACTIVE | {"RELEASED"}:
                _reject("PENDING_STATUS_INVALID", reservation)
            row_side = row.get("side")
            if not isinstance(row_side, str) or row_side not in ({"LONG", "SHORT", "FLAT"} if status == "RELEASED" else {"LONG", "SHORT"}):
                _reject("PENDING_SIDE_INVALID", reservation)
            _number(row.get("gross"), "pending.gross", minimum=0)
            notional = _number(row.get("notionalUsd"), "pending.notionalUsd", minimum=0)
            created = stamp(row.get("createdAt"), "pending.createdAt", fresh=False)
            updated = stamp(row.get("updatedAt"), "pending.updatedAt", fresh=status in _ACTIVE)
            if created > updated:
                _reject("TIMESTAMP_INVALID", "pending.createdAt>updatedAt")
            if reservation == own:
                if status not in _ACTIVE or symbol != candidate_symbol or row_side != side or category != sleeve:
                    _reject("OWN_RESERVATION_MISMATCH", reservation)
                own_found = True
                continue
            if status in _ACTIVE:
                pending[category] += notional
        if own is not None and not own_found:
            _reject("OWN_RESERVATION_MISSING", own)
        projected = {key: marked[key] + pending[key] + (amount if key == sleeve else 0) for key in marked}
        total = projected["CRYPTO"] + projected["STOCK"]
        diagnostics = {
            "allowed": True,
            "candidateSymbol": candidate_symbol + "USDT",
            "candidateSleeve": sleeve,
            "candidateNotionalUsd": float(amount),
            "equityUsd": float(equity),
            "markedNotionalUsd": {key.lower(): float(value) for key, value in marked.items()},
            "pendingNotionalUsd": {key.lower(): float(value) for key, value in pending.items()},
            "projectedGross": {"crypto": float(projected["CRYPTO"] / equity), "stock": float(projected["STOCK"] / equity), "total": float(total / equity)},
            "ownReservationExcluded": own_found,
        }
        for value, cap, code in [(projected["CRYPTO"], Decimal("3"), "CRYPTO_GROSS_CAP"), (projected["STOCK"], Decimal("4"), "STOCK_GROSS_CAP"), (total, Decimal("4.25"), "TOTAL_GROSS_CAP")]:
            if value > cap * equity:
                _reject(code, dict(diagnostics, allowed=False))
        return diagnostics
