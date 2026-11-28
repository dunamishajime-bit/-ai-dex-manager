"""Validate the actual 46 local Aster H1 archive SHA/coverage audit snapshot."""
from __future__ import annotations

import copy
import json
import unittest
from pathlib import Path

from scripts.research.stable4_q102_aster_h1_archive_source_audit import verify_snapshot, verify_btc_aster_binance_conflict, verify_btc_native_m5_disagreement, verify_btc_181d_h1_m5_source_parity

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


    def test_btc_same_label_m5_bars_are_not_authorized_to_repair_h1(self):
        m5=json.loads((EVIDENCE.parent/"STABLE4_Q102_BTC_H1_ASTERNAMED_M5_12BAR_CONFLICT_20261128.json").read_text(encoding="utf8"))
        h1=json.loads((EVIDENCE.parent/"STABLE4_Q102_BTC_H1_ASTERVS_BINANCE_BAD_BAR_20261128.json").read_text(encoding="utf8"))
        verify_btc_native_m5_disagreement(m5,h1)
        self.assertEqual(m5["invalidM5Indices"],[10])
        self.assertGreater(m5["m5Aggregate"]["high"],m5["h1Recorded"]["high"])
        self.assertFalse(m5["automaticH1RepairApplied"])
        mutators=[
            lambda d:d.__setitem__("automaticH1RepairApplied",True),
            lambda d:d.__setitem__("venueExecutionCertified",True),
            lambda d:d["source"].__setitem__("sha256","0"*64),
            lambda d:d["m5Rows"][10].__setitem__("ohlcValid",True),
            lambda d:d["m5Rows"][10].__setitem__("high",d["m5Rows"][10]["open"]),
            lambda d:d["m5Aggregate"].__setitem__("high",115916.1),
            lambda d:d["m5Rows"][11].__setitem__("openTimeMs",0),
        ]
        for f in mutators:
            forged=copy.deepcopy(m5)
            f(forged)
            with self.assertRaisesRegex(ValueError,"Q102_BTC_M5_H1"):
                verify_btc_native_m5_disagreement(forged,h1)


    def test_btc_full_181d_h1_m5_differences_not_silently_erased(self):
        report=json.loads((EVIDENCE.parent/"STABLE4_Q102_BTC_181D_ASTER_H1_M5_SOURCE_PARITY_20261128.json").read_text(encoding="utf8"))
        verify_btc_181d_h1_m5_source_parity(report,self.report)
        self.assertEqual(report["hoursCompared"],4344)
        self.assertEqual(report["mismatchHours"],85)
        self.assertEqual(report["invalidH1Bars"],1)
        self.assertEqual(report["invalidM5Bars"],1)
        self.assertEqual(report["mismatchSegmentation"]["anyOHLCMismatchWithFirstM5Zero"],84)
        self.assertEqual(report["mismatchSegmentation"]["anyOHLCMismatchWithFirstM5Positive"],1)
        self.assertEqual(report["mismatchSegmentation"]["firstM5ZeroVolumeHours"],86)
        self.assertFalse(report["nativeQ102ProductionParityProven"])
        for change in (
            lambda d:d.__setitem__("mismatchHours",0),
            lambda d:d["mismatchedFields"].__setitem__("high",0),
            lambda d:d["mismatchSegmentation"].__setitem__("firstM5ZeroVolumeHours",0),
            lambda d:d["mismatchSegmentation"].__setitem__("anyOHLCMismatchWithFirstM5Positive",0),
            lambda d:d.__setitem__("autoRepairApplied",True),
            lambda d:d["monthly"]["2025-09"].__setitem__("different",0),
            lambda d:d["m5Source"].__setitem__("sha256","f"*64),
            lambda d:d.__setitem__("executionPriceCertified",True),
        ):
            forged=copy.deepcopy(report)
            change(forged)
            with self.assertRaisesRegex(ValueError,"Q102_BTC_181D_PARITY"):
                verify_btc_181d_h1_m5_source_parity(forged,self.report)


if __name__ == "__main__":
    unittest.main()
