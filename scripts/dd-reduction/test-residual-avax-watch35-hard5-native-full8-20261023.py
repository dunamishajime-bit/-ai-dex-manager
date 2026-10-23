#!/usr/bin/env python3
"""Audit baseline equivalence, research safety and full8 native results for AVAX hedge."""
from __future__ import annotations
import json,unittest
from pathlib import Path
HERE=Path(__file__).resolve().parent
DOC=HERE.parents[1]/"docs/research/results/residual-composite-20261023"
RESULT=DOC/"RESIDUAL_AVAX_WATCH35_HARD5_NATIVE_FULL8_20261023.json"
ANCHOR=DOC/"RESIDUAL_AVAX_COMPOSITE_ENTRY_VETO_FULL8_20261023.json"
class TestAvaHedgeFull8(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.actual=json.loads(RESULT.read_text("utf8"))
  cls.baseline=json.loads(ANCHOR.read_text("utf8"))
 def test_all_four_cases_two_costs_present(self):
  self.assertEqual(set(self.actual["cases"]),{"BASE_DUAL","WATCH35_2H_ONLY","HARD5_ONLY","WATCH35_2H_PLUS_HARD5"})
  for v in self.actual["cases"].values():self.assertEqual(set(v["costs"]),{"10","30"})
 def test_exact_wallet_baseline_ledger_identity(self):
  for cost in ("10","30"):
   x=self.actual["cases"]["BASE_DUAL"]["costs"][cost]
   y=self.baseline["cases"]["VETO_DUAL"]["costs"][cost]
   self.assertEqual(x["ledgerSha256"],y["ledgerSha256"])
   self.assertEqual(x["closedTrades"],y["closedTrades"])
   self.assertAlmostEqual(x["finalEquityJpy"],y["finalEquityJpy"],places=7)
 def test_reselection_accounting_costs_and_avx_only(self):
  for name,v in self.actual["cases"].items():
   for cost,x in v["costs"].items():
    self.assertEqual(x["reselectionPasses"],3)
    self.assertEqual(x["accounting"],"PASS")
    self.assertEqual(sum(x["byStrategy"].values()),x["closedTrades"])
    self.assertEqual(x["avaxCount"],x["byStrategy"]["RESIDUAL"])
    self.assertEqual(x["hard5Count"]+x["watch35Count"],x["initialStopCount"])
    self.assertGreaterEqual(x["avaxCount"],15)
 def test_components_are_exclusive(self):
  for cost in ("10","30"):
   self.assertEqual(self.actual["cases"]["WATCH35_2H_ONLY"]["costs"][cost]["hard5Count"],0)
   self.assertEqual(self.actual["cases"]["HARD5_ONLY"]["costs"][cost]["watch35Count"],0)
 def test_scope_and_no_live_changes(self):
  text=(HERE/"research-residual-avax-watch35-hard5-native-full8-20261023.py").read_text("utf8")
  self.assertIn('row.get("strategy_id")!="RESIDUAL"',text)
  self.assertIn('row.get("symbol")=="DOGEUSDT"',text)
  self.assertIn('veto=reference.reason("DUAL",avax,btc)',text)
  self.assertIn('candidate["ts"]<=selected["ts"]',text)
  self.assertIn('native.replay(source_name,cost,source,helper,previous,STOCK)',text)
  self.assertTrue(self.actual["status"].startswith("RESEARCH_ONLY_"))
  self.assertTrue(self.actual["status"].endswith("NOT_LIVE"))
if __name__=="__main__":unittest.main()
