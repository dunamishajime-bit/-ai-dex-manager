#!/usr/bin/env python3
"""Offline PRISM5 structural regime contract tests. No venue calls."""
import importlib.util,math,sys,unittest
from pathlib import Path
NAME="prism5_pengu_v20_structural_direction_engine_20261122"
SPEC=importlib.util.spec_from_file_location(NAME,Path(__file__).with_name(NAME+".py"))
MOD=importlib.util.module_from_spec(SPEC)
sys.modules[NAME]=MOD
SPEC.loader.exec_module(MOD)
H=MOD.H
H1=MOD.H1

def bars(count=110,mode="trend",start=0,side="PENGU",vol=100):
 rows=[]
 p=0.1 if side=="PENGU" else 100.
 for i in range(count):
  o=p
  if side=="BTC":
   factor=0.9996 if mode=="trend" else (1.009 if i>=count-6 else 1.0001)
  elif mode=="trend":
   factor=0.995 if i%3 else 0.993
  else:
   factor=1.020 if i>=count-5 else 0.995
  p=o*factor
  high=max(o,p)*(1.003 if mode=="trend" else 1.005)
  low=min(o,p)*(0.997 if mode=="trend" else 0.970)
  volume=0 if mode=="no_print" and i>=count-6 else vol
  share=.22 if mode=="trend" or i<count-5 else .79
  rows.append(H1((start+i)*H,o,high,low,p,volume,volume*share))
 return rows

class TestPrism5Regime(unittest.TestCase):
 def test_seller_controlled_continuation(self):
  p=bars(mode="trend")
  b=bars(mode="trend",side="BTC")
  d=MOD.classify(p,b,110*H,.012)
  self.assertEqual(d.regime,"SELLER_CONTROLLED_CONTINUATION")
  self.assertEqual(d.action,"ENTER_SHORT_CANDIDATE")
  self.assertGreaterEqual(d.continuation_votes,5)
  self.assertLessEqual(d.reversal_votes,1)
  self.assertEqual(d.source_pengu_ts,109*H)

 def test_bounce_short_squeeze_rejected(self):
  p=bars(mode="bounce")
  b=bars(mode="bounce",side="BTC")
  d=MOD.classify(p,b,110*H,.013)
  self.assertEqual(d.regime,"BOUNCE_OR_SHORT_SQUEEZE")
  self.assertEqual(d.action,"REJECT_ORIGINAL_SHORT_REVERSAL_RISK")
  self.assertGreaterEqual(d.reversal_votes,3)

 def test_low_trading_volume_does_not_admit(self):
  p=bars(mode="no_print")
  b=bars(side="BTC",mode="trend")
  d=MOD.classify(p,b,110*H,.012)
  self.assertEqual(d.action,"NO_NEW_ENTRY_FEED_UNCERTAIN")
  self.assertEqual(d.min_data_quality,"STALE_OR_INSUFFICIENT_RECENT_TRADES")

 def test_future_bar_extension_cannot_change_historical_decision(self):
  p=bars();b=bars(side="BTC")
  a=MOD.classify(p,b,110*H,.012)
  future_p=bars(count=10,mode="bounce",start=110)
  future_b=bars(count=10,mode="bounce",start=110,side="BTC")
  z=MOD.classify(p+future_p,b+future_b,110*H,.012)
  self.assertEqual(a,z)

 def test_changed_unclosed_bar_does_not_change_decision(self):
  p=bars();b=bars(side="BTC")
  a=MOD.classify(p,b,110*H,.012)
  appended=H1(110*H,0.12,.22,.1,.2,10000,9500)
  self.assertEqual(a,MOD.classify(p+[appended],b,110*H,.012))

 def test_h1_gap_fails_closed(self):
  p=bars();b=bars(side="BTC")
  with self.assertRaisesRegex(ValueError,"H1_GAP"):
   MOD.classify(p[:99]+p[100:],b,110*H,.012)

 def test_insufficient_history_fails_closed(self):
  with self.assertRaisesRegex(ValueError,"INSUFFICIENT"):
   MOD.classify(bars(91),bars(91,side="BTC"),91*H,.012)

 def test_misaligned_timestamps_fails(self):
  with self.assertRaisesRegex(ValueError,"H1_ALIGNMENT"):
   H1(1,.1,.11,.09,.1,100,70)

 def test_buyer_volume_cannot_exceed_trades(self):
  with self.assertRaisesRegex(ValueError,"INVALID_VOLUME"):
   H1(0,.1,.11,.09,.1,100,101)

 def test_bad_atr_must_fail(self):
  for invalid in (float("nan"),0.,-.01,.55):
   with self.subTest(invalid=invalid):
    with self.assertRaisesRegex(ValueError,"INVALID_PINNED_ATR"):
     MOD.classify(bars(),bars(side="BTC"),110*H,invalid)

 def test_pending_cannot_jump_into_future(self):
  p=bars();b=bars(side="BTC")
  d=MOD.classify(p,b,110*H,.012)
  with self.assertRaisesRegex(ValueError,"NOT_WAITING"):
   MOD.confirm_pending(p,b,d,.012,115*H)

 def test_source_pin_is_immutable(self):
  self.assertEqual(MOD.SOURCE_PIN,"1657e173d250ad58f53e62f7bb0a3428fb405496")
  self.assertEqual(MOD.SOURCE_BLOB,"06476fed9985a165cf73971e790322ef3d03bd90")

if __name__=="__main__":unittest.main(verbosity=2)
