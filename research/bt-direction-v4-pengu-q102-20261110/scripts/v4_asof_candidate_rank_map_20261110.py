#!/usr/bin/env python3
"""Build reproducible per-candidate strictly as-of V4 rank, from only matured exit outcomes.
This does NOT remove hindsight filtering in the historical V2 entry universe.
Use only with research integrated portfolio simulation, no live writes.
"""
from pathlib import Path
import collections,datetime as dt,hashlib,json,math
R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
PRE=R/"PREPERIOD_TRAIN_20250322_20251001"/"V4_DUALSIDE_LIFECYCLE"/"v4-pre-dualside-modeled-exits.jsonl"
TARGET=R/"V4_NATIVE_LIFECYCLE_EXIT_M5COMPLETE_20261109"/"v4-native-lifecycle-modeled-exits.jsonl"
RANK=R/"pinned-source"/"V4"/"docs"/"implementation"/"v12-v4-v2-full-year-priority.json"
ENTRY=R/"native-new-signal-20251001-20261001"/"native-V4-raw-intentions.jsonl"
OUT=R/"DIRECTION_RESEARCH_20261109"/"v4_asof_1394_candidate_rank_map_20261110.json"
pre=[x for x in (json.loads(z) for z in PRE.open(encoding="utf8") if z.strip()) if x["mode"]=="NATIVE"]
target=[json.loads(z) for z in TARGET.open(encoding="utf8") if z.strip()]
entry=[json.loads(z) for z in ENTRY.open(encoding="utf8") if z.strip()]
assert len(pre)==598 and len(target)==1394 and len(entry)==1394
names=[x["route"] for x in sorted(json.loads(RANK.read_text(encoding="utf8")),key=lambda x:x["priority_order"])]
assert len(names)==41
pinned={r:i+1 for i,r in enumerate(names)}
evidence=sorted([dict(route=z["route"],exitTs=int(z["exitTs"]),raw=float(z["rawReturn"])) for z in pre+target],key=lambda z:z["exitTs"])
source={x["id"]:x for x in target}
assert len(source)==1394
assert all(z["route"] in pinned for z in evidence)
assert all(f"V4_{str(i).zfill(5)}" in source for i in range(1,1395))
# Base V4 replay id generated from raw list ordering, must check entry/source pairing.
for i,z in enumerate(entry,1):
 id="V4_"+str(i).zfill(5);ref=source[id]
 assert z["route"]==ref["route"] and z["entryTs"]==ref["entryTs"] and z["symbol"]==ref["symbol"],(id,z,ref)
 assert z["rank"]==pinned[z["route"]]+3,(id,z["rank"],pinned[z["route"]])
n=collections.Counter();summ=collections.defaultdict(float);ssq=collections.defaultdict(float)
cursor=0;mapping={};checkpoints={}
for i,z in enumerate(entry,1):
 t=int(z["entryTs"]);cut=t-72*3600000
 while cursor<len(evidence) and evidence[cursor]["exitTs"]<=cut:
  x=evidence[cursor];v=x["raw"]-.003
  n[x["route"]]+=1;summ[x["route"]]+=v;ssq[x["route"]]+=v*v
  cursor+=1
 def score(route):
  return (summ[route]-.5*math.sqrt(ssq[route]))/(n[route]+20)
 ordered=sorted(names,key=lambda r:(-score(r),r))
 ranks={route:j+1 for j,route in enumerate(ordered)}
 id=f"V4_{i:05d}"
 mapping[id]=dict(entryTs=t,route=z["route"],symbol=z["symbol"],
  frozen_rank=z["rank"],asof_rank=ranks[z["route"]],
  matured_events=cursor,matured_route_events=n[z["route"]],
  asof_score=score(z["route"]))
 assert mapping[id]["matured_events"]<=len(evidence)
 if i in (1,100,500,1000,1394):
  checkpoints[str(i)]={"entryTs":t,"matured_events":cursor,
  "top10":ordered[:10],"top10_match_frozen":len(set(ordered[:10])&set(names[:10]))}
diff=sum(x["frozen_rank"]!=x["asof_rank"]+3 for x in mapping.values())
out=dict(schema="disdex-v4-asof-route-rank-audit/v1",status="RESEARCH_HISTORICAL_V2_HINDSIGHT_SIGNAL_SET",
 sourceHashes={key:hashlib.sha256(p.read_bytes()).hexdigest() for key,p in [
 ("pre_native",PRE),("target_native",TARGET),("entry_intentions",ENTRY),("hindsight_priority",RANK)]},
 n=1394,rankDisagreement=diff,priorityCount=41,
 embargoHoursAfterNativeExit=72,shrinkagePseudoCount=20,
 predeclaredScore="(sum((rawReturn-0.003)) - .5*sqrt(sum((rawReturn-0.003)^2))) / (n+20)",
 warmup_source="598 preperiod V2 hindsight-filtered natural candidates",
 definition_warning="As-of outcomes avoid within-label future leakage but cannot cure route feature/priority hindsight selection of the source candidates.",
 checkpoints=checkpoints,mapping=mapping)
OUT.write_text(json.dumps(out,indent=2)+"\n",encoding="utf8")
print("OUTPUT",OUT)
print("ROWS",len(mapping),"DISAGREE",diff,"CHECKPOINTS",checkpoints)
print("SHA256",hashlib.sha256(OUT.read_bytes()).hexdigest())
