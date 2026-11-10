#!/usr/bin/env python3
from pathlib import Path
import json,statistics,itertools,hashlib
R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
hist_raw=[json.loads(x) for x in (R/"native-new-signal-20251001-20261001"/"native-PENGU-raw-intentions.jsonl").open(encoding="utf8") if x.strip()]
hist_exit=[json.loads(x) for x in (R/"PENGU_NATIVE_LIFECYCLE_EXIT_20261109"/"pengu-native-lifecycle-modeled-exits.jsonl").open(encoding="utf8") if x.strip()]
fwd_raw=[json.loads(x) for x in (R/"FORWARD_HOLDOUT_20261001_20261108"/"PENGU_FORWARD"/"native-PENGU-raw-intentions.jsonl").open(encoding="utf8") if x.strip()]
fwd_exit=[json.loads(x) for x in (R/"FORWARD_HOLDOUT_20261001_20261108"/"PENGU_NATIVE_LIFECYCLE"/"pengu-native-lifecycle-modeled-exits.jsonl").open(encoding="utf8") if x.strip()]
route="RECOVERY_V8"
H={(z["entryTs"],z["route"]):z for z in hist_raw}
F={(z["entryTs"],z["route"]):z for z in fwd_raw}
rows=[]
for e in hist_exit:
 if e["route"]!=route:continue
 r=H[(e["entryTs"],e["route"])]
 rows.append({"entryTs":e["entryTs"],"ret":e["rawReturn"],"pengu72h":r["pengu72h"],"btc24h":r["btc24h"],
              "rel72_24":r["pengu72h"]-r["btc24h"]})
rows=sorted(rows,key=lambda z:z["entryTs"])
fw=[]
for e in fwd_exit:
 if e["route"]!=route:continue
 r=F[(e["entryTs"],e["route"])]
 fw.append({"entryTs":e["entryTs"],"ret":e["rawReturn"],"pengu72h":r["pengu72h"],"btc24h":r["btc24h"],
            "rel72_24":r["pengu72h"]-r["btc24h"]})
cut=len(rows)//2;train=rows[:cut];valid=rows[cut:]
features=["pengu72h","btc24h","rel72_24"]
def metrics(a,bps=30):
 vals=[z["ret"]-bps/10000 for z in a]
 gp=sum(x for x in vals if x>0);gl=-sum(x for x in vals if x<0)
 return {"n":len(vals),"wr":sum(x>0 for x in vals)/len(vals) if vals else None,"mean":sum(vals)/len(vals) if vals else None,
         "sum":sum(vals),"pf":gp/gl if gl else None}
def qvals(a,f):
 xs=sorted(z[f] for z in a)
 return sorted(set(xs[round((len(xs)-1)*q)] for q in [.15,.25,.35,.5,.65,.75,.85]))
atoms=[]
for f in features:
 for t in qvals(train,f):
  atoms += [(f,"<=",t),(f,">=",t)]
def passes(z,rule):
 return all(z[f]<=t if op=="<=" else z[f]>=t for f,op,t in rule)
cands=[]
for a in atoms:
 sel=[z for z in train if passes(z,[a])]
 if len(sel)>=max(6,len(train)//5): cands.append(([a],metrics(sel,30)))
top=sorted(cands,key=lambda x:((x[1]["pf"] or 0),x[1]["mean"] or -9),reverse=True)[:18]
for (a,_),(b,__) in itertools.combinations(top,2):
 if a[0][0]==b[0][0]:continue
 rule=a+b;sel=[z for z in train if passes(z,rule)]
 if len(sel)>=max(6,len(train)//5):cands.append((rule,metrics(sel,30)))
bt=metrics(train,30);short=[]
for rule,m in cands:
 if m["n"]>=max(6,len(train)//4) and m["mean"]>0 and (m["pf"] or 0)>1.2 and m["wr"]>=bt["wr"]:
  vv=[z for z in valid if passes(z,rule)];ff=[z for z in fw if passes(z,rule)]
  short.append({"rule":[{"feature":f,"op":op,"threshold":t} for f,op,t in rule],
                "train30":m,"valid10":metrics(vv,10),"valid30":metrics(vv,30),
                "forward10":metrics(ff,10),"forward30":metrics(ff,30)})
short=sorted(short,key=lambda z:((z["valid30"]["pf"] or 0),z["valid30"]["mean"] or -9,z["valid30"]["n"]),reverse=True)
base={"train10":metrics(train,10),"train30":metrics(train,30),"valid10":metrics(valid,10),"valid30":metrics(valid,30),
      "forward10":metrics(fw,10),"forward30":metrics(fw,30)}
rob=[z for z in short if z["valid30"]["n"]>=5 and z["forward30"]["n"]>=3 and z["valid30"]["mean"]>0 and z["forward30"]["mean"]>0 and
     (z["valid30"]["pf"] or 0)>1 and (z["forward30"]["pf"] or 0)>1 and z["forward30"]["wr"]>=base["forward30"]["wr"]]
out={"status":"RESEARCH_TRAIN_ONLY_PENGU_V8_GATE_FORWARD_FALSIFICATION","route":route,"historicalN":len(rows),
     "trainN":len(train),"validN":len(valid),"forwardN":len(fw),"baseline":base,"candidateN":len(short),
     "robustN":len(rob),"robust":rob[:20],"topValidation":short[:20],
     "warning":"Forward was not used to form or rank thresholds; still small and retrospective research, not adoption evidence.",
     "hashes":{"histRaw":hashlib.sha256((R/"native-new-signal-20251001-20261001"/"native-PENGU-raw-intentions.jsonl").read_bytes()).hexdigest(),
               "histExit":hashlib.sha256((R/"PENGU_NATIVE_LIFECYCLE_EXIT_20261109"/"pengu-native-lifecycle-modeled-exits.jsonl").read_bytes()).hexdigest(),
               "fwdRaw":hashlib.sha256((R/"FORWARD_HOLDOUT_20261001_20261108"/"PENGU_FORWARD"/"native-PENGU-raw-intentions.jsonl").read_bytes()).hexdigest(),
               "fwdExit":hashlib.sha256((R/"FORWARD_HOLDOUT_20261001_20261108"/"PENGU_NATIVE_LIFECYCLE"/"pengu-native-lifecycle-modeled-exits.jsonl").read_bytes()).hexdigest()}}
p=R/"DIRECTION_RESEARCH_20261109"/"pengu_v8_train_validation_forward_gate_search_20261110.json"
p.write_text(json.dumps(out,indent=2,ensure_ascii=False)+"\n",encoding="utf8")
print("COUNTS",len(rows),len(train),len(valid),len(fw),"ROB",len(rob))
print("BASE",json.dumps(base,separators=(',',':')))
for i,z in enumerate(rob[:10]):print("ROB",i,json.dumps(z,separators=(',',':')))
print("FILE",p)
