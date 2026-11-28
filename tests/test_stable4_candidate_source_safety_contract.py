"""Review-only verification of the 23 candidate SHA pins and essential production guards.

Never changes the historical approved manifest, grants order authority, or invokes a venue.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path, PurePosixPath
import unittest

ROOT = Path(__file__).resolve().parents[1]
PROPOSED = json.loads((ROOT / "docs/research/STABLE4_PROPOSED_SOURCE_INTEGRITY_20261127.json").read_text(encoding="utf-8"))
HISTORICAL_PATH = ROOT / "docs/production/STABLE4_DD30_INTEGRATED_SOURCE_MANIFEST_20261123.json"
HISTORICAL = json.loads(HISTORICAL_PATH.read_text(encoding="utf-8"))
GATE_FILE = ROOT / "scripts/ops/deploy/stable4_dd30_integrated_source_gate.py"
SPEC = importlib.util.spec_from_file_location("historical_stable4_integrity_gate_review", GATE_FILE)
assert SPEC is not None and SPEC.loader is not None
GATE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(GATE)

EXPECTED_DIFFS = {
    "lib/aster-v3-client.ts",
    "lib/pengu-dual-ls-v2-portfolio-runner.ts",
    "lib/v12-v4-runner-engine.ts",
    "lib/v12-v4-shared-reservations.ts",
}


class CandidateSafetyContractTests(unittest.TestCase):
    def test_review_only_authority_is_explicitly_unissued(self):
        self.assertEqual(PROPOSED["status"], "REVIEW_ONLY_NO_CERTIFICATE")
        for key in ("productionEligible", "orderAuthority", "rootCertificateIssued", "ownerApprovalVerified"):
            self.assertIs(PROPOSED[key], False, key)

    def test_23_candidate_files_match_exact_bytes_and_preserve_required_tokens(self):
        pins = PROPOSED["sourceSha256"]
        self.assertEqual(PROPOSED["schema"], "stable4-proposed-source-integrity/v1")
        self.assertEqual(len(pins), 23)
        self.assertEqual(set(pins), set(GATE.REQUIRED_TOKENS))
        for rel, expected in pins.items():
            with self.subTest(path=rel):
                parts = PurePosixPath(rel)
                self.assertFalse(parts.is_absolute())
                self.assertNotIn("..", parts.parts)
                target = ROOT / rel
                self.assertTrue(target.is_file() and not target.is_symlink())
                self.assertTrue(target.resolve().is_relative_to(ROOT.resolve()))
                raw = target.read_bytes()
                self.assertEqual(hashlib.sha256(raw).hexdigest(), expected)
                contents = raw.decode("utf-8-sig")
                for required in GATE.REQUIRED_TOKENS[rel]:
                    self.assertIn(required, contents, f"essential contract missing: {rel}: {required}")

    def test_historical_approval_digests_are_immutable_and_diff_is_explicit(self):
        self.assertEqual(hashlib.sha256(HISTORICAL_PATH.read_bytes()).hexdigest(), PROPOSED["historicalManifestSha256"])
        previous = HISTORICAL["sourceSha256"]
        current = PROPOSED["sourceSha256"]
        self.assertEqual(set(previous), set(current))
        self.assertEqual({p for p in previous if previous[p] != current[p]}, EXPECTED_DIFFS)
        self.assertEqual(set(PROPOSED["changedPaths"]), EXPECTED_DIFFS)

    def test_formal_approved_source_gate_still_rejects_this_draft(self):
        with self.assertRaisesRegex(AssertionError, "INTEGRATED_SOURCE_SHA_MISMATCH"):
            GATE.verify(ROOT)


if __name__ == "__main__":
    unittest.main()
