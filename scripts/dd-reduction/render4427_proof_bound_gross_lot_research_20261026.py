"""RENDER #4427 research-only gross/lot proof binding. NO LIVE import, orders or I/O.

All supplied manifests and roots are synthetic until independently operator-attested.
A successful verdict is NEED_NATIVE_ALLOCATOR, never order authorization.
"""
from decimal import Decimal, InvalidOperation, ROUND_FLOOR
from hashlib import sha256
import json

OWNER = "IDLE_RENDER_INDEPENDENT_SHORT_RESEARCH"
ROUTE = "IDLE_RENDER_IND_BTC_DIVERGENCE_SELL55_SHORT"
PROOF_COUNT = 13
FRESHNESS_MS = 300000  # research assumption, not a Native8 contract

def canonical_sha(value):
    return sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                             separators=(",", ":"), allow_nan=False).encode("utf-8")).hexdigest()

def _dec(value):
    if isinstance(value, bool):
        raise ValueError("BOOLEAN_NUMBER")
    d = Decimal(str(value))
    if not d.is_finite():
        raise ValueError("NONFINITE")
    return d

def _reject(code):
    return {"status": "REJECT", "reason": code, "order_authorized": False}

def assess_research_allocation(allocation, inventory, proofs, independent_manifest_sha, now_ms):
    """Pure fail-closed synthetic preallocation assessment; never grants an order."""
    try:
        if not isinstance(independent_manifest_sha, str) or len(independent_manifest_sha) != 64:
            return _reject("INDEPENDENT_PIN_MISSING")
        envelope = {"allocation": allocation, "inventory": inventory, "proofs": proofs}
        if canonical_sha(envelope) != independent_manifest_sha:
            return _reject("MANIFEST_BYTES_MISMATCH")
        if allocation["owner"] != OWNER or allocation["route"] != ROUTE or allocation["symbol"] != "RENDERUSDT":
            return _reject("OWNER_ROUTE_SYMBOL_UNREGISTERED")
        if not isinstance(proofs, list) or len(proofs) != PROOF_COUNT:
            return _reject("GATEPROOF_COUNT")
        now = int(now_ms)
        seq = int(inventory["sequence"])
        asof = int(inventory["asof"])
        root = inventory["snapshot_root"]
        if not root or not inventory["source_id"] or seq <= 0 or asof <= 0 or asof > now or now - asof > FRESHNESS_MS:
            return _reject("INVENTORY_IDENTITY_OR_FRESHNESS")
        if len({p["code"] for p in proofs}) != PROOF_COUNT:
            return _reject("GATEPROOF_DUPLICATE")
        for p in proofs:
            if (p["sequence"] != seq or p["asof"] != asof or
                p["snapshot_root"] != root or not p["source_id"] or p["passed"] is not True):
                return _reject("GATEPROOF_SNAPSHOT_MISMATCH")
        for flag in ("sameSymbolActive", "pendingConflict", "cooldownActive", "killSwitchActive", "dedupConflict"):
            if inventory[flag] is not False:
                return _reject("EXPOSURE_OR_KILL_GATE")
        for flag in ("sharedRiskHealthy", "marginGuardHealthy", "accountLockHealthy"):
            if inventory[flag] is not True:
                return _reject("SHARED_GUARD_UNHEALTHY")
        gross = _dec(allocation["requestedGross"])
        if gross != Decimal("0.25"):
            return _reject("RESEARCH_GROSS_NOT_APPROVED")
        for field in ("admissionGross", "reservationGross", "pendingGross"):
            if _dec(allocation[field]) != gross:
                return _reject("GROSS_BINDING_MISMATCH")
        equity = _dec(allocation["equityUsd"])
        price = _dec(allocation["referencePrice"])
        q = _dec(allocation["normalizedQuantity"])
        notional = _dec(allocation["normalizedNotional"])
        step = _dec(allocation["quantityStep"])
        min_qty = _dec(allocation["minQuantity"])
        max_qty = _dec(allocation["maxQuantity"])
        min_notional = _dec(allocation["minNotional"])
        if min(equity, price, q, step, min_qty, max_qty, gross) <= 0 or min_notional < 0:
            return _reject("VENUE_INPUT_INVALID")
        if _dec(allocation["maxEntryNotionalUsd"]) != equity * gross:
            return _reject("ENTRY_CAP_GROSS_MISMATCH")
        if _dec(inventory["grossAvailable"]) < gross:
            return _reject("GROSS_CAPACITY_UNAVAILABLE")
        desired = equity * gross / price
        expected_floor = (desired / step).to_integral_value(rounding=ROUND_FLOOR) * step
        if desired > max_qty or q > max_qty or q < min_qty:
            return _reject("VENUE_QUANTITY_LIMIT")
        if notional < min_notional:
            return _reject("VENUE_MIN_NOTIONAL")
        if q != expected_floor or notional != q * price:
            return _reject("QUANTITY_NOT_PROOF_BOUND_FLOOR")
        actual = notional / equity
        if actual > gross or actual < gross * Decimal("0.99"):
            return _reject("GROSS_ROUNDING_BOUNDS")
        # Snapshot authenticity, operator signature, durable dedup and Native8 remain unverified.
        return {"status": "NEED_NATIVE_ALLOCATOR", "reason": "SYNTHETIC_ONLY",
                "order_authorized": False, "actual_gross": str(actual)}
    except (KeyError, TypeError, ValueError, InvalidOperation, OverflowError, ArithmeticError):
        return _reject("MALFORMED_OR_UNBOUND_INPUT")
