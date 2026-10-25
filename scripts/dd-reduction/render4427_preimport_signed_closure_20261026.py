#!/usr/bin/env python3
"""RESEARCH ONLY: pre-import, externally pinned source/patch verifier.

Does not import/exec target code, register an owner, authorize orders, or
authenticate Native8 inventory/GateProof. The operator must independently
supply the trusted public-key fingerprint; no signer is provisioned here.
"""
from __future__ import annotations
import base64
import hashlib
import json
import os
from pathlib import Path
import re
from typing import Any
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

class ClosureRejected(ValueError):
    pass

def _reject(code: str) -> None:
    raise ClosureRejected(code)

def _hex64(value: Any) -> bool:
    return type(value) is str and re.fullmatch(r"[0-9a-f]{64}", value) is not None

def _canonical(obj: Any) -> bytes:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=False, allow_nan=False).encode("utf-8")

def _file_bytes(path: str) -> bytes:
    p = Path(path)
    if not p.is_absolute() or p.is_symlink():
        _reject("REJECT_COMPONENT_PATH_NOT_ABSOLUTE_OR_SYMLINK")
    if not p.is_file() or os.path.normcase(str(p.resolve(strict=True))) != os.path.normcase(str(p)):
        _reject("REJECT_COMPONENT_PATH_NOT_STABLE")
    return p.read_bytes()

def verify_research_closure(
    *, manifest_bytes: bytes, signature_b64: str, trust_public_key_raw: bytes,
    independent_key_sha256: str, expected_subject: str,
    expected_roles: frozenset[str], allowed_output_parent: str,
) -> dict:
    """Verify byte identity and literal patches, NEVER native order admission.

    independent_key_sha256, expected_roles and allowed_output_parent must
    originate from independent operator policy, not candidate/manifest.
    This function cannot prove their provenance.
    """
    if not _hex64(independent_key_sha256):
        _reject("REJECT_NO_INDEPENDENT_KEY_PIN")
    if type(trust_public_key_raw) is not bytes or len(trust_public_key_raw) != 32:
        _reject("REJECT_INVALID_EXTERNAL_PUBLIC_KEY")
    if hashlib.sha256(trust_public_key_raw).hexdigest() != independent_key_sha256:
        _reject("REJECT_TRUST_KEY_NOT_INDEPENDENTLY_PINNED")
    if type(manifest_bytes) is not bytes or len(manifest_bytes) > 262144:
        _reject("REJECT_MANIFEST_SIZE_OR_TYPE")
    try:
        payload = json.loads(manifest_bytes.decode("utf-8"))
    except (UnicodeError, ValueError):
        _reject("REJECT_MALFORMED_MANIFEST")
    if type(payload) is not dict or _canonical(payload) != manifest_bytes:
        _reject("REJECT_NONCANONICAL_MANIFEST")
    try:
        sig = base64.b64decode(signature_b64, validate=True)
        Ed25519PublicKey.from_public_bytes(trust_public_key_raw).verify(sig, manifest_bytes)
    except (ValueError, TypeError, InvalidSignature):
        _reject("REJECT_MANIFEST_SIGNATURE_INVALID")
    if payload.get("schema") != "RENDER4427_PREIMPORT_RESEARCH_V1" or payload.get("subject") != expected_subject:
        _reject("REJECT_MANIFEST_SCOPE")
    components = payload.get("components")
    if type(components) is not dict or set(components) != expected_roles or not components:
        _reject("REJECT_INCOMPLETE_OR_EXTRA_COMPONENT_SET")
    if type(allowed_output_parent) is not str or not Path(allowed_output_parent).is_absolute():
        _reject("REJECT_NO_INDEPENDENT_OUTPUT_POLICY")
    output = payload.get("output_path")
    if type(output) is not str or not Path(output).is_absolute():
        _reject("REJECT_OUTPUT_PATH_INVALID")
    parent = Path(allowed_output_parent).resolve(strict=True)
    output_path = Path(output).resolve(strict=False)
    if output_path == parent or parent not in output_path.parents:
        _reject("REJECT_OUTPUT_OUTSIDE_INDEPENDENT_POLICY")
    if any(p.is_symlink() for p in [Path(output), *Path(output).parents]):
        _reject("REJECT_OUTPUT_SYMLINK")
    sources = {}
    for role in sorted(expected_roles):
        item = components[role]
        if type(item) is not dict or set(item) != {"path", "sha256"}:
            _reject("REJECT_COMPONENT_SCHEMA")
        if not _hex64(item["sha256"]):
            _reject("REJECT_COMPONENT_SHA_INVALID")
        data = _file_bytes(item["path"])
        if hashlib.sha256(data).hexdigest() != item["sha256"]:
            _reject("REJECT_COMPONENT_BYTES_DRIFT:" + role)
        sources[role] = data
    transforms = payload.get("literal_transforms")
    if type(transforms) is not list or not transforms:
        _reject("REJECT_DYNAMIC_TRANSFORM_CLOSURE_UNATTESTED")
    transform_names = set()
    for t in transforms:
        if type(t) is not dict or set(t) != {"name", "source_role", "old", "new", "expected_sha256"}:
            _reject("REJECT_TRANSFORM_SCHEMA")
        name, role = t["name"], t["source_role"]
        if type(name) is not str or name in transform_names or role not in sources:
            _reject("REJECT_TRANSFORM_IDENTITY")
        transform_names.add(name)
        if not _hex64(t["expected_sha256"]):
            _reject("REJECT_TRANSFORM_SHA_INVALID")
        old, new = t["old"], t["new"]
        if type(old) is not str or type(new) is not str or not old or old == new:
            _reject("REJECT_TRANSFORM_REPLACEMENT_INVALID")
        try:
            source = sources[role].decode("utf-8")
        except UnicodeError:
            _reject("REJECT_TRANSFORM_SOURCE_NOT_UTF8")
        if source.count(old) != 1 or new in source:
            _reject("REJECT_TRANSFORM_HOOK_NOT_UNIQUE")
        rewritten = source.replace(old, new, 1).encode("utf-8")
        if hashlib.sha256(rewritten).hexdigest() != t["expected_sha256"]:
            _reject("REJECT_TRANSFORMED_BYTES_DRIFT")
    # Partial signed source identity != proof of complete runtime closure.
    return {"status": "PARTIAL_SIGNED_SOURCE_PIN_RESEARCH_ONLY",
            "components_byte_verified": len(sources),
            "literal_transforms_byte_verified": len(transform_names),
            "complete_dynamic_import_closure_authenticated": False,
            "native_owner_registered": False, "gateproofs_authenticated": 0,
            "native_allocator_authorized": False, "order_authorized": False}
