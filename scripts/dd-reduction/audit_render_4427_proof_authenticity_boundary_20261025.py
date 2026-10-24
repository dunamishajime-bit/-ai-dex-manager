#!/usr/bin/env python3
"""Research-only proof-authenticity audit. No native allocator or orders."""
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE.parents[1] / "docs/research/results/render-three-regime-20261024"


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


auth = load("render4427_auth_audit", "render_4427_native_proof_authenticity_20261025.py")
pre = load("render4427_prealloc_audit", "render_4427_native_preallocation_asof_proof_20261025.py")
contract = auth.contract


def audit():
    old = pre.run_audit()
    c = contract.example_candidate(1782176400000)
    fabricated = contract.GateProof(True, "a" * 64, c.entry_ts_ms, c.key())
    ctx = contract.Context(
        **{name: fabricated for name in contract.REQUIRED_PROOFS},
        open_symbols=(), pending_symbols=(), cooldown_until_ms=0
    )
    format_only = contract.assess(c, ctx)
    if format_only.verdict != contract.Verdict.NEED_NATIVE_ALLOCATOR or format_only.native_order_authorized:
        raise RuntimeError("FORMAT_ONLY_REPRODUCTION_CHANGED")
    real = {}
    for cost in ("10", "30"):
        original = old["costs"][cost]
        checks = []
        for item in original["candidates"]:
            # No independently pinned trusted manifest, nor candidate-bound gate
            # evidence bytes, exist in this audited preallocation artifact set.
            # We do not synthesize a PASS or infer a missing artifact exists nowhere.
            c = contract.Candidate(contract.STRATEGY, contract.ROUTE, contract.SYMBOL,
                                   contract.SIDE, int(item["preentry_projection"]["entry_ts_ms"]),
                                   float(item["requested_gross"]), contract.OWNER, contract.CAPITAL_OWNER)
            assert c.key() == item["candidate_key"]
            decision = auth.assess_with_trust(c, None, None, {}, None, None, None)
            assert decision.verdict == contract.Verdict.REJECT
            checks.append(dict(utc=item["utc"], candidate_key=c.key(),
                               verdict=decision.verdict.value, reasons=list(decision.reasons),
                               order_authorized=decision.native_order_authorized))
        real[cost] = dict(preallocation_sha256=original["converged_preallocation_sha256"],
                          independent_raw_replay_verified=original["independent_processes_and_converged_iterations_identical"],
                          candidates=checks)
    return {
        "status": "RESEARCH_ONLY_PROOF_AUTHENTICITY_GAP_CONFIRMED_FAIL_CLOSED",
        "finding": "Old GateProof.valid verifies digest shape, not artifact bytes or trusted provenance",
        "synthetic_format_only_verdict": format_only.verdict.value,
        "synthetic_format_only_order_authorized": format_only.native_order_authorized,
        "new_verifier_requires": "externally pinned manifest digest plus exact canonical candidate-bound as-of artifact bytes for all 13 gates",
        "trusted_native_manifest_available_in_audited_inputs": False,
        "actual_native_owner_registered": False,
        "native_allocator_executed_with_new_owner": False,
        "new_economic_backtest_performed": False,
        "real_candidate_checks": real,
        "limitations": [
            "The 64-hex format-only acceptance is a research preflight validation gap, not evidence of a LIVE exploit",
            "NEED_NATIVE_ALLOCATOR is not an order authorization",
            "Synthetic test fixtures do not constitute native venue or runtime evidence",
            "A digest provided by the candidate itself is NOT a trusted out-of-band root",
            "No authenticated native proof bytes or externally pinned trust root found in the audited preallocation artifacts",
            "2025 Aster RENDER H1 mark missing; Aster M5 fills and Funding not certified",
            "Previously explored 2026 Aug-Oct is not unused OOS",
            "No VPS, LIVE, Production, HP, or real order changes"
        ]
    }


def main():
    report = audit()
    output = OUT / "RENDER_4427_PROOF_AUTHENTICITY_BOUNDARY_AUDIT_20261025.json"
    output.write_text(json.dumps(report, sort_keys=True, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("AUDIT_SHA256", hashlib.sha256(output.read_bytes()).hexdigest())
    print("FORMAT_ONLY", report["synthetic_format_only_verdict"])
    print("REAL_CANDIDATES_REJECTED", {k:len(v["candidates"]) for k,v in report["real_candidate_checks"].items()})
    print("OUTPUT", output)


if __name__ == "__main__":
    main()
