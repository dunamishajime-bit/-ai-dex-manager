#!/usr/bin/env python3
"""PRISM III: causal trade-volume-aware PENGU false-direction lifecycle overlay.

All policy decisions use completed traded M5 bars up to the decision instant,
and execute only on NEXT positively traded M5 open after that instant. Never
prefetch the future exit into a gate. Native exit priority uses first traded
native resident-stop trigger time, not a later H1 accounting timestamp.

This is an ablation study, not production code. Both fees and time splits
are reported for every predeclared policy; no OOS threshold search / adoption.
"""
from __future__ import annotations
import bisect,csv,datetime as dt,gzip,json,math,statistics,sys
from collections import defaultdict,Counter
from pathlib import Path
from typing import Optional
ROOT=Path(r"C:\tmp\disdex-bt-20251001-20261001")
WORK=Path(sys.argv[1]) if len(sys.argv)>1 else Path(r"C:\Users\dis\Documents\DisDex_Research\WINRATE_DEEP_20261122")
OUTPUT=WORK/"phase2_results"
PUBLIC=WORK/"forward_public_20261001_20261118"
HOUR=3600000;M5=300000
Q2=int(dt.datetime(2026,4,1,tzinfo=dt.timezone.utc).timestamp()*1000)
Q3=int(dt.datetime(2026,7,1,tzinfo=dt.timezone.utc).timestamp()*1000)
Q4=int(dt.datetime(2026,10,1,tzinfo=dt.timezone.utc).timestamp()*1000)
END=int(dt.datetime(2026,11,18,tzinfo=dt.timezone.utc).timestamp()*1000)
ROUTES=("SHORT_V20","RECOVERY_V8","LONG_V64")
OUT=OUTPUT
srcfile=OUT/"PRISM_VOLUME_AWARE_127_PINNED_EXECUTION_LEDGER.csv"
with srcfile.open(encoding="utf-8-sig",newline="") as f:source=list(csv.DictReader(f))
assert len(source)==127
def fl(x):return float(x)
def maybeint(s):return int(s) if s else None
def source_market(sym):
 fs=[*sorted((ROOT/"aster-public-v3-5m-prefix").glob(f"{sym}-5m-*.jsonl.gz")),
   *sorted((ROOT/"aster-public-v3-5m-suffix").glob(f"{sym}-5m-*.jsonl.gz")),
   PUBLIC/f"{sym}-5m-20261001-20261118.jsonl.gz"]
 z={}
 for f in fs:
  with gzip.open(f,"rt",encoding="utf8") as handle:
   for l in handle:
    a=json.loads(l);t=int(a[0])
    v=(float(a[1]),float(a[2]),float(a[3]),float(a[4]),float(a[5]),float(a[9]))
    if not 0<=v[5]<=v[4]+1e-7:raise ValueError("BAD_TAKER_VOLUME:"+str(t))
    if t in z and z[t]!=v:raise ValueError("CONFLICTING_BAR")
    z[t]=v
 times=sorted(t for t,v in z.items() if v[4]>0)
 return {"t":times,"bars":z}
MKT={sym:source_market(sym) for sym in ("PENGUUSDT","BTCUSDT")}
def first_trade_after(t,cutoff=24*HOUR):
 a=MKT["PENGUUSDT"]["t"];k=bisect.bisect_left(a,t)
 if k<len(a) and a[k]<=t+cutoff:return a[k]
 return None
def last_traded_close(sym,t):
 # Strictly completed positive-volume M5 intervals, not an unclosed bar.
 a=MKT[sym]["t"];i=bisect.bisect_right(a,t-M5)-1
 if i<0:return None
 return a[i],MKT[sym]["bars"][a[i]][3]
def features(entryts,price,side,decision_time,route):
 # May use only M5 that ended by decision_time. Entry may be later than
 # nominal H1 start because zero-trade M5 cannot fill.
 a=MKT["PENGUUSDT"]["t"]
 lo=bisect.bisect_left(a,entryts)
 hi=bisect.bisect_right(a,decision_time-M5)
 if hi-lo<3:return None
 xx=[(at,MKT["PENGUUSDT"]["bars"][at]) for at in a[lo:hi]]
 nowclose=xx[-1][1][3]
 direction=1 if side=="LONG" else -1
 progress=direction*(nowclose/price-1)
 mfe=max(0,max(direction*(b[1]/price-1) if direction==1 else (price/b[2]-1) for t,b in xx))
 mae=max(0,max((1-b[2]/price) if direction==1 else (b[1]/price-1) for t,b in xx))
 recent=[b for t,b in xx if t>=decision_time-3*HOUR]
 recent6=[b for t,b in xx if t>=decision_time-6*HOUR]
 if not recent or not recent6:return None
 vol=sum(b[4] for b in recent)
 flow=sum((b[5] if direction==1 else b[4]-b[5]) for b in recent)/vol if vol>0 else None
 first=max(xx[0][0],decision_time-3*HOUR)
 before=[b for t,b in xx if t<first]
 last3_dir=direction*(nowclose/before[-1][3]-1) if before else None
 btc_now=last_traded_close("BTCUSDT",decision_time)
 btc_then=last_traded_close("BTCUSDT",decision_time-6*HOUR)
 btc6=(btc_now[1]/btc_then[1]-1) if btc_now and btc_then else None
 # Regime is adverse when BTC price rises during a short or falls during a long.
 counterwind=(-direction*btc6) if btc6 is not None else None
 # Directional taker dominance AND price progress must align, not price-only.
 return {"progress":progress,"mfe":mfe,"mae":mae,
  "flow":flow,"last3":last3_dir,"counterwind_btc6":counterwind,
  "volume_traded_3h":vol,"active_5m":len(xx),
  "last_completed_traded_m5_ts":xx[-1][0]}

# All selected parameters explicit/frozen, and all reported without
# choosing the best on the forward 11. Variants are negative controls too.
POLICIES=(
 ("NATIVE",None,None,None),
 ("ADVERSE_3H_1PCT",3,"adverse",.01),
 ("ADVERSE_6H_1PCT",6,"adverse",.01),
 ("ADVERSE_6H_2PCT",6,"adverse",.02),
 ("NO_PROGRESS_3H",3,"no_progress",0),
 ("NO_PROGRESS_6H",6,"no_progress",0),
 ("NO_PROGRESS_12H",12,"no_progress",0),
 ("NO_PROGRESS_24H",24,"no_progress",0),
 ("NO_PROGRESS_6H_0P5",6,"no_progress",.005),
 ("NO_PROGRESS_12H_0P5",12,"no_progress",.005),
 ("NO_PROGRESS_6H_1PCT",6,"no_progress",.01),
 ("NO_PROGRESS_12H_1PCT",12,"no_progress",.01),
 ("CONTRARY_TAKER_6H",6,"taker",.46),
 ("CONTRARY_TAKER_12H",12,"taker",.46),
 ("NO_PROGRESS_AND_TAKER_6H",6,"and_taker",.005),
 ("NO_PROGRESS_AND_TAKER_12H",12,"and_taker",.005),
 ("NO_PROGRESS_AND_BTC_6H",6,"and_btc",.005),
 ("NO_PROGRESS_AND_BTC_12H",12,"and_btc",.005),
 ("THESIS_INVALIDATED_6H",6,"thesis",0),
 ("THESIS_INVALIDATED_12H",12,"thesis",0),
 ("NO_PROGRESS_6H_OR_BTC_12H",6,"composite",.005)
)
def triggers(policy,features,route):
 name,h,kind,threshold=policy
 if kind is None:return False
 f=features
 if kind=="adverse":return f["progress"]<=-threshold
 if kind=="no_progress":return f["progress"]<=threshold
 if kind=="taker":return f["flow"] is not None and f["flow"]<threshold
 if kind=="and_taker":return f["progress"]<=threshold and f["flow"] is not None and f["flow"]<.50
 if kind=="and_btc":return f["progress"]<=threshold and f["counterwind_btc6"] is not None and f["counterwind_btc6"]>.005
 if kind=="thesis":
  return f["progress"]<0 and f["flow"] is not None and f["flow"]<.5 and (
    f["counterwind_btc6"] is not None and f["counterwind_btc6"]>.005)
 if kind=="composite":
  return f["progress"]<=threshold or (
    f["progress"]<=.01 and f["counterwind_btc6"] is not None and f["counterwind_btc6"]>.015)
 raise ValueError("UNKNOWN_POLICY")
def phase(ts):
 if ts<Q2:return "development"
 if ts<Q3:return "validation"
 if ts<Q4:return "stress_Q3"
 return "forward_new"
def pnl_with_prior_partial(row,exit_ts,exit_px):
 direction=1 if row["side"]=="LONG" else -1
 entry=fl(row["source_entry_price"]);left=1.0;gross=0.0
 parts=json.loads(row["source_partial_model"] or "[]")
 for p in parts:
  if p["trade5m_ts"]>=exit_ts:continue
  frac=p["fraction_of_original"]
  if not 0<frac<=left+1e-8:raise ValueError("BAD_PARTIAL_FRACTION")
  gross+=frac*direction*(p["volume_aware_price"]/entry-1)
  left-=frac
 gross+=left*direction*(exit_px/entry-1)
 return gross

cases=[];diagnostics=[]
for row in source:
 if row["status"]!="VOLUME_AWARE_PRICE_MODEL_EVALUATED":continue
 route=row["route"];ts=int(row["entry_ts"])
 entry=int(row["first_entry_trade_ts"]);exitt=int(row["volume_aware_exit_5m_ts"])
 if not exitt>entry:raise ValueError("BAD_LIFECYCLE")
 bline=fl(row["source_native_net_30bps_pct"])+.3
 baseline=fl(row["net_30bps_pct"])/100+.003
 # Difference tolerances account CSV rounded 6 decimals in percentage.
 if abs((bline/100)-baseline)>.2:raise ValueError("BAD_BASELINE_GROSS")
 for pol in POLICIES:
  name,hrs,kind,threshold=pol
  reasons=[];exitkind="NATIVE_SOURCE_EXIT";features_used={}
  extime=exitt;price=fl(row["volume_aware_exit_price"])
  if hrs is not None:
   decisions=[(hrs,kind,threshold)]
   if kind=="composite":decisions=[(6,"no_progress",.005),(12,"and_btc",.01)]
   for duration,decisionkind,testtheta in decisions:
    decision=entry+duration*HOUR
    if decision>=exitt:continue
    f=features(entry,fl(row["source_entry_price"]),row["side"],decision,route)
    if f is None:continue
    used=triggers((name,duration,decisionkind,testtheta),f,route)
    if not used:continue
    fill=first_trade_after(decision)
    if fill is None or fill>=exitt:continue
    extime=fill;price=MKT["PENGUUSDT"]["bars"][fill][0]
    exitkind="EARLY_CAUSAL_MARKET_EXIT"
    features_used={k:round(v,6) if isinstance(v,(int,float)) else v for k,v in f.items()}
    reasons.append({"decision_time":decision,"executed_ts":fill,
      "decision_feature":features_used,"policy":name})
    break
  gross=pnl_with_prior_partial(row,extime,price)
  results={"id":row["id"],"cohort":row["cohort"],"route":route,
   "side":row["side"],"signal_entry_ts":ts,"execution_entry_ts":entry,
   "phase":phase(ts),"policy":name,"exit_model":exitkind,
   "native_exit_kind":row["source_exit_reason"],"exit_price":round(price,12),
   "exit_ts":extime,"native_exit_ts":exitt,
   "model_10bps_return_pct":round(100*(gross-.001),6),
   "model_30bps_return_pct":round(100*(gross-.003),6),
   "native_30bps_return_pct":fl(row["net_30bps_pct"]),
   "profit_delta_pct":round(100*gross-(fl(row["net_30bps_pct"])+.3),6),
   "reason":reasons}
  cases.append(results)
  if exitkind=="EARLY_CAUSAL_MARKET_EXIT":diagnostics.append(results)
def cohort(arr):
 n=len(arr)
 def win(fee):
  key="model_"+str(fee)+"bps_return_pct"
  a=[x[key] for x in arr]
  pos=sum(x>0 for x in a)
  return {f"{fee}bps_win_pct":round(100*pos/n,2) if n else None,
   f"{fee}bps_wins":pos,f"{fee}bps_mean_pct":round(statistics.mean(a),4) if n else None,
   f"{fee}bps_median_pct":round(statistics.median(a),4) if n else None,
   f"{fee}bps_sum_pct":round(sum(a),4)}
 return {"n":n,"early_exit_n":sum(x["exit_model"]=="EARLY_CAUSAL_MARKET_EXIT" for x in arr),
  **win(10),**win(30),"winner_to_loser30":sum(x["native_30bps_return_pct"]>0 and x["model_30bps_return_pct"]<=0 for x in arr),
  "loser_to_winner30":sum(x["native_30bps_return_pct"]<=0 and x["model_30bps_return_pct"]>0 for x in arr)}
agg=[]
for route in ROUTES:
 for ph in ("development","validation","stress_Q3","forward_new"):
  for name,hrs,kind,threshold in POLICIES:
   x=[r for r in cases if r["route"]==route and r["phase"]==ph and r["policy"]==name]
   if x:agg.append({"route":route,"phase":ph,"policy":name,**cohort(x)})
# Global across routes and phases but DO NOT claim independent samples:
for route in ("ALL","SHORT_V20","RECOVERY_V8","LONG_V64"):
 for name,hrs,kind,threshold in POLICIES:
  xs=[z for z in cases if z["policy"]==name and (route=="ALL" or z["route"]==route)]
  agg.append({"route":route,"phase":"ALL_PERIODS_RESEARCHED","policy":name,**cohort(xs)})
def savecsv(name,items):
 if not items:return
 cols=list(dict.fromkeys(k for item in items for k in item))
 with (OUT/name).open("w",encoding="utf-8-sig",newline="") as file:
  writer=csv.DictWriter(file,cols);writer.writeheader()
  for x in items:
   writer.writerow({k:json.dumps(v,ensure_ascii=False) if isinstance(v,(list,dict)) else v for k,v in x.items()})
savecsv("PRISM_NATIVE_M5_EARLY_EXIT_POLICY_GRID.csv",agg)
savecsv("PRISM_NATIVE_M5_EARLY_EXIT_ALL_CANDIDATE_SCENARIOS.csv",cases)
# Trace contains all gate decisions when early exits occurred; non-trigger
# cases can be independently recomputed from public M5 with same script.
summary={
 "schema":"disdex-prism3-causal-volume-aware-m5-exit-overlay/v1",
 "source":"pinned PENGU 116 native exits + 11 forward native exits; 123 executable candidates",
 "case_count":len(cases),"policies":[p[0] for p in POLICIES],
 "costs_bps":[10,30],
 "count_native_base":len([x for x in cases if x["policy"]=="NATIVE"]),
 "cohort_summary":agg,
 "causality":["Every feature uses only traded M5 bars that fully closed before decision time",
 "Execution uses first positive-volume M5 opening at or after decision time",
 "Native source stop executed first if its actual traded-volume stop trigger is earlier",
 "Native partial defense before early exit is weighted in PnL; preempted partial defense is not fabricated",
 "No policy is selected based on the forward data; all 21 policy variants are reported"],
 "caveats":["THIS IS RESEARCH PRICE MODEL, NOT SIGNED VENUE FILLS",
 "Taker buy volume from public M5 is an imperfect microstructure proxy",
 "Early exit requires an actual traded opening; missed trades and orderbook slippage unmodeled",
 "Signal admission, open position occupancy, portfolio shared Gross, funding and account DD unverified",
 "All datasets have been observed by the researcher, so no untouched OOS for strategy selection",
 "Tiny PENGU new-period sample; no win-rate confidence or live implementation claim"] }
(OUT/"PRISM_NATIVE_M5_EARLY_EXIT_POLICY_SUMMARY.json").write_text(
 json.dumps(summary,indent=2,sort_keys=True,ensure_ascii=False,allow_nan=False)+"\n",encoding="utf8")
print("EARLY_EXIT_GRID",len(cases),"POLICIES",len(POLICIES),"baseline",summary["count_native_base"],flush=True)
for route in ("SHORT_V20","RECOVERY_V8"):
 for p in ("validation","stress_Q3","forward_new"):
  z=[x for x in agg if x["route"]==route and x["phase"]==p]
  if not z:continue
  b=next(x for x in z if x["policy"]=="NATIVE")
  print("COHORT",route,p,"BASE",b["n"],b["30bps_win_pct"],b["30bps_mean_pct"],flush=True)
  for x in z:
   if x["policy"] in ("NO_PROGRESS_6H","NO_PROGRESS_6H_0P5","NO_PROGRESS_AND_TAKER_6H",
      "NO_PROGRESS_AND_BTC_6H","THESIS_INVALIDATED_6H","NO_PROGRESS_12H","NO_PROGRESS_6H_OR_BTC_12H"):
    print("  ",x["policy"],"WR",x["30bps_win_pct"],"MEAN",x["30bps_mean_pct"],
      "W2L",x["winner_to_loser30"],"L2W",x["loser_to_winner30"],"EARLY",x["early_exit_n"],flush=True)
