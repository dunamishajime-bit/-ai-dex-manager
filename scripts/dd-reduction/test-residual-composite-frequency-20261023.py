#!/usr/bin/env python3
"""Static researched composite consistency checks. No live operations."""
from __future__ import annotations
import json,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/"docs/research/results/residual-composite-20261023"
first=json.loads((BASE/"RESIDUAL_COMPOSITE_ENTRY_FREQUENCY_BALANCE_20261023.json").read_text("utf-8"))
second=json.loads((BASE/"RESIDUAL_COMPOSITE_SYMBOL_ADAPTIVE_EXIT_20261023.json").read_text("utf-8"))
tail=json.loads((BASE/"RESIDUAL_COMPOSITE_ADAPTIVE_TAIL_20261023.json").read_text("utf-8"))
class TestComposite(unittest.TestCase):
 def test_scope_explicit_research_only(self):
  for r in (first,second,tail): self.assertIn("RESEARCH_ONLY",r["status"])
  self.assertIn("NO_8LOGIC",first["status"])
 def test_54_scenarios_both_costs(self):
  self.assertEqual(len(first["cases"]),54)
  for case in first["cases"]:
   self.assertEqual(set(first["sharedOneSlot"][case]),{"10","30"})
 def test_no_ghost_double_count(self):
  for case,results in first["sharedOneSlot"].items():
   for cost in ("10","30"):
    res=results[cost]
    self.assertEqual(res["primary"]["n"]+res["fallback"]["n"],res["all"]["n"],case)
    self.assertEqual(res["all"]["wins"],
      res["primary"]["wins"]+res["fallback"]["wins"],case)
 def test_21_asymmetric_both_costs(self):
  self.assertEqual(len(second["scenarioDefinition"]),21)
  self.assertEqual(set(second["results"]),set(second["scenarioDefinition"]))
  for name,costs in second["results"].items():
   self.assertEqual(costs["10"]["all"]["n"],costs["30"]["all"]["n"])
 def test_balanced_case_count_and_pf(self):
  b=second["results"]["BASE_DOGE2P5_AVAX1P5"]
  r=second["results"]["MIX_V_BTC24_HALF"]
  self.assertEqual(b["10"]["all"]["n"],86)
  self.assertEqual(r["10"]["all"]["n"],165)
  self.assertEqual(r["10"]["primary"]["n"],77)
  self.assertEqual(r["10"]["fallback"]["n"],88)
  self.assertGreater(r["10"]["all"]["pf"],1.5)
  self.assertLess(r["30"]["all"]["pf"],1.2)
  self.assertLess(r["30"]["later"]["pf"],1.)
  self.assertEqual(second["provisionalGatePasses"],[])
 def test_tail_small_sample_not_adoption(self):
  self.assertIn("NOT_PRISTINE_OOS",tail["status"])
  x=tail["cases"]["MIX_V_BTC24_HALF"]["10"]["all"]
  self.assertEqual(x["n"],7)
  self.assertEqual(x["wins"],2)
  self.assertLess(x["pf"],1)
 def test_charging_extra_30bps_penalty(self):
  for r in (first["sharedOneSlot"],second["results"]):
   for case,co in r.items():
    a=co["10"]["all"];b=co["30"]["all"]
    self.assertLess(b["returnSumPctPoints"],a["returnSumPctPoints"],case)
if __name__=="__main__":unittest.main()
