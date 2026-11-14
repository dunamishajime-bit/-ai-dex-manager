"""Pure independent attribution of all non-flat venue inventory to durable V4.

No I/O, orders, permissions, freshness or service assertions occur here. The
caller MUST independently validate the TypeScript V4ExecutionStore journal
replay, authenticated signed-read freshness, file ownership, source/risk gates,
pending/shared reservations and activation cycles, then bind publication by CAS
under the account lock. This proof alone never grants trading authority.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
from decimal import Decimal, InvalidOperation, localcontext


def _fail(reason):
    raise ValueError("V4_SOLE_INVENTORY_" + reason)


def _object(value, label):
    if not isinstance(value, dict):
        _fail(label + "_MALFORMED")
    return value


def _list(value, label):
    if not isinstance(value, list):
        _fail(label + "_MALFORMED")
    return value


def _text(value, label):
    if not isinstance(value, str) or not value or value != value.strip():
        _fail(label + "_INVALID")
    return value


def _symbol(value):
    value = _text(value, "SYMBOL")
    if not re.fullmatch(r"[A-Z0-9]+", value):
        _fail("SYMBOL_INVALID")
    return value


def _number(value, label, *, durable=False, positive=False, nonnegative=False):
    allowed = (int, float) if durable else (int, float, str)
    if type(value) not in allowed:
        _fail(label + "_NUMBER_INVALID")
    if isinstance(value, str) and not re.fullmatch(r"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?", value):
        _fail(label + "_NUMBER_INVALID")
    try:
        result = Decimal(str(value))
        finite = result.is_finite() and math.isfinite(float(result))
    except (InvalidOperation, ValueError, OverflowError):
        finite = False
    if not finite or positive and result <= 0 or nonnegative and result < 0:
        _fail(label + "_NUMBER_INVALID")
    return result


def _integer(value, label):
    if type(value) is not int or value < 0:
        _fail(label + "_INVALID")
    return value


def _quantity_equal(actual, expected, label):
    if abs(actual - expected) > max(Decimal("1e-8"), abs(expected) * Decimal("1e-7")):
        _fail(label + "_QUANTITY_MISMATCH")


def _order_id(value):
    if type(value) is int and value > 0:
        return str(value)
    if isinstance(value, str) and re.fullmatch(r"[1-9][0-9]*", value):
        return value
    _fail("ORDER_ID_INVALID")


def _canonical(value):
    try:
        return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    except (ValueError, TypeError) as error:
        raise ValueError("V4_SOLE_INVENTORY_NON_JSON_DATA") from error


def _digest(text):
    try:
        return hashlib.sha256(text.encode("utf-8")).hexdigest()
    except UnicodeError as error:
        raise ValueError("V4_SOLE_INVENTORY_INVALID_UNICODE") from error


def _identity(sha, leg_id, action, sequence):
    # Exact v4OrderIdentity formula: JSON.stringify([sha,legId,action,sequence]).
    raw = json.dumps([sha, leg_id, action, sequence], separators=(",", ":"), ensure_ascii=False)
    return "v12-v4-" + _digest(raw)[:28]


def _decimal_text(number):
    text = format(number, "f")
    return text.rstrip("0").rstrip(".") if "." in text else text


def attest_sole_v4_inventory(document, expected_sha, positions, orders):
    """Return a JSON-safe binding proof or raise ValueError; inputs never mutate.

    Durable values must be actual finite JSON numbers. Raw signed venue numeric
    strings are parsed strictly with Decimal. Only exact-zero venue quantities
    may be ignored. Quantities use max(1e-8, expected*1e-7); persisted stop prices,
    command identities, sides, signal timestamps and order IDs match exactly.
    Venue rows must explicitly assert one-way positionSide=BOTH. Only current or
    explicitly validated legacy-release order identities can own resident stops.
    The immutable proofJson plus proofSha256 bind the full durable document digest
    and normalized matched inventory; journalReplayVerified is deliberately false.
    """
    with localcontext() as context:
        # Accommodate finite double-range signed observations without rounding
        # away residual quantities during aggregation/comparison.
        context.prec = 768
        return _attest(document, expected_sha, positions, orders)


def _attest(document, expected_sha, positions, orders):
    doc = _object(document, "DOCUMENT")
    if not isinstance(expected_sha, str) or not re.fullmatch(r"[a-f0-9]{40}", expected_sha):
        _fail("EXPECTED_SHA_INVALID")
    if type(doc.get("schema")) is not int or doc["schema"] != 2 or doc.get("releaseSha") != expected_sha:
        _fail("RELEASE_MISMATCH")
    revision = _integer(doc.get("revision"), "REVISION")
    legacy = _list(doc.get("legacyReleaseShas", []), "LEGACY_RELEASES")
    if any(not isinstance(sha, str) or not re.fullmatch(r"[a-f0-9]{40}", sha) or sha == expected_sha for sha in legacy) or len(set(legacy)) != len(legacy):
        _fail("LEGACY_RELEASES_INVALID")
    lineage = [expected_sha] + legacy
    state = _object(doc.get("state"), "STATE")
    initial = _object(state.get("initial"), "INITIAL")
    if initial.get("holdProtected") is not False or state.get("holdProtected", False) is not False or doc.get("holdProtected", False) is not False:
        _fail("HOLD_PROTECTED")
    if state.get("executionReview") not in (None, "") or doc.get("executionReview") not in (None, ""):
        _fail("EXECUTION_REVIEW")
    for owner in _list(state.get("foreign"), "FOREIGN"):
        owner = _object(owner, "FOREIGN_ROW")
        for field in ("qty", "gross", "pendingGross"):
            if _number(owner.get(field), "FOREIGN_" + field, durable=True, nonnegative=True) != 0:
                _fail("ACTIVE_FOREIGN_EXPOSURE")
    for container in (doc, state):
        if "reservations" in container and container["reservations"] not in ({}, []):
            _fail("RESERVATIONS_PRESENT")
    legs = _object(state.get("legs"), "LEGS")
    intents = _object(doc.get("intents"), "INTENTS")
    protections = _object(doc.get("protections"), "PROTECTIONS")
    for cid, intent in intents.items():
        cid = _text(cid, "INTENT_KEY")
        intent = _object(intent, "INTENT")
        leg_id = _text(intent.get("legId"), "INTENT_LEG")
        action = intent.get("action")
        if not isinstance(action, str) or action not in {"ENTRY", "EXIT", "STOP", "TAKE_PROFIT"}:
            _fail("INTENT_ACTION_INVALID")
        sequence = _integer(intent.get("sequence"), "INTENT_SEQUENCE")
        if leg_id not in legs or intent.get("clientOrderId") != cid or not any(cid == _identity(sha, leg_id, action, sequence) for sha in lineage):
            _fail("INTENT_IDENTITY_INVALID")
        stage = intent.get("stage")
        if not isinstance(stage, str) or stage not in {"PREPARED", "SUBMITTING", "UNKNOWN", "ACKNOWLEDGED", "TERMINAL"}:
            _fail("INTENT_STAGE_INVALID")
        created = _number(intent.get("createdAt"), "INTENT_CREATED", durable=True, positive=True)
        updated = _number(intent.get("updatedAt"), "INTENT_UPDATED", durable=True, positive=True)
        if updated < created:
            _fail("INTENT_TIME_REVERSED")
        if action != "STOP" and stage != "TERMINAL":
            _fail("UNRESOLVED_" + action)

    aggregate = {}
    active = {}
    for key, leg in legs.items():
        key = _text(key, "LEG_KEY")
        leg = _object(leg, "LEG")
        if leg.get("id") != key:
            _fail("LEG_IDENTITY_INVALID")
        qty = _number(leg.get("qty"), "LEG_QTY", durable=True, nonnegative=True)
        reservation = _number(leg.get("reservationUsd"), "LEG_RESERVATION", durable=True, nonnegative=True)
        remaining = _number(leg.get("exitRemainingQty"), "LEG_EXIT_REMAINING", durable=True, nonnegative=True)
        if reservation != 0 or remaining != 0:
            _fail("LEG_RESERVATION_OR_EXIT_PENDING")
        status = leg.get("status")
        if status in ("CLOSED", "CANCELLED"):
            if qty != 0:
                _fail("INACTIVE_LEG_NONZERO")
            continue
        if status != "OPEN" or qty <= 0:
            _fail("ACTIVE_LEG_NOT_OPEN")
        candidate = _object(leg.get("candidate"), "CANDIDATE")
        symbol = _symbol(candidate.get("symbol"))
        side = candidate.get("effectiveSide")
        if side not in ("LONG", "SHORT"):
            _fail("LEG_SIDE_INVALID")
        entry_ts = _number(leg.get("entryTs"), "LEG_ENTRY_TS", durable=True, positive=True)
        if symbol in aggregate and aggregate[symbol]["side"] != side:
            _fail("OPPOSING_SAME_SYMBOL_LEGS")
        current = aggregate.setdefault(symbol, {"side": side, "quantity": Decimal(0)})
        current["quantity"] += qty
        active[key] = {"symbol": symbol, "side": side, "quantity": qty, "entryTs": entry_ts}

    matched_positions = []
    seen_positions = set()
    for row in _list(positions, "POSITIONS"):
        row = _object(row, "POSITION")
        amount = _number(row.get("positionAmt"), "POSITION_AMOUNT")
        if amount == 0:
            continue
        symbol = _symbol(row.get("symbol"))
        if row.get("positionSide") != "BOTH":
            _fail("HEDGE_POSITION_DRIFT")
        if symbol in seen_positions or symbol not in aggregate:
            _fail("DUPLICATE_OR_FOREIGN_POSITION")
        seen_positions.add(symbol)
        claim = aggregate[symbol]
        if ("LONG" if amount > 0 else "SHORT") != claim["side"]:
            _fail("POSITION_SIDE_MISMATCH")
        _quantity_equal(abs(amount), claim["quantity"], "POSITION")
        mark = _number(row.get("markPrice"), "POSITION_MARK", positive=True)
        entry = _number(row.get("entryPrice"), "POSITION_ENTRY", positive=True)
        matched_positions.append({"symbol": symbol, "positionSide": "BOTH", "positionAmt": _decimal_text(amount), "markPrice": _decimal_text(mark), "entryPrice": _decimal_text(entry)})
    if seen_positions != set(aggregate):
        _fail("OWNED_POSITION_MISSING")

    venue_orders = {}
    order_ids = set()
    for row in _list(orders, "ORDERS"):
        row = _object(row, "ORDER")
        cid = _text(row.get("clientOrderId"), "VENUE_CID")
        order_id = _order_id(row.get("orderId"))
        if cid in venue_orders or order_id in order_ids:
            _fail("DUPLICATE_VENUE_ORDER")
        venue_orders[cid] = row
        order_ids.add(order_id)
    selected = set()
    bindings = []
    for leg_id, leg in active.items():
        protection = _object(protections.get(leg_id), "PROTECTION")
        if protection.get("legId") != leg_id or protection.get("phase") != "STOP_CONFIRMED":
            _fail("PROTECTION_NOT_CONFIRMED")
        _number(protection.get("updatedAt"), "PROTECTION_UPDATED", durable=True, positive=True)
        protected = _number(protection.get("protectedQty"), "PROTECTED_QTY", durable=True, positive=True)
        _quantity_equal(protected, leg["quantity"], "PROTECTION")
        cid = _text(protection.get("stopClientOrderId"), "PROTECTION_CID")
        if cid in selected:
            _fail("SHARED_PROTECTION_ORDER")
        selected.add(cid)
        intent = _object(intents.get(cid), "STOP_INTENT")
        if intent.get("legId") != leg_id or intent.get("action") != "STOP" or intent.get("stage") != "ACKNOWLEDGED":
            _fail("STOP_INTENT_NOT_ACKNOWLEDGED")
        command = _object(intent.get("command"), "STOP_COMMAND")
        if command.get("legId") != leg_id or command.get("action") != "STOP" or type(command.get("sequence")) is not int or command["sequence"] != intent["sequence"] or command.get("symbol") != leg["symbol"] or command.get("positionSide") != leg["side"]:
            _fail("STOP_COMMAND_IDENTITY_MISMATCH")
        command_qty = _number(command.get("quantity"), "COMMAND_QTY", durable=True, positive=True)
        _quantity_equal(command_qty, leg["quantity"], "COMMAND")
        trigger = _number(command.get("price"), "COMMAND_TRIGGER", durable=True, positive=True)
        if _number(command.get("signalTs"), "COMMAND_SIGNAL_TS", durable=True, positive=True) != leg["entryTs"]:
            _fail("STOP_SIGNAL_TIME_MISMATCH")
        order = _object(venue_orders.get(cid), "RESIDENT_STOP")
        venue_id = _order_id(order.get("orderId"))
        if venue_id != _order_id(intent.get("venueOrderId")):
            _fail("STOP_VENUE_ORDER_ID_MISMATCH")
        if order.get("symbol") != leg["symbol"] or order.get("positionSide") != "BOTH" or order.get("type") != "STOP_MARKET" or order.get("status") != "NEW" or order.get("reduceOnly") is not True or order.get("side") != ("SELL" if leg["side"] == "LONG" else "BUY"):
            _fail("STOP_VENUE_IDENTITY_MISMATCH")
        order_qty = _number(order.get("origQty"), "STOP_ORIG_QTY", positive=True)
        _quantity_equal(order_qty, leg["quantity"], "STOP")
        if _number(order.get("executedQty"), "STOP_EXECUTED_QTY", nonnegative=True) != 0:
            _fail("STOP_ALREADY_EXECUTED")
        if _number(order.get("stopPrice"), "STOP_TRIGGER", positive=True) != trigger:
            _fail("STOP_TRIGGER_MISMATCH")
        bindings.append({"legId": leg_id, "symbol": leg["symbol"], "side": leg["side"], "legQty": _decimal_text(leg["quantity"]),
                         "orderQty": _decimal_text(order_qty), "stopPrice": _decimal_text(trigger), "clientOrderId": cid, "venueOrderId": venue_id,
                         "orderSide": order["side"], "type": order["type"], "status": order["status"], "reduceOnly": True,
                         "executedQty": "0", "positionSide": "BOTH"})
    if selected != set(venue_orders):
        _fail("UNOWNED_VENUE_ORDER")
    for cid, intent in intents.items():
        if intent["action"] == "STOP" and cid not in selected and intent["stage"] != "TERMINAL":
            _fail("UNRESOLVED_UNSELECTED_STOP")
    for leg_id, protection in protections.items():
        protection = _object(protection, "PROTECTION")
        if leg_id not in legs or protection.get("legId") != leg_id:
            _fail("ORPHAN_PROTECTION")
        if leg_id not in active and protection.get("phase") != "CLOSED":
            _fail("INACTIVE_PROTECTION_NOT_CLOSED")

    record = {"schema": "disdex-v4-sole-inventory/v1", "releaseSha": expected_sha, "revision": revision,
              "documentSha256": _digest(_canonical(doc)), "positions": sorted(matched_positions, key=lambda row: row["symbol"]),
              "bindings": sorted(bindings, key=lambda row: row["legId"]), "journalReplayVerified": False}
    proof_json = _canonical(record)
    return {"verified": True, "verifiedLegs": len(active), "uniqueStopOrders": len(selected), "positionSymbols": sorted(seen_positions),
            "releaseSha": expected_sha, "revision": revision, "documentSha256": record["documentSha256"],
            "journalReplayVerified": False, "proofJson": proof_json, "proofSha256": _digest(proof_json)}
