#!/usr/bin/env python3
"""PENGU Recovery V8 2h: compare native LONG, fee-aware flatten, actual earlier 2h reverse modeled SHORT.
No candidate promotion, no orders. Existing native exit/parital results and 2h counterfactual are research models.
"""
import json,hashlib,collections,math,datetime as dt
from pathlib import Path
R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
P=R/"DIRECTION_RESEARCH_20261109"
lab=P/"pengu_v8_all2h_benefit_labeled_20261110.jsonl"
rev=P/"pengu_recovery_v8_2h_all_reversal_input_20261110.jsonl"
native=R/"PENGU_NATIVE_LIFECYCLE_EXIT_20261109"/"pengu-native-lifecycle-modeled-exits.jsonl"
source=R/"native-new-signal-20251001-20261001"/"native-PENGU-raw-intentions.jsonl"
labels=[json.loads(s) for s in lab.open(encoding="utf8") if s.strip()]
revrows={x["originalId"]:x for x in [json.loads(s) for s in rev.open(encoding="utf8") if s.strip()]}
nativemap={x["id"]:x for x in [json.loads(s) for s in native.open(encoding="utf8") if s.strip()]}
assert len(labels)==51 and len(revrows)==51
rows=[]
for a in labels:
 nr=nativemap[a["id"]];rs=revrows[a["id"]]
 assert a["entryTs"]==nr["entryTs"]==rs["originalEntryTs"]
 assert nr["side"]=="LONG" and nr["route"]=="RECOVERY_V8"
 assert rs["side"]=="SHORT" and rs["entryTs"]==a["decisionTs"]
 feasible=a["feasible"] and a["decisionTs"]<nr["exitTs"]
 gross=rs["entryReferenceOpenPrice"]/nr["entryPrice"]-1.
 # SHORT flip vs early-flatten: early flatten does not incur re-entry fee or fresh short risk.
 # Fee units are round-trip 10/30bps approximated exactly as labeled net flow, funding if any not included.
 flat10=gross-.001
 flat30=gross-.003
 x={"id":a["id"],"entryTs":a["entryTs"],"nativeExitTs":nr["exitTs"],
    "nativeExitReason":nr["exitReason"],"nativeEntryPrice":nr["entryPrice"],
    "nativeGross":nr["rawReturn"],"feasible":bool(feasible),
    "earlyOpenPrice":rs["entryReferenceOpenPrice"],"early_flat_gross":gross,
    "net_native_10":a["native_net_10"],"net_native_30":a["native_net_30"],
    "net_flat_10":flat10,"net_flat_30":flat30,
    "net_reverse_10":a["reversal_net_10"],"net_reverse_30":a["reversal_net_30"],
    "post2h_pengu_return":a.get("p_r2"),"post2h_btc_return":a.get("b_r2"),
    "past_pengu_return72":a.get("f_penguReturn72h"),
    "past_btc_return24":a.get("f_btcReturn24h")}
 if feasible:
  for b in ("10","30"):
   x["delta_flat_vs_native_"+b]=x["net_flat_"+b]-x["net_native_"+b]
   x["delta_reverse_vs_native_"+b]=x["net_reverse_"+b]-x["net_native_"+b]
   x["delta_flat_vs_reverse_"+b]=x["net_flat_"+b]-x["net_reverse_"+b]
 rows.append(x)
assert sum(x["feasible"] for x in rows)==50
def summary(xs):
 good=[z for z in xs if z["feasible"]]
 def metric(name):
  val=[z[name] for z in good]
  return {"sum":sum(val),"mean":sum(val)/len(val) if val else None,
    "positive":sum(x>1e-10 for x in val),"negative":sum(x< -1e-10 for x in val)}
 return {"n":len(xs),"n_feasible":len(good),
  "native_exits":dict(collections.Counter(z["nativeExitReason"] for z in xs)),
  "10bps":{name:metric(name+"_10") for name in [
   "delta_flat_vs_native","delta_reverse_vs_native","delta_flat_vs_reverse"]},
  "30bps":{name:metric(name+"_30") for name in [
   "delta_flat_vs_native","delta_reverse_vs_native","delta_flat_vs_reverse"]}}
clusters=[]
for x in rows:
 if not clusters or x["entryTs"]>=clusters[-1]["end"]:
  clusters.append({"start":x["entryTs"],"end":x["nativeExitTs"],"ids":[x["id"]]})
 else:
  clusters[-1]["end"]=max(clusters[-1]["end"],x["nativeExitTs"])
  clusters[-1]["ids"].append(x["id"])
byid={x["id"]:x for x in rows}
episodes=[]
for c in clusters:
 group=[byid[k] for k in c["ids"]]
 episodes.append({"start":dt.datetime.fromtimestamp(c["start"]/1000,dt.timezone.utc).isoformat(),
 "n":len(group),"feasible":sum(x["feasible"] for x in group),
 "flat_delta10":sum(x.get("delta_flat_vs_native_10",0) for x in group),
 "reverse_delta10":sum(x.get("delta_reverse_vs_native_10",0) for x in group)})
def month(x):return dt.datetime.fromtimestamp(x["entryTs"]/1000,dt.timezone.utc).strftime("%Y-%m")
months={m:summary([x for x in rows if month(x)==m]) for m in sorted({month(x) for x in rows})}
slices={"train":summary(rows[:31]),"validation":summary(rows[31:41]),"test":summary(rows[41:])}
result={"status":"RESEARCH_ONLY_NOT_INDEPENDENT_OOS_NOT_PRODUCTION",
 "ledger_hashes":{name:hashlib.sha256(f.read_bytes()).hexdigest() for name,f in [("benefit",lab),("reverse",rev),("native",native)]},
 "limitations":["2h flat price next H1 open is modeled, not signed fill","2h flat funding not included; native and flip labeled funding treatment needs reconciliation before parity",
 "Native stops/partial guarded by strictly earlier nativeExitTs; cannot intervene after native exit",
 "Episode overlap undermines independent trade counts","No shared-gross, slot, DD, portfolio integration in this route study",
 "All 51 cases previously inspected and not untouched OOS"],
 "overall":summary(rows),"phases":slices,"monthly":months,"episodes":episodes,
 "rows":rows}
file=P/"pengu_v8_2h_native_vs_flat_vs_flip_episode_audit_20261110.json"
file.write_text(json.dumps(result,indent=2,ensure_ascii=False)+"\n",encoding="utf8")
print("RESULT",file)
print("OVERALL",json.dumps(result["overall"]))
print("PHASES",{k:{"n":z["n"],"feasible":z["n_feasible"],
 "flat10_sum":z["10bps"]["delta_flat_vs_native"]["sum"],
 "reverse10_sum":z["10bps"]["delta_reverse_vs_native"]["sum"]} for k,z in slices.items()})
print("EPISODES",len(episodes),"FLAT_POS",sum(z["flat_delta10"]>0 for z in episodes),
 "REV_POS",sum(z["reverse_delta10"]>0 for z in episodes))
print("MONTHS",{k:{"n":v["n"],"flat":v["10bps"]["delta_flat_vs_native"]["sum"],"flip":v["10bps"]["delta_reverse_vs_native"]["sum"]} for k,v in months.items()})
