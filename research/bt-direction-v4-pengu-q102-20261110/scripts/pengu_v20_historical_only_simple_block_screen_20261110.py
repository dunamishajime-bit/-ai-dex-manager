#!/usr/bin/env python3
from pathlib import Path
import json,math,statistics,hashlib
R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
N=R/"native-new-signal-20251001-20261001"
raw=[json.loads(x) for x in (N/"native-PENGU-raw-intentions.jsonl").open(encoding="utf8") if x.strip()]
exits=[json.loads(x) for x in (R/"PENGU_NATIVE_LIFECYCLE_EXIT_20261109"/"pengu-native-lifecycle-modeled-exits.jsonl").open(encoding="utf8") if x.strip()]
emap={(int(x["entryTs"]),x["route"]):x for x in exits}
rows=[]
for x in raw:
 if x["route"]!="SHORT_V20":continue
 k=(int(x["entryTs"]),x["route"]);e=emap[k]
 rows.append({"entryTs":k[0],"pengu72h":float(x["pengu72h"]),"btc24h":float(x["btc24h"]),"native":float(e["rawReturn"])})
rows.sort(key=lambda x:x["entryTs"])
assert len(rows)==40,len(rows)
parts={"TRAIN":rows[:20],"VAL1":rows[20:30],"VAL2":rows[30:]}
def q(v,p):
 a=sorted(v);x=(len(a)-1)*p;lo=int(math.floor(x));hi=int(math.ceil(x))
 return a[lo] if lo==hi else a[lo]*(hi-x)+a[hi]*(x-lo)
thresholds={f:[q([r[f] for r in parts["TRAIN"]],p) for p in (.25,.5,.75)] for f in ("pengu72h","btc24h")}
def ev(a,f,op,t,cost):
 trigger=[r for r in a if (r[f]<=t if op=="LE" else r[f]>=t)]
 base=[r["native"]-cost/10000 for r in a]
 kept=[r["native"]-cost/10000 for r in a if r not in trigger]
 return {"n":len(a),"triggered":len(trigger),"tradesAfter":len(kept),
 "baselineSum":sum(base),"sum":sum(kept),"deltaSum":sum(kept)-sum(base),
 "baselineWR":sum(x>0 for x in base)/len(base),
 "wr":sum(x>0 for x in kept)/len(kept) if kept else None}
cands=[]
for f,ts in thresholds.items():
 for t in ts:
  for op in ("LE","GE"):
   z={"feature":f,"threshold":t,"op":op,"split":{}}
   for name,a in parts.items():z["split"][name]={str(c):ev(a,f,op,t,c) for c in (10,30)}
   tr=z["split"]["TRAIN"]["30"]
   if not 3<=tr["triggered"]<=14:continue
   if any(z["split"]["TRAIN"][str(c)]["deltaSum"]<=0 for c in (10,30)):continue
   if any(z["split"]["TRAIN"][str(c)]["wr"]+1e-12<z["split"]["TRAIN"][str(c)]["baselineWR"] for c in (10,30)):continue
   z["trainScore"]=min(z["split"]["TRAIN"][str(c)]["deltaSum"] for c in (10,30))
   cands.append(z)
cands.sort(key=lambda z:(-z["trainScore"],z["feature"],z["op"],z["threshold"]))
for z in cands:
 z["validationPass"]=all(z["split"][n][str(c)]["deltaSum"]>=-1e-12 and
                         z["split"][n][str(c)]["wr"]+1e-12>=z["split"][n][str(c)]["baselineWR"]
                         for n in ("VAL1","VAL2") for c in (10,30))
stable=[z for z in cands if z["validationPass"]]
# Temporal forward falsification only after historical freeze.
F=R/"FORWARD_HOLDOUT_20261001_20261108"
fraw=[json.loads(x) for x in (F/"PENGU_FORWARD"/"native-PENGU-raw-intentions.jsonl").open(encoding="utf8") if x.strip()]
fexit=[json.loads(x) for x in (F/"PENGU_NATIVE_LIFECYCLE"/"pengu-native-lifecycle-modeled-exits.jsonl").open(encoding="utf8") if x.strip()]
femap={(int(x["entryTs"]),x["route"]):x for x in fexit}
forward=[];forwardUnresolved=[]
for x in fraw:
 if x["route"]!="SHORT_V20":continue
 k=(int(x["entryTs"]),x["route"])
 if k not in femap:
  forwardUnresolved.append({"entryTs":k[0],"route":k[1]})
  continue
 e=femap[k]
 forward.append({"entryTs":int(x["entryTs"]),"pengu72h":float(x["pengu72h"]),"btc24h":float(x["btc24h"]),"native":float(e["rawReturn"])})
assert len(forward)==6,(len(forward),len(forwardUnresolved))
for z in stable:
 z["forward"]={str(c):ev(forward,z["feature"],z["op"],z["threshold"],c) for c in (10,30)}
 z["forwardPass"]=all(z["forward"][str(c)]["deltaSum"]>=-1e-12 and
                      z["forward"][str(c)]["wr"]+1e-12>=z["forward"][str(c)]["baselineWR"] for c in (10,30))
report={"status":"PENGU_V20_HISTORICAL_ONLY_SIMPLE_BLOCK_SCREEN","splitSizes":{k:len(v) for k,v in parts.items()},
"forwardN":len(forward),"forwardRightCensoredN":len(forwardUnresolved),"thresholds":thresholds,
"selection":"TRAIN-only quartiles; one feature one threshold; block; improve 10/30 sum and non-decrease WR; validate VAL1+VAL2 unchanged threshold",
"forwardCaveat":"V20 forward aggregate already inspected; falsification only, not virgin OOS",
"candidateN":len(cands),"stableHistoricalN":len(stable),"stableAndForwardN":sum(z.get("forwardPass",False) for z in stable),
"stable":stable,
"hashes":{"raw":hashlib.sha256((N/"native-PENGU-raw-intentions.jsonl").read_bytes()).hexdigest(),
"exits":hashlib.sha256((R/"PENGU_NATIVE_LIFECYCLE_EXIT_20261109"/"pengu-native-lifecycle-modeled-exits.jsonl").read_bytes()).hexdigest()}}
out=R/"DIRECTION_RESEARCH_20261109"/"pengu_v20_historical_only_simple_block_screen_20261110.json"
out.write_text(json.dumps(report,indent=2,ensure_ascii=False)+"\n",encoding="utf8")
print("COUNTS",report["candidateN"],report["stableHistoricalN"],report["stableAndForwardN"])
for z in stable:
 print("STABLE",z["feature"],z["op"],z["threshold"],"FWD",z["forwardPass"],
 "T",z["split"]["TRAIN"]["30"]["triggered"],z["split"]["VAL1"]["30"]["triggered"],z["split"]["VAL2"]["30"]["triggered"],z["forward"]["30"]["triggered"],
 "D",round(z["split"]["TRAIN"]["30"]["deltaSum"],6),round(z["split"]["VAL1"]["30"]["deltaSum"],6),round(z["split"]["VAL2"]["30"]["deltaSum"],6),round(z["forward"]["30"]["deltaSum"],6))
print("OUT",out)
