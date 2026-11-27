"""Real 36 MAIN + 31 EARLY H1 source SHA, 181d prehistory, annual price readiness."""
from __future__ import annotations

import copy
import json
import unittest
from pathlib import Path

from scripts.research.stable4_q102_extended_aster_h1_archive_coverage import (
    verify_reviewed_snapshot,
    verify_snapshot,
)

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "docs/research/STABLE4_Q102_36MAIN_31EARLY_ASTERV3_H1_SOURCE_READINESS_20261128.json"


class ExtendedQ102H1RealArchives(unittest.TestCase):
    def setUp(self):
        self.raw = EVIDENCE.read_bytes()
        self.data = json.loads(self.raw)

    def test_21_tickers_have_181d_and_full_year_h1_without_proving_any_fill(self):
        result = verify_reviewed_snapshot(self.raw)
        self.assertEqual(result["mainSymbols"], 36)
        self.assertEqual(result["earlySymbols"], 31)
        self.assertEqual(result["yearAndPrior181dReadyCount"], 21)
        self.assertEqual(result["prior181dHours"], 4344)
        self.assertEqual(result["yearHours"], 8760)
        self.assertEqual(result["missingEarlySymbols"], ["FET", "JUP", "RENDER", "TAO", "TIA"])
        self.assertEqual(result["perTicker"]["BTC"]["prior181d"]["invalidHours"], 1)
        self.assertEqual(result["perTicker"]["ENA"]["prior181d"]["missingHours"], 1309)
        self.assertEqual(result["perTicker"]["LDO"]["early"]["rows"], 0)
        self.assertFalse(result["fullNativeQ102AnnualEntryOrExitProven"])
        self.assertFalse(result["fullSevenRunnerSharedWalletReplayed"])
        self.assertFalse(result["orderAuthority"])

    def test_mutated_byte_report_is_rejected_by_pinned_git_source_blob(self):
        changed = self.raw.replace(b'"mainSymbols": 36', b'"mainSymbols": 37', 1)
        self.assertNotEqual(changed, self.raw)
        with self.assertRaisesRegex(ValueError, "Q102_EXTENDED_H1_REVIEWED_SNAPSHOT_SHA_MISMATCH"):
            verify_reviewed_snapshot(changed)

    def test_critical_source_corruption_or_scope_claim_is_blocked(self):
        cases = [
            lambda x: x.__setitem__("productionEligible", True),
            lambda x: x.__setitem__("mainSymbols", 35),
            lambda x: x["perTicker"]["BTC"]["prior181d"].__setitem__("invalidHours", 0),
            lambda x: x["perTicker"]["BTC"]["prior181d"].__setitem__("closedH1HistoryReady", True),
            lambda x: x["perTicker"]["FET"]["studyYear"].__setitem__("missingHours", 0),
            lambda x: x["perTicker"]["ADA"]["main"].__setitem__("sha256", "a"),
            lambda x: x["perTicker"]["LDO"]["early"].__setitem__("rows", 1),
            lambda x: x["perTicker"]["AAVE"].__setitem__("signalOrVenueExecutionProven", True),
            lambda x: x.__setitem__("yearAndPrior181dReadyCount", 36),
        ]
        for mutation in cases:
            forged = copy.deepcopy(self.data)
            mutation(forged)
            with self.assertRaisesRegex(ValueError, "Q102_EXTENDED_H1_"):
                verify_snapshot(forged)


if __name__ == "__main__":
    unittest.main()
