#!/usr/bin/env python3
"""P26 causally ordered M5 high vs prior completed mark peak regression."""
import json,unittest
from pathlib import Path
R=Path(__file__).resolve().parents[1]/"results"
class P26(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.s=json.loads((R/"PRISM7_P26_CAUSAL_PREVM5_PEAK_RISK_38_SCENARIOS_20261122.json").read_text(encoding="utf-8"))
  cls.ledger=json.loads((R/"PRISM7_P26_CAUSAL_PREVM5_PEAK_POSITION_LEDGER_20261122.json").read_text(encoding="utf-8"))
 def test_38_scenarios_and_4_native_source_groups(self):
  self.assertEqual(self.s["scenarioCount"],38)
  self.assertEqual(len(self.s["allCostAndDelayComparisons"]),38)
  original=[x for x in self.s["allCostAndDelayComparisons"] if x["p25DelayPositivePrint"] is None]
  p25=[x for x in self.s["allCostAndDelayComparisons"] if x["p25DelayPositivePrint"] is not None]
  self.assertEqual(len(original),8)
  self.assertEqual(len(p25),30)
  self.assertEqual(set(x["modelGroup"] for x in original),{
    "SOURCE53_SINGLE_SLOT","S3_SINGLE_SLOT","S3_CONFIRM_SINGLE_SLOT","S4_SINGLE_SLOT"})
 def test_p23_and_p25_source_m5_closeDD_exact_replay(self):
  for x in self.s["allCostAndDelayComparisons"]:
   z=x["causalPreviousCloseHighStress"]
   self.assertAlmostEqual(z["maximum5MCloseMarkedDDPct"],x["legacySource5MCloseDDPct"],places=7)
   self.assertLessEqual(z["maximumPriorM5ClosePeakHighStressDDPct"],
      x["legacyP23SameM5CloseFirstHighStressDDPct"]+1e-6)
   self.assertGreaterEqual(z["sourceIntents"] if "sourceIntents" in z else z["singleSlotSourceIntents"],53)
 def test_p25_time_correct_high_vs_samebar_future_stress(self):
  z=self.s["mainS4P25TwoPrintExtra0"]
  a=z["causalPreviousCloseHighStress"]
  self.assertEqual(z["feeBps"],30)
  self.assertEqual(z["p25DelayPositivePrint"],2)
  self.assertEqual(z["p25ExtraExitSlippageBps"],0)
  self.assertAlmostEqual(a["maximum5MCloseMarkedDDPct"],21.95877323,places=8)
  self.assertAlmostEqual(a["maximumPriorM5ClosePeakHighStressDDPct"],21.95877323,places=8)
  self.assertAlmostEqual(z["legacyP23SameM5CloseFirstHighStressDDPct"],37.07542728,places=8)
  self.assertEqual(a["worstChronologicalHighEvent"]["id"],"S3_10500")
  self.assertFalse(a["worstChronologicalHighEvent"]["entryBarHighOrderUnknown"])
  self.assertFalse(a["worstChronologicalHighEvent"]["isStopExitM5Bar"])
 def test_unchanged_p22_high_when_another_later_bar_reverts(self):
  a=self.s["mainS4P22"]["causalPreviousCloseHighStress"]
  self.assertAlmostEqual(a["maximumPriorM5ClosePeakHighStressDDPct"],37.64670276,places=8)
  self.assertEqual(a["worstChronologicalHighEvent"]["id"],"S3_01700")
  self.assertGreater(a["maximumPriorM5ClosePeakHighStressDDPct"],a["maximum5MCloseMarkedDDPct"])
 def test_all_source_trades_intact_and_right_censored_not_fills(self):
  grouped={}
  for z in self.ledger:grouped[z["modelGroup"]]=grouped.get(z["modelGroup"],0)+1
  self.assertEqual(grouped["SOURCE53_SINGLE_SLOT"],66)
  self.assertEqual(grouped["S3_SINGLE_SLOT"],106)
  self.assertEqual(grouped["S3_CONFIRM_SINGLE_SLOT"],68)
  self.assertEqual(grouped["S4_SINGLE_SLOT"],44)
  self.assertEqual(grouped["S4_P25_CAPITULATION"],22)
  self.assertTrue(all(not z["synthesizedSignedVenueFill"] for z in self.ledger))
  self.assertEqual(sum(z["status"].startswith("RIGHT_CENSORED") for z in self.ledger if z["modelGroup"]=="S4_P25_CAPITULATION"),1)
if __name__=="__main__":unittest.main(verbosity=2)
