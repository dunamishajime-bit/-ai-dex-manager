"""Offline candidate review gate tests, including strict historical rejection."""
from pathlib import Path
import shutil
import tempfile
import unittest
from scripts.ops.deploy import stable4_dd30_candidate_review_gate as gate


class CandidateReviewGateTest(unittest.TestCase):
    def test_review_passes_without_formal_authority(self):
        result = gate.verify_review()
        self.assertEqual(result["integratedFilesVerified"], 23)
        self.assertEqual(result["reviewedSourceDriftCount"], 6)
        self.assertEqual(result["historicalFormalGate"], "BLOCKED_EXPECTED_SOURCE_DRIFT")
        for field in ("ownerApprovalVerified", "formalCertificateIssued", "productionEligible",
                      "productionInstalled", "liveOrderAuthorization"):
            self.assertIs(result[field], False)

    def test_historical_gate_still_rejects_candidate(self):
        with self.assertRaisesRegex(AssertionError, "INTEGRATED_SOURCE_SHA_MISMATCH"):
            gate.historical.verify(gate.ROOT)

    def test_tampered_review_or_source_cannot_pass(self):
        files = set(gate.PINS) | set(gate.historical.REQUIRED_TOKENS) | {gate.historical.FORMAL_OLD_ROOT}
        for rel, error in (
            (gate.REVIEW, "DD30_REVIEW_EVIDENCE_MISMATCH"),
            (gate.OLD, "DD30_REVIEW_EVIDENCE_MISMATCH"),
            (gate.OLD_GATE, "DD30_REVIEW_EVIDENCE_MISMATCH"),
            ("lib/aster-v3-client.ts", "INTEGRATED_SOURCE_SHA_MISMATCH"),
            ("lib/v12-v4-runner-engine.ts", "INTEGRATED_SOURCE_SHA_MISMATCH"),
        ):
            with self.subTest(rel=rel), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                for name in files:
                    dest = root / name
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(gate.ROOT / name, dest)
                with (root / rel).open("ab") as stream:
                    stream.write(b"\n# tampered")
                with self.assertRaisesRegex(AssertionError, error):
                    gate.verify_review(root)


if __name__ == "__main__":
    unittest.main()
