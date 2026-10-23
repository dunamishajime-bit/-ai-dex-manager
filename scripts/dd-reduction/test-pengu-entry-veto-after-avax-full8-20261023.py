#!/usr/bin/env python3
"""Causal PENGU side-specific veto boundary and source isolation tests."""
from __future__ import annotations
import importlib.util, unittest
from pathlib import Path
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('pengu_side_veto_study',HERE/'research-pengu-entry-veto-after-avax-full8-20261023.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class TestPenguEntrySideVeto(unittest.TestCase):
 def test_base_keeps_everything(self):
  self.assertIsNone(m.pengu_veto('NO_GATE','SHORT',{'ret3h':-50,'ret6h':-50},{'ret3h':4,'ret6h':0}))
 def test_long_rally_exact_boundary(self):
  self.assertEqual(m.pengu_veto('LONG_BTC3_GE3','LONG',{'ret3h':0,'ret6h':0},{'ret3h':3,'ret6h':0}),'long_btc_pump_3h')
  self.assertIsNone(m.pengu_veto('LONG_BTC3_GE3','LONG',{'ret3h':0,'ret6h':0},{'ret3h':2.999,'ret6h':0}))
 def test_long_rule_does_not_filter_short(self):
  self.assertIsNone(m.pengu_veto('LONG_BTC3_GE3','SHORT',{'ret3h':0,'ret6h':0},{'ret3h':4,'ret6h':0}))
 def test_short_relative_three_hour_exact(self):
  self.assertEqual(m.pengu_veto('SHORT_REL3_LE1','SHORT',{'ret3h':-1.2,'ret6h':0},{'ret3h':-.2,'ret6h':0}),'short_relative_weak3h')
  self.assertIsNone(m.pengu_veto('SHORT_REL3_LE1','SHORT',{'ret3h':-.99,'ret6h':0},{'ret3h':0,'ret6h':0}))
 def test_short_relative_six_hour_exact(self):
  self.assertEqual(m.pengu_veto('SHORT_REL6_LE1P5','SHORT',{'ret3h':0,'ret6h':-2},{'ret3h':0,'ret6h':-.5}),'short_relative_weak6h')
  self.assertIsNone(m.pengu_veto('SHORT_REL6_LE1P5','SHORT',{'ret3h':0,'ret6h':-1.49},{'ret3h':0,'ret6h':0}))
 def test_short_rule_does_not_filter_long(self):
  self.assertIsNone(m.pengu_veto('SHORT_REL3_LE1','LONG',{'ret3h':-3,'ret6h':-4},{'ret3h':0,'ret6h':0}))
 def test_combination_scope(self):
  self.assertEqual(m.pengu_veto('DUAL_LONG_BTC3_SHORT_REL3','LONG',{'ret3h':2,'ret6h':0},{'ret3h':4,'ret6h':0}),'long_btc_pump_3h')
  self.assertEqual(m.pengu_veto('DUAL_LONG_BTC3_SHORT_REL3','SHORT',{'ret3h':-2,'ret6h':-1},{'ret3h':0,'ret6h':0}),'short_relative_weak3h')
 def test_causal_completed_m5_and_fixed_avax_protection_code_wired(self):
  s=(HERE/'research-pengu-entry-veto-after-avax-full8-20261023.py').read_text('utf8')
  self.assertIn('reference.get_feature(source,"PENGUUSDT",ts,fcache)',s)
  self.assertIn('reference.get_feature(source,"BTCUSDT",ts,fcache)',s)
  self.assertIn('reference.reason("DUAL",avax,btc)',s)
  self.assertIn('settings={"watch":True,"hard":True}',s)
  self.assertIn('row.get("symbol")=="DOGEUSDT"',s)
  self.assertIn('native.replay(source_name,cost,source,helper,previous,STOCK)',s)
if __name__=="__main__":unittest.main()
