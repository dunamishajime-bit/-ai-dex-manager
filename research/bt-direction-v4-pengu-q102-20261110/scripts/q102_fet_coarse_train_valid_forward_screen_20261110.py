#!/usr/bin/env python3
from pathlib import Path
import json,collections,statistics,math
R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
hist=[json.loads(x) for x in (R/"Q102_S34_SELECTED_NATIVE_EXIT_M5COMPLETE_20261109"/"q102-s34-selected-native-exits.jsonl").open(encoding="utf8") if x.strip()]
fwd=[json.loads(x) for x in (R/"FORWARD_HOLDOUT_20261001_20261108"/"Q102_SELECTED_BASE"/"q102-s34-selected-native-exits.jsonl").open(encoding="utf8") if x.strip()]
def metric(a,bps=30):
 vals=[z["rawReturn"]-bps/10000 for z in a]
 gp=sum(x for x in vals if x>0);gl=-sum(x for x in vals if x<0)
 return {"n":len(vals),"wr":sum(x>0 for x in vals)/len(vals) if vals else None,"mean":sum(vals)/len(vals) if vals else None,
         "sum":sum(vals),"pf":gp/gl if gl else None}
def summary(label,a):
 print(label,"N",len(a),metric(a,10),metric(a,30))
 for f in ["ret14","strength","margin"]:
  xs=sorted(z[f] for z in a);print(" ",f,"q25",xs[len(xs)//4],"med",xs[len(xs)//2],"q75",xs[3*len(xs)//4])
Fh=[z for z in hist if z["symbol"]=="FETUSDT"]
Ff=[z for z in fwd if z["symbol"]=="FETUSDT"]
print("FET HIST/FWD");summary("HIST",Fh);summary("FWD",Ff)
print("ROUTES HIST")
for k,v in collections.defaultdict(list).items():pass
bh=collections.defaultdict(list);bf=collections.defaultdict(list)
for z in Fh:bh[z["route"]].append(z)
for z in Ff:bf[z["route"]].append(z)
for k in sorted(set(bh)|set(bf)):
 print(k,"hist",metric(bh[k],30),"fwd",metric(bf[k],30))
# Coarse quartile screens from historical first half only, evaluate second half and forward.
Fh=sorted(Fh,key=lambda z:z["entryTs"]);cut=len(Fh)//2;tr=Fh[:cut];va=Fh[cut:]
features=["ret14","strength","margin"]
cands=[]
for f in features:
 xs=sorted(z[f] for z in tr)
 for q in [.25,.5,.75]:
  t=xs[round((len(xs)-1)*q)]
  for op in ["<=",">="]:
   keep=lambda z,f=f,t=t,op=op: z[f]<=t if op=="<=" else z[f]>=t
   a=[z for z in tr if keep(z)]
   if len(a)<6:continue
   m=metric(a,30)
   if m["mean"]<=0 or (m["pf"] or 0)<=1:continue
   v=[z for z in va if keep(z)];w=[z for z in Ff if keep(z)]
   cands.append({"rule":{"feature":f,"op":op,"threshold":t},"train30":m,"valid30":metric(v,30),"fwd30":metric(w,30)})
cands=sorted(cands,key=lambda z:((z["valid30"]["pf"] or 0),z["valid30"]["mean"] or -9),reverse=True)
rob=[z for z in cands if z["valid30"]["n"]>=5 and z["fwd30"]["n"]>=3 and z["valid30"]["mean"]>0 and z["fwd30"]["mean"]>0 and (z["valid30"]["pf"] or 0)>1 and (z["fwd30"]["pf"] or 0)>1]
print("ROBUST",len(rob))
for z in rob:print(json.dumps(z,separators=(',',':')))
out={"status":"RESEARCH_COARSE_Q102_FET_SCREEN","histFetN":len(Fh),"forwardFetN":len(Ff),"hist30":metric(Fh,30),"fwd30":metric(Ff,30),
     "routesHist":{k:metric(v,30) for k,v in bh.items()},"routesForward":{k:metric(v,30) for k,v in bf.items()},
     "coarseRobustCandidates":rob,"warning":"Only quartile thresholds from historical train-half. Forward sample is small; no promotion without larger evidence."}
p=R/"DIRECTION_RESEARCH_20261109"/"q102_fet_coarse_train_valid_forward_screen_20261110.json"
p.write_text(json.dumps(out,indent=2,ensure_ascii=False)+"\n",encoding="utf8")
print("FILE",p)
