#!/usr/bin/env python3
"""P24 original S4 M5 22-position mark to market source DD exact-replay contract."""
import unittest,json
from pathlib import Path
R=Path(__file__).resolve().parents[1]/"results"
class P24(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.s=json.loads((R/"PRISM7_P24_S4_M5_DD_PEAK_TROUGH_SUMMARY_20261122.json").read_text(encoding="utf-8"))
  cls.l=json.loads((R/"PRISM7_P24_S4_M5_DD_22_POSITION_LEDGER_20261122.json").read_text(encoding="utf-8"))
  cls.p23=json.loads((R/"PRISM7_P23_M5_MARK_TO_MARKET_RISK_SUMMARY_20261122.json").read_text(encoding="utf-8"))
 def test_all_s4_trades_preserved_and_one_censored(self):
  self.assertEqual(len(self.l),22)
  self.assertEqual(self.s["sourceOriginalSetups"],120)
  self.assertEqual(self.s["singleSlotCompleted"],21)
  self.assertEqual(self.s["singleSlotCensored1"],1)
  self.assertEqual(sum(x["sourceStatus"]=="PRICE_PROXY_CLOSED" for x in self.l),21)
  self.assertEqual(sum(x["sourceStatus"].startswith("RIGHT_CENSORED") for x in self.l),1)
  self.assertTrue(all(not x["signedOwnerFillProven"] for x in self.l))
 def test_p23_m5_close_high_dd_and_open_unrealized_value_exact_parity(self):
  p=next(x for x in self.p23["groups"] if x["group"]=="S4_SINGLE_SLOT" and
   x["feeBps"]==30 and x["exitSlippageBps"]==0)
  self.assertAlmostEqual(self.s["maxM5CloseDD"]["pct"],p["maximumM5CloseMarkToMarketDDPct"])
  self.assertAlmostEqual(self.s["maxM5HighAdverseStressDD"]["pct"],p["maximumM5HighAdverseEnvelopeDDPct"])
  self.assertAlmostEqual(self.s["finalReferenceMarkedNAVYen"],p["referenceFinalEquityIncludingUnrealizedYen"],places=4)
 def test_peak_from_unrealized_flash_selloff_and_later_valley_other_trade(self):
  x=self.s["maxM5CloseDD"]
  self.assertEqual(x["peak"]["id"],"S3_01700")
  self.assertEqual(x["peak"]["kind"],"UNREALIZED_M5_CLOSE")
  self.assertEqual(x["peak"]["time"],1760131200000)
  self.assertAlmostEqual(x["peak"]["price"],.009588)
  self.assertEqual(x["valley"]["id"],"S3_02173")
  self.assertEqual(x["valley"]["time"],1761873900000)
  self.assertTrue(x["peakWasUnrealized"])
  self.assertTrue(x["crossedTrades"])
 def test_intrabar_high_stress_order_ambiguity(self):
  x=self.s["maxM5HighAdverseStressDD"]
  self.assertEqual(x["worst"]["id"],"S3_01700")
  self.assertEqual(x["worst"]["time"],1760132100000)
  self.assertFalse(x["worst"]["entryBarIntrabarOrderUnknown"])
  self.assertTrue(x["peakWasUnrealized"])
  self.assertGreater(x["pct"],self.s["maxM5CloseDD"]["pct"])
 def test_realized_only_peak_dd_does_not_clear_mark_dd(self):
  self.assertAlmostEqual(self.s["independentRealizedOnlyDDPct"]["pct"],16.101753832691625)
  self.assertGreater(self.s["maxM5CloseDD"]["pct"],20)
  self.assertGreater(self.s["maxM5HighAdverseStressDD"]["pct"],20)
  self.assertGreater(self.s["markSequenceCount"],1000)
 def test_timed_source_events_and_no_negative_trade_duration(self):
  for x in self.l:
   self.assertGreater(x["entryPrice"],0)
   self.assertGreaterEqual(x["positiveM5Bars"],1)
   self.assertGreaterEqual(x["m5MarksIncludedBeforeExit"],1)
   self.assertGreaterEqual(x["maximumPositivePrintGrossMFEFromM5LowPct"],
      x["minimumPositivePrintGrossMAEFromM5HighPct"])
   if x["sourceStatus"]=="PRICE_PROXY_CLOSED":
    self.assertGreaterEqual(x["exitTs"],x["entryTs"])
    self.assertIsNotNone(x["referenceNetReturn30BpsPctIfClosed"])
   else:
    self.assertIsNone(x["exitTs"])
if __name__=="__main__":unittest.main(verbosity=2)
