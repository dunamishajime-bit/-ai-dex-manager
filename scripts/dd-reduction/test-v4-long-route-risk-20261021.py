#!/usr/bin/env python3
"""Synthetic causal/route tests for local V4 LONG research overlay only."""
from pathlib import Path
import importlib.util
import sys
from collections import Counter

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("v4_long_route_tests",HERE/"run-task9-v4-long-route-risk-20261021.py")
assert spec and spec.loader
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class Source:
    def __init__(self,bars):self.bars=bars
    def getdata(self,s):return self.bars,[b[0] for b in self.bars]

def observed():
    return {"eligible":0,"triggered":0,"by_reason":Counter(),"data_gap":0,"entry_mismatch":0,"internal_gap":0,
            "original_winner_triggered":0,"original_loser_triggered":0,"original_unsettled_triggered":0,"stop_decisions":[]}
def trade(route="REC_X09_TIME_48H"):
    return {"strategy_id":"V12","side":"LONG","route":route,"symbol":"ETHUSDT","entry_price":100.,
            "entry_ts_ms":0,"exit_ts_ms":1200000,"exit_price":101.,"candidate_id":"test","position_id":10,
            "quantity":1,"modeled_realized_pnl_jpy_at_exit_fx":100.,"planned_exit_reason":"BASE"}
rule={"id":"TEST","strategy":"V12","sides":["LONG"],"routes":["REC_X09_TIME_48H"],
      "mfe_threshold":.03,"profit_floor":.005,"giveback_pct":.02,"arm_hours":0,"mode":"profit_guard"}
# Arm strictly from previously completed five-minute highs.
a=Source([(0,100.,103.2,100.,103.0,10),(300000,103.,103.5,101.,102.,10),(600000,102.,103.,102.,102.,10)])
x=m.profit_exit(trade(),rule,a,10,observed())
assert x["exit_ts_ms"]==600000,(x,"expected prior-high-protected second bar")
assert x["exit_price"]<102. and x["exit_price"]>100.
# Same-bar high then low cannot arm a protective STOP retroactively.
b=Source([(0,100.,104.,99.,103.,10),(300000,103.,103.5,102.5,103.,10),(600000,103.,103.4,102.8,103.,10)])
y=m.profit_exit(trade(),rule,b,10,observed())
assert y["exit_ts_ms"]==1200000,"same-bar MFE future leak"
# Rejected routes or sides never leave the original trade.
assert m.profit_exit(trade("REC_Y13_REV_D2_T36"),rule,a,10,observed())["exit_ts_ms"]==1200000
assert not m.route_matches({**trade(),"side":"SHORT"},rule)
# A missing 5m bar must fail closed, not interpolate across the hole.
g=observed()
z=m.profit_exit(trade(),rule,Source([(0,100,104,100,103,1),(600000,103,104,101,102,1)]),10,g)
assert z["exit_ts_ms"]==1200000 and g["internal_gap"]==1
print("PASS V4 LONG route, previous-bar MFE, no future same-bar arm, gap veto")
