"""Exact review-only DD30 candidate checks; never a formal release authorization."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from scripts.ops.deploy import stable4_dd30_integrated_source_gate as historical

ROOT = Path(__file__).resolve().parents[3]
OLD = "docs/production/STABLE4_DD30_INTEGRATED_SOURCE_MANIFEST_20261123.json"
REVIEW = "docs/research/STABLE4_DD30_CURRENT_CANDIDATE_REVIEW_20261128.json"
PREVIOUS_REVIEW = "docs/research/STABLE4_PROPOSED_SOURCE_INTEGRITY_20261127.json"
OLD_GATE = "scripts/ops/deploy/stable4_dd30_integrated_source_gate.py"
PINS = {
    OLD: "4609dec4085f03b3be28d9fd69ff8f76e7bfad2766f49dc3a8e3f03f1566ec1e",
    REVIEW: "b7ed827e35b6bdd9f46d9e91ce1889ec461b2097059725dada874696edd86398",
    PREVIOUS_REVIEW: "4e68c8c2ddabf9944ca0d21ea82d20e3aa0357ca848f3c183d9aa44ed9c59c81",
    OLD_GATE: "0429affe04523b6c76acfea64788b45c5d891b9aeb192efdb971ed6bd43cb83c",
}
DRIFT = {
    "lib/aster-v3-client.ts", "lib/pengu-dual-ls-v2-portfolio-runner.ts",
    "lib/v12-v4-runner-engine.ts", "lib/v12-v4-shared-reservations.ts",
    "lib/v12-v4-venue-exit.ts", "scripts/disdex_v52_aster_only_legacy_engine.py",
}


def review_digest(raw: bytes) -> str:
    # Windows checkouts may apply CRLF conversion. Linux CI uses exact bytes.
    return (historical.normalized_digest(raw) if os.name == "nt"
            else hashlib.sha256(raw).hexdigest())


def verify_review(root: Path = ROOT) -> dict:
    root = root.resolve()
    for rel, expected in PINS.items():
        path = root / rel
        if (not path.is_file() or path.is_symlink()
                or not path.resolve().is_relative_to(root)
                or review_digest(path.read_bytes()) != expected):
            raise AssertionError("DD30_REVIEW_EVIDENCE_MISMATCH:" + rel)
    old = json.loads((root / OLD).read_text(encoding="utf-8"))
    review = json.loads((root / REVIEW).read_text(encoding="utf-8"))
    if (review.get("schema") != "stable4-proposed-source-integrity/v1"
            or review.get("status") != "REVIEW_ONLY_NO_CERTIFICATE"
            or review.get("historicalManifestSha256") != PINS[OLD]
            or review.get("previousResearchManifestSha256") != PINS[PREVIOUS_REVIEW]
            or any(review.get(k) is not False for k in
                   ("productionEligible", "orderAuthority", "rootCertificateIssued", "ownerApprovalVerified"))):
        raise AssertionError("DD30_REVIEW_AUTHORITY_BOUNDARY_INVALID")
    previous = old["sourceSha256"]
    current = review["sourceSha256"]
    if (set(previous) != set(current) or set(current) != set(historical.REQUIRED_TOKENS)
            or {p for p in current if current[p] != previous[p]} != DRIFT
            or set(review["changedPaths"]) != DRIFT):
        raise AssertionError("DD30_REVIEW_DRIFT_SCOPE_INVALID")
    # Verify the candidate with its independently recorded pins, only in memory.
    # The on-disk historical manifest and strict gate remain untouched.
    for rel, expected in current.items():
        path = root / rel
        if (not path.is_file() or path.is_symlink()
                or not path.resolve().is_relative_to(root)
                or review_digest(path.read_bytes()) != expected):
            raise AssertionError("INTEGRATED_SOURCE_SHA_MISMATCH:" + rel)
    candidate = {**old, "sourceSha256": current}
    result = historical.verify(root, candidate)
    try:
        historical.verify(root)
    except AssertionError as exc:
        if str(exc) != "INTEGRATED_SOURCE_SHA_MISMATCH:" + sorted(DRIFT)[0]:
            raise
    else:
        raise AssertionError("DD30_HISTORICAL_GATE_MUST_REMAIN_BLOCKED")
    return {
        **result, "status": "REVIEW_ONLY_NOT_FORMALLY_CERTIFIED",
        "historicalFormalGate": "BLOCKED_EXPECTED_SOURCE_DRIFT",
        "reviewedSourceDriftCount": len(DRIFT),
        "ownerApprovalVerified": False, "formalCertificateIssued": False,
        "productionEligible": False,
    }


if __name__ == "__main__":
    print(json.dumps(verify_review(), sort_keys=True))
