#!/usr/bin/env python3
"""PENGU v64 and v20 unconditional 2h reversal/flatten replay with native stops preserved.
Research-only raw price, no signed venue fills or live changes; 2h native feasibility enforced.
"""
from pathlib import Path
import collections,datetime as dt,gzip,hashlib,json,math
import numpy as np
R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
D=R/"DIRECTION_RESEARCH_20261109";H=3600000
native_path=R/"PENGU_NATIVE_LIFECYCLE_EXIT_20261109"/"pengu-native-lifecycle-modeled-exits.jsonl"
native={r["id"]:r for r in [json.loads(s) for s in native_path.open(encoding="utf8") if s.strip()]}
assert len(native)==116
a={}
for symbol in ["BTCUSDT","PENGUUSDT"]:
 p=R/"aster-public-v3-h1"/(symbol+"-1h-20250924-20261001.jsonl.gz")
 with gzip.open(p,"rt",encoding="utf8") as f:
  a[symbol]={int(z[0]):float(z[4]) for z in (json.loads(line) for line in f if line.strip())}
models={}
for label,folder in [("LONG_V64","PENGU_LONG_V64_2H_ALL_OPPOSITE_LIFECYCLE_20261110"),
                     ("SHORT_V20","PENGU_SHORT_V20_2H_ALL_OPPOSITE_LIFECYCLE_20261110")]:
 f=R/folder/"pengu-reversal-exits.jsonl"
 modeled=[json.loads(s) for s in f.open(encoding="utf8") if s.strip()]
 expected=25 if label=="LONG_V64" else 40
 assert len(modeled)==expected
 seen=set();arr=[]
 for rv in modeled:
  nr=native[rv["id"]]
  assert rv["id"] not in seen;seen.add(rv["id"])
  assert rv["originalEntryTs"]==nr["entryTs"] and rv["reversalTs"]==nr["entryTs"]+2*H
  assert rv["entryTs"]==rv["reversalTs"]
  assert nr["route"]==label and rv["route"]==label and nr["side"]!=rv["side"]
  feasible=nr["exitTs"]>rv["entryTs"] and not any(
   int(pe.get("eventTs",0))<=rv["entryTs"] for pe in nr.get("partialEvents",[]))
  first_leg=(rv["entryPrice"]/nr["entryPrice"]-1)*(1 if nr["side"]=="LONG" else -1)
  net_early_raw=first_leg
  flip_raw=first_leg+rv["rawReturn"]
  gross_delta=flip_raw-nr["rawReturn"]
  z={"id":nr["id"],"route":label,"entryTs":nr["entryTs"],"nativeExitTs":nr["exitTs"],
     "nativeExitReason":nr["exitReason"],"feasible":feasible,
     "nativeRaw":nr["rawReturn"],"first_leg":first_leg,"fresh_opposite_raw":rv["rawReturn"],
     "gross_delta_flip_vs_native":gross_delta,
     "gross_delta_flat_vs_native":net_early_raw-nr["rawReturn"]}
  for bps,charge in [(10,.001),(30,.003)]:
   z[f"delta_flip_vs_native_{bps}"]=gross_delta-charge
   z[f"delta_flat_vs_native_{bps}"]=net_early_raw-nr["rawReturn"]
  if label=="LONG_V64":
   t=nr["entryTs"];pp=a["PENGUUSDT"];bb=a["BTCUSDT"]
   bpx=np.array([bb[t-(i+1)*H] for i in range(73)][::-1])
   pre_b_vol72=float(np.std(np.diff(np.log(bpx)),ddof=0))
   pre_rel12=math.log(pp[t-H]/pp[t-13*H])-math.log(bb[t-H]/bb[t-13*H])
   z["pre_btc_vol72"]=pre_b_vol72;z["pre_rel12"]=pre_rel12
   z["fixed_gate"]=pre_b_vol72>0.003308885226898718 and pre_rel12>0.07355376317477447
  arr.append(z)
 arr.sort(key=lambda x:(x["entryTs"],x["id"]))
 def stat(sub):
  q=[x for x in sub if x["feasible"]]
  def delta(field):
   values=[x[field] for x in q]
   return {"sum":sum(values),"improved":sum(v>1e-10 for v in values),
      "harmed":sum(v< -1e-10 for v in values),"mean":sum(values)/len(values) if values else None}
  return {"n":len(sub),"n_feasible":len(q),
   "native_profit_count":sum(x["nativeRaw"]>0 for x in q),
   "native_gross_sum":sum(x["nativeRaw"] for x in q),
   "delta_10_flip":delta("delta_flip_vs_native_10"),
   "delta_10_flat":delta("delta_flat_vs_native_10"),
   "delta_30_flip":delta("delta_flip_vs_native_30"),
   "delta_30_flat":delta("delta_flat_vs_native_30")}
 episodes=[]
 for e in arr:
  if not episodes or e["entryTs"]>=episodes[-1]["end"]:
   episodes.append({"begin":e["entryTs"],"end":e["nativeExitTs"],"ids":[e["id"]]})
  else:
   episodes[-1]["end"]=max(episodes[-1]["end"],e["nativeExitTs"])
   episodes[-1]["ids"].append(e["id"])
 byid={e["id"]:e for e in arr}
 for e in episodes:
  e["n"]=len(e["ids"])
  e["flip_delta_10"]=sum(byid[k]["delta_flip_vs_native_10"] for k in e["ids"] if byid[k]["feasible"])
  if label=="LONG_V64":
   e["fixed_gate_hits"]=sum(byid[k]["fixed_gate"] for k in e["ids"])
 if label=="LONG_V64":
  flags=[z for z in arr if z["fixed_gate"]]
  known={"PENGU_00012","PENGU_00020","PENGU_00023","PENGU_00024",
         "PENGU_00068","PENGU_00098","PENGU_00099"}
  assert set(x["id"] for x in flags)==known
  gated={"n":len(flags),"score":stat(flags),
   "episodes_hit":sum(e["fixed_gate_hits"]>0 for e in episodes),
   "episode_groups":[e["ids"] for e in episodes if e["fixed_gate_hits"]]}
 else:gated=None
 splits={"train":arr[:int(len(arr)*.6)],
         "validation":arr[int(len(arr)*.6):int(len(arr)*.8)],
         "test":arr[int(len(arr)*.8):]}
 models[label]={"total":stat(arr),"slices":{k:stat(v) for k,v in splits.items()},
   "episodes_count":len(episodes),"episodes":episodes,
   "fixed_gate":gated,"rows":arr}
report={"status":"RESEARCH_ONLY_NO_RULE_PROMOTION",
 "source_sha256":{"native":hashlib.sha256(native_path.read_bytes()).hexdigest()},
 "method":"At 2h compare current native exit, close only at fresh opposite entry OPEN, or close+fresh opposite whose exit uses pinned opposite policy. Preserve earlier native STOP/partial, use gross response and incremental flip roundtrip cost.",
 "limitations":["Modeled OHLC limit/stop, not venue fills; first-leg funding and opposite funding omitted",
 "Native rawReturn may differ from actual filled/partially closed PnL, check per-route partial events",
 "All 2025-2026 historical cases already used for strategy research; not independent OOS",
 "Fixed V64 gate pre-btc72h vol and log-relative12h reproduced from CLOSED bars; same data were used to select threshold; synthetic bull case breaks it",
 "Overlapping episodes are correlated; no integrated Gross/slots/DD"],"routes":models}
p=D/"pengu_v64_v20_native_flat_flip_episode_recheck_20261110.json"
p.write_text(json.dumps(report,indent=2,ensure_ascii=False)+"\n",encoding="utf8")
print("RESULT",p)
for name,item in models.items():
 print("ROUTE",name,"TOTAL",json.dumps(item["total"]),
  "EPISODES",item["episodes_count"])
 if item["fixed_gate"]:print("FIXED_GATE",json.dumps(item["fixed_gate"]))
 print("PHASES",[(k,v["n_feasible"],round(v["delta_10_flip"]["sum"],4),
 round(v["delta_10_flat"]["sum"],4)) for k,v in item["slices"].items()])
