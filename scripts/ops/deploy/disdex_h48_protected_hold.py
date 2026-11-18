#!/usr/bin/env python3
"""Validate the STABLE4 H48 protected HOLD for read-only operations only.

The H48 certificate is an order-enabled deployment approval, while the
GLOBAL HOLD receipt deliberately grants no order authority.  A protected HOLD
must therefore be accepted by observation/audit code only when the root-bound
receipt and the exact Kill Switch bytes agree.  An expired receipt may still
describe the provenance of an already-active HOLD for diagnostics, but it
never becomes a deployment or order-enablement authorization.
"""
from __future__ import annotations

import hashlib
import re
from typing import Any

SOURCE = "e0e4f1d8f22b62e9410188ef6e590a20e31f760f"
PLAN = "82d9eb3f4ff4c9787f59c1843a69249e66df6d95696e426b4ee984719ad152ce"
REASON = "STABLE4_RESEARCH_ROLLOUT:" + SOURCE
KILL_PATH = "/var/lib/disdex/shared/kill-switch.json"
HOLD_SCOPE = "HYPE_TREND_LONG"
HOLD_SCHEMA = "disdex-stable4-protected-hold-owner/v1"
MAX_RECEIPT_AGE_MS = 50 * 60 * 1000
SHA40 = re.compile(r"^[0-9a-f]{40}$")
SHA64 = re.compile(r"^[0-9a-f]{64}$")


class H48ProtectedHoldError(ValueError):
    """A root-bound H48 observation contract is not valid."""


def _fail(reason: str) -> None:
    raise H48ProtectedHoldError("H48_PROTECTED_HOLD_" + reason)


def _int_timestamp(value: Any, label: str) -> int:
    # bool is an int subclass, but is not a timestamp.
    if type(value) is not int or value <= 0:
        _fail(label + "_INVALID")
    return value


def validate_h48_protected_hold(
    kill: dict[str, Any],
    receipt: dict[str, Any],
    kill_bytes: bytes,
    now_ms: int,
    *,
    allow_expired_observation: bool = False,
) -> dict[str, Any]:
    """Return a no-order observation record or fail closed.

    ``allow_expired_observation`` is intentionally explicit and is only for
    read-only diagnostics.  Callers that prepare, start, promote, clear, or
    enable orders must leave it false and must reject the expired result.
    """
    if not isinstance(kill, dict) or not isinstance(receipt, dict):
        _fail("RECEIPT_OR_KILL_NOT_OBJECT")
    if type(kill_bytes) is not bytes:
        _fail("KILL_BYTES_INVALID")
    now = _int_timestamp(now_ms, "CLOCK")

    expected_receipt_keys = {
        "approvedSha", "authorizesOrders", "expiresAt", "issuedAt",
        "killSwitchPath", "killSwitchSha256", "planSha256", "reason",
        "schema", "scope", "v4Sha",
    }
    if set(receipt) != expected_receipt_keys:
        _fail("RECEIPT_FIELDS_INVALID")
    if receipt.get("schema") != HOLD_SCHEMA:
        _fail("RECEIPT_SCHEMA_INVALID")
    if receipt.get("approvedSha") != SOURCE or receipt.get("planSha256") != PLAN:
        _fail("RECEIPT_SOURCE_OR_PLAN_MISMATCH")
    if receipt.get("killSwitchPath") != KILL_PATH:
        _fail("RECEIPT_KILL_PATH_MISMATCH")
    if receipt.get("scope") != HOLD_SCOPE or receipt.get("authorizesOrders") is not False:
        _fail("RECEIPT_ORDER_SCOPE_INVALID")
    if not isinstance(receipt.get("v4Sha"), str) or not SHA40.fullmatch(receipt["v4Sha"]):
        _fail("RECEIPT_V4_SHA_INVALID")
    if not SHA64.fullmatch(str(receipt.get("killSwitchSha256") or "")):
        _fail("RECEIPT_KILL_HASH_INVALID")
    actual_hash = hashlib.sha256(kill_bytes).hexdigest()
    if receipt["killSwitchSha256"] != actual_hash:
        _fail("RECEIPT_KILL_HASH_MISMATCH")
    if receipt.get("reason") != REASON:
        _fail("RECEIPT_REASON_INVALID")

    issued = _int_timestamp(receipt.get("issuedAt"), "ISSUED_AT")
    expires = _int_timestamp(receipt.get("expiresAt"), "EXPIRES_AT")
    if issued > now or expires <= issued or expires - issued > MAX_RECEIPT_AGE_MS:
        _fail("RECEIPT_TIMELINE_INVALID")
    expired = expires <= now
    if expired and not allow_expired_observation:
        _fail("RECEIPT_EXPIRED")

    if (
        kill.get("active") is not True
        or kill.get("action") != "HOLD_PROTECTED"
        or kill.get("scope") != "GLOBAL"
        or kill.get("operator") != "disdex-stable4-formal-owner-hold"
        or kill.get("strategyId") != "STABLE4_H48_CUTOVER"
        or kill.get("recoverable") is not False
        or kill.get("reason") != REASON
    ):
        _fail("KILL_BINDING_INVALID")

    return {
        "schema": HOLD_SCHEMA,
        "sourceSha": SOURCE,
        "planSha256": PLAN,
        "v4Sha": receipt["v4Sha"],
        "scope": HOLD_SCOPE,
        "killSwitchActive": True,
        "ordersEnabled": False,
        "authorizesOrders": False,
        "expired": expired,
    }
