#!/usr/bin/env python3
"""P31 source-identical both PENGU and BTC through completed buyer recovery; diverging futures regressions."""
import csv,json,unittest
from pathlib import Path
R=Path(__file__).resolve().parents[1]/"results"
class P31(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.s=json.loads((R/"PRISM7_P31_IDENTICAL_BUYER_CONFIRM_PREFIX_72_FUTURES_SUMMARY_20261122.json").read_text(encoding="utf-8"))
  with (R/"PRISM7_P31_864_CAUSAL_BUYER_FALSE_BOUNCE_LEDGER_20261122.csv").open("r",encoding="utf-8",newline="") as f:
   cls.rows=list(csv.DictReader(f))
 def group(self,regime,mask="FULL_EACH_5M",fee=30,extra=0,delay=1):
  return next(x for x in self.s["groups"] if x["futureRegime"]==regime and
   x["printMask"]==mask and x["feeBps"]==fee and x["extraSlipBps"]==extra and
   x["positiveM5Delay"]==delay)
 def test_72_identical_recovery_prefix_futures_all_864_cases(self):
  self.assertEqual(self.s["artificialFutures"],72)
  self.assertEqual(self.s["caseRows"],864)
  self.assertEqual(len(self.rows),864)
  self.assertEqual(len(self.s["groups"]),108)
  self.assertEqual(set(self.s["futureRegimeNames"]),{
   "RECOVERY_CONTINUES","SECOND_LEG_CRASH","SECOND_LEG_FAST_CRASH"})
  self.assertEqual(self.s["sourceBuyerRecoveryM5ConfirmTimeTs"],1760131500000)
  self.assertEqual(self.s["fixedPhaseSeedCount"],8)
  self.assertEqual(len(self.s["samePENGUBTCPrefixIncludingBuyerRecoverySHA256"]),64)
 def test_prefix_same_through_recovery_and_next_print_not_earlier(self):
  for row in self.rows:
   self.assertEqual(row["allPreDecisionPenguBtcM5PriceAndVolumeIdentical"],"True")
   self.assertEqual(row["P30AsOfBuyerConfirmed"],"True")
   self.assertEqual(row["P30FutureRegimeLabelNotUsedToExit"],"True")
   self.assertEqual(row["originalSourceBuyerRecoveryM5CloseTs"],"1760131500000")
   self.assertEqual(row["sourceH1NativePinnedModel"],"REFERENCE_STOP72_NOT_FULL_V20")
   self.assertEqual(row["ownSignedFillOrQuoteDepthProven"],"False")
   self.assertEqual(row["artificialFuturePathNoMarketOOS"],"True")
   if row["P30EarlyExitApplied"]=="True":
    self.assertGreaterEqual(int(row["P30BuyToCoverProxyTs"]),1760131500000)
    self.assertLess(int(row["P30BuyToCoverProxyTs"]),int(row["referenceStopTs"]))
 def test_same_prefix_recovery_vs_fast_second_dip_opposite_optimal_actions(self):
  up=self.group("RECOVERY_CONTINUES")
  down=self.group("SECOND_LEG_FAST_CRASH")
  self.assertEqual(up["P30AsOfBuyerRecoveryConfirmed"],8)
  self.assertEqual(down["P30AsOfBuyerRecoveryConfirmed"],8)
  self.assertEqual(up["P30BeforeReferenceStopExecuted"],8)
  self.assertEqual(down["P30BeforeReferenceStopExecuted"],8)
  self.assertEqual(up["sourceReferenceWinnerProfitReduced"],0)
  self.assertEqual(down["sourceReferenceWinnerProfitReduced"],8)
  self.assertGreater(up["P30MinusReferenceMeanPct"],20)
  self.assertLess(down["P30MinusReferenceMeanPct"],-29)
  self.assertAlmostEqual(up["P30MeanNetPct"],down["P30MeanNetPct"],places=6)
 def test_slow_second_downturn_also_harms_original_winning_short(self):
  slow=self.group("SECOND_LEG_CRASH")
  self.assertEqual(slow["sourceReferenceWinnerProfitReduced"],8)
  self.assertLess(slow["P30MinusReferenceMeanPct"],0)
  self.assertGreater(slow["sourceReferenceMeanNetPct"],slow["P30MeanNetPct"])
 def test_fees_slippage_do_not_make_failing_world_label_available(self):
  for reg in self.s["futureRegimeNames"]:
   for delay in (1,2):
    x=self.group(reg,fee=30,extra=0,delay=delay)
    y=self.group(reg,fee=30,extra=1000,delay=delay)
    self.assertGreaterEqual(x["P30MeanNetPct"],y["P30MeanNetPct"])
    self.assertEqual(x["P30AsOfBuyerRecoveryConfirmed"],
                     y["P30AsOfBuyerRecoveryConfirmed"])
  for row in self.rows:
   self.assertEqual(row["sourceReferenceWinnerTurnedLoser"],"False")
if __name__=="__main__":unittest.main(verbosity=2)
