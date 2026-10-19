#!/usr/bin/env python3
"""Deterministic M5 STOP research semantics. No external price data, no LIVE orders."""
import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'research'))
import long_short_sequential_full8_bt_20261019 as seq
M=300000
def candle(i,op,hi,lo,cl):return (i*M,op,hi,lo,cl,100.0)
class Mock:
 def __init__(self,rs):self.rs=rs
 def getdata(self,symbol):return self.rs,[x[0] for x in self.rs]
def trade(side='LONG',end=12*M):
 return {'symbol':'FAKEUSDT','side':side,'entry_ts_ms':0,'exit_ts_ms':end,
 'entry_price':100.0,'exit_price':96 if side=='LONG' else 104,
 'unit_price_return':-.04,'accepted_gross':1.0,'strategy_id':'V12'}
def execute(rows,pl):
 backup=seq.R
 seq.R=Mock(rows)
 seq.EXT_OBS={pl['id']:{'preempted':0,'by_outcome':{'original_win':0,'original_loss':0}}}
 try:return seq.projected_exit(trade(pl['side']),pl)
 finally:seq.R=backup
def profit(side='LONG', slip=0, locked=.005):
 return {'id':'P','target':'V12','side':side,'axis':'profit_reversal',
  'arm_close_pct':.02,'locked_profit_pct':locked,'stop_slip_bps':slip}
def cap(side='LONG', slip=0):
 return {'id':'I','target':'V12','side':side,'axis':'initial_adverse',
  'max_initial_wallet_loss_pct':.015,'stop_slip_bps':slip}
class EngineUnitTests(unittest.TestCase):
 def test_long_activation_only_after_completed_m5_close(self):
  rows=[candle(0,100,104,99.9,102.5),candle(1,102.5,104,100,101)]
  x=execute(rows,profit())
  self.assertEqual(x['exit_ts_ms'],2*M)
  self.assertAlmostEqual(x['exit_price'],100.5)
 def test_high_without_close_does_not_arm(self):
  rows=[candle(0,100,104,99.9,100.2),candle(1,100.2,101,99.0,99.8)]
  self.assertEqual(execute(rows,profit())['exit_ts_ms'],12*M)
 def test_long_initial_adverse(self):
  rows=[candle(0,100,101,97,98),candle(1,98,99,97,98)]
  x=execute(rows,cap())
  self.assertEqual(x['exit_ts_ms'],M)
  self.assertAlmostEqual(x['exit_price'],98.5)
 def test_short_initial_adverse(self):
  rows=[candle(0,100,104,99.0,103),candle(1,103,104,100,102)]
  x=execute(rows,cap('SHORT'))
  self.assertEqual(x['exit_ts_ms'],M)
  self.assertAlmostEqual(x['exit_price'],101.5)
 def test_gap_long_pessimistic_execution(self):
  rows=[candle(0,100,104,100,102.5),candle(1,99.4,100.1,98,99)]
  x=execute(rows,profit())
  self.assertAlmostEqual(x['exit_price'],99.4)
 def test_stop_slippage_applies_adversely_both_sides(self):
  a=execute([candle(0,100,101,97,98)],cap('LONG',200))
  b=execute([candle(0,100,104,99,103)],cap('SHORT',200))
  self.assertAlmostEqual(a['exit_price'],98.5*.98)
  self.assertAlmostEqual(b['exit_price'],101.5*1.02)
 def test_same_original_exit_race_not_preempted(self):
  p=profit()
  backup=seq.R
  seq.R=Mock([candle(0,100,105,100,103),candle(1,103,104,99,100)])
  seq.EXT_OBS={'P':{'preempted':0,'by_outcome':{'original_win':0,'original_loss':0}}}
  try:
   x=seq.projected_exit(trade(end=2*M),p)
   self.assertEqual(x['exit_ts_ms'],2*M)
   self.assertNotIn('exit_reason',x)
  finally:seq.R=backup
 def test_missing_bar_refuses_imputation(self):
  rows=[candle(0,100,105,100,103),candle(2,103,104,99,100)]
  self.assertEqual(execute(rows,profit())['exit_ts_ms'],12*M)
if __name__=='__main__':unittest.main(verbosity=2)
