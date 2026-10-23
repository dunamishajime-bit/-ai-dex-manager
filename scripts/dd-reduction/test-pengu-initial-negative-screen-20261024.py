#!/usr/bin/env python3
"""Boundary tests for causal M5 PENGU initial loss research."""
import unittest,importlib.util
from pathlib import Path
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('pinitial',HERE/'research-pengu-initial-negative-screen-20261024.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
H=m.H;M=m.M5;T=1700000000000
def bar(n,pct,mfe=0.0):
 return {'ts':T+n*M,'closeRet':pct,'mfeAfter':mfe,'price':100*(1+pct/100),'mfeBefore':mfe,'fillRet':pct}
class TestRules(unittest.TestCase):
 def test_at8_once_and_not_hour7(self):
  cfg=m.POLICIES['AT8_NEG5_MFE1']
  self.assertIsNone(m.find_stop([bar(7*12,-6)],cfg,T))
  self.assertEqual(m.find_stop([bar(8*12,-5)],cfg,T)['ts'],T+8*H)
 def test_at8_floor_exact(self):
  cfg=m.POLICIES['AT8_NEG5_MFE1']
  self.assertIsNone(m.find_stop([bar(8*12,-4.99)],cfg,T))
  self.assertEqual(m.find_stop([bar(8*12,-5)],cfg,T)['closeRet'],-5)
 def test_profit_mfe_gate_prevents_initial_loss(self):
  cfg=m.POLICIES['AT8_NEG5_MFE1']
  self.assertIsNone(m.find_stop([bar(8*12,-6,1.01)],cfg,T))
 def test_watch_touches_and_delays(self):
  cfg=m.POLICIES['ARM3.5_WATCH2_MFE1']
  self.assertIsNone(m.find_stop([bar(1,-3.5),bar(24,-4.0)],cfg,T))
  self.assertEqual(m.find_stop([bar(1,-3.5),bar(25,-4.0)],cfg,T)['ts'],T+25*M)
 def test_watch_recovery_disarms(self):
  cfg=m.POLICIES['ARM3.5_WATCH2_MFE1']
  self.assertIsNone(m.find_stop([bar(1,-3.5),bar(25,-1)],cfg,T))
 def test_rolling_sustain_requires_twentyfour_bars(self):
  cfg=m.POLICIES['NEG3_SUSTAIN120_MFE1']
  v=[bar(i,-3.5) for i in range(1,24)]
  self.assertIsNone(m.find_stop(v,cfg,T))
  self.assertEqual(m.find_stop(v+[bar(24,-3.5)],cfg,T)['ts'],T+24*M)
 def test_sustain_break_resets(self):
  cfg=m.POLICIES['NEG3_SUSTAIN120_MFE1']
  a=[bar(i,-3.5) for i in range(1,13)]+[bar(13,-2.9)]+[bar(i,-3.5) for i in range(14,25)]
  self.assertIsNone(m.find_stop(a,cfg,T))
 def test_at12_not_eligible_after_prior_mfe(self):
  cfg=m.POLICIES['AT12_NEG4_MFE1']
  self.assertIsNone(m.find_stop([bar(3,0,1.01),bar(144,-5,1.01)],cfg,T))
 def test_h1_two_closes_negative(self):
  cfg=m.POLICIES['H1X2_NEG4_MIN6_MFE1']
  path=[bar(i,-4.5) for i in range(1,97)]
  self.assertEqual(m.find_stop(path,cfg,T)['ts'],T+6*H)
 def test_first_touch_requires_min_wait(self):
  cfg=m.POLICIES['TOUCH5_AFTER2_MFE1']
  self.assertIsNone(m.find_stop([bar(1,-6),bar(12,-6)],cfg,T))
  self.assertIsNotNone(m.find_stop([bar(1,-6),bar(24,-6)],cfg,T))
if __name__=='__main__':unittest.main()
