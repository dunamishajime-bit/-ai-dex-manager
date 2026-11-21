#!/usr/bin/env python3
"""Regress original 53 immutable PENGU entry source and M5 positive-print evidence.

No signed fills, entry price repricing or STOP recalibration.
"""
from pathlib import Path
import json,csv,unittest
from collections import Counter
R=Path(__file__).resolve().parents[1]/"results"
class PrintContract(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.summary=json.loads((R/"PRISM7_P11_NATIVE53_FIRST_PRINT_EXECUTION_AUDIT_20261122.json").read_text(encoding="utf-8"))
  with (R/"PRISM7_P11_NATIVE53_SOURCE_H1_VS_M5_FIRST_PRINT_20261122.csv").open("r",encoding="utf-8",newline="") as f:
   cls.data=list(csv.DictReader(f))
  cls.original=json.loads((R/"PRISM7_P8_PINNED_NATIVE53_REAL_PARITY_20261122_53_CASES.json").read_text(encoding="utf-8"))
 def test_full_parity_original53(self):
  self.assertEqual(len(self.data),53)
  self.assertEqual(self.summary["source_native_original_win30_count"],29)
  old={(x["period"],x["id"],x["entryTs"]):x for x in self.original}
  self.assertEqual(len(old),53)
  for row in self.data:
   k=(row["period"],row["id"],int(row["entry_ts"]))
   o=old[k]
   self.assertAlmostEqual(float(row["native_entry_source_h1_open"]),o["entryPrice"],places=12)
   self.assertAlmostEqual(float(row["native_net30_pct_unchanged"]),o["net30pct"],places=10)
   self.assertEqual(row["native_exit_reason"],o["exitReason"])
 def test_full_execution_print_taxonomy(self):
  a=self.summary["overall"]
  self.assertEqual(a["count"],53)
  self.assertEqual(a["first5_print"],33)
  self.assertEqual(a["delayed_first_print"],19)
  self.assertEqual(a["hour_without_trade"],1)
  self.assertEqual(a["first_hour_any_print"],52)
  self.assertEqual(Counter(x["first_trade_delay_min"] for x in self.data),
   {"0":33,"5":7,"10":5,"20":1,"25":1,"30":3,"50":2,"":1})
 def test_price_first_print_and_all_unfilled_not_proven(self):
  for row in self.data:
   self.assertEqual(row["price_model_entry_is_signed_fill"],"False")
   self.assertEqual(row["m5_positive_print_proves_user_order_fill"],"False")
   if row["has_trade_during_entry_hour"]=="1":
    self.assertEqual(float(row["abs_source_h1_vs_first_print_gap_pct"]),0)
    self.assertAlmostEqual(float(row["native_entry_source_h1_open"]),
                           float(row["first_trade_m5_open"]),places=12)
 def test_no_print_is_not_hidden_as_loss(self):
  nop=[x for x in self.data if x["has_trade_during_entry_hour"]=="0"]
  self.assertEqual(len(nop),1)
  self.assertEqual(nop[0]["id"],"PENGU_00071")
  self.assertEqual(nop[0]["period"],"BASE_2025_2026")
  self.assertEqual(nop[0]["native_win30"],"1")
  self.assertGreater(float(nop[0]["native_net30_pct_unchanged"]),6.0)
 def test_period_and_win_counts_unchanged(self):
  self.assertEqual({k:v["count"] for k,v in self.summary["by_period"].items()},
      {"BASE_2025_2026":40,"PRE_2025_AUG_SEP":6,"POST_2026_OCT_NOV":7})
  self.assertEqual(self.summary["by_original_outcome"]["WIN_SOURCE_MODEL"]["count"],29)
  self.assertEqual(self.summary["by_original_outcome"]["LOSS_SOURCE_MODEL"]["count"],24)
if __name__=="__main__":
 unittest.main(verbosity=2)
