#!/usr/bin/env python3
"""Tests for Idle entry gating causality, no lookahead, and cross-symbol isolation."""
from __future__ import annotations
import importlib.util,copy,unittest
from pathlib import Path
HERE=Path(__file__).resolve().parent
def load(n,p):
 spec=importlib.util.spec_from_file_location(n,p)
 x=importlib.util.module_from_spec(spec);spec.loader.exec_module(x);return x
m=load('test_idle_3_entry_screen',HERE/'screen-idle-entry-families-after-pengu-20261024.py')
native=load('test_idle_3_entry_runner',HERE/'run-idle-three-entry-native-full8-20261024.py')
class FakeData:
 def __init__(self):
  self.cache={}
  for sym in ('BTCUSDT','RENDERUSDT','DOTUSDT','JUPUSDT'):
   k=0.004 if sym=='BTCUSDT' else .002
   self.cache[sym]=([(i*300000,100+k*i,100.2+k*i,99.8+k*i,100+k*i,1000+i)
      for i in range(345)], list(range(0,345*300000,300000)))
 def getdata(self,symbol):
  return self.cache[symbol]
class TestNoLeak(unittest.TestCase):
 def test_all_rules_registered(self):
  for case,bySymbol in native.CASE_RULES.items():
   for sym,rules in bySymbol.items():
    self.assertIn(sym,('RENDERUSDT','DOTUSDT','JUPUSDT'))
    for rule in rules:self.assertIn(rule,m.RULES)
 def test_btc3_negative_limit(self):
  rule=m.RULES['btc3h_ge_-1.5']
  self.assertTrue(m.accept({'btc3h':-1.50},rule))
  self.assertFalse(m.accept({'btc3h':-1.51},rule))
  self.assertFalse(m.accept({},rule))
 def test_render_opposite_regime_veto(self):
  rule=m.RULES['not_btc6_positive_and_symbol_rel6_positive']
  self.assertFalse(m.accept({'btc6h':.1,'rel6h':.1},rule))
  self.assertTrue(m.accept({'btc6h':-.1,'rel6h':.1},rule))
  self.assertTrue(m.accept({'btc6h':.1,'rel6h':-.1},rule))
 def test_jup_12h_min_loss(self):
  rule=m.RULES['RET12H_GE_MINUS5']
  self.assertFalse(m.accept({'ret12h':-5.01},rule))
  self.assertTrue(m.accept({'ret12h':-5.0},rule))
 def test_dot_1h_min_loss(self):
  rule=m.RULES['ret1h_ge_-1']
  self.assertFalse(m.accept({'ret1h':-1.02},rule))
  self.assertTrue(m.accept({'ret1h':-1.00},rule))
 def test_earliest_available_feature_is_closed(self):
  feed=FakeData()
  screenmod=m.feat
  screenmod.CACHE.clear()
  ts=302*300000
  one=screenmod.get_feat(feed,'RENDERUSDT',ts)
  self.assertIsNotNone(one)
  before=copy.deepcopy(one)
  # Bar at entry or after entry cannot affect the entrance gate.
  bars,times=feed.getdata('RENDERUSDT')
  edited=list(bars); edited[302]=(edited[302][0],200.,210.,190.,205.,999999)
  feed.cache['RENDERUSDT']=(edited,times)
  screenmod.CACHE.clear()
  two=screenmod.get_feat(feed,'RENDERUSDT',ts)
  self.assertEqual(before,two)
 def test_missing_price_history_fails_closed(self):
  f=FakeData();f.cache['JUPUSDT']=(f.cache['JUPUSDT'][0][:100],f.cache['JUPUSDT'][1][:100])
  m.feat.CACHE.clear()
  self.assertIsNone(m.feat.get_feat(f,'JUPUSDT',110*300000))
if __name__=='__main__':unittest.main()
