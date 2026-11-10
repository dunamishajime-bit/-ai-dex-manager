#!/usr/bin/env python3
"""Independent audit of frozen TS model results without reusing TS payoff helper.
Win rates on overlapped source intents are NOT independent Bernoulli experiments.
"""
from collections import Counter,defaultdict
from pathlib import Path
import hashlib,json,math,statistics
ROOT=Path(r"C:\tmp\disdex-bt-20251001-20261001")
N=ROOT/"DIRECTION_RESEARCH_20261109"/"NATIVE_CAUSAL_SOURCE_REPLAY_20261110"
p=N/"native_exit_h1_funding_independent_audit.jsonl"
rows=[json.loads(s) for s in p.open(encoding="utf8") if s.strip()]
assert len(rows)==2067,len(rows)
assert all(r["status"]=="MODELED_COMPLETE_NATIVE_46H" for r in rows)
def episode_clusters(a):
 a=sorted(a,key=lambda z:(z["decisionTs"],z["exitTs"],z["id"]))
 n=0;last_end=-1;groups=[];current=[]
 for z in a:
  if z["decisionTs"]>last_end and current:
   groups.append(current);current=[];last_end=-1
  current.append(z);last_end=max(last_end,z["exitTs"])
 if current:groups.append(current)
 return groups
def cohort(a):
 outcomes={}
 for cost in (10,30):
  k=f"net{cost}bps"
  vals=[z[k] for z in a]
  wins=[z for z in vals if z>0];loss=[z for z in vals if z<=0]
  outcomes[str(cost)]={"count":len(vals),"wins":len(wins),"winRate":len(wins)/len(vals) if vals else None,
    "meanUnitNet":sum(vals)/len(vals) if vals else None,"totalUnitNet":sum(vals),
    "profitFactor":sum(wins)/-sum(loss) if sum(loss)<0 else None,
    "medianUnitNet":statistics.median(vals) if vals else None}
 return outcomes
for r in rows:
 sign=1 if r["side"]=="LONG" else -1
 ref=sign*(r["exitPrice"]/r["entryPrice"]-1)
 assert math.isclose(ref,r["grossDirectionalReturn"],rel_tol=1e-11,abs_tol=1e-13),(r["id"],ref,r["grossDirectionalReturn"])
 for bps in [10,30]:
  net=ref+r["fundingModelReturn"]-bps/10000
  assert math.isclose(net,r[f"net{bps}bps"],rel_tol=1e-11,abs_tol=1e-13)
 assert r["exitTs"]>r["decisionTs"] and r["exitTs"]<=1790812800000
 assert 0<r["holdHours"]<=46
assert len(set(r["id"] for r in rows))==len(rows)
groups={}
for cohort_name,subset in [
 ("v2_kept",[x for x in rows if x["family"]=="V12_NATIVE" and x["selectedByLegacyV2"]]),
 ("v2_rejected",[x for x in rows if x["family"]=="V12_NATIVE" and not x["selectedByLegacyV2"]]),
 ("native_all",[x for x in rows if x["family"]=="V12_NATIVE"]),
 ("native_core",[x for x in rows if x["family"]=="FAILED_BREAK_CORE"])]:
 monthly=defaultdict(list)
 for z in subset:
  import datetime
  m=datetime.datetime.fromtimestamp(z["decisionTs"]/1000,datetime.timezone.utc).strftime("%Y-%m")
  monthly[m].append(z)
 symbolside=defaultdict(list)
 for z in subset:symbolside[(z["symbol"],z["side"])].append(z)
 bySS={}
 for ss,l in symbolside.items():
  bySS["|".join(ss)]={"signals":len(l),"overlapEpisodes":len(episode_clusters(l)),**cohort(l)}
 bymonth={}
 for k,l in monthly.items():bymonth[k]=cohort(l)
 byside={s:cohort([z for z in subset if z["side"]==s]) for s in ("LONG","SHORT")}
 allEp=episode_clusters(subset)
 groups[cohort_name]={"totalCandidates":len(subset),"episodesWholeCrossAssetOverlap":len(allEp),
  "episodesWithinSymbolAndSide":sum(x["overlapEpisodes"] for x in bySS.values()),
  "distinctSymbols":len(set(x["symbol"] for x in subset)),
  "nativeHoldHours":{"median":statistics.median(x["holdHours"] for x in subset),
   "mean":sum(x["holdHours"] for x in subset)/len(subset)},
  "cost":cohort(subset),"bySide":byside,"byMonth":bymonth,
  "symbolSide":bySS}
out={"status":"RESEARCH_INDEPENDENT_ACCOUNTING_AND_EPISODE_CLUSTER_AUDIT",
 "inputResultSha256":hashlib.sha256(p.read_bytes()).hexdigest(),
 "counts":{"nativeSelected1394":1394,"nativeFiltered624":624,"core49":49,"total":2067},
 "independentArithmeticParityChecks":len(rows)*3,
 "noFutureExitBoundaryViolation":True,
 "dataLimitations":["Overlapping symbols strongly correlated via market regime; neither raw trade count nor symbol-side episodes are independent OOS evidence",
                    "V12 native EXIT model is not V2 route-specific 41 policy",
                    "10bps/30bps unit returns include model funding but not slippage or venue order fill",
                    "Raw candidate trades ignore runner max slots and Gross and account compounding"],
 "cohorts":groups}
path=N/"native_exit_independent_episode_and_cost_audit.json"
path.write_text(json.dumps(out,indent=2,ensure_ascii=False)+"\n",encoding="utf8")
print("REPORT",path)
for name,z in groups.items():
 print("COHORT",name,"n",z["totalCandidates"],"episodes_market",z["episodesWholeCrossAssetOverlap"],
  "episodes_symbolside",z["episodesWithinSymbolAndSide"],
  "10bps",z["cost"]["10"],"30bps",z["cost"]["30"],
  "SIDE10",[(s,v["10"]["winRate"]) for s,v in z["bySide"].items()])
 print("MONTH_POSITIVE",name,"count10",sum(v["10"]["meanUnitNet"]>0 for v in z["byMonth"].values()),
   "of",len(z["byMonth"]),"count30",sum(v["30"]["meanUnitNet"]>0 for v in z["byMonth"].values()))
