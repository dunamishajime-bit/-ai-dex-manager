#!/usr/bin/env python3
"""P33 source-native V20 on original S4 120 plus causal shock and fixed gross 90 test contract."""
from __future__ import annotations
import csv,json,unittest
from pathlib import Path
from collections import Counter
R=Path(__file__).resolve().parents[1]/"results"
class P33(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.a=json.loads((R/"PRISM7_P33_NATIVE_S4_SHOCK_GROSS_90_SCENARIO_SUMMARY_20261122.json").read_text(encoding="utf-8"))
  cls.events=json.loads((R/"PRISM7_P33_NATIVE_S4_ALL120_CAUSAL_SHOCK_EVENTS_20261122.json").read_text(encoding="utf-8"))
  cls.original=json.loads((R/"PRISM7_P32_S4_NATIVE_V20_EXIT_REPLAY_SUMMARY_20261122_NATIVE_ALL120_SINGLE_SLOT.json").read_text(encoding="utf-8"))
  with (R/"PRISM7_P33_NATIVE_S4_SHOCK_90_SCENARIO_TRADE_LEDGER_20261122.csv").open("r",encoding="utf-8",newline="") as f:
   cls.records=list(csv.DictReader(f))
 def scenario(self,delay=2,slip=0,fee=30,gross=.75):
  return next(z for z in self.a["allNinetyJointEconomicAndRiskScenarios"] if
   z["positiveM5ExitPrintAfterCausalShock"]==delay and
   z["extraBuyToCoverSlipBps"]==slip and
   z["roundtripFeeBps"]==fee and
   z["grossPerSourceEntryEquity"]==gross)
 def test_all_original_source120_and_native53_preserved(self):
  a=self.a
  self.assertEqual(a["originalNatural53SourceParity"],"PASS_53_53_29_WINS")
  self.assertEqual(a["originalPinnedNativeV20SHA"],"1657e173d250ad58f53e62f7bb0a3428fb405496")
  self.assertTrue(a["originalS4Source120StructureUnchanged"])
  self.assertTrue(a["nativeSource120OneSlotRecomputedAndExactCompared"])
  self.assertEqual(len(self.events),120)
  self.assertEqual(len(self.original),120)
  self.assertEqual(a["nativeSourceOriginal30BpsBeforeShock"]["originalSourceStructuralSetups"],120)
  self.assertEqual(a["nativeSourceOriginal30BpsBeforeShock"]["originalSourceCompletedTradeCount"],21)
  self.assertEqual(a["nativeSourceOriginal30BpsBeforeShock"]["conditionalWinCount"],15)
  self.assertAlmostEqual(a["nativeSourceOriginal30BpsBeforeShock"]["sourceM5CloseMarkedDDPct"],35.94150348,places=8)
 def test_joint_native_event_scan_exact_earlier_source_time_not_profit_hindsight(self):
  a=self.a
  self.assertEqual(a["eventSourceNativeNewScanCount"],1)
  self.assertEqual(a["eventSourceNativeCandidates"],["S3_01700"])
  e=self.events["S3_01700"]
  self.assertEqual(e["state"],"CROSS_ASSET_CAPITULATION_CONFIRMED")
  self.assertEqual(e["eventM5OpenTs"],1760130900000)
  self.assertEqual(e["eventCloseTs"],1760131200000)
  self.assertEqual(e["first3AfterSignalPositiveM5OpenProxies"][1]["ts"],1760131500000)
  self.assertFalse(e["signalUsesFutureM5Bars"])
  self.assertFalse(e["venueSignedFillProven"])
  self.assertTrue(a["p25SourceKnownEventVsNewNativeExitEventComparison"]["S3_01700"]["nativeEntrySourceMatchesP25"])
 def test_all_90_precommitted_gross_delay_slip_fee_conditions_and_trade_record_grain(self):
  all_=self.a["allNinetyJointEconomicAndRiskScenarios"]
  self.assertEqual(len(all_),90)
  self.assertEqual(len(set((z["grossPerSourceEntryEquity"],z["positiveM5ExitPrintAfterCausalShock"],
    z["extraBuyToCoverSlipBps"],z["roundtripFeeBps"]) for z in all_)),90)
  self.assertEqual(len(self.records),90*22)
  self.assertTrue(all(z["originalH1S4Setups"]==120 for z in all_))
  self.assertTrue(all(z["sourceDetectedCrossAssetEvents"]==1 for z in all_))
  self.assertTrue(all(z["singleSlotShockBuyToCoverApplied"]==1 for z in all_))
  self.assertTrue(all(z["sourcePreviouslyOccupiedNewlyAdmitted"]==0 for z in all_))
  self.assertTrue(all(z["sourceNativeExitUsesP32Pin"] for z in all_))
  self.assertTrue(all(z["referenceEconomicsAndRisk"]["sourceCensoredOpenPositionCount"]==1 for z in all_))
 def test_main_native_v20_shock_frozen_threequarter_17pct_dd(self):
  x=self.scenario()
  s=x["referenceEconomicsAndRisk"]
  self.assertEqual(s["originalSourceCompletedTradeCount"],21)
  self.assertEqual(s["conditionalWinCount"],15)
  self.assertAlmostEqual(s["conditionalWinratePct"],71.42857143,places=7)
  self.assertAlmostEqual(s["conditionalMeanNetReturnPctOnEquity"],4.50581789,places=8)
  self.assertAlmostEqual(s["conditionalProfitFactor"],4.5071145,places=7)
  self.assertAlmostEqual(s["sourceM5CloseMarkedDDPct"],17.03139963,places=8)
  self.assertAlmostEqual(s["sourcePrevCompletedM5PeakHighStressDDPct"],17.03139963,places=8)
  self.assertAlmostEqual(s["sourceReferenceFinalEquityInclCensoredMarkYen"],23017.74646,places=4)
  self.assertLess(s["sourceM5CloseMarkedDDPct"],20)
 def test_one_times_gross_and_later_latency_fail_dd20(self):
  one=self.scenario(gross=1.)["referenceEconomicsAndRisk"]
  later=self.scenario(delay=3)["referenceEconomicsAndRisk"]
  slip=self.scenario(delay=3,slip=1000)["referenceEconomicsAndRisk"]
  self.assertAlmostEqual(one["sourceM5CloseMarkedDDPct"],22.11720858,places=8)
  self.assertAlmostEqual(later["sourceM5CloseMarkedDDPct"],20.4662988,places=7)
  self.assertAlmostEqual(later["sourcePrevCompletedM5PeakHighStressDDPct"],20.52037402,places=7)
  self.assertAlmostEqual(slip["sourceM5CloseMarkedDDPct"],23.87133174,places=8)
  self.assertGreater(one["sourceM5CloseMarkedDDPct"],20)
  self.assertGreater(later["sourceM5CloseMarkedDDPct"],20)
  self.assertGreater(slip["sourcePrevCompletedM5PeakHighStressDDPct"],20)
 def test_wins_and_profit_factor_are_not_manufactured_by_position_sizing(self):
  for delay in (1,2,3):
   for slip in (0,25,100,500,1000):
    for fee in (10,30):
     q=[self.scenario(delay,slip,fee,g)["referenceEconomicsAndRisk"] for g in (.75,1.,1.25)]
     self.assertEqual({z["conditionalWinCount"] for z in q},{15})
     self.assertEqual({z["originalSourceCompletedTradeCount"] for z in q},{21})
     self.assertAlmostEqual(q[0]["conditionalMeanNetReturnPctOnEquity"]/.75,q[1]["conditionalMeanNetReturnPctOnEquity"],places=6)
     self.assertAlmostEqual(q[2]["conditionalMeanNetReturnPctOnEquity"]/1.25,q[1]["conditionalMeanNetReturnPctOnEquity"],places=6)
     self.assertAlmostEqual(q[0]["conditionalProfitFactor"],q[1]["conditionalProfitFactor"],places=7)
     self.assertAlmostEqual(q[2]["conditionalProfitFactor"],q[1]["conditionalProfitFactor"],places=7)
 def test_cost_sensitivity_is_not_marked_as_signed_fill(self):
  for row in self.records:
   self.assertEqual(row["sourceM5SignedVenueFillProven"],"False")
  a=[self.scenario(slip=s)["referenceEconomicsAndRisk"] for s in (0,25,100,500,1000)]
  self.assertTrue(all(a[i]["conditionalMeanNetReturnPctOnEquity"]>a[i+1]["conditionalMeanNetReturnPctOnEquity"]
       for i in range(4)))
  self.assertEqual(sum(row["sourceStatus"].startswith("RIGHT_CENSORED") for row in self.records),90)
if __name__=="__main__":unittest.main(verbosity=2)
