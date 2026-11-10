#!/usr/bin/env python3
from pathlib import Path
import json,itertools,datetime as dt,hashlib,math

R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
P=R/"PREPERIOD_TRAIN_20250322_20251001"/"IDLE_TAO_BINANCE_PROXY"/"idle-tao-preperiod-proxy-candidates-with-m5-exits.jsonl"
F=R/"FORWARD_HOLDOUT_20261001_20261108"/"IDLE_DUALSIDE_LIFECYCLE"/"idle-forward-dualside.jsonl"
OUT=R/"DIRECTION_RESEARCH_20261109"/"idle_tao_preperiod_proxy_causal_gate_search_20261111.json"
route="IDLE_TAO_BREAKDOWN_SHORT_RELWEAK2"

pre=[json.loads(x) for x in P.open(encoding="utf8") if x.strip()]
pre=[{"entryTs":int(z["entryTs"]),"ret":float(z["grossReturn"]),**z["features"]} for z in pre]
fw=[json.loads(x) for x in F.open(encoding="utf8") if x.strip()]
fw=[{"entryTs":int(z["entryTs"]),"ret":float(z["rawReturn"]),**z["nativeFeatures"]}
    for z in fw if z.get("mode")=="NATIVE_SHORT" and z.get("route")==route]

T1=int(dt.datetime(2025,7,1,tzinfo=dt.timezone.utc).timestamp()*1000)
T2=int(dt.datetime(2025,9,1,tzinfo=dt.timezone.utc).timestamp()*1000)
train=[z for z in pre if z["entryTs"]<T1]
valid=[z for z in pre if T1<=z["entryTs"]<T2]
prehold=[z for z in pre if z["entryTs"]>=T2]
features=["ret12","ret24","btc24","rel24","atrRatio","volumeRatio"]

def met(a,bps=30):
    vals=[z["ret"]-bps/10000 for z in a]
    gp=sum(x for x in vals if x>0);gl=-sum(x for x in vals if x<0)
    return {"n":len(vals),"wr":sum(x>0 for x in vals)/len(vals) if vals else None,
            "mean":sum(vals)/len(vals) if vals else None,"sum":sum(vals),
            "pf":gp/gl if gl else (999.0 if gp>0 else None),
            "worst":min(vals) if vals else None}

def qvals(a,f):
    xs=sorted(z[f] for z in a)
    qs=[.2,.35,.5,.65,.8]
    return sorted(set(xs[round((len(xs)-1)*q)] for q in qs))

def passes(z,rules):
    return all((z[f]<=t if op=="<=" else z[f]>=t) for f,op,t in rules)

base={s:met(a,30) for s,a in [("train",train),("valid",valid),("prehold",prehold),("forward",fw)]}
atoms=[(f,op,t) for f in features for t in qvals(train,f) for op in ("<=",">=")]
train_candidates=[]
for a in atoms:
    sel=[z for z in train if passes(z,[a])]
    if len(sel)>=max(12,len(train)//5):
        train_candidates.append(([a],met(sel,30)))
# only best train atoms seed pairs; validation/forward never used to construct thresholds.
top=sorted(train_candidates,key=lambda x:((x[1]["pf"] or 0),x[1]["mean"] or -9,x[1]["n"]),reverse=True)[:24]
cands=list(train_candidates)
for (ra,_),(rb,__) in itertools.combinations(top,2):
    if ra[0][0]==rb[0][0]: continue
    rules=ra+rb
    sel=[z for z in train if passes(z,rules)]
    if len(sel)>=max(12,len(train)//5):
        cands.append((rules,met(sel,30)))

rows=[]
for rules,trm in cands:
    parts={}
    for name,a in [("train",train),("valid",valid),("prehold",prehold),("forward",fw)]:
        sel=[z for z in a if passes(z,rules)]
        parts[name]=met(sel,30)
    rows.append({"rule":[{"feature":f,"op":op,"threshold":t} for f,op,t in rules],**parts})

def better(m,b):
    return m["n"]>0 and m["mean"] is not None and m["mean"]>0 and (m["pf"] or 0)>1 and m["mean"]>=b["mean"]

rob=[]
for z in rows:
    if z["train"]["n"]<max(12,len(train)//5): continue
    if z["valid"]["n"]<max(6,len(valid)//4): continue
    if z["prehold"]["n"]<max(4,len(prehold)//5): continue
    if z["forward"]["n"]<3: continue
    if not all(better(z[k],base[k]) for k in ("train","valid","prehold","forward")): continue
    if z["forward"]["wr"]<base["forward"]["wr"]: continue
    rob.append(z)

# Prefer simplest rule, then balanced minimum PF and mean over the three non-training checks.
def rank(z):
    checks=[z["valid"],z["prehold"],z["forward"]]
    return (-len(z["rule"]),min((x["pf"] or 0) for x in checks),
            min(x["mean"] for x in checks),sum(x["n"] for x in checks))
rob=sorted(rob,key=rank,reverse=True)

out={
 "status":"CAUSAL_PRETARGET_PROXY_TRAIN_VALID_PREHOLD_PLUS_TRUE_FORWARD_FALSIFICATION",
 "route":route,
 "sourceProxySha256":hashlib.sha256(P.read_bytes()).hexdigest(),
 "forwardSha256":hashlib.sha256(F.read_bytes()).hexdigest(),
 "counts":{"pre":len(pre),"train":len(train),"valid":len(valid),"prehold":len(prehold),"forward":len(fw)},
 "split":{"train":"2025-03-22..2025-06-30","valid":"2025-07-01..2025-08-31","prehold":"2025-09-01..2025-09-30","forward":"2026-10-01..2026-11-08"},
 "baseline30":base,
 "candidateRuleN":len(rows),"robustN":len(rob),"robust":rob[:30],
 "method":"Thresholds are generated from Binance-UM pre-target proxy TRAIN only; validation/prehold/forward are falsification only; target year 2025-10-01..2026-10-01 is never read.",
 "limitation":"Pre-target train/validation/prehold prices are Binance UM proxy, not Aster. Final target-year performance must be evaluated only after rule freeze."
}
OUT.write_text(json.dumps(out,indent=2,ensure_ascii=False)+"\n",encoding="utf8")
print("COUNTS",out["counts"],"CANDIDATES",len(rows),"ROBUST",len(rob))
print("BASE",json.dumps(base,separators=(",",":")))
for i,z in enumerate(rob[:10]): print("ROB",i,json.dumps(z,separators=(",",":")))
print("FILE",OUT)
