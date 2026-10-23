#!/usr/bin/env python3
"""Research-only integrity for NO_DOGE AVAX exit full8 portfolio counterfactual."""
from __future__ import annotations
import json,unittest
from pathlib import Path
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
REPORT=ROOT/"docs/research/results/residual-composite-20261023/RESIDUAL_AVAX_EXIT_NO_DOGE_NATIVE_FULL8_20261023.json"
BASE=ROOT/"docs/research/results/residual-composite-20261023/RESIDUAL_FULL8_ABLATION_RESULT_20261023.json"
TESTED=json.loads(REPORT.read_text("utf8"))
ANCHOR=json.loads(BASE.read_text("utf8"))["cases"]["NO_DOGE"]
class TestAvaxNativeFull8Exit(unittest.TestCase):
 def test_research_only_scope(self):
  self.assertIn("RESEARCH_ONLY",TESTED["status"])
  self.assertIn("NOT_LIVE",TESTED["status"])
  self.assertEqual(TESTED["costsBps"],[10,30])
 def test_both_costs_and_accounting(self):
  self.assertEqual(len(TESTED["cases"]),7)
  for name,v in TESTED["cases"].items():
   self.assertEqual(set(v["costs"]),{"10","30"},name)
   for cost,r in v["costs"].items():
    self.assertEqual(r["accounting"],"PASS",(name,cost))
    self.assertEqual(r["reselectionPasses"],3,(name,cost))
    self.assertEqual(r["residualDogeTrades"],0,(name,cost))
    self.assertEqual(sum(r["byStrategy"].values()),r["closedTrades"],(name,cost))
    self.assertEqual(len(r["ledgerSha256"]),64,(name,cost))
 def test_native_baseline_parity_including_ledger(self):
  for cost in ("10","30"):
   x=TESTED["cases"]["BASE_NO_DOGE"]["costs"][cost]
   a=ANCHOR[cost]
   self.assertAlmostEqual(x["finalEquityJpy"],a["portfolioEquityJpy"],places=2)
   self.assertAlmostEqual(x["maxMtmDrawdownPct"],a["maxMtmDDPct"],places=8)
   self.assertEqual(x["closedTrades"],a["totalTrades"])
   self.assertEqual(x["ledgerSha256"],a["ledgerSha256"])
 def test_time6_profit_frequency_dd_both_costs(self):
  for cost,minimum_profit,minimum_fills in (("10",4000000,1291),("30",1000000,1287)):
   t=TESTED["cases"]["TIME_6H"]["costs"][cost]
   a=ANCHOR[cost]
   self.assertGreater(t["deltaVsNoDogeBaselineJpy"],minimum_profit)
   self.assertGreaterEqual(t["closedTrades"],minimum_fills)
   self.assertGreater(t["closedTrades"],a["totalTrades"])
   self.assertGreater(t["portfolioPF"],a["PF"])
   self.assertGreaterEqual(t["maxMtmDrawdownPct"],a["maxMtmDDPct"])
   self.assertEqual(t["residualAvaxTrades"],23)
   self.assertGreaterEqual(t["changedAvaxExits"],16)
 def test_trail_tradeoff_dd30(self):
  t=TESTED["cases"]["TRAIL_ARM3_GIVE1P5"]["costs"]["30"]
  self.assertGreater(t["deltaVsNoDogeBaselineJpy"],0)
  self.assertLess(t["ddDeltaVsNoDogePctPoints"],0)
 def test_early_stop_fails_profit(self):
  for cost in ("10","30"):
   r=TESTED["cases"]["EARLY_2H_LOSS2_MFE_LT1"]["costs"][cost]
   self.assertLess(r["deltaVsNoDogeBaselineJpy"],0)
 def test_avax_changes_only_not_entry_generator(self):
  text=(HERE/"research-residual-avax-exit-native-full8-after-no-doge-20261023.py").read_text("utf8")
  self.assertIn("def filter_doge(",text)
  self.assertIn('row.get("symbol")=="DOGEUSDT"',text)
  self.assertIn('if row.get("strategy_id")!="RESIDUAL"',text)
  self.assertIn('screen._find_exit(row,rule["residualPolicy"]',text)
  self.assertIn('original_apply(row,rule,source,cost_bps,obs,original_row=original_row)',text)
  self.assertIn('native.replay(',text)
if __name__=="__main__":unittest.main()
