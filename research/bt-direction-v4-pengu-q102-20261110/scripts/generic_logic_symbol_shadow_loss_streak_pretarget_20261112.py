#!/usr/bin/env python3
from pathlib import Path
import json,datetime as dt,hashlib,collections

R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
OUT=R/"DIRECTION_RESEARCH_20261109"/"generic_logic_symbol_shadow_loss_streak_pretarget_20261112.json"
COST=.003
START=int(dt.datetime(2025,3,22,tzinfo=dt.timezone.utc).timestamp()*1000)
T1=int(dt.datetime(2025,7,1,tzinfo=dt.timezone.utc).timestamp()*1000)
T2=int(dt.datetime(2025,9,1,tzinfo=dt.timezone.utc).timestamp()*1000)
END=int(dt.datetime(2025,10,1,tzinfo=dt.timezone.utc).timestamp()*1000)

sources=[
 ("HYPE",R/"PREPERIOD_TRAIN_20250501_20251001"/"HYPE_BINANCE_PROXY"/"hype-preperiod-proxy-candidates-with-m5-exits.jsonl","rawReturn"),
 ("IDLE",R/"PREPERIOD_TRAIN_20250301_20251001"/"IDLE_ALL_BINANCE_PROXY"/"idle-all-preperiod-proxy-candidates-with-m5-exits.jsonl","grossReturn"),
 ("Q102",R/"PREPERIOD_TRAIN_20250322_20251001"/"Q102_SELECTED_BASE"/"q102-s34-selected-native-exits.jsonl","rawReturn"),
 ("Q102",R/"PREPERIOD_TRAIN_20240101_20251001"/"Q102_HIGHVOL_BINANCE_PROXY"/"q102-highvol-pretarget-proxy-exits.jsonl","rawReturn"),
 ("V4",R/"PREPERIOD_TRAIN_20250322_20251001"/"V4_DUALSIDE_LIFECYCLE"/"v4-pre-dualside-modeled-exits.jsonl","rawReturn"),
]
rows=[];hashes={}
for strategy,p,rf in sources:
    hashes[str(p)]=hashlib.sha256(p.read_bytes()).hexdigest()
    for line in p.read_text(encoding="utf-8").splitlines():
        if not line.strip():continue
        z=json.loads(line)
        if strategy=="V4" and z.get("mode")!="NATIVE":continue
        t=int(z["entryTs"]);x=int(z["exitTs"])
        if not (START<=t<END and x<=END):continue
        if z.get(rf) is None:continue
        rows.append({"strategy":strategy,"symbol":z["symbol"],"route":z.get("route"),"entryTs":t,"exitTs":x,
                     "ret":float(z[rf]),"id":z.get("id") or z.get("candidateId")})
rows.sort(key=lambda z:(z["entryTs"],z["exitTs"],z["strategy"],z["symbol"],str(z["id"])))

def metric(a):
    v=[z["ret"]-COST for z in a]
    gp=sum(x for x in v if x>0);gl=-sum(x for x in v if x<0)
    return {"n":len(v),"wr":sum(x>0 for x in v)/len(v) if v else None,
            "mean":sum(v)/len(v) if v else None,"sum":sum(v),
            "pf":gp/gl if gl else (999.0 if gp>0 else None)}

def simulate(streak_n):
    # Every candidate is shadow-observed at exit even when blocked.
    bykey=collections.defaultdict(list)
    decisions=[]
    for z in rows:
        key=(z["strategy"],z["symbol"])
        hist=[h for h in bykey[key] if h["exitTs"]<=z["entryTs"]]
        last=hist[-streak_n:] if len(hist)>=streak_n else []
        block=bool(len(last)==streak_n and all((h["ret"]-COST)<0 for h in last))
        decisions.append({**z,"block":block,"priorCompletedN":len(hist)})
        bykey[key].append(z)
    return decisions

def slice_metric(decisions,lo,hi):
    a=[z for z in decisions if lo<=z["entryTs"]<hi]
    adm=[z for z in a if not z["block"]];blk=[z for z in a if z["block"]]
    return {"baseline":metric(a),"admitted":metric(adm),"blocked":metric(blk),
            "blockedN":len(blk),"admittedN":len(adm)}

cases={}
for n in (2,3):
    d=simulate(n)
    cases[str(n)]={
      "train":slice_metric(d,START,T1),
      "validation":slice_metric(d,T1,T2),
      "prehold":slice_metric(d,T2,END),
    }
    # per-group validation/prehold diagnostic
    by={}
    for key in sorted({(z["strategy"],z["symbol"]) for z in d}):
        q=[z for z in d if (z["strategy"],z["symbol"])==key]
        by["|".join(key)]={
          "validation":slice_metric(q,T1,T2),
          "prehold":slice_metric(q,T2,END)
        }
    cases[str(n)]["byGroup"]=by

# Freeze based pretarget only: require validation and prehold mean+PF >= baseline, >=75% retention.
qualified=[]
for n in (2,3):
    c=cases[str(n)];ok=True
    for k in ("validation","prehold"):
        b=c[k]["baseline"];a=c[k]["admitted"]
        if a["n"]<.75*b["n"]:ok=False
        if a["mean"] is None or a["mean"]<b["mean"]:ok=False
        if (a["pf"] or 0)<(b["pf"] or 0):ok=False
    if ok:qualified.append(n)
selected=min(qualified) if qualified else None # simpler/faster reaction if both pass
out={"status":"GENERIC_LOGIC_SYMBOL_SHADOW_LOSS_STREAK_PRETARGET_ONLY",
     "counts":{"rows":len(rows)},"costBps":30,"cases":cases,
     "qualifiedPretarget":qualified,"selectedPretargetOnly":selected,
     "rule":"For each (strategy,symbol), if the last N completed shadow outcomes are all net losses, block the next real admission. All blocked candidates still update shadow history when their modeled exit completes, allowing recovery. No price threshold.",
     "antiOverfit":["Only N=2 and N=3 predeclared.","Same rule for every logic+symbol.","No target-year data read.","Validation Jul-Aug and prehold Sep both must improve mean and PF with >=75% retention."],
     "hashes":hashes}
OUT.write_text(json.dumps(out,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
print("ROWS",len(rows),"QUAL",qualified,"SELECT",selected)
for n in ("2","3"):
 print("N",n,"TRAIN",cases[n]["train"],"VALID",cases[n]["validation"],"PREHOLD",cases[n]["prehold"])
print("OUT",OUT,"SHA256",hashlib.sha256(OUT.read_bytes()).hexdigest())
