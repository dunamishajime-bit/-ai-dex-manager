#!/usr/bin/env python3
"""P9 immutable-pin identical-past, two-futures, fully matched native SHORT audit."""
from pathlib import Path
import collections
import json
import unittest
from statistics import mean

ROOT=Path(__file__).resolve().parents[1]
R=ROOT/"results"
P="PRISM7_P9_PINNED_NATIVE_IDENTICAL_PREFIX_FORK_SUMMARY_20261122"
def jl(file):
    return [json.loads(x) for x in (R/file).read_text(encoding="utf-8").splitlines() if x.strip()]

class TestP9(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.result=json.loads((R/(P+".json")).read_text(encoding="utf-8"))
        cls.paths=jl(P+"_PATHS.jsonl")
        cls.cases=jl(P+"_CASES.jsonl")
        cls.pairs=jl(P+"_TWIN_PAIRS.jsonl")

    def test_exact_full_grid(self):
        self.assertEqual(self.result["syntheticPaths"],192)
        self.assertEqual(len(self.paths),192)
        self.assertEqual(self.result["prefixNativeFeatureChecks"],8)
        self.assertEqual(len(self.pairs),13)
        self.assertEqual(len(self.cases),26)
        self.assertEqual(sum(p["sourceNaturalShortSignals"] for p in self.paths),26)
        self.assertEqual(self.result["pairedVerification"]["prefixPairs"],96)

    def test_same_history_bit_for_bit(self):
        grouped=collections.defaultdict(list)
        for p in self.paths:grouped[(p["mask_profile"],p["seed"])].append(p)
        self.assertEqual(len(grouped),96)
        for k,pair in grouped.items():
            self.assertEqual(len(pair),2)
            self.assertEqual(pair[0]["commonPrefixH1Sha256"],pair[1]["commonPrefixH1Sha256"])
            self.assertEqual(pair[0]["source_mask_start_m5_index"],pair[1]["source_mask_start_m5_index"])
            self.assertEqual(pair[0]["sourceNaturalShortSignals"],pair[1]["sourceNaturalShortSignals"])
            self.assertEqual(
                set(x["regime"] for x in pair),{"TWIN_DOWN_CONTINUES","TWIN_SQUEEZE"})

    def test_same_source_native_candidates(self):
        by=collections.defaultdict(list)
        for x in self.cases:
            by[(x["mask_profile"],x["seed"],x["signalHourIndex"])].append(x)
            self.assertEqual(x["native_exit_status"],"NATIVE_EXIT_MODELED")
            self.assertEqual(x["venue_signed_fill"],False)
            self.assertLess(x["signalHourIndex"],264+30)
        self.assertEqual(len(by),13)
        for key,pair in by.items():
            self.assertEqual(len(pair),2,key)
            for field in ("entryTs","entryHourOpenPrice","entryHourPositivePrint",
                          "firstPrintMinuteOffset","source_mask_start_m5_index",
                          "native_asof_features"):
                self.assertEqual(pair[0][field],pair[1][field],(key,field))
            self.assertAlmostEqual(
                pair[0]["native_price_net10_pct"]-pair[0]["native_price_net30_pct"],.2,places=10)

    def test_eight_winner_flip_without_future_information(self):
        p=self.result["pairedVerification"]
        self.assertEqual(p["identicalNativeEntryPairs"],13)
        self.assertEqual(p["downWinnerBecomesSqueezeLoser"],8)
        self.assertEqual(p["downLoserBecomesSqueezeWinner"],0)
        self.assertEqual(p["unchangedSign"],5)
        self.assertEqual(len(self.pairs),13)
        self.assertEqual(collections.Counter(x["flip_label"] for x in self.pairs),
                        {"DOWN_WIN_SQUEEZE_LOSS":8,"SAME_SIGN":5})
        for row in self.pairs:self.assertTrue(row["identical_prehistory"])

    def test_30bps_economics_and_no_venue_fill_claim(self):
        for scenario,nwin in [("TWIN_DOWN_CONTINUES",11),("TWIN_SQUEEZE",3)]:
            rows=[r for r in self.cases if r["price_regime"]==scenario]
            self.assertEqual(len(rows),13)
            self.assertEqual(sum(x["native_price_net30_pct"]>0 for x in rows),nwin)
            self.assertTrue(all(x["actual_executable_fill_proven"]==False for x in rows))
        self.assertEqual(self.result["metricsAll"][1]["n"],26)
        self.assertEqual(self.result["metricsAll"][1]["wins"],14)

if __name__=="__main__":
    unittest.main(verbosity=2)
