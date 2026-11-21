#!/usr/bin/env python3
"""PRISM II — market-continuation memory from analog H1 price episodes.

All analog futures must have matured BEFORE the candidate entry.
Use same-symbol price analogs (not backtested strategy fills) to detect whether
continuation/reversal survives in the recent market regime. Research only.
"""
from __future__ import annotations
import bisect,csv,datetime as dt,gzip,hashlib,json,math,statistics,sys
from collections import Counter,defaultdict
from pathlib import Path
import numpy as np

ROOT=Path(r"C:\tmp\disdex-bt-20251001-20261001")
INPUT=Path(sys.argv[1]) if len(sys.argv)>1 else Path(r"C:\Users\dis\Documents\DisDex_Research\WINRATE_DEEP_20261122\phase2_results\prism_h1_source_closed_entry_features.jsonl")
OUT=Path(sys.argv[2]) if len(sys.argv)>2 else INPUT.parent
OUT.mkdir(parents=True,exist_ok=True)
START=dt.datetime(2025,10,1,tzinfo=dt.timezone.utc)
END=dt.datetime(2026,10,1,tzinfo=dt.timezone.utc)
B=3600000
ROUTES=("V4","Q102","PENGU","IDLE","HYPE","FET","V52")
HOURS=(24,72)
SOURCE=ROOT/"aster-public-v3-h1"
K=25
LOOKBACK_D=120
DECAY_D=45
SCALES=np.array([.05,.10,.20,.05,.12,.018],dtype=float)
RULES=("baseline","continuation_24h","continuation_72h","both_24h_72h",
       "continuation_72h_prob55","continuation_72h_prob60")
raw=[json.loads(s) for s in INPUT.open(encoding="utf-8")]
by_sym=defaultdict(list)
for row in raw:by_sym[row["symbol"]].append(row)
btc_fn=list(SOURCE.glob("BTCUSDT-1h-*.jsonl.gz"))
if len(btc_fn)!=1:raise ValueError("MISSING_UNIQUE_BTC_DATA")

def load(file):
 vals={}
 with gzip.open(file,"rt",encoding="utf8") as source:
  for line in source:
   d=json.loads(line);t=int(d[0]);v=(float(d[1]),float(d[4]))
   if t in vals and vals[t]!=v:raise ValueError("H1_DUPLICATE_SOURCE")
   vals[t]=v
 return vals

btc=load(btc_fn[0])
analog_corpora={};docs={}
for sym,signals in by_sym.items():
 files=list(SOURCE.glob(f"{sym}-1h-*.jsonl.gz"))
 if len(files)!=1:continue
 market=load(files[0])
 ts=sorted(market)
 records=[]
 for i in range(73,len(ts)-73):
  at=ts[i+1];last=ts[i]
  if at%B!=0:raise ValueError("NON_HOURLY_ASSET")
  # Fully confirmed H1 up to the previous hour, plus verified future OPEN at +72h.
  if last-ts[i-72]!=72*B or ts[i+73]-ts[i+1]!=72*B:continue
  if any((ts[i-h] not in btc) for h in (0,6,24,72)):continue
  if ts[i]-ts[i-72] != 72*B:continue
  o=market[at][0];c=market[last][1]
  if not o>0:continue
  cur=np.array([
   c/market[ts[i-6]][1]-1,
   c/market[ts[i-24]][1]-1,
   c/market[ts[i-72]][1]-1,
   btc[last][1]/btc[ts[i-24]][1]-1,
   btc[last][1]/btc[ts[i-72]][1]-1,
   np.std(np.diff(np.log(np.asarray([market[t][1] for t in ts[i-24:i+1]],dtype=float))))
  ],dtype=float)
  if not np.all(np.isfinite(cur)):continue
  # Sample every 6h to reduce, but not eliminate, overlapping return-label dependence.
  if (at//B)%6:continue
  future={str(h):market.get(at+h*B,(None,None))[0]/o-1
    for h in HOURS if at+h*B in market and market[at+h*B][0]>0}
  if len(future)!=len(HOURS):continue
  records.append((at,cur,future))
 analog_corpora[sym]=records
 docs[sym]={"samples":len(records),"start":records[0][0] if records else None,
 "end":records[-1][0] if records else None}
print("ANALOG_CORPORA",json.dumps({k:v["samples"] for k,v in docs.items()},ensure_ascii=False)[:2500],flush=True)
def fnum(n):return float(n) if n is not None else None

def calc(row):
 sym=row["symbol"];records=analog_corpora.get(sym,[])
 t=row["entryTs"];ft=row["features"]
 side=1 if row["side"]=="LONG" else -1
 q=np.asarray([side*ft["aligned_sym6"],side*ft["aligned_sym24"],
    side*ft["aligned_sym72"],ft["btc_r24"],ft["btc_r72"],ft["sym_vol24"]])
 # Convert aligned to unsigned underlying return, exactly the analog feature definition.
 valid=[r for r in records if t-LOOKBACK_D*24*B<=r[0] and r[0]+72*B<=t]
 if len(valid)<10:return None
 arr=np.asarray([v[1] for v in valid])
 distance=np.sum(((arr-q)/SCALES)**2,axis=1)
 ix=np.argsort(distance)[:K]
 ds=distance[ix];match=[valid[i] for i in ix]
 ages=np.asarray([(t-r[0])/(24*B) for r in match])
 weights=np.exp(-np.minimum(ds,200)/8)*np.exp(-ages/DECAY_D)
 eff=(weights.sum()**2)/max(1e-16,float((weights*weights).sum()))
 if not weights.sum()>0:return None
 ret24=np.asarray([side*r[2]["24"] for r in match])
 ret72=np.asarray([side*r[2]["72"] for r in match])
 return {"analogs":len(valid),"neighbors":len(match),
 "effective_n":round(float(eff),3),"mean24":float(np.dot(weights,ret24)/weights.sum()),
 "mean72":float(np.dot(weights,ret72)/weights.sum()),
 "p24":float(np.dot(weights,(ret24>.003))/weights.sum()),
 "p72":float(np.dot(weights,(ret72>.003))/weights.sum()),
 "median72":float(np.median(ret72)),
 "mean_distance":round(float(np.dot(weights,ds)/weights.sum()),4),
 "max_analog_maturity":max(z[0]+72*B for z in match)}
def decide(rule,a):
 if rule=="baseline":return True
 if a is None or a["effective_n"]<4:return False
 if rule=="continuation_24h":return a["mean24"]>0
 if rule=="continuation_72h":return a["mean72"]>0
 if rule=="both_24h_72h":return a["mean24"]>0 and a["mean72"]>0
 if rule=="continuation_72h_prob55":return a["p72"]>=.55 and a["mean72"]>0
 if rule=="continuation_72h_prob60":return a["p72"]>=.60 and a["mean72"]>0
 raise ValueError("UNKNOWN_RULE")

scores=[]
for x in raw:
 a=calc(x)
 if a and a["max_analog_maturity"]>x["entryTs"]:raise ValueError("ANALOG_FUTURE_LEAK")
 scores.append({**{k:x[k] for k in ("id","strategy","route","symbol","side","entryTs","phase","gross")},
  "analog":a,"keep":{p:decide(p,a) for p in RULES}})
def stats(rows,cost):
 n=len(rows);returns=[r["gross"]-cost/10000 for r in rows]
 return {"n":n,"win_pct":round(100*sum(z>0 for z in returns)/n,2) if n else None,
  "mean_pct":round(100*statistics.mean(returns),4) if n else None,
  "sum_fixed_notional_pct":round(100*sum(returns),3)}
results=[]
for s in ROUTES:
 for phase in ("development","validation","post_validation"):
  group=[x for x in scores if x["strategy"]==s and x["phase"]==phase]
  if not group:continue
  for cost in (10,30):
   base=stats(group,cost)
   for p in RULES:
    kept=[x for x in group if x["keep"][p]]
    out=stats(kept,cost)
    rejected=[x for x in group if not x["keep"][p]]
    results.append({"runner":s,"period":phase,"fee_bps":cost,"policy":p,
      "baseline_n":base["n"],"baseline_win_pct":base["win_pct"],"baseline_mean_pct":base["mean_pct"],
      "kept_n":out["n"],"kept_win_pct":out["win_pct"],"kept_mean_pct":out["mean_pct"],
      "kept_fixed_notional_sum_pct":out["sum_fixed_notional_pct"],
      "retained_fraction":round(len(kept)/len(group),4),
      "rejected_winners":sum(x["gross"]>cost/10000 for x in rejected),
      "rejected_losers":sum(x["gross"]<=cost/10000 for x in rejected)})
routes=[]
for (s,route,phase),group in sorted(
 ((k,v) for k,v in defaultdict(list,{(s,route,phase):[
 x for x in scores if x["strategy"]==s and x["route"]==route and x["phase"]==phase]
 for s,route in sorted({(x["strategy"],x["route"]) for x in scores})
 for phase in ("development","validation","post_validation")}).items() if v),
 key=lambda z:z[0]):
 for policy in RULES:
  a=[x for x in group if x["keep"][policy]]
  out=stats(a,30);base=stats(group,30)
  routes.append({"runner":s,"route":route,"period":phase,"policy":policy,
    "n_baseline":base["n"],"baseline_win30":base["win_pct"],
    "n":out["n"],"win30":out["win_pct"],"mean30":out["mean_pct"],
    "retained":round(len(a)/len(group),3)})
def writecsv(name,rows):
 if not rows:return
 with (OUT/name).open("w",encoding="utf-8-sig",newline="") as file:
  writer=csv.DictWriter(file,list(rows[0]));writer.writeheader();writer.writerows(rows)
writecsv("prism_analog_regime_all_runner_results.csv",results)
writecsv("prism_analog_regime_route_results.csv",routes)
(OUT/"prism_analog_regime_candidate_trace.json").write_text(json.dumps({
 "schema":"disdex-prism-market-analog-continuation/v1","data":scores,
 "assumptions":[
 "All analog entry states use H1 closes before the analog timestamp",
 "Analog historical price outcomes are used only when u+72 hours <= signal t",
 "120-day historical analogs; every-six-hour samples; k25 distance; recency half-life45d",
 "Similarity is fixed from predeclared scale vector and no sampled signal outcomes from future",
 "No labeling for LIVE market orders, correct native STOPs, funding, slippage, DD or account occupancy",
 "Analog memory uses the same symbol's historical prices, not the Runner's own realized trade history",
 "Overlapping 6h analog samples are not independent; precision estimates can be inflated",
 "Research period previously investigated, not blind fresh holdout; no Production deployment"]
 },ensure_ascii=False,separators=(",",":"),allow_nan=False)+"\n",encoding="utf8")
print("ANALOG_COMPLETE",len(scores),"features_present",sum(x["analog"] is not None for x in scores),
 "scored_policies",len(results),flush=True)
for x in results:
 if x["period"]=="post_validation" and x["fee_bps"]==30 and x["policy"] in ("baseline","continuation_72h","both_24h_72h","continuation_72h_prob55"):
  print("LATE_30",x["runner"],x["policy"],"N",x["kept_n"],"WR",x["kept_win_pct"],
   "MEAN",x["kept_mean_pct"],"REJWIN",x["rejected_winners"],flush=True)
for x in routes:
 if x["route"] in ("REC_Y06_REV_D0_T72","IDLE_JUP_RELATIVE_SHORT","RECOVERY_V8","SHORT_V20") and x["period"]=="post_validation":
  if x["policy"] in ("baseline","continuation_72h","both_24h_72h","continuation_72h_prob55"):
   print("ROUTE_LATE",x,flush=True)
