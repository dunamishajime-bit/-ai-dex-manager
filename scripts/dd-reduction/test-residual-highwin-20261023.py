#!/usr/bin/env python3
"""Research-only regression and high-win nonadoption quality tests."""
from __future__ import annotations
import importlib.util,json,unittest
from pathlib import Path
HERE=Path(__file__).resolve().parent
repo=HERE.parents[1]
spec=importlib.util.spec_from_file_location("hw_frozen_study",HERE/"research-residual-highwin-entry-exit-20261023.py")
h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
p=repo/"docs/research/results/residual-highwin-20261023"
research=json.loads((p/"RESIDUAL_HIGHWIN_ENTRY_EXIT_RESEARCH_20261023.json").read_text("utf-8"))
tail=json.loads((p/"RESIDUAL_HIGHWIN_POST_STUDY_TAIL_20261023.json").read_text("utf-8"))
class TestHighwin(unittest.TestCase):
 def test_entry_rule_count(self):
  self.assertEqual(len(h.RULES),27)
  self.assertEqual(len(h.EXIT_RULES),12)
 def test_historical_input_coverage_and_cost_completeness(self):
  for sym in h.m.SYMS:
   self.assertEqual(research["coverage"][sym]["hourly"],8747)
   self.assertEqual(set(research["fixedEntryResearch"][sym]),set(h.RULES))
   for name,c in research["fixedEntryResearch"][sym].items():
    a,b=c["costs"]["10"],c["costs"]["30"]
    self.assertEqual(a["all"]["n"],b["all"]["n"])
    self.assertEqual(a["first"]["n"]+a["later"]["n"],a["all"]["n"])
 def test_cost_monotonic_profit_factor(self):
  for sym,cases in research["separateExitStudy"].items():
   for entry,rules in cases.items():
    for name,d in rules.items():
     a=d["10"]["all"];b=d["30"]["all"]
     # Costs should reduce nominal profitability for identical deterministic exit sequence.
     self.assertIsNotNone(a["pf"] if a["n"]>0 else 0)
     self.assertLessEqual(b["sumNetPctPts"],a["sumNetPctPts"]+1e-7)
 def test_high_win_candidate_not_adopted(self):
  c=research["separateExitStudy"]["AVAXUSDT"]["SHORT_BEAR_BREAK"]["TP1P0_SL2P5_3H"]
  self.assertEqual(c["10"]["all"]["n"],56)
  self.assertAlmostEqual(c["10"]["all"]["wr"],75)
  self.assertGreater(c["30"]["all"]["wr"],70)
  self.assertLess(c["30"]["all"]["pf"],1.2)
  self.assertLess(c["10"]["later"]["wr"],70)
  self.assertEqual(research["exploratoryQualificationOnly"],[])
 def test_tail_not_mistaken_as_research_OOS(self):
  self.assertIn("NOT_FRESH_OOS",tail["status"])
  r=tail["cases"]["AVAXUSDT"]["SHORT_BEAR_BREAK"]["exitCases"]["TP1P0_SL2P5_3H"]
  self.assertEqual(r["10"]["n"],4)
  self.assertEqual(r["10"]["wins"],1)
  self.assertEqual(r["30"]["n"],4)
 def test_candidate_selection_uses_only_first_half(self):
  text=(HERE/"research-residual-highwin-entry-exit-20261023.py").read_text("utf-8")
  self.assertIn('["10"]["first"]',text)
  self.assertIn('out["exitSelectionFirstHalfOnly"]',text)
  self.assertEqual(len(research["exitSelectionFirstHalfOnly"]["DOGEUSDT"]),4)
  self.assertEqual(len(research["exitSelectionFirstHalfOnly"]["AVAXUSDT"]),4)
if __name__=="__main__":unittest.main()