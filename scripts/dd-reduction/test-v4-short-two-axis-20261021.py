#!/usr/bin/env python3
"""Causal SHORT two-axis exit tests; no market lookup, no exchange calls."""
import bisect,importlib.util,collections
from pathlib import Path
here=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("short",here/"run-task9-v4-short-two-axis-20261021.py")
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
assert len(m.TIME_ROUTES)==37 and len(m.RULES)==7
M5=m.M5;H=m.HOUR
def row(route="REC_X09_TIME_48H",side="SHORT",end=5*H):
 return {"strategy_id":"V12","symbol":"ETHUSDT","side":side,"route":route,
 "entry_price":100.0,"entry_ts_ms":0,"exit_ts_ms":end,
 "exit_price":100.,"quantity":1,"candidate_id":"T","position_id":1}
def obs():
 o=collections.defaultdict(int)
 o["by_reason"]=collections.Counter()
 o["stop_decisions"]=[]
 return o
class Source:
 def __init__(self,bars):self.bars=bars;self.times=[x[0] for x in bars]
 def getdata(self,sy):return self.bars,self.times
# 5 H1s: first H1 dips by 3.5% and closes97; subsequent 2 H1s
# close at98 then99. Two rising H1 closes known at start H1 #3.
bars=[]
for i in range(5*12):
 h=i//12
 px=[97.,98.,99.,99.2,99.2][h]
 o=100. if i==0 else px
 low=96.5 if i==0 else min(o,px)-.01
 high=max(o,px)+.01
 bars.append((i*M5,o,high,low,px,1))
# Avoid early first-open mismatch, and the +3% low is observed at bar0.
rule=m.RULES["SHORT_PROFIT_3P_TO_1P_BULL2"]
ans=m.profit_exit(row(),rule,Source(bars),10,obs())
assert ans["exit_ts_ms"]==3*H+M5,ans
assert ans["exit_price"]>99.,ans
# Insufficient peak and no bullish confirmation must NOT exit.
bars2=[(i*M5,100.,100.1,98.5,99.8,1) for i in range(60)]
assert m.profit_exit(row(),rule,Source(bars2),10,obs())==row()
# TIME LONG and ATR/NATIVE SHORT excluded, always.
assert m.profit_exit(row(side="LONG"),rule,Source(bars),10,obs())==row(side="LONG")
assert m.profit_exit(row(route="REC_X13_TP1.5_SL1_H24"),rule,Source(bars),10,obs())==row(route="REC_X13_TP1.5_SL1_H24")
# Missing completed five minute candle is fail closed: no guessed exit.
gap=bars[:8]+bars[9:]
oo=obs()
assert m.profit_exit(row(),rule,Source(gap),10,oo)==row()
assert oo["internal_gap"]==1,oo
# 12h initial adverse: no prior profit +1%, price gaps above SHORT 2.5 stop.
initial=[]
for i in range(13*12+1):
 op=100. if i<144 else 103.
 initial.append((i*M5,op,op+.5,op-.1,op,1))
two=m.RULES["SHORT_INIT_2P5_H12_MFE1_CD12"]
ss=m.apply_exit(row(end=13*H),two,Source(initial),10,obs())
assert ss["exit_ts_ms"]==12*H+M5,ss
assert ss["exit_price"]>102.5,ss
# Both: preserve the chronologically earlier filled-exit proposal.
combo=m.RULES["SHORT_BOTH_2P5_AND_3P_TO_1P"]
q=m.apply_exit(row(end=13*H),combo,Source(initial),10,obs())
assert q["exit_ts_ms"]==12*H+M5,q
# The chosen +5% -> +2% requires LOWER low than the rejected +3% case.
selected=m.RULES["SHORT_PROFIT_5P_TO_2P_BULL2"]
assert m.profit_exit(row(),selected,Source(bars),10,obs())==row()
bars5=[list(x) for x in bars]
bars5[0][3]=94.5  # +5.5% unrealized SHORT peak, observed from completed first M5
bt=m.profit_exit(row(),selected,Source([tuple(x) for x in bars5]),10,obs())
assert bt["exit_ts_ms"]==3*H+M5,bt
assert bt["exit_price"]>=99.,bt
both=m.RULES["SHORT_BOTH_2P5_AND_5P_TO_2P"]
bt2=m.apply_exit(row(),both,Source([tuple(x) for x in bars5]),10,obs())
assert bt2["exit_ts_ms"]==3*H+M5,bt2
assert bt2["exit_reason"].startswith("RESEARCH_V4_SHORT_PROFIT_"),bt2
print("PASS SHORT selected +5% -> +2% confirmed H1, initial 2.5% after12h, 37 TIME scope, chronology, data gaps")
