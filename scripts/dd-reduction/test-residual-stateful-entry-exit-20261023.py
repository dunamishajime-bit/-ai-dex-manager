#!/usr/bin/env python3
"""Integrity and causal-exit tests for research-residual-stateful-entry-exit-20261023.py."""
from __future__ import annotations
import importlib.util,json,math,unittest
from pathlib import Path
HERE=Path(__file__).resolve().parent
p=HERE/"research-residual-stateful-entry-exit-20261023.py"
sp=importlib.util.spec_from_file_location("deep_residual_exit",p)
m=importlib.util.module_from_spec(sp)
sp.loader.exec_module(m)
R=HERE.parents[1]/"docs/research/results/residual-entry-exit-deep-20261023/RESIDUAL_ENTRY_EXIT_DEEP_RESEARCH_20261023.json"
def synthetic(hi=100,lo=100,close=100):
 b=[(i*m.M5,100.,100.,100.,100.,10.) for i in range(260)]
 return b,[r[0] for r in b]
class TestDeepResidualExit(unittest.TestCase):
 def test_both_touch_long_stop_before_take(self):
  b,t=synthetic()
  b[0]=(0,100.,126.,89.,100.,10.)
  r=m.simulate(b,t,0,"LONG",m.EXIT_CASES["ORIGINAL_12H"],10)
  self.assertEqual(r["reason"],"HARD_STOP")
  self.assertAlmostEqual(r["netPct"],-10.1,places=5)
 def test_both_touch_short_stop_before_take(self):
  b,t=synthetic()
  b[0]=(0,100.,111.,74.,100.,10.)
  r=m.simulate(b,t,0,"SHORT",m.EXIT_CASES["ORIGINAL_12H"],30)
  self.assertEqual(r["reason"],"HARD_STOP")
  self.assertAlmostEqual(r["netPct"],-10.3,places=5)
 def test_early_loss_only_after_completed_bar_and_next_open(self):
  b,t=synthetic()
  b[12]=(12*m.M5,100,100,97,97,10.)
  b[13]=(13*m.M5,96.,100.,95.,99.,10.)
  r=m.simulate(b,t,0,"LONG",m.EXIT_CASES["EARLY_1H_NEG2"],10)
  self.assertEqual(r["reason"],"EARLY_LOSS_NEXT_OPEN")
  self.assertEqual(r["exitTsMs"],13*m.M5)
  self.assertEqual(r["exit"],96.)
 def test_profit_arm_only_on_previous_confirmed_bar(self):
  b,t=synthetic()
  b[0]=(0,100,103.5,99,103.,10.)
  b[1]=(m.M5,102.5,103.,100.,102.,10.)
  b[2]=(2*m.M5,101.2,102.,100.,101.,10.)
  r=m.simulate(b,t,0,"LONG",m.EXIT_CASES["PROFIT_ARM3_FLOOR1"],10)
  self.assertEqual(r["reason"],"PROFIT_FLOOR_NEXT_OPEN")
  self.assertEqual(r["exitTsMs"],2*m.M5)
  self.assertAlmostEqual(r["exit"],101.2)
 def test_cost_is_only_pnl_shift_not_entry_timing(self):
  b,t=synthetic()
  r10=m.simulate(b,t,0,"LONG",m.EXIT_CASES["ORIGINAL_12H"],10)
  r30=m.simulate(b,t,0,"LONG",m.EXIT_CASES["ORIGINAL_12H"],30)
  self.assertEqual(r10["exitTsMs"],r30["exitTsMs"])
  self.assertAlmostEqual(r10["netPct"]-r30["netPct"],.2)
 def test_no_future_input_for_signal_violations_in_code(self):
  s=p.read_text("utf-8")
  self.assertIn("decision=times[j]+M5",s)
  self.assertIn("f=base.features.get_feat(src,sym,decision)",s)
  self.assertIn("for j in range(idx,limit)",s)
 def test_entry_candidate_population_and_status(self):
  d=json.loads(R.read_text("utf-8"))
  self.assertIn("NO_FULL8",d["status"])
  self.assertEqual(len(d["entryRules"]),13)
  self.assertEqual(len(d["exitRules"]),13)
  self.assertEqual(d["exploratoryQualificationOnly"],[])
  for symbol in m.SYMS:
   self.assertEqual(d["coverage"][symbol]["completeHourlyDecisions"],8747)
   for n in m.ENTRY_NAMES:
    a=d["entryResults"][n][symbol]
    self.assertEqual(a["10"]["all"]["n"],a["30"]["all"]["n"])
    self.assertEqual(a["10"]["all"]["n"],sum(a["10"][f"Q{i}"]["n"] for i in range(1,5)))
 def test_half_year_deterioration_not_missed(self):
  d=json.loads(R.read_text("utf-8"))
  for symbol in m.SYMS:
   row=d["entryResults"]["SHORT_RETEST_FAIL"][symbol]["10"]
   self.assertLess(row["later"]["pf"],row["train"]["pf"])
if __name__=="__main__":
 unittest.main()
