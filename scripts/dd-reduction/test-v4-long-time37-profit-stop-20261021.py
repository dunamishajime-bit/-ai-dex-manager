#!/usr/bin/env python3
"""Synthetic causal checks: all 37 TIME route contract, plus2 M5 protection and H1 confirmation."""
import importlib.util
from collections import Counter
from pathlib import Path
HERE=Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location("m",HERE/"run-task9-v4-long-time37-profit-stop-20261021.py")
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
assert len(m.TIME_ROUTES)==37 and len(set(m.TIME_ROUTES))==37
assert "REC_X09_TIME_48H" in m.TIME_ROUTES
assert "REC_Y13_REV_D2_T36" in m.TIME_ROUTES
assert "REC_G3_LATE_BTC_REL" not in m.TIME_ROUTES
assert "REC_X13_TP1.5_SL1_H24" not in m.TIME_ROUTES
M5=m.M5
class Source:
 def __init__(self,bars):self.bars=bars
 def getdata(self,s):return self.bars,[b[0] for b in self.bars]
def row(route="REC_Y13_REV_D2_T36",side="LONG"):
 return {"strategy_id":"V12","side":side,"route":route,"symbol":"ETHUSDT","entry_price":100.0,
 "entry_ts_ms":0,"exit_ts_ms":9*M5,"exit_price":101.,"candidate_id":"TEST","quantity":1}
def obs():
 return {"eligible":0,"triggered":0,"data_gap":0,"entry_mismatch":0,"internal_gap":0,"by_reason":Counter()}
r=m.RULES_BY_ID["TIME37_PLUS3TO1_AND_PLUS2_FLOOR_ZERO"]
# Prior 5m high arms after bar finishes; floor triggered only in NEXT bar
prices=[(0,100.,102.5,100.,102.,1),(M5,102.,102.,101.,101.5,1),
        (2*M5,101.5,101.5,99.7,100.,1)]+[(i*M5,100.,100.1,100.,100.0,1) for i in range(3,10)]
case=m.apply_layered(row(),r,Source(prices),10,obs())
assert case["exit_ts_ms"]==3*M5,case
assert case["exit_price"]<100.
# A bar reaching 102.5 and 99.0 itself must not both arm and trigger
one=[(0,100.,102.5,99.,101.,1),(M5,101.,101.5,100.1,101.,1)]+[
    (i*M5,101.,101.4,100.4,101.,1) for i in range(2,10)]
same=m.apply_layered(row(),r,Source(one),10,obs())
assert same["exit_ts_ms"]==9*M5,same
# A gap after arming sells at the adverse open rather than synthetic floor.
gap=[(0,100.,102.5,100.,102.5,1),(M5,98.,98.5,97.0,98.,1)]+[
    (i*M5,98.,98.,98.,98.,1) for i in range(2,10)]
g=m.apply_layered(row(),r,Source(gap),10,obs())
assert g["exit_ts_ms"]==2*M5 and g["exit_price"]<99,g
# Wrong side or policy family must not be changed.
assert m.apply_layered(row(side="SHORT"),r,Source(prices),10,obs())==row(side="SHORT")
assert m.apply_layered(row(route="REC_G3_LATE_BTC_REL"),r,Source(prices),10,obs())==row(route="REC_G3_LATE_BTC_REL")
assert m.apply_layered(row(route="REC_X13_TP1.5_SL1_H24"),r,Source(prices),10,obs())==row(route="REC_X13_TP1.5_SL1_H24")
# Missing bar must fail closed, not invent execution.
lost=prices[:2]+prices[3:]
obsx=obs()
assert m.apply_layered(row(),r,Source(lost),10,obsx)==row()
assert obsx["internal_gap"]==1
# Pure policy must remain original H1-only implementation.
h=m.RULES_BY_ID["TIME37_LONG_PLUS3_TO_PLUS1_BEAR2"]
assert m.apply_layered(row(),h,Source(prices),10,obs())==row()
print("PASS TIME37 catalog, 5m previous-bar arm, no same-bar lookahead, adverse gap-fill, fail-closed data-gap, route and side isolation")
