#!/usr/bin/env python3
"""Research-only synthetic GateProof freshness/sequence boundary audit.

No Native8 import, execution, trading, output files, or genuine receipts.
"""
from __future__ import annotations
import ast, hashlib, json, sys, types, typing
from urllib.request import urlopen

REF = "research/render4427-gross-proof-identity-audit-20261026"
BASE = "https://raw.githubusercontent.com/dunamishajime-bit/-ai-dex-manager/" + REF + "/scripts/dd-reduction/"
PINS = {
    "render_4427_independent_owner_route_contract_20261025.py": "35925b10dc29f80c6331ffcfac62ade104b499480ceb1275888c80a01df31ac2",
    "render_4427_native_proof_authenticity_20261025.py": "ec63c4d18e05e1a978c467284298657c584882b1291d223a81e5279c642773fc",
}
TS = 1780000000000
FUTURE = frozenset(("exit_ts_ms", "exit_price", "unit_price_return", "exit_reason",
                    "realized_pnl", "modeled_realized_pnl", "future_return", "forward_return"))

def sha(b):
    return hashlib.sha256(b).hexdigest()

def canon(o):
    return json.dumps(o, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
                      allow_nan=False).encode("utf-8")

def run():
    raws = {}
    for name, expected in PINS.items():
        with urlopen(BASE + name, timeout=20) as f:
            b = f.read()
        if sha(b) != expected:
            raise RuntimeError("REJECT_SOURCE_PIN_MISMATCH:" + name)
        raws[name] = b
    results = []
    for optimize in (0, 1, 2):
        contract = types.ModuleType("render4427_pure_contract_" + str(optimize))
        sys.modules[contract.__name__] = contract
        contract_source = raws["render_4427_independent_owner_route_contract_20261025.py"]
        contract_tree = ast.parse(contract_source)
        allowed = (ast.Import, ast.ImportFrom, ast.Assign, ast.ClassDef, ast.FunctionDef, ast.Expr)
        if any(not isinstance(node, allowed) for node in contract_tree.body):
            raise RuntimeError("REJECT_CONTRACT_MODULE_SCOPE_DRIFT")
        exec(compile(contract_source, "pinned_contract", "exec", optimize=optimize),
             contract.__dict__)
        tree = ast.parse(raws["render_4427_native_proof_authenticity_20261025.py"])
        selected = {"digest", "canonical", "future_keys", "check"}
        nodes = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in selected]
        if {n.name for n in nodes} != selected:
            raise RuntimeError("REJECT_STRICT_FUNCTION_SET_DRIFT")
        env = {"hashlib": hashlib, "json": json, "contract": contract,
               "Mapping": typing.Mapping, "FORBIDDEN_FUTURE": FUTURE,
               "HEX": frozenset("0123456789abcdef")}
        exec(compile(ast.fix_missing_locations(ast.Module(body=nodes, type_ignores=[])),
                     "pinned_strict_pure", "exec", optimize=optimize), env)
        check = env["check"]
        candidate = contract.example_candidate(TS)
        def trial(asofs, sources=None, extra_manifest=None, extra_artifact=None):
            artifacts, records = {}, {}
            for i, gate in enumerate(contract.REQUIRED_PROOFS):
                body = {"gate": gate, "candidate_key": candidate.key(), "passed": True,
                        "asof_ts_ms": asofs[i],
                        "source": sources[i] if sources else "synthetic_research_only",
                        "requested_gross": candidate.requested_gross}
                if extra_artifact and i == 0:
                    body.update(extra_artifact)
                raw = canon(body)
                artifacts[gate] = raw
                records[gate] = {"sha256": sha(raw), "asof_ts_ms": asofs[i]}
            manifest = {"version": 1, "candidate_key": candidate.key(),
                        "owner_id": contract.OWNER, "route": contract.ROUTE,
                        "capital_owner": contract.CAPITAL_OWNER,
                        "requested_gross": candidate.requested_gross, "proofs": records}
            if extra_manifest:
                manifest.update(extra_manifest)
            raw = canon(manifest)
            return check(candidate, raw, sha(raw), artifacts)[:2]
        fresh = [TS - 1] * 13
        tests = {
            "fresh_synthetic": trial(fresh),
            "stale_epoch_1": trial([1] * 13),
            "mixed_cross_epoch": trial([1 if i % 2 else TS - 1 for i in range(13)]),
            "arbitrary_nonempty_source": trial(
                fresh, ["unverified_source_" + str(i) for i in range(13)]),
            "future_asof": trial([TS + 1] * 13),
            "zero_asof": trial([0] * 13),
            "artifact_sequence_field": trial(fresh, extra_artifact={"sequence": 1}),
            "manifest_inventory_root_field": trial(
                fresh, extra_manifest={"inventory_root": "a" * 64}),
            "manifest_sequence_field": trial(fresh, extra_manifest={"sequence": 1}),
        }
        expected = {
            "fresh_synthetic": True, "stale_epoch_1": True,
            "mixed_cross_epoch": True, "arbitrary_nonempty_source": True,
            "future_asof": False, "zero_asof": False,
            "artifact_sequence_field": False, "manifest_inventory_root_field": False,
            "manifest_sequence_field": False,
        }
        for key, verdict in tests.items():
            if verdict[0] is not expected[key]:
                raise RuntimeError("REJECT_UNEXPECTED_CASE:" + key + ":" + str(verdict))
        results.append({"optimize": optimize,
                        "cases": {key: {"accepted": value[0], "reason": list(value[1])}
                                  for key, value in tests.items()}})
    return {"status": "RESEARCH_ONLY_SYNTHETIC_STRICT_PROOF_FRESHNESS_SEQUENCE_GAP",
            "pinned_sources": PINS, "native_attestation": False,
            "operator_root": False, "native_allocator": False,
            "order_authorized": False, "results": results}

if __name__ == "__main__":
    payload = canon(run())
    print("AUDIT_PASS", sha(payload))
    print(payload.decode("utf-8"))
