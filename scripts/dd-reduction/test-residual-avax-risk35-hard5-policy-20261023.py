#!/usr/bin/env python3
"""Synthetic causal bar tests for -3.5% two-hour watch and immediate -5% floor."""
from __future__ import annotations
import importlib.util,unittest
from pathlib import Path
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("avax_hedge35_policy",HERE/"research-residual-avax-risk35-hard5-policy-20261023.py")
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
M5=p.M5;T=1760100000000
def make_bars(n=140):
 return [[T+i*M5,100.,100.,100.,100.,1.] for i in range(n)]
def make_row(hours=10):
 return {"strategy_id":"RESIDUAL","symbol":"AVAXUSDT","side":"LONG",
 "entry_ts_ms":T,"exit_ts_ms":T+hours*3600000,"entry_price":100.,"exit_price":100.}
class Feed:
 def __init__(self,bars):self.bars=bars;self.times=[x[0] for x in bars]
 def getdata(self,symbol):
  assert symbol=="AVAXUSDT"
  return self.bars,self.times
class TestAvaRiskHedge(unittest.TestCase):
 def test_max_minus331_winner_untouched(self):
  b=make_bars();b[20][3]=96.69;b[20][4]=96.75
  self.assertIsNone(p.find_risk_exit(make_row(),Feed(b)))
 def test_three_five_touch_arms_watcher_not_immediate_exit(self):
  b=make_bars();b[10][3]=96.5;b[10][4]=98.
  self.assertIsNone(p.find_risk_exit(make_row(),Feed(b)))
 def test_still_under_after_exact_two_hours_exits_next_m5_open(self):
  b=make_bars();b[10][3]=96.49;b[10][4]=97.
  for j in range(30,36):b[j][1]=96.3;b[j][3]=96.1;b[j][4]=96.2
  ret=p.find_risk_exit(make_row(),Feed(b))
  self.assertIsNotNone(ret)
  self.assertEqual(ret["trigger"],"SOFT_MINUS3P5_WATCH2H")
  self.assertEqual(ret["touchTsMs"],T+11*M5)
  self.assertEqual(ret["watchDeadlineMs"],T+35*M5)
  self.assertEqual(ret["ts"],T+35*M5)
  self.assertAlmostEqual(ret["fill"],96.3)
 def test_recovered_at_two_hours_does_not_stop(self):
  b=make_bars();b[10][3]=96.4;b[10][4]=97.
  b[34][4]=96.51
  self.assertIsNone(p.find_risk_exit(make_row(),Feed(b)))
 def test_rearm_new_touch_after_recovery(self):
  b=make_bars();b[10][3]=96.4
  b[40][3]=96.4
  for j in range(58,67):b[j][1]=96.2;b[j][3]=96.1;b[j][4]=96.2
  out=p.find_risk_exit(make_row(),Feed(b))
  self.assertEqual(out["trigger"],"SOFT_MINUS3P5_WATCH2H")
  self.assertEqual(out["touchTsMs"],T+41*M5)
  self.assertEqual(out["ts"],T+65*M5)
 def test_hard_minus_five_immediate_no_watcher(self):
  b=make_bars();b[2][3]=95.;b[2][4]=99.
  out=p.find_risk_exit(make_row(),Feed(b))
  self.assertEqual(out["trigger"],"HARD_MINUS5_ANY_TOUCH")
  self.assertEqual(out["ts"],T+3*M5)
  self.assertEqual(out["fill"],95.)
 def test_gap_worse_than_hard_stop_never_filled_optimistically(self):
  b=make_bars();b[2][1]=93.;b[2][3]=92.8;b[2][4]=94.
  out=p.find_risk_exit(make_row(),Feed(b))
  self.assertEqual(out["trigger"],"HARD_MINUS5_ANY_TOUCH")
  self.assertEqual(out["fill"],93.)
  self.assertAlmostEqual(out["fillRetPct"],-7.,places=10)
 def test_hard_stop_trumps_soft_when_both_eligible(self):
  b=make_bars();b[10][3]=96.4
  for j in range(30,36):b[j][3]=96.1;b[j][4]=96.2
  b[34][3]=94.7
  out=p.find_risk_exit(make_row(),Feed(b))
  self.assertEqual(out["trigger"],"HARD_MINUS5_ANY_TOUCH")
  self.assertEqual(out["ts"],T+35*M5)
 def test_after_prior_native_exit_no_stop(self):
  b=make_bars();b[70][3]=92.
  self.assertIsNone(p.find_risk_exit(make_row(hours=4),Feed(b)))
 def test_invalid_missing_m5_fails_closed(self):
  b=make_bars();del b[3]
  with self.assertRaisesRegex(RuntimeError,"M5_NEXT_OPEN_MISSING|M5_INTERNAL_DATA_GAP"):
   p.find_risk_exit(make_row(),Feed(b))
 def test_mismatch_of_entry_to_first_open_fails_closed(self):
  b=make_bars();b[0][1]=80.
  with self.assertRaisesRegex(RuntimeError,"M5_ENTRY_BASE_PRICE_MISMATCH"):
   p.find_risk_exit(make_row(),Feed(b))
if __name__=="__main__":unittest.main()
