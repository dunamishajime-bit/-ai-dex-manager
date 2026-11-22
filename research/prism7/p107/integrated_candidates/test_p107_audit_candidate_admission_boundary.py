"""Regression tests: never convert source entry intentions into executed fills."""
import importlib.util
import json
import unittest
from pathlib import Path

DIR = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("p107_ownership", DIR / "p107_audit_candidate_admission_boundary.py")
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)

class CandidateAdmissionBoundaryTests(unittest.TestCase):
    def test_real_registry_coverage_and_concurrency(self):
        j = json.loads((DIR / "P107_SIX_RUNNER_ENTRY_SLOT_OWNERSHIP_GAP_20261123.json").read_text(encoding="utf-8"))
        a = j["analysis"]
        self.assertEqual(a["candidateCountByRunner"], audit.EXPECTED)
        self.assertEqual(a["sourceCandidateCount"], 1790)
        self.assertEqual(a["uniqueEntryTimestampCount"], 1295)
        self.assertEqual(a["concurrentCandidateTimestampCount"], 449)
        self.assertEqual(a["concurrentCrossRunnerTimestampCount"], 51)
        self.assertEqual(a["concurrentSameRunnerOnlyTimestampCount"], 398)
        self.assertEqual(a["sameSymbolSameTimestampCandidateGroups"], 0)
        self.assertEqual(a["maximumCandidatesAtOneTimestamp"], 3)
        self.assertEqual(a["maximumSameTimestampRequestedGrossIfAllAccepted"], 3.0)
        self.assertEqual(a["sameTimestampAllCandidateGrossOver3p5Count"], 0)
        self.assertEqual(a["sameTimestampAllCandidateGrossOver4p25Count"], 0)
        self.assertEqual(len(a["crossRunnerCandidateSlots"]), 51)
        self.assertEqual(j["inputSHA256"], "732c26af2411d3d67cbd77169999eeb486aabbe871c9ad8a50e5f4050fa5d7e4")
        self.assertEqual(j["verifiedReconstructedWindowsCRLFSHA256"], j["manifestOriginalWindowsCRLFSHA256"])

    def test_cannot_promote_candidates_to_fills(self):
        j = json.loads((DIR / "P107_SIX_RUNNER_ENTRY_SLOT_OWNERSHIP_GAP_20261123.json").read_text(encoding="utf-8"))
        self.assertFalse(j["fullCurrentSTABLE4PortfolioParity"])
        self.assertEqual(j["status"], "BLOCKED_NOT_FULL_PARITY")
        self.assertTrue(j["sourceCandidateOnly"])
        self.assertTrue(j["noInferredFillsOrNAVOrDD"])
        self.assertFalse(j["verifiedCrossRunnerOrderAdmission"])
        self.assertFalse(j["verifiedHistoricalPositionTimeline"])
        self.assertFalse(j["verifiedActualEffectiveTotalGrossCap"])
        self.assertIn("V52", j["missingNativeRunner"])
        self.assertTrue(all(not x["orderAdmissionResolved"] and not x["positionOwnershipResolved"]
                            for x in j["analysis"]["crossRunnerCandidateSlots"]))

    def test_reject_fake_signed_fill(self):
        row = {"entryTs": audit.START_MS + 3600000, "sourceDecisionTs": audit.START_MS,
               "runner": "PENGU", "sourcePinnedSHA": "pin", "symbol": "PENGUUSDT",
               "side": "LONG", "route": "TEST", "requestedGross": 1.0,
               "rawCandidateOnly": True, "signedFill": True, "simulatedOrder": False}
        with self.assertRaises(AssertionError):
            audit.compute([row])

    def test_reject_duplicate_candidate_key(self):
        row = {"entryTs": audit.START_MS + 3600000, "sourceDecisionTs": audit.START_MS,
               "runner": "PENGU", "sourcePinnedSHA": "pin", "symbol": "PENGUUSDT",
               "side": "LONG", "route": "TEST", "requestedGross": 1.0,
               "rawCandidateOnly": True, "signedFill": False, "simulatedOrder": False}
        with self.assertRaises(AssertionError):
            audit.compute([row, dict(row)])

    def test_total_gross_unverified_even_without_same_time_overage(self):
        j = json.loads((DIR / "P107_SIX_RUNNER_ENTRY_SLOT_OWNERSHIP_GAP_20261123.json").read_text(encoding="utf-8"))
        self.assertEqual(j["analysis"]["sameTimestampAllCandidateGrossOver3p5Count"], 0)
        self.assertFalse(j["verifiedCrossRunnerOpenPositionGrossAtTimestamp"])

if __name__ == "__main__":
    unittest.main()
