#!/usr/bin/env python3
"""PRISM II PENGU frozen native-exit route classifier, chronological falsification.

Uses exact PENGU pinned source features and native function exit/partial model.
Hyperparameters and policies are fixed in code, never tuned on forward 11 rows.
No execution, order or production changes. 70/80 targets not assumed met.
"""
from __future__ import annotations
import csv,datetime as dt,json,math,statistics,sys
from collections import Counter,defaultdict
from pathlib import Path
import numpy as np
ROOT=Path(r"C:\tmp\disdex-bt-20251001-20261001")
WORK=Path(sys.argv[1]) if len(sys.argv)>1 else Path(r"C:\Users\dis\Documents\DisDex_Research\WINRATE_DEEP_20261122")
OUT=WORK/"phase2_results"
PINS=json.loads((OUT/"PENGU_ORIGINAL_116_NATIVE_ASOF_FEATURES.json").read_text(encoding="utf8"))
FORWARD=json.loads((OUT/"PENGU_PINNED_FORWARD_SIGNALS.json").read_text(encoding="utf8"))
assert PINS["data_source"]=="NATIVE_PINNED_H1"
assert len(PINS["candidates"])==116 and len(FORWARD["signals"])==11
def readlines(p):return [json.loads(x) for x in p.open(encoding="utf8") if x.strip()]
exits_old=readlines(ROOT/"PENGU_NATIVE_LIFECYCLE_EXIT_20261109"/"pengu-native-lifecycle-modeled-exits.jsonl")
exits_new=readlines(OUT/"native_lifecycle_forward"/"pengu-native-lifecycle-modeled-exits.jsonl")
assert len(exits_old)==116 and len(exits_new)==11
def partial_weighted(e):
 sign=1 if e["side"]=="LONG" else -1
 left=1.0;pnl=0.0
 for event in e["partialEvents"]:
  if not 0<event["closedQuantityFractionOfCurrent"]<=1:raise ValueError("BAD_PARTIAL_RATIO")
  amount=left*event["closedQuantityFractionOfCurrent"]
  pnl+=amount*sign*(event["price"]/e["entryPrice"]-1)
  left-=amount
 if abs(left-e["remainingQuantityFraction"])>1e-9:raise ValueError("PARTIAL_MISMATCH")
 pnl+=left*sign*(e["exitPrice"]/e["entryPrice"]-1)
 return pnl
def index_exits(rows):
 table={}
 for x in rows:
  key=(x["entryTs"],x["side"],x["route"])
  if key in table:raise ValueError("DUPLICATE_EXIT_KEY")
  table[key]=x
 return table
exits=index_exits(exits_old+exits_new)
MATURE=24*3600000
SOURCE_FEATURES=("p72","p24","b24","rel24","btcEma168Dist","volRatio","atr24","rsi14")
def add_row(sig,origin):
 key=(sig["entryTs"],sig["side"],sig["route"])
 e=exits.get(key)
 if not e:raise ValueError("NATIVE_EXIT_MISSING:"+str(key))
 f=sig["features"]
 x=np.array([float(f[k]) for k in SOURCE_FEATURES])
 if not np.all(np.isfinite(x)):raise ValueError("INVALID_PIN_FEATURES")
 gross=partial_weighted(e)
 return {"id":str(e["id"]),"source":origin,"route":sig["route"],
 "side":sig["side"],"entryTs":int(sig["entryTs"]),"exitTs":int(e["exitTs"]),
 "features":x,"gross":gross,"exitReason":e["exitReason"],"partial_n":len(e["partialEvents"])}
data=[add_row(s,"ORIGINAL_2025_2026") for s in PINS["candidates"]]+[
 add_row(s,"FORWARD_2026_10_11") for s in FORWARD["signals"]]
data.sort(key=lambda x:(x["entryTs"],x["id"]))
assert len(data)==127
FOLDS=[
 ("Q2_2026",int(dt.datetime(2026,4,1,tzinfo=dt.timezone.utc).timestamp()*1000),
  int(dt.datetime(2026,7,1,tzinfo=dt.timezone.utc).timestamp()*1000)),
 ("Q3_2026",int(dt.datetime(2026,7,1,tzinfo=dt.timezone.utc).timestamp()*1000),
  int(dt.datetime(2026,10,1,tzinfo=dt.timezone.utc).timestamp()*1000)),
 ("NEW_2026_10_11",int(dt.datetime(2026,10,1,tzinfo=dt.timezone.utc).timestamp()*1000),
  int(dt.datetime(2026,11,18,tzinfo=dt.timezone.utc).timestamp()*1000))
]
ROUTES=("SHORT_V20","RECOVERY_V8","LONG_V64")
THRESHOLDS=(0.60,0.70,0.80)
FEE=(10,30)
def logistic(z):return 1/(1+np.exp(-np.clip(z,-45,45)))
def fitted(train,cut,fee):
 y=np.array([int(x["gross"]>fee/10000) for x in train],dtype=float)
 n=len(y)
 prior=(y.sum()+4)/(n+8)
 if n<12:
  return lambda rows: np.full(len(rows),prior,dtype=float),{"n":n,"mode":"INSUFFICIENT_TRAIN_ROUTE_PRIOR_ONLY","prior":float(prior)}
 X=np.array([z["features"] for z in train],dtype=float)
 median=np.median(X,axis=0)
 scale=np.maximum(np.percentile(X,75,axis=0)-np.percentile(X,25,axis=0),1e-4)
 M=np.column_stack((np.ones(n),np.clip((X-median)/scale,-5,5)))
 days=np.array([(cut-x["entryTs"])/86400000 for x in train])
 w=np.exp(-math.log(2)*days/180)
 w=w/max(w.sum(),1e-9)*n
 lam=np.array([0]+[12.0]*len(SOURCE_FEATURES),dtype=float)
 beta=np.zeros(M.shape[1]);beta[0]=math.log(prior/(1-prior))
 for _ in range(40):
  p=logistic(M@beta);weights=w*p*(1-p)
  grad=M.T@(w*(y-p))-lam*beta
  hess=(M.T*weights)@M+np.diag(lam+1e-8)
  move=np.linalg.solve(hess,grad)
  move=np.clip(move,-.5,.5)
  beta+=.5*move
  if np.linalg.norm(move)<1e-6:break
 def forecast(rows):
  if not rows:return np.array([])
  V=np.array([z["features"] for z in rows],dtype=float)
  return logistic(np.column_stack((np.ones(len(V)),np.clip((V-median)/scale,-5,5)))@beta)
 return forecast,{"n":n,"mode":"STRONG_SHRINKAGE_ROUTE_LOGISTIC_FIXED_L2_12","prior":float(prior)}
def wilson(w,n):
 if not n:return [None,None]
 z=1.9599639845;p=w/n
 D=1+z*z/n;ctr=(p+z*z/(2*n))/D
 half=z*math.sqrt(p*(1-p)/n+z*z/(4*n*n))/D
 return [round(100*(ctr-half),2),round(100*(ctr+half),2)]
rows=[];trace=[];fingerprints=[]
for route in ROUTES:
 for phase,cut,end in FOLDS:
  train=[x for x in data if x["route"]==route and x["entryTs"]<cut and x["exitTs"]+MATURE<cut]
  test=[x for x in data if x["route"]==route and cut<=x["entryTs"]<end]
  if not test:continue
  for fee in FEE:
   model,metadata=fitted(train,cut,fee)
   prob=model(test)
   assert len(prob)==len(test)
   assert np.all((prob>=0)&(prob<=1))
   for x,p in zip(test,prob):
    trace.append({"id":x["id"],"route":route,"period":phase,"source":x["source"],
      "entry_ts":x["entryTs"],"exit_ts":x["exitTs"],"net_return_pct":round(100*(x["gross"]-fee/10000),4),
      "p_win":round(float(p),5),"fee_bps":fee,
      "model":metadata["mode"],"trained_mature_n":metadata["n"],
      "winner":bool(x["gross"]>fee/10000),
      "features":{key:float(x["features"][i]) for i,key in enumerate(SOURCE_FEATURES)}})
   for theta in (0.0,)+THRESHOLDS:
    kept=[x for x,p in zip(test,prob) if p>=theta]
    n=len(kept);w=sum(x["gross"]>fee/10000 for x in kept)
    b=sum(x["gross"]>fee/10000 for x in test)
    rows.append({"route":route,"phase":phase,"fee_bps":fee,"model":metadata["mode"],
      "train_mature_n":metadata["n"],"all_candidates":len(test),"raw_win_pct":round(100*b/len(test),2),
      "threshold":theta,"kept_n":n,"kept_wins":w,
      "kept_win_pct":round(100*w/n,2) if n else None,
      "wilson95":wilson(w,n),"kept_fraction":round(n/len(test),4),
      "mean_net_pct":round(100*statistics.mean(x["gross"]-fee/10000 for x in kept),4) if kept else None,
      "discarded_winners":sum(x["gross"]>fee/10000 for x,p in zip(test,prob) if p<theta),
      "discarded_losers":sum(x["gross"]<=fee/10000 for x,p in zip(test,prob) if p<theta),
      "target80_observed":n>=10 and 100*w/n>=80})
 for phase,cut,end in FOLDS:
  cohort=[x for x in data if x["route"]==route and cut<=x["entryTs"]<end]
  if not cohort:continue
  win=[x for x in cohort if x["gross"]>.003];loss=[x for x in cohort if x["gross"]<=.003]
  for j,f in enumerate(SOURCE_FEATURES):
   fingerprints.append({"route":route,"phase":phase,"feature":f,
    "n":len(cohort),"wins":len(win),"losses":len(loss),
    "median_winner":round(float(np.median([x["features"][j] for x in win])),5) if win else None,
    "median_loser":round(float(np.median([x["features"][j] for x in loss])),5) if loss else None})
def tocsv(name,data):
 if not data:return
 cols=list(dict.fromkeys(key for record in data for key in record))
 with (OUT/name).open("w",encoding="utf-8-sig",newline="") as f:
  w=csv.DictWriter(f,cols);w.writeheader()
  for record in data:
   w.writerow({k:json.dumps(v) if isinstance(v,(list,dict)) else v for k,v in record.items()})
tocsv("PRISM_PENGU_NATIVE_STRONG_SHRINKAGE_OOS_COHORTS.csv",rows)
tocsv("PRISM_PENGU_NATIVE_STRONG_SHRINKAGE_PREDICTIONS.csv",trace)
tocsv("PRISM_PENGU_NATIVE_ROUTE_WIN_LOSS_FEATURE_FINGERPRINTS.csv",fingerprints)
summary={
 "schema":"disdex-prism-pengu-native-strong-shrinkage/v1",
 "native_original_cands":116,"new_pinned_cands":11,
 "features":SOURCE_FEATURES,"policy":{"trained_until":"each fold start; exit+24h matured",
  "time_splits":"2026-Q2 / 2026-Q3 / forward Oct-Nov","fixed_prior":"Beta(4,4)",
  "model":"route-specific 8 feature, shrink L2=12 logistic, half-life180d",
  "thresholds":THRESHOLDS,"fee":FEE},
 "results":rows,
 "limitations":["Native modeled, not venue executions; partial defense is weighted, funding/portfolio Gross omitted",
 "Signal-source pinned entry/exit is verified 116/116, price provider H1/M5 disagreement unresolved",
 "11 forward samples were previously examined by the researcher; no blind claim can be made",
 "No new entry rule has been independently proven at 80% and sufficient volume",
 "Winners filtered by selective criteria may have worse profit or DD"] }
(OUT/"PRISM_PENGU_NATIVE_STRONG_SHRINKAGE_OOS_SUMMARY.json").write_text(
 json.dumps(summary,ensure_ascii=False,sort_keys=True,indent=2,allow_nan=False)+"\n",encoding="utf8")
print("PINNED_NATIVE_OOS_CLASSIFIER_PASS",len(data),"rows",len(rows),"predictions",len(trace),flush=True)
for r in rows:
 if r["fee_bps"]==30 and r["phase"] in ("Q3_2026","NEW_2026_10_11"):
  print("NATIVE_OOS30",r["route"],r["phase"],"theta",r["threshold"],"n",r["kept_n"],
        "WR",r["kept_win_pct"],"AVG",r["mean_net_pct"],"REJ_W",r["discarded_winners"],flush=True)
