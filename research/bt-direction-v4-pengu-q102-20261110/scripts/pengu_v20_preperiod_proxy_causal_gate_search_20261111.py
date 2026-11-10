#!/usr/bin/env python3
from pathlib import Path
import json,itertools,datetime as dt,hashlib

R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
P=R/"PREPERIOD_TRAIN_20250101_20251001"/"PENGU_V20_BINANCE_PROXY"/"pengu-v20-preperiod-proxy-candidates-with-native-exits.jsonl"
FR=R/"FORWARD_HOLDOUT_20261001_20261108"/"PENGU_FORWARD"/"native-PENGU-raw-intentions.jsonl"
FE=R/"FORWARD_HOLDOUT_20261001_20261108"/"PENGU_NATIVE_LIFECYCLE"/"pengu-native-lifecycle-modeled-exits.jsonl"
OUT=R/"DIRECTION_RESEARCH_20261109"/"pengu_v20_preperiod_proxy_causal_gate_search_20261111.json"

pre0=[json.loads(x) for x in P.open(encoding="utf8") if x.strip()]
pre=[{
 "entryTs":int(z["entryTs"]),"ret":float(z["rawReturn"]),
 "pengu72h":float(z["features"]["penguReturn72h"]),
 "btc24h":float(z["features"]["btcReturn24h"]),
 "rel72_24":float(z["features"]["penguReturn72h"])-float(z["features"]["btcReturn24h"])
} for z in pre0]
raw=[json.loads(x) for x in FR.open(encoding="utf8") if x.strip() and json.loads(x).get("route")=="SHORT_V20"]
ex=[json.loads(x) for x in FE.open(encoding="utf8") if x.strip() and json.loads(x).get("route")=="SHORT_V20"]
rm={(int(z["entryTs"]),z["route"]):z for z in raw}
fw=[]
for e in ex:
 k=(int(e["entryTs"]),e["route"])
 if k not in rm: continue
 z=rm[k]
 fw.append({"entryTs":int(e["entryTs"]),"ret":float(e["rawReturn"]),
            "pengu72h":float(z["pengu72h"]),"btc24h":float(z["btc24h"]),
            "rel72_24":float(z["pengu72h"])-float(z["btc24h"])})
fw.sort(key=lambda z:z["entryTs"])

JUN=int(dt.datetime(2025,6,1,tzinfo=dt.timezone.utc).timestamp()*1000)
AUG=int(dt.datetime(2025,8,1,tzinfo=dt.timezone.utc).timestamp()*1000)
train=[z for z in pre if z["entryTs"]<JUN]
valid=[z for z in pre if JUN<=z["entryTs"]<AUG]
prehold=[z for z in pre if z["entryTs"]>=AUG]
features=["pengu72h","btc24h","rel72_24"]

def met(a,bps=30):
 vals=[z["ret"]-bps/10000 for z in a]
 gp=sum(x for x in vals if x>0); gl=-sum(x for x in vals if x<0)
 return {"n":len(vals),"wr":sum(x>0 for x in vals)/len(vals) if vals else None,
         "mean":sum(vals)/len(vals) if vals else None,"sum":sum(vals),
         "pf":gp/gl if gl else (999.0 if gp>0 else None),"worst":min(vals) if vals else None}
def qvals(a,f):
 xs=sorted(z[f] for z in a)
 return sorted(set(xs[round((len(xs)-1)*q)] for q in [.15,.25,.35,.5,.65,.75,.85]))
def passes(z,rules):
 return all((z[f]<=t if op=="<=" else z[f]>=t) for f,op,t in rules)

sets={"train":train,"valid":valid,"prehold":prehold,"forward":fw}
base={k:met(v,30) for k,v in sets.items()}
atoms=[(f,op,t) for f in features for t in qvals(train,f) for op in ("<=",">=")]
cands=[]
for a in atoms:
 sel=[z for z in train if passes(z,[a])]
 if len(sel)>=10: cands.append(([a],met(sel,30)))
top=sorted(cands,key=lambda x:((x[1]["pf"] or 0),x[1]["mean"] or -9,x[1]["n"]),reverse=True)[:18]
for (ra,_),(rb,__) in itertools.combinations(top,2):
 if ra[0][0]==rb[0][0]: continue
 rules=ra+rb
 sel=[z for z in train if passes(z,rules)]
 if len(sel)>=10: cands.append((rules,met(sel,30)))

rows=[]
for rules,tr in cands:
 z={"rule":[{"feature":f,"op":o,"threshold":t} for f,o,t in rules]}
 for name,a in sets.items(): z[name]=met([x for x in a if passes(x,rules)],30)
 rows.append(z)

def improved(m,b, min_n):
 return (m["n"]>=min_n and m["mean"] is not None and m["mean"]>0
         and (m["pf"] or 0)>1 and m["mean"]>=b["mean"]
         and m["wr"]>=b["wr"])

rob=[]
for z in rows:
 if z["train"]["n"]<10: continue
 if not improved(z["train"],base["train"],10): continue
 if not improved(z["valid"],base["valid"],3): continue
 if not improved(z["prehold"],base["prehold"],4): continue
 if not improved(z["forward"],base["forward"],3): continue
 rob.append(z)
def score(z):
 checks=[z["valid"],z["prehold"],z["forward"]]
 return (-len(z["rule"]),min(x["pf"] or 0 for x in checks),min(x["mean"] for x in checks),sum(x["n"] for x in checks))
rob=sorted(rob,key=score,reverse=True)

out={
 "status":"CAUSAL_PRETARGET_PROXY_TRAIN_VALID_PREHOLD_PLUS_TRUE_FORWARD_FALSIFICATION",
 "route":"SHORT_V20",
 "counts":{"pre":len(pre),"train":len(train),"valid":len(valid),"prehold":len(prehold),
           "forwardRaw":len(raw),"forwardExit":len(ex),"forwardMatched":len(fw)},
 "split":{"train":"2025-01-01..2025-05-31","valid":"2025-06-01..2025-07-31",
          "prehold":"2025-08-01..2025-09-30","forward":"2026-10-01..2026-11-08"},
 "baseline30":base,"candidateRuleN":len(rows),"robustN":len(rob),"robust":rob[:30],
 "method":"Thresholds generated from pre-target Binance-UM TRAIN only. Validation, prehold, and true Aster forward are falsification only. Target year is never read.",
 "sourceHashes":{"pre":hashlib.sha256(P.read_bytes()).hexdigest(),
                 "forwardRaw":hashlib.sha256(FR.read_bytes()).hexdigest(),
                 "forwardExit":hashlib.sha256(FE.read_bytes()).hexdigest()},
 "limitation":"Pre-target prices are Binance UM proxy, not Aster. A robust rule must also pass cross-venue feature agreement before target-year evaluation."
}
OUT.write_text(json.dumps(out,indent=2,ensure_ascii=False)+"\n",encoding="utf8")
print("COUNTS",out["counts"],"CANDIDATES",len(rows),"ROBUST",len(rob))
print("BASE",json.dumps(base,separators=(",",":")))
for i,z in enumerate(rob[:10]): print("ROB",i,json.dumps(z,separators=(",",":")))
print("FILE",OUT)
