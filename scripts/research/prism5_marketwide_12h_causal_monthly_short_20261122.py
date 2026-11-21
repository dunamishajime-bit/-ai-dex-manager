#!/usr/bin/env python3
"""PRISM-V20-STRUCTURE v2: market-wide causal short-continuation probability.

Unlike overfitted 53-candidate labels, train a regularized probability model
on EVERY 12th PENGU hour with a completed 12h directional outcome.

- Target is only direction over NEXT 12 HOURS (>30bps price decrease), NOT
  probability of winning the native 24-72h STOP/trailing strategy.
- 12h non-overlap, monthly refit, >=24h label embargo and rolling 180d history.
- Every model's feature normalization is fitted ONLY on matured past rows.
- No lookahead in as-of features; no direct fit against 53 native trade outcomes.
- No "best" threshold search: predeclare 0.50 / 0.60 / 0.70 and report ALL.
- No Production code, real orders, STOP edits, owner change or GitHub master.
"""
from __future__ import annotations
import csv,datetime as dt,gzip,hashlib,json,math,statistics,sys
from collections import defaultdict,Counter
from pathlib import Path
import numpy as np
R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
W=Path(r"C:\Users\dis\Documents\DisDex_Research\WINRATE_DEEP_20261122")
OUT=W/"phase2_results"
PRE=W/"prebaseline_public_20250801_20250924"
POST=W/"forward_public_20261001_20261118"
H=3600_000
PIN="1657e173d250ad58f53e62f7bb0a3428fb405496"
FEATURES=("p_r3_atr","p_r6_atr","p_r24_atr","btc_r6","btc_r24","relative_r6",
 "flow_buy3","flow_buy6","lower_high6","lower_low6",
 "close_location","lower_wick","distance_to_6h_low_atr","efficiency6",
 "log_volume_ratio6_36","atr24")
THRESHOLDS=(0.5,0.6,0.7)
def load(sym):
 files=[
  PRE/(f"{sym}-1h-20250801-20250924"+("-RESEARCH_M5QA" if sym=="BTCUSDT" else "")+".jsonl.gz"),
  R/"aster-public-v3-h1"/f"{sym}-1h-20250924-20261001.jsonl.gz",
  POST/f"{sym}-1h-20261001-20261118.jsonl.gz"]
 out=[]
 for file in files:
  with gzip.open(file,"rt",encoding="utf8") as f:
   for line in f:
    a=json.loads(line)
    bar=[int(a[0]),float(a[1]),float(a[2]),float(a[3]),
         float(a[4]),float(a[5]),float(a[9])]
    if bar[6]<0 or bar[6]>bar[5]+1e-8:raise ValueError("BAD_TAKER_H1")
    out.append(bar)
 for i in range(1,len(out)):
  if out[i][0]-out[i-1][0]!=H:raise ValueError("H1_DATA_HOLE:"+sym)
 return np.array(out,dtype=float)
p=load("PENGUUSDT");b=load("BTCUSDT")
assert p.shape==b.shape and np.array_equal(p[:,0],b[:,0])
N=len(p)
idx={int(p[i,0]):i for i in range(N)}
CLOSE=4;OPEN=1;HIGH=2;LOW=3;VOL=5;BUY=6
def _ratio(arr,i,k):return arr[i,CLOSE]/arr[i-k,CLOSE]-1
def make_features(i):
 """Only completed H1 candles with index < i."""
 if i<98:raise ValueError("INSUFFICIENT_H1_WARMUP")
 e=i-1
 close=p[e,CLOSE]
 prev=p[e-24:e,CLOSE]
 true_range=np.maximum(p[e-23:e+1,HIGH]-p[e-23:e+1,LOW],
   np.maximum(abs(p[e-23:e+1,HIGH]-prev),abs(p[e-23:e+1,LOW]-prev)))
 atr=float(np.mean(true_range)/close)
 if not 0<atr<.5:raise ValueError("ATR_OUTSIDE_VALID")
 def flow(k):
  last=p[i-k:i];positive=last[:,VOL]>0
  if positive.sum()<max(1,k//2):return .5
  return float(last[positive,BUY].sum()/last[positive,VOL].sum())
 bars=p[i-7:i];old=p[i-12:i-6];last=p[e]
 r3,r6,r24=(_ratio(p,e,k) for k in (3,6,24))
 br6,br24=(_ratio(b,e,k) for k in (6,24))
 lower_high=int(max(bars[1:,HIGH])<max(old[:,HIGH]))
 lower_low=int(min(bars[1:,LOW])<min(old[:,LOW]))
 range_=max(last[HIGH]-last[LOW],1e-12)
 eps=[abs(p[e-j,CLOSE]-p[e-j-1,CLOSE]) for j in range(6)]
 efficiency=abs(p[e,CLOSE]-p[e-6,CLOSE])/max(sum(eps),1e-12)
 volumes6=float(p[i-6:i,VOL].sum())
 volumes36=float(p[i-42:i-6,VOL].mean())
 ratio=volumes6/6/max(volumes36,1e-12)
 x=np.array([
  r3/atr,r6/atr,r24/atr,
  br6,br24,r6-br6,
  flow(3),flow(6),lower_high,lower_low,
  (last[CLOSE]-last[LOW])/range_,
  (min(last[OPEN],last[CLOSE])-last[LOW])/range_,
  (last[CLOSE]-min(p[i-7:i-1,LOW]))/(close*atr),
  efficiency,
  math.log1p(ratio),atr],dtype=float)
 if not np.isfinite(x).all():raise ValueError("NONFINITE_FEATURE")
 return x
features=[None]*N
for i in range(98,N):features[i]=make_features(i)
# Price-only directional observation, not a signed fill.
# For a hypothetical order entered at H1 opening at i, the 12h outcome
# is close of H1 i+11. Labels become fully matured after end of i+11 H1.
y=[None]*N
for i in range(98,N-12):
 if p[i,VOL]>0 and np.any(p[i:i+12,VOL]>0):
  y[i]=int(p[i+11,CLOSE]/p[i,OPEN]-1 < -.003)
def sigmoid(z):return 1/(1+np.exp(-np.clip(z,-35,35)))
def train(train_rows):
 X=np.array([features[j] for j in train_rows],dtype=float)
 yy=np.array([y[j] for j in train_rows],dtype=float)
 center=np.median(X,axis=0)
 spread=np.maximum(np.percentile(X,75,axis=0)-np.percentile(X,25,axis=0),.015)
 x=np.column_stack((np.ones(len(X)),np.clip((X-center)/spread,-5,5)))
 # Fixed strong shrinkage, not hyperparameter tuning.
 lam=np.array([.1]+[12.]*len(FEATURES))
 prob=(yy.sum()+4)/(len(yy)+8)
 beta=np.zeros(x.shape[1]);beta[0]=math.log(prob/(1-prob))
 for _ in range(35):
  estimates=sigmoid(x@beta)
  grad=x.T@(yy-estimates)-lam*beta
  hessian=x.T@(x*(estimates*(1-estimates))[:,None])+np.diag(lam)
  delta=np.linalg.solve(hessian,grad)
  beta+=np.clip(delta,-.5,.5)
  if np.linalg.norm(delta)<1e-6:break
 return beta,center,spread
cache={}
pred={}
train_meta={}
for i in range(98,N):
 ts=int(p[i,0])
 # Freeze each monthly coefficient snapshot. All training data are from
 # prior 180 days AND the target label matured >=24h before the snapshot.
 day=dt.datetime.fromtimestamp(ts/1000,dt.timezone.utc)
 month=(day.year,day.month)
 if month not in cache:
  first_month=int(dt.datetime(day.year,day.month,1,tzinfo=dt.timezone.utc).timestamp()*1000)
  # 24h embargo after 12h horizon maturity, strict:
  cutoff=first_month-36*H
  tr=[j for j in range(98,i) if j%12==0 and
      first_month-180*24*H<=p[j,0] and p[j,0]+12*H<=cutoff and y[j] is not None]
  if len(tr)<150:
   cache[month]=None
   train_meta[month]={"n":len(tr),"model":"INSUFFICIENT_TRAIN_HISTORY",
    "first_train_ts":int(p[tr[0],0]) if tr else None,"last_matured_label_ts":int(p[tr[-1],0]+12*H) if tr else None}
  else:
   co=train(tr);cache[month]=co
   train_meta[month]={"n":len(tr),"model":"FROZEN_SHRUNK_LOGIT_12H",
    "first_train_ts":int(p[tr[0],0]),
    "last_matured_label_ts":int(p[tr[-1],0]+12*H),
    "month_start":first_month,"training_end_cutoff":cutoff}
 co=cache[month]
 if co is None:continue
 beta,center,spread=co
 row=np.r_[1.,np.clip((features[i]-center)/spread,-5,5)]
 q=float(sigmoid(np.dot(row,beta)))
 if not 0<=q<=1:raise ValueError("MODEL_PROBABILITY_NOT_VALID")
 if train_meta[month]["last_matured_label_ts"]>ts-24*H:
  raise ValueError("FUTURE_LABEL_LEAK")
 pred[int(ts)]={"prob_decline_12h":q,"train":train_meta[month],
                "price_outcome_y12h":y[i]}
def roc_auc(a):
 known=[x for x in a if x["outcome"] is not None]
 pos=[x["prob"] for x in known if x["outcome"]==1]
 neg=[x["prob"] for x in known if x["outcome"]==0]
 if not pos or not neg:return None
 return sum((p>q)+.5*(p==q) for p in pos for q in neg)/(len(pos)*len(neg))
quality=[]
for month in sorted(cache):
 group=[{"prob":val["prob_decline_12h"],"outcome":val["price_outcome_y12h"]}
  for ts,val in pred.items() if dt.datetime.fromtimestamp(ts/1000,dt.timezone.utc).year==month[0]
   and dt.datetime.fromtimestamp(ts/1000,dt.timezone.utc).month==month[1]]
 completed=[x for x in group if x["outcome"] is not None]
 if completed:
  quality.append({"period":f"{month[0]}-{month[1]:02d}","sample_n":len(completed),
   "direction_hit_frequency":round(statistics.mean(z["outcome"] for z in completed),4),
   "brier_score":round(statistics.mean((z["prob"]-z["outcome"])**2 for z in completed),6),
   "auc":round(roc_auc(completed),5) if roc_auc(completed) is not None else None,
   "training_n":train_meta[month]["n"]})
def exits(pth):
 return [json.loads(line) for line in pth.open(encoding="utf8") if line.strip()]
PERIODS=(
 ("PRE_2025_AUG_SEP",OUT/"native_lifecycle_prebaseline/pengu-native-lifecycle-modeled-exits.jsonl"),
 ("BASE_2025_2026",R/"PENGU_NATIVE_LIFECYCLE_EXIT_20261109/pengu-native-lifecycle-modeled-exits.jsonl"),
 ("POST_2026_OCT_NOV",OUT/"native_lifecycle_forward/pengu-native-lifecycle-modeled-exits.jsonl"))
candidates=[]
for period,file in PERIODS:
 for x in exits(file):
  if x["route"]!="SHORT_V20":continue
  score=pred.get(x["entryTs"])
  candidates.append({"period":period,"id":x["id"],"entryTs":x["entryTs"],
    "net30_pct":100*(x["rawReturn"]-.003),
    "win30":x["rawReturn"]>.003,
    "p_short_decline_12h":score["prob_decline_12h"] if score else None,
    "train_cutoff":score["train"]["last_matured_label_ts"] if score else None,
    "price_outcome_12h":score["price_outcome_y12h"] if score else None,
    "source_short_native_pnl_not_reestimated":True})
assert len(candidates)==53
results=[]
for period in ("PRE_2025_AUG_SEP","BASE_2025_2026","POST_2026_OCT_NOV","ALL_SEEN"):
 for t in THRESHOLDS:
  rr=[x for x in candidates if period=="ALL_SEEN" or x["period"]==period]
  avail=[x for x in rr if x["p_short_decline_12h"] is not None]
  kept=[x for x in avail if x["p_short_decline_12h"]>=t]
  dropped=[x for x in avail if x["p_short_decline_12h"]<t]
  vals=[x["net30_pct"] for x in kept];vwin=sum(z>0 for z in vals)
  profits=sum(max(0,z) for z in vals);losses=sum(max(0,-z) for z in vals)
  results.append({"period":period,"threshold":t,
   "original_n":len(rr),"model_scored_n":len(avail),"unscored_n":len(rr)-len(avail),
   "retained_n":len(kept),"retained_win_n":vwin,
   "retained_win_pct":round(100*vwin/len(kept),2) if kept else None,
   "retained_mean_net30_pct":round(statistics.mean(vals),4) if vals else None,
   "retained_price_pf30":round(profits/losses,4) if losses>0 else None,
   "excluded_winners":sum(x["win30"] for x in dropped),
   "excluded_losers":sum(not x["win30"] for x in dropped)})
def wcsv(path,records):
 if not records:return
 cols=list(dict.fromkeys(k for x in records for k in x))
 with path.open("w",encoding="utf-8-sig",newline="") as f:
  w=csv.DictWriter(f,cols);w.writeheader();w.writerows(records)
wcsv(OUT/"PRISM5_H1_12H_MONTHLY_CAUSAL_CLASSIFIER_CANDIDATES.csv",candidates)
wcsv(OUT/"PRISM5_H1_12H_MONTHLY_CAUSAL_CLASSIFIER_ABLATIONS.csv",results)
wcsv(OUT/"PRISM5_H1_12H_MONTHLY_CAUSAL_CLASSIFIER_CALIBRATION.csv",quality)
report={"schema":"prism5-all-H1-causal-monthly-direct-12h-short/v1",
 "target":"PENGU next 12h price-direction decline after 30bps, not 72h native win",
 "source_pin":PIN,"feature_names":FEATURES,"candidate_count":len(candidates),
 "monthly_model_quality":quality,"cohort_winrate":results,
 "monthly_training_cutoffs":{f"{a[0]}-{a[1]:02d}":v for a,v in train_meta.items()},
 "method":"Rolling 180d, disjoint 12h labeled rows, L2 fixed 12, 24h after label maturity embargo",
 "limitations":[
  "No labels from candidate native 53 outcomes are ever used during training",
  "Market 12h directional target is different from pinned native 24-72h trade profit",
  "PRE baseline may be unscored due to insufficient training; do not infer improvements",
  "The three periods were studied before this experiment so not blind OOS",
  "Order book, live STOP, shared Gross, real funding and future execution slippage omitted",
  "This is a market-wide learner diagnostic, not a completed Production-ready redesign"
 ]}
(OUT/"PRISM5_H1_12H_MONTHLY_CAUSAL_CLASSIFIER_SUMMARY.json").write_text(
 json.dumps(report,indent=2,ensure_ascii=False,sort_keys=True,allow_nan=False)+"\n",encoding="utf8")
print("PRISM5_ALL_H1_MONTHLY_LEARNER_COMPLETE",len(pred),"scored_hourly_bars",
 "MONTHLY_MODELS",sum(v is not None for v in cache.values()),flush=True)
for x in results:
 if x["threshold"]==.60:
  print("PENGU_NATIVE_COHORT",x,flush=True)
for x in quality[-6:]:
 print("MARKET_12H_CALIBRATION",x,flush=True)
