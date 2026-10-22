#!/usr/bin/env python3
"""M5 causality, side scoping, initial stop and profit giveback research tests."""
import importlib.util
import unittest
from pathlib import Path
from collections import Counter,defaultdict
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("fet_next_exit_research_tests",HERE/"run-fet-exits-after-hype-render-tao-20261022.py")
assert spec and spec.loader
f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)
M5=300000
class FakeSource:
 def __init__(self,bars):
  self.bars=bars
  self.times=[x[0] for x in bars]
 def getdata(self,ticker):
  assert ticker=="FETUSDT"
  return self.bars,self.times

def setup():
 bars=[(i*M5,100.,100.1,99.9,100.,1.) for i in range(25)]
 bars[2]=(2*M5,100.,107.,99.8,106.,1.)
 bars[3]=(3*M5,106.,106.1,102.4,103.,1.)
 row=dict(candidate_id="FET_TEST",strategy_id="FET",symbol="FETUSDT",side="LONG",
          entry_ts_ms=0,exit_ts_ms=20*M5,entry_price=100.)
 obs=defaultdict(int);obs["by_reason"]=Counter()
 return bars,row,obs
class Tests(unittest.TestCase):
 def test_only_fet_long(self):
  _,row,_=setup()
  for name,rule in f.RULES.items():
   self.assertTrue(f._safe_matching(row,rule))
   for replacement in (dict(strategy_id="IDLE"),dict(side="SHORT"),dict(symbol="TAOUSDT"),dict(strategy_id="HYPE_LONG")):
    self.assertFalse(f._safe_matching(dict(row,**replacement),rule))
 def test_confirmed_m5_close_arm_and_next_bar_stop(self):
  bars,row,obs=setup()
  new=f.apply_fet_trail(row,f.RULES["FET_TRAIL_5P_GIVEBACK_3P"],FakeSource(bars),10,obs)
  self.assertEqual(new["exit_ts_ms"],4*M5)
  self.assertEqual(new["exit_reason"],"RESEARCH_FET_TRAIL_5P_GIVEBACK_3P")
  self.assertAlmostEqual(new["exit_price"],103*(1-.001),places=7)
  self.assertEqual(obs["triggered"],1)
 def test_price_high_only_does_not_arm_stop(self):
  bars,row,obs=setup()
  bars[2]=(2*M5,100.,107.,99.8,104.,1.)
  bars[3]=(3*M5,104.,106.,102.4,103.,1.)
  new=f.apply_fet_trail(row,f.RULES["FET_TRAIL_5P_GIVEBACK_3P"],FakeSource(bars),10,obs)
  self.assertEqual(new["exit_ts_ms"],row["exit_ts_ms"])
  self.assertEqual(obs["triggered"],0)
 def test_bars_after_original_exit_cannot_change_trade(self):
  bars,row,obs=setup()
  row["exit_ts_ms"]=3*M5
  new=f.apply_fet_trail(row,f.RULES["FET_TRAIL_5P_GIVEBACK_3P"],FakeSource(bars),10,obs)
  self.assertEqual(new["exit_ts_ms"],row["exit_ts_ms"])
 def test_slippage_and_fill_worse_on_gap(self):
  bars,row,obs=setup()
  bars[3]=(3*M5,101.5,102.,101.,101.5,1.)
  s=FakeSource(bars)
  a=f.apply_fet_trail(row,f.RULES["FET_TRAIL_5P_GIVEBACK_3P"],s,10,obs)
  b=f.apply_fet_trail(row,f.RULES["FET_TRAIL_5P_GIVEBACK_3P"],s,30,obs)
  self.assertEqual(a["exit_ts_ms"],b["exit_ts_ms"])
  self.assertAlmostEqual(a["exit_price"],101.5*(1-.001))
  self.assertLess(b["exit_price"],a["exit_price"])
 def test_missing_internal_m5_gap_keeps_original_exit(self):
  bars,row,obs=setup()
  bars.pop(1)
  new=f.apply_fet_trail(row,f.RULES["FET_TRAIL_5P_GIVEBACK_3P"],FakeSource(bars),10,obs)
  self.assertEqual(new["exit_ts_ms"],row["exit_ts_ms"])
  self.assertEqual(obs["internal_gap"],1)
 def test_user_adopted_three_idle_rules_fixed_in_research(self):
  self.assertEqual(f.TRIPLE,"TAO_RET1H_PLUS_RENDER_SKIP_AND_PROFIT")
  self.assertEqual(f.ADOPTED["sourceResearch"]["selectedIntegratedCaseId"],f.TRIPLE)
  self.assertEqual(f.ADOPTED["implementationState"]["wiredIntoLiveRunner"],False)
  self.assertEqual(f.RULES["FET_INITIAL_3H_MINUS1P5_LOW_MFE"]["stop_pct"],.015)
if __name__=="__main__":unittest.main()
