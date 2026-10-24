#!/usr/bin/env python3
"""Causal-contract tests for new RENDER short signal generator and model exits."""
import importlib.util,unittest
from pathlib import Path
HERE=Path(__file__).resolve().parent
sp=importlib.util.spec_from_file_location('entrymodel',HERE/'screen-render-fresh-rally-fade-m5-20261024.py')
m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
H=m.M5
def bar(i,op,hi,lo,close):
 return (1754784000000+i*H,op,hi,lo,close,100)
class ModelContracts(unittest.TestCase):
 def test_same_bar_stop_precedence(self):
  bars=[bar(0,100,100,100,100),bar(1,100,105,96,101),bar(2,101,101,101,101)]
  x=m.settle(bars,0,.0175,.025,6,30)
  self.assertEqual(x['exitReason'],'HARD_STOP')
  self.assertAlmostEqual(x['netPct'],-2.8)
 def test_stop_gap_open_worse(self):
  b=[bar(0,100,100,100,100),bar(1,100,100,100,100),bar(2,104,105,103,104),bar(3,104,104,104,104)]
  self.assertAlmostEqual(m.settle(b,0,.0175,.025,6,10)['netPct'],-4.1)
 def test_target_better_than_cost(self):
  b=[bar(0,100,100,100,100),bar(1,100,100,97,97),bar(2,97,97,97,97)]
  self.assertEqual(m.settle(b,0,.0175,.025,6,30)['exitReason'],'TARGET')
  self.assertAlmostEqual(m.settle(b,0,.0175,.025,6,30)['netPct'],1.45)
 def test_cost_difference_exact(self):
  b=[bar(0,100,100,100,100),bar(1,100,100,99,99),bar(2,99,99,99,99)]
  self.assertAlmostEqual(m.settle(b,0,.0175,.025,6,10)['netPct']-
   m.settle(b,0,.0175,.025,6,30)['netPct'],.2,places=6)
 def test_signal_no_next_entry_bar(self):
  bars=[bar(i,100+i*.04,100+i*.04+.2,100+i*.04-.2,100+i*.04) for i in range(330)]
  f1=m.proc(bars,bars,302,302)
  alt=list(bars);alt[303]=bar(303,500,600,1,550)
  f2=m.proc(alt,bars,302,302)
  self.assertEqual(f1,f2)
 def test_all_indicators_finite(self):
  b=[bar(i,100+i*.02,100+i*.02+.3,100+i*.02-.3,100+i*.02) for i in range(330)]
  f=m.proc(b,b,300,300)
  self.assertTrue(all(__import__('math').isfinite(x) for x in f.values()))
 def test_11_signals_distinct(self):
  self.assertEqual(len(m.PATTERNS),11)
  self.assertEqual(len(m.PATTERNS),len(set(m.PATTERNS)))
 def test_fixed_exit_policies(self):
  self.assertEqual(len(m.EXIT_POLICIES),3)
  for tp,sl,hold in m.EXIT_POLICIES.values():
   self.assertGreater(sl,tp)
   self.assertIn(hold,(6,12))
if __name__=='__main__':unittest.main()
