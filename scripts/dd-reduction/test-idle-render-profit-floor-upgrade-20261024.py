#!/usr/bin/env python3
"""Unit tests for RENDER SHORT complete-M5 profit-floor research proxy."""
import importlib.util,unittest
from pathlib import Path
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('floor_module',HERE/'idle-render-profit-floor-upgrade-20261024.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
M=m.M5;T=1792000000000
def bar(i,op,hi,low,cl):
 return (T+i*M,op,hi,low,cl,100)
B=[
 bar(0,100,100.3,99.3,100),
 bar(1,100,100.1,97.5,98), # arm after completion only
 bar(2,98.5,99.65,98.2,99),
 bar(3,99,100,98.8,99.5),
 bar(4,99.5,100.1,99,100),
 bar(5,100,100.1,99.5,100)]
class Source:
 def __init__(self,rows=B):self.rows=rows
 def getdata(self,_):return self.rows,[z[0] for z in self.rows]
def trade(exitBars=5,side='SHORT',sym='RENDERUSDT'):
 return {'strategy_id':'IDLE','side':side,'symbol':sym,
  'entry_ts_ms':T,'exit_ts_ms':T+exitBars*M,'entry_price':100,
  'exit_price':100.1,'exit_reason':'TIME_EXIT','candidate_id':'test'}
class Tests(unittest.TestCase):
 def test_floor_half_cost30_wins(self):
  a=m.upgrade(trade(),Source(),30,.005)
  self.assertEqual(a['exit_ts_ms'],T+3*M)
  self.assertAlmostEqual(a['exit_price'],99.5*1.003,places=5)
  self.assertGreater(a['unit_price_return'],0)
 def test_floor_threequarter_cost30_wins_more(self):
  a=m.upgrade(trade(),Source(),30,.0075)
  self.assertEqual(a['exit_ts_ms'],T+3*M)
  self.assertAlmostEqual(a['exit_price'],99.25*1.003,places=5)
  self.assertGreater(a['unit_price_return'],0.004)
 def test_arm_requires_completed_close_not_same_bar(self):
  bars=[bar(0,100,100.3,99.3,100),bar(1,100,110,97,98),
        bar(2,98,98.7,97,98),bar(3,98,98,97,97.5)]
  a=m.upgrade(trade(exitBars=3),Source(bars),10,.005)
  self.assertEqual(a['exit_ts_ms'],T+3*M)
  self.assertEqual(a['exit_reason'],'TIME_EXIT')
 def test_gap_open_degraded_fill(self):
  bars=list(B);bars[2]=bar(2,100.2,101,99,100.4)
  a=m.upgrade(trade(),Source(bars),30,.005)
  self.assertAlmostEqual(a['exit_price'],100.2*1.003)
  self.assertLess(a['unit_price_return'],0)
 def test_pass_through_other_symbol(self):
  t=trade(sym='DOTUSDT')
  self.assertIs(t,m.upgrade(t,Source(),30,.005))
 def test_pass_through_long(self):
  t=trade(side='LONG')
  self.assertIs(t,m.upgrade(t,Source(),30,.005))
 def test_reject_no_data(self):
  with self.assertRaises(RuntimeError):m.upgrade(trade(),Source([]),30,.005)
 def test_reject_unreasonable_floor(self):
  with self.assertRaises(AssertionError):m.upgrade(trade(),Source(),30,.03)
 def test_idempotence_of_causality(self):
  # Future bars cannot affect the completed-M5 trigger on bar 2.
  b=list(B);b[4]=bar(4,10,110,1,200)
  a=m.upgrade(trade(),Source(),30,.005)
  c=m.upgrade(trade(),Source(b),30,.005)
  self.assertEqual(a['exit_price'],c['exit_price'])
if __name__=='__main__':unittest.main()
