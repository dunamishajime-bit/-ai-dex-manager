#!/usr/bin/env python3
"""V4 outcome-rank hindsight audit: frozen vs strictly as-of matured-score ranks.
This is NOT an investable replacement strategy: signal universe uses V2 retrospective filters.
No data/production mutation. Materiality is rank disagreement, not simulated PnL alpha.
"""
from pathlib import Path
import collections,datetime as dt,hashlib,json,math
import numpy as np
R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
P=R/"pinned-source"/"V4"/"docs"/"implementation"/"v12-v4-v2-full-year-priority.json"
SOURCES=[
 ("pre",R/"PREPERIOD_TRAIN_20250322_20251001"/"V4_DUALSIDE_LIFECYCLE"/"v4-pre-dualside-modeled-exits.jsonl"),
 ("target",R/"V4_NATIVE_LIFECYCLE_EXIT_M5COMPLETE_20261109"/"v4-native-lifecycle-modeled-exits.jsonl"),
 ("forward",R/"FORWARD_HOLDOUT_20261001_20261108"/"V4_DUALSIDE_LIFECYCLE"/"v4-forward-dualside-modeled-exits.jsonl")
]
H=3600000
def iso(t):return dt.datetime.fromtimestamp(t/1000,dt.timezone.utc).isoformat()
def day(t):return dt.datetime.fromtimestamp(t/1000,dt.timezone.utc).strftime("%Y-%m")
def hashfile(p):return hashlib.sha256(p.read_bytes()).hexdigest()
priority=json.loads(P.read_text(encoding="utf8"))
assert len(priority)==41
historical_order=[x["route"] for x in sorted(priority,key=lambda x:x["priority_order"])]
frozen={x:i for i,x in enumerate(historical_order)}
data=[]
for period,path in SOURCES:
 for z in (json.loads(s) for s in path.open(encoding="utf8") if s.strip()):
  if z.get("mode","NATIVE")!="NATIVE":continue
  assert z["entryTs"]<z["exitTs"] and z["route"] in frozen
  data.append(dict(period=period,id=z.get("id",z.get("candidateId")),
   route=z["route"],entry=int(z["entryTs"]),exit=int(z["exitTs"]),
   nativeRaw=float(z["rawReturn"]),requestedGross=float(z["requestedGross"]),
   symbol=z["symbol"],side=z["side"]))
assert collections.Counter(z["period"] for z in data)==dict(pre=598,target=1394,forward=117)
data.sort(key=lambda z:(z["entry"],z["id"]))
# Build month-sliced risk adjusted mean from only settled historical samples.
# Objective is pre-registered mechanical audit heuristic; no threshold optimized
# against target/forward. A 72h purge reduces temporal overlap of outcome labels.
FAKE=20;COST=.003;PURGE=72*H
def state(t):
 eligible=[z for z in data if z["exit"]<=t-PURGE]
 by_route=collections.defaultdict(list)
 for z in eligible:by_route[z["route"]].append(z["nativeRaw"]-COST)
 def scores(route):
  x=by_route[route]
  n=len(x)
  if not n:return (0.0,0,0.0,None)
  gross=sum(x)
  # Stable lower confidence score, NOT tuned on target/forward.
  score=(gross-.5*math.sqrt(sum(v*v for v in x)))/(n+FAKE)
  return (score,n,gross/n,sum(v>0 for v in x)/n)
 scored={r:scores(r) for r in historical_order}
 # Group routes with equal scores lexicographically; never use frozen historical rank as tie breaker.
 asof=sorted(historical_order,key=lambda r:(-scored[r][0],r))
 rank={r:i for i,r in enumerate(asof)}
 return scored,asof,rank,eligible
def rank_state(asof,scored,eligible,t):
 top10=asof[:10]
 return dict(cutoff_utc=iso(t),available_matured=len(eligible),
  route_sample_count={k:v[1] for k,v in scored.items()},
  supported_routes_ge10=sum(v[1]>=10 for v in scored.values()),
  top10_asof=[{"route":r,"score":scored[r][0],"settled_count":scored[r][1],"frozen_order":frozen[r]+1} for r in top10],
  top10_frozen=[{"route":r,"asof_count":scored[r][1]} for r in historical_order[:10]],
  top10_intersection=len(set(top10)&set(historical_order[:10])),
  spearman_all_41=float(1-6*sum((i-asof.index(r))**2 for i,r in enumerate(historical_order))/(41*(41**2-1))))
cuts=[("target_start",1759276800000),("target_end",1790812800000),
      ("forward_after_policy",1791540000000),("forward_after_gross",1793016000000)]
period_states={}
for k,t in cuts:
 score,order,_,eligible=state(t);period_states[k]=rank_state(order,score,eligible,t)
# Do not rate the selection score on the same target labels to pick a new rule;
# profile objective disagreement and feasibility on historical BATCH conflicts.
conflicts=[]
asof_history={}
period_daily=collections.defaultdict(list)
for z in data:
 if z["period"] in ("target","forward"):
  period_daily[z["entry"]].append(z)
for ts,rows in sorted(period_daily.items()):
 if len(rows)<2:continue
 score,order,ranks,eligible=state(ts)
 a=sorted(rows,key=lambda z:(ranks[z["route"]],z["symbol"],z["id"]))
 b=sorted(rows,key=lambda z:(frozen[z["route"]],z["symbol"],z["id"]))
 conflicts.append(dict(utc=iso(ts),candidates=len(rows),
  frozen_winner=b[0]["id"],asof_winner=a[0]["id"],
  frozen_route=b[0]["route"],asof_route=a[0]["route"],
  different=b[0]["id"]!=a[0]["id"],
  chosen_frozen_raw=b[0]["nativeRaw"],chosen_asof_raw=a[0]["nativeRaw"],
  frozen_supported_asof=score[b[0]["route"]][1],
  causal_preferred_supported_asof=score[a[0]["route"]][1]))
# Route support as of each trade: compare frozen rank is high but no matured data.
weak_frozen=[]
for r in historical_order[:10]:
 sc,_,_,elig=state(1759276800000)
 weak_frozen.append({"route":r,"historical_priority":frozen[r]+1,
  "pre_target_outcomes_settled":sc[r][1],
  "mean_net30_asof":sc[r][2],"asof_derived_rank":rank_state if False else None})
by_month=collections.defaultdict(list)
for z in conflicts:
 by_month[z["utc"][:7]].append(z)
report=dict(status="AUDIT_ONLY_CAUSAL_POLICY_UNPROVEN",
 methods={"asof_outcome_maturity":"native exitTs <= decision entryTs -72h","cost_roundtrip":COST,
 "prior_pseudotrades":FAKE,"fixed_mechanical_score":"(sum net30 - .5 sqrt(sum of square net30)) / (n+20)",
 "ranking_ties":"alphabetical routes only, not frozen hindsight order",
 "not_oos":"V2 candidates themselves filtered with full-development-year hindsight priorities and repairs; this is not an executable clean re-trained strategy",
 "not_integrated":"No shared risk/gross/position occupancy, STOP competition, PnL compounding or admission simulation"},
 provenance={p:hashfile(f) for p,f in SOURCES} | {"priority_json":hashfile(P)},
 source_counts=dict(collections.Counter(z["period"] for z in data)),
asof_snapshot=period_states,
 top10_hindsight_pre_target_native_support=weak_frozen,
 batch_conflicts={"total":len(conflicts),"different":sum(x["different"] for x in conflicts),
 "same":sum(not x["different"] for x in conflicts),
 "by_month":{k:{"batches":len(v),"different":sum(z["different"] for z in v)} for k,v in sorted(by_month.items())},
 "sample_different":[v for v in conflicts if v["different"]][:30],
 "all_conflicts":conflicts},
 flags=["Not a new optimal policy; use only to measure rank/research contamination",
 "Hindsight route filters remain even for preperiod, and are therefore not independently trainable",
 "Forward 117 rows have right-censored outcomes in original 127 inputs; exclude 10 unknown, do not treat as zero",
 "Now-tuned scores on old cases cannot be called untouched prospective OOS"])
out=R/"DIRECTION_RESEARCH_20261109"/"v4_asof_matured_route_ranking_contamination_20261110.json"
out.write_text(json.dumps(report,indent=2,ensure_ascii=False)+"\n",encoding="utf8")
print("OUTPUT",out)
for k,v in period_states.items():
 print("ASOF",k,"N",v["available_matured"],"routes_ge10",v["supported_routes_ge10"],
 "spearman",round(v["spearman_all_41"],4),"top10_overlap",v["top10_intersection"],
 "top5",[(z["route"],z["settled_count"]) for z in v["top10_asof"][:5]])
print("CONFLICTS",len(conflicts),"DIFFERENT",report["batch_conflicts"]["different"])
print("SAMPLE",report["batch_conflicts"]["sample_different"][:3])
