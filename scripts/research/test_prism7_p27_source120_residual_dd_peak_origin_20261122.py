#!/usr/bin/env python3
"""P27 S4 P25 residual M5 DD causal peak origin exact source reconciliation."""
import json,unittest
from pathlib import Path
R=Path(__file__).resolve().parents[1]/"results"
class P27(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.s=json.loads((R/"PRISM7_P27_S4_AFTER_CAPITULATION_RESIDUAL_DD_PEAK_SUMMARY_20261122.json").read_text(encoding="utf-8"))
  cls.l=json.loads((R/"PRISM7_P27_S4_AFTER_CAPITULATION_22_TRADE_RISK_LEDGER_20261122.json").read_text(encoding="utf-8"))
 def test_all_source120_21closed_1censored_retained(self):
  self.assertEqual(self.s["allInitialP22StructuralSetupsPreserved"],120)
  self.assertEqual(self.s["completedReferencePositions"],21)
  self.assertEqual(self.s["rightCensoredMarkedPositions"],1)
  self.assertEqual(len(self.l),22)
  self.assertTrue(self.s["sourceComparisonsSourceOriginalP25P26ExactNumericParity"])
  self.assertTrue(all(not x["entryAndExitSourceSignedVenueFill"] for x in self.l))
 def test_global_peak_from_2026_june_profitable_source_short(self):
  x=self.s["maxDrawdownM5Close"]
  self.assertEqual(x["peak"]["id"],"S3_07302")
  self.assertEqual(x["peak"]["kind"],"UNREALIZED_M5_CLOSE")
  self.assertEqual(x["peak"]["timeUtc"],"2026-06-04T02:00:00+00:00")
  self.assertAlmostEqual(x["peak"]["NAV"],35033.392365623244,places=6)
  self.assertAlmostEqual(x["peak"]["price"],.006426)
 def test_global_valley_profitably_held_2026_oct_source_trade(self):
  x=self.s["maxDrawdownM5Close"]
  self.assertEqual(x["valley"]["id"],"S3_10500")
  self.assertEqual(x["valley"]["timeUtc"],"2026-10-13T06:30:00+00:00")
  self.assertAlmostEqual(x["drawdownPct"],21.958773232604944,places=7)
  self.assertEqual(x["valley"]["kind"],"UNREALIZED_M5_CLOSE")
  trade=next(z for z in self.l if z["id"]=="S3_10500")
  self.assertEqual(trade["sourceStatus"],"PRICE_PROXY_CLOSED")
  self.assertAlmostEqual(trade["entryPrice"],.00798)
  self.assertAlmostEqual(trade["exitPrice"],.00743)
  self.assertGreater(trade["NAVAtExitOrFinalMark"],trade["cashAtEntry"])
  self.assertLess(trade["maxAdverseM5HighVsEntryGrossPct"],.7)
  self.assertEqual(trade["runningM5NAVPeakAtEntry"]["id"],"S3_07302")
 def test_profit_winner_june_mark_more_than_eventual_exit(self):
  z=next(x for x in self.l if x["id"]=="S3_07302")
  self.assertEqual(z["sourceStatus"],"PRICE_PROXY_CLOSED")
  self.assertEqual(z["exitReason"],"REFERENCE_TRAILING_STOP")
  self.assertGreater(z["NAVAtExitOrFinalMark"],z["cashAtEntry"])
  self.assertAlmostEqual(z["entryPrice"],.007601)
  self.assertAlmostEqual(z["exitPrice"],.006963)
  self.assertGreater(z["maxFavorableM5LowVsEntryGrossPct"],15)
 def test_all_time_ordered_high_stress_matches_m5close21p96(self):
  a=self.s["maxDrawdownCausallyOrderedM5High"]
  self.assertEqual(a["peak"]["id"],"S3_07302")
  self.assertEqual(a["valley"]["id"],"S3_10500")
  self.assertAlmostEqual(a["drawdownPct"],self.s["maxDrawdownM5Close"]["drawdownPct"],places=8)
  self.assertAlmostEqual(self.s["finalMarkedSourceEquityYen"],35621.10473,places=4)
  self.assertGreater(self.s["maxDrawdownM5Close"]["drawdownPct"],20)
if __name__=="__main__":unittest.main(verbosity=2)
