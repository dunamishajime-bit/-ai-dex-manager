#!/usr/bin/env python3
"""RESEARCH ONLY: verify candidate-key-bound native as-of proof authenticity.

A 64-character digest string is NOT proof of provenance.  This verifier
requires an independently pinned manifest digest, and checks every byte
of every native proof artifact against that manifest.  No real trusted
manifest is provided by this module; absent one, fail closed.
No live, production, or native allocator admission is performed.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
from pathlib import Path
from typing import Mapping

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location(
    "render4427_proof_contract_strict", HERE / "render_4427_independent_owner_route_contract_20261025.py"
)
contract = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = contract
spec.loader.exec_module(contract)

FORBIDDEN_FUTURE = frozenset((
    "exit_ts_ms", "exit_price", "unit_price_return", "exit_reason",
    "realized_pnl", "modeled_realized_pnl", "future_return", "forward_return"
))
HEX = frozenset("0123456789abcdef")


def digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def canonical(raw: bytes) -> dict:
    """Require exact canonical JSON bytes; no duplicate keys or hidden values."""
    def no_duplicates(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("DUPLICATE_JSON_KEY")
            result[key] = value
        return result
    obj = json.loads(raw.decode("utf-8"), object_pairs_hook=no_duplicates)
    if not isinstance(obj, dict):
        raise ValueError("EXPECTED_JSON_OBJECT")
    encoded = json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    if raw != encoded:
        raise ValueError("NONCANONICAL_JSON")
    return obj


def future_keys(value) -> bool:
    if isinstance(value, dict):
        return bool(FORBIDDEN_FUTURE.intersection(value)) or any(future_keys(v) for v in value.values())
    if isinstance(value, list):
        return any(future_keys(v) for v in value)
    return False


def check(candidate, manifest_bytes: bytes | None, trusted_manifest_sha256: str | None,
          artifacts: Mapping[str, bytes]) -> tuple[bool, tuple[str, ...], object]:
    """Verify bytes and a trust anchor supplied out of band.

    The expected manifest hash MUST originate outside the candidate/manifest
    being checked. Self-asserted hashes and candidate row labels are rejected.
    """
    problems = []
    if not isinstance(trusted_manifest_sha256, str) or len(trusted_manifest_sha256) != 64 or set(trusted_manifest_sha256) - HEX:
        problems.append("TRUSTED_MANIFEST_DIGEST_ABSENT")
    if not isinstance(manifest_bytes, bytes):
        problems.append("TRUSTED_MANIFEST_BYTES_ABSENT")
    if problems:
        return False, tuple(problems), None
    if digest(manifest_bytes) != trusted_manifest_sha256:
        return False, ("TRUST_ROOT_DIGEST_MISMATCH",), None
    try:
        manifest = canonical(manifest_bytes)
    except (ValueError, UnicodeError) as exc:
        return False, ("INVALID_TRUST_MANIFEST:" + str(exc),), None
    if (manifest.get("version") != 1 or manifest.get("candidate_key") != candidate.key()
        or manifest.get("owner_id") != contract.OWNER
        or manifest.get("route") != contract.ROUTE
        or manifest.get("capital_owner") != contract.CAPITAL_OWNER
        or manifest.get("requested_gross") != candidate.requested_gross):
        return False, ("TRUST_MANIFEST_BINDING_MISMATCH",), None
    if future_keys(manifest):
        return False, ("FUTURE_FIELD_IN_MANIFEST",), None
    if set(manifest) != {"version", "candidate_key", "owner_id", "route", "capital_owner", "requested_gross", "proofs"}:
        return False, ("UNEXPECTED_TRUST_MANIFEST_FIELDS",), None
    proofs = manifest.get("proofs")
    if not isinstance(proofs, dict) or set(proofs) != set(contract.REQUIRED_PROOFS):
        return False, ("MISSING_OR_EXTRA_GATE_PROOF",), None
    if set(artifacts) != set(contract.REQUIRED_PROOFS):
        return False, ("MISSING_OR_EXTRA_GATE_ARTIFACT",), None
    validated = {}
    for gate in contract.REQUIRED_PROOFS:
        item = proofs[gate]
        raw = artifacts[gate]
        if not isinstance(item, dict) or not isinstance(raw, bytes):
            return False, ("INVALID_PROOF_RECORD:" + gate,), None
        if set(item) != {"sha256", "asof_ts_ms"}:
            return False, ("UNEXPECTED_GATE_PROOF_RECORD_FIELDS:" + gate,), None
        if item.get("sha256") != digest(raw):
            return False, ("ARTIFACT_DIGEST_MISMATCH:" + gate,), None
        try:
            body = canonical(raw)
        except (ValueError, UnicodeError) as exc:
            return False, ("INVALID_GATE_ARTIFACT:" + gate + ":" + str(exc),), None
        if future_keys(body):
            return False, ("FUTURE_FIELD_IN_GATE_ARTIFACT:" + gate,), None
        if set(body) != {"gate", "candidate_key", "passed", "asof_ts_ms", "source", "requested_gross"}:
            return False, ("UNEXPECTED_GATE_ARTIFACT_FIELDS:" + gate,), None
        asof = body.get("asof_ts_ms")
        if (body.get("gate") != gate or body.get("candidate_key") != candidate.key()
            or body.get("requested_gross") != candidate.requested_gross
            or body.get("passed") is not True
            or not isinstance(asof, int) or isinstance(asof, bool)
            or asof > candidate.entry_ts_ms or asof < 1
            or item.get("asof_ts_ms") != asof
            or not isinstance(body.get("source"), str) or not body["source"].strip()):
            return False, ("GATE_ASOF_OR_BINDING_MISMATCH:" + gate,), None
        validated[gate] = contract.GateProof(True, digest(raw), asof, candidate.key())
    return True, (), validated


def assess_with_trust(candidate, manifest_bytes, trusted_manifest_sha256, artifacts,
                      open_symbols=None, pending_symbols=None, cooldown_until_ms=None):
    ok, reasons, proofs = check(candidate, manifest_bytes, trusted_manifest_sha256, artifacts)
    if not ok:
        return contract.Decision(contract.Verdict.REJECT, reasons)
    ctx = contract.Context(
        **proofs, open_symbols=open_symbols, pending_symbols=pending_symbols,
        cooldown_until_ms=cooldown_until_ms
    )
    return contract.assess(candidate, ctx)
