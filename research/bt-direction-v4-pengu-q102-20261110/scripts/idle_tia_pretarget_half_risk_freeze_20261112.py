#!/usr/bin/env python3
from pathlib import Path
import json,datetime as dt,hashlib

R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
P=R/"PREPERIOD_TRAIN_20250301_20251001"/"IDLE_ALL_BINANCE_PROXY"/"idle-all-preperiod-proxy-candidates-with-m5-exits.jsonl"
F=R/"FORWARD_HOLDOUT_20261001_20261108"/"IDLE_DUALSIDE_LIFECYCLE"/"idle-forward-dualside.jsonl"
OUT=R/"DIRECTION_RESEARCH_20261109"/"idle_tia_pretarget_half_risk_freeze_20261112.json"
ROUTE="IDLE_TIA_BREAKDOWN_SHORT_VOLCAP100";COST=.003
T1=int(dt.datetime(2025,7,1,tzinfo=dt.timezone.utc).timestamp()*1000)
T2=int(dt.datetime(2025,9,1,tzinfo=dt.timezone.utc).timestamp()*1000)
pre=[json.loads(x) for x in P.read_text(encoding="utf-8").splitlines() if x.strip()]
pre=[z for z in pre if z.get("route")==ROUTE]
fw=[json.loads(x) for x in F.read_text(encoding="utf-8").splitlines() if x.strip()]
fw=[z for z in fw if z.get("route")==ROUTE and z.get("mode")=="NATIVE_SHORT"]

def met(a):
 vals=[float(z.get("grossReturn",z.get("rawReturn")))-COST for z in a]
 gp=sum(x for x in vals if x>0);gl=-sum(x for x in vals if x<0)
 return {"n":len(vals),"wr":sum(x>0 for x in vals)/len(vals) if vals else None,
         "mean":sum(vals)/len(vals) if vals else None,"sum":sum(vals),
         "pf":gp/gl if gl else (999.0 if gp>0 else None),"worst":min(vals) if vals else None}
parts={"train":[z for z in pre if z["entryTs"]<T1],
       "validation":[z for z in pre if T1<=z["entryTs"]<T2],
       "prehold":[z for z in pre if z["entryTs"]>=T2],
       "allPretarget":pre,
       "forward":fw}
m={k:met(v) for k,v in parts.items()}
# Freeze is based on pretarget non-stationarity only. Forward can only confirm/veto.
pre_freeze=(m["train"]["n"]>=50 and m["validation"]["n"]>=30 and m["prehold"]["n"]>=15
            and m["train"]["pf"]>1.3 and m["validation"]["pf"]<0.8
            and m["allPretarget"]["pf"]<1.15)
forward_confirm=(m["forward"]["n"]>=5 and m["forward"]["pf"]<1 and m["forward"]["mean"]<0)
out={"status":"IDLE_TIA_PRETARGET_NONSTATIONARY_HALF_RISK_FREEZE",
     "route":ROUTE,"costBps":30,"metrics":m,
     "pretargetFreezeHalfRisk":pre_freeze,
     "forwardVetoPassed":forward_confirm,
     "frozenRequestedGrossMultiplier":0.5 if pre_freeze and forward_confirm else 1.0,
     "selectionUsesTargetYear":False,
     "method":"Half-risk is not a predictive gate. It is frozen because a large pretarget train edge collapses in Jul-Aug validation, remains only neutral in Sep prehold, and the full pretarget PF is near 1. Forward 2026-10..11 is veto/confirmation only.",
     "hashes":{"pre":hashlib.sha256(P.read_bytes()).hexdigest(),"forward":hashlib.sha256(F.read_bytes()).hexdigest()}}
OUT.write_text(json.dumps(out,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
print(json.dumps(out,indent=2,ensure_ascii=False))
print("SHA256",hashlib.sha256(OUT.read_bytes()).hexdigest())
