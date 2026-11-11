#!/usr/bin/env python3
from pathlib import Path
import json,datetime as dt,hashlib,collections

R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
PRE=R/"PREPERIOD_TRAIN_20250322_20251001"/"Q102_SELECTED_BASE"/"q102-s34-selected-native-exits.jsonl"
FWD=R/"FORWARD_HOLDOUT_20261001_20261108"/"Q102_SELECTED_BASE"/"q102-s34-selected-native-exits.jsonl"
OUT=R/"DIRECTION_RESEARCH_20261109"/"q102_s34_route_temporal_stability_20261111.json"
COST=.003
T1=int(dt.datetime(2025,7,1,tzinfo=dt.timezone.utc).timestamp()*1000)
T2=int(dt.datetime(2025,9,1,tzinfo=dt.timezone.utc).timestamp()*1000)
pre=[json.loads(x) for x in PRE.read_text(encoding="utf-8").splitlines() if x.strip()]
fwd=[json.loads(x) for x in FWD.read_text(encoding="utf-8").splitlines() if x.strip()]

def met(a):
 v=[float(z["rawReturn"])-COST for z in a]
 gp=sum(x for x in v if x>0);gl=-sum(x for x in v if x<0)
 return {"n":len(v),"wr":sum(x>0 for x in v)/len(v) if v else None,
         "mean":sum(v)/len(v) if v else None,"sum":sum(v),
         "pf":gp/gl if gl else (999.0 if gp>0 else None)}
def splits(a):
 return {"train":[z for z in a if z["entryTs"]<T1],
         "validation":[z for z in a if T1<=z["entryTs"]<T2],
         "prehold":[z for z in a if z["entryTs"]>=T2]}

routes=sorted(set(z["route"] for z in pre))
audit={}
frozen=[]
for route in routes:
 a=[z for z in pre if z["route"]==route]
 sp=splits(a);m={k:met(v) for k,v in sp.items()};full=met(a)
 # Very strict route quarantine: enough temporal evidence in all 3 pretarget buckets,
 # negative expectation and PF<1 in every bucket, and full-period PF<0.70.
 enough=m["train"]["n"]>=5 and m["validation"]["n"]>=3 and m["prehold"]["n"]>=2
 persist=all(m[k]["mean"] is not None and m[k]["mean"]<0 and (m[k]["pf"] or 0)<1 for k in m)
 severe=full["n"]>=12 and full["mean"]<0 and (full["pf"] or 0)<.70
 freeze=bool(enough and persist and severe)
 if freeze:frozen.append(route)
 audit[route]={"splits30":m,"full30":full,"freezePretargetOnly":freeze,
               "symbol":a[0]["symbol"] if a else None,"family":a[0]["family"] if a else None}

# Forward can only veto, never add.
forward={}
accepted=[]
for route in frozen:
 a=[z for z in fwd if z["route"]==route]
 q=met(a);forward[route]=q
 if q["n"]>=2 and q["mean"] is not None and q["mean"]<=0 and (q["pf"] or 0)<=1:
  accepted.append(route)
out={"status":"Q102_S34_ROUTE_PRETARGET_FREEZE_FORWARD_VETO_ONLY",
 "costBps":30,
 "pretargetSplit":{"train":"2025-03-22..2025-06-30","validation":"2025-07..08","prehold":"2025-09"},
 "criteria":{"trainMinN":5,"validationMinN":3,"preholdMinN":2,"fullMinN":12,
             "meanNegativeEveryPretargetSplit":True,"pfBelow1EveryPretargetSplit":True,"fullPfBelow":0.70},
 "audit":audit,"frozenPretargetOnly":frozen,"forwardOneShot":forward,
 "acceptedAfterForwardVeto":accepted,"rejectedByForward":[x for x in frozen if x not in accepted],
 "hashes":{"pre":hashlib.sha256(PRE.read_bytes()).hexdigest(),"forward":hashlib.sha256(FWD.read_bytes()).hexdigest()},
 "warning":"No target-year 2025-10..2026-10 outcome is used. Forward 2026-10..11 may only veto a pretarget-frozen quarantine."
}
OUT.write_text(json.dumps(out,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
print("ROUTES",len(routes),"FROZEN",frozen,"ACCEPTED",accepted)
for r in frozen:print(r,json.dumps(audit[r],separators=(",",":")),"FWD",forward[r])
print("OUT",OUT,"SHA256",hashlib.sha256(OUT.read_bytes()).hexdigest())
