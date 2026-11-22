#!/usr/bin/env python3
"""P34 preregistered source120/casual H1 feature-gate, fixed gross0.75 regression."""
from __future__ import annotations
import unittest,json
from pathlib import Path
from collections import Counter
R=Path(__file__).resolve().parents[1]/"results"
class P34(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.s=json.loads((R/"PRISM7_P34_SELLER_075_CAUSAL_GATES_25_STRESS_CASES_20261122.json").read_text(encoding="utf-8"))
  cls.p=json.loads((R/"PRISM7_P34_SELLER_ALL120_CAUSAL_PREENTRY_FEATURES_20261122.json").read_text(encoding="utf-8"))
  cls.original=json.loads((R/"PRISM7_P33_NATIVE_S4_SHOCK_GROSS_90_SCENARIO_SUMMARY_20261122.json").read_text(encoding="utf-8"))
  cls.cases=[json.loads(line) for line in
   (R/"PRISM7_P34_SELLER_075_25_CASE_POSITION_LEDGER_20261122.jsonl").read_text(encoding="utf-8").splitlines() if line]
 def row(self,model="BASE_UNMODIFIED",delay=2,slip=0,shock="SHOCK_ON"):
  return next(z for z in self.s["allTwentyFiveFixed0p75Scenarios"]
   if z["model"]==model and z["p25ShockModel"]==shock and
    (shock=="SHOCK_OFF" or z["positiveM5PrintAfterShock"]==delay and
          z["buyCoverExtraSlipBps"]==slip))
 def test_original_s4_120_h1_asof_no_future_source_compatible(self):
  self.assertTrue(self.s["source120IntentsPreserved"])
  self.assertTrue(self.s["p33OriginalNativeExitBaseParityVerified"])
  self.assertTrue(self.s["sourceNative53NaturalSignalsUnaltered"])
  self.assertEqual(len(self.p),120)
  self.assertTrue(all(not v["originalP20SourceUsesFuture"] and
    v["signalReferenceTs"]<=v["intentTs"]<=
     (v["nativeEntryTs"] if v["nativeEntryTs"] is not None else v["intentTs"])
     for v in self.p.values()))
  self.assertEqual(self.s["grossFixed"],.75)
  self.assertEqual(self.s["sourcePinnedSHA"],"1657e173d250ad58f53e62f7bb0a3428fb405496")
 def test_all_25_model_grid_exactly_pre_registered_and_only_gross075(self):
  z=self.s["allTwentyFiveFixed0p75Scenarios"]
  self.assertEqual(len(z),25)
  self.assertEqual(len(set((x["model"],x["p25ShockModel"],x["positiveM5PrintAfterShock"],
    x["buyCoverExtraSlipBps"]) for x in z)),25)
  self.assertEqual(set(x["gross"] for x in z),{.75})
  self.assertEqual(set(x["roundtripFeeBps"] for x in z),{30})
  self.assertEqual(set(x["originalSourceS4Intents"] for x in z),{120})
  self.assertEqual(len(self.s["testedModels"]),5)
  self.assertEqual(set(x["model"] for x in self.cases),set(self.s["testedModels"]))
 def test_baseline_is_bitwise_numerical_p33_replay_across_all_four_stress_cases(self):
  for delay in (2,3):
   for slip in (0,1000):
    a=self.row(delay=delay,slip=slip)["riskAndProfitAtFixed0p75"]
    p=next(z["referenceEconomicsAndRisk"] for z in self.original["allNinetyJointEconomicAndRiskScenarios"]
      if z["positiveM5ExitPrintAfterCausalShock"]==delay and z["extraBuyToCoverSlipBps"]==slip
      and z["roundtripFeeBps"]==30 and z["grossPerSourceEntryEquity"]==.75)
    for k in ("sourceM5CloseMarkedDDPct","sourcePrevCompletedM5PeakHighStressDDPct",
         "conditionalWinratePct","conditionalMeanNetReturnPctOnEquity",
         "conditionalProfitFactor","sourceReferenceFinalEquityInclCensoredMarkYen"):
     self.assertAlmostEqual(a[k],p[k],places=7)
  b=self.row()
  self.assertEqual(b["riskAndProfitAtFixed0p75"]["originalSourceCompletedTradeCount"],21)
  self.assertEqual(b["riskAndProfitAtFixed0p75"]["conditionalWinCount"],15)
  self.assertAlmostEqual(b["riskAndProfitAtFixed0p75"]["sourceM5CloseMarkedDDPct"],17.03139963,places=8)
 def test_btc_trend_screen_stress_reversal_but_one_original_winner_dropped(self):
  b=self.row("SELLER_BTC_TREND_ONLY",3,1000)
  v=b["riskAndProfitAtFixed0p75"]
  self.assertEqual(b["blockedIntentsOfSource120"],23)
  self.assertEqual(b["blockedOfNativeValidEntryCandidates"],4)
  self.assertEqual(v["originalSourceCompletedTradeCount"],19)
  self.assertEqual(v["conditionalWinCount"],14)
  self.assertAlmostEqual(v["conditionalWinratePct"],73.68421053,places=8)
  self.assertAlmostEqual(v["sourceM5CloseMarkedDDPct"],18.81773579,places=8)
  self.assertAlmostEqual(v["sourcePrevCompletedM5PeakHighStressDDPct"],18.87293188,places=8)
  self.assertGreater(self.row("BASE_UNMODIFIED",3,1000)["riskAndProfitAtFixed0p75"]["sourceM5CloseMarkedDDPct"],20)
  self.assertEqual([x["id"] for x in b["stoppedOriginalWinners"]],["S3_01634"])
  self.assertEqual([x["id"] for x in b["stoppedOriginalLosers"]],["S3_01864"])
  self.assertEqual(b["newlyAdmittedTrades"],[])
  self.assertGreater(b["originalReferenceWinnersNetPctPointsLost"],0)
 def test_triply_conjunctive_screen_drops_even_more_winners(self):
  x=self.row("SELLER_CONSENSUS_3_OF_3")
  self.assertEqual(x["blockedIntentsOfSource120"],31)
  self.assertEqual(x["riskAndProfitAtFixed0p75"]["originalSourceCompletedTradeCount"],18)
  self.assertEqual(x["riskAndProfitAtFixed0p75"]["conditionalWinCount"],13)
  self.assertEqual(set(t["id"] for t in x["stoppedOriginalWinners"]),{"S3_01634","S3_05514"})
  self.assertEqual([t["id"] for t in x["stoppedOriginalLosers"]],["S3_01864"])
  self.assertLess(x["riskAndProfitAtFixed0p75"]["conditionalWinratePct"],80)
 def test_ema_downtrend_is_not_independent_discriminator_and_relative_weakness_can_drop_winner(self):
  x=self.row("SELLER_EMA_TREND_ONLY",3,1000)
  b=self.row("BASE_UNMODIFIED",3,1000)
  self.assertEqual(x["riskAndProfitAtFixed0p75"],b["riskAndProfitAtFixed0p75"])
  rel=self.row("SELLER_REL_WEAKNESS_ONLY")
  self.assertEqual([t["id"] for t in rel["stoppedOriginalWinners"]],["S3_05514"])
  self.assertEqual([t["id"] for t in rel["stoppedOriginalLosers"]],["S3_01864"])
  self.assertEqual(self.s["source120SignalProfileStats"]["SELLER_PULLBACK_REJECTION"]["precommittedFlagsAggregateCounts"]["emaDown24Below72"],58)
 def test_winner_loss_and_stress_not_account_portfolio_verified(self):
  for x in self.s["allTwentyFiveFixed0p75Scenarios"]:
   self.assertTrue(not x["productionReady"])
   self.assertEqual(x["sourceReferenceWinners"] if x["p25ShockModel"]=="SHOCK_ON" else 15,15)
   self.assertTrue(all("id" in z and "referenceGrossNetPct" in z for z in x["stoppedOriginalWinners"]))
  self.assertIn("portfolio", " ".join(self.s["limitations"]).lower())
if __name__=="__main__":unittest.main(verbosity=2)
