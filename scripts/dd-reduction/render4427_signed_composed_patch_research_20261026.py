#!/usr/bin/env python3
"""Research-only signed *composed* literal-transform attestation.

Pure bytes; no imports/exec of target code, no filesystem writes, no orders.
The external key fingerprint AND expected final hash must come from a genuinely
independent operator policy. This module cannot establish their provenance.
"""
from __future__ import annotations
import base64
import hashlib
import json
import re
from typing import Any
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

class ComposedPlanRejected(ValueError):
    pass

def reject(reason: str) -> None:
    raise ComposedPlanRejected(reason)

def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def hex64(x: Any) -> bool:
    return type(x) is str and re.fullmatch(r"[0-9a-f]{64}", x) is not None

def canonical(x: Any) -> bytes:
    return json.dumps(x, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
                      allow_nan=False).encode("utf-8")

def verify_signed_composed_plan_research_only(
    *, manifest_bytes: bytes, signature_b64: str, public_key_raw: bytes,
    independent_public_key_sha256: str, independent_final_sha256: str,
    source_bytes: bytes, expected_subject: str,
) -> dict:
    """Check a single immutable source snapshot and the entire ordered patch chain.

    The signed manifest binds input, all ordered intermediate hashes, and final
    bytes. Does not attest runtime path, module-scope side effects, imports,
    operator key provenance, Native8, owner, GateProof, or live safety.
    """
    if not hex64(independent_public_key_sha256) or not hex64(independent_final_sha256):
        reject("REJECT_NO_INDEPENDENT_OPERATOR_PINS")
    if type(public_key_raw) is not bytes or len(public_key_raw) != 32:
        reject("REJECT_INVALID_PUBLIC_KEY")
    if sha(public_key_raw) != independent_public_key_sha256:
        reject("REJECT_PUBLIC_KEY_PIN_MISMATCH")
    if type(manifest_bytes) is not bytes or len(manifest_bytes) > 262144:
        reject("REJECT_MANIFEST_TYPE_OR_SIZE")
    if type(source_bytes) is not bytes or len(source_bytes) > 4000000:
        reject("REJECT_SOURCE_TYPE_OR_SIZE")
    try:
        payload = json.loads(manifest_bytes.decode("utf-8"))
        if type(payload) is not dict or canonical(payload) != manifest_bytes:
            reject("REJECT_NONCANONICAL_MANIFEST")
    except (ValueError, UnicodeError, TypeError):
        reject("REJECT_MALFORMED_MANIFEST")
    try:
        signature = base64.b64decode(signature_b64, validate=True)
        Ed25519PublicKey.from_public_bytes(public_key_raw).verify(signature, manifest_bytes)
    except (ValueError, TypeError, InvalidSignature):
        reject("REJECT_SIGNATURE_INVALID")
    if set(payload) != {"schema", "subject", "source_sha256", "steps", "final_sha256"}:
        reject("REJECT_MANIFEST_SCHEMA")
    if payload["schema"] != "RENDER4427_COMPOSED_PATCH_RESEARCH_V1" or payload["subject"] != expected_subject:
        reject("REJECT_SUBJECT")
    if not hex64(payload["source_sha256"]) or sha(source_bytes) != payload["source_sha256"]:
        reject("REJECT_SOURCE_DRIFT")
    steps = payload["steps"]
    if type(steps) is not list or not 1 <= len(steps) <= 32:
        reject("REJECT_STEPS_MISSING_OR_OVERSIZED")
    current = source_bytes
    names = set()
    for i, step in enumerate(steps):
        if type(step) is not dict or set(step) != {"name", "old", "new", "stage_sha256"}:
            reject("REJECT_STEP_SCHEMA")
        name, old, new, expected_stage = (step[k] for k in ("name", "old", "new", "stage_sha256"))
        if type(name) is not str or not name or name in names:
            reject("REJECT_STEP_NAME")
        names.add(name)
        if type(old) is not str or type(new) is not str or not old or old == new or not hex64(expected_stage):
            reject("REJECT_STEP_FIELDS")
        try:
            text = current.decode("utf-8")
        except UnicodeError:
            reject("REJECT_NON_UTF8_SOURCE")
        if text.count(old) != 1 or new in text:
            reject("REJECT_STEP_NOT_UNIQUE:" + str(i))
        current = text.replace(old, new, 1).encode("utf-8")
        if sha(current) != expected_stage:
            reject("REJECT_STAGE_SHA_MISMATCH:" + str(i))
    if not hex64(payload["final_sha256"]) or sha(current) != payload["final_sha256"]:
        reject("REJECT_SIGNED_FINAL_SHA_MISMATCH")
    if sha(current) != independent_final_sha256:
        reject("REJECT_INDEPENDENT_FINAL_SHA_MISMATCH")
    return {"status": "SYNTHETIC_COMPOSED_SOURCE_VERIFIED_RESEARCH_ONLY",
            "stages_verified": len(steps), "final_source_sha256": sha(current),
            "complete_dynamic_import_closure_authenticated": False,
            "operator_trust_root_authenticated": False,
            "native_owner_registered": False, "gateproofs_authenticated": 0,
            "native_allocator_authorized": False, "order_authorized": False}
