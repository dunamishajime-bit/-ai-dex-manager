#!/usr/bin/env python3
"""Time-regime shift and route-specific error fingerprints from candidate-only labels.

Exploratory Fisher tests require FDR adjustment and are not independent because
some signals and market outcomes overlap. Forensic / hypothesis generation only.
"""
from __future__ import annotations
import csv,json,math,statistics,sys
from collections import Counter,defaultdict
from pathlib import Path

BASE=Path(sys.argv[1]) if len(sys.argv)>1 else Path(r"C:\Users\dis\Documents\DisDex_Research\WINRATE_DEEP_20261122\results")
raw=json.loads((BASE/"causal_policy_candidate_trace_10_30bps.json").read_text(encoding="utf8"))
src=Path(r"C:\tmp\disdex-bt-20251001-20261001\DIRECTION_RESEARCH_20261109\three_layer_layer1_all_candidates_20261114.jsonl")
candidate_meta={}
with src.open(encoding="utf8") as file:
 for line in file:
  x=json.loads(line);candidate_meta[x["id"]]={"exitReason":(x.get("model") or {}).get("exitReason"),
  "source_sha":str((x.get("v") or {}).get("source_runtime_sha") or "")}

def logcomb(n,k):
 return math.lgamma(n+1)-math.lgamma(k+1)-math.lgamma(n-k+1) if 0<=k<=n else float("-inf")
def exact(a,b,c,d):
 # Fisher 2-sided conditional randomization of a fixed 2x2 table.
 n1=a+b;n2=c+d;wins=a+c;total=n1+n2
 lo=max(0,wins-n2);hi=min(wins,n1)
 den=logcomb(total,n1)
 def lp(x):return logcomb(wins,x)+logcomb(total-wins,n1-x)-den
 obs=lp(a)
 vals=[math.exp(lp(k)) for k in range(lo,hi+1) if lp(k)<=obs+1e-12]
 return min(1,sum(vals))
def median(xs):
 return round(statistics.median(xs),4) if xs else None
def mean(xs):
 return round(statistics.mean(xs),4) if xs else None
def grouping(rows):
 a=defaultdict(list)
 for r in rows:
  a[(r["strategy"],r["route"],r["side"])].append(r)
 return a
def split(row,period):return row["phase"]==period
def info(rows):
 n=len(rows);w=sum(x["price_win"] for x in rows)
 return {"n":n,"win":w,"win_pct":round(100*w/n,2) if n else None,
 "median_price_return_pct":median([x["net_price_return_pct"] for x in rows]),
 "mean_price_return_pct":mean([x["net_price_return_pct"] for x in rows]),
 "mean_loss_return_pct":mean([x["net_price_return_pct"] for x in rows if not x["price_win"]])}
def outcome_motif(rows):
 losses=[x for x in rows if not x["price_win"]]
 winners=[x for x in rows if x["price_win"]]
 fields=["aligned_sym6","aligned_sym24","aligned_btc24","aligned_relative24","sym_atr24ratio","sym_efficiency24"]
 contrasts=[]
 for k in fields:
  a=[x["quality"][k] for x in winners if x["quality"].get(k) is not None]
  b=[x["quality"][k] for x in losses if x["quality"].get(k) is not None]
  if len(a)>=4 and len(b)>=4:
   contrasts.append({"metric":k,"wins_median":median(a),"losses_median":median(b),
    "loss_minus_win_median":round(statistics.median(b)-statistics.median(a),4),
    "sample_w":len(a),"sample_l":len(b)})
 return sorted(contrasts,key=lambda r:-abs(r["loss_minus_win_median"]))
study=[]
all_tests=[]
for fee in ("10","30"):
 a=grouping(raw[fee])
 for (runner,route,side),items in sorted(a.items()):
  pools={s:[x for x in items if split(x,s)] for s in ("development","validation","post_validation")}
  d=info(pools["development"]);v=info(pools["validation"]);t=info(pools["post_validation"])
  status=[]
  for groupA,groupB in [("development","post_validation"),("validation","post_validation")]:
   first=info(pools[groupA]);last=t
   if first["n"]>=8 and last["n"]>=8:
    p=exact(first["win"],first["n"]-first["win"],last["win"],last["n"]-last["win"])
    all_tests.append({"fee":fee,"runner":runner,"route":route,"side":side,"a":groupA,"b":groupB,
     "a_n":first["n"],"a_win":first["win"],"b_n":last["n"],"b_win":last["win"],
     "delta_win_pct":round(last["win_pct"]-first["win_pct"],2),"p_fisher_exploratory":p})
  for x in items:
   x["model_exit_reason"]=candidate_meta.get(x["signal_id"],{}).get("exitReason")
  study.append({"fee":fee,"runner":runner,"route":route,"side":side,
   "full":info(items),"development":d,"validation":v,"post_validation":t,
   "post_validation_loss_exits":Counter(x["model_exit_reason"] or "UNKNOWN" for x in pools["post_validation"] if not x["price_win"]).most_common(6),
   "post_validation_loss_fingerprints":outcome_motif(pools["post_validation"]),
   "full_loss_fingerprints":outcome_motif(items),
   "post_validation_median_features_all":{
     k:median([x["quality"][k] for x in pools["post_validation"] if isinstance(x["quality"].get(k),(int,float))])
     for k in ("aligned_sym6","aligned_sym24","aligned_btc24","aligned_relative24","sym_atr24ratio","sym_efficiency24")}
  })
# Benjamini-Hochberg procedure across entire searched 10/30bps family.
p_sorted=sorted(all_tests,key=lambda x:x["p_fisher_exploratory"])
q=[None]*len(p_sorted)
running=1.0
for i in range(len(p_sorted)-1,-1,-1):
 running=min(running,p_sorted[i]["p_fisher_exploratory"]*len(p_sorted)/(i+1))
 q[i]=running
for j,x in enumerate(p_sorted):x["bh_fdr_q_exploratory"]=round(q[j],8)
for x in study:
 hits=[t for t in p_sorted if
  (t["fee"],t["runner"],t["route"],t["side"])==(x["fee"],x["runner"],x["route"],x["side"])]
 x["regime_shift_tests"]=hits
 x["priority"]=("HIGH_REGIME_SHIFT" if any(t["delta_win_pct"]<=-20 and
   t["bh_fdr_q_exploratory"]<0.05 for t in hits)
   else "HIGH_LOSS" if x["post_validation"]["n"]>=8 and
   (x["post_validation"]["win_pct"] or 0)<45
   else "UNDER_SAMPLED" if x["post_validation"]["n"]<8 else "CHECK")

# Concentration of hard stops on PENGU by model exit reason is not a proof
# of future directional misclassification.
highlights=[]
for x in study:
 if x["fee"]!="30":continue
 if x["runner"]=="PENGU" or x["priority"] in ("HIGH_REGIME_SHIFT","HIGH_LOSS"):
  highlights.append({k:x[k] for k in ("runner","route","side","full","development","validation","post_validation",
    "priority","post_validation_loss_exits","post_validation_loss_fingerprints","regime_shift_tests")})
highlights.sort(key=lambda x:(x["runner"],x["priority"],-(x["post_validation"]["n"])))
output={
 "schema":"disdex-route-regime-error-attribution/v1",
 "source":"causal candidate-only price exits, not admitted portfolio fills",
 "source_cases":len(raw["30"]),
 "statistical_cautions":[
  "Fisher nominal p and BH q are exploratory. Correlated signals mean they are not calibrated independent trade p-values.",
  "Same 2025-2026 data already investigated elsewhere; post-validation is chronological only, not a pristine blind external set.",
  "Price outcomes ignore real funding, shared Gross, stop timing bugs, latency and venue fills.",
  "Median feature contrasts are retrospective associations, not causal proof or permission to flip Long/Short.",
  "DO NOT disable individual route solely because it failed in the July-September period."
 ],
 "regime_tests":p_sorted,"highlighted_30bps":highlights,
 "all_route_strata":study}
(BASE/"route_regime_error_attribution.json").write_text(json.dumps(output,ensure_ascii=False,sort_keys=True,indent=2,allow_nan=False)+"\n",encoding="utf8")
small={"schema":output["schema"],"regime_tests":p_sorted,"highlighted_30bps":highlights,
 "statistical_cautions":output["statistical_cautions"]}
(BASE/"route_regime_error_summary_compact.json").write_text(json.dumps(small,ensure_ascii=False,sort_keys=True,indent=2,allow_nan=False)+"\n",encoding="utf8")
print("REGIME_AUDIT",len(study),"route-cost-strata",len(p_sorted),"tested comparisons",flush=True)
for z in p_sorted[:14]:
 if z["fee"]=="30":print("SIGNIFICANT_CHECK",z,flush=True)
print("PENGU_ROUTE_SUMMARY",flush=True)
for x in highlights:
 if x["runner"]=="PENGU":
  print(x["route"],"dev",x["development"],"val",x["validation"],"post",x["post_validation"],
    "loss_exit",x["post_validation_loss_exits"],"motif",x["post_validation_loss_fingerprints"][:4],flush=True)
