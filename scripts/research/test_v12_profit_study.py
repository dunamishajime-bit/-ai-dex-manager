"""Causality and candidate schema regression tests."""
import unittest,inspect,copy
import run_v12_profit_study as s
class Tests(unittest.TestCase):
 def setUp(self):
  src=inspect.getsource(s.w.simulate_v12).replace('def simulate_v12(','def sim(').replace("prev=series.get(t-H,b)","prev=series.get(t-H,b) if t-H>=c['entry_ts_ms'] else b")
  ns={'H':s.H};exec(src,ns);s.sim=ns['sim'];s.w.bars={}
  self.c={'symbol':'TEST','side':'LONG','entry_ts_ms':2*s.H,'entry_price':100.,'atr':1.,'maxHoldHours':4,'requested_gross':1.,'rank':1}
  self.bs={t*s.H:{'open':100.,'high':100.2,'low':99.8,'close':100.1} for t in range(-15,12)}
  s.w.bars={'TEST':self.bs,'BTCUSDT':copy.deepcopy(self.bs)}
 def test_features_ignore_entry_and_future(self):
  a=s.features(self.c);self.bs[2*s.H]['close']=5000;self.bs[3*s.H]['close']=1
  self.assertEqual(a,s.features(self.c))
 def test_confirm_actual_next_open(self):
  self.bs[2*s.H]['close']=100.3;self.bs[3*s.H]['open']=100.4
  x=s.transform(self.c,{'lag':1,'exit':{'arm':99}})
  self.assertEqual(x['entry_ts_ms'],3*s.H);self.assertEqual(x['entry_price'],100.4)
 def test_no_confirmation_no_trade(self):
  self.bs[2*s.H]['close']=99.9
  self.assertIsNone(s.transform(self.c,{'lag':1}))
 def test_odd_entry_excludes_preentry_extreme(self):
  self.bs[2*s.H]['high']=150
  c=dict(self.c,entry_ts_ms=3*s.H)
  x=s.sim(c,self.bs,{'arm':1,'trail':.5})
  self.assertEqual(x['reason'],'TIME_EXIT')
 def test_pullback_waits_recovery_then_next_open(self):
  self.bs[2*s.H]['close']=99.5;self.bs[3*s.H]['close']=99.8;self.bs[4*s.H]['open']=99.85
  x=s.transform(self.c,{'lag':4,'exit':{'arm':99}})
  self.assertEqual(x['entry_ts_ms'],4*s.H);self.assertEqual(x['entry_price'],99.85)
 def test_candidate_return_and_reason_schema(self):
  s.RAW={('TEST','LONG',2*s.H):self.c};s.ACTIVE={'exit':{'tp':.1,'arm':99}}
  c=s.w.base.candidate(dict(self.c,exit_ts_ms=6*s.H,exit_price=101,reason='OLD',unit_gross_return=.01),'V12')
  out=s.filt([c],'TEST_SCHEMA')[0]
  self.assertEqual(out['exit_reason'],'TAKE_PROFIT')
  self.assertAlmostEqual(out['unit_price_return'],.001)
  self.assertNotIn('unit_gross_return',out)
 def test_same_bar_stop_before_tp(self):
  self.bs[2*s.H].update(high=102,low=98)
  x=s.sim(self.c,self.bs,{'stop':.75,'tp':1})
  self.assertEqual(x['reason'],'STOP')
if __name__=='__main__':unittest.main()
