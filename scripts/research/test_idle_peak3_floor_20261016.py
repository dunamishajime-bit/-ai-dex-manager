"""Offline temporal and stop-direction checks for Idle +3% arm / -1% return floor."""
import unittest
from idle_peak3_floor_helper_20261016 import model_idle_peak_floor,H
def bar(op,high,low,close):
 return {"open":op,"high":high,"low":low,"close":close}
def fixture(strat="IDLE", side="SHORT", end=4):
 return {"strategy_id":strat,"symbol":"DOTUSDT","side":side,"entry_price":100,"exit_price":98,"entry_ts_ms":0,"exit_ts_ms":end*H,"quantity":2.0}
class PeakFloor(unittest.TestCase):
 def book(self):
  return {"DOTUSDT":{0:bar(100,101,95,96.8),H:bar(96.8,101.5,96,99.1),2*H:bar(99.1,101.6,98,99.4),3*H:bar(99.4,102,98,101)}}
 def test_arm_after_close_and_hit_next_bar_only(self):
  x=fixture();o={}
  y=model_idle_peak_floor(x,self.book(),floor=-.01,observation=o)
  self.assertEqual(y["exit_ts_ms"],2*H)
  self.assertEqual(y["exit_price"],101)
  self.assertEqual(o["armed"],1)
  self.assertEqual(o["stopped"],1)
 def test_adverse_gap_buy_to_close(self):
  b=self.book();b["DOTUSDT"][H]=bar(103,104,98,100)
  r=model_idle_peak_floor(fixture(),b,floor=-.01)
  self.assertEqual(r["exit_price"],103)
 def test_floor_is_entry_loss_not_profit_peak_drawdown(self):
  b=self.book()
  a=model_idle_peak_floor(fixture(),b,floor=-.01)
  z=model_idle_peak_floor(fixture(),b,floor=.005)
  self.assertAlmostEqual(a["exit_price"],101)
  self.assertAlmostEqual(z["exit_price"],99.5)
 def test_wick_only_does_not_arm_close_mode(self):
  b=self.book()
  b["DOTUSDT"][0]=bar(100,101,95,99)
  a=model_idle_peak_floor(fixture(),b,floor=-.01,activation="close")
  self.assertEqual(a["exit_ts_ms"],4*H)
  z=model_idle_peak_floor(fixture(),b,floor=-.01,activation="wick")
  self.assertEqual(z["exit_ts_ms"],2*H)
 def test_not_active_in_signal_candle(self):
  b=self.book();b["DOTUSDT"][0]=bar(100,105,95,96)
  b["DOTUSDT"][H]=bar(96,98,94,95)
  b["DOTUSDT"][2*H]=bar(95,100,94,97)
  r=model_idle_peak_floor(fixture(),b,floor=-.01)
  self.assertEqual(r["exit_ts_ms"],4*H)
 def test_unrelated_strategy_untouched(self):
  b=self.book()
  for x in [fixture(strat="PENGU"),fixture(strat="Q102"),fixture(strat="V12"),fixture(strat="FET"),fixture(side="LONG")]:
   self.assertIs(model_idle_peak_floor(x,b),x)
 def test_missing_candle_preserves_original_and_reports(self):
  b=self.book();del b["DOTUSDT"][H]
  o={};x=fixture()
  self.assertIs(model_idle_peak_floor(x,b,observation=o),x)
  self.assertEqual(o["gaps"],1)
 def test_stop_not_override_original_final_exit(self):
  x=fixture(end=H//H)
  self.assertIs(model_idle_peak_floor(x,self.book()),x)
 def test_slippage_extra_50bps_for_short_is_adverse(self):
  base=model_idle_peak_floor(fixture(),self.book(),floor=-.01)
  worse=model_idle_peak_floor(fixture(),self.book(),floor=-.01,extra_stop_slip_bps=50)
  self.assertAlmostEqual(worse["exit_price"],base["exit_price"]*1.005)
if __name__=="__main__":unittest.main(verbosity=2)
