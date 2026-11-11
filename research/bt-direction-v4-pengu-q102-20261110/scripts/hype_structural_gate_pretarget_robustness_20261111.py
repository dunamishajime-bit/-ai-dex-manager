#!/usr/bin/env python3
from pathlib import Path
import json,datetime as dt,hashlib,itertools,collections,math

R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
PRE=R/"PREPERIOD_TRAIN_20250501_20251001"/"HYPE_BINANCE_PROXY"/"hype-preperiod-proxy-candidates-with-m5-exits.jsonl"
OUT=R/"DIRECTION_RESEARCH_20261109"/"hype_structural_gate_pretarget_robustness_20261111.json"
COST=.003
rows=[json.loads(x) for x in PRE.read_text(encoding="utf-8").splitlines() if x.strip()]
T1=int(dt.datetime(2025,8,1,tzinfo=dt.timezone.utc).timestamp()*1000)
T2=int(dt.datetime(2025,9,1,tzinfo=dt.timezone.utc).timestamp()*1000)
train=[z for z in rows if z["entryTs"]<T1]
valid=[z for z in rows if T1<=z["entryTs"]<T2]
prehold=[z for z in rows if z["entryTs"]>=T2]
parts={"train":train,"validation":valid,"prehold":prehold}
features=["regimeSlopeBps","breakoutBps","atrRatio","distanceSlowBps","fastSlowBps","regimeDistanceBps","hypeRet24","hypeRet72","btcRet24"]

def met(a):
 v=[float(z["rawReturn"])-COST for z in a];gp=sum(x for x in v if x>0);gl=-sum(x for x in v if x<0)
 return {"n":len(v),"wr":sum(x>0 for x in v)/len(v) if v else None,
         "mean":sum(v)/len(v) if v else None,"sum":sum(v),
         "pf":gp/gl if gl else (999.0 if gp>0 else None)}
base={k:met(v) for k,v in parts.items()}
def qval(f,q):
 xs=sorted(float(z["features"][f]) for z in train)
 return xs[round((len(xs)-1)*q)]
def keep(z,r):
 x=float(z["features"][r["feature"]]);return x>=r["threshold"] if r["op"]==">=" else x<=r["threshold"]
cands=[]
# single-feature only; no pairs because n=39 is too small for interaction search.
for f in features:
 for q in (.25,.5,.75):
  for op in ("<=",">="):
   r={"feature":f,"q":q,"op":op,"threshold":qval(f,q)}
   ms={k:met([z for z in a if keep(z,r)]) for k,a in parts.items()}
   retain=all(ms[k]["n"]>=max(4,math.ceil(len(parts[k])*.35)) for k in parts)
   # rule must improve validation AND prehold, never turn any split negative, and
   # not degrade validation/prehold win rate.
   ok=retain and all(ms[k]["mean"] is not None and ms[k]["mean"]>0 and (ms[k]["pf"] or 0)>1 for k in parts)
   if ok:
    for k in ("validation","prehold"):
     if ms[k]["mean"]<=base[k]["mean"] or ms[k]["wr"]<base[k]["wr"]:ok=False
   cands.append({"rule":r,"metrics":ms,"robust":ok})
rob=[x for x in cands if x["robust"]]
# Require sibling threshold support on the same feature+operator to avoid a lucky cut.
cnt=collections.Counter((x["rule"]["feature"],x["rule"]["op"]) for x in rob)
rob2=[x for x in rob if cnt[(x["rule"]["feature"],x["rule"]["op"])]>=2]
rob2.sort(key=lambda x:(min(x["metrics"]["validation"]["pf"],x["metrics"]["prehold"]["pf"]),
                         min(x["metrics"]["validation"]["mean"],x["metrics"]["prehold"]["mean"])),reverse=True)
out={"status":"HYPE_PRETARGET_SIMPLE_STRUCTURAL_ROBUSTNESS_ONLY",
 "costBps":30,
 "split":{"train":"2025-06..07","validation":"2025-08","prehold":"2025-09"},
 "counts":{k:len(v) for k,v in parts.items()},"baseline30":base,
 "candidateN":len(cands),"robustBeforeSiblingCheck":len(rob),"robustAfterSiblingCheck":len(rob2),
 "selectedPretargetOnly":rob2[0] if rob2 else None,
 "method":"Single-feature rules only; thresholds from train quartiles; validation and prehold both must improve mean and not lose WR; >=35% retained; at least two sibling thresholds on same feature/operator required.",
 "hash":hashlib.sha256(PRE.read_bytes()).hexdigest(),
 "warning":"Binance UM pretarget proxy only. No target-year HYPE outcome is used."
}
OUT.write_text(json.dumps(out,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
print("COUNTS",out["counts"],"BASE",json.dumps(base,separators=(",",":")))
print("ROBUST",len(rob),"SIBLING",len(rob2))
for z in rob2[:8]:print("R",json.dumps(z,separators=(",",":")))
print("OUT",OUT,"SHA256",hashlib.sha256(OUT.read_bytes()).hexdigest())
