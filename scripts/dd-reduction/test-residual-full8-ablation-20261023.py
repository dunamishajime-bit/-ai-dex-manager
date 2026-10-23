#!/usr/bin/env python3
"""Native 8-logic RESIDUAL ablation archive QA (research only, never LIVE)."""
from __future__ import annotations
import json,unittest
from pathlib import Path

HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
ARCHIVE=REPO/"docs/research/results/residual-composite-20261023/RESIDUAL_FULL8_ABLATION_RESULT_20261023.json"
CASE=json.loads(ARCHIVE.read_text("utf-8"))
class TestResidualFull8Balanced(unittest.TestCase):
 def test_status_no_production(self):
  self.assertIn("RESEARCH_ONLY",CASE["status"])
  self.assertTrue(CASE["stockOriginalSuppressed11NotRecreated"])
  self.assertEqual(set(CASE["cases"]),{"BASE_REPLAY","NO_RESIDUAL","NO_DOGE","NO_AVAX"})
  self.assertEqual(CASE["costsBps"],[10,30])
 def test_pinned_baseline_exact_and_accounting(self):
  anchor={"10":(247438945.47375035,-14.603309760733396,1298,"b9b93eee5bfe357dd0265a67b1ee4ed81f197b015daabbd281144ece9593097b"),
          "30":(144336412.92864558,-15.80770763869479,1297,"e4d88bb36373a9697f33c9460abc1535e4b68bf751df25dd28614522830b2ae5")}
  for cost,(equity,dd,n,ledger) in anchor.items():
   x=CASE["cases"]["BASE_REPLAY"][cost]
   self.assertAlmostEqual(x["portfolioEquityJpy"],equity,places=2)
   self.assertAlmostEqual(x["maxMtmDDPct"],dd,places=8)
   self.assertEqual(x["totalTrades"],n)
   self.assertEqual(x["ledgerSha256"],ledger)
   self.assertEqual(x["accounting"],"PASS")
 def test_every_scenario_both_cost_and_converged(self):
  for k,costs in CASE["cases"].items():
   self.assertEqual(set(costs),{"10","30"})
   for cost in ("10","30"):
    r=costs[cost]
    self.assertEqual(r["reselectionPasses"],3,(k,cost))
    self.assertEqual(r["accounting"],"PASS",(k,cost))
    self.assertEqual(sum(r["byStrategy"].values()),r["totalTrades"],(k,cost))
    self.assertEqual(len(r["ledgerSha256"]),64)
 def test_no_doge_improves_full8_and_retains_trade_count(self):
  for cost in ("10","30"):
   base=CASE["cases"]["BASE_REPLAY"][cost]
   r=CASE["cases"]["NO_DOGE"][cost]
   self.assertGreater(r["equityDeltaFrom8LogicBaselineJpy"],7000000)
   self.assertGreater(r["PF"],base["PF"])
   self.assertGreaterEqual(r["maxMtmDDPct"],base["maxMtmDDPct"])
   self.assertGreaterEqual(r["totalTrades"]/base["totalTrades"],.98)
   self.assertEqual(r["residualDoge"],0)
   self.assertEqual(r["residualAvax"],15)
   self.assertEqual(base["residualAvax"],13)
 def test_no_residual_is_less_balanced_under_strict_dd_and_frequency(self):
  for cost in ("10","30"):
   base=CASE["cases"]["BASE_REPLAY"][cost]
   r=CASE["cases"]["NO_RESIDUAL"][cost]
   self.assertEqual(r["residualTrades"],0)
   self.assertLess(r["totalTrades"]/base["totalTrades"],.98)
  self.assertLess(CASE["cases"]["NO_RESIDUAL"]["30"]["ddDeltaPctPoints"],0)
 def test_no_avax_fails_equity_improvement(self):
  for cost in ("10","30"):
   r=CASE["cases"]["NO_AVAX"][cost]
   self.assertEqual(r["residualAvax"],0)
   self.assertLess(r["equityDeltaFrom8LogicBaselineJpy"],0)
 def test_only_residual_entries_removed_in_source(self):
  code=(HERE/"research-residual-full8-ablation-20261023.py").read_text("utf-8")
  self.assertIn('original_filter=native.m.m.entry_filter',code)
  self.assertIn('if row.get("strategy_id")!="RESIDUAL"',code)
  self.assertIn('current=="NO_DOGE"',code)
  self.assertIn('native.replay(',code)
if __name__=="__main__":unittest.main()