"""Research synthetic coverage; absence of seven-runner shared replay is a blocker."""
from __future__ import annotations

import unittest
from unittest.mock import patch

from scripts import stable4_seven_native_coverage_audit as audit


class SevenRunnerNativeCoverageTests(unittest.TestCase):
    def test_actual_evidence_is_partial_not_a_seven_runner_native_replay(self):
        report = audit.evaluate()
        self.assertTrue(report["status"].startswith("BLOCKED_"))
        self.assertEqual(report["sourceEvidenceByteDigestsMatched"], all(v["matched"] for v in report["sourceEvidenceIntegrity"].values()))
        self.assertEqual(set(report["runnerCoverage"]), set(audit.RUNNERS))
        self.assertEqual(report["threeSleeveSharedWalletCases"], 12)
        self.assertEqual(report["q102IsolatedCases"], 8)
        self.assertEqual(report["hypeIsolatedCases"], 8)
        self.assertEqual(report["runnerCoverage"]["PENGU"], "NO_NATIVE_SYNTHETIC_REPLAY")
        self.assertEqual(report["runnerCoverage"]["V52"], "NO_NATIVE_STOCK_SESSION_SYNTHETIC_REPLAY")
        self.assertFalse(report["singleSevenRunnerNativeReplay"])
        self.assertFalse(report["completeYearFromCurrentPinnedRunnerSources"])
        self.assertFalse(report["portfolioFundingAndExecutableProtectionProven"])
        self.assertFalse(report["orderAuthority"])
        self.assertFalse(report["rootCertificateIssued"])

    def test_source_tampering_rejected_before_any_coverage_claim(self):
        with patch.object(audit, "exact_sha", return_value="0" * 64):
            report = audit.evaluate()
        self.assertEqual(report["status"], "BLOCKED_SOURCE_SHA_MISMATCH")
        self.assertFalse(report["sourceEvidenceByteDigestsMatched"])
        self.assertTrue(all(not v["matched"] for v in report["sourceEvidenceIntegrity"].values()))
        self.assertFalse(report["orderAuthority"])


if __name__ == "__main__":
    unittest.main()
