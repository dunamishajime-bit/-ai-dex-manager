#!/usr/bin/env python3
"""RESEARCH ONLY: immutable Native8 preallocation evidence audit for RENDER #4427.

This is a read-only sidecar at the *preallocation manifest* boundary, not a
registration in the Native8 allocator. No overlay mutation, no order permission.
Future exit labels in a simulated trade MUST NOT become entry-time GateProofs.
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import importlib.util
import json
import re

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location(
    "render4427_preflight_contract",
    HERE / "render_4427_independent_owner_route_contract_20261025.py",
)
contract = importlib.util.module_from_spec(SPEC)
import sys
sys.modules[SPEC.name] = contract
SPEC.loader.exec_module(contract)

ROOT = Path("C:/tmp/render4427-fresh-process-audit-20261025")
RESULTS = Path(__file__).resolve().parents[2] / "docs/research/results/render-three-regime-20261024"
TARGET_UTC = ("2026-05-27T21:00", "2026-06-23T01:00", "2026-06-25T07:00")
ROUTE = contract.ROUTE

# Static research registry, NOT a Native8 runtime registry.
RESEARCH_ROUTE = {
    "route": contract.ROUTE,
    "owner_id": contract.OWNER,
    "capital_owner": contract.CAPITAL_OWNER,
    "strategy_id": contract.STRATEGY,
    "symbol": contract.SYMBOL,
    "side": contract.SIDE,
    "max_requested_gross": 0.25,
    "native_registered": False,
}
# These are entry-time identifiers only. Exits and realized outcomes are excluded.
ASOF_FIELDS = (
    "strategy_id", "route", "symbol", "side", "entry_ts_ms",
    "signal_ts_ms", "requested_gross", "entry_price",
)
FUTURE_OUTCOME_FIELDS = ("exit_ts_ms", "exit_price", "unit_price_return", "exit_reason")
SOURCE_ATTESTATION_FIELDS = (
    "native_owner_registration_sha256", "owner_priority_asof_sha256",
    "shared_risk_asof_sha256", "gross_asof_sha256", "margin_guard_asof_sha256",
    "kill_switch_asof_sha256", "account_lock_asof_sha256",
    "pending_inventory_asof_sha256", "dedup_asof_sha256",
)


def sha_file(path: Path) -> str:
    h = sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def load_jsonl(path: Path):
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                yield json.loads(line)


def utc(ts: int) -> str:
    return datetime.fromtimestamp(ts / 1000, timezone.utc).strftime("%Y-%m-%dT%H:%M")


def candidate_from_preallocation(row: dict) -> contract.Candidate:
    # An explicit, non-live research registry is not proof of native registration.
    if (row.get("strategy_id"), row.get("route"), row.get("symbol"), row.get("side")) != (
        contract.STRATEGY, ROUTE, contract.SYMBOL, contract.SIDE
    ):
        raise ValueError("RESEARCH_ROUTE_BINDING_MISMATCH")
    return contract.Candidate(
        strategy_id=row["strategy_id"], route=row["route"],
        symbol=row["symbol"], side=row["side"],
        entry_ts_ms=row["entry_ts_ms"],
        requested_gross=row["requested_gross"],
        owner_id=contract.OWNER, capital_owner=contract.CAPITAL_OWNER,
    )


def preallocation_record(row: dict) -> dict:
    c = candidate_from_preallocation(row)
    # No synthetic PASS. Real source digests must come from independent,
    # immutable, candidate-key-bound native as-of attestations.
    missing = contract.GateProof(None, None, None, None)
    ctx = contract.Context(
        **{name: missing for name in contract.REQUIRED_PROOFS},
        open_symbols=None, pending_symbols=None, cooldown_until_ms=None,
    )
    decision = contract.assess(c, ctx)
    assert decision.verdict == contract.Verdict.REJECT
    future = [name for name in FUTURE_OUTCOME_FIELDS if name in row]
    late = row.get("exit_ts_ms") is not None and row["exit_ts_ms"] > row["entry_ts_ms"]
    native_proof = [name for name in SOURCE_ATTESTATION_FIELDS if name in row]
    runtime_label = row.get("source_runtime_sha")
    runtime_is_sha = bool(isinstance(runtime_label, str) and re.fullmatch(r"[a-fA-F0-9]{64}", runtime_label))
    return {
        "utc": utc(c.entry_ts_ms),
        "candidate_key": c.key(),
        "research_registry_bound": True,
        "native_registry_verified": False,
        "requested_gross": c.requested_gross,
        "preentry_projection": {k: row.get(k) for k in ASOF_FIELDS},
        "future_outcome_fields_in_manifest": future,
        "exit_after_entry": late,
        "native_attestation_fields_present": native_proof,
        "runtime_label_is_sha256": runtime_is_sha,
        "preallocation_verdict": "REJECT_FAIL_CLOSED",
        "reasons": list(decision.reasons),
        "order_authorized": False,
    }


def converged_files(process: str, cost: int):
    root = ROOT / process
    files = sorted(p for p in root.rglob("candidate-decisions.jsonl")
                   if p.parent.name == f"PRICE_MODEL_{cost}BPS")
    if len(files) != 3:
        raise RuntimeError(("EXPECTED_THREE_FIXED_POINT_ITERATIONS", process, cost, len(files)))
    groups = {}
    for p in files:
        groups.setdefault(sha_file(p), []).append(p)
    converged = [g for g in groups.values() if len(g) == 2]
    if len(converged) != 1:
        raise RuntimeError(("CONVERGENCE_NOT_PROVEN", process, cost))
    return converged[0], next(iter(g for g in groups if len(groups[g]) == 2))


def run_audit() -> dict:
    report = {
        "status": "RESEARCH_ONLY_NATIVE_PREALLOCATION_FAIL_CLOSED",
        "owner": contract.OWNER,
        "route": ROUTE,
        "native_registry_modified": False,
        "native_allocator_executed_with_new_owner": False,
        "overlay_block_modified": False,
        "economic_backtest_performed": False,
        "costs": {},
    }
    for cost in (10, 30):
        a_files, decision_sha = converged_files("A", cost)
        b_files, b_sha = converged_files("B", cost)
        if decision_sha != b_sha:
            raise RuntimeError(("FRESH_PROCESS_DECISION_SHA_MISMATCH", cost))
        rows_by_process = []
        for process, files in (("A", a_files), ("B", b_files)):
            manifests = []
            for p in files:
                manifest = p.parent.parent.parent / "candidates" / "crypto-price-model-candidates.jsonl"
                if not manifest.is_file():
                    raise RuntimeError(("PREALLOCATION_MANIFEST_MISSING", process, cost))
                original_sha = sha_file(manifest)
                rows = [r for r in load_jsonl(manifest) if r.get("route") == ROUTE]
                if len(rows) != 3:
                    raise RuntimeError(("RENDER_CANDIDATE_COUNT_DRIFT", process, cost, len(rows)))
                records = [preallocation_record(r) for r in sorted(rows, key=lambda r: r["entry_ts_ms"])]
                if tuple(x["utc"] for x in records) != TARGET_UTC:
                    raise RuntimeError(("RENDER_CANDIDATE_TIMES_DRIFT", process, cost))
                if sha_file(manifest) != original_sha:
                    raise RuntimeError(("FROZEN_INPUT_MUTATED", process, cost))
                manifests.append({"sha256": original_sha, "records": records})
            if manifests[0] != manifests[1]:
                raise RuntimeError(("CONVERGED_PREALLOCATION_NOT_IDENTICAL", process, cost))
            rows_by_process.append(manifests[0])
        if rows_by_process[0] != rows_by_process[1]:
            raise RuntimeError(("INDEPENDENT_PREALLOCATION_NOT_IDENTICAL", cost))
        selected = rows_by_process[0]
        if not all(x["exit_after_entry"] and len(x["future_outcome_fields_in_manifest"]) == 4
                   and not x["native_attestation_fields_present"] and not x["runtime_label_is_sha256"]
                   and x["preallocation_verdict"] == "REJECT_FAIL_CLOSED"
                   for x in selected["records"]):
            raise RuntimeError(("PREALLOCATION_CONTRACT_UNEXPECTED", cost))
        report["costs"][str(cost)] = {
            "converged_raw_decision_sha256": decision_sha,
            "converged_preallocation_sha256": selected["sha256"],
            "independent_processes_and_converged_iterations_identical": True,
            "candidates": selected["records"],
            "native_gate_proofs_authenticated": 0,
            "native_gate_proofs_required": len(contract.REQUIRED_PROOFS),
            "native_owner_admissions": 0,
        }
    keys10 = [x["candidate_key"] for x in report["costs"]["10"]["candidates"]]
    keys30 = [x["candidate_key"] for x in report["costs"]["30"]["candidates"]]
    if keys10 != keys30 or len(set(keys10)) != 3:
        raise RuntimeError("CANDIDATE_KEY_COST_PARITY_FAILED")
    return report


def main():
    report = run_audit()
    RESULTS.mkdir(parents=True, exist_ok=True)
    dest = RESULTS / "RENDER_4427_NATIVE_PREALLOCATION_ASOF_PROOF_AUDIT_20261025.json"
    dest.write_text(json.dumps(report, indent=2, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf8")
    print("AUDIT_PASS_RESEARCH_ONLY", dest)
    print("JSON_SHA256", sha_file(dest))
    for cost, c in report["costs"].items():
        print("COST", cost, "manifest", c["converged_preallocation_sha256"],
              "candidate_keys", [r["candidate_key"][:12] for r in c["candidates"]],
              "native_admissions", c["native_owner_admissions"])


if __name__ == "__main__":
    main()
