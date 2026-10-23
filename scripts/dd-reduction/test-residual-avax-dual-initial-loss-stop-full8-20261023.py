#!/usr/bin/env python3
"""Audit AVAX DUAL-entry initial-loss full8 native scenarios, pricing, and baseline."""
from __future__ import annotations
import json,unittest
from pathlib import Path
HERE=Path(__file__).resolve().parent
DOC=HERE.parents[1]/"docs/research/results/residual-composite-20261023"
J=json.loads((DOC/"RESIDUAL_AVAX_DUAL_INITIAL_STOP_FULL8_20261023.json").read_text("utf8"))
OLD=json.loads((DOC/"RESIDUAL_AVAX_COMPOSITE_ENTRY_VETO_FULL8_20261023.json").read_text("utf8"))
class TestFull8InitialStops(unittest.TestCase):
 def test_seven_scenarios_both_costs(self):
  self.assertEqual(len(J["cases"]),7)
  self.assertEqual(J["costsBps"],[10,30])
  self.assertIn("RESEARCH_ONLY",J["status"])
  self.assertIn("NOT_LIVE",J["status"])
  for name,val in J["cases"].items():
   self.assertEqual(set(val["costs"]),{"10","30"})
 def test_baseline_exact_trade_sha(self):
  for cost in ("10","30"):
   a=J["cases"]["BASE_DUAL"]["costs"][cost]
   b=OLD["cases"]["VETO_DUAL"]["costs"][cost]
   self.assertEqual(a["ledgerSha256"],b["ledgerSha256"])
   self.assertEqual(a["closedTrades"],b["closedTrades"])
   self.assertAlmostEqual(a["finalEquityJpy"],b["finalEquityJpy"],places=7)
   self.assertEqual(a["initialStopCount"],0)
 def test_accounting_risk_and_reselection(self):
  for name,val in J["cases"].items():
   for cost,x in val["costs"].items():
    self.assertEqual(x["accounting"],"PASS")
    self.assertEqual(x["reselectionPasses"],3)
    self.assertEqual(sum(x["byStrategy"].values()),x["closedTrades"])
    self.assertEqual(x["byStrategy"]["RESIDUAL"],x["avaxCount"])
    self.assertEqual(len(x["ledgerSha256"]),64)
    self.assertEqual(x["initialStopCount"],len(x["initialStopTimes"]))
    self.assertGreaterEqual(x["avaxCount"],15)
 def test_absent_loose_stops_do_not_generate_exit(self):
  for cost in ("10","30"):
   self.assertEqual(J["cases"]["EARLY_2H_LOSS3"]["costs"][cost]["initialStopCount"],0)
 def test_all_stop_variants_scope_avx_only(self):
  s=(HERE/"research-residual-avax-dual-initial-loss-stop-full8-20261023.py").read_text("utf8")
  self.assertIn('row.get("strategy_id")!="RESIDUAL"',s)
  self.assertIn('row.get("symbol")=="DOGEUSDT"',s)
  self.assertIn('veto=reference.reason("DUAL",avax,btc)',s)
  self.assertIn('selected["ts"]',s)
  self.assertIn('original_apply(row,rule,source,cost_bps,obs,original_row=original_row)',s)
  self.assertIn('native.replay(source_name,cost,source,helper,previous,STOCK)',s)
if __name__=="__main__":unittest.main()
