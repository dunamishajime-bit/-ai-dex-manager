#!/usr/bin/env python3
"""P16 source-native53 unchanged, post-entry 2h causal features and null test."""
import unittest,json
from pathlib import Path
from collections import Counter
R=Path(__file__).resolve().parents[1]/"results"
P="PRISM7_P16_NATIVE53_FROZEN_2H_DIRECTION_SUMMARY_20261122"
class FrozenAsOf2H(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.summary=json.loads((R/(P+".json")).read_text(encoding="utf-8"))
  cls.rows=json.loads((R/(P+"_NATIVE53_DIAGNOSTIC_LEDGER.json")).read_text(encoding="utf-8"))
  cls.stats=json.loads((R/"PRISM7_P16_NATIVE53_TWO_HOUR_DIRECTION_STATISTICS_20261122.json").read_text(encoding="utf-8"))
  cls.source=json.loads((R/"PRISM7_P8_PINNED_NATIVE53_REAL_PARITY_20261122_53_CASES.json").read_text(encoding="utf-8"))
 def test_source_pin_and_53_original_outcomes_unmodified(self):
  self.assertEqual(len(self.rows),53)
  original={(x["period"],x["id"],x["entryTs"]):x for x in self.source}
  self.assertEqual(self.summary["pinnedRuntimeSha"],"1657e173d250ad58f53e62f7bb0a3428fb405496")
  for x in self.rows:
   old=original[(x["period"],x["id"],x["sourceSignalEntryTs"])]
   self.assertEqual(x["sourceSignalEntryPrice"],old["entryPrice"])
   self.assertEqual(x["sourceNativeNet30Pct"],old["net30pct"])
   self.assertEqual(x["sourceNativeExitTs"],old["exitTs"])
   self.assertEqual(x["sourceNativeWin30"],old["net30pct"]>0)
   self.assertEqual(x["sourceOriginalExitReason"],old["exitReason"])
 def test_2h_asof_no_future_for_source_entry(self):
  for row in self.rows:
   self.assertEqual(row["lastFeatureReferenceTs"],row["sourceSignalEntryTs"]+3600000)
   self.assertFalse(row["futureExitInfoUsedAsFeature"])
   self.assertFalse(row["automaticEntryChange"])
   self.assertTrue(row["diagnosticOnly"])
   self.assertIn(row["score"],range(7))
   self.assertEqual(row["score"],sum(v is True for v in row["evidence"].values()))
   self.assertEqual(row["unknownFeatureCount"],sum(v is None for v in row["evidence"].values()))
   if row["status"]!="NO_POSTENTRY_PENGU_PRICE_PRINT_H1":
    self.assertEqual(row["status"]=="DIRECTION_RECHECK_REQUIRED",row["score"]>=3)
 def test_label_groups_and_frozen_rule(self):
  a=self.summary["resultGroups"]["ALL"]
  self.assertEqual(a["originalSourceCount"],53)
  self.assertEqual(a["sourceWins"],29)
  self.assertEqual(a["sourceLosses"],24)
  self.assertEqual(a["noNewPrintTwoH"],1)
  self.assertEqual(a["flaggedForDirectionRecheck"],13)
  self.assertEqual(a["flaggedSourceLosers"],7)
  self.assertEqual(a["flaggedSourceWinners"],6)
  self.assertEqual(a["originalSourceLosersNotFlagged"],17)
  self.assertEqual(a["originalSourceWinnersNotFlagged"],22)
 def test_score_auc_and_null_do_not_validate_economic_80(self):
  self.assertEqual(self.stats["sourceNative53"],53)
  self.assertEqual(self.stats["observedAsOf2h"],52)
  self.assertEqual(self.stats["permutationTestsWithinPeriod"],5000)
  self.assertEqual(self.stats["permutationSeed"],20261122)
  self.assertAlmostEqual(self.stats["sourceLoserScoreAuc"],0.49107142857142855)
  self.assertGreater(self.stats["twoSidedPByCohortLabelPermutation"],.9)
  self.assertEqual(self.stats["confusion"]["sourceWinnerIncorrectlyFlagged"],6)
if __name__=="__main__":
 unittest.main(verbosity=2)
