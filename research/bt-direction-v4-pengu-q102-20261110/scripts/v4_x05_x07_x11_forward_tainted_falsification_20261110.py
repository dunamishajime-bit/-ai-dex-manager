#!/usr/bin/env python3
"""Research-only V4 X05/X07/X11 2026-Oct-Nov shadow falsification. Forward source marked hindsight/leakage: never claim independent OOS."""
from pathlib import Path
import os, gzip,json,hashlib,math,collections
import numpy as np
R=Path(os.environ.get("DISDEX_BT_ROOT",r"C:\tmp\disdex-bt-20251001-20261001"))
F=R/"FORWARD_HOLDOUT_20261001_20261108";H=3_600_000
raw=F/"native-V4-forward-raw-intentions.jsonl"
lifecycle=F/"V4_DUALSIDE_LIFECYCLE"/"v4-forward-dualside-modeled-exits.jsonl"
src=json.loads((F/"native-V4-forward-atr-summary.json").read_text(encoding="utf8"))
assert src["strategyStatus"]=="BLOCKED_HINDSIGHT_LEAKAGE_AND_EXTERNAL_Y06"
rows=[json.loads(z) for z in raw.open(encoding="utf8") if z.strip()]
allout=[json.loads(z) for z in lifecycle.open(encoding="utf8") if z.strip()]
needed=["REC_X05_TIME_36H","REC_X07_TIME_6H","REC_X11_TIME_48H"]
set_symbols={z["symbol"] for z in rows if z["route"] in needed}
set_symbols.add("BTCUSDT")
bars={}
for sym in sorted(set_symbols):
 old=R/"aster-public-v3-h1"/(sym+"-1h-20250924-20261001.jsonl.gz")
 new=F/"aster-h1"/(sym+"-1h-20261001-20261108T20.jsonl.gz")
 assert old.exists() and new.exists(),sym
 merge={}
 for file in [old,new]:
  with gzip.open(file,"rt",encoding="utf8") as q:
   for z in q:
    if not z.strip():continue
    a=json.loads(z);t=int(a[0]);c=float(a[4])
    if t in merge:assert merge[t]==c
    merge[t]=c
 bars[sym]=merge

life=collections.defaultdict(dict)
for row in allout:
 if row.get("route") not in needed:continue
 life[row["candidateId"]][row["mode"]]=row
entry_counters=collections.Counter()
out={}
for route in needed:
 events=[]
 samples=[z for z in rows if z["route"]==route]
 for z in samples:
  # Candidate IDs follow ordered forward source index, not route-local index.
  idx=rows.index(z)+1
  cid="V4_"+str(idx).zfill(5)
  c=bars[z["symbol"]];b=bars["BTCUSDT"];t=z["entryTs"]
  def ret(dd,n):
   return dd[t-H]/dd[t-(n+1)*H]-1
  close=np.array([c[t-j*H] for j in range(73,0,-1)],dtype=float)
  vol72=float(np.std(np.diff(np.log(close)),ddof=0))
  sym_ret6=ret(c,6);sym_ret12=ret(c,12);rel72=ret(c,72)-ret(b,72)
  sym_ret3=ret(c,3);btc_ret3=ret(b,3)
  f0=(vol72<=.00658 and sym_ret6>0)
  f1=(sym_ret3>-.0140114167 and btc_ret3>-.0058802215)
  f2=(f1 and sym_ret6>0)
  f3=(rel72>0 and sym_ret12>0)
  gate={"REC_X05_TIME_36H":f0,"REC_X07_TIME_6H":f2,"REC_X11_TIME_48H":f3}[route]
  simple={"REC_X05_TIME_36H":vol72<=.00658,"REC_X07_TIME_6H":f1,"REC_X11_TIME_48H":rel72>0}[route]
  pair=life.get(cid,{})
  native=pair.get("NATIVE");opposite=pair.get("OPPOSITE")
  assert not (native and native["symbol"]!=z["symbol"]),(cid,z["symbol"],native["symbol"])
  eligible=bool(native and opposite)
  improvement=(opposite["rawReturn"]-native["rawReturn"]) if eligible else None
  events.append({"candidateId":cid,"symbol":z["symbol"],"entryTs":t,"native_side":z["side"],
   "vol72":vol72,"sym_ret6":sym_ret6,"sym_ret12":sym_ret12,"rel72":rel72,
   "simple_gate":bool(simple),"composite_gate":bool(gate),"opposite_native_pair_modeled":eligible,
   "opposite_lifecycle_minus_native_return":improvement,
   "composite_good":bool(improvement>0) if eligible and gate else None,
   "composite_harmful":bool(improvement<0) if eligible and gate else None})
 n=[e for e in events if e["composite_gate"] and e["opposite_native_pair_modeled"]]
 out[route]={"candidates":len(events),"dual_lifecycle_complete":sum(e["opposite_native_pair_modeled"] for e in events),
  "simple_gate_count":sum(e["simple_gate"] for e in events),
  "composite_gate_count":sum(e["composite_gate"] for e in events),
  "composite_eligible":len(n),
  "composite_beneficial":sum(e["composite_good"] for e in n),
  "composite_harmful":sum(e["composite_harmful"] for e in n),
  "events":events}
report={"status":"RESEARCH_FALSIFICATION_ONLY_NOT_CAUSAL_OOS",
 "forward_strategy_status":src["strategyStatus"],
 "pin":src["pinnedSha"],"source_sha256":hashlib.sha256(raw.read_bytes()).hexdigest(),
 "lifecycle_sha256":hashlib.sha256(lifecycle.read_bytes()).hexdigest(),
 "source_period":src["period"],"routes":out,
 "limitations":["Source formally flags hindsight leakage and external Y06", "Forward tape already used in prior research; cannot treat as untouched test", "Native/opposite outcomes are modeled exits, not signed fills","No integrated 10/30bps or partial funding here","Multi-route evaluation only to falsify previously fixed composite conditions"]}
target=R/"DIRECTION_RESEARCH_20261109"/"v4_x05_x07_x11_tainted_forward_falsification_20261110.json"
target.write_text(json.dumps(report,indent=2,ensure_ascii=False)+"\n",encoding="utf8")
print("RESULT",target)
for k,v in out.items():
 print("ROUTE",k,"N",v["candidates"],"simple",v["simple_gate_count"],"composite",v["composite_gate_count"],"eligible",v["composite_eligible"],"beneficial",v["composite_beneficial"],"harmful",v["composite_harmful"])
 print("TRIGGERS",[(e["candidateId"],e["symbol"],e["composite_good"],e["opposite_lifecycle_minus_native_return"]) for e in v["events"] if e["composite_gate"]])
