#!/usr/bin/env python3
"""Causal H1 gated exit: no earlier future bar, missing 5m data veto."""
import importlib.util
from pathlib import Path
from collections import Counter
HOUR=3600000;M5=300000
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("twoaxis",HERE/"run-task9-v4-long-staged-profit-20261021.py")
assert spec and spec.loader
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Source:
 def __init__(self,market,btc=None):self.market=market;self.btc=btc or market
 def getdata(self,symbol):
  a=self.btc if symbol=="BTCUSDT" else self.market
  return a,[b[0] for b in a]
def bars_from_ends(ends):
 out=[];prev=100.
 for h,target in enumerate(ends):
  for j in range(12):
   t=h*HOUR+j*M5
   c=prev+(target-prev)*(j+1)/12
   o=prev+(target-prev)*j/12
   out.append((t,o,max(o,c),min(o,c),c,10))
  prev=target
 return out
def row(route="REC_X09_TIME_48H",side="LONG"):
 return {"strategy_id":"V12","side":side,"route":route,"symbol":"ETHUSDT","entry_price":100.,"entry_ts_ms":0,"exit_ts_ms":5*HOUR,"exit_price":100.,"candidate_id":"CA","position_id":1,"quantity":1,
 "modeled_realized_pnl_jpy_at_exit_fx":10.}
def obs():
 return {"eligible":0,"triggered":0,"by_reason":Counter(),"data_gap":0,"entry_mismatch":0,"internal_gap":0,"original_winner_triggered":0,"original_loser_triggered":0}
rule=m.RULES["INITIAL_X_2H_MFE0P5_NEG0P75"]
s=Source(bars_from_ends([99.,98.,97.,97.,97.]))
r=m.protected_h1_exit(row(),rule,s,10,obs())
assert r['exit_ts_ms']==2*HOUR+M5,(r,'expected 2h decision')
assert r['exit_price']<99.
assert m.protected_h1_exit(row("REC_Y13_REV_D2_T36"),rule,s,10,obs())['exit_ts_ms']==5*HOUR
assert m.protected_h1_exit(row(side="SHORT"),rule,s,10,obs())['exit_ts_ms']==5*HOUR
profits=m.RULES["PROFIT_X_3P0_FLOOR1P0_BEAR2"]
s2=Source(bars_from_ends([104.,102.,100.4,100.,100.]))
p=m.protected_h1_exit(row(),profits,s2,10,obs())
assert p['exit_ts_ms']==3*HOUR+M5,p
# Already unprofitable without earlier MFE cannot trigger a profit-protection exit.
assert m.protected_h1_exit(row(),profits,s,10,obs())["exit_ts_ms"]==5*HOUR
# Full 5m history required to make decision
gap=Source([b for i,b in enumerate(s2.market) if i!=15])
o=obs();g=m.protected_h1_exit(row(),profits,gap,10,o)
assert g['exit_ts_ms']==5*HOUR and o['internal_gap']==1
# BTC-relative guard: bullish three-hour BTC invalidates SHORT-term weak risk.
btcrule=m.RULES["INITIAL_X_4H_MFE1_NEG1_BEAR2_BTC3NEG"]
bg=Source(bars_from_ends([99.,98.,97.,96.,95.]),bars_from_ends([101.,102.,103.,104.,105.]))
assert m.protected_h1_exit(row(),btcrule,bg,10,obs())['exit_ts_ms']==5*HOUR
# Staged policy must prefer the +3% arm over the speculative +2% early tier.
stage=m.RULES["STAGED_X_2P_TO_MINUS1P_3P_TO_PLUS1P"]
# Peak reaches only +2.5%, two bearish hourly candles then close below -1%.
stage2=m.Source if hasattr(m,"Source") else Source
s3=Source(bars_from_ends([102.5,101.,98.9,98.8,98.]))
res2=m.protected_h1_exit(row(),stage,s3,10,obs())
assert res2['exit_ts_ms']==3*HOUR+M5,res2
# +3.5% peak then decline to +0.9%: select +1% policy even though the
# speculative -1% fallback is not yet breached.
s4=Source(bars_from_ends([103.5,102.,100.9,100.8,100.]))
res3=m.protected_h1_exit(row(),stage,s4,10,obs())
assert res3["exit_ts_ms"]==3*HOUR+M5,res3
# The same later 3% peak with a close at +1.5% should not trigger either.
s5=Source(bars_from_ends([103.5,102.4,101.5,101.5,101.5]))
res4=m.protected_h1_exit(row(),stage,s5,10,obs())
assert res4["exit_ts_ms"]==5*HOUR,res4
print("PASS staged H1 prior MFE +2 and +3 arms, 3% arm precedence, legacy tests")
