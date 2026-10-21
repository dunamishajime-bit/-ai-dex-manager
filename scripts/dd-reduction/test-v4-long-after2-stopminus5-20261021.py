#!/usr/bin/env python3
"""Causality and level tests for +2% MFE triggered -5% relative-to-entry STOP."""
import importlib.util
from pathlib import Path
from collections import Counter
HERE=Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location("s",HERE/"run-task9-v4-long-after2-stopminus5-20261021.py")
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
assert len(m.RULES)==4
assert len(m.RULES["TIME37_AFTER2_STOP_MINUS5"]["routes"])==37
assert len(m.RULES["X3_AFTER2_STOP_MINUS5"]["routes"])==3
M5=m.m.M5
class Feed:
 def __init__(self,b):self.b=b
 def getdata(self,s):return self.b,[r[0] for r in self.b]
def row(route="REC_X09_TIME_48H",side="LONG",hours=4):
 return {"strategy_id":"V12","side":side,"route":route,"symbol":"ETHUSDT",
  "entry_price":100.,"entry_ts_ms":0,"exit_ts_ms":hours*60*60*1000,
  "exit_price":100.,"quantity":1,"candidate_id":"A"}
def obs():
 return {"data_gap":0,"entry_mismatch":0,"internal_gap":0,"eligible":0,
  "triggered":0,"by_reason":Counter()}
r=m.RULES["X3_AFTER2_STOP_MINUS5"]
# Never trigger -5% without prior +2% MFE
flat=[(i*M5,100.,100.8,93.5,94.,1) for i in range(48)]
assert m.m.apply_layered(row(),r,Feed(flat),10,obs())==row()
# +2% on bar 0 then -5% on same bar cannot stop with lookahead;
# subsequent bar remains above threshold.
same=[(0,100.,103.,94.,100.5,1)]+[(i*M5,100.5,101.,100.,100.5,1) for i in range(1,48)]
assert m.m.apply_layered(row(),r,Feed(same),10,obs())==row()
# +2% on bar 0, next bar reaches 95 and STOP modeled thereafter.
armed=[(0,100.,102.5,99.,102.,1),(M5,102.,102.5,94.9,95.5,1)]+[
 (i*M5,95.5,95.6,95.4,95.5,1) for i in range(2,48)]
x=m.m.apply_layered(row(),r,Feed(armed),10,obs())
assert x["exit_ts_ms"]==2*M5,x
assert 94.7<=x["exit_price"]<=95.0,x
# Gap through STOP: fills at the adverse open, not always at stop.
gap=[(0,100.,102.5,99.,101.,1),(M5,92.,93.,91.,92.5,1)]+[
 (i*M5,92.5,92.6,92.4,92.5,1) for i in range(2,48)]
g=m.m.apply_layered(row(),r,Feed(gap),10,obs())
assert g["exit_ts_ms"]==2*M5 and g["exit_price"]<93,g
# Wrong route, non-LONG and M5 missing data must never fabricate stops.
assert m.m.apply_layered(row(side="SHORT"),r,Feed(armed),10,obs())==row(side="SHORT")
assert m.m.apply_layered(row(route="REC_X13_TP1.5_SL1_H24"),r,Feed(armed),10,obs())==row(route="REC_X13_TP1.5_SL1_H24")
hole=armed[:1]+armed[2:]
o=obs()
assert m.m.apply_layered(row(),r,Feed(hole),10,o)==row()
assert o["internal_gap"]==1,o
# Non-triggering pure TIME37 +3 -> +1 rule must stay independent.
p=m.m.RULES_BY_ID["TIME37_LONG_PLUS3_TO_PLUS1_BEAR2"]
assert m.m.apply_layered(row(route="REC_X09_TIME_48H"),p,Feed(armed),10,obs())==row()
print("PASS +2% arm / -5% entry floor; no future same-bar fill, adverse gap, missing-bar fail closed, scope isolation")
