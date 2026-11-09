#!/usr/bin/env python3
"""Causal online Y06 shadow-health / skip-only study: no future outcome before native exit."""
import json, os, math, statistics, hashlib, datetime as dt
from pathlib import Path
ROOT=Path(os.environ.get("DISDEX_BT_ROOT",r"C:\tmp\disdex-bt-20251001-20261001"))
SOURCE=ROOT/"V4_Y06_HISTORICAL_DUALSIDE_20261109"/"y06-dualside-modeled.jsonl"
OUT=ROOT/"DIRECTION_RESEARCH_20261109"
rows=sorted((x for x in (json.loads(z) for z in SOURCE.open(encoding="utf8") if z.strip()) if x["mode"]=="NATIVE"), key=lambda r:(r["entryTs"],r["candidateIndex"]))
assert len(rows)==352
segments={"train":list(range(211)),"validation":list(range(211,281)),"test":list(range(281,352))}
fee_models=[0.001,0.003] # total roundtrip proxy; funding excluded.
windows=[5,10,20,40]
policies=[("mean_less",w,cutoff) for w in windows for cutoff in [-.01,-.005,0,.005,.01]]
policies +=[("win_less",w,cutoff) for w in windows for cutoff in [.3,.4,.5,.6]]
policies +=[("negative_streak",w,cutoff) for w in [3,5,8] for cutoff in [2,3,4]]
policies +=[("net_sum_less",w,cutoff) for w in windows for cutoff in [-.15,-.10,-.05,0,.05]]
def month(t):return dt.datetime.fromtimestamp(t/1000,dt.timezone.utc).strftime("%Y-%m")
months={}
for idx,r in enumerate(rows):
 k=month(r["entryTs"])
 months.setdefault(k,[]).append(idx)
chronology=[]
for i,r in enumerate(rows):
 eligible=[(j,rows[j]) for j in range(i) if rows[j]["exitTs"]<=r["entryTs"]]
 chronology.append(eligible)
def skipped(i,rule):
 kind,n,cutoff=rule
 eligible=chronology[i]
 if len(eligible)<n:return False
 last=[r for _,r in eligible[-n:]]
 vals=[r["rawReturn"] for r in last]
 if kind=="mean_less":return sum(vals)/n<cutoff
 if kind=="win_less":return sum(v>0 for v in vals)/n<cutoff
 if kind=="net_sum_less":return sum(vals)<cutoff
 count=0
 for v in reversed(vals):
  if v<=0:count+=1
  else:break
 return count>=cutoff
def metrics(ids,skips,fee):
 cut=[i for i in ids if skips[i]]
 keep=[i for i in ids if not skips[i]]
 uplift=sum(fee-rows[i]["rawReturn"] for i in cut)
 return {"n":len(ids),"skip":len(cut),"kept":len(keep),
  "skipped_native_wins":sum(rows[i]["rawReturn"]>fee for i in cut),
  "skipped_native_losses":sum(rows[i]["rawReturn"]<=fee for i in cut),
  "delta_vs_all_trade_net":uplift,
  "baseline_net":sum(rows[i]["rawReturn"]-fee for i in ids),
  "guarded_net":sum(rows[i]["rawReturn"]-fee for i in keep)}
results=[]
for rule in policies:
 skip=[skipped(i,rule) for i in range(len(rows))]
 r={"kind":rule[0],"lookback":rule[1],"threshold":rule[2]}
 for fee in fee_models:
  key="10bps" if fee==.001 else "30bps"
  r[key]={name:metrics(ids,skip,fee) for name,ids in segments.items()}
 results.append(r)
# pick ONLY from train & validation using cheap complexity regularizer
elig=[]
for r in results:
 a=r["30bps"]["train"];b=r["30bps"]["validation"]
 if a["skip"]>=10 and b["skip"]>=5 and a["delta_vs_all_trade_net"]>0 and b["delta_vs_all_trade_net"]>0:
  elig.append(r)
elig.sort(key=lambda r:min(r["30bps"]["train"]["delta_vs_all_trade_net"]/211,
 r["30bps"]["validation"]["delta_vs_all_trade_net"]/70),reverse=True)
# Weekly/monthly cohort attribution; not IID, overlapping fills.
monthly={m:{"n":len(ids),"win":sum(rows[i]["rawReturn"]>.003 for i in ids),
 "gross_raw_sum":sum(rows[i]["rawReturn"] for i in ids),
 "net_30bps_sum":sum(rows[i]["rawReturn"]-.003 for i in ids)} for m,ids in sorted(months.items())}
output={"status":"RESEARCH_ONLY","source_sha256":hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
 "method":"Each signal uses only native/shadow trade outcomes whose exitTs<=current entryTs; shadow fills must be reproduced by pinned native lifecycle.",
 "policies_count":len(policies),"positive_train_validation":len(elig),
 "top_trainval":elig[:15],"all_policies":results,
 "monthly_native":monthly,
 "note":"Route-level skip-only simulated gross/net edge, not full gross reservation or integrated portfolio. Skip modeled but shadow labels still accrue causally after exit.",
 "fees":{"10bps":.001,"30bps":.003},"source_runtime_sha":rows[0]["sourceRuntimeSha"]}
out=OUT/"v4_y06_online_causal_shadow_skip_20261110.json"
out.write_text(json.dumps(output,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
print("OUTPUT",out)
print("MONTHS",json.dumps(monthly,ensure_ascii=False))
print("POLICIES",len(policies),"MATURED_PASS",len(elig))
for r in elig[:15]:
 print("RULE",r["kind"],r["lookback"],r["threshold"],[(k,v["skip"],round(v["delta_vs_all_trade_net"],4),v["skipped_native_wins"]) for k,v in r["30bps"].items()])
