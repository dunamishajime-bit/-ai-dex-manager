#!/usr/bin/env python3
"""P29 72 artificial futures with one fixed source flash prefix: research regression."""
import csv,json,unittest
from pathlib import Path
from collections import Counter
R=Path(__file__).resolve().parents[1]/"results"
class P29(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.s=json.loads((R/"PRISM7_P29_72_IDENTICAL_PREFIX_FUTURES_SUMMARY_20261122.json").read_text(encoding="utf-8"))
  with (R/"PRISM7_P29_1296_SYNTHETIC_OUTCOME_LEDGER_20261122.csv").open("r",encoding="utf-8",newline="") as f:
   cls.l=list(csv.DictReader(f))
 def test_72_identical_past_x_1296_fee_slip_delay_source_events(self):
  self.assertEqual(self.s["numberOfSourceTwinArtificialFutures"],72)
  self.assertEqual(self.s["costAndDelayModelRows"],1296)
  self.assertEqual(len(self.l),1296)
  self.assertTrue(self.s["sourceEventS3_01700SamePrefixAcrossAll"])
  self.assertEqual(set(self.s["frozenThreeRegimes"]),{
   "RECOVER_FAST","CONTINUE_DOWN","CHOPPY_REBOUND"})
  self.assertEqual(set(self.s["positivePrintMasks"]),{
   "FULL_EACH_5M","EVERY_3RD_M5","EVERY_12TH_M5"})
  self.assertEqual(self.s["independentFixedSeedCountPerRegimeMask"],8)
 def test_same_source_entry_and_shock_prefix_no_new_labels_for_decision(self):
  for z in self.l:
   self.assertEqual(z["allSourceIdenticalPrefix"],"True")
   self.assertEqual(int(z["originalSourceEventTimeM5StartTs"]),1760130900000)
   self.assertEqual(int(z["originalSourceEventCloseTs"]),1760131200000)
   self.assertAlmostEqual(float(z["sourceEntryPrice"]),.022617)
   self.assertAlmostEqual(float(z["sourceEventPenguClose"]),.01)
   self.assertEqual(z["sourceEventBtcCrashPreconfirmed"],"True")
   self.assertEqual(z["syntheticMarketPathNotActualOOS"],"True")
   self.assertEqual(z["sourceSignedVenueFillProven"],"False")
   self.assertGreaterEqual(int(z["exitProxyTs"]),1760131200000)
   self.assertLessEqual(int(z["exitProxyTs"]),int(z["sourceReferenceExitTs"]))
 def test_continuing_downtrend_destroy_source_winner_gain_in_all_eight_seeds(self):
  z=[x for x in self.s["consolidatedByRegimeMaskAndCost"] if x["regime"]=="CONTINUE_DOWN"
     and x["mask"]=="FULL_EACH_5M" and x["feeBps"]==30 and x["extraSlippageBps"]==0
     and x["delayPositiveM5PrintCount"]==2]
  self.assertEqual(len(z),1)
  x=z[0]
  self.assertEqual(x["sourceTwinPaths"],8)
  self.assertEqual(x["sourceReferenceWinnersWithProfitCut"],8)
  self.assertEqual(x["sourceReferenceWinnersConvertedToLosers"],0)
  self.assertAlmostEqual(x["averageSourceNetPct"],80.7034,places=3)
  self.assertAlmostEqual(x["averageP25NetPct"],55.6201,places=3)
  self.assertLess(x["meanP25MinusReferenceNetPct"],-25)
 def test_recovery_future_helps_but_proves_current_state_ambiguous(self):
  def find(name):
   return next(x for x in self.s["consolidatedByRegimeMaskAndCost"] if x["regime"]==name and
     x["mask"]=="FULL_EACH_5M" and x["feeBps"]==30 and x["extraSlippageBps"]==0 and
     x["delayPositiveM5PrintCount"]==2)
  self.assertGreater(find("RECOVER_FAST")["meanP25MinusReferenceNetPct"],19)
  self.assertGreater(find("CHOPPY_REBOUND")["meanP25MinusReferenceNetPct"],2)
  self.assertLess(find("CONTINUE_DOWN")["meanP25MinusReferenceNetPct"],-25)
 def test_baseline_p25_early_exit_is_preempted_if_native_reference_stop_first(self):
  early=[x for x in self.l if x["capitulationEarlyExitExecutedInPriceModel"]=="True"]
  self.assertTrue(early)
  for x in early:
   self.assertLess(int(x["exitProxyTs"]),int(x["sourceReferenceExitTs"]))
  others=[x for x in self.l if x["capitulationEarlyExitExecutedInPriceModel"]=="False"]
  self.assertTrue(all(x["exitProxyTs"]==x["sourceReferenceExitTs"] for x in others))
if __name__=="__main__":unittest.main(verbosity=2)
