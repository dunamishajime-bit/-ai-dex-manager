#!/usr/bin/env python3
"""PENGU SHORT_V20 3h/8h adverse checks independently replayed on Aster M5.
The original pinned code lacks executable integration: results are an overlay study.
"""
import collections,gzip,hashlib,json,math
from pathlib import Path
R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
D=R/"DIRECTION_RESEARCH_20261109";FM=300000;H=3600000
pre=R/"aster-public-v3-5m-prefix"/"PENGUUSDT-5m-20250924-20260803.jsonl.gz"
suf=R/"aster-public-v3-5m-suffix"/"PENGUUSDT-5m-20260803-20261001.jsonl.gz"
m5={}
for p in [pre,suf]:
 with gzip.open(p,"rt",encoding="utf8") as f:
  for s in f:
   if not s.strip():continue
   z=json.loads(s);t=int(z[0]);cand=(float(z[1]),float(z[4]))
   if t in m5:assert m5[t]==cand
   m5[t]=cand
keys=sorted(m5)
assert len(keys)==107136,(len(keys),107136)
assert all(keys[i]-keys[i-1]==FM for i in range(1,len(keys)))
nat=R/"PENGU_NATIVE_LIFECYCLE_EXIT_20261109"/"pengu-native-lifecycle-modeled-exits.jsonl"
all=[json.loads(s) for s in nat.open(encoding="utf8") if s.strip()]
shorts=[x for x in all if x["route"]=="SHORT_V20"]
assert len(shorts)==40
combined_path=R/"PENGU_NATIVE_WITH_TIMED_STOPS_20261109"/"timed-stop-events.json"
original=json.loads(combined_path.read_text(encoding="utf8"))
prior={e["id"]:e for e in original}
def check(z,h,threshold):
 decision=z["entryTs"]+h*H
 bar=m5.get(decision)
 later=m5.get(decision+FM)
 assert bar is not None and later is not None,(z["id"],h)
 closed_price=bar[1];reference=decision+FM;execution_price=later[0]
 if reference>=z["exitTs"]:return None
 adverse=(closed_price/z["entryPrice"]-1)*100
 if adverse< threshold-1e-12:return None
 gain=(z["entryPrice"]-execution_price)/z["entryPrice"]
 return {"id":z["id"],"hours":h,"threshold_pct":threshold,"source_m5_close":closed_price,
  "observed_loss_pct":adverse,"referenceTs":reference,"hypothetical_next_m5_open":execution_price,
  "nativeExitReason":z["exitReason"],"nativeRawReturn":z["rawReturn"],
  "proposedRawReturn":gain,"deltaRawReturn":gain-z["rawReturn"]}
records={}
for label,stages in [("three_only",[(3,2.5)]),("eight_only",[(8,4)]),("three_then_eight",[(3,2.5),(8,4)])]:
 ev=[]
 for z in shorts:
  chosen=None
  for h,th in stages:
   x=check(z,h,th)
   if x:
    chosen=x;break
  if chosen:ev.append(chosen)
 def s(a):
  return {"triggers":len(a),"improved":sum(z["deltaRawReturn"]>0 for z in a),
   "harmed":sum(z["deltaRawReturn"]<0 for z in a),
   "gross_unit_delta_sum":sum(z["deltaRawReturn"] for z in a),
   "native_winners_harmed":sum(z["nativeRawReturn"]>0 and z["deltaRawReturn"]<0 for z in a),
   "ids":[z["id"] for z in a]}
 records[label]={"summary":s(ev),"events":ev}
assert len(records["three_then_eight"]["events"])==len(original)
for x in records["three_then_eight"]["events"]:
 y=prior.get(x["id"])
 assert y is not None,x
 assert x["referenceTs"]==y["timedExitTs"],(x["id"],x["referenceTs"],y["timedExitTs"])
 assert abs(x["hypothetical_next_m5_open"]-y["timedExitPrice"])<1e-12,(x["id"],x["hypothetical_next_m5_open"],y["timedExitPrice"])
 assert abs(x["deltaRawReturn"]-y["unitReturnImprovement"])<1e-9,(x["id"],x["deltaRawReturn"],y["unitReturnImprovement"])
result={"status":"RESEARCH_ONLY_CANNOT_INFER_LIVE_WIRING",
 "source_runtime_sha":"1657e173d250ad58f53e62f7bb0a3428fb405496",
 "source_sha256":{"native":hashlib.sha256(nat.read_bytes()).hexdigest(),
 "original_timed_events":hashlib.sha256(combined_path.read_bytes()).hexdigest(),
 "m5_prefix":hashlib.sha256(pre.read_bytes()).hexdigest(),
 "m5_suffix":hashlib.sha256(suf.read_bytes()).hexdigest()},
 "m5_count":len(m5),"short_v20_count":len(shorts),
 "original_combined_event_parity_pass":True,
 "rules":records,
 "limits":["The separate timed overlay is not referenced by the saved core pinned PENGU executable code.",
 "Research-only next-M5-open modeled fill at 3h+5m or 8h+5m; actual orderbook absent.",
 "Native resident hard/trailing STOP always takes precedence if exited before check.",
 "In A/B of same-direction earlier exit, explicit identical roundtrip bps mostly cancel; shorter holding funding not modeled.",
 "Candidate counts are only 40 raw signals, not account-admitted positions; full portfolio 10/30bps required.",
 "Do not promote based on hindsight inspected target samples."]}
target=D/"pengu_short_v20_timed3h_vs_8h_independent_m5_20261110.json"
target.write_text(json.dumps(result,indent=2,ensure_ascii=False)+"\n",encoding="utf8")
print("RESULT",target)
for name,d in records.items():
 print("RULE",name,json.dumps(d["summary"],ensure_ascii=False))
 for v in d["events"]:
  print(" EVENT",v["id"],"native",v["nativeExitReason"],round(v["nativeRawReturn"],5),"exit",round(v["proposedRawReturn"],5),"delta",round(v["deltaRawReturn"],5))
