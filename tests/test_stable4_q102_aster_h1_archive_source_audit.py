"""Validate the actual 46 local Aster H1 archive SHA/coverage audit snapshot."""
from __future__ import annotations

import copy
import json
import unittest
from pathlib import Path

from scripts.research.stable4_q102_aster_h1_archive_source_audit import verify_snapshot, verify_btc_aster_binance_conflict

EVIDENCE = Path(__file__).resolve().parents[1] / "docs/research/STABLE4_Q102_ASTER_H1_181D_ARCHIVE_SOURCE_INTEGRITY_20261128.json"


class Q102AsterHistoryTests(unittest.TestCase):
    def setUp(self):
        self.report = json.loads(EVIDENCE.read_text(encoding="utf8"))

    def test_six_full_181day_causal_sources_without_any_execution_certification(self):
        verify_snapshot(self.report)
        self.assertEqual(self.report["mainSymbols"], 36)
        self.assertEqual(self.report["warmupSymbols"], 10)
        self.assertEqual(self.report["matchingCount"], 8)
        self.assertEqual(self.report["matchedWarmupCoveringTargetStart"], ["APT", "ARB", "ONDO", "OP", "SEI", "SUI"])
        warm = self.report["folders"]["aster-public-v3-h1-q102-warmup"]
        self.assertEqual(warm["BTC"]["prehistory181dInvalidOHLCOrTime"], 1)
        self.assertLess(warm["ENA"]["prehistory181dRows"], 4344)
        self.assertFalse(self.report["executionQuotesOrFillsCertified"])
        self.assertFalse(self.report["productionEligible"])

    def test_forged_coverage_sha_candle_or_live_claim_fails_closed(self):
        cases = [
            lambda o: o.__setitem__("orderAuthority", True),
            lambda o: o["folders"]["aster-public-v3-h1-q102-warmup"]["BTC"].__setitem__("covers181dToTargetStart", True),
            lambda o: o["folders"]["aster-public-v3-h1-q102-warmup"]["APT"].__setitem__("prehistory181dRows", 4),
            lambda o: o["folders"]["aster-public-v3-h1"]["SOL"].__setitem__("sha256", "a"),
            lambda o: o.__setitem__("matchingCount", 36),
            lambda o: o.__setitem__("executionQuotesOrFillsCertified", True),
        ]
        for change in cases:
            trial = copy.deepcopy(self.report)
            change(trial)
            with self.assertRaisesRegex(ValueError, "Q102_H1_ARCHIVE"):
                verify_snapshot(trial)



    def test_btc_invalid_hour_reproduces_in_two_aster_files_but_binance_is_not_repair(self):
        conflict_file=EVIDENCE.parent/"STABLE4_Q102_BTC_H1_ASTERVS_BINANCE_BAD_BAR_20261128.json"
        conflict=json.loads(conflict_file.read_text(encoding="utf8"))
        verify_btc_aster_binance_conflict(conflict,self.report)
        self.assertLess(conflict["aster"]["high"],conflict["aster"]["open"])
        self.assertGreaterEqual(conflict["binanceReference"]["high"],conflict["binanceReference"]["open"])
        self.assertFalse(conflict["priceSubstitutionAllowed"])
        self.assertFalse(conflict["orderAuthority"])
        mutations=[
            lambda d:d.__setitem__("priceSubstitutionAllowed",True),
            lambda d:d.__setitem__("q102VenueCausalHistoryFixed",True),
            lambda d:d["aster"].__setitem__("high",d["aster"]["open"]),
            lambda d:d["aster"]["sources"][0].__setitem__("sha256","0"*64),
            lambda d:d["binanceReference"].__setitem__("isSameVenue",True),
        ]
        for mutation in mutations:
            fake=copy.deepcopy(conflict)
            mutation(fake)
            with self.assertRaisesRegex(ValueError,"Q102_BTC_CROSS_VENUE"):
                verify_btc_aster_binance_conflict(fake,self.report)


if __name__ == "__main__":
    unittest.main()
