"""Research synthetic coverage; absence of seven-runner shared replay is a blocker."""
from __future__ import annotations

import unittest
import json
import tempfile
from pathlib import Path
from unittest.mock import patch

from scripts import stable4_seven_native_coverage_audit as audit


class SevenRunnerNativeCoverageTests(unittest.TestCase):
    def test_actual_evidence_is_partial_not_a_seven_runner_native_replay(self):
        report = audit.evaluate()
        self.assertTrue(report["status"].startswith("BLOCKED_"))
        self.assertEqual(report["sourceEvidenceByteDigestsMatched"], all(v["matched"] for v in report["sourceEvidenceIntegrity"].values()))
        self.assertEqual(set(report["runnerCoverage"]), set(audit.RUNNERS))
        self.assertEqual(report["threeSleeveSharedWalletCases"], 12)
        self.assertEqual(report["fourSleeveSharedWalletCases"], 12)
        self.assertFalse(report["fourSleeveComparisonAdopted"])
        self.assertTrue(report["noCurrentSourceNativeSharedWalletPortfolioResult"])
        self.assertEqual(report["penguAsterM5SignalTape"]["h1RawSignalArmCounts"], {"BASE":54,"V8_V64":112})
        self.assertEqual(report["penguAsterM5SignalTape"]["first5mPositiveVolumeByArm"], {"BASE":32,"V8_V64":69})
        self.assertEqual(report["penguAsterM5SignalTape"]["first15mAllZeroByArm"], {"BASE":9,"V8_V64":18})
        self.assertEqual(report["penguAsterM5SignalTape"]["verifiedVenueFills"], 0)
        self.assertTrue(report["penguAsterM5SignalTape"]["m5VolumeIsNotExecutableFillProof"])
        self.assertFalse(report["q102AsterArchiveCausal181d"]["monthlyReadyIsNativeTradeProof"])
        self.assertEqual(report["q102AsterArchiveCausal181d"]["monthlyRolling181dReadyByTicker"]["BTC"], 6)
        self.assertEqual(report["q102AsterArchiveCausal181d"]["monthlyRolling181dReadyByTicker"]["ENA"], 10)
        self.assertEqual(report["realMarketNativeSourceScope"]["PENGU"],
            "BINANCE_H1_RAW_SOURCE_ENTRY_166_OF_166_ONLY_NOT_VENUE")
        self.assertEqual(report["realMarketNativeSourceScope"]["Q102"],
            "BTC_SOL_12_MONTH_START_SOURCE_HIGH_VOL_CHECKPOINTS_ONLY")
        self.assertEqual(report["realMarketNativeSourceScope"]["V52"],
            "FIVE_STOCK_ASTER_M5_YAHOO_H1_INPUT_COVERAGE_ONLY")
        self.assertFalse(report["v52RegularSessionVolumeAudit"]["fiveStockVenueExecutablePricesOrFillsProven"])
        self.assertGreater(report["v52RegularSessionVolumeAudit"]["zeroVolumePercentByTicker"]["AMZN"], 60)
        self.assertGreater(report["v52RegularSessionVolumeAudit"]["zeroVolumePercentByTicker"]["TSLA"], 29)
        self.assertEqual(report["runnerCoverage"]["HYPE"], "PARTIAL_NATIVE_HYPE_IN_FOUR_SLEEVE_SHARED_WALLET")
        self.assertTrue(report["sourceEvidenceIntegrity"]["fourSleeveCurrentSource"]["matched"])
        self.assertEqual(report["q102IsolatedCases"], 8)
        self.assertEqual(report["hypeIsolatedCases"], 8)
        self.assertEqual(report["runnerCoverage"]["PENGU"], "NO_NATIVE_SYNTHETIC_REPLAY")
        self.assertEqual(report["runnerCoverage"]["V52"], "NO_NATIVE_STOCK_SESSION_SYNTHETIC_REPLAY")
        self.assertFalse(report["singleSevenRunnerNativeReplay"])
        self.assertFalse(report["completeYearFromCurrentPinnedRunnerSources"])
        self.assertFalse(report["portfolioFundingAndExecutableProtectionProven"])
        self.assertFalse(report["orderAuthority"])
        self.assertFalse(report["rootCertificateIssued"])

    def test_real_native_evidence_falsification_rejected(self):
        for path_attr, mutate, expected in [
            ("PENGU_NATIVE", lambda x: x["arms"]["BASE"].__setitem__("checked", 53),
             "PENGU_REAL_H1_NATIVE_ONLY_EVIDENCE_INVALID"),
            ("Q102_REAL", lambda x: x.__setitem__("portfolioReplayComplete", True),
             "Q102_LIMITED_REAL_H1_NATIVE_EVIDENCE_INVALID"),
            ("V52_COVERAGE", lambda x: x["perTicker"]["AMZN"]["asterM5"].__setitem__("rows", 1),
             "V52_LIQUIDITY_ROW_OR_PROVENANCE_INVALID"),
        ]:
            original = getattr(audit, path_attr)
            evidence = json.loads(original.read_text(encoding="utf8"))
            mutate(evidence)
            with tempfile.TemporaryDirectory() as directory:
                mock_file = Path(directory) / "fake.json"
                mock_file.write_text(json.dumps(evidence), encoding="utf8")
                with patch.object(audit, path_attr, mock_file):
                    with self.assertRaisesRegex(ValueError, expected):
                        audit.evaluate()

    def test_source_tampering_rejected_before_any_coverage_claim(self):
        with patch.object(audit, "exact_sha", return_value="0" * 64):
            report = audit.evaluate()
        self.assertEqual(report["status"], "BLOCKED_SOURCE_SHA_MISMATCH")
        self.assertFalse(report["sourceEvidenceByteDigestsMatched"])
        self.assertTrue(all(not v["matched"] for v in report["sourceEvidenceIntegrity"].values()))
        self.assertFalse(report["orderAuthority"])


if __name__ == "__main__":
    unittest.main()
