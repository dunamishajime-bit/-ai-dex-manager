#!/usr/bin/env python3
"""Native-Y06 hold duration research: preserve every earlier protective exit."""
from pathlib import Path
import json,gzip,os,hashlib,datetime as dt,collections
R=Path(os.environ.get("DISDEX_BT_ROOT",r"C:\tmp\disdex-bt-20251001-20261001"))
N=R/"V4_Y06_HISTORICAL_DUALSIDE_20261109"/"y06-dualside-modeled.jsonl"
D=R/"DIRECTION_RESEARCH_20261109"
ev=sorted((x for x in (json.loads(a) for a in N.open(encoding="utf8") if a.strip()) if x["mode"]=="NATIVE"),key=lambda x:(x["entryTs"],x["candidateIndex"]))
assert len(ev)==352
H=3600000
pr={}
for sym in sorted({x["symbol"] for x in ev}):
 with gzip.open(R/"aster-public-v3-h1"/f"{sym}-1h-20250924-20261001.jsonl.gz","rt",encoding="utf8") as f:
  pr[sym]={int(a[0]):(float(a[1]),float(a[4])) for a in (json.loads(z) for z in f if z.strip())}
splits={"train":range(211),"validation":range(211,281),"test":range(281,352)}
def summarize(ids,delta,flags):
 a=[i for i in ids if flags[i]]
 return {"n":len(ids),"early_exits":len(a),"beneficial":sum(delta[i]>1e-9 for i in a),
  "harmful":sum(delta[i]<-1e-9 for i in a),
  "correct_native_damaged":sum(ev[i]["rawReturn"]>0 and delta[i]<-1e-9 for i in a),
  "gross_delta_sum":sum(delta[i] for i in ids),
  "gross_delta_mean":sum(delta[i] for i in ids)/len(ids),
  "worst_trade_delta":min(delta[i] for i in ids)}
def evaluate(hour, mode, threshold=0):
 delta=[0.0]*len(ev);flags=[False]*len(ev)
 for i,x in enumerate(ev):
  t=x["entryTs"]+hour*H
  if t>=x["exitTs"]:continue
  c=pr[x["symbol"]].get(t-H)
  nxt=pr[x["symbol"]].get(t)
  if c is None or nxt is None:continue
  close_pnl=(x["entryPrice"]-c[1])/x["entryPrice"]
  if mode=="hold_max":pass
  elif mode=="still_underwater" and close_pnl>=threshold:continue
  elif mode=="still_profitable" and close_pnl<=threshold:continue
  close_model=(x["entryPrice"]-nxt[0])/x["entryPrice"]
  delta[i]=close_model-x["rawReturn"];flags[i]=True
 return {k:summarize(ids,delta,flags) for k,ids in splits.items()}
results=[]
for h in [3,6,12,18,24,30,36,42,48,54,60]:
 for mode,th in [("hold_max",0),("still_underwater",0),("still_underwater",-.01),
                 ("still_underwater",-.02),("still_profitable",0),("still_profitable",.01)]:
  x={"exit_hour":h,"mode":mode,"threshold":th,"splits":evaluate(h,mode,th)}
  results.append(x)
# Time-only nonconditional is the benchmark, no threshold cherry picking.
timeonly=[r for r in results if r["mode"]=="hold_max"]
valid=[r for r in results if r["splits"]["train"]["early_exits"]>=10
 and r["splits"]["validation"]["early_exits"]>=5
 and r["splits"]["train"]["gross_delta_sum"]>0
 and r["splits"]["validation"]["gross_delta_sum"]>0]
valid.sort(key=lambda r:min(r["splits"]["train"]["gross_delta_sum"]/211,
 r["splits"]["validation"]["gross_delta_sum"]/70),reverse=True)
result={"status":"NO_RULE_ACCEPTED_RESEARCH","note":"Fixed-time alternatives use real H1 next open, only when original native STOP/guard has not already exited. Fee roundtrip assumed same, funding and gross reservation not replayed.",
 "source_sha256":hashlib.sha256(N.read_bytes()).hexdigest(),"policy_count":len(results),
 "train_validation_positive_count":len(valid),"all_results":results,
 "trainval_survivors":valid,"pure_horizon_rows":timeonly}
out=D/"v4_y06_native_stop_preserving_horizon_and_condition_audit_20261110.json"
out.write_text(json.dumps(result,indent=2)+"\n",encoding="utf8")
print("OUTPUT",out)
for r in timeonly:
 print("TIME",r["exit_hour"],[(k,round(v["gross_delta_sum"],4),v["early_exits"],v["beneficial"],v["harmful"],v["correct_native_damaged"]) for k,v in r["splits"].items()])
print("TRAIN_VAL_BOTH_POSITIVE",len(valid))
for r in valid[:14]:
 print("SURVIVOR",r["exit_hour"],r["mode"],r["threshold"],[(k,round(v["gross_delta_sum"],4),v["early_exits"],v["correct_native_damaged"]) for k,v in r["splits"].items()])
