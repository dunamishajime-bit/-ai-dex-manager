#!/usr/bin/env python3
"""P30 96 fixed-prefix artificial futures: no premature same-bar exit and one-step recovery verification."""
import csv,json,unittest
from pathlib import Path
from collections import Counter
R=Path(__file__).resolve().parents[1]/"results"
class P30Artificial(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.s=json.loads((R/"PRISM7_P30_RECOVERY_CONFIRMED_96_FUTURES_SUMMARY_20261122.json").read_text(encoding="utf-8"))
  with (R/"PRISM7_P30_RECOVERY_CONFIRMED_1152_SYNTHETIC_CASES_20261122.csv").open("r",encoding="utf-8",newline="") as f:
   cls.rows=list(csv.DictReader(f))
 def group(self,regime,mask="FULL_EACH_5M",fee=30,slip=0,delay=1):
  return next(z for z in self.s["groups"] if z["regime"]==regime and z["printMask"]==mask and
              z["feeBps"]==fee and z["extraSlipBps"]==slip and z["positiveM5DelayAfterRecoveryConfirm"]==delay)
 def test_full_96_paths_x_12_scenarios_and_original_prefix(self):
  self.assertEqual(self.s["numberOfArtificialFuturePaths"],96)
  self.assertEqual(self.s["allScenarioRows"],1152)
  self.assertEqual(len(self.rows),1152)
  self.assertEqual(len(self.s["groups"]),144)
  self.assertEqual(self.s["frozenPenguRecoveryThreshold"],1.01)
  self.assertEqual(self.s["frozenBtcRecoveryThreshold"],1.005)
  self.assertEqual(set(self.s["worlds"]),{
    "RECOVER_FAST","CONTINUE_DOWN","CHOPPY_REBOUND","FALSE_BOUNCE_DUMP"})
  for z in self.rows:
   self.assertEqual(int(z["identicalSourceEventEntryTs"]),1760130900000)
   self.assertEqual(int(z["identicalSourceEventCloseTs"]),1760131200000)
   self.assertAlmostEqual(float(z["sourcePinnedEntryPrice"]),.022617)
   self.assertAlmostEqual(float(z["originalPenguShockClose"]),.01)
   self.assertAlmostEqual(float(z["originalBtcShockClose"]),104694.7)
   self.assertEqual(z["sourceOrderbookOrSignedFillProven"],"False")
   self.assertEqual(z["artificialPriceFutureNotRealOOS"],"True")
 def test_unchanged_downtrend_profit_and_no_false_early_exit(self):
  for mask in self.s["masks"]:
   for fee in (10,30):
    for extra in (0,100,1000):
     for delay in (1,2):
      x=self.group("CONTINUE_DOWN",mask,fee,extra,delay)
      self.assertEqual(x["recoveryModelExecutedBeforeReferenceStop"],0)
      self.assertEqual(x["sourceOriginalWinnerProfitReduced"],0)
      self.assertAlmostEqual(x["meanP30MinusReferencePct"],0,places=9)
 def test_recovery_and_deliberate_false_bounce_have_8_model_exits_in_full_print(self):
  for world in ("RECOVER_FAST","FALSE_BOUNCE_DUMP"):
   x=self.group(world)
   self.assertEqual(x["recoveryConfirmedCount"],8)
   self.assertEqual(x["recoveryModelExecutedBeforeReferenceStop"],8)
   self.assertEqual(x["sourceOriginalWinnerProfitReduced"],0)
   self.assertGreater(x["meanP30MinusReferencePct"],3)
 def test_sparse_print_delays_are_not_fabricated_as_real_fills(self):
  for world in self.s["worlds"]:
   x=self.group(world,mask="EVERY_12TH_M5")
   self.assertEqual(x["recoveryModelExecutedBeforeReferenceStop"],0)
   self.assertEqual(x["sourceOriginalWinnerProfitReduced"],0)
 def test_future_M5_close_precedes_positive_next_m5_open_and_stop(self):
  for z in self.rows:
   if z["P30ExitTriggeredAfterNewInformation"]!="True":continue
   self.assertNotEqual(z["P30RecoverySignalClosedTs"],"")
   self.assertGreaterEqual(int(z["P30ExitTs"]),int(z["P30RecoverySignalClosedTs"]))
   self.assertLess(int(z["P30ExitTs"]),int(z["sourceReferenceExitTs"]))
   self.assertLessEqual(float(z["P30ConfirmationPenguClose"]),.05)
   self.assertEqual(z["P30ChangedSourceWinToLoss"],"False")
 def test_fee_and_slip_do_not_relabel_future_world_to_hindsight_signal(self):
  for world in self.s["worlds"]:
   x0=self.group(world,fee=30,slip=0)
   x1=self.group(world,fee=30,slip=1000)
   self.assertGreaterEqual(x0["P30RecoveredExitMeanNetPct"],x1["P30RecoveredExitMeanNetPct"])
   self.assertEqual(x0["recoveryModelExecutedBeforeReferenceStop"],
                    x1["recoveryModelExecutedBeforeReferenceStop"])
if __name__=="__main__":unittest.main(verbosity=2)
