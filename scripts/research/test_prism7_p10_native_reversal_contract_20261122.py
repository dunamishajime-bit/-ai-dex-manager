#!/usr/bin/env python3
"""PRISM VII P10A frozen post-entry buyer-pressure research regression.

Observed tests are not blind OOS, not venue fills, and don't imply deployment.
"""
import json
import pathlib
import unittest
from collections import Counter,defaultdict
from statistics import mean
R=pathlib.Path(__file__).resolve().parents[1]/"results"
def j(name):return json.loads((R/name).read_text(encoding="utf-8"))
def jl(name):return [json.loads(x) for x in (R/name).read_text(encoding="utf-8").splitlines() if x.strip()]
O="PRISM7_P8B_NATIVE384_408H_FOLLOWUP_SUMMARY_20261122"
N="PRISM7_P10_NATIVE384_SHADOW_REVERSAL_SUMMARY_20261122"
Q="PRISM7_P9_PINNED_NATIVE_IDENTICAL_PREFIX_FORK_SUMMARY_20261122"
T="PRISM7_P10_IDENTICAL_PREFIX_TWIN_SHADOW_SUMMARY_20261122"

class TestP10(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.real=j("PRISM7_P10_REAL53_NATIVE_SHADOW_SUMMARY_20261122.json")
  cls.realCases=j("PRISM7_P10_REAL53_NATIVE_SHADOW_SUMMARY_20261122_53_CASES.json")
  cls.old=jl(O+"_CASES.jsonl")
  cls.new=jl(N+"_CASES.jsonl")
  cls.summary=j(N+".json")
  cls.p9=jl(Q+"_CASES.jsonl")
  cls.twin=jl(T+"_CASES.jsonl")
  cls.twinSummary=j(T+".json")

 def test_real_source_53_full_parity(self):
  a=self.real
  self.assertEqual(a["sourcePinnedRuntimeSha"],"1657e173d250ad58f53e62f7bb0a3428fb405496")
  self.assertEqual(a["entryAndExitParity"],"PASS_53_53")
  self.assertEqual(a["pinnedNativeCandidateCoverage"],"PASS_53_53_IN_SOURCE_OWN_ENTRY_PERIOD")
  self.assertEqual(a["matchedSourceNativeShortExits"],53)
  self.assertEqual(len(self.realCases),53)
  self.assertEqual(a["p10Audit"]["originalNative"]["wins"],29)
  self.assertEqual(a["p10Audit"]["researchP10"]["wins"],18)
  self.assertEqual(a["p10Audit"]["earlyExits"],48)
  self.assertEqual(a["p10Audit"]["nativeWinnerDestroyed"],15)
  self.assertEqual(a["p10Audit"]["nativeLoserConverted"],4)
  self.assertLess(a["p10Audit"]["researchP10"]["pricePf"],1)
  for z in self.realCases:
   self.assertEqual(z["parity"],"EXACT")
   self.assertLessEqual(z["p10_exitTs"],z["exitTs"])
   if not z["p10_researchTriggered"]:
    self.assertEqual(z["p10_exitTs"],z["exitTs"])
    self.assertAlmostEqual(z["p10_exitPrice"],z["exitPrice"])

 def test_157_synthetic_candidates_original_preserved(self):
  self.assertEqual(len(self.old),157)
  self.assertEqual(len(self.new),157)
  a={(x["pathTag"],x["signalHourIndex"]):x for x in self.old}
  self.assertEqual(len(a),157)
  for z in self.new:
   old=a[(z["pathTag"],z["signalHourIndex"])]
   for f in ("entryTs","entryHourOpenPrice","source_mask_start_m5_index","entryHourPositivePrint","firstPrintMinuteOffset"):
    self.assertEqual(z[f],old[f])
   self.assertLessEqual(z["native_exitTs"],old["native_exitTs"])
   if not z["researchP10Triggered"]:
    self.assertEqual(z["native_exitReason"],old["native_exitReason"])
    self.assertEqual(z["native_exitPrice"],old["native_exitPrice"])

 def test_157_outcome_net_and_winner_harm(self):
  audit=self.summary["pairedVerification"]
  self.assertEqual(audit["sourceNaturalIntentsUnchanged"],157)
  self.assertEqual(audit["researchP10EarlyExits"],131)
  self.assertEqual(audit["oldNativeWinnersToNewLoss"],20)
  self.assertEqual(audit["oldNativeLosersToNewWin"],14)
  self.assertEqual(audit["originalNativeBaseline30bpsWins"],77)
  self.assertEqual(self.summary["metricsAll"][1]["wins"],71)
  self.assertAlmostEqual(self.summary["metricsAll"][1]["mean_net_pct"],.97544192439087,places=8)
  self.assertAlmostEqual(self.summary["metricsAll"][1]["price_pf"],1.4313356091679263,places=8)
  self.assertLess(self.summary["metricsAll"][1]["mean_net_pct"],
                  audit["originalNativeBaseline30bpsMeanPct"])
  for row in self.new:
   self.assertAlmostEqual(row["native_price_net10_pct"]-row["native_price_net30_pct"],.2,places=9)

 def test_shadow_exit_availability_is_not_signed(self):
  a=self.summary["pairedVerification"]
  self.assertEqual(a["earlyExitNoPrintedNextHour"],3)
  self.assertEqual(a["earlyExitDelayedNextHour"],61)
  self.assertEqual(a["earlyExitNoPrintedNextHour"]+a["earlyExitDelayedNextHour"],64)
  self.assertTrue(all(z["venue_signed_fill"] is False and
                      z["actual_executable_fill_proven"] is False for z in self.new))

 def test_96_twin_history_unchanged_and_new_outcomes(self):
  self.assertEqual(self.twinSummary["syntheticPaths"],192)
  a=self.twinSummary["pairedVerification"]
  self.assertEqual(a["prefixPairs"],96)
  self.assertEqual(a["identicalNativeEntryPairs"],13)
  self.assertEqual(len(self.twin),26)
  self.assertEqual(a["downWinnerBecomesSqueezeLoser"],4)
  self.assertEqual(a["forkBoundaryDelayedPrintPriceDivergence"],1)
  orig={(z["pathTag"],z["signalHourIndex"]):z for z in self.p9}
  for z in self.twin:
   x=orig[(z["pathTag"],z["signalHourIndex"])]
   for f in ("entryTs","entryHourOpenPrice","native_asof_features"):
    self.assertEqual(x[f],z[f])
   self.assertLessEqual(z["native_exitTs"],x["native_exitTs"])
  by=defaultdict(list)
  for z in self.twin:by[z["price_regime"]].append(z)
  self.assertEqual(len(by["TWIN_DOWN_CONTINUES"]),13)
  self.assertEqual(len(by["TWIN_SQUEEZE"]),13)
  self.assertEqual(sum(z["native_price_net30_pct"]>0 for z in by["TWIN_DOWN_CONTINUES"]),9)
  self.assertEqual(sum(z["native_price_net30_pct"]>0 for z in by["TWIN_SQUEEZE"]),5)

if __name__=="__main__":
 unittest.main(verbosity=2)
