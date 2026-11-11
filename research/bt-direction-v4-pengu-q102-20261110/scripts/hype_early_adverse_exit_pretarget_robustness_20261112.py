#!/usr/bin/env python3
from pathlib import Path
import json,gzip,datetime as dt,hashlib,itertools,math

R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
BASE=R/"PREPERIOD_TRAIN_20250501_20251001"/"HYPE_BINANCE_PROXY"
CANDS=BASE/"hype-preperiod-proxy-candidates-with-m5-exits.jsonl"
M5=BASE/"HYPEUSDT-5m-20250501-20251001.jsonl.gz"
OUT=R/"DIRECTION_RESEARCH_20261109"/"hype_early_adverse_exit_pretarget_robustness_20261112.json"
COST=.003
STEP=300000

rows=[json.loads(x) for x in CANDS.read_text(encoding="utf-8").splitlines() if x.strip()]
with gzip.open(M5,"rt",encoding="utf-8") as f:
    m5=[json.loads(x) for x in f if x.strip()]
bars=[{"ts":int(z[0]),"o":float(z[1]),"h":float(z[2]),"l":float(z[3]),"c":float(z[4])} for z in m5]
idx={z["ts"]:i for i,z in enumerate(bars)}

T1=int(dt.datetime(2025,8,1,tzinfo=dt.timezone.utc).timestamp()*1000)
T2=int(dt.datetime(2025,9,1,tzinfo=dt.timezone.utc).timestamp()*1000)

def native_net(z): return float(z["rawReturn"])-COST

def simulate_one(z,hours,loss_thr,mfe_cap):
    # LONG only. Inspect only bars fully known before decision timestamp.
    ent=int(z["entryTs"]);native_exit=int(z["exitTs"])
    decision=ent+hours*3600000
    if native_exit<=decision:
        return {"triggered":False,"net":native_net(z),"reason":"NATIVE_EXIT_BEFORE_DECISION"}
    i0=idx.get(ent)
    idec=idx.get(decision)
    if i0 is None or idec is None:
        return {"triggered":False,"net":native_net(z),"reason":"M5_MISSING"}
    ep=float(z["entryPrice"])
    hist=bars[i0:idec]  # [entry, decision), all completed by decision
    if not hist:
        return {"triggered":False,"net":native_net(z),"reason":"EMPTY"}
    cur=hist[-1]["c"]/ep-1
    mfe=max(b["h"]/ep-1 for b in hist)
    if cur<=loss_thr and mfe<=mfe_cap:
        fill=bars[idec]["o"] # next 5m bar open at decision time
        raw=fill/ep-1
        return {"triggered":True,"net":raw-COST,"raw":raw,"decisionTs":decision,"fillPrice":fill,"cur":cur,"mfe":mfe}
    return {"triggered":False,"net":native_net(z),"cur":cur,"mfe":mfe,"reason":"NO_TRIGGER"}

def met(vals):
    if not vals:return {"n":0,"wr":None,"mean":None,"sum":0,"pf":None}
    gp=sum(v for v in vals if v>0);gl=-sum(v for v in vals if v<0)
    return {"n":len(vals),"wr":sum(v>0 for v in vals)/len(vals),"mean":sum(vals)/len(vals),"sum":sum(vals),
            "pf":gp/gl if gl else (999.0 if gp>0 else None)}

parts={
 "train":[z for z in rows if int(z["entryTs"])<T1],
 "validation":[z for z in rows if T1<=int(z["entryTs"])<T2],
 "prehold":[z for z in rows if int(z["entryTs"])>=T2],
}
base={k:met([native_net(z) for z in a]) for k,a in parts.items()}

hours_grid=(1,2,3,4)
loss_grid=(-0.005,-0.01,-0.015,-0.02,-0.025)
mfe_grid=(0.0,0.0025,0.005,0.01)
candidates=[]
for hours,loss_thr,mfe_cap in itertools.product(hours_grid,loss_grid,mfe_grid):
    rec={"rule":{"hours":hours,"lossThreshold":loss_thr,"mfeCap":mfe_cap},"splits":{}}
    for k,a in parts.items():
        sim=[simulate_one(z,hours,loss_thr,mfe_cap) for z in a]
        rec["splits"][k]={
            "metric":met([x["net"] for x in sim]),
            "triggerN":sum(x["triggered"] for x in sim),
            "triggerRate":sum(x["triggered"] for x in sim)/len(sim) if sim else None,
            "triggeredNativeNet":met([native_net(z) for z,x in zip(a,sim) if x["triggered"]]),
            "triggeredEarlyNet":met([x["net"] for x in sim if x["triggered"]])
        }
    tr=rec["splits"]["train"]["metric"]
    # Train is discovery only: require actual improvement and at least 3 triggered cases.
    train_ok=(rec["splits"]["train"]["triggerN"]>=3 and tr["mean"]>base["train"]["mean"] and
              (tr["pf"] or 0)>(base["train"]["pf"] or 0))
    rec["trainQualified"]=train_ok
    candidates.append(rec)

trainq=[x for x in candidates if x["trainQualified"]]
# validation/prehold only falsify, never tune thresholds.
rob=[]
for x in trainq:
    ok=True
    for k in ("validation","prehold"):
        m=x["splits"][k]["metric"];b=base[k]
        # no worse mean or PF, no lower win rate by >5pp, and at least one trigger in each OOS split
        if x["splits"][k]["triggerN"]<1: ok=False
        if m["mean"]<b["mean"] or (m["pf"] or 0)<(b["pf"] or 0): ok=False
        if m["wr"]+0.05<b["wr"]: ok=False
    x["oosRobust"]=ok
    if ok:rob.append(x)

# Sibling support: avoid lucky exact threshold.
def fam(x):return (x["rule"]["hours"],x["rule"]["lossThreshold"])
from collections import Counter
support=Counter(fam(x) for x in rob)
rob2=[x for x in rob if support[fam(x)]>=2]
rob2.sort(key=lambda x:(min(x["splits"]["validation"]["metric"]["pf"] or 0,x["splits"]["prehold"]["metric"]["pf"] or 0),
                        min(x["splits"]["validation"]["metric"]["mean"],x["splits"]["prehold"]["metric"]["mean"])),reverse=True)

out={
 "status":"HYPE_EARLY_ADVERSE_EXIT_PRETARGET_CAUSAL_ROBUSTNESS",
 "costBps":30,
 "candidateCount":len(candidates),
 "trainQualifiedCount":len(trainq),
 "oosRobustCount":len(rob),
 "oosSiblingRobustCount":len(rob2),
 "baseline":base,
 "selectedPretargetOnly":rob2[0] if rob2 else None,
 "topRobust":rob2[:12],
 "method":"LONG HYPE only. At 1/2/3/4h, using only completed M5 bars, if current return <= fixed adverse threshold and MFE <= cap, exit at next 5m open. Grid is fixed and small. Train discovers; August validation and September prehold only falsify. No target-year HYPE outcomes used.",
 "hashes":{"candidates":hashlib.sha256(CANDS.read_bytes()).hexdigest(),"m5":hashlib.sha256(M5.read_bytes()).hexdigest()},
 "warning":"Binance UM pretarget proxy, not Aster. Any candidate still requires one-shot integrated STABLE3 A/B and must reduce total DD, not merely HYPE loss."
}
OUT.write_text(json.dumps(out,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
print("BASE",json.dumps(base,separators=(",",":")))
print("CAND",len(candidates),"TRAINQ",len(trainq),"ROB",len(rob),"SIBLING",len(rob2))
for z in rob2[:12]:
    print("ROB",json.dumps(z,separators=(",",":")))
print("OUT",OUT,"SHA256",hashlib.sha256(OUT.read_bytes()).hexdigest())
