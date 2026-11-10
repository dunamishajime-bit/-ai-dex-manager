#!/usr/bin/env python3
from pathlib import Path
import json,math,statistics,hashlib
R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
p=R/"DIRECTION_RESEARCH_20261109"/"idle_jup_historical_only_walkforward_rule_screen_20261110.json"
z=json.loads(p.read_text(encoding="utf8"))
assert z["stableHistoricalN"]==2
base=z["stable"][0]
assert base["feature"]=="volumeRatio" and base["op"]=="GE"
thr_log=float(base["threshold"]);thr=10**thr_log
# Rebuild paired records from canonical sources rather than trusting prior derived metrics.
N=R/"native-new-signal-20251001-20261001"
raw=[json.loads(x) for x in (N/"native-IDLE-raw-intentions.jsonl").open(encoding="utf8") if x.strip()]
native=json.loads((N/"native-IDLE-all-intent-modeled-5m-exit-audit.json").read_text(encoding="utf8"))["trades"]
flip=json.loads((R/"IDLE_DIRECTION_ALL_FLIPPED_20261109"/"idle-direction-alt-modeled-5m-exit-audit.json").read_text(encoding="utf8"))["trades"]
def key(a):return (int(a["entryTs"]),a["symbol"],a["route"])
rr={key(a):a for a in raw};nn={key(a):a for a in native};ff={key(a):a for a in flip}
hist=[{"entryTs":k[0],"vr":rr[k]["features"]["volumeRatio"],"native":nn[k]["grossReturn"],"flip":ff[k]["grossReturn"]}
      for k in sorted(k for k in rr if k[2]=="IDLE_JUP_RELATIVE_SHORT")]
parts={"TRAIN":hist[:29],"VAL1":hist[29:43],"VAL2":hist[43:]}
F=R/"FORWARD_HOLDOUT_20261001_20261108"
fraw=[json.loads(x) for x in (F/"IDLE_FET_FORWARD"/"native-IDLE-raw-intentions.jsonl").open(encoding="utf8") if x.strip()]
dual=[json.loads(x) for x in (F/"IDLE_DUALSIDE_LIFECYCLE"/"idle-forward-dualside.jsonl").open(encoding="utf8") if x.strip()]
fr={key(a):a for a in fraw if a["route"]=="IDLE_JUP_RELATIVE_SHORT"};fd={}
for a in dual:
 if a["route"]=="IDLE_JUP_RELATIVE_SHORT":fd.setdefault(key(a),{})[a["mode"]]=a
fwd=[{"entryTs":k[0],"vr":fr[k]["features"]["volumeRatio"],"native":fd[k]["NATIVE_SHORT"]["rawReturn"],"flip":fd[k]["OPPOSITE_LONG"]["rawReturn"]}
     for k in sorted(fr)]
assert len(hist)==58 and len(fwd)==16
def eval(a,t,action,cost):
 out=[];base=[];trigger=0
 for r in a:
  n=r["native"]-cost/10000;base.append(n)
  if r["vr"]>=t:
   trigger+=1
   if action=="BLOCK":continue
   out.append(r["flip"]-cost/10000)
  else:out.append(n)
 return {"triggered":trigger,"n":len(a),"tradesAfter":len(out),
  "deltaSum":sum(out)-sum(base),"baseWR":sum(x>0 for x in base)/len(base),
  "wr":sum(x>0 for x in out)/len(out) if out else None}
rows=[]
for mult in (.8,.9,1.0,1.1,1.2):
 t=thr*mult
 rec={"multiplier":mult,"threshold":t,"thresholdLog10":math.log10(t),"actions":{}}
 for action in ("FLIP","BLOCK"):
  rec["actions"][action]={}
  for name,a in {**parts,"FORWARD":fwd}.items():
   rec["actions"][action][name]={str(c):eval(a,t,action,c) for c in (10,30)}
 rec["robustPassBothActions"]=all(
  rec["actions"][action][name][str(c)]["deltaSum"]>=-1e-12 and
  rec["actions"][action][name][str(c)]["wr"]+1e-12>=rec["actions"][action][name][str(c)]["baseWR"]
  for action in ("FLIP","BLOCK") for name in ("VAL1","VAL2","FORWARD") for c in (10,30))
 rows.append(rec)
report={"status":"FIXED_RULE_JITTER_NOT_RETUNING","baseThresholdVolumeRatio":thr,
 "origin":"TRAIN-only 75th percentile of raw JUP volumeRatio; GE inclusive",
 "boundary":{"below":thr*(1-1e-12),"equal":thr,"above":thr*(1+1e-12),
             "predicateResults":[False,True,True]},
 "jitterMultipliers":[.8,.9,1.0,1.1,1.2],"rows":rows,
 "allJitterPassBothActions":all(x["robustPassBothActions"] for x in rows),
 "caveat":"Forward route aggregate previously inspected; use as falsification, not virgin OOS.",
 "sourceRuleReportSha256":hashlib.sha256(p.read_bytes()).hexdigest()}
out=R/"DIRECTION_RESEARCH_20261109"/"idle_jup_volume6p1_jitter_robustness_20261110.json"
out.write_text(json.dumps(report,indent=2,ensure_ascii=False)+"\n",encoding="utf8")
print("THRESHOLD",thr,"ALL_PASS",report["allJitterPassBothActions"])
for x in rows:
 print("JITTER",x["multiplier"],x["threshold"],"PASS",x["robustPassBothActions"],
       "flip_triggers",[x["actions"]["FLIP"][n]["30"]["triggered"] for n in ("VAL1","VAL2","FORWARD")],
       "flip_delta30",[round(x["actions"]["FLIP"][n]["30"]["deltaSum"],6) for n in ("VAL1","VAL2","FORWARD")],
       "block_delta30",[round(x["actions"]["BLOCK"][n]["30"]["deltaSum"],6) for n in ("VAL1","VAL2","FORWARD")])
print("OUT",out)
