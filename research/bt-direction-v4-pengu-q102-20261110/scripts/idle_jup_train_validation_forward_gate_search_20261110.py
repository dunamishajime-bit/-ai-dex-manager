#!/usr/bin/env python3
from pathlib import Path
import json,statistics,math,itertools,hashlib
R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
hist_raw=[json.loads(x) for x in (R/"native-new-signal-20251001-20261001"/"native-IDLE-raw-intentions.jsonl").open(encoding="utf8") if x.strip()]
hist_exit=json.loads((R/"native-new-signal-20251001-20261001"/"native-IDLE-all-intent-modeled-5m-exit-audit.json").read_text(encoding="utf8"))["trades"]
fwd=[json.loads(x) for x in (R/"FORWARD_HOLDOUT_20261001_20261108"/"IDLE_DUALSIDE_LIFECYCLE"/"idle-forward-dualside.jsonl").open(encoding="utf8") if x.strip() and json.loads(x).get("mode")=="NATIVE_SHORT"]
route="IDLE_JUP_RELATIVE_SHORT"
H={ (z["entryTs"],z["symbol"],z["route"]):z for z in hist_raw if z["route"]==route }
E=[z for z in hist_exit if z["route"]==route]
rows=[]
for e in E:
 k=(e["entryTs"],e["symbol"],e["route"]);r=H[k];rows.append({"entryTs":e["entryTs"],"ret":e["grossReturn"],**r["features"]})
rows=sorted(rows,key=lambda z:z["entryTs"])
fw=[{"entryTs":z["entryTs"],"ret":z["rawReturn"],**z["nativeFeatures"]} for z in fwd if z["route"]==route]
assert len(rows)>20 and len(fw)==16,(len(rows),len(fw))
cut=len(rows)//2;train=rows[:cut];valid=rows[cut:]
features=["ret12","ret24","btc24","rel24","atrRatio","volumeRatio"]
def qvals(a,f):
 xs=sorted(z[f] for z in a)
 return sorted(set(xs[max(0,min(len(xs)-1,round((len(xs)-1)*q)))] for q in [.15,.25,.35,.5,.65,.75,.85]))
def metrics(a,bps=30):
 vals=[z["ret"]-bps/10000 for z in a]
 gp=sum(x for x in vals if x>0);gl=-sum(x for x in vals if x<0)
 return {"n":len(vals),"wr":sum(x>0 for x in vals)/len(vals) if vals else None,"mean":sum(vals)/len(vals) if vals else None,
         "sum":sum(vals),"pf":gp/gl if gl else None}
# Candidate rules formed ONLY on first half. Single condition or AND of two.
atoms=[]
for f in features:
 for t in qvals(train,f):
  atoms.append((f,"<=",t,lambda z,f=f,t=t:z[f]<=t))
  atoms.append((f,">=",t,lambda z,f=f,t=t:z[f]>=t))
cands=[]
for atom in atoms:
 sel=[z for z in train if atom[3](z)]
 if len(sel)>=max(8,len(train)//5):
  cands.append(([atom],metrics(sel,30)))
# only pair top train atoms by PF/mean to avoid combinatorial threshold fishing
top=sorted(cands,key=lambda x:((x[1]["pf"] or 0),x[1]["mean"] or -9),reverse=True)[:24]
pairs=[]
for (a,_),(b,__) in itertools.combinations(top,2):
 if a[0][0]==b[0][0]:continue
 cond=a+b
 sel=[z for z in train if all(x[3](z) for x in cond)]
 if len(sel)>=max(8,len(train)//5):pairs.append((cond,metrics(sel,30)))
cands+=pairs
# Freeze shortlist based on train: positive 30bps, PF>1.2, improved WR over baseline, preserve >=25%.
bt=metrics(train,30)
short=[]
for cond,m in cands:
 if m["n"]>=max(8,len(train)//4) and m["mean"]>0 and (m["pf"] or 0)>1.2 and m["wr"]>=bt["wr"]:
  desc=[{"feature":x[0],"op":x[1],"threshold":x[2]} for x in cond]
  def passes(z):
   return all((z[x["feature"]]<=x["threshold"] if x["op"]=="<=" else z[x["feature"]]>=x["threshold"]) for x in desc)
  vv=[z for z in valid if passes(z)];ff=[z for z in fw if passes(z)]
  short.append({"rule":desc,"train30":m,"valid10":metrics(vv,10),"valid30":metrics(vv,30),
                "forward10":metrics(ff,10),"forward30":metrics(ff,30),
                "trainN":len(train),"validN":len(valid),"forwardN":len(fw)})
# rank without forward: validation PF, mean, n. forward is only reported/falsifier
short=sorted(short,key=lambda z:((z["valid30"]["pf"] or 0),z["valid30"]["mean"] or -9,z["valid30"]["n"]),reverse=True)
baseline={"train10":metrics(train,10),"train30":metrics(train,30),"valid10":metrics(valid,10),"valid30":metrics(valid,30),
          "forward10":metrics(fw,10),"forward30":metrics(fw,30)}
# robust candidate = positive/PF>1 both validation & forward at 30bps, >=4 forward trades, wr no worse than fwd baseline
rob=[z for z in short if z["valid30"]["n"]>=6 and z["forward30"]["n"]>=4 and z["valid30"]["mean"]>0 and z["forward30"]["mean"]>0 and
     (z["valid30"]["pf"] or 0)>1 and (z["forward30"]["pf"] or 0)>1 and z["forward30"]["wr"]>=baseline["forward30"]["wr"]]
out={"status":"RESEARCH_ONLY_TRAIN_RULES_THEN_VALIDATION_AND_FORWARD_FALSIFICATION","route":route,
"historicalN":len(rows),"trainN":len(train),"validationN":len(valid),"forwardN":len(fw),
"baseline":baseline,"candidateCountTrainOnly":len(short),"robustCount":len(rob),"robustCandidates":rob[:20],
"topValidationCandidates":short[:20],
"warning":"Thresholds are generated from historical first half only. Forward data is never used in candidate construction/ranking; it is used only as a falsification report. Still retrospective research and not production-ready.",
"hashes":{"histRaw":hashlib.sha256((R/"native-new-signal-20251001-20261001"/"native-IDLE-raw-intentions.jsonl").read_bytes()).hexdigest(),
"histExit":hashlib.sha256((R/"native-new-signal-20251001-20261001"/"native-IDLE-all-intent-modeled-5m-exit-audit.json").read_bytes()).hexdigest(),
"forward":hashlib.sha256((R/"FORWARD_HOLDOUT_20261001_20261108"/"IDLE_DUALSIDE_LIFECYCLE"/"idle-forward-dualside.jsonl").read_bytes()).hexdigest()}}
P=R/"DIRECTION_RESEARCH_20261109"/"idle_jup_train_validation_forward_gate_search_20261110.json"
P.write_text(json.dumps(out,indent=2,ensure_ascii=False)+"\n",encoding="utf8")
print("BASE",json.dumps(baseline,separators=(',',':')))
print("COUNTS",len(rows),len(train),len(valid),len(fw),"short",len(short),"rob",len(rob))
for i,z in enumerate(rob[:10]):print("ROB",i,json.dumps(z,separators=(',',':')))
print("FILE",P)
