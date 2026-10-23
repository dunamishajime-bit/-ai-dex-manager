#!/usr/bin/env python3
"""Causal M5 risk-hedge stop unit tests (ordinary PENGU LONG/SHORT and Recovery V8)."""
from __future__ import annotations
import importlib.util,unittest
from pathlib import Path
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('pengu_timed_neg',HERE/'research-pengu-timed-negative-screen-20261023.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
M5=m.M5;HOUR=m.HOUR;T=1760200000000
class Feed:
 def __init__(self,bars):
  self.bars=bars
  self.times=[r[0] for r in bars]
 def getdata(self,sym):
  assert sym=='PENGUUSDT'
  return self.bars,self.times
def bars(n=150):
 return [[T+i*M5,100.,100.,100.,100.,1.] for i in range(n)]
def row(side='LONG',version='LONG_V2_FINAL',hold_h=10):
 return {'strategy_id':'PENGU','symbol':'PENGUUSDT','side':side,'entry_version':version,
 'entry_ts_ms':T,'exit_ts_ms':T+HOUR*hold_h,'entry_price':100.,'exit_price':101.}
def cfg(mode='AT_HOURS',hold=2,loss=2,mfe=None,scope='ALL'):
 return {'mode':mode,'holdHours':hold,'lossPct':loss,'maxMfePct':mfe,'scope':scope}
class TestEarlyNegative(unittest.TestCase):
 def test_long_at2h_negative_exits_next_open(self):
  b=bars()
  for j in range(8,30):
   b[j][1]=97.5;b[j][2]=97.8;b[j][3]=97.1;b[j][4]=97.5
  out=m.find_time_stop(row(),Feed(b),cfg())
  self.assertIsNotNone(out)
  self.assertEqual(out['ts'],T+2*HOUR)
  self.assertEqual(out['reason'],'PENGU_TIMED_NEGATIVE_AT_HOURS')
  self.assertAlmostEqual(out['fill'],97.5)
  self.assertAlmostEqual(out['closedPriceChangePct'],-2.5)
 def test_recovery_long_same_logic_existing_hard_not_edited(self):
  b=bars()
  for j in range(12,25):b[j][1]=97;b[j][2]=97.2;b[j][3]=96.9;b[j][4]=97
  result=m.find_time_stop(row('LONG','RECOVERY_V8'),Feed(b),cfg())
  self.assertEqual(result['initialHardStopPct'],6)
  self.assertAlmostEqual(result['thresholdPct'],-2)
 def test_short_loss_is_upward_price_move(self):
  b=bars()
  for j in range(12,30):b[j][1]=103;b[j][2]=103.6;b[j][3]=102.7;b[j][4]=103
  out=m.find_time_stop(row('SHORT','SHORT_V20'),Feed(b),cfg())
  self.assertEqual(out['side'],'SHORT')
  self.assertAlmostEqual(out['closedPriceChangePct'],-3)
  self.assertAlmostEqual(out['modeledExitReturnPct'],-3)
 def test_no_stop_on_recovered_trade(self):
  b=bars()
  for j in range(9,18):b[j][4]=97.5;b[j][3]=97.4
  b[23][4]=99.5;b[23][3]=99.3
  self.assertIsNone(m.find_time_stop(row(),Feed(b),cfg()))
 def test_mfe_gate_preserves_winner_even_if_now_under(self):
  b=bars()
  b[6][2]=102.
  for j in range(12,25):b[j][1]=97;b[j][3]=96.8;b[j][4]=97
  self.assertIsNone(m.find_time_stop(row(),Feed(b),cfg(mfe=1)))
  self.assertIsNotNone(m.find_time_stop(row(),Feed(b),cfg(mfe=None)))
 def test_persistent_two_closed_hourly_bars_both_negative(self):
  b=bars()
  b[11][4]=97;b[23][4]=97
  b[24][1]=96.7
  out=m.find_time_stop(row(),Feed(b),cfg(mode='SUSTAINED_H1',hold=2,loss=2))
  self.assertEqual(out['ts'],T+2*HOUR)
  self.assertAlmostEqual(out['fill'],96.7)
 def test_persistent_needs_two_separate_hourlies(self):
  b=bars()
  b[11][4]=100;b[23][4]=97
  self.assertIsNone(m.find_time_stop(row(),Feed(b),cfg(mode='SUSTAINED_H1',hold=2,loss=2)))
 def test_persistent_later_two_hourlies_after_recovery(self):
  b=bars()
  b[23][4]=97;b[35][4]=97
  out=m.find_time_stop(row(),Feed(b),cfg(mode='SUSTAINED_H1',hold=2,loss=2))
  self.assertEqual(out['ts'],T+3*HOUR)
 def test_previous_existing_exit_wins_at_same_time(self):
  b=bars()
  for j in range(12,25):b[j][4]=97.
  self.assertIsNone(m.find_time_stop(row(hold_h=2),Feed(b),cfg()))
 def test_missing_5m_bar_hard_fail(self):
  b=bars();del b[10]
  with self.assertRaisesRegex(RuntimeError,'PENGU_M5_DATA_GAP|PENGU_M5_NEXT_OPEN_GAP'):
   m.find_time_stop(row(),Feed(b),cfg())
 def test_price_anchor_large_gap_hard_fail(self):
  b=bars();b[0][1]=108.
  with self.assertRaisesRegex(RuntimeError,'PENGU_M5_ENTRY_PRICE_MISMATCH_GT5P0_PCT'):
   m.find_time_stop(row(),Feed(b),cfg())
 def test_scope_base_long_only(self):
  rule=cfg(scope='BASE_LONG')
  self.assertTrue(m.eligible(row(version='LONG_V2_FINAL'),rule))
  self.assertFalse(m.eligible(row(version='RECOVERY_V8'),rule))
  self.assertFalse(m.eligible(row(side='SHORT',version='SHORT_V20'),rule))
 def test_scope_short_only(self):
  rule=cfg(scope='SHORT')
  self.assertFalse(m.eligible(row(),rule))
  self.assertTrue(m.eligible(row(side='SHORT',version='SHORT_V20'),rule))
 def test_dual_short_checkpoints_first_at_three_hours(self):
  b=bars()
  for j in range(12,120):
   b[j][1]=104.5;b[j][2]=104.8;b[j][3]=104.;b[j][4]=104.5
  conf={"mode":"MULTI_CHECKPOINT","scope":"SHORT","checks":[
   cfg("AT_HOURS",3,2.5,scope="SHORT"),cfg("AT_HOURS",8,4,scope="SHORT")]}
  result=m.find_time_stop(row("SHORT","SHORT_V20"),Feed(b),conf)
  self.assertEqual(result["ts"],T+3*HOUR)
 def test_dual_short_checkpoints_falls_through_to_eight_hours(self):
  b=bars()
  for j in range(72,126):
   b[j][1]=104.5;b[j][2]=104.8;b[j][3]=104.;b[j][4]=104.5
  conf={"mode":"MULTI_CHECKPOINT","scope":"SHORT","checks":[
   cfg("AT_HOURS",3,2.5,scope="SHORT"),cfg("AT_HOURS",8,4,scope="SHORT")]}
  result=m.find_time_stop(row("SHORT","SHORT_V20"),Feed(b),conf)
  self.assertEqual(result["ts"],T+8*HOUR)
if __name__=='__main__': unittest.main()
