#!/usr/bin/env python3
"""Causal semantics for AVAX RESIDUAL six-hour + armed trailing compound."""
from __future__ import annotations
import importlib.util, unittest
from pathlib import Path
HERE=Path(__file__).resolve().parent
sp=importlib.util.spec_from_file_location("screen_avax_combo_under_test", HERE/"research-residual-avax-exit-after-no-doge-20261023.py")
mod=importlib.util.module_from_spec(sp);sp.loader.exec_module(mod)
T0=1760000000000
M5=300000
class FakeSource:
 def __init__(self,bars):self.bars=bars;self.times=[int(x[0]) for x in bars]
 def getdata(self,sym):
  assert sym=="AVAXUSDT"
  return self.bars,self.times
def make_bars():
 return [[T0+j*M5,100.,100.,100.,100.,1.] for j in range(160)]
def row(t=T0):
 return {"strategy_id":"RESIDUAL","symbol":"AVAXUSDT","side":"LONG",
         "entry_price":100.,"entry_ts_ms":t,"exit_ts_ms":t+12*3600000,
         "exit_price":100.}
class TestCompositeSemantics(unittest.TestCase):
 def test_rule_must_be_time6_plus_3pct_1p5_trailing(self):
  r=mod.RULES["COMBO_TIME6_TRAIL3_GIVE1P5"]
  self.assertEqual(r["kind"],"combo")
  self.assertEqual(set(r["parts"]),{"TIME_6H","TRAIL_ARM3_GIVE1P5"})
  self.assertEqual(mod.RULES["TIME_6H"]["after"],6)
  t=mod.RULES["TRAIL_ARM3_GIVE1P5"]
  self.assertEqual((t["arm"],t["give"]),(3,1.5))
 def test_no_profit_arm_means_six_hours(self):
  source=FakeSource(make_bars())
  combo=mod._find_exit(row(),"COMBO_TIME6_TRAIL3_GIVE1P5",source)
  time6=mod._find_exit(row(),"TIME_6H",source)
  trail=mod._find_exit(row(),"TRAIL_ARM3_GIVE1P5",source)
  self.assertIsNone(trail)
  self.assertEqual(combo["ts"],T0+6*3600000)
  self.assertEqual(combo["ts"],time6["ts"])
  self.assertEqual(combo["trigger"],"TIME_6H")
 def test_trailing_armed_prior_closed_bar_wins_when_before_six_hours(self):
  bars=make_bars()
  bars[11][2]=104.2
  bars[11][4]=104.
  bars[12][3]=102.3
  bars[12][4]=102.5
  source=FakeSource(bars)
  combo=mod._find_exit(row(),"COMBO_TIME6_TRAIL3_GIVE1P5",source)
  trail=mod._find_exit(row(),"TRAIL_ARM3_GIVE1P5",source)
  six=mod._find_exit(row(),"TIME_6H",source)
  self.assertEqual(combo["trigger"],"TRAIL_ARM3_GIVE1P5")
  self.assertEqual(combo["ts"],trail["ts"])
  self.assertLess(combo["ts"],six["ts"])
  self.assertEqual(combo["ts"],T0+13*M5)
 def test_same_bar_high_without_close_does_not_arm(self):
  bars=make_bars()
  bars[11][2]=104.2
  bars[11][3]=99.
  bars[11][4]=100.
  bars[12][3]=98.
  bars[12][4]=100.
  combo=mod._find_exit(row(),"COMBO_TIME6_TRAIL3_GIVE1P5",FakeSource(bars))
  self.assertEqual(combo["trigger"],"TIME_6H")
 def test_long_avax_only(self):
  r=row();r["symbol"]="DOGEUSDT"
  with self.assertRaises(AssertionError):
   mod._find_exit(r,"COMBO_TIME6_TRAIL3_GIVE1P5",FakeSource(make_bars()))
if __name__=="__main__":unittest.main()
