#!/usr/bin/env python3
from pathlib import Path
import json, datetime, itertools, hashlib

R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
PRE=R/"PREPERIOD_TRAIN_20250322_20251001"/"Q102_SELECTED_BASE"/"q102-s34-selected-native-exits.jsonl"
FWD=R/"FORWARD_HOLDOUT_20261001_20261108"/"Q102_SELECTED_BASE"/"q102-s34-selected-native-exits.jsonl"
OUT=R/"DIRECTION_RESEARCH_20261109"/"q102_family_pretarget_robust_gate_search_20261111.json"

def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def rows(p): return [json.loads(x) for x in p.read_text(encoding="utf-8").splitlines() if x.strip()]
pre=rows(PRE); fwd=rows(FWD)
def ym(x): return datetime.datetime.fromtimestamp(x["entryTs"]/1000,datetime.timezone.utc).strftime("%Y-%m")
def metric(a,bps=30):
    vals=[x["rawReturn"]-bps/10000 for x in a]
    gp=sum(x for x in vals if x>0); gl=-sum(x for x in vals if x<0)
    return {"n":len(vals),"wr":sum(x>0 for x in vals)/len(vals) if vals else None,
            "mean":sum(vals)/len(vals) if vals else None,"sum":sum(vals),
            "pf":gp/gl if gl else (999.0 if gp>0 else None)}
def qvals(a,f):
    xs=sorted(x[f] for x in a)
    return sorted(set(xs[round((len(xs)-1)*q)] for q in (.2,.3,.4,.5,.6,.7,.8)))
features=("ret14","strength","margin")
result={"status":"Q102_PRETARGET_FAMILY_CAUSAL_GATE_SEARCH","costBps":30,
        "periods":{"train":"2025-03-22..2025-06-30","validation":"2025-07-01..2025-08-31",
                   "prehold":"2025-09-01..2025-09-30","forward":"2026-10-01..2026-11-08"},
        "inputs":{"pre":str(PRE),"preSha256":sha(PRE),"forward":str(FWD),"forwardSha256":sha(FWD)},
        "features":list(features),"families":{},"selectionRule":"Thresholds from train quantiles only; one- and two-feature AND rules. No target-year outcomes used."}
for family in ("MR","REV","PB","BRK"):
    allpre=[x for x in pre if x["family"]==family]
    tr=[x for x in allpre if ym(x)<="2025-06"]
    va=[x for x in allpre if ym(x) in ("2025-07","2025-08")]
    ph=[x for x in allpre if ym(x)=="2025-09"]
    fw=[x for x in fwd if x["family"]==family]
    base={"train":metric(tr),"validation":metric(va),"prehold":metric(ph),"forward":metric(fw)}
    robust=[]
    if len(tr)>=10:
        singles=[]
        for f in features:
            for t in qvals(tr,f):
                for op in ("<=",">="):
                    singles.append((f,op,t))
        candidates=[(x,) for x in singles]
        candidates += [(a,b) for a,b in itertools.combinations(singles,2) if a[0]!=b[0]]
        def keep(x,rule):
            return all((x[f]<=t if op=="<=" else x[f]>=t) for f,op,t in rule)
        for rule in candidates:
            sets=[[x for x in s if keep(x,rule)] for s in (tr,va,ph,fw)]
            ms=[metric(s) for s in sets]
            if ms[0]["n"]<max(6,len(tr)//4): continue
            if ms[1]["n"]<3 or (ph and ms[2]["n"]<2) or (fw and ms[3]["n"]<2): continue
            if any(m["n"] and (m["mean"] is None or m["mean"]<=0 or (m["pf"] or 0)<=1) for m in ms): continue
            robust.append({"rule":[{"feature":f,"op":op,"threshold":t} for f,op,t in rule],
                           "train":ms[0],"validation":ms[1],"prehold":ms[2],"forward":ms[3]})
    robust.sort(key=lambda z:(z["validation"]["mean"] or -9,z["prehold"]["mean"] or -9,z["forward"]["mean"] or -9),reverse=True)
    result["families"][family]={"baseline":base,"robustCandidates":robust}
result["robustCandidateCount"]=sum(len(v["robustCandidates"]) for v in result["families"].values())
result["decision"]="NO_NEW_Q102_FAMILY_GATE" if result["robustCandidateCount"]==0 else "REVIEW_CANDIDATES"
OUT.write_text(json.dumps(result,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
print("Q102_FAMILY_CAUSAL_SEARCH",result["decision"],"ROBUST",result["robustCandidateCount"])
for family,v in result["families"].items():
    print(family,"BASE",json.dumps(v["baseline"],separators=(",",":")),"ROBUST",len(v["robustCandidates"]))
print("OUTPUT",OUT,"SHA256",sha(OUT))
