#!/usr/bin/env python3
"""P17 online matured-only H1 logistic native53 diagnostic read-only tests."""
import json
import pathlib
import unittest
R=pathlib.Path(__file__).resolve().parents[1]/"results"
P="PRISM7_P17_ONLINE24H_NATIVE53_SUMMARY_20261122"
class PrequentialContract(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.s=json.loads((R/(P+".json")).read_text(encoding="utf-8"))
  cls.rows=json.loads((R/(P+"_NATIVE53_PREDICTIONS.json")).read_text(encoding="utf-8"))
  cls.native=json.loads((R/"PRISM7_P8_PINNED_NATIVE53_REAL_PARITY_20261122_53_CASES.json").read_text(encoding="utf-8"))
 def test_all_source_original_pinned_trades_unchanged(self):
  self.assertEqual(self.s["pinnedRuntimeSha"],"1657e173d250ad58f53e62f7bb0a3428fb405496")
  self.assertEqual(self.s["naturalSourceTradeIntentsUnchanged"],53)
  self.assertEqual(self.s["nativeOriginalWinsUnchanged"],29)
  self.assertEqual(len(self.rows),53)
  original={(x["period"],x["entryTs"]):x for x in self.native}
  for a in self.rows:
   k=(a["period"],a["sourceNaturalEntryTs"])
   o=original[k]
   self.assertEqual(a["sourceNativeEntryPrice"],o["entryPrice"])
   self.assertEqual(a["sourceNativeNet30Pct"],o["net30pct"])
   self.assertEqual(a["sourceNativeExitTs"],o["exitTs"])
   self.assertEqual(a["sourceNativeExitReason"],o["exitReason"])
 def test_train_before_decision_causality_and_no_native_winner_training(self):
  self.assertEqual(self.s["fixedTargetMaturityHours"],24)
  self.assertEqual(self.s["fixedFeatureCount"],9)
  self.assertEqual(self.s["fixedLearningRate"],.03)
  self.assertEqual(self.s["fixedL2"],.001)
  for a in self.rows:
   self.assertFalse(a["nativeOutcomeUsedInOnlineTraining"])
   self.assertFalse(a["newRuntimeEntryOrExitChanged"])
   self.assertGreaterEqual(a["trainedPriorH1Examples"],0)
   self.assertGreater(a["probShort24h"],0)
   self.assertLess(a["probShort24h"],1)
   self.assertGreaterEqual(a["onlineBaseRateBeforeThisCandidate"],0)
   self.assertLessEqual(a["onlineBaseRateBeforeThisCandidate"],1)
   self.assertEqual(len(a["weightsAtPrediction"]),10)
   self.assertEqual(len(a["inputNormalizedFeatureVectorAtPrediction"]),10)
   self.assertEqual(a["inputNormalizedFeatureVectorAtPrediction"][0],1)
   self.assertTrue(all(-3<=v<=3 for v in a["inputNormalizedFeatureVectorAtPrediction"][1:]))
   if a["lastMaturedTrainingLabelReferenceTs"] is not None:
    self.assertLessEqual(a["lastMaturedTrainingLabelReferenceTs"],a["shortSignalReferenceTs"])
 def test_source_model_outputs_underperform_online_base_rate(self):
  m=self.s["metrics"]["ALL"]
  self.assertEqual(m["sourceNaturalIntentCount"],53)
  self.assertEqual(m["sourceNativeWins"],29)
  self.assertEqual(m["future24hProxyOutcomeAvailable"],53)
  self.assertEqual(m["future24hProxyWinCount"],25)
  self.assertEqual(m["nativeWinProbAboveHalf"],8)
  self.assertEqual(m["nativeWinProbBelowHalf"],21)
  self.assertEqual(m["nativeLossProbAboveHalf"],10)
  self.assertEqual(m["nativeLossProbBelowHalf"],14)
  self.assertAlmostEqual(m["nativeOutcomeAuc"],.4267241379310345)
  self.assertAlmostEqual(m["future24hProxyAuc"],.4857142857142857)
  self.assertGreater(m["forecast24hBrier"],m["onlineBaseRateBrier"])
 def test_all_3_calendar_cohorts_covered(self):
  a=self.s["cohortAudit"]
  self.assertEqual([a[k]["nativeShortSignals"] for k in
   ("PRE_2025_AUG_SEP","BASE_2025_2026","POST_2026_OCT_NOV")],[6,40,7])
  self.assertTrue(all(x["pinnedPrefixInvarianceChecks"]==3 for x in a.values()))
  self.assertTrue(all(x["maturedTrainingExamples"]>0 for x in a.values()))
if __name__=="__main__":
 unittest.main(verbosity=2)
