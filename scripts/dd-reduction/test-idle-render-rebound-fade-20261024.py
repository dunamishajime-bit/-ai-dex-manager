#!/usr/bin/env python3
"""RENDER M5 rebound->fade ex-ante rule causality and gap fail-closed."""
import importlib.util,unittest
from pathlib import Path
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('bouncecheck',HERE/'research-idle-render-rebound-fade-20261024.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
M=m.M5
def bar(i,cl):
 ts=i*M
 return (ts,cl,cl+0.5,cl-0.5,cl,100)
class Feed:
 def __init__(self,bars):self.bars=bars
 def getdata(self,_):return self.bars,[x[0] for x in self.bars]
class TestCausality(unittest.TestCase):
 def setUp(self):m.CACHE.clear()
 def test_no_lookahead_future_m5(self):
  base=[bar(i,100+i*.03) for i in range(160)]
  ts=100*M
  a=m.get(Feed(base),'RENDERUSDT',ts)
  self.assertIsNotNone(a)
  altered=list(base)
  altered[100]=(100*M,900,1000,1,900,100)
  altered[110]=(110*M,900,1000,1,900,100)
  b=m.get(Feed(altered),'RENDERUSDT',ts)
  self.assertEqual(a,b)
 def test_requires_m5_continuity(self):
  bars=[bar(i,100+i*.02) for i in range(140)]
  bars[70]=bar(71,102)
  bars[71]=bar(72,102)
  self.assertIsNone(m.get(Feed(bars),'RENDERUSDT',100*M))
 def test_short_history_failclosed(self):
  self.assertIsNone(m.get(Feed([bar(i,100) for i in range(22)]),'RENDERUSDT',22*M))
 def test_data_good(self):
  x=m.get(Feed([bar(i,100+i*.1) for i in range(130)]),'RENDERUSDT',120*M)
  self.assertIsNotNone(x)
  self.assertIn('last15',x)
  self.assertEqual(set(x),set(m.get(Feed([bar(i,100+i*.1) for i in range(130)]),'RENDERUSDT',120*M)))
 def test_high_retention_veto_not_constant(self):
  sample={'ret3h':-1.5,'ret1h':-.8,'last15':-.1,'last30':-.2,'first45':-.2,
   'rebound2to1':.2,'fadefrom1hhigh':.5,'fadefrom3hhigh':2,
   'fadefrom15high':.2,'last1hRangePct':1,'rangepos3h':.2,'lowprior':100,'highrecent':101}
  self.assertTrue(m.rule_accept(sample,'VETO_WEAK_REBOUND_LATE_DUMP'))
  bad=dict(sample,last15=-.6)
  self.assertFalse(m.rule_accept(bad,'VETO_WEAK_REBOUND_LATE_DUMP'))
 def test_no_chase_same_close(self):
  f={'ret3h':-2.0,'last1hRangePct':1.0,'rebound2to1':.5,'last15':-.2,'ret1h':-2}
  self.assertFalse(m.rule_accept(f,'VETO_3H_CHASE_AND_NO_REBOUND'))
  self.assertTrue(m.rule_accept(dict(f,rebound2to1=1.2),'VETO_3H_CHASE_AND_NO_REBOUND'))
 def test_rules_all_unique(self):
  self.assertEqual(len(m.NAMES),len(set(m.NAMES)))
if __name__=='__main__':unittest.main()
