"""Unit tests for causal peak-profit trailing STOP. Only pure local research logic."""
import unittest
from idle_profit_trailing_helper_20261016 import trailing_exit,H
def bar(o,h,l,c):return {"open":o,"high":h,"low":l,"close":c}
def leg(side="SHORT",strategy="IDLE",symbol="DOTUSDT",end=5):
 return {"strategy_id":strategy,"side":side,"symbol":symbol,"entry_price":100.,
         "entry_ts_ms":0,"exit_ts_ms":end*H,"exit_price":105.,"quantity":1,"route":"IDLE_DOT_MOMENTUM_SHORT_BTCREL"}
class PeakTrailingTests(unittest.TestCase):
 def setup_bars(self):
  return {"DOTUSDT":{
   0:bar(100,104,95,97),H:bar(97,97,95,95),
   2*H:bar(95,96,93,94),3*H:bar(94,97,93,97),4*H:bar(97,103,96,101)}}
 def test_arms_on_completed_close_three_pct(self):
  b=self.setup_bars();x=leg();o={}
  y=trailing_exit(x,b,arm=.03,gap=.01,obs=o)
  self.assertEqual(o["armed"],1)
  self.assertEqual(y["exit_ts_ms"],3*H)
  self.assertAlmostEqual(y["exit_price"],96)
 def test_monotonically_tightens_peak(self):
  b=self.setup_bars();x=leg()
  # With peak +6%, one point giveback level = +5%; in bar H, closing at 95 triggers +5%.
  y=trailing_exit(x,b,arm=.03,gap=.01)
  self.assertAlmostEqual(y["exit_price"],96)
 def test_wick_peak_not_same_as_closed_peak(self):
  b=self.setup_bars();b["DOTUSDT"][0]=bar(100,104,96,99)
  a=trailing_exit(leg(),b,arm=.03,gap=.01,peak_mode="close")
  c=trailing_exit(leg(),b,arm=.03,gap=.01,peak_mode="wick")
  self.assertNotEqual(a["exit_ts_ms"],c["exit_ts_ms"])
 def test_extra_slippage_worse_for_short(self):
  b=self.setup_bars();a=trailing_exit(leg(),b,arm=.03,gap=.01)
  c=trailing_exit(leg(),b,arm=.03,gap=.01,slip_bps=50)
  self.assertAlmostEqual(c["exit_price"],a["exit_price"]*1.005)
 def test_stop_will_not_fire_in_arm_candle(self):
  b={"DOTUSDT":{0:bar(100,110,95,97),H:bar(97,98.2,96,97),
                   2*H:bar(97,103,94,100),3*H:bar(100,101,99,100)}}
  x=leg(end=4)
  y=trailing_exit(x,b,arm=.03,gap=.01)
  self.assertEqual(y["exit_ts_ms"],2*H)
 def test_gap_up_fill_adverse_to_stop(self):
  b=self.setup_bars();b["DOTUSDT"][2*H]=bar(95,95,93,94)
  b["DOTUSDT"][3*H]=bar(103,105,101,103)
  y=trailing_exit(leg(),b,arm=.03,gap=.01)
  self.assertAlmostEqual(y["exit_price"],103)
 def test_pengu_unaffected_and_symbol_filter(self):
  b=self.setup_bars()
  for c in (leg(strategy="PENGU"),leg(strategy="Q102"),leg(side="LONG"),
            leg(symbol="DOTUSDT")):
   syms={"JUPUSDT"} if c["strategy_id"]=="IDLE" and c["side"]=="SHORT" else None
   self.assertIs(trailing_exit(c,b,arm=.03,gap=.01,symbols=syms),c)
 def test_missing_data_fail_closed(self):
  b=self.setup_bars();del b["DOTUSDT"][2*H]
  x=leg();o={}
  self.assertIs(trailing_exit(x,b,arm=.03,gap=.01,obs=o),x)
  self.assertEqual(o["missing"],1)
 def test_final_original_exit_takes_precedence(self):
  b={"DOTUSDT":{0:bar(100,100,96,97),H:bar(97,103,97,102)}}
  x=leg(end=2)
  self.assertIs(trailing_exit(x,b,arm=.03,gap=.01),x)
if __name__=="__main__":unittest.main(verbosity=2)
