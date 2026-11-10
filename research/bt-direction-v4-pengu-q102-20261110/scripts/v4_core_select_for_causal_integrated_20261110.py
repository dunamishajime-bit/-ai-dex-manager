#!/usr/bin/env python3
from pathlib import Path
from collections import defaultdict
import json,math,hashlib
R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
N=R/"DIRECTION_RESEARCH_20261109"/"NATIVE_CAUSAL_SOURCE_REPLAY_20261110"
events=[json.loads(x) for x in (N/"asof-native-v4-core-events.jsonl").open(encoding="utf8") if x.strip()]
events=[z for z in events if z.get("period")=="target"]
ledger=[json.loads(x) for x in (N/"native_exit_h1_funding_independent_audit.jsonl").open(encoding="utf8") if x.strip()]
ledger={(z["decisionTs"],z["symbol"],z["side"]):z for z in ledger if z.get("family")=="FAILED_BREAK_CORE"}
assert len(events)==49 and len(ledger)==49,(len(events),len(ledger))
groups=defaultdict(list)
for z in events:groups[int(z["entry_ts_ms"])].append(z)
selected=[]
for t,rows in sorted(groups.items()):
 ranked=sorted(rows,key=lambda z:(-float(z["score"]),z["symbol"]))
 for i,z in enumerate(ranked[:3]):
  symbol=z["symbol"]+"USDT";side=z["side"];key=(t,symbol,side)
  e=ledger[key];assert e["status"]=="MODELED_COMPLETE_NATIVE_46H"
  price=float(e["entryPrice"]);atr=float(z["atr"])
  distance=max(2.477*atr,price*.005)
  gross=min(1,.0319/(distance/price))
  if i==2:gross=min(.1,gross)
  assert 0<gross<=1
  selected.append({
    "id":f"V4CORE_{len(selected)+1:05d}","strategy":"V4","entryTs":t,"symbol":symbol,"side":side,
    "route":z["route"],"rank":i+1,"requestedGross":gross,"atr":atr,"score":float(z["score"]),
    "entryPrice":price,"exitTs":int(e["exitTs"]),"exitPrice":float(e["exitPrice"]),"exitReason":"V4_NATIVE_CORE_"+e["exitReason"],
    "grossDirectionalReturn":float(e["grossDirectionalReturn"]),"sourceEvent":z
  })
out=N/"v4-core-selected-integrated-candidates-20261110.jsonl"
with out.open("w",encoding="utf8") as f:
 for z in selected:f.write(json.dumps(z,ensure_ascii=False,separators=(",",":"))+"\n")
summary={"status":"CAUSAL_NATIVE_CORE_SELECTED_TOP3_WITH_FROZEN_SIZING","rawEvents":len(events),"selected":len(selected),
 "timeGroups":len(groups),"rankCounts":{str(r):sum(z["rank"]==r for z in selected) for r in (1,2,3)},
 "gross":{"min":min(z["requestedGross"] for z in selected),"max":max(z["requestedGross"] for z in selected),
          "mean":sum(z["requestedGross"] for z in selected)/len(selected)},
 "inputHashes":{"events":hashlib.sha256((N/"asof-native-v4-core-events.jsonl").read_bytes()).hexdigest(),
                "exitLedger":hashlib.sha256((N/"native_exit_h1_funding_independent_audit.jsonl").read_bytes()).hexdigest()},
 "outputSha256":hashlib.sha256(out.read_bytes()).hexdigest(),
 "contract":"selectNativeCoreEvents: group by entry_ts, score desc/symbol; top3; gross=min(1,0.0319/(max(2.477*atr,price*.005)/price)); rank3 min 0.1"}
(N/"v4-core-selected-integrated-summary-20261110.json").write_text(json.dumps(summary,indent=2,ensure_ascii=False)+"\n",encoding="utf8")
print(json.dumps(summary,ensure_ascii=False))
