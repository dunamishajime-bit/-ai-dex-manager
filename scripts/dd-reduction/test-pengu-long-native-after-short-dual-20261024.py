#!/usr/bin/env python3
"""Unit tests for PENGU SHORT adopted baseline + scoped LONG research policies."""
import unittest,importlib.util
from pathlib import Path
HERE=Path(__file__).resolve().parent
def load(name,path):
 sp=importlib.util.spec_from_file_location(name,path)
 m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m);return m
m=load('nativep',HERE/'research-pengu-long-native-full8-after-short-dual-20261024.py')
class TestGuards(unittest.TestCase):
 def row(self,side='LONG',version='LONG_V2_FINAL'):
  return dict(strategy_id='PENGU',symbol='PENGUUSDT',side=side,entry_version=version)
 def test_short_scope_v20(self):
  self.assertTrue(m.eligible(self.row('SHORT','SHORT_V20'),m.CASES['LONG_PEAK2_FLOOR_MINUS5']))
  self.assertFalse(m.eligible(self.row('SHORT','LEGACY_V2'),m.CASES['LONG_PEAK2_FLOOR_MINUS5']))
 def test_normal_only(self):
  self.assertTrue(m.eligible(self.row(),m.CASES['LONG_PEAK2_FLOOR_MINUS5']))
  self.assertFalse(m.eligible(self.row(version='RECOVERY_V8'),m.CASES['LONG_PEAK2_FLOOR_MINUS5']))
 def test_recovery_isolated(self):
  self.assertTrue(m.eligible(self.row(version='RECOVERY_V8'),m.CASES['RECOVERY_PEAK2_FLOOR_MINUS5']))
  self.assertFalse(m.eligible(self.row(),m.CASES['RECOVERY_PEAK2_FLOOR_MINUS5']))
 def test_baseline_has_no_long_stop(self):
  self.assertFalse(m.eligible(self.row(),m.CASES['SHORT_DUAL_BASE']))
 def test_both_short_checkpoints_present(self):
  self.assertEqual([(z['holdHours'],z['lossPct']) for z in m.DUAL['checks']],[(3,2.5),(8,4.0)])
 def test_missing_symbol_guard(self):
  self.assertFalse(m.eligible(dict(self.row(),symbol='BTCUSDT'),m.CASES['LONG_PEAK2_FLOOR_MINUS5']))
 def test_cannot_apply_long_to_short(self):
  self.assertTrue(m.eligible(self.row('SHORT','SHORT_V20'),m.CASES['RECOVERY_PEAK2_FLOOR_MINUS5']))
if __name__=='__main__':unittest.main()
