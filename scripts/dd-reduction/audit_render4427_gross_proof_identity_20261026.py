#!/usr/bin/env python3
"""RENDER #4427 research-only proof/gross identity audit.

Fetches two exact GitHub source bytes from a pinned research ref. Runs only
the pure owner-route contract and AST-extracted proof functions in memory.
Synthetic proofs are NOT Native8 attestations. No file writes or orders.
"""
from __future__ import annotations

import ast
from dataclasses import replace
import hashlib
import json
import sys
import types
import typing
from urllib.request import urlopen

REF = "research/render4427-verified-byte-consumption-boundary-20261026"
BASE = ("https://raw.githubusercontent.com/dunamishajime-bit/"
        "-ai-dex-manager/" + REF + "/scripts/dd-reduction/")
CONTRACT_SHA = "35925b10dc29f80c6331ffcfac62ade104b499480ceb1275888c80a01df31ac2"
PROOF_SHA = "ec63c4d18e05e1a978c467284298657c584882b1291d223a81e5279c642773fc"
TS = 1780000000000
FUTURE = frozenset(("exit_ts_ms", "exit_price", "unit_price_return",
                    "exit_reason", "realized_pnl", "modeled_realized_pnl",
                    "future_return", "forward_return"))


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical(value) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=False, allow_nan=False).encode("utf-8")


def get_pinned(name: str, expected: str) -> bytes:
    with urlopen(BASE + name, timeout=20) as response:
        raw = response.read()
    if sha(raw) != expected:
        raise RuntimeError("REJECT_SOURCE_BYTES_NOT_PINNED:" + name)
    return raw


def proof_functions_only(raw: bytes, contract, optimize: int):
    tree = ast.parse(raw)
    selected = {"digest", "canonical", "future_keys", "check"}
    nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef)
             and node.name in selected]
    if {node.name for node in nodes} != selected:
        raise RuntimeError("REJECT_PROOF_FUNCTION_SET_DRIFT")
    env = {
        "hashlib": hashlib, "json": json, "contract": contract,
        "Mapping": typing.Mapping, "FORBIDDEN_FUTURE": FUTURE,
        "HEX": frozenset("0123456789abcdef"),
    }
    # AST extraction prevents module-scope imports/side effects from running.
    isolated = ast.fix_missing_locations(ast.Module(body=nodes, type_ignores=[]))
    exec(compile(isolated, "pinned_proof_functions.py", "exec",
                 optimize=optimize), env)
    return env["check"]


def run() -> dict:
    source = get_pinned("render_4427_independent_owner_route_contract_20261025.py",
                        CONTRACT_SHA)
    proof_source = get_pinned("render_4427_native_proof_authenticity_20261025.py",
                              PROOF_SHA)
    tree = ast.parse(source)
    allowed = (ast.Import, ast.ImportFrom, ast.Assign, ast.ClassDef,
               ast.FunctionDef, ast.Expr)
    if any(not isinstance(node, allowed) for node in tree.body):
        raise RuntimeError("REJECT_CONTRACT_MODULE_SCOPE_DRIFT")
    results = []
    for optimize in (0, 1, 2):
        name = "render4427_gross_proof_audit_" + str(optimize)
        module = types.ModuleType(name)
        sys.modules[name] = module
        # This pinned pure research contract contains definitions only.
        exec(compile(source, "pinned_owner_contract.py", "exec",
                     optimize=optimize), module.__dict__)
        candidate = module.example_candidate(TS)
        fake = module.GateProof(True, "a" * 64, TS - 1, candidate.key())
        ctx = module.Context(
            **{gate: fake for gate in module.REQUIRED_PROOFS},
            open_symbols=(), pending_symbols=(), cooldown_until_ms=TS - 1,
        )
        direct = []
        for gross in (0.25, 0.125, 0.01, 0.26):
            changed = replace(candidate, requested_gross=gross)
            verdict = module.assess(changed, ctx)
            direct.append({
                "gross": gross, "same_candidate_key": changed.key() == candidate.key(),
                "verdict": verdict.verdict.value,
                "order_authorized": verdict.native_order_authorized,
            })
        if not all(x["same_candidate_key"] and x["verdict"] == "NEED_NATIVE_ALLOCATOR"
                   and x["order_authorized"] is False for x in direct[:3]):
            raise RuntimeError("REJECT_DIRECT_GROSS_REPLAY_NOT_REPRODUCED")
        if direct[3]["verdict"] != "REJECT":
            raise RuntimeError("REJECT_GROSS_CAP_DRIFT")
        artifacts = {}
        manifest_proofs = {}
        for gate in module.REQUIRED_PROOFS:
            raw = canonical({
                "gate": gate, "candidate_key": candidate.key(), "passed": True,
                "asof_ts_ms": TS - 1, "source": "synthetic_not_native",
                "requested_gross": candidate.requested_gross,
            })
            artifacts[gate] = raw
            manifest_proofs[gate] = {"sha256": sha(raw), "asof_ts_ms": TS - 1}
        manifest = canonical({
            "version": 1, "candidate_key": candidate.key(),
            "owner_id": module.OWNER, "route": module.ROUTE,
            "capital_owner": module.CAPITAL_OWNER,
            "requested_gross": candidate.requested_gross,
            "proofs": manifest_proofs,
        })
        check = proof_functions_only(proof_source, module, optimize)
        same_ok, _, _ = check(candidate, manifest, sha(manifest), artifacts)
        changed = replace(candidate, requested_gross=0.125)
        changed_ok, reasons, _ = check(changed, manifest, sha(manifest), artifacts)
        if same_ok is not True or changed_ok is not False or reasons != (
                "TRUST_MANIFEST_BINDING_MISMATCH",):
            raise RuntimeError("REJECT_STRICT_GROSS_BINDING_DRIFT")
        results.append({
            "optimize": optimize, "direct_assess": direct,
            "strict_same_gross": same_ok,
            "strict_changed_gross": changed_ok,
            "strict_changed_reason": reasons[0],
        })
    return {
        "status": "RESEARCH_ONLY_GROSS_PROOF_BINDING_GAP_CONFIRMED",
        "source_sha256": CONTRACT_SHA, "proof_source_sha256": PROOF_SHA,
        "synthetic_only": True, "native_root_authenticated": False,
        "native_owner_registered": False, "gateproofs_authenticated": 0,
        "native_allocator_authorized": False, "order_authorized": False,
        "results": results,
    }


if __name__ == "__main__":
    report = run()
    payload = canonical(report)
    print("AUDIT_PASS_RESEARCH_ONLY")
    print("CANONICAL_JSON_SHA256", sha(payload))
    print(payload.decode("utf-8"))
