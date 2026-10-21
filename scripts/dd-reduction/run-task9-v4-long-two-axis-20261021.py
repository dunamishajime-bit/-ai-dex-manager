#!/usr/bin/env python3
"""Causal H1 decision-based V4 TIME-LONG loss/profit guard BT; research only.

All rules are *proposed* conditional market exits on the first available M5
open after completed H1 observations. Preallocation exits flow into the
unaltered 8-logic allocator; no canonical LIVE STOP/venue fill is inferred.
"""
from __future__ import annotations
import argparse,bisect,json,math,statistics,sys,importlib.util
from collections import Counter
from pathlib import Path
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
spec=importlib.util.spec_from_file_location("prior_v4_long_route_study",HERE/"run-task9-v4-long-route-risk-20261021.py")
assert spec and spec.loader
prior=importlib.util.module_from_spec(spec)
spec.loader.exec_module(prior)
core=prior.core
frozen=prior.frozen
HOUR=core.HOUR;M5=core.M5
ROOT=Path(r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research")
DEFAULT_OUT=ROOT/"2026-10-21_v4_long_two_axis_confirmed_hourly"
ROUTES_X=["REC_X09_TIME_48H","REC_X10_TIME_48H","REC_X14_TIME_48H"]
ROUTES_Y=["REC_Y04_REV_D2_T36","REC_Y13_REV_D2_T36","REC_Y17_REV_D1_T3"]
ROUTES_ALL=ROUTES_X+ROUTES_Y
RULES=[
 {"id":"INITIAL_X_2H_MFE0P5_NEG0P75","mode":"initial_h1","routes":ROUTES_X,"after_h":2,"mfe_lt":.005,"neg_close":.0075,"bear_bars":1},
 {"id":"INITIAL_X_4H_MFE1_NEG1P0_BEAR2","mode":"initial_h1","routes":ROUTES_X,"after_h":4,"mfe_lt":.01,"neg_close":.01,"bear_bars":2},
 {"id":"INITIAL_X_4H_MFE1_NEG1_BEAR2_BTC3NEG","mode":"initial_h1","routes":ROUTES_X,"after_h":4,"mfe_lt":.01,"neg_close":.01,"bear_bars":2,"btc3h_neg":True},
 {"id":"INITIAL_XY_6H_MFE1_NEG1P5_BEAR2","mode":"initial_h1","routes":ROUTES_ALL,"after_h":6,"mfe_lt":.01,"neg_close":.015,"bear_bars":2},
 {"id":"INITIAL_Y_3H_MFE0P5_NEG0P75_BEAR2","mode":"initial_h1","routes":ROUTES_Y,"after_h":3,"mfe_lt":.005,"neg_close":.0075,"bear_bars":2},
 {"id":"PROFIT_X_2P0_FLOOR0P5_BEAR2","mode":"profit_h1","routes":ROUTES_X,"mfe_gte":.02,"close_floor":.005,"bear_bars":2},
 {"id":"PROFIT_X_3P0_FLOOR1P0_BEAR2","mode":"profit_h1","routes":ROUTES_X,"mfe_gte":.03,"close_floor":.01,"bear_bars":2},
 {"id":"PROFIT_XY_3P0_FLOOR0P5_BEAR2_BTCNEG","mode":"profit_h1","routes":ROUTES_ALL,"mfe_gte":.03,"close_floor":.005,"bear_bars":2,"btc3h_neg":True},
 {"id":"PROFIT_XY_5P0_FLOOR2P0_BEAR2","mode":"profit_h1","routes":ROUTES_ALL,"mfe_gte":.05,"close_floor":.02,"bear_bars":2},
 {"id":"PROFIT_XY_2P0_FLOOR0_BEAR2","mode":"profit_h1","routes":ROUTES_ALL,"mfe_gte":.02,"close_floor":0,"bear_bars":2},
]
RULES={r["id"]:{**r,"strategy":"V12","sides":["LONG"]} for r in RULES}
def protected_h1_exit(row,rule,source,cost_bps,obs,original_row=None):
 if not prior.route_matches(row,rule):return row
 entry=float(row["entry_price"]);ts_entry=int(row["entry_ts_ms"]);exit_ts=int(row["exit_ts_ms"])
 if entry<=0 or exit_ts-ts_entry <3*M5:return row
 bars,times=source.getdata(str(row["symbol"]))
 st=bisect.bisect_left(times,ts_entry);end=bisect.bisect_left(times,exit_ts)
 if st>=len(bars) or st>=end or times[st]>ts_entry+M5:
  obs["data_gap"]+=1;return row
 op0=float(bars[st][1])
 if abs(op0/entry-1)>.025:
  obs["entry_mismatch"]+=1;return row
 scale=entry/op0;peak=0.
 obs["eligible"]+=1
 # Use only bars strictly before the H1 close boundary; an incomplete H1
 # cannot arm an exit. M5 following the decision is the modeled market exit.
 for i in range(st,end):
  ts,op,hi,lo,close,vol=bars[i]
  if i>st and ts-bars[i-1][0]!=M5:
   obs["internal_gap"]+=1;return row
  if ts%HOUR==0 and ts>=ts_entry+2*HOUR and i-st>=24:
   elapsed=(ts-ts_entry)/HOUR
   # at the H1 boundary, i-1 is a fully closed M5 in the preceding H1.
   c0=bars[i-1][4]*scale;c1=bars[i-13][4]*scale
   bearish=1 if c0<c1 else 0
   # A one-H1 decline is knowable after 2h; a *two*-H1 decline needs
   # three completed H1 closes, never bars before position entry.
   if i-25>=st:
    c2=bars[i-25][4]*scale
    if c0<c1 and c1<c2:bearish=2
   if bearish>=rule["bear_bars"]:
    btc_ok=True
    if rule.get("btc3h_neg"):
     btc,tbtc=source.getdata("BTCUSDT")
     idx=bisect.bisect_left(tbtc,ts)
     if idx<37 or idx>len(tbtc) or ts-tbtc[idx-1]!=M5 or ts-tbtc[idx-37]!=37*M5:
      btc_ok=False
     elif btc[idx-1][4]>=btc[idx-37][4]:btc_ok=False
    if btc_ok:
     if rule["mode"]=="initial_h1":
      active=elapsed>=rule["after_h"] and peak<rule["mfe_lt"] and c0/entry-1<=-rule["neg_close"]
     else:
      active=peak>=rule["mfe_gte"] and c0/entry-1<=rule["close_floor"]
     if active:
      fill=float(op)*scale*(1-cost_bps/10000)
      if ts+M5<exit_ts and fill>0:
       obs["triggered"]+=1
       obs["by_reason"]["H1_CONFIRMED_TWO_AXIS"]+=1
       old=original_row or row
       outcome=core.classify_pnl(old)
       key={"WIN":"original_winner_triggered","LOSS":"original_loser_triggered","UNSETTLED":"original_unsettled_triggered"}.get(outcome["status"])
       if key:obs[key]+=1
       changed=dict(row,exit_ts_ms=ts+M5,exit_price=fill,exit_reason="RESEARCH_V4_LONG_H1_CONFIRMED_"+rule["id"],unit_price_return=fill/entry-1)
       return changed
  peak=max(peak,float(hi)*scale/entry-1)
 return row
def run(args):
 if len(args.candidates)!=len(set(args.candidates)) or set(args.candidates)-set(RULES):
  raise RuntimeError("INVALID_CANDIDATES")
 if args.output.resolve() in (prior.DEFAULT_PRIOR.resolve(),prior.DEFAULT_OUT.resolve()) or HERE.parents[1].resolve() in args.output.resolve().parents:raise RuntimeError("REFUSE_OUTPUT_COLLISION")
 args.output.mkdir(parents=True,exist_ok=True)
 m=json.loads((prior.DEFAULT_PRIOR/"manifest.json").read_text("utf8"))
 source,helper=core.task8.legacy.bootstrap()
 from task9_legacy_evidence_capture import install_legacy_capture
 install_legacy_capture(helper)
 core.Path.write_text=core._path_write_text
 core.task8.legacy.ensure_baseline(helper)
 previous=helper.experiment_filter
 core.OUTPUT=args.output
 core.BOOTSTRAP_REDIRECT=args.output/"_legacy-bootstrap-cache"
 core._transform_rows=frozen._preallocation_candidate_transform
 core._matches=prior.route_matches
 core._apply_initial_stop=protected_h1_exit
 base={};ledger={}
 for cost in (10,30):
  ledger[str(cost)]=prior.read_jsonl(prior.ledger(prior.DEFAULT_PRIOR,cost))
  b=m["baseline"][str(cost)]
  base[str(cost)]={"finalEquityJpy":b["finalEquityJpy"],"maxMtmDdPct":b["maximumMtmDdPct"],
                   "profitFactor":b["profitFactor"],"closedTrades":b["closedTrades"],
                   "longLossMetrics":prior.loss_metrics(ledger[str(cost)])}
 results={}
 for cand in args.candidates:
  rule=RULES[cand]
  costs={}
  for cost in (10,30):
   out=core._run_engine("T_"+cand+"_"+str(cost),"V12_LONG_COMPOSITE",[rule],cost,source,helper,previous)
   audit=prior.evaluate(out,ledger[str(cost)],base[str(cost)],cost)
   if audit["accounting"]!="PASS":raise RuntimeError("ACCOUNTING_FAIL")
   costs[str(cost)]=audit
   print("CASE",cand,cost,"DD",round(audit["maxMtmDdPct"],6),
         "DELTA",round(audit["ddImprovementPp"],6),"EQ",round(audit["finalEquityJpy"]),
         "STOP",audit["admittedV12LongStopExits"],"LOSERS_SAVED",audit["originalLosersImproved"],
         "WINNERS_EARLY",audit["originalWinnersExitedEarly"],flush=True)
  results[cand]={"rule":rule,"costs":costs,"ddGateBothCosts":all(v["ddImprovementPp"]>=.10 for v in costs.values())}
  (args.output/"v4-long-confirmed-two-axis-results.json").write_text(
   json.dumps({"status":"POST_HOC_RESEARCH_ONLY_MODELED_H1_5M","baseline":base,"results":results,
   "sourceArchiveSha256":m["sourceArchive"]["archiveSha256"],"liveChanges":0},ensure_ascii=False,indent=2)+"\n","utf8")
 print("DONE",len(results),flush=True)
if __name__=="__main__":
 ap=argparse.ArgumentParser()
 ap.add_argument("--output",type=Path,default=DEFAULT_OUT)
 ap.add_argument("--candidates",nargs="*",default=list(RULES))
 run(ap.parse_args())
