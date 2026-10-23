#!/usr/bin/env python3
"""Native 8-way AVAX entry veto result audit on preserved research study."""
from __future__ import annotations
import json,unittest
from pathlib import Path
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
DIR=ROOT/"docs/research/results/residual-composite-20261023"
TARGET=json.loads((DIR/"RESIDUAL_AVAX_COMPOSITE_ENTRY_VETO_FULL8_20261023.json").read_text("utf8"))
ANCHOR=json.loads((DIR/"RESIDUAL_AVAX_6H_TRAIL3_COMBO_FULL8_20261023.json").read_text("utf8"))["cases"]["COMBO_TIME6_TRAIL3_GIVE1P5"]["costs"]
class TestVetoNative8(unittest.TestCase):
 def test_scope_and_full_five_cases(self):
  self.assertIn("RESEARCH_ONLY",TARGET["status"])
  self.assertIn("NOT_LIVE",TARGET["status"])
  self.assertEqual(len(TARGET["cases"]),5)
  self.assertEqual(set(TARGET["costsBps"]),{10,30})
 def test_both_costs_accounting_and_cooldown_reselection(self):
  for name,v in TARGET["cases"].items():
   self.assertEqual(set(v["costs"]),{"10","30"})
   for cost,z in v["costs"].items():
    self.assertEqual(z["accounting"],"PASS")
    self.assertEqual(z["reselectionPasses"],3)
    self.assertEqual(sum(z["byStrategy"].values()),z["closedTrades"])
    self.assertEqual(len(z["ledgerSha256"]),64)
 def test_exact_composite_baseline_sha(self):
  for cost in ("10","30"):
   b=TARGET["cases"]["BASE_COMPOSITE"]["costs"][cost]
   a=ANCHOR[cost]
   self.assertEqual(b["ledgerSha256"],a["ledgerSha256"])
   self.assertEqual(b["closedTrades"],a["closedTrades"])
   self.assertAlmostEqual(b["finalEquityJpy"],a["finalEquityJpy"],places=8)
   self.assertAlmostEqual(b["ddPct"],a["maxMtmDrawdownPct"],places=8)
 def test_dual_reduces_loss_without_material_frequency_or_dd_cost(self):
  for cost in ("10","30"):
   d=TARGET["cases"]["VETO_DUAL"]["costs"][cost]
   b=TARGET["cases"]["BASE_COMPOSITE"]["costs"][cost]
   self.assertGreater(d["finalEquityJpy"],b["finalEquityJpy"])
   self.assertGreater(d["portfolioPF"],b["portfolioPF"])
   self.assertGreaterEqual(d["ddPct"],b["ddPct"])
   self.assertGreaterEqual(d["closedTrades"]/b["closedTrades"],.99)
   self.assertEqual((d["avaxCount"],d["avaxWins"]),(18,13 if cost=="10" else 12))
   self.assertGreater(d["avaxWins"]/d["avaxCount"],b["avaxWins"]/b["avaxCount"])
 def test_triple_no_economic_improvement(self):
  for cost in ("10","30"):
   d=TARGET["cases"]["VETO_DUAL"]["costs"][cost]
   t=TARGET["cases"]["VETO_TRIPLE"]["costs"][cost]
   for field in ("finalEquityJpy","portfolioPF","ddPct","closedTrades","avaxWins","avaxCount","avaxModeledPnLJpy"):
    self.assertEqual(d[field],t[field],(cost,field))
 def test_weak_divergent_30bps_dd_fails(self):
  base=TARGET["cases"]["BASE_COMPOSITE"]["costs"]["30"]
  r=TARGET["cases"]["VETO_AVAX_RALLY_BTC_WEAK"]["costs"]["30"]
  self.assertLess(r["ddPct"],base["ddPct"])
 def test_causal_panel_exact_24_and_no_out_of_sample_claim(self):
  j=json.loads((DIR/"RESIDUAL_AVAX_COMPOSITE_ENTRY_FEATURE_PANEL_20261023.json").read_text("utf8"))
  self.assertIn("RESEARCH_ONLY",j["status"])
  self.assertEqual(len(j["costs"]["10"]),24)
  self.assertEqual(len(j["costs"]["30"]),24)
  self.assertIn("last fully closed M5",j["sourceConvention"])
if __name__=="__main__":unittest.main()
