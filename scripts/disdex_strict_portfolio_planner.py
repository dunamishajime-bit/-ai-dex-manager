from __future__ import annotations

import math
import os
import json
import hashlib
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping

EPSILON = 1e-9
# 3.0x remains the normal crypto *entry* target. Price/mark-to-market
# movements in EXISTING crypto positions are tolerated up to 3.5x
# without disabling V52's risk snapshots or existing protective exits.
# This value must never be used as a fresh crypto entry budget.
CRYPTO_GROSS_PASSIVE_DRIFT_TOLERANCE = 3.5


@dataclass(frozen=True)
class StrictPortfolioCaps:
    v12_base_gross: float = 2.00
    v12_gross: float = 2.00
    v12_per_position_gross: float = 1.00
    pengu_gross: float = 1.00
    quality102_gross: float = 0.50
    quality102_causal_v1_gross: float = 3.00
    stock_gross: float = 4.00
    stock_slot_gross: float = 2.00
    crypto_gross: float = 3.00
    crypto_gross_existing_max: float = 3.50
    total_gross: float = 4.25


STRICT_CAPS = StrictPortfolioCaps()
QUALITY102_LIVE_SELECTOR_PARITY = False
QUALITY102_LIVE_ENABLED = False
QUALITY102_LIVE_STATUS = "FAIL_CLOSED_SELECTOR_PARITY_UNPROVEN"
QUALITY102_STRATEGY_ID = "QUALITY102_CAUSAL_V1"
QUALITY102_STATE_VERSION = 1
# Q102 makes decisions on confirmed hourly bars.  Cross-sleeve ownership must
# remain fresh for one complete decision interval plus a bounded scheduling
# allowance; 15 minutes made a healthy hourly state deterministically stale.
QUALITY102_STATE_MAX_AGE_MS = 75 * 60_000
_SHA256_RE = re.compile(r"^[0-9a-fA-F]{40}$")


@dataclass(frozen=True)
class Quality102OwnedPosition:
    symbol: str
    side: int
    quantity: float
    entry_price: float
    entry_ts: float
    runtime_commit_sha: str


def _quality102_state_path() -> Path | None:
    for name in ("QUALITY102_CAUSAL_V1_STATE_PATH", "DISDEX_QUALITY102_CAUSAL_V1_STATE_PATH"):
        raw = str(os.environ.get(name) or "").strip()
        if raw:
            return Path(raw).expanduser().resolve()
    return None


def _quality102_finite(value: object, field: str, *, positive: bool = False) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise RuntimeError(f"QUALITY102_STATE_MALFORMED:{field}") from error
    if not math.isfinite(number) or (positive and number <= 0):
        raise RuntimeError(f"QUALITY102_STATE_MALFORMED:{field}")
    return number


def _quality102_object(value: object, field: str) -> dict:
    if not isinstance(value, dict):
        raise RuntimeError(f"QUALITY102_STATE_MALFORMED:{field}")
    return value


def load_quality102_live_state(path: Path | None = None, *, now_ms: float | None = None) -> Quality102OwnedPosition | None:
    """Load only a schema-valid LIVE Q102 state for cross-runner accounting.

    Absence is equivalent to no owned Q102 position. Any present-but-invalid
    file is a hard failure so the base runners cannot trade against an
    ambiguous ownership or gross snapshot.
    """
    resolved = path or _quality102_state_path()
    if resolved is None or not resolved.exists():
        return None
    try:
        raw = json.loads(resolved.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise RuntimeError("QUALITY102_STATE_MALFORMED:json") from error
    root = _quality102_object(raw, "root")
    allowed = {
        "version", "strategyId", "mode", "runtimeCommitSha", "updatedAt",
        "lastProcessedReferenceTs", "lastCompletedIdempotencyKey", "position",
        "pending", "lastReduction", "initialDaemonReconciliation", "lastReconciledAt", "failures",
    }
    if set(root) - allowed:
        raise RuntimeError("QUALITY102_STATE_MALFORMED:unknown_field")
    required = {"version", "strategyId", "mode", "runtimeCommitSha", "updatedAt", "failures"}
    if not required.issubset(root):
        raise RuntimeError("QUALITY102_STATE_MALFORMED:required_field")
    if root.get("version") != QUALITY102_STATE_VERSION or root.get("strategyId") != QUALITY102_STRATEGY_ID or root.get("mode") != "LIVE":
        raise RuntimeError("QUALITY102_STATE_MISMATCH:identity")
    runtime_sha = str(root.get("runtimeCommitSha") or "")
    if not _SHA256_RE.fullmatch(runtime_sha):
        raise RuntimeError("QUALITY102_STATE_MALFORMED:runtimeCommitSha")
    expected_sha = str(os.environ.get("DISDEX_RUNTIME_COMMIT_SHA") or "").strip()
    if expected_sha and runtime_sha.lower() != expected_sha.lower():
        raise RuntimeError("QUALITY102_STATE_MISMATCH:runtimeCommitSha")
    updated_at = _quality102_finite(root.get("updatedAt"), "updatedAt", positive=True)
    clock = _quality102_finite(now_ms if now_ms is not None else time.time() * 1000, "now_ms", positive=True)
    if updated_at > clock + 5_000:
        raise RuntimeError("QUALITY102_STATE_MALFORMED:updatedAt_future")
    max_age = _quality102_finite(os.environ.get("DISDEX_QUALITY102_STATE_MAX_AGE_MS", QUALITY102_STATE_MAX_AGE_MS), "state_max_age", positive=True)
    if clock - updated_at > max_age:
        raise RuntimeError("QUALITY102_STATE_STALE")
    for field in ("lastProcessedReferenceTs", "lastReconciledAt"):
        if field in root:
            _quality102_finite(root[field], field, positive=True)
    if "lastCompletedIdempotencyKey" in root and not isinstance(root["lastCompletedIdempotencyKey"], str):
        raise RuntimeError("QUALITY102_STATE_MALFORMED:lastCompletedIdempotencyKey")
    failures = root.get("failures")
    if not isinstance(failures, list):
        raise RuntimeError("QUALITY102_STATE_MALFORMED:failures")
    for index, failure in enumerate(failures):
        row = _quality102_object(failure, f"failures[{index}]")
        if "occurredAt" not in row or "message" not in row or set(row) - {"occurredAt", "message", "idempotencyKey"}:
            raise RuntimeError("QUALITY102_STATE_MALFORMED:failure")
        _quality102_finite(row["occurredAt"], f"failures[{index}].occurredAt", positive=True)
        if not isinstance(row["message"], str) or not row["message"]:
            raise RuntimeError("QUALITY102_STATE_MALFORMED:failure_message")
        if "idempotencyKey" in row and not isinstance(row["idempotencyKey"], str):
            raise RuntimeError("QUALITY102_STATE_MALFORMED:failure_idempotencyKey")

    position = root.get("position")
    if position is None:
        return None
    position = _quality102_object(position, "position")
    if set(position) - {"symbol", "side", "quantity", "entryPrice", "entryTs", "hardStop", "bestPrice", "trailActive", "family", "variant", "layer", "exitPolicy", "maxHoldHours", "residentStop", "acceptedEntryGross", "stopLedger"}:
        raise RuntimeError("QUALITY102_STATE_MALFORMED:position_field")
    symbol = str(position.get("symbol") or "").upper()
    if not symbol.endswith("USDT") or not symbol[:-4] or symbol in KNOWN_BASE_SYMBOLS:
        raise RuntimeError("QUALITY102_STATE_MISMATCH:position_symbol")
    side = position.get("side")
    if side not in (-1, 1):
        raise RuntimeError("QUALITY102_STATE_MALFORMED:position_side")
    quantity = _quality102_finite(position.get("quantity"), "position.quantity", positive=True)
    entry_price = _quality102_finite(position.get("entryPrice"), "position.entryPrice", positive=True)
    entry_ts = _quality102_finite(position.get("entryTs"), "position.entryTs", positive=True)
    if "hardStop" in position:
        hard_stop = _quality102_finite(position["hardStop"], "position.hardStop", positive=True)
        if hard_stop > 0.15:
            raise RuntimeError("QUALITY102_STATE_MALFORMED:position.hardStop")
    if "bestPrice" in position:
        _quality102_finite(position["bestPrice"], "position.bestPrice", positive=True)
    if "trailActive" in position and not isinstance(position["trailActive"], bool):
        raise RuntimeError("QUALITY102_STATE_MALFORMED:position.trailActive")
    for key, choices in {"family": {"HIGH_VOL", "PB", "MR", "BRK", "REV"}, "layer": {"S1", "S2", "S3", "S4"}, "exitPolicy": {"HIGH_VOL_TRAIL72", "FIXED_HOLD_STOP"}}.items():
        if key in position and position[key] not in choices:
            raise RuntimeError(f"QUALITY102_STATE_MALFORMED:position.{key}")
    if "variant" in position and (not isinstance(position["variant"], str) or not position["variant"]):
        raise RuntimeError("QUALITY102_STATE_MALFORMED:position.variant")
    if "maxHoldHours" in position and _quality102_finite(position["maxHoldHours"], "position.maxHoldHours", positive=True) > 72:
        raise RuntimeError("QUALITY102_STATE_MALFORMED:position.maxHoldHours")
    if "acceptedEntryGross" in position and _quality102_finite(position["acceptedEntryGross"], "position.acceptedEntryGross", positive=True) > 3:
        raise RuntimeError("QUALITY102_STATE_MALFORMED:position.acceptedEntryGross")
    if "stopLedger" in position:
        ledger = _quality102_object(position["stopLedger"], "stopLedger")
        if set(ledger) != {"originalQuantity", "originalGross", "plans", "fills"}:
            raise RuntimeError("QUALITY102_STATE_MALFORMED:stopLedger.fields")
        for key in ("originalQuantity", "originalGross"):
            _quality102_finite(ledger[key], f"stopLedger.{key}", positive=True)
        if not isinstance(ledger["plans"], list) or not 0 < len(ledger["plans"]) <= 100 or not isinstance(ledger["fills"], list) or len(ledger["fills"]) > 100:
            raise RuntimeError("QUALITY102_STATE_MALFORMED:stopLedger.arrays")
        for plan in ledger["plans"]:
            if set(plan) != {"symbol", "side", "quantity", "stopPrice", "reduceOnly", "clientOrderId"} or plan["symbol"] != symbol or plan["side"] != ("SELL" if side == 1 else "BUY") or plan["reduceOnly"] is not True or not re.fullmatch(r"q102-stop-[a-f0-9]{22}", str(plan["clientOrderId"])):
                raise RuntimeError("QUALITY102_STATE_MALFORMED:stopLedger.plan")
            for key in ("quantity", "stopPrice"):
                _quality102_finite(plan[key], f"stopLedger.plan.{key}", positive=True)
        for fill in ledger["fills"]:
            if set(fill) != {"clientOrderId", "quantity", "averagePrice", "updatedAt", "hardStop"} or not isinstance(fill["clientOrderId"], str) or not fill["clientOrderId"] or not isinstance(fill["hardStop"], bool):
                raise RuntimeError("QUALITY102_STATE_MALFORMED:stopLedger.fill")
            for key in ("quantity", "averagePrice", "updatedAt"):
                _quality102_finite(fill[key], f"stopLedger.fill.{key}", positive=True)
    if "residentStop" in position:
        stop = _quality102_object(position["residentStop"], "position.residentStop")
        if set(stop) != {"protected", "clientOrderId", "orderId", "symbol", "side", "quantity", "originalQuantity", "stopPrice", "readBackStatus", "lastReconciledAt"}:
            raise RuntimeError("QUALITY102_STATE_MALFORMED:residentStop.fields")
        if not isinstance(stop["protected"], bool) or stop["readBackStatus"] not in {"VERIFIED", "UNVERIFIED"} or stop["protected"] != (stop["readBackStatus"] == "VERIFIED") or not re.fullmatch(r"q102-stop-[a-f0-9]{22}", str(stop["clientOrderId"])) or stop["symbol"] != symbol or stop["side"] != ("SELL" if side == 1 else "BUY"):
            raise RuntimeError("QUALITY102_STATE_MALFORMED:residentStop.identity")
        for key in ("quantity", "originalQuantity", "stopPrice", "orderId", "lastReconciledAt"):
            _quality102_finite(stop[key], f"residentStop.{key}", positive=True)
        if stop["originalQuantity"] < stop["quantity"]:
            raise RuntimeError("QUALITY102_STATE_MALFORMED:residentStop.originalQuantity")
        if abs(stop["quantity"]-quantity) > max(1e-8, quantity*1e-9):
            raise RuntimeError("QUALITY102_STATE_MALFORMED:residentStop.quantity")
    pending = root.get("pending")
    if pending is not None:
        pending = _quality102_object(pending, "pending")
        required_pending = {"idempotencyKey", "clientOrderId", "phase", "symbol", "side", "quantity", "reduceOnly", "referenceTs", "createdAt", "updatedAt"}
        if not required_pending.issubset(pending) or set(pending) - required_pending - {"expectedPrice", "targetGross", "hardStop", "reason", "lastError", "family", "variant", "layer", "exitPolicy", "maxHoldHours"}:
            raise RuntimeError("QUALITY102_STATE_MALFORMED:pending")
        if pending.get("phase") not in {"planned", "submitted", "manual_review"} or pending.get("side") not in {"BUY", "SELL"} or not isinstance(pending.get("reduceOnly"), bool):
            raise RuntimeError("QUALITY102_STATE_MALFORMED:pending_identity")
        pending_symbol = str(pending.get("symbol") or "").upper()
        if not pending_symbol.endswith("USDT") or pending_symbol in KNOWN_BASE_SYMBOLS:
            raise RuntimeError("QUALITY102_STATE_MISMATCH:pending_symbol")
        for field in ("quantity", "referenceTs", "createdAt", "updatedAt"):
            _quality102_finite(pending.get(field), f"pending.{field}", positive=field == "quantity")
        if not isinstance(pending.get("idempotencyKey"), str) or not pending["idempotencyKey"] or not isinstance(pending.get("clientOrderId"), str) or not pending["clientOrderId"]:
            raise RuntimeError("QUALITY102_STATE_MALFORMED:pending_order_identity")
        if "targetGross" in pending and _quality102_finite(pending["targetGross"], "pending.targetGross", positive=True) > STRICT_CAPS.quality102_causal_v1_gross:
            raise RuntimeError("QUALITY102_STATE_MALFORMED:pending.targetGross")
        if position is not None and pending_symbol != symbol:
            raise RuntimeError("QUALITY102_STATE_MISMATCH:pending_position_symbol")
        if position is not None and not pending["reduceOnly"]:
            raise RuntimeError("QUALITY102_STATE_MISMATCH:entry_pending_with_position")
        if position is None and pending["reduceOnly"]:
            raise RuntimeError("QUALITY102_STATE_MISMATCH:exit_pending_without_position")
    if "lastReduction" in root:
        reduction = _quality102_object(root["lastReduction"], "lastReduction")
        required_reduction = {"idempotencyKey", "symbol", "side", "reducedQuantity", "markTs", "markPrice", "realizedPnl", "transactionCost", "fundingCost", "accounting"}
        if set(reduction) != required_reduction or reduction.get("side") not in (-1, 1) or reduction.get("accounting") != "MARK_TO_MARKET_REALIZED_PNL":
            raise RuntimeError("QUALITY102_STATE_MALFORMED:lastReduction")
        if not isinstance(reduction.get("idempotencyKey"), str) or not reduction["idempotencyKey"] or not isinstance(reduction.get("symbol"), str) or not reduction["symbol"]:
            raise RuntimeError("QUALITY102_STATE_MALFORMED:lastReduction_identity")
        for field in ("reducedQuantity", "markTs", "markPrice", "realizedPnl", "transactionCost", "fundingCost"):
            _quality102_finite(reduction.get(field), f"lastReduction.{field}", positive=field in {"reducedQuantity", "markPrice"})
    return Quality102OwnedPosition(symbol, int(side), quantity, entry_price, entry_ts, runtime_sha)


def read_quality102_live_state_document(
    path: Path | None = None,
    *,
    now_ms: float | None = None,
) -> tuple[Path, dict, Quality102OwnedPosition | None] | None:
    """Return a validated live-state document for cross-runner coordination.

    Validation is deliberately delegated to ``load_quality102_live_state``
    before the document is returned.  Callers that need to update the state
    (for example, a base-priority MTM reduction) must hold the shared account
    lock; this function does not provide locking itself.
    """
    resolved = path or _quality102_state_path()
    if resolved is None or not resolved.exists():
        return None
    owned = load_quality102_live_state(resolved, now_ms=now_ms)
    try:
        raw = json.loads(resolved.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise RuntimeError("QUALITY102_STATE_MALFORMED:json") from error
    if not isinstance(raw, dict):
        raise RuntimeError("QUALITY102_STATE_MALFORMED:root")
    return resolved, raw, owned


KNOWN_BASE_SYMBOLS = frozenset({
    "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "LINKUSDT", "AVAXUSDT",
    "DOGEUSDT", "INJUSDT", "XRPUSDT", "ADAUSDT", "LTCUSDT", "ATOMUSDT",
    "AAVEUSDT", "NEARUSDT", "PENGUUSDT", "AMZNUSDT", "METAUSDT", "MSFTUSDT",
    "NVDAUSDT", "TSLAUSDT",
})



IDLE_FROZEN_OWNER_SYMBOLS = frozenset({"TAOUSDT", "TIAUSDT", "DOTUSDT", "JUPUSDT", "RENDERUSDT"})
IDLE_PROTECTED_STATE_SCHEMA = "disdex-idle-priority-state/v2"


def _idle_protected_entry_client_order_id(action: str, symbol: str, signal_ts: int) -> str:
    digest = hashlib.sha256(
        f"IDLE_PRIORITY_SHORT|{action}|{symbol}|{signal_ts}".encode("utf-8")
    ).hexdigest()[:22]
    return f"idle-{action.lower()}-{digest}"[:36]


def _validated_idle_owned_notional(
    symbol: str,
    venue_qty: float,
    venue_price: float,
    venue_entry_price: float,
    venue_positions: list[dict] | tuple[dict, ...],
    *,
    now_ms: float | None = None,
) -> float:
    """Account strictly matched, STOP-readback-proven Idle SHORT as known crypto.

    Never authorizes an entry, modifies STOPs, or silently whitelists an
    unfamiliar position. Venue holdings must already come from signed GET.
    """
    def fail(detail: str) -> None:
        raise RuntimeError(f"IDLE_VERIFIED_OWNER_MISMATCH:{symbol}:{detail}")
    if symbol not in IDLE_FROZEN_OWNER_SYMBOLS or venue_qty >= -EPSILON:
        fail("SYMBOL_OR_SIDE")
    expected_sha = str(os.environ.get("DISDEX_RUNTIME_COMMIT_SHA") or "").strip().lower()
    if not _SHA256_RE.fullmatch(expected_sha):
        fail("RUNTIME_SHA_UNSET")
    path = Path(os.environ.get("DISDEX_IDLE_PRIORITY_STATE_PATH") or "/var/lib/disdex/idle-priority/state.json")
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise RuntimeError(f"IDLE_VERIFIED_OWNER_MISMATCH:{symbol}:STATE_UNAVAILABLE") from error
    if not isinstance(document, dict) or document.get("schema") != IDLE_PROTECTED_STATE_SCHEMA:
        fail("SCHEMA")
    if str(document.get("runtimeSha") or "").lower() != expected_sha:
        fail("RELEASE_SHA")
    if document.get("pending") is not None or document.get("manualReview") is not None:
        fail("PENDING_OR_MANUAL_REVIEW")
    positions = document.get("positions")
    if not isinstance(positions, list):
        fail("POSITION_SCHEMA")
    rows = [p for p in positions if isinstance(p, dict) and p.get("symbol") == symbol]
    if len(rows) != 1:
        fail("OWNED_SYMBOL_COUNT")
    owned = rows[0]
    if owned.get("side") != "SHORT" or owned.get("protectionVerified") is not True:
        fail("UNPROTECTED")
    if not all(isinstance(x, (int, float)) and math.isfinite(x)
               for x in (owned.get("quantity"), owned.get("entryPrice"), owned.get("signalTs"), owned.get("entryTs"), owned.get("exitTs"), document.get("updatedAt"))):
        fail("INVALID_NUMERIC_EVIDENCE")
    qty = float(owned["quantity"])
    price = float(owned["entryPrice"])
    if qty <= 0 or price <= 0 or float(owned["signalTs"]) <= 0:
        fail("INVALID_POSITION")
    if abs(abs(venue_qty) - qty) > max(1e-8, qty * 1e-7):
        fail("VENUE_QTY")
    if venue_entry_price <= 0 or abs(venue_entry_price - price) > price * 1e-5:
        fail("VENUE_ENTRY_PRICE")
    if sum(str(p.get("symbol") or "").upper() == symbol and abs(float(p.get("positionAmt", 0))) > EPSILON for p in venue_positions) != 1:
        fail("VENUE_POSITION_DUPLICATE")
    clock = float(now_ms if now_ms is not None else time.time() * 1000)
    updated_at = float(document["updatedAt"])
    entry_at = float(owned["entryTs"])
    signal_at = int(owned["signalTs"])
    deadline = float(owned["exitTs"])
    if not math.isfinite(clock) or updated_at > clock + 5000 or entry_at > clock + 5000 or entry_at < signal_at:
        fail("FUTURE_OR_ORDERING")
    # A signed venue position match is mandatory, but do not reject an
    # otherwise-known protected Idle hold merely because the runner is slowed
    # by a shared rate-budget queue. The strategy's own time exit is bounded.
    if clock - updated_at > 30 * 3600_000 or clock > deadline + 2 * 3600_000:
        fail("STALE_OWNER")
    if owned.get("stopClientOrderId") != _idle_protected_entry_client_order_id("STOP", symbol, signal_at) or \
       owned.get("takeProfitClientOrderId") != _idle_protected_entry_client_order_id("TP", symbol, signal_at):
        fail("PROTECTION_ID")
    stop_price = float(owned.get("stopPrice") or 0)
    tp_price = float(owned.get("takeProfitPrice") or 0)
    if not (stop_price > price > tp_price > 0):
        fail("PROTECTION_PRICE")
    return abs(venue_qty) * venue_price


def quality102_crypto_notional_from_positions(
    rows: list[dict] | tuple[dict, ...],
    *,
    known_crypto: frozenset[str] = frozenset(),
    known_stock: frozenset[str] = frozenset(),
    now_ms: float | None = None,
) -> float:
    """Account Q102 mark notional while preserving unknown-symbol fail-closed."""
    owned = load_quality102_live_state(now_ms=now_ms)
    q102_rows: list[dict] = []
    total = 0.0
    for row in rows:
        if not isinstance(row, dict):
            raise RuntimeError("QUALITY102_POSITION_MALFORMED:row")
        symbol = str(row.get("symbol") or "").upper()
        quantity = _quality102_finite(row.get("positionAmt"), f"{symbol}.positionAmt")
        if abs(quantity) <= EPSILON:
            continue
        mark = row.get("markPrice")
        if mark in (None, ""):
            if owned is not None and symbol == owned.symbol:
                raise RuntimeError(f"QUALITY102_POSITION_MALFORMED:{symbol}.markPrice")
            # Preserve the pre-existing base-runner fallback for known
            # strategy positions; Q102 itself requires a current mark.
            mark = row.get("entryPrice")
        price = _quality102_finite(mark, f"{symbol}.markPrice", positive=True)
        if symbol in known_stock:
            continue
        if symbol in known_crypto:
            total += abs(quantity) * price
            continue
        if symbol == "FETUSDT" and (owned is None or owned.symbol != symbol):
            # FET is owned by a separate sleeve, not by Q102. Only accept an
            # exact, fresh LIVE state/venue match; unknown positions still hold.
            path = Path(os.environ.get("FET_BRK48_STATE_PATH") or "/var/lib/disdex/fet-brk48-residual/state.json")
            try:
                fet = json.loads(path.read_text(encoding="utf-8"))
                p = fet.get("position")
                expected = str(os.environ.get("DISDEX_RUNTIME_COMMIT_SHA") or "")
                clock = now_ms if now_ms is not None else time.time() * 1000
                age = clock - float(fet["updatedAt"])
                sha = str(fet.get("runtimeCommitSha") or "")
                valid = (fet.get("schema") == "fet-brk48-residual-state/v1" and fet.get("strategyId") == "FET_BRK48_RESIDUAL"
                         and _SHA256_RE.fullmatch(sha) and _SHA256_RE.fullmatch(expected)
                         and (not expected or sha.lower() == expected.lower())
                         and -5000 <= age <= 75 * 60_000
                         and fet.get("pending") is None and fet.get("manualReview") is None
                         and isinstance(p, dict) and p.get("symbol") == symbol and p.get("side") == 1
                         and quantity > 0 and math.isfinite(float(p["quantity"]))
                         and abs(quantity - float(p["quantity"])) <= max(1e-8, quantity * 1e-8)
                         and math.isfinite(float(p["entryPrice"])) and float(p["entryPrice"]) > 0
                         and abs(float(row.get("entryPrice")) - float(p["entryPrice"])) <= float(p["entryPrice"]) * 1e-6
                         and sum(str(r.get("symbol") or "").upper() == symbol and abs(float(r.get("positionAmt", 0))) > EPSILON for r in rows) == 1)
                if not valid:
                    raise ValueError("mismatch")
            except (OSError, ValueError, TypeError, KeyError, AttributeError) as error:
                raise RuntimeError("Unknown non-flat Aster symbol requires manual review: FETUSDT:FET_STATE_POSITION_MISMATCH") from error
            total += abs(quantity) * price
            continue
        if symbol in IDLE_FROZEN_OWNER_SYMBOLS:
            total += _validated_idle_owned_notional(
                symbol, quantity, price, _quality102_finite(row.get("entryPrice"), f"{symbol}.entryPrice", positive=True),
                rows, now_ms=now_ms,
            )
            continue
        if owned is None or symbol != owned.symbol:
            raise RuntimeError(f"Unknown non-flat Aster symbol requires manual review: {symbol}")
        q102_rows.append(row)
        if (1 if quantity > 0 else -1) != owned.side or abs(abs(quantity) - owned.quantity) > max(1e-8, owned.quantity * 0.02):
            raise RuntimeError("QUALITY102_STATE_POSITION_MISMATCH")
        total += abs(quantity) * price
    if owned is not None and len(q102_rows) != 1:
        raise RuntimeError("QUALITY102_STATE_POSITION_MISMATCH")
    return total


def _enabled(value: str | None) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def _finite(value: object, label: str) -> float:
    number = float(value)
    if not math.isfinite(number):
        raise RuntimeError(f"STRICT_PORTFOLIO_INVALID_{label}")
    return number



def classify_crypto_gross(current_crypto_gross: float, caps: StrictPortfolioCaps = STRICT_CAPS) -> dict:
    current = _finite(current_crypto_gross, "CRYPTO_GROSS")
    if current < -EPSILON:
        raise RuntimeError("STRICT_PORTFOLIO_NEGATIVE_GROSS")
    normal = caps.crypto_gross
    existing_max = caps.crypto_gross_existing_max
    if current <= normal + EPSILON:
        band = "WITHIN_NORMAL"
    elif current <= existing_max + EPSILON:
        band = "EXISTING_EXCESS_ALLOWED"
    else:
        band = "ABOVE_EXISTING_ALLOWANCE"
    return {
        "currentCryptoGross": current,
        "normalEntryCap": normal,
        "existingExposureMax": existing_max,
        "entryCapForNewRisk": max(current, normal),
        "existingExposureManaged": True,
        "protectedExitAllowed": True,
        "newRiskAllowed": current < normal - EPSILON,
        "existingExposureBand": band,
        "reason": "CRYPTO_GROSS_NORMAL_ENTRY_CAPACITY" if current < normal - EPSILON else "CRYPTO_GROSS_EXISTING_EXCESS_NO_NEW_RISK",
    }


def _assert_cap_env(env: Mapping[str, str], name: str, expected: float) -> None:
    raw = env.get(name)
    if raw is None or str(raw).strip() == "":
        return
    actual = _finite(raw, name)
    if abs(actual - expected) > EPSILON:
        raise RuntimeError(f"STRICT_PORTFOLIO_CONFIG_MISMATCH:{name}:{raw}:EXPECTED_{expected}")


def assert_strict_live_configuration(env: Mapping[str, str] | None = None) -> StrictPortfolioCaps:
    source = os.environ if env is None else env
    if not _enabled(source.get("STRICT_PORTFOLIO_PLANNER_ACTIVE")):
        raise RuntimeError("STRICT_PORTFOLIO_PLANNER_NOT_ACTIVE")
    _assert_cap_env(source, "V12_BASE_GROSS_CAP", STRICT_CAPS.v12_base_gross)
    _assert_cap_env(source, "V12_DYNAMIC_GROSS_CAP", STRICT_CAPS.v12_gross)
    _assert_cap_env(source, "V12_GROSS_CAP", STRICT_CAPS.v12_gross)
    _assert_cap_env(source, "PENGU_GROSS_CAP", STRICT_CAPS.pengu_gross)
    _assert_cap_env(source, "STOCK_GROSS_CAP", STRICT_CAPS.stock_gross)
    _assert_cap_env(source, "CRYPTO_GROSS_CAP", STRICT_CAPS.crypto_gross)
    _assert_cap_env(source, "TOTAL_GROSS_CAP", STRICT_CAPS.total_gross)
    _assert_cap_env(source, "DISDEX_V52_STOCK_GROSS_CAP", STRICT_CAPS.stock_gross)
    _assert_cap_env(source, "DISDEX_V52_V11_GROSS_CAP", STRICT_CAPS.stock_slot_gross)
    _assert_cap_env(source, "DISDEX_V52_V50_GROSS_CAP", STRICT_CAPS.stock_slot_gross)
    _assert_cap_env(source, "DISDEX_V52_CRYPTO_GROSS_CAP", STRICT_CAPS.crypto_gross)
    _assert_cap_env(source, "CRYPTO_GROSS_EXISTING_MAX", STRICT_CAPS.crypto_gross_existing_max)
    _assert_cap_env(source, "DISDEX_V52_CRYPTO_GROSS_EXISTING_MAX", STRICT_CAPS.crypto_gross_existing_max)
    _assert_cap_env(source, "DISDEX_V52_PORTFOLIO_GROSS_CAP", STRICT_CAPS.total_gross)
    if _enabled(source.get("QUALITY102_LIVE_ENABLED")) or _enabled(source.get("QUALITY102_LIVE_SELECTOR_PARITY")):
        raise RuntimeError("QUALITY102_LIVE_BLOCKED_FAIL_CLOSED")
    return STRICT_CAPS


def validate_gross_snapshot(snapshot: Mapping[str, object], caps: StrictPortfolioCaps = STRICT_CAPS) -> dict:
    equity = _finite(snapshot.get("equityUsd", 0), "EQUITY")
    crypto = _finite(snapshot.get("cryptoGross", 0), "CRYPTO_GROSS")
    stock = _finite(snapshot.get("stockGross", 0), "STOCK_GROSS")
    total = _finite(snapshot.get("totalGross", 0), "TOTAL_GROSS")
    if equity <= 0:
        raise RuntimeError("STRICT_PORTFOLIO_EQUITY_NOT_POSITIVE")
    if min(crypto, stock, total) < -EPSILON:
        raise RuntimeError("STRICT_PORTFOLIO_NEGATIVE_GROSS")
    # This is OBSERVATION / existing position reconciliation, not new-risk
    # admission. Even a price-only spike beyond 3.5 must not block protected
    # exits. All NEW risk is separately denied above the passive tolerance.
    if stock > caps.stock_gross + EPSILON:
        raise RuntimeError(f"STOCK_GROSS_OVER_CAP:{stock:.9f}>{caps.stock_gross:.9f}")
    if total > caps.total_gross + EPSILON:
        raise RuntimeError(f"TOTAL_GROSS_OVER_CAP:{total:.9f}>{caps.total_gross:.9f}")
    if abs((crypto + stock) - total) > 1e-6:
        raise RuntimeError("STRICT_PORTFOLIO_GROSS_SNAPSHOT_INCONSISTENT")
    return {
        "equityUsd": equity,
        "cryptoGross": crypto,
        "stockGross": stock,
        "totalGross": total,
        "cryptoGrossControl": classify_crypto_gross(crypto, caps),
    }


def plan_crypto_entry_capacity(
    snapshot: Mapping[str, object],
    requested_gross: float,
    caps: StrictPortfolioCaps = STRICT_CAPS,
    *,
    candidate_worst_case_gross: float | None = None,
) -> dict:
    current = validate_gross_snapshot(snapshot, caps)
    requested = _finite(requested_gross, "REQUESTED_CRYPTO_GROSS")
    if requested < 0:
        raise RuntimeError("STRICT_PORTFOLIO_NEGATIVE_REQUEST")
    worst_case = requested if candidate_worst_case_gross is None else _finite(candidate_worst_case_gross, "CRYPTO_CANDIDATE_WORST_CASE_GROSS")
    if worst_case < requested - EPSILON:
        raise RuntimeError("STRICT_PORTFOLIO_WORST_CASE_BELOW_NOMINAL")
    ratio = worst_case / requested if requested > EPSILON else 1.0
    control = current["cryptoGrossControl"]
    crypto_residual = max(0.0, control["entryCapForNewRisk"] - current["cryptoGross"])
    total_residual = max(0.0, caps.total_gross - current["totalGross"])
    accepted = max(0.0, min(requested, crypto_residual, total_residual / ratio))
    return {
        "status": "planned" if accepted > EPSILON else "blocked",
        "requestedGross": requested,
        "candidateWorstCaseGross": worst_case,
        "worstCaseRatio": ratio,
        "acceptedGross": accepted,
        "entryCapForNewRisk": control["entryCapForNewRisk"],
        "newRiskAllowed": accepted > EPSILON,
        "existingExposureManaged": True,
        "protectedExitAllowed": True,
        "existingExposureBand": control["existingExposureBand"],
        "reason": "CRYPTO_GROSS_NORMAL_ENTRY_CAPACITY" if accepted > EPSILON else "CRYPTO_GROSS_EXISTING_EXCESS_NO_NEW_RISK",
    }


def plan_v52_stock_capacity(
    snapshot: Mapping[str, object],
    requested_gross: float,
    slot_cap: float,
    caps: StrictPortfolioCaps = STRICT_CAPS,
    *,
    candidate_worst_case_gross: float | None = None,
) -> dict:
    current = validate_gross_snapshot(snapshot, caps)
    requested = _finite(requested_gross, "REQUESTED_GROSS")
    per_slot = _finite(slot_cap, "V52_SLOT_CAP")
    if requested < 0 or per_slot < 0:
        raise RuntimeError("STRICT_PORTFOLIO_NEGATIVE_REQUEST")
    worst_case = requested if candidate_worst_case_gross is None else _finite(candidate_worst_case_gross, "V52_CANDIDATE_WORST_CASE_GROSS")
    if worst_case < requested - EPSILON:
        raise RuntimeError("STRICT_PORTFOLIO_WORST_CASE_BELOW_NOMINAL")
    worst_case_ratio = worst_case / requested if requested > EPSILON else 1.0
    stock_residual = max(0.0, caps.stock_gross - current["stockGross"])
    total_residual = max(0.0, caps.total_gross - current["totalGross"])
    accepted = max(0.0, min(
        requested,
        per_slot,
        stock_residual / worst_case_ratio,
        total_residual / worst_case_ratio,
    ))
    # Beyond the passive 3.5x crypto band no NEW stock exposure is admitted.
    # Existing positions and protective closes must remain reconcilable.
    if current["cryptoGross"] > caps.crypto_gross_existing_max + EPSILON:
        accepted = 0.0
    return {
        "status": "planned" if accepted > EPSILON else "blocked",
        "requestedGross": requested,
        "candidateWorstCaseGross": worst_case,
        "worstCaseRatio": worst_case_ratio,
        "acceptedGross": accepted,
        "stockResidualGross": stock_residual,
        "totalResidualGross": total_residual,
        "strictPortfolioPlannerActive": True,
        "cryptoGrossCap": caps.crypto_gross,
        "stockGrossCap": caps.stock_gross,
        "totalGrossCap": caps.total_gross,
        "quality102LiveSelectorParity": False,
        "quality102LiveBlockedFailClosed": True,
        "existingExposureManaged": current["cryptoGrossControl"]["existingExposureManaged"],
        "protectedExitAllowed": current["cryptoGrossControl"]["protectedExitAllowed"],
        "cryptoGrossControl": current["cryptoGrossControl"],
    }


def self_test() -> None:
    caps = assert_strict_live_configuration({
        "STRICT_PORTFOLIO_PLANNER_ACTIVE": "true",
        "V12_BASE_GROSS_CAP": "2.0",
        "V12_DYNAMIC_GROSS_CAP": "2.0",
        "V12_GROSS_CAP": "2.0",
        "CRYPTO_GROSS_CAP": "3.0",
        "STOCK_GROSS_CAP": "4.0",
        "TOTAL_GROSS_CAP": "4.25",
        "DISDEX_V52_CRYPTO_GROSS_CAP": "3.0",
        "DISDEX_V52_STOCK_GROSS_CAP": "4.0",
        "DISDEX_V52_V11_GROSS_CAP": "2.0",
        "DISDEX_V52_V50_GROSS_CAP": "2.0",
        "DISDEX_V52_PORTFOLIO_GROSS_CAP": "4.25",
    })
    assert caps.crypto_gross == 3.0
    assert CRYPTO_GROSS_PASSIVE_DRIFT_TOLERANCE == 3.5
    # No new crypto budget is ever granted: only V52's existing book
    # reconciliation and stock capacity may proceed within the total cap.
    for observed in (3.01, 3.25, 3.50):
        snap = validate_gross_snapshot({
            "equityUsd": 1000,
            "cryptoGross": observed,
            "stockGross": 0.25,
            "totalGross": observed + 0.25,
        })
        assert abs(snap["cryptoGross"] - observed) < EPSILON
    drift_stock = plan_v52_stock_capacity({
        "equityUsd": 1000, "cryptoGross": 3.5,
        "stockGross": 0.0, "totalGross": 3.5,
    }, 1.0, 1.0)
    assert drift_stock["status"] == "planned"
    assert abs(drift_stock["acceptedGross"] - 0.75) < EPSILON
    assert drift_stock["cryptoGrossCap"] == 3.0
    above_passive = validate_gross_snapshot({
        "equityUsd": 1000, "cryptoGross": 3.51,
        "stockGross": 0.0, "totalGross": 3.51,
    })
    assert above_passive["cryptoGrossControl"]["protectedExitAllowed"] is True
    stock_blocked = plan_v52_stock_capacity(above_passive, 0.1, 0.1)
    assert stock_blocked["status"] == "blocked"
    assert stock_blocked["acceptedGross"] == 0
    for invalid_crypto in (5.00001,):
        try:
            validate_gross_snapshot({
                "equityUsd": 1000, "cryptoGross": invalid_crypto,
                "stockGross": 0.0, "totalGross": invalid_crypto,
            })
            raise AssertionError("Total Gross above 4.25 still must fail")
        except RuntimeError as error:
            assert "TOTAL_GROSS_OVER_CAP" in str(error)
    try:
        validate_gross_snapshot({
            "equityUsd": 1000,
            "cryptoGross": 3.5,
            "stockGross": 1.0,
            "totalGross": 4.5,
        })
        raise AssertionError("Total 4.25 cap remains independent")
    except RuntimeError as error:
        assert "TOTAL_GROSS_OVER_CAP" in str(error)
    for current_crypto in (2.99, 3.00, 3.01, 3.25, 3.50, 3.51):
        snapshot = {
            "equityUsd": 1000,
            "cryptoGross": current_crypto,
            "stockGross": 0,
            "totalGross": current_crypto,
        }
        plan = plan_crypto_entry_capacity(snapshot, 0.25)
        expected = max(0.0, min(0.25, caps.crypto_gross - current_crypto))
        assert abs(plan["acceptedGross"] - expected) < EPSILON
        assert plan["existingExposureManaged"] is True
        assert plan["protectedExitAllowed"] is True
        assert plan["newRiskAllowed"] is (expected > EPSILON)
    at_limit = plan_v52_stock_capacity({"equityUsd": 1000, "cryptoGross": 3.0, "stockGross": 1.25, "totalGross": 4.25}, 1.0, 1.0)
    assert at_limit["status"] == "blocked"
    residual = plan_v52_stock_capacity({"equityUsd": 1000, "cryptoGross": 2.25, "stockGross": 0.5, "totalGross": 2.75}, 1.0, 1.0)
    assert abs(residual["acceptedGross"] - 1.0) < EPSILON
    try:
        assert_strict_live_configuration({"STRICT_PORTFOLIO_PLANNER_ACTIVE": "true", "CRYPTO_GROSS_CAP": "1.5"})
        raise AssertionError("legacy 1.5 crypto cap must fail")
    except RuntimeError as error:
        assert "CONFIG_MISMATCH" in str(error)
    try:
        assert_strict_live_configuration({"STRICT_PORTFOLIO_PLANNER_ACTIVE": "true", "QUALITY102_LIVE_ENABLED": "true"})
        raise AssertionError("Quality102 must stay fail-closed")
    except RuntimeError as error:
        assert "QUALITY102_LIVE_BLOCKED_FAIL_CLOSED" in str(error)
    print("DISDEX_STRICT_PORTFOLIO_PLANNER_PY_SELFTEST_PASS")


if __name__ == "__main__":
    self_test()
