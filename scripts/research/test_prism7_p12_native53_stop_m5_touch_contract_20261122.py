#!/usr/bin/env python3
"""P12 source native PENGU SHORT V20 STOP trade-touch time observation tests.

Tests are price-print reproducibility checks, not signed STOP or exit fills.
"""
import csv
import json
import pathlib
import unittest
from collections import Counter

R=pathlib.Path(__file__).resolve().parents[1]/"results"
class NativeStopTouch(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.sum=json.loads((R/"PRISM7_P12_NATIVE53_STOP_M5_TOUCH_SUMMARY_20261122.json").read_text(encoding="utf-8"))
  with (R/"PRISM7_P12_NATIVE53_STOP_M5_TOUCH_LEDGER_20261122.csv").open("r",encoding="utf-8",newline="") as f:
   cls.rows=list(csv.DictReader(f))
  cls.original=json.loads((R/"PRISM7_P8_PINNED_NATIVE53_REAL_PARITY_20261122_53_CASES.json").read_text(encoding="utf-8"))
 def test_53_source_price_reason_time_unchanged(self):
  self.assertEqual(len(self.rows),53)
  original={(x["period"],x["id"],x["entryTs"]):x for x in self.original}
  self.assertEqual(len(original),53)
  for x in self.rows:
   k=(x["period"],x["id"],int(x["entry_ts"]))
   old=original[k]
   self.assertEqual(int(x["source_exit_ts"]),old["exitTs"])
   self.assertEqual(x["source_exit_reason"],old["exitReason"])
   self.assertEqual(float(x["source_exit_price"]),old["exitPrice"])
   self.assertEqual(float(x["source_native_net30_pct"]),old["net30pct"])
   self.assertEqual(int(x["source_exit_ts"])-int(x["decision_reference_ts"]),3600000)
 def test_all_23_native_source_stop_m5_touched(self):
  a=self.sum["overall"]
  self.assertEqual(a["stops"],23)
  self.assertEqual(a["stop_trade_touch_yes"],23)
  self.assertEqual(a["stop_trade_touch_no"],0)
  self.assertEqual(self.sum["by_reason"]["SHORT_HARD_STOP"]["count"],14)
  self.assertEqual(self.sum["by_reason"]["SHORT_TRAILING_STOP"]["count"],9)
  for x in self.rows:
   if x["exit_is_stop"]!="1":continue
   self.assertEqual(x["decision_h1_M5_positive_stop_touch"],"1")
   self.assertGreaterEqual(float(x["source_decision_H1_high"])+1e-11,
                           float(x["source_stop_price"]))
   self.assertGreaterEqual(float(x["decision_h1_M5_max_positive_high"])+1e-11,
                           float(x["source_stop_price"]))
 def test_native_stop_source_timestamp_is_end_of_H1(self):
  stops=[x for x in self.rows if x["exit_is_stop"]=="1"]
  self.assertEqual(len(stops),23)
  latency=[float(x["first_stop_touch_to_source_exitTs_min"]) for x in stops]
  self.assertEqual(min(latency),5)
  self.assertEqual(max(latency),60)
  self.assertEqual(self.sum["stop_print_touch_source_exit_latency_minutes"]["median"],50)
  for x in stops:
   touch=int(x["first_positive_M5_stop_touch_ts"])
   self.assertEqual((touch-int(x["decision_reference_ts"]))%300000,0)
   self.assertLess(touch,int(x["source_exit_ts"]))
   self.assertGreater(int(x["first_stop_touch_to_source_exitTs_min"].split(".")[0]),0)
 def test_other30_next_H1_trade_availability(self):
  others=[x for x in self.rows if x["exit_is_stop"]=="0"]
  self.assertEqual(len(others),30)
  a=self.sum["overall"]
  self.assertEqual(a["nonstop_next_h1_immediate_trade"],12)
  self.assertEqual(a["nonstop_next_h1_later_trade"],15)
  self.assertEqual(a["nonstop_next_h1_no_trade"],3)
  present=[x for x in others if x["next_h1_print_delay_min"]!=""]
  self.assertEqual(len(present),27)
  self.assertTrue(all(float(x["source_exit_price_vs_next_first_print_open_pct"])==0 for x in present))
  missing=[x for x in others if x["next_h1_print_delay_min"]==""]
  self.assertEqual(len(missing),3)
  self.assertEqual(sum(x["native_win30"]=="1" for x in missing),1)
 def test_no_owner_fills_and_period_parity(self):
  self.assertEqual(self.sum["native_source_winners"],29)
  self.assertEqual({p:d["count"] for p,d in self.sum["by_period"].items()},
    {"BASE_2025_2026":40,"PRE_2025_AUG_SEP":6,"POST_2026_OCT_NOV":7})
  self.assertTrue(all(x["native_exit_is_signed_fill"]=="False" and
    x["positive_print_touch_proves_owner_stop_fill"]=="False" for x in self.rows))
if __name__=="__main__":
 unittest.main(verbosity=2)
