#!/usr/bin/env python3
"""P28 Layer3 independent notional gross0.75/1/1.25 x 90 scenarios verified."""
import json,unittest
from pathlib import Path
from collections import Counter
R=Path(__file__).resolve().parents[1]/"results"
class P28(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.s=json.loads((R/"PRISM7_P28_LAYER3_FIXED_GROSS_90_CASE_SUMMARY_20261122.json").read_text(encoding="utf-8"))
  cls.l=json.loads((R/"PRISM7_P28_LAYER3_FIXED_GROSS_1980_POSITION_LEDGERS_20261122.json").read_text(encoding="utf-8"))
 def get(cls,lag,slip,fee,gross):
  return next(z["capitalAndRisk"] for z in cls.s["allNinetyResults"] if
    z["delayPositivePrints"]==lag and z["extraExitSlipBps"]==slip and
    z["feeBps"]==fee and z["gross"]==gross)
 def test_full_source120_and_90_model_scenarios(self):
  self.assertEqual(self.s["sourceOriginalH1SetupsPreserved"],120)
  self.assertEqual(self.s["originalClosed"],21)
  self.assertEqual(self.s["originalWins"],15)
  self.assertEqual(self.s["sourceCensoredOpenCount"],1)
  self.assertEqual(self.s["fixedGrossMultipliers"],[.75,1,1.25])
  self.assertEqual(len(self.s["allNinetyResults"]),90)
  self.assertEqual(len(self.l),1980)
  self.assertEqual(len(set((z["delayPositivePrints"],z["extraExitSlipBps"],z["feeBps"],z["gross"]) for z in self.s["allNinetyResults"])),90)
 def test_main_fixed_075_meets_isolated_20dd_but_1x_125_dont(self):
  a=self.get(2,0,30,.75);b=self.get(2,0,30,1);c=self.get(2,0,30,1.25)
  self.assertEqual({x["conditionalWinCount"] for x in (a,b,c)},{15})
  self.assertEqual({x["originalSourceCompletedTradeCount"] for x in (a,b,c)},{21})
  self.assertAlmostEqual(a["sourceM5CloseMarkedDDPct"],16.95094368,places=8)
  self.assertAlmostEqual(b["sourceM5CloseMarkedDDPct"],21.95877323,places=8)
  self.assertAlmostEqual(c["sourceM5CloseMarkedDDPct"],26.68845396,places=8)
  self.assertLess(a["sourceM5CloseMarkedDDPct"],20)
  self.assertGreater(b["sourceM5CloseMarkedDDPct"],20)
  self.assertAlmostEqual(a["conditionalMeanNetReturnPctOnEquity"],5.26462722,places=8)
  self.assertAlmostEqual(b["conditionalMeanNetReturnPctOnEquity"],7.01950296,places=8)
  self.assertAlmostEqual(c["conditionalMeanNetReturnPctOnEquity"],8.7743787,places=8)
  self.assertAlmostEqual(a["conditionalProfitFactor"],b["conditionalProfitFactor"],places=7)
  self.assertAlmostEqual(b["conditionalProfitFactor"],c["conditionalProfitFactor"],places=7)
 def test_slippage_delayed_third_print_fails_gross075_20gate(self):
  early=self.get(2,1000,30,.75)
  late=self.get(3,0,30,.75)
  very_late=self.get(3,1000,30,.75)
  self.assertAlmostEqual(late["sourceM5CloseMarkedDDPct"],20.4662988,places=7)
  self.assertAlmostEqual(very_late["sourceM5CloseMarkedDDPct"],23.87133174,places=7)
  self.assertGreater(very_late["sourceM5CloseMarkedDDPct"],late["sourceM5CloseMarkedDDPct"])
  self.assertLess(early["sourceM5CloseMarkedDDPct"],20)
 def test_fee_and_gross_proportional_return_not_inflated_winrate(self):
  for delay in (1,2,3):
   for slip in (0,25,100,500,1000):
    for fee in (10,30):
     a=[self.get(delay,slip,fee,gross) for gross in (.75,1,1.25)]
     self.assertEqual([z["conditionalWinCount"] for z in a],[15,15,15])
     self.assertAlmostEqual(a[0]["conditionalMeanNetReturnPctOnEquity"]/.75,
                            a[1]["conditionalMeanNetReturnPctOnEquity"],places=6)
     self.assertAlmostEqual(a[2]["conditionalMeanNetReturnPctOnEquity"]/1.25,
                            a[1]["conditionalMeanNetReturnPctOnEquity"],places=6)
     self.assertTrue(all(z["sourceCensoredOpenPositionCount"]==1 for z in a))
 def test_synthetic_1x_source_p26_parity_maintained(self):
  a=self.get(2,0,30,1)
  self.assertAlmostEqual(a["sourcePrevCompletedM5PeakHighStressDDPct"],21.95877323,places=8)
  self.assertAlmostEqual(a["sourceReferenceFinalEquityInclCensoredMarkYen"],35621.104734,places=4)
  self.assertEqual(a["worstMarkEvent"]["id"],"S3_10500")
 def test_all_position_records_are_source_price_proxies_no_signed_fills(self):
  self.assertTrue(all(not z["sourceM5SignedVenueFillProven"] for z in self.l))
  self.assertTrue(all(z["notionalGrossVsCurrentEquity"] in (.75,1,1.25) for z in self.l))
  self.assertEqual(sum(z["sourceStatus"].startswith("RIGHT_CENSORED") for z in self.l),90)
if __name__=="__main__":unittest.main(verbosity=2)
