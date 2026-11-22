#!/usr/bin/env python3
"""P35 native pinned SOURCE53 exact-price, distinct order interval, 0.75 causal H1 shadow tests."""
from __future__ import annotations
import unittest,json
from pathlib import Path
R=Path(__file__).resolve().parents[1]/"results"
class P35(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.d=json.loads((R/"PRISM7_P35_ORIGINAL_NATIVE53_075_BTC6H_SHADOW_NEGATIVE_CONTROL_20261122.json").read_text(encoding="utf-8"))
  cls.e=json.loads((R/"PRISM7_P35_ORIGINAL_NATIVE53_075_ALL53_H1_CONTEXT_AND_POSITIONS_20261122.json").read_text(encoding="utf-8"))
 def find(self,name):
  return next(x for x in self.d["allFourRetrospectiveShadowModels"] if x["model"]==name)
 def test_original53_natural_replayed_not_43_shortened_by_reused_ids(self):
  a=self.e
  self.assertEqual(len(a),53)
  self.assertEqual(len(set(x["id"] for x in a)),43)
  self.assertEqual(len(set(x["entryTs"] for x in a)),53)
  self.assertTrue(all(x["parity"]=="EXACT" and x["originalNativeShortSignalUnchanged"] for x in a))
  self.assertEqual(sum(x["net30pct"]>0 for x in a),29)
  self.assertEqual(self.d["originalSource53Parity"],"EXACT_53_53_WINS29")
  self.assertEqual(self.d["originalNativePinnedSHA"],"1657e173d250ad58f53e62f7bb0a3428fb405496")
 def test_btc_and_pengu_h1_prior_bar_complete_no_future(self):
  self.assertTrue(all(z["p35AsOfFeature"]["lastCompletedH1Ts"]==z["entryTs"]-3600000 for z in self.e))
  self.assertTrue(all(z["p35AsOfFeature"]["state"]=="CAUSAL_LAST_COMPLETED_H1_PRICE_CONTEXT" for z in self.e))
  self.assertTrue(all(not z["p35AsOfFeature"]["signalUsesFuturePrice"] for z in self.e))
  self.assertEqual(self.d["sourceH1PriceAlignment"],"PENGU_BTC_H1_EXACT_FULL_CALENDAR")
  self.assertEqual(self.d["grossFixed"],.75)
  self.assertEqual(self.d["feeBps"],30)
 def test_overlap_requires_no_fake_single_portfolio_dd(self):
  c=self.d["native53OverlapCaveat"]
  self.assertEqual(c["sourceOriginal53PairwiseOverlappingWindows"],38)
  self.assertEqual(c["sourceOriginal53MaximumConcurrentReferencePositions"],6)
  self.assertTrue(c["neverInterpret53AsRealOneSlotCapitalAllocation"])
  self.assertTrue(all(not x["recreateSingleSlotDDPermitted"] for x in self.d["allFourRetrospectiveShadowModels"]))
 def test_original_nat53_unmodified_outcomes_exact(self):
  b=self.find("NATIVE53_UNMODIFIED")
  self.assertEqual(b["retrospectiveShadowKept"],53)
  self.assertEqual((b["keptWins"],b["keptLosses"]),(29,24))
  self.assertAlmostEqual(b["conditionalWinRatePct"],54.71698113,places=8)
  self.assertAlmostEqual(b["conditionalMeanNetPctOnCapital"],.75049142,places=8)
  self.assertAlmostEqual(b["nativeRetrospectiveShadowProfitFactor"],1.37734188,places=8)
  self.assertAlmostEqual(b["netPctPointSumPer53OriginalOpportunitiesAtFixedGross"],39.7760452,places=8)
 def test_btc6h_nonpositive_disproves_global_transfer_to_natural_v20(self):
  f=self.find("NATIVE53_SHADOW_BTC6H_NONPOSITIVE")
  self.assertEqual((f["retrospectiveShadowKept"],f["keptWins"],f["keptLosses"]),(21,11,10))
  self.assertEqual(len(f["nativeLostWinnerIds"]),18)
  self.assertEqual(len(f["nativeAvoidedLoserIds"]),14)
  self.assertAlmostEqual(f["conditionalWinRatePct"],52.38095238,places=8)
  self.assertAlmostEqual(f["nativeRetrospectiveShadowProfitFactor"],1.05972089,places=8)
  self.assertAlmostEqual(f["netPctPointSumPer53OriginalOpportunitiesAtFixedGross"],3.11843684,places=8)
  self.assertLess(f["netPctPointSumPer53OriginalOpportunitiesAtFixedGross"],
       self.find("NATIVE53_UNMODIFIED")["netPctPointSumPer53OriginalOpportunitiesAtFixedGross"])
 def test_relative_weakness_and_consensus_are_not_robust_general_v20(self):
  a=self.find("NATIVE53_SHADOW_PENGU_REL_WEAK6H")
  b=self.find("NATIVE53_SHADOW_BOTH")
  self.assertEqual((a["retrospectiveShadowKept"],a["keptWins"],a["keptLosses"]),(33,19,14))
  self.assertAlmostEqual(a["nativeRetrospectiveShadowProfitFactor"],1.6270316,places=8)
  self.assertEqual((b["retrospectiveShadowKept"],b["keptWins"],b["keptLosses"]),(16,7,9))
  self.assertAlmostEqual(b["conditionalWinRatePct"],43.75,places=8)
  self.assertAlmostEqual(b["nativeRetrospectiveShadowProfitFactor"],.86208486,places=8)
 def test_opportunity_count_still_53_and_gross_notional_account_scaled_correctly(self):
  old=self.find("NATIVE53_UNMODIFIED")
  for m in self.d["allFourRetrospectiveShadowModels"]:
   self.assertEqual(m["originalPinnedNativeV20Intents"],53)
   self.assertEqual(m["grossExposureIfConceptuallyExecuted"],.75)
   self.assertEqual(m["sourceNativeRoundtripFeeBps"],30)
   self.assertEqual(sum(z["originSourceCount"] for z in m["preBasePostCohortOutcome"]),53)
   self.assertEqual(len(m["nativeLostWinnerIds"])+len(m["nativeAvoidedLoserIds"])+m["retrospectiveShadowKept"],53)
   self.assertAlmostEqual(
       old["netPctPointSumPer53OriginalOpportunitiesAtFixedGross"]
        -m["nativeOriginalWinningGrossReturnPctPointsLostAt0p75"]
        +m["nativeOriginalLosingGrossReturnPctPointsAvoidedAt0p75"],
       m["netPctPointSumPer53OriginalOpportunitiesAtFixedGross"],places=6)
if __name__=="__main__":unittest.main(verbosity=2)
