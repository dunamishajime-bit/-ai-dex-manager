#!/usr/bin/env python3
from pathlib import Path
import json,datetime as dt,hashlib,collections

R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
PRE=R/"PREPERIOD_TRAIN_20250301_20251001"/"Q102_FET_BINANCE_PROXY"/"q102-fet-pretarget-proxy-selected-exits.jsonl"
FWD=R/"FORWARD_HOLDOUT_20261001_20261108"/"Q102_SELECTED_BASE"/"q102-s34-selected-native-exits.jsonl"
OUT=R/"DIRECTION_RESEARCH_20261109"/"q102_fet_route_pretarget_freeze_forward_veto_20261112.json"
COST=.003
T1=int(dt.datetime(2025,7,1,tzinfo=dt.timezone.utc).timestamp()*1000)
T2=int(dt.datetime(2025,9,1,tzinfo=dt.timezone.utc).timestamp()*1000)
END=int(dt.datetime(2025,10,1,tzinfo=dt.timezone.utc).timestamp()*1000)

pre=[json.loads(x) for x in PRE.read_text(encoding="utf-8").splitlines() if x.strip()]
fwd=[json.loads(x) for x in FWD.read_text(encoding="utf-8").splitlines() if x.strip()]
fwd=[z for z in fwd if z.get("symbol")=="FETUSDT"]

def met(a):
    v=[float(z["rawReturn"])-COST for z in a]
    gp=sum(x for x in v if x>0);gl=-sum(x for x in v if x<0)
    return {"n":len(v),"wr":sum(x>0 for x in v)/len(v) if v else None,
            "mean":sum(v)/len(v) if v else None,"sum":sum(v),
            "pf":gp/gl if gl else (999.0 if gp>0 else None)}

routes=sorted(set(z["route"] for z in pre))
audit={};frozen=[]
for route in routes:
    a=[z for z in pre if z["route"]==route]
    sp={
      "train":[z for z in a if z["entryTs"]<T1],
      "validation":[z for z in a if T1<=z["entryTs"]<T2],
      "prehold":[z for z in a if T2<=z["entryTs"]<END],
    }
    m={k:met(v) for k,v in sp.items()};full=met(a)
    # strict route quarantine: sufficient evidence, every pretarget bucket negative,
    # and full PF < .75. This is fixed before looking at forward.
    enough=m["train"]["n"]>=6 and m["validation"]["n"]>=4 and m["prehold"]["n"]>=2
    persistent=all(m[k]["mean"] is not None and m[k]["mean"]<0 and (m[k]["pf"] or 0)<1 for k in m)
    severe=full["n"]>=15 and full["mean"]<0 and (full["pf"] or 0)<.75
    freeze=bool(enough and persistent and severe)
    if freeze:frozen.append(route)
    audit[route]={"splits30":m,"full30":full,"freezePretargetOnly":freeze}

forward={};accepted=[]
for route in frozen:
    q=met([z for z in fwd if z["route"]==route])
    forward[route]=q
    # true forward can only veto; require >=2 and still non-positive/PF<=1.
    if q["n"]>=2 and q["mean"] is not None and q["mean"]<=0 and (q["pf"] or 0)<=1:
        accepted.append(route)

out={
 "status":"Q102_FET_ROUTE_PRETARGET_FREEZE_FORWARD_VETO_ONLY",
 "costBps":30,
 "pretargetSplit":{"train":"2025-03-22..2025-06-30","validation":"2025-07..08","prehold":"2025-09"},
 "criteria":{"trainMinN":6,"validationMinN":4,"preholdMinN":2,"fullMinN":15,
             "negativeMeanAndPfBelow1EveryPretargetSplit":True,"fullPfBelow":.75},
 "audit":audit,"frozenPretargetOnly":frozen,"forwardOneShot":forward,
 "acceptedAfterForwardVeto":accepted,"rejectedByForward":[r for r in frozen if r not in accepted],
 "hashes":{"pre":hashlib.sha256(PRE.read_bytes()).hexdigest(),"forward":hashlib.sha256(FWD.read_bytes()).hexdigest()},
 "warning":"Pretarget is Binance UM FET-only local selector proxy; forward is Aster selected-base. No target-year outcome is used for freeze or veto."
}
OUT.write_text(json.dumps(out,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
print("FROZEN",frozen,"ACCEPTED",accepted)
for r in routes:
 print("\n",r,json.dumps(audit[r],separators=(",",":")))
 if r in forward: print("FWD",forward[r])
print("OUT",OUT,"SHA256",hashlib.sha256(OUT.read_bytes()).hexdigest())
