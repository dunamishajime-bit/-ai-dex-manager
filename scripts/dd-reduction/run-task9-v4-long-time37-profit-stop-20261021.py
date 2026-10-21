#!/usr/bin/env python3
"""Research only: user-selected +3/+1 bearish H1 exit plus optional +2 resident-like STOP."""
from __future__ import annotations
import importlib.util
import argparse,bisect,json,sys
from pathlib import Path
HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
CATALOG=REPO/"docs/research/results/v12-v4-long-route-risk-20261021/V12_V4_LONG_FROZEN_TIME37_ROUTE_CATALOG_20261021.json"
cat=json.loads(CATALOG.read_text("utf8"))
assert cat["types"]=={"TIME":37,"NATIVE":1,"ATR":3}
TIME_ROUTES=cat["routes"]
assert len(TIME_ROUTES)==len(set(TIME_ROUTES))==37
s=importlib.util.spec_from_file_location("old_staged_bt",HERE/"run-task9-v4-long-staged-profit-20261021.py")
assert s and s.loader
old=importlib.util.module_from_spec(s)
s.loader.exec_module(old)
old_single=old.protected_h1_exit
M5=old.M5;HOUR=old.HOUR
RULES=[
 {"id":"TIME37_LONG_PLUS3_TO_PLUS1_BEAR2","mode":"profit_h1","routes":TIME_ROUTES,
  "mfe_gte":.03,"close_floor":.01,"bear_bars":2},
 {"id":"TIME37_PLUS3TO1_AND_PLUS2_FLOOR_NEG0P5","mode":"layered_h1_and_m5_stop","routes":TIME_ROUTES,
  "mfe_gte":.03,"close_floor":.01,"bear_bars":2,"pre_arm_mfe":.02,"m5_floor":-.005},
 {"id":"TIME37_PLUS3TO1_AND_PLUS2_FLOOR_ZERO","mode":"layered_h1_and_m5_stop","routes":TIME_ROUTES,
  "mfe_gte":.03,"close_floor":.01,"bear_bars":2,"pre_arm_mfe":.02,"m5_floor":0.0},
 {"id":"TIME37_PLUS3TO1_AND_PLUS2_FLOOR_PLUS0P5","mode":"layered_h1_and_m5_stop","routes":TIME_ROUTES,
  "mfe_gte":.03,"close_floor":.01,"bear_bars":2,"pre_arm_mfe":.02,"m5_floor":.005},
 {"id":"X3_PLUS3TO1_AND_PLUS2_FLOOR_ZERO","mode":"layered_h1_and_m5_stop","routes":old.ROUTES_X,
  "mfe_gte":.03,"close_floor":.01,"bear_bars":2,"pre_arm_mfe":.02,"m5_floor":0.0},
]
RULES_BY_ID={v["id"]:{**v,"strategy":"V12","sides":["LONG"]} for v in RULES}
assert len(RULES_BY_ID)==5
def apply_layered(row,rule,source,cost_bps,obs,original_row=None):
 if not old.prior.route_matches(row,rule):return row
 if rule["mode"]=="profit_h1":
  return old_single(row,rule,source,cost_bps,obs,original_row=original_row)
 if rule["mode"]!="layered_h1_and_m5_stop":
  raise AssertionError("MODE_NOT_SUPPORTED")
 entry=float(row["entry_price"]);st0=int(row["entry_ts_ms"]);en=int(row["exit_ts_ms"])
 if entry<=0 or en-st0<3*M5:return row
 bars,times=source.getdata(str(row["symbol"]))
 st=bisect.bisect_left(times,st0);end=bisect.bisect_left(times,en)
 if st>=len(bars) or st>=end or times[st]>st0+M5:
  obs["data_gap"]+=1;return row
 anchor=float(bars[st][1])
 if abs(anchor/entry-1)>.025:obs["entry_mismatch"]+=1;return row
 scale=entry/anchor;peak=0.
 obs["eligible"]+=1
 for i in range(st,end):
  ts,op,hi,lo,close,_vol=bars[i]
  if i>st and ts-bars[i-1][0]!=M5:
   obs["internal_gap"]+=1
   return row
  # Require two independently CLOSED consecutive H1 bears; H1 evaluation
  # only at an H1 opening; current 5m OHLC is never used for this decision.
  if ts%HOUR==0 and ts>=st0+3*HOUR and i-st>=36:
   c0=float(bars[i-1][4])*scale;c1=float(bars[i-13][4])*scale;c2=float(bars[i-25][4])*scale
   if c0<c1<c2 and peak>=rule["mfe_gte"] and c0/entry-1<=rule["close_floor"]:
    fill=float(op)*scale*(1-cost_bps/10000.)
    if ts+M5<en and fill>0:
     obs["triggered"]+=1
     obs["by_reason"]["H1_PROFIT_3_TO_1"]+=1
     actual=dict(row,exit_ts_ms=ts+M5,exit_price=fill,
      exit_reason="RESEARCH_V4_LONG_TIME37_H1_PROFIT_"+rule["id"],
      unit_price_return=fill/entry-1)
     return actual
  # Supplemental 5m resident-like market STOP (not a signed venue order).
  # Prior M5 high can arm; never same-bar high followed by low.
  if peak>=rule["pre_arm_mfe"]:
   floor_price=entry*(1+rule["m5_floor"])
   if float(op)*scale<=floor_price or float(lo)*scale<=floor_price:
    fill=min(float(op)*scale,floor_price)*(1-cost_bps/10000.)
    if ts+M5<en and fill>0:
     obs["triggered"]+=1
     obs["by_reason"]["M5_RESIDENT_LIKE_2P_FLOOR"]+=1
     return dict(row,exit_ts_ms=ts+M5,exit_price=fill,
      exit_reason="RESEARCH_V4_LONG_TIME37_M5_EMERGENCY_"+rule["id"],
      unit_price_return=fill/entry-1)
  peak=max(peak,float(hi)*scale/entry-1)
 return row
def main():
 ap=argparse.ArgumentParser()
 ap.add_argument("--output",type=Path,default=old.ROOT/"2026-10-21_v4_long_time37_universe_guard")
 ap.add_argument("--candidates",nargs="*",default=list(RULES_BY_ID))
 args=ap.parse_args()
 if not set(args.candidates).issubset(RULES_BY_ID):raise RuntimeError("UNKNOWN_CASE")
 assert len(args.candidates)==len(set(args.candidates))
 old.RULES.update(RULES_BY_ID)
 old.protected_h1_exit=apply_layered
 old.run(args)
if __name__=="__main__":main()
