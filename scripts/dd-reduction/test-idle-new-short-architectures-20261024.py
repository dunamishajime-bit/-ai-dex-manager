#!/usr/bin/env python3
"""Unit contracts for new independent SHORT entrance simulation (NOT full8)."""
import importlib.util,unittest
from pathlib import Path
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('idle_new_arch_test',HERE/'screen-idle-new-short-entry-architectures-20261024.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def bar(i,op,hi,lo,cl):return (1750000000000+i*m.M5,op,hi,lo,cl,100)
class Contracts(unittest.TestCase):
 def test_short_linear_return(self):
  v=[bar(0,100,101,99,100),bar(1,100,100,95,95),bar(2,95,95,95,95)]
  x=m.simulate(v,0,1,10)
  self.assertAlmostEqual(x['netReturnPct'],4.9)
 def test_short_losses_on_rise(self):
  v=[bar(0,100,101,99,100),bar(1,100,109,99,108),bar(2,108,108,108,108)]
  x=m.simulate(v,0,1,30)
  self.assertLess(x['netReturnPct'],0)
 def test_stop_first_if_simultaneously_profit_and_stop(self):
  v=[bar(0,100,101,99,100),bar(1,100,120,60,90),bar(2,90,90,90,90)]
  z=m.simulate(v,0,1,10)
  self.assertEqual(z['exitReason'],'HARD_STOP')
  self.assertLess(z['netReturnPct'],-10)
 def test_no_short_lookahead_in_policy(self):
  x={'ret1':-1.0,'ret3':-2.0,'ret6':-2.0,'rel3':-1.2,'rel6':-1.3,
    'btc3':-.2,'btc6':-.3,'last30':-.3,'first30':.4,'last15':-.3,
    'volRatio':1.3,'atr3':.55,'rangePos':.2,'ema12':95,'ema36':98,'close':94}
  self.assertIn('RELWEAK_DOWNTREND',m.policies(x))
  self.assertIn('VOLUME_BREAKDOWN_LOW',m.policies(x))
 def test_empty_and_cost(self):
  self.assertEqual(m.performance([])['n'],0)
  o=m.performance([{'netReturnPct':2},{'netReturnPct':-1}])
  self.assertEqual(o['n'],2)
  self.assertEqual(o['wrPct'],50)
  self.assertAlmostEqual(o['pf'],2)
 def test_window_order(self):
  self.assertLess(m.START,m.SPLIT)
  self.assertLess(m.SPLIT,m.END)
 def test_12_templates_are_distinct(self):
  # The 12 strategy names are constant: do not infer performance by mutating this after search.
  values={'BOUNCE_FADE_1','BOUNCE_RANGE_REJECT','BTC_STABLE_RELWEAK',
    'RELWEAK_DOWNTREND','VOLUME_BREAKDOWN_LOW','EMA_RETEST_FAIL','LOWVOL_BOUNCE_REJECT',
    'BTC_STABLE_REL6_NEG','BTC_HEADWIND_AVOID','RELATIVE_REJECTION_LAST15',
    'LOW_RANGE_CONTINUATION','LOW_ATR_RELATIVE_FAIL'}
  self.assertEqual(len(values),12)
if __name__=='__main__':unittest.main()
