#!/usr/bin/env python3
"""Causal M5 initial-adverse-stop semantics for RESIDUAL AVAX research."""
from __future__ import annotations
import importlib.util,unittest
from pathlib import Path
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("avax_initial_loss_screen",HERE/"research-residual-avax-exit-after-no-doge-20261023.py")
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
M5=300000;H=3600000;T0=1760000000000
class Fake:
 def __init__(self,bars):
  self.bars=bars
  self.times=[r[0] for r in bars]
 def getdata(self,sym):
  assert sym=="AVAXUSDT"
  return self.bars,self.times
def bars():
 return [[T0+i*M5,100.,100.,100.,100.,1.] for i in range(160)]
def row():
 return {"strategy_id":"RESIDUAL","symbol":"AVAXUSDT","side":"LONG",
 "entry_ts_ms":T0,"exit_ts_ms":T0+12*H,"entry_price":100.,"exit_price":100.}
class TestInitialLoss(unittest.TestCase):
 def test_one_hour_minus_two_armed_only_after_completed_hour(self):
  b=bars()
  for j in range(9,14):
   b[j][1]=97.7;b[j][2]=98;b[j][3]=97.4;b[j][4]=97.7
  found=m._find_exit(row(),"EARLY_1H_LOSS2_MFE_LT1",Fake(b))
  self.assertEqual(found["ts"],T0+12*M5)
  self.assertEqual(found["trigger"],"EARLY_1H_LOSS2_MFE_LT1")
  self.assertEqual(found["fill"],97.7)
 def test_two_hour_stop_does_not_fire_at_first_hour(self):
  b=bars()
  for j in range(9,27):
   b[j][1]=97.7;b[j][2]=98.;b[j][3]=97.4;b[j][4]=97.7
  a=m._find_exit(row(),"EARLY_1H_LOSS2_MFE_LT1",Fake(b))
  c=m._find_exit(row(),"EARLY_2H_LOSS2_MFE_LT1",Fake(b))
  self.assertEqual(a["ts"],T0+12*M5)
  self.assertEqual(c["ts"],T0+24*M5)
 def test_prior_one_percent_mfe_prevents_first_negative_cut(self):
  b=bars()
  b[2][2]=101.4
  for j in range(9,27):
   b[j][1]=97.7;b[j][2]=98.;b[j][3]=97.4;b[j][4]=97.7
  self.assertIsNone(m._find_exit(row(),"EARLY_1H_LOSS2_MFE_LT1",Fake(b)))
 def test_recovery_before_first_hour_avoids_stop(self):
  b=bars()
  for j in range(3,8):
   b[j][1]=97.7;b[j][2]=98.;b[j][3]=97.3;b[j][4]=97.7
  self.assertIsNone(m._find_exit(row(),"EARLY_1H_LOSS2_MFE_LT1",Fake(b)))
 def test_immediate_close_down_2p5_is_not_time_conditioned(self):
  b=bars()
  b[3][4]=97.4;b[3][3]=97.1
  b[4][1]=97.3;b[4][2]=98.;b[4][3]=97.1;b[4][4]=97.5
  early=m._find_exit(row(),"LOSS_M5_CLOSE2P5",Fake(b))
  self.assertEqual(early["ts"],T0+4*M5)
  self.assertEqual(early["fill"],97.3)
 def test_six_hour_or_trailing_original_unmodified(self):
  z=m.RULES["COMBO_TIME6_TRAIL3_GIVE1P5"]
  self.assertEqual(z["parts"],["TIME_6H","TRAIL_ARM3_GIVE1P5"])
  self.assertEqual(m.RULES["EARLY_1H_LOSS2_MFE_LT1"],{"kind":"loss","loss":2,"after":1,"mfeLt":1})
if __name__=="__main__":unittest.main()
