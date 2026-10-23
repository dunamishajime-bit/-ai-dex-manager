#!/usr/bin/env python3
import unittest,importlib.util
from pathlib import Path
HERE=Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location("plong",HERE/"research-pengu-long-firstpass-20261024.py")
pl=importlib.util.module_from_spec(s);s.loader.exec_module(pl)
T=1700000000000;M5=300000;H=3600000
def row(i,peak,close):
 return dict(ts=T+(i+1)*M5,price=100*(1+close/100),closeRet=close,mfeBefore=peak[0],mfeAfter=peak[1],fillRet=close)
class LongStopTests(unittest.TestCase):
 def test_activation_only_after_fully_confirmed_prior_m5(self):
  a=[row(0,(0,3),-5.5),row(1,(3,3),-5.5)]
  r=pl.early_exit(a,pl.CASES["PEAK2_FLOOR_MINUS5"],T)
  self.assertEqual(r["ts"],T+2*M5)
 def test_winners_untouched_if_no_reversal(self):
  a=[row(0,(0,2.5),2),row(1,(2.5,4),1),row(2,(4,6),4)]
  self.assertIsNone(pl.early_exit(a,pl.CASES["PEAK2_FLOOR_MINUS5"],T))
 def test_initial_two_hour_stop_mfe_low(self):
  a=[dict(ts=T+2*H,mfeAfter=.1,closeRet=-3.25)]
  self.assertIsNotNone(pl.early_exit(a,pl.CASES["FIRST2_NEG3_MFE05"],T))
 def test_initial_stop_disallow_any_early_mfe(self):
  a=[dict(ts=T+2*H,mfeAfter=.7,closeRet=-3.25)]
  self.assertIsNone(pl.early_exit(a,pl.CASES["FIRST2_NEG3_MFE05"],T))
 def test_long_safety_not_reduce_old_hard(self):
  a=[row(0,(0,2),-3),row(1,(2,2),-5)]
  self.assertIsNotNone(pl.early_exit(a,pl.CASES["PEAK2_FLOOR_MINUS5"],T))
 def test_early_stop_only_at_exact_checkpoint(self):
  a=[dict(ts=T+H,mfeAfter=.1,closeRet=-4),dict(ts=T+2*H+M5,mfeAfter=.1,closeRet=-4)]
  self.assertIsNone(pl.early_exit(a,pl.CASES["FIRST2_NEG3_MFE05"],T))
if __name__=="__main__":unittest.main()
