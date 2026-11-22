#!/usr/bin/env python3
"""P15 source PENGU July 2025 extra-calendar H1-native SHORT test.

One source short does not constitute a blind independent OOS estimate.
"""
from pathlib import Path
import json,unittest
R=Path(__file__).resolve().parents[1]/"results"
P="PRISM7_P15_JULY2025_PINNED_NATIVE_H1_SUMMARY_20261122"
class JulyNativeH1Source(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.summary=json.loads((R/(P+".json")).read_text(encoding="utf-8"))
  cls.cases=json.loads((R/(P+"_CASES.json")).read_text(encoding="utf-8"))
 def test_historical_real_PENGU_not_march2025(self):
  a=self.summary
  self.assertEqual(a["studyDataStartUtc"],"2025-07-18T12:00:00.000Z")
  self.assertEqual(a["sourceP"]["sourceBegin"],"2025-07-18T12:00:00.000Z")
  self.assertEqual(a["sourceB"]["sourceBegin"],"2025-03-01T00:00:00.000Z")
  self.assertEqual(a["entryStartUtc"],"2025-07-26T00:00:00.000Z")
  self.assertEqual(a["entryEndUtc"],"2025-08-01T00:00:00.000Z")
  self.assertEqual(a["nativeExitObservationEndUtc"],"2025-08-08T00:00:00.000Z")
  self.assertEqual(a["sourceB"]["outOfScopeMalformedCandles"],1)
  self.assertEqual(a["sourceP"]["outOfScopeMalformedCandles"],0)
 def test_pinned_source_real_short_and_native_exit(self):
  s=self.summary
  self.assertEqual(s["pinnedSourceSha"],"1657e173d250ad58f53e62f7bb0a3428fb405496")
  self.assertEqual(s["sourceNaturalSignals"],1)
  self.assertEqual(len(self.cases),1)
  trade=self.cases[0]
  self.assertEqual(trade["status"],"NATIVE_EXIT_MODELED")
  self.assertEqual(trade["exitReason"],"SHORT_HARD_STOP")
  self.assertLess(trade["net30Pct"],-8.2999)
  self.assertFalse(trade["signedVenueFill"])
  self.assertTrue(trade["notM5Verified"])
 def test_unobserved_beyond_source_period_not_claimed(self):
  a=self.summary["outcomes"]
  for cost in ("fee10","fee30"):
   self.assertEqual(a[cost]["sourceNaturalIntentCount"],1)
   self.assertEqual(a[cost]["rightCensored"],0)
   self.assertEqual(a[cost]["completedNativePriceExits"],1)
   self.assertEqual(a[cost]["modeledWins"],0)
   self.assertEqual(a[cost]["modeledPricePf"],0)
  self.assertAlmostEqual(a["fee10"]["modeledMeanNetPct"]-
                         a["fee30"]["modeledMeanNetPct"],.2)
if __name__=="__main__":
 unittest.main(verbosity=2)
