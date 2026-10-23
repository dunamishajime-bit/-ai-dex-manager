#!/usr/bin/env python3
"""NO_DOGE AVAX 6H + trailing composite native full8 reproducibility checks."""
from __future__ import annotations
import json,unittest
from pathlib import Path
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
DIR=ROOT/"docs/research/results/residual-composite-20261023"
BEFORE=json.loads((DIR/"RESIDUAL_AVAX_EXIT_NO_DOGE_NATIVE_FULL8_20261023.json").read_text("utf8"))
NEW=json.loads((DIR/"RESIDUAL_AVAX_6H_TRAIL3_COMBO_FULL8_20261023.json").read_text("utf8"))
SELECTED=["BASE_NO_DOGE","TIME_6H","TRAIL_ARM3_GIVE1P5","COMBO_TIME6_TRAIL3_GIVE1P5"]
class TestCausalComboNativeFull8(unittest.TestCase):
 def test_scope_and_complete_costs(self):
  self.assertIn("RESEARCH_ONLY",NEW["status"])
  self.assertIn("NOT_LIVE",NEW["status"])
  self.assertEqual(NEW["costsBps"],[10,30])
  self.assertEqual(set(NEW["cases"]),set(SELECTED))
  for key in SELECTED:self.assertEqual(set(NEW["cases"][key]["costs"]),{"10","30"})
 def test_original_benchmarks_ledger_exactly_reproducible(self):
  for key in SELECTED[:-1]:
   for cost in ("10","30"):
    actual=NEW["cases"][key]["costs"][cost]
    base=BEFORE["cases"][key]["costs"][cost]
    for k in ("ledgerSha256","finalEquityJpy","maxMtmDrawdownPct","closedTrades",
              "residualAvaxTrades","residualDogeTrades","avaxWins","changedAvaxExits"):
     self.assertEqual(actual[k],base[k],(key,cost,k))
 def test_full8_accounting_and_ownership(self):
  for key in SELECTED:
   for cost,x in NEW["cases"][key]["costs"].items():
    self.assertEqual(x["accounting"],"PASS")
    self.assertEqual(x["reselectionPasses"],3)
    self.assertEqual(x["residualDogeTrades"],0)
    self.assertGreater(x["residualAvaxTrades"],0)
    self.assertEqual(sum(x["byStrategy"].values()),x["closedTrades"])
    self.assertEqual(len(x["ledgerSha256"]),64)
 def test_new_exit_affects_at_least_one_avax(self):
  for cost in ("10","30"):
   x=NEW["cases"]["COMBO_TIME6_TRAIL3_GIVE1P5"]["costs"][cost]
   self.assertGreater(x["changedAvaxExits"],0)
   self.assertGreaterEqual(x["closedTrades"],1250)
 def test_definition_is_disjunction_under_cap(self):
  p=(HERE/"research-residual-avax-exit-after-no-doge-20261023.py").read_text("utf8")
  self.assertIn('"COMBO_TIME6_TRAIL3_GIVE1P5":{"kind":"combo","parts":["TIME_6H","TRAIL_ARM3_GIVE1P5"]}',p)
  q=(HERE/"research-residual-avax-exit-native-full8-after-no-doge-20261023.py").read_text("utf8")
  self.assertIn('"COMBO_TIME6_TRAIL3_GIVE1P5":"COMBO_TIME6_TRAIL3_GIVE1P5"',q)
  self.assertIn('native.replay(',q)
if __name__=="__main__":unittest.main()
