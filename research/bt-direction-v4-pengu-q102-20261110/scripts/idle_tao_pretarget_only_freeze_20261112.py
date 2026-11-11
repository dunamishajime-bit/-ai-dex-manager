#!/usr/bin/env python3
from pathlib import Path
import json,itertools,datetime as dt,hashlib,collections,math

R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
P=R/"PREPERIOD_TRAIN_20250322_20251001"/"IDLE_TAO_BINANCE_PROXY"/"idle-tao-preperiod-proxy-candidates-with-m5-exits.jsonl"
F=R/"FORWARD_HOLDOUT_20261001_20261108"/"IDLE_DUALSIDE_LIFECYCLE"/"idle-forward-dualside.jsonl"
OUT=R/"DIRECTION_RESEARCH_20261109"/"idle_tao_pretarget_only_freeze_20261112.json"
route="IDLE_TAO_BREAKDOWN_SHORT_RELWEAK2"
pre0=[json.loads(x) for x in P.read_text(encoding="utf-8").splitlines() if x.strip()]
pre=[{"entryTs":int(z["entryTs"]),"ret":float(z["grossReturn"]),**z["features"]} for z in pre0]
fw0=[json.loads(x) for x in F.read_text(encoding="utf-8").splitlines() if x.strip()]
fw=[{"entryTs":int(z["entryTs"]),"ret":float(z["rawReturn"]),**z["nativeFeatures"]}
    for z in fw0 if z.get("mode")=="NATIVE_SHORT" and z.get("route")==route]
T1=int(dt.datetime(2025,7,1,tzinfo=dt.timezone.utc).timestamp()*1000)
T2=int(dt.datetime(2025,9,1,tzinfo=dt.timezone.utc).timestamp()*1000)
train=[z for z in pre if z["entryTs"]<T1];valid=[z for z in pre if T1<=z["entryTs"]<T2];prehold=[z for z in pre if z["entryTs"]>=T2]
features=["ret12","ret24","btc24","rel24","atrRatio","volumeRatio"]

def met(a,bps=30):
 vals=[z["ret"]-bps/10000 for z in a];gp=sum(x for x in vals if x>0);gl=-sum(x for x in vals if x<0)
 return {"n":len(vals),"wr":sum(x>0 for x in vals)/len(vals) if vals else None,
         "mean":sum(vals)/len(vals) if vals else None,"sum":sum(vals),
         "pf":gp/gl if gl else (999.0 if gp>0 else None),"worst":min(vals) if vals else None}
def qvals(a,f):
 xs=sorted(z[f] for z in a);return sorted(set(xs[round((len(xs)-1)*q)] for q in (.2,.35,.5,.65,.8)))
def passr(z,r):return z[r["feature"]]<=r["threshold"] if r["op"]=="<=" else z[r["feature"]]>=r["threshold"]

base={"train":met(train),"valid":met(valid),"prehold":met(prehold),"forward":met(fw)}
cand=[]
for f in features:
 for t in qvals(train,f):
  for op in ("<=",">="):
   r={"feature":f,"op":op,"threshold":t}
   ss={k:[z for z in a if passr(z,r)] for k,a in (("train",train),("valid",valid),("prehold",prehold))}
   mm={k:met(v) for k,v in ss.items()}
   retain=mm["train"]["n"]>=14 and mm["valid"]["n"]>=8 and mm["prehold"]["n"]>=4
   ok=retain and all(mm[k]["mean"] is not None and mm[k]["mean"]>0 and (mm[k]["pf"] or 0)>1 for k in ("train","valid","prehold"))
   if ok:
    # validation and prehold must improve both mean and PF vs no gate
    ok=all(mm[k]["mean"]>=base[k]["mean"] and (mm[k]["pf"] or 0)>=(base[k]["pf"] or 0) for k in ("valid","prehold"))
   cand.append({"rule":r,**mm,"pretargetQualified":ok})

qualified=[x for x in cand if x["pretargetQualified"]]
# sibling support: at least 2 thresholds on same feature/op must qualify
cnt=collections.Counter((x["rule"]["feature"],x["rule"]["op"]) for x in qualified)
qualified=[x for x in qualified if cnt[(x["rule"]["feature"],x["rule"]["op"])]>=2]
# Freeze without forward: prefer broad retention, then worst-of-valid/prehold PF, then mean.
qualified.sort(key=lambda x:(min(x["valid"]["n"]/len(valid),x["prehold"]["n"]/len(prehold)),
                             min(x["valid"]["pf"],x["prehold"]["pf"]),
                             min(x["valid"]["mean"],x["prehold"]["mean"])),reverse=True)
selected=qualified[0] if qualified else None
forward=None
forwardPass=False
if selected:
 r=selected["rule"]; s=[z for z in fw if passr(z,r)]; forward=met(s)
 forwardPass=(forward["n"]>=3 and forward["mean"] is not None and forward["mean"]>0 and (forward["pf"] or 0)>1 and forward["wr"]>=base["forward"]["wr"])
out={"status":"IDLE_TAO_PRETARGET_ONLY_FREEZE_FORWARD_VETO",
     "baseline30":base,"qualifiedPretargetN":len(qualified),
     "selectedPretargetOnly":selected,"forwardVetoMetric":forward,"forwardPass":forwardPass,
     "method":"Single-feature thresholds generated from TRAIN only. Selection ranks only pretarget train/validation/prehold; true forward is consulted only after freeze as veto, never for ranking.",
     "hashes":{"pre":hashlib.sha256(P.read_bytes()).hexdigest(),"forward":hashlib.sha256(F.read_bytes()).hexdigest()}}
OUT.write_text(json.dumps(out,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
print("BASE",json.dumps(base,separators=(",",":")))
print("QUALIFIED",len(qualified))
for z in qualified[:12]: print("PRE",json.dumps(z,separators=(",",":")))
print("SELECTED",json.dumps(selected,separators=(",",":")) if selected else None)
print("FORWARD",json.dumps(forward,separators=(",",":")) if forward else None,"PASS",forwardPass)
print("OUT",OUT,"SHA256",hashlib.sha256(OUT.read_bytes()).hexdigest())
