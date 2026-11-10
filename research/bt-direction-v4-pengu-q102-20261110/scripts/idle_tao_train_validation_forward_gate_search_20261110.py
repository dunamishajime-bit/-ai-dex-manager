#!/usr/bin/env python3
from pathlib import Path
import json,statistics,itertools
R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
hist_raw=[json.loads(x) for x in (R/"native-new-signal-20251001-20261001"/"native-IDLE-raw-intentions.jsonl").open(encoding="utf8") if x.strip()]
hist_exit=json.loads((R/"native-new-signal-20251001-20261001"/"native-IDLE-all-intent-modeled-5m-exit-audit.json").read_text(encoding="utf8"))["trades"]
fwd=[json.loads(x) for x in (R/"FORWARD_HOLDOUT_20261001_20261108"/"IDLE_DUALSIDE_LIFECYCLE"/"idle-forward-dualside.jsonl").open(encoding="utf8") if x.strip() and json.loads(x).get("mode")=="NATIVE_SHORT"]
route="IDLE_TAO_BREAKDOWN_SHORT_RELWEAK2"
H={(z["entryTs"],z["symbol"],z["route"]):z for z in hist_raw if z["route"]==route}
rows=[]
for e in hist_exit:
 if e["route"]!=route:continue
 r=H[(e["entryTs"],e["symbol"],e["route"])]
 rows.append({"entryTs":e["entryTs"],"ret":e["grossReturn"],**r["features"]})
rows=sorted(rows,key=lambda z:z["entryTs"])
fw=[{"entryTs":z["entryTs"],"ret":z["rawReturn"],**z["nativeFeatures"]} for z in fwd if z["route"]==route]
cut=len(rows)//2;train=rows[:cut];valid=rows[cut:]
features=["ret12","ret24","btc24","rel24","atrRatio","volumeRatio"]
def met(a,bps=30):
 vals=[z["ret"]-bps/10000 for z in a];gp=sum(x for x in vals if x>0);gl=-sum(x for x in vals if x<0)
 return {"n":len(vals),"wr":sum(x>0 for x in vals)/len(vals) if vals else None,"mean":sum(vals)/len(vals) if vals else None,
         "sum":sum(vals),"pf":gp/gl if gl else None}
def qvals(a,f):
 xs=sorted(z[f] for z in a);return sorted(set(xs[round((len(xs)-1)*q)] for q in [.15,.25,.35,.5,.65,.75,.85]))
def passes(z,r):return all(z[f]<=t if o=="<=" else z[f]>=t for f,o,t in r)
atoms=[(f,o,t) for f in features for t in qvals(train,f) for o in ["<=",">="]]
c=[]
for a in atoms:
 sel=[z for z in train if passes(z,[a])]
 if len(sel)>=max(5,len(train)//5):c.append(([a],met(sel,30)))
top=sorted(c,key=lambda x:((x[1]["pf"] or 0),x[1]["mean"] or -9),reverse=True)[:20]
for (a,_),(b,__) in itertools.combinations(top,2):
 if a[0][0]==b[0][0]:continue
 rr=a+b;sel=[z for z in train if passes(z,rr)]
 if len(sel)>=max(5,len(train)//5):c.append((rr,met(sel,30)))
base={"train30":met(train,30),"valid30":met(valid,30),"fwd30":met(fw,30),"train10":met(train,10),"valid10":met(valid,10),"fwd10":met(fw,10)}
short=[]
for rr,m in c:
 if m["n"]<max(5,len(train)//4) or m["mean"]<=0 or (m["pf"] or 0)<=1.2 or m["wr"]<base["train30"]["wr"]:continue
 vv=[z for z in valid if passes(z,rr)];ff=[z for z in fw if passes(z,rr)]
 short.append({"rule":[{"feature":f,"op":o,"threshold":t} for f,o,t in rr],"train30":m,"valid30":met(vv,30),"fwd30":met(ff,30),
               "valid10":met(vv,10),"fwd10":met(ff,10)})
short=sorted(short,key=lambda z:((z["valid30"]["pf"] or 0),z["valid30"]["mean"] or -9,z["valid30"]["n"]),reverse=True)
rob=[z for z in short if z["valid30"]["n"]>=5 and z["fwd30"]["n"]>=4 and z["valid30"]["mean"]>0 and z["fwd30"]["mean"]>0 and
     (z["valid30"]["pf"] or 0)>1 and (z["fwd30"]["pf"] or 0)>1 and z["fwd30"]["wr"]>=base["fwd30"]["wr"]]
out={"status":"RESEARCH_TRAIN_ONLY_IDLE_TAO_FORWARD_FALSIFICATION","route":route,"histN":len(rows),"trainN":len(train),"validN":len(valid),
     "fwdN":len(fw),"baseline":base,"robustN":len(rob),"robust":rob[:20],"topValidation":short[:20]}
p=R/"DIRECTION_RESEARCH_20261109"/"idle_tao_train_validation_forward_gate_search_20261110.json"
p.write_text(json.dumps(out,indent=2,ensure_ascii=False)+"\n",encoding="utf8")
print("COUNTS",len(rows),len(train),len(valid),len(fw),"ROB",len(rob));print("BASE",json.dumps(base,separators=(',',':')))
for i,z in enumerate(rob[:10]):print("ROB",i,json.dumps(z,separators=(',',':')))
print("FILE",p)
