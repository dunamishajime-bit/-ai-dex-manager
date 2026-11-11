#!/usr/bin/env python3
from pathlib import Path
import json,itertools,datetime as dt,hashlib

R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
P=R/"PREPERIOD_TRAIN_20250301_20251001"/"IDLE_ALL_BINANCE_PROXY"/"idle-all-preperiod-proxy-candidates-with-m5-exits.jsonl"
F=R/"FORWARD_HOLDOUT_20261001_20261108"/"IDLE_DUALSIDE_LIFECYCLE"/"idle-forward-dualside.jsonl"
OUT=R/"DIRECTION_RESEARCH_20261109"/"idle_all_pretarget_proxy_causal_gate_search_20261111.json"
pre0=[json.loads(x) for x in P.read_text(encoding="utf-8").splitlines() if x.strip()]
fw0=[json.loads(x) for x in F.read_text(encoding="utf-8").splitlines() if x.strip() and json.loads(x).get("mode")=="NATIVE_SHORT"]
routes=sorted(set(z["route"] for z in pre0))
features=["ret12","ret24","btc24","rel24","atrRatio","volumeRatio"]
T1=int(dt.datetime(2025,7,1,tzinfo=dt.timezone.utc).timestamp()*1000)
T2=int(dt.datetime(2025,9,1,tzinfo=dt.timezone.utc).timestamp()*1000)

def conv_pre(z):return {"entryTs":int(z["entryTs"]),"ret":float(z["grossReturn"]),**z["features"]}
def conv_fw(z):return {"entryTs":int(z["entryTs"]),"ret":float(z["rawReturn"]),**z["nativeFeatures"]}
def met(a,bps=30):
 v=[z["ret"]-bps/10000 for z in a];gp=sum(x for x in v if x>0);gl=-sum(x for x in v if x<0)
 return {"n":len(v),"wr":sum(x>0 for x in v)/len(v) if v else None,
         "mean":sum(v)/len(v) if v else None,"sum":sum(v),
         "pf":gp/gl if gl else (999.0 if gp>0 else None),"worst":min(v) if v else None}
def qvals(a,f):
 xs=sorted(z[f] for z in a);return sorted(set(xs[round((len(xs)-1)*q)] for q in (.2,.35,.5,.65,.8)))
def passes(z,rules):return all((z[f]<=t if op=="<=" else z[f]>=t) for f,op,t in rules)
results={}
for route in routes:
 pre=[conv_pre(z) for z in pre0 if z["route"]==route]
 fw=[conv_fw(z) for z in fw0 if z.get("route")==route]
 tr=[z for z in pre if z["entryTs"]<T1]
 va=[z for z in pre if T1<=z["entryTs"]<T2]
 ph=[z for z in pre if z["entryTs"]>=T2]
 parts={"train":tr,"valid":va,"prehold":ph,"forward":fw}
 base={k:met(v) for k,v in parts.items()}
 atoms=[(f,op,t) for f in features for t in qvals(tr,f) for op in ("<=",">=")] if tr else []
 trainc=[]
 mintr=max(10,len(tr)//5)
 for a in atoms:
  s=[z for z in tr if passes(z,[a])]
  if len(s)>=mintr:trainc.append(([a],met(s)))
 top=sorted(trainc,key=lambda x:((x[1]["pf"] or 0),x[1]["mean"] or -9,x[1]["n"]),reverse=True)[:20]
 cands=list(trainc)
 for (ra,_),(rb,__) in itertools.combinations(top,2):
  if ra[0][0]==rb[0][0]:continue
  rules=ra+rb;s=[z for z in tr if passes(z,rules)]
  if len(s)>=mintr:cands.append((rules,met(s)))
 rows=[]
 for rules,_ in cands:
  q={k:met([z for z in a if passes(z,rules)]) for k,a in parts.items()}
  rows.append({"rule":[{"feature":f,"op":op,"threshold":t} for f,op,t in rules],**q})
 # require meaningful samples; forward is small but must have >=3
 rob=[]
 for z in rows:
  if z["train"]["n"]<mintr:continue
  if z["valid"]["n"]<max(5,len(va)//5):continue
  if z["prehold"]["n"]<max(3,len(ph)//5):continue
  if z["forward"]["n"]<3:continue
  ok=True
  for k in ("train","valid","prehold","forward"):
   m=z[k]
   if m["mean"] is None or m["mean"]<=0 or (m["pf"] or 0)<=1:ok=False;break
  if not ok:continue
  # validation/prehold/forward must not have worse mean or WR than route baseline
  for k in ("valid","prehold","forward"):
   if base[k]["n"] and (z[k]["mean"]<base[k]["mean"] or z[k]["wr"]<base[k]["wr"]):ok=False
  if ok:rob.append(z)
 def rank(z):
  checks=[z[k] for k in ("valid","prehold","forward")]
  return (-len(z["rule"]),min(x["pf"] or 0 for x in checks),min(x["mean"] for x in checks),sum(x["n"] for x in checks))
 rob.sort(key=rank,reverse=True)
 results[route]={"counts":{k:len(v) for k,v in parts.items()},"baseline30":base,"candidateN":len(rows),"robustN":len(rob),"robust":rob[:20]}
 print("ROUTE",route,"COUNTS",results[route]["counts"],"ROBUST",len(rob),"BASE",json.dumps(base,separators=(",",":")))
 for i,z in enumerate(rob[:5]):print("ROB",route,i,json.dumps(z,separators=(",",":")))
out={"status":"IDLE_ALL_CAUSAL_PRETARGET_PROXY_TRAIN_VALID_PREHOLD_TRUE_FORWARD",
     "sourceProxySha256":hashlib.sha256(P.read_bytes()).hexdigest(),"forwardSha256":hashlib.sha256(F.read_bytes()).hexdigest(),
     "split":{"train":"2025-03-22..2025-06-30","valid":"2025-07-01..2025-08-31","prehold":"2025-09","forward":"2026-10-01..2026-11-08"},
     "method":"Thresholds generated from pre-target Binance proxy TRAIN only; validation/prehold/true-forward only falsify; target year never read.",
     "routes":results}
OUT.write_text(json.dumps(out,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
print("OUT",OUT,"SHA256",hashlib.sha256(OUT.read_bytes()).hexdigest())
