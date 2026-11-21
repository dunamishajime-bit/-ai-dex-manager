#!/usr/bin/env python3
"""Causal walk-forward rejection study, never a LIVE trading gate.

All scored signal inputs are time-frozen before entry; realized outcome may
enter later training only after exit + 24h embargo. Compare candidate-only
price outcomes separately from actual portfolio-admitted, funded, costed fills.
"""
from __future__ import annotations
import csv,datetime as dt,json,math,statistics,sys
from collections import Counter,defaultdict
from pathlib import Path
import winrate_route_forensics_20261122 as f

OUT=Path(sys.argv[1]) if len(sys.argv)>1 else f.OUT
OUT.mkdir(parents=True,exist_ok=True)
MSDAY=86400*1000
EMBARGO=24*3600000
LOOKBACK=180*MSDAY
VAL=int(dt.datetime(2026,4,1,tzinfo=dt.timezone.utc).timestamp()*1000)
TEST=int(dt.datetime(2026,7,1,tzinfo=dt.timezone.utc).timestamp()*1000)
END=int(f.END.timestamp()*1000)
STRATEGIES=f.SCOPE
POLICIES=("baseline","triple_countertrend_veto","three_of_four_confirmation","online_route_similarity_70_80","online_similarity_plus_regime")

def safe(v):return isinstance(v,(float,int)) and not isinstance(v,bool) and math.isfinite(v)
def phase(ts):
 if ts<VAL:return "development"
 if ts<TEST:return "validation"
 return "post_validation"

def prefeatures(signal):
 ts=int(signal["entryTs"])
 row={"entry_utc":dt.datetime.fromtimestamp(ts/1000,dt.timezone.utc).isoformat(),
      "symbol":signal["symbol"],"side":signal["side"],"strategy":signal["strategy"]}
 return f.entry_features(row)

def keyrow(d):
 return (d["strategy"],d["symbol"],d["side"],d["route"],d["entryTs"])

candidates=[]
missing=Counter();bad=Counter();duplicate=Counter();censored=Counter()
seen=set()
with f.CANDIDATE_SOURCE.open(encoding="utf8") as source:
 for line in source:
  signal=json.loads(line)
  entry=int(signal["entryTs"])
  if not int(f.START.timestamp()*1000)<=entry<END:continue
  key=keyrow(signal)
  if key in seen:
   duplicate[signal["strategy"]]+=1
   continue
  seen.add(key)
  m=signal.get("model") or {}
  entryPrice=m.get("entryPrice");exitPrice=m.get("exitPrice");exitTs=m.get("exitTs")
  if not all(safe(v) for v in (entryPrice,exitPrice,exitTs)) or not min(entryPrice,exitPrice)>0 or exitTs<=entry:
   bad[signal["strategy"]]+=1
   continue
  # Exit after the terminal BT boundary is right-censored, not a win/loss.
  if exitTs>=END:
   censored[signal["strategy"]]+=1
   continue
  feat=prefeatures(signal)
  if not feat:
   missing[signal["strategy"]]+=1
   continue
  gross=(exitPrice/entryPrice-1)*(1 if signal["side"]=="LONG" else -1)
  candidates.append({**signal,"entryTs":entry,"exitTs":int(exitTs),
   "raw_return":gross,"features":feat,"key":key})
print("CANDIDATES_READY",len(candidates),"missing_features",dict(missing),"bad_labels",dict(bad),"duplicates",dict(duplicate),flush=True)
candidates.sort(key=lambda d:(d["entryTs"],d["strategy"],d["id"]))
if not candidates:raise SystemExit("NO_VALID_CANDIDATES")

def vec(z):
 x=z["features"]
 return [x["aligned_sym6"]/.06,x["aligned_sym24"]/.10,x["aligned_sym72"]/.18,
   x["aligned_btc24"]/.07,x["aligned_relative24"]/.10,
   x["sym_atr24ratio"]/.04,x["sym_efficiency24"]/.5,
   (x["sym_24h_position"]-.5)*2]
def dist_sq(a,b):
 aa=vec(a);bb=vec(b)
 return sum(min(12,(x-y)**2) for x,y in zip(aa,bb))
def probability(row,hist,fee):
 win=lambda x:1 if x["raw_return"]-fee>0 else 0
 grand=(12+sum(win(x) for x in hist))/(24+len(hist))
 route=[x for x in hist if x["route"]==row["route"] and x["side"]==row["side"]]
 prior=(16*grand+sum(win(x) for x in route))/(16+len(route))
 if not hist:
  return {"p":prior,"mean":0.0,"hist_n":0,"route_n":0,"neighbors":0}
 nearest=sorted(hist,key=lambda x:dist_sq(row,x))[:24]
 weights=[]
 for v in nearest:
  d2=dist_sq(row,v)
  weight=math.exp(-min(d2,100)/8)
  if v["route"]==row["route"] and v["side"]==row["side"]:weight*=1.8
  if v["symbol"]==row["symbol"]:weight*=1.15
  weights.append((v,weight))
 wtot=sum(w for _,w in weights)
 knear=(sum(w*win(x) for x,w in weights)+prior*10)/(wtot+10)
 routemean=statistics.mean(x["raw_return"]-fee for x in route) if route else 0.0
 localmean=(sum(w*(x["raw_return"]-fee) for x,w in weights)+routemean*10)/(wtot+10)
 return {"p":round(0.45*prior+0.55*knear,6),"mean":round(localmean,6),
  "hist_n":len(hist),"route_n":len(route),"neighbors":len(weights),"prior":round(prior,6)}
def confirmation(x):
 feat=x["features"]
 obs=[feat["aligned_sym6"],feat["aligned_sym24"],feat["aligned_btc24"],feat["aligned_relative24"]]
 return sum(q>0 for q in obs)>=3 and feat["sym_efficiency24"]>=0.16
def strong_contra(x):
 z=x["features"]
 return z["triple_countertrend"] and z["sym_efficiency24"]>=0.20
def decision(x,info,strategy):
 t=.8 if strategy=="PENGU" else .70
 enough=info["hist_n"]>=25 and info["route_n"]>=5
 predicted=enough and info["p"]>=t and info["mean"]>=0.001
 return {
  "baseline":True,
  "triple_countertrend_veto":not strong_contra(x),
  "three_of_four_confirmation":confirmation(x),
  "online_route_similarity_70_80":predicted,
  "online_similarity_plus_regime":predicted and not strong_contra(x)
 }

# Independent 10/30bps pricing, prior learning only on already-exited signals.
# No parameter is fit on a future row, and no threshold selection on post-validation.
all_scores={}
for bps in (10,30):
 fee=bps/10000
 seen_by_strategy=defaultdict(list)
 scored=[]
 for index,x in enumerate(candidates):
  ts=x["entryTs"];s=x["strategy"]
  hist=[u for u in seen_by_strategy[s] if ts-LOOKBACK<=u["entryTs"]<ts and u["exitTs"]+EMBARGO<ts]
  if any(u["exitTs"]+EMBARGO>=ts for u in hist):raise ValueError("FUTURE_MATURITY_LEAK")
  if x["features"]["data_asof_utc"]>=dt.datetime.fromtimestamp(ts/1000,dt.timezone.utc).isoformat():
   raise ValueError("H1_NOT_CLOSED_AT_ENTRY")
  prob=probability(x,hist,fee)
  keep=decision(x,prob,s)
  ret=x["raw_return"]-fee
  scored.append({
    "signal_id":x["id"],"strategy":s,"route":x["route"],"symbol":x["symbol"],
    "side":x["side"],"entryTs":ts,"entry_utc":dt.datetime.fromtimestamp(ts/1000,dt.timezone.utc).isoformat(),
    "exitTs":x["exitTs"],"phase":phase(ts),"net_price_return":ret,
    "price_win":ret>0,"raw_return":x["raw_return"],"features":x["features"],
    "predicted_probability":prob,"keep":keep
   })
  seen_by_strategy[s].append(x)
 all_scores[bps]=scored
 print("WALKFORWARD",bps,"complete",len(scored),flush=True)

def summarise(rows):
 n=len(rows)
 if n==0:return {"n":0,"wins":0,"win_pct":None,"wilson95pct":[None,None],"sum_price_returns_pct":0.0,
                   "mean_price_return_pct":None,"worst_price_return_pct":None,"max_loss_price_return_pct":None}
 wins=sum(x["price_win"] for x in rows)
 ret=[x["net_price_return"] for x in rows]
 return {"n":n,"wins":wins,"losses":n-wins,"win_pct":round(100*wins/n,2),
  "wilson95pct":[round(100*v,2) for v in f.wilson(wins,n)],
  "sum_price_returns_pct":round(100*sum(ret),4),
  "mean_price_return_pct":round(100*statistics.mean(ret),4),
  "worst_price_return_pct":round(100*min(ret),4),
  "p10_price_return_pct":round(100*sorted(ret)[max(0,int(n*.1)-1)],4),
  "rejected_winners":None}

rows=[]
route_rows=[]
traces={}
for bps,scored in all_scores.items():
 for strategy in STRATEGIES:
  for ph in ["development","validation","post_validation"]:
   bucket=[x for x in scored if x["strategy"]==strategy and x["phase"]==ph]
   if not bucket:continue
   baseline=summarise(bucket)
   for policy in POLICIES:
    kept=[x for x in bucket if x["keep"][policy]]
    a=summarise(kept)
    a["rejected_winners"]=sum(x["price_win"] for x in bucket if not x["keep"][policy])
    a["rejected_losers"]=sum(not x["price_win"] for x in bucket if not x["keep"][policy])
    a["total_signal_candidates"]=len(bucket)
    a["kept_pct"]=round(100*len(kept)/len(bucket),2)
    a["baseline_win_pct"]=baseline["win_pct"]
    a["win_pct_delta"]=round(a["win_pct"]-baseline["win_pct"],2) if a["win_pct"] is not None else None
    target=80 if strategy=="PENGU" else 70
    a["target_pct"]=target
    a["target_met_observed"]=a["n"]>=10 and a["win_pct"]>=target
    a["target_met_wilson95"]=a["n"]>=10 and a["wilson95pct"][0]>=target
    rows.append({"fee_bps":bps,"strategy":strategy,"period":ph,"policy":policy,**a})
  # Route-level outcome on final chronological period, not pooled across regimes.
  for route,side in sorted(set((x["route"],x["side"]) for x in scored if x["strategy"]==strategy)):
   bucket=[x for x in scored if x["strategy"]==strategy and x["route"]==route and x["side"]==side and x["phase"]=="post_validation"]
   if not bucket:continue
   for policy in POLICIES:
    kept=[x for x in bucket if x["keep"][policy]]
    result=summarise(kept)
    route_rows.append({"fee_bps":bps,"strategy":strategy,"route":route,
       "side":side,"period":"post_validation","policy":policy,
       "sample_n":len(bucket),"n":result["n"],"win_pct":result["win_pct"],
       "mean_price_return_pct":result["mean_price_return_pct"],
       "kept_pct":round(100*len(kept)/len(bucket),2)})
 # Save compact per-candidate decisions for replay; do not write full features.
 traces[bps]=[{
   "signal_id":x["signal_id"],"strategy":x["strategy"],"route":x["route"],
   "symbol":x["symbol"],"side":x["side"],"entry_utc":x["entry_utc"],"exitTs":x["exitTs"],
   "phase":x["phase"],"net_price_return_pct":round(100*x["net_price_return"],5),
   "price_win":x["price_win"],"online":x["predicted_probability"],
   "keep":x["keep"],"quality":{
     k:round(x["features"][k]*100,4) if isinstance(x["features"][k],float) else x["features"][k]
     for k in ("aligned_sym6","aligned_sym24","aligned_btc24","aligned_relative24","sym_atr24ratio","sym_efficiency24","triple_countertrend")}} for x in scored]

def writecsv(path,records):
 with path.open("w",encoding="utf-8-sig",newline="") as file:
  fields=list(dict.fromkeys(k for record in records for k in record))
  writer=csv.DictWriter(file,fields);writer.writeheader();writer.writerows(records)

writecsv(OUT/"candidate_policy_walkforward_10_30bps.csv",rows)
writecsv(OUT/"candidate_route_post_validation_10_30bps.csv",route_rows)
(OUT/"causal_policy_candidate_trace_10_30bps.json").write_text(
 json.dumps({"schema":"disdex-candidate-causal-policy-decisions/v1","10":traces[10],"30":traces[30]},
 ensure_ascii=False,separators=(",",":"),allow_nan=False)+"\n",encoding="utf8")

# Link the shadow gate decision to known accepted entries by exact strategy, symbol, side, route, entry timestamp.
model_join={}
for bps in (10,30):
 dd=defaultdict(list)
 for x in all_scores[bps]:dd[(x["strategy"],x["route"],x["symbol"],x["side"],x["entry_utc"][:19])].append(x)
 models=f.raw[bps]
 accepted={}
 for s in STRATEGIES:
  pairs=[];lost=Counter()
  for row in models:
   if row["strategy"]!=s:continue
   key=(s,row["route"],row["symbol"],row["side"],row["entry_utc"][:19])
   match=dd.get(key,[])
   if len(match)==1:pairs.append((row,match[0]))
   else:lost["not_matched" if len(match)==0 else "ambiguous"]+=1
  accepted[s]={"matched":len(pairs),"unmatched":dict(lost),"original_fills":sum(row["strategy"]==s for row in models)}
  for p in POLICIES:
   selected=[a for a,b in pairs if b["keep"][p]]
   rejected=[a for a,b in pairs if not b["keep"][p]]
   if selected:
    win=sum(a["win"] for a in selected)/len(selected)
   else:win=None
   accepted[s][p]={"kept":len(selected),"model_net_win_pct":round(100*win,2) if win is not None else None,
       "rejected_winners":sum(a["win"] for a in rejected),"rejected_losers":sum(not a["win"] for a in rejected),
       "raw_net_return_on_notional_sum_pct":round(100*sum(a["net_return_on_notional"] for a in selected),4),
       "portfolio_reexecuted":False}
 model_join[bps]=accepted
(OUT/"accepted_portfolio_shadow_gate_join.json").write_text(
 json.dumps(model_join,ensure_ascii=False,sort_keys=True,indent=2,allow_nan=False)+"\n",encoding="utf8")

out={
 "schema":"disdex-causal-winrate-walkforward/v1","scope":"RESEARCH_ONLY",
 "period":"2025-10-01 to 2026-10-01 UTC",
 "splits":{"development":"2025-10-01/2026-03-31","validation":"2026-04-01/2026-06-30","post_validation":"2026-07-01/2026-09-30"},
 "rules":{"maturity":"only prior entered candidate with observed modeled exit +24h < current candidate entry",
   "lookback_days":180,"labels":"modeled price return - 10 or 30bps round-trip; funding and portfolio admissions excluded",
   "features":"H1 closed before entry; asset/BTC 6/24/72h directional momentum, relative momentum, ATR, efficiency, H1 range position",
   "prior":"global Beta(12,12), route shrinkage 16, nearest 24 with pseudocount 10; no coefficients fit to outcomes",
   "target":"70% all, 80% PENGU; also Wilson 95% lower bound and minimum retained n=10",
   "no_holdout_selection":"five pre-registered policies are evaluated on every phase; no policy promoted based solely on final phase"},
 "source_sha256":{"candidate_layer1":f.hashfile(f.CANDIDATE_SOURCE),"filled_10":f.files["10"],"filled_30":f.files["30"],
  "fully_closed_h1":{sym:row[2] for sym,row in sorted(f.bars_cache.items()) if row is not None}},
 "observations":{
  "valid_unique_candidates":len(candidates),"excluded_missing_h1_closed":dict(missing),
  "invalid_future_outcome":dict(bad),"right_censored_after_bt_end":dict(censored),"duplicate_keys":dict(duplicate)},
 "summary":rows,
 "accepted_shadow_join":model_join,
 "limitations":[
  "Portfolio-admitted outcome and counterfactual all-candidate-price outcomes are separate populations",
  "No gating policy was applied to a re-simulated portfolio: no comparable compound balance or MDD",
  "HYPE original H48R4 signal exits differ; never infer the effect of imposing H48 on non-HYPE",
  "Model exits can be imperfect, as previously confirmed; 5m stop and execution-faithfulness not guaranteed",
  "No purely unobserved holdout: historical data may have influenced earlier strategy research, despite chronological score discipline",
  "Thousands of correlated signals do not equal independent trades; overlapping time windows and route-sweep selection weaken CIs",
  "Small samples and selectivity can inflate observed win rate while losing profitability",
  "Quantitative result is research only. Do not deploy any gate to LIVE without verified fresh data and production source parity"
 ]}
(OUT/"causal_policy_walkforward_summary.json").write_text(
 json.dumps(out,ensure_ascii=False,sort_keys=True,indent=2,allow_nan=False)+"\n",encoding="utf8")

print("WALKFORWARD_COMPLETE",len(candidates),"SUMMARY_ROWS",len(rows),flush=True)
for r in rows:
 if r["fee_bps"]==30 and r["period"]=="post_validation":
  print("POST_VAL_30",r["strategy"],r["policy"],"N",r["n"],"WR",r["win_pct"],
    "REJ_W",r["rejected_winners"],"REJ_L",r["rejected_losers"],
    "MEAN_RET",r["mean_price_return_pct"],flush=True)
print("SHADOW_ACCEPTED",json.dumps(model_join[30],ensure_ascii=False)[:3000],flush=True)
