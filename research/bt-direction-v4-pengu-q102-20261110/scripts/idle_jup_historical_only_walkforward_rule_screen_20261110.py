#!/usr/bin/env python3
from pathlib import Path
import json, math, statistics, hashlib
R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
N=R/"native-new-signal-20251001-20261001"
raw=[json.loads(x) for x in (N/"native-IDLE-raw-intentions.jsonl").open(encoding="utf8") if x.strip()]
native=json.loads((N/"native-IDLE-all-intent-modeled-5m-exit-audit.json").read_text(encoding="utf8"))["trades"]
flip=json.loads((R/"IDLE_DIRECTION_ALL_FLIPPED_20261109"/"idle-direction-alt-modeled-5m-exit-audit.json").read_text(encoding="utf8"))["trades"]
def key(z):return (int(z["entryTs"]),z["symbol"],z["route"])
rr={key(z):z for z in raw}; nn={key(z):z for z in native}; ff={key(z):z for z in flip}
rows=[]
for k in sorted(k for k in rr if k[2]=="IDLE_JUP_RELATIVE_SHORT"):
 a,b,c=rr[k],nn[k],ff[k]
 rows.append({"entryTs":k[0],"features":a["features"],"native":float(b["grossReturn"]),"flip":float(c["grossReturn"])})
assert len(rows)==58 and all(r["entryTs"]<1790812800000 for r in rows)
splits={"TRAIN":rows[:29],"VAL1":rows[29:43],"VAL2":rows[43:]}
features=["ret12","ret24","btc24","rel24","atrRatio","volumeRatio"]
def q(vals,p):
 v=sorted(vals); x=(len(v)-1)*p; lo=int(math.floor(x)); hi=int(math.ceil(x))
 return v[lo] if lo==hi else v[lo]*(hi-x)+v[hi]*(x-lo)
thresholds={}
for f in features:
 vals=[math.log10(max(1e-12,r["features"][f])) if f=="volumeRatio" else r["features"][f] for r in splits["TRAIN"]]
 thresholds[f]=[q(vals,p) for p in (.25,.5,.75)]
def fv(r,f):
 x=r["features"][f]
 return math.log10(max(1e-12,x)) if f=="volumeRatio" else x
def cond(r,f,op,t):return fv(r,f)<=t if op=="LE" else fv(r,f)>=t
def evalset(a,f,op,t,action,cost):
 selected=[r for r in a if cond(r,f,op,t)]
 rets=[]
 for r in a:
  if cond(r,f,op,t):
   if action=="BLOCK": continue
   g=r["flip"]
  else:g=r["native"]
  rets.append(g-cost/10000)
 baseline=[r["native"]-cost/10000 for r in a]
 changed_native=[r["native"]-cost/10000 for r in selected]
 changed_action=[] if action=="BLOCK" else [r["flip"]-cost/10000 for r in selected]
 return {
  "n":len(a),"triggered":len(selected),"tradesAfter":len(rets),
  "baselineSum":sum(baseline),"sum":sum(rets),"deltaSum":sum(rets)-sum(baseline),
  "baselineWR":sum(x>0 for x in baseline)/len(baseline),
  "wr":sum(x>0 for x in rets)/len(rets) if rets else None,
  "changedNativeSum":sum(changed_native),"changedActionSum":sum(changed_action) if changed_action else 0
 }
cands=[]
for f in features:
 for t in thresholds[f]:
  for op in ("LE","GE"):
   for action in ("BLOCK","FLIP"):
    rec={"feature":f,"threshold":t,"op":op,"action":action,"split":{}}
    for sn,a in splits.items():
     rec["split"][sn]={str(c):evalset(a,f,op,t,action,c) for c in (10,30)}
    tr=rec["split"]["TRAIN"]["30"]
    # Freeze candidates from TRAIN only: avoid trivial tiny/near-total changes.
    if not (4<=tr["triggered"]<=20):continue
    # Must improve both cost levels and not lower win rate on train.
    if any(rec["split"]["TRAIN"][str(c)]["deltaSum"]<=0 for c in (10,30)):continue
    if any(rec["split"]["TRAIN"][str(c)]["wr"]+1e-12<rec["split"]["TRAIN"][str(c)]["baselineWR"] for c in (10,30)):continue
    rec["trainScore"]=min(rec["split"]["TRAIN"][str(c)]["deltaSum"] for c in (10,30))
    cands.append(rec)
cands.sort(key=lambda z:(-z["trainScore"],z["feature"],z["op"],z["threshold"],z["action"]))
# Historical validation is never used to refit a threshold.
for z in cands:
 z["validationPass"]=all(
  z["split"][sn][str(c)]["deltaSum"]>=-1e-12 and
  z["split"][sn][str(c)]["wr"]+1e-12>=z["split"][sn][str(c)]["baselineWR"]
  for sn in ("VAL1","VAL2") for c in (10,30)
 )
stable=[z for z in cands if z["validationPass"]]
# Forward falsification only after stable list is frozen.
F=R/"FORWARD_HOLDOUT_20261001_20261108"
fraw=[json.loads(x) for x in (F/"IDLE_FET_FORWARD"/"native-IDLE-raw-intentions.jsonl").open(encoding="utf8") if x.strip()]
fdual=[json.loads(x) for x in (F/"IDLE_DUALSIDE_LIFECYCLE"/"idle-forward-dualside.jsonl").open(encoding="utf8") if x.strip()]
fr={key(z):z for z in fraw if z["route"]=="IDLE_JUP_RELATIVE_SHORT"}
fd={}
for z in fdual:
 if z["route"]!="IDLE_JUP_RELATIVE_SHORT":continue
 fd.setdefault(key(z),{})[z["mode"]]=z
forward=[]
for k in sorted(fr):
 if "NATIVE_SHORT" not in fd.get(k,{}) or "OPPOSITE_LONG" not in fd[k]:continue
 forward.append({"entryTs":k[0],"features":fr[k]["features"],
  "native":float(fd[k]["NATIVE_SHORT"]["rawReturn"]),"flip":float(fd[k]["OPPOSITE_LONG"]["rawReturn"])})
assert len(forward)==16
for z in stable:
 z["forward"]={str(c):evalset(forward,z["feature"],z["op"],z["threshold"],z["action"],c) for c in (10,30)}
 z["forwardPass"]=all(z["forward"][str(c)]["deltaSum"]>=-1e-12 and
                      z["forward"][str(c)]["wr"]+1e-12>=z["forward"][str(c)]["baselineWR"] for c in (10,30))
report={
 "status":"HISTORICAL_ONLY_THRESHOLD_FREEZE_WITH_FORWARD_FALSIFICATION_NOT_VIRGIN_OOS",
 "splitSizes":{k:len(v) for k,v in splits.items()},"forwardN":len(forward),
 "thresholdGeneration":"TRAIN feature-only quartiles 25/50/75; single feature LE/GE; BLOCK or FLIP",
 "selection":"TRAIN must trigger 4..20, improve 10/30bps sum and non-decrease win rate; frozen rule then must independently pass VAL1+VAL2",
 "forwardCaveat":"Forward route aggregate was inspected before this threshold screen, so forward is falsification, not untouched OOS.",
 "candidateN":len(cands),"stableHistoricalN":len(stable),"stableAndForwardN":sum(z.get("forwardPass",False) for z in stable),
 "stable":stable,
 "inputHashes":{
   "raw":hashlib.sha256((N/"native-IDLE-raw-intentions.jsonl").read_bytes()).hexdigest(),
   "nativeExit":hashlib.sha256((N/"native-IDLE-all-intent-modeled-5m-exit-audit.json").read_bytes()).hexdigest(),
   "allFlip":hashlib.sha256((R/"IDLE_DIRECTION_ALL_FLIPPED_20261109"/"idle-direction-alt-modeled-5m-exit-audit.json").read_bytes()).hexdigest(),
   "forwardRaw":hashlib.sha256((F/"IDLE_FET_FORWARD"/"native-IDLE-raw-intentions.jsonl").read_bytes()).hexdigest(),
   "forwardDual":hashlib.sha256((F/"IDLE_DUALSIDE_LIFECYCLE"/"idle-forward-dualside.jsonl").read_bytes()).hexdigest()
 }}
out=R/"DIRECTION_RESEARCH_20261109"/"idle_jup_historical_only_walkforward_rule_screen_20261110.json"
out.write_text(json.dumps(report,indent=2,ensure_ascii=False)+"\n",encoding="utf8")
print("COUNTS",report["candidateN"],report["stableHistoricalN"],report["stableAndForwardN"])
for z in stable[:20]:
 print("STABLE",z["feature"],z["op"],z["threshold"],z["action"],"FWD",z["forwardPass"],
  "TRAIN30",z["split"]["TRAIN"]["30"]["deltaSum"],"V1",z["split"]["VAL1"]["30"]["deltaSum"],
  "V2",z["split"]["VAL2"]["30"]["deltaSum"],"FWD30",z["forward"]["30"]["deltaSum"],
  "TRIG",z["split"]["TRAIN"]["30"]["triggered"],z["split"]["VAL1"]["30"]["triggered"],z["split"]["VAL2"]["30"]["triggered"],z["forward"]["30"]["triggered"])
print("OUT",out)
