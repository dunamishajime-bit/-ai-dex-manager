#!/usr/bin/env python3
"""PRISM II full audit checkpoint: source pin, old and forward exits, market H1/M5.

Validates recorded research artifacts and outputs a compact, source-inspectable
summary. This never makes network requests, sends orders or changes Production.
"""
from __future__ import annotations
import csv,datetime as dt,hashlib,json,math,statistics,sys
from collections import Counter
from pathlib import Path
ROOT=Path(r"C:\tmp\disdex-bt-20251001-20261001")
WORK=Path(sys.argv[1]) if len(sys.argv)>1 else Path(r"C:\Users\dis\Documents\DisDex_Research\WINRATE_DEEP_20261122")
O=WORK/"phase2_results"
F=WORK/"forward_public_20261001_20261118"
def read(name):return json.loads((O/name).read_text(encoding="utf-8"))
def jlines(path):return [json.loads(x) for x in path.open(encoding="utf8") if x.strip()]
def sha(path):
 h=hashlib.sha256()
 with path.open("rb") as f:
  for x in iter(lambda:f.read(2**18),b""):h.update(x)
 return h.hexdigest()
pin=read("PENGU_PINNED_SIGNAL_PARITY.json")
agg=read("PENGU_H1_M5AGG_SIGNAL_SENSITIVITY.json")
public=json.loads((F/"PUBLIC_FORWARD_MANIFEST.json").read_text(encoding="utf8"))
price=read("PRISM_H1_M5_SOURCE_COHERENCE_AUDIT.json")
regagg=read("PENGU_H1_M5_REAGGREGATE_MANIFEST.json")
forward=read("PENGU_PINNED_FORWARD_SIGNALS.json")
if not pin["eligible_for_forward"]:raise ValueError("ORIGINAL_ENTRY_PINNED_PARITY_NOT_PASSED")
assert pin["replay_count"]==pin["original_count"]==pin["matched_count"]==116
assert all(not pin[name] for name in ("missing_old","extra_old","price_mismatch","features_mismatch"))
assert len(forward["signals"])==11
assert Counter(s["route"] for s in forward["signals"])=={"SHORT_V20":7,"RECOVERY_V8":4}
assert all(x["status"]=="COMPLETE_COVERAGE" for x in public["files"].values())
assert all(x["rows"]==x["expectedRows"] for x in public["files"].values())
assert len(public["files"])==4
for key,z in public["files"].items():
 p=F/z["file"]
 assert sha(p)==z["gzipFileSha256"],key
old_root=ROOT/"PENGU_NATIVE_LIFECYCLE_EXIT_20261109"
old=jlines(old_root/"pengu-native-lifecycle-modeled-exits.jsonl")
recheck=jlines(O/"native_lifecycle_original_recheck"/"pengu-native-lifecycle-modeled-exits.jsonl")
new=jlines(O/"native_lifecycle_forward"/"pengu-native-lifecycle-modeled-exits.jsonl")
assert len(old)==len(recheck)==116
assert len(new)==11
fields=("entryTs","exitTs","decisionReferenceTs","route","side","entryPrice","exitPrice","exitReason","exitPriceKind","remainingQuantityFraction")
for i,(a,b) in enumerate(zip(old,recheck)):
 for key in fields:
  if isinstance(a.get(key),(int,float)):
   assert abs(a[key]-b[key])<1e-10,("EXIT_PARITY_MISMATCH",i,key)
  else:assert a.get(key)==b.get(key),("EXIT_PARITY_MISMATCH",i,key)
 assert a["partialEvents"]==b["partialEvents"]
assert len({x["id"] for x in new})==11
assert agg["original_count"]==116 and agg["replay_count"]==115 and agg["matched_count"]==115
assert len(agg["missing_old"])==1 and len(agg["extra_old"])==0
assert regagg["rebuilt_complete_M5_H1_hours"]==9912 and regagg["h1_open_delta_gt_5bps"]==3533
coherence={}
for x in price["comparisons"]:
 key=x["symbol"]+"_"+x["period"]
 coherence[key]={"hours":x["checked_hours"],
 "open_gt_5bps":x["delta_pct"]["open"]["n_gt_5bps"],
 "open_gt_50bps":x["delta_pct"]["open"]["n_gt_50bps"],
 "open_max_pct":x["delta_pct"]["open"]["max"],
 "high_gt_5bps":x["delta_pct"]["high"]["n_gt_5bps"],
 "low_gt_5bps":x["delta_pct"]["low"]["n_gt_5bps"],
 "close_gt_5bps":x["delta_pct"]["close"]["n_gt_5bps"],
 "volume_gt_5bps":x["delta_pct"]["volume"]["n_gt_5bps"]}
assert coherence["PENGUUSDT_baseline"]["open_gt_5bps"]==3289
assert coherence["PENGUUSDT_forward"]["open_gt_5bps"]==244
assert coherence["BTCUSDT_baseline"]["open_gt_5bps"]==0
assert coherence["BTCUSDT_forward"]["open_gt_5bps"]==0

# Model a weighted closed lifecycle: originally closed fraction * its filled
# stop price plus remaining fraction * final price. Never assume final exit
# price represents the already-closed partial quantity.
weighted=[]
for x in new:
 n=1 if x["side"]=="LONG" else -1
 remain=1.0;gross=0.0
 for e in x["partialEvents"]:
  ratio=e["closedQuantityFractionOfCurrent"]
  if not 0<ratio<=1:raise ValueError("BAD_PARTIAL_QUANTITY")
  closed=remain*ratio
  gross+=closed*n*(e["price"]/x["entryPrice"]-1)
  remain-=closed
 assert abs(remain-x["remainingQuantityFraction"])<=1e-9
 gross+=remain*n*(x["exitPrice"]/x["entryPrice"]-1)
 weighted.append({"route":x["route"],"id":x["id"],
  "entry_ts":x["entryTs"],"exit_ts":x["exitTs"],
  "exit_reason":x["exitReason"],"partial_events":len(x["partialEvents"]),
  "price_net10bps_pct":100*(gross-.001),
  "price_net30bps_pct":100*(gross-.003),
  "terminal_only_net30bps_pct":100*(x["rawReturn"]-.003),
  "weighted_net30bps_pct":100*(gross-.003),
  "remaining_fraction":remain,"entry_price":x["entryPrice"],
  "exit_price":x["exitPrice"]})
def cohort(group):
 n=len(group)
 w10=sum(x["price_net10bps_pct"]>0 for x in group)
 w30=sum(x["price_net30bps_pct"]>0 for x in group)
 mean=lambda v:round(statistics.mean(v),4) if v else None
 return {"n":n,"wins10":w10,"wins30":w30,
  "win_rate10_pct":round(100*w10/n,2) if n else None,
  "win_rate30_pct":round(100*w30/n,2) if n else None,
  "mean_price10_pct":mean([x["price_net10bps_pct"] for x in group]),
  "mean_price30_pct":mean([x["price_net30bps_pct"] for x in group])}
modelstats={route:cohort([x for x in weighted if route=="ALL" or x["route"]==route])
 for route in ("ALL","SHORT_V20","RECOVERY_V8")}
assert modelstats["ALL"]["wins30"]==5
assert modelstats["SHORT_V20"]["wins30"]==3
assert modelstats["RECOVERY_V8"]["wins30"]==2
assert sum(x["partial_events"] for x in weighted)==1
source=read("PENGU_FORWARD_20261001_20261118_REPORT.json")
assert source["candidate_count"]==11 and source["H1_M5_disparity_over_5bps"]==3

# Print model-vs-independent-replay disagreement of the price-only 72h / 48h
# studies to avoid conflating fixed horizon tests with the original lifecycle.
legacy={
 "source_entry_pin":"1657e173d250ad58f53e62f7bb0a3428fb405496",
 "source_signal_blob":"06476fed9985a165cf73971e790322ef3d03bd90",
 "source_116_entry_parity":116,"source_116_native_exit_parity":116,
 "forward_pinned_n":11,"forward_unresolved":0,
 "forward_native_model_weighted":modelstats,
 "source_h1_m5_coherence":coherence,
 "H1_to_M5_aggregation_original_116":agg["replay_count"],
 "H1_to_M5_aggregation_original_dropped_short_v20":[x["entryTs"] for x in agg["missing_old"]],
 "H1_to_M5_aggregation_forward_candidates":len(read("PENGU_FORWARD_SIGNALS_M5AGG_SENSITIVITY.json")["signals"]),
 "new_period_native_H1_M5_gt_5bps_at_signal":3,
 "model_proof":"Pinned current source pure functions: native entry + native H1 exit, but modeled prices not signed executions"}
audit={"schema":"disdex-prism2-external-validation-checkpoint/v1",
 "periods":{"baseline":"2025-10-01/2026-10-01 UTC","forward":"2026-10-01/2026-11-18 UTC"},
 "verification_status":"READ_ONLY_HISTORICAL_COHORT_RECALC_PASS",
 "source_hashes":{"public_forward":{k:v["uncompressedSha256"] for k,v in public["files"].items()},
   "pinned_native_original_116_signal":sha(ROOT/"native-new-signal-20251001-20261001"/"native-PENGU-raw-intentions.jsonl"),
   "pinned_native_baseline_116_exit":sha(old_root/"pengu-native-lifecycle-modeled-exits.jsonl"),
   "pinned_native_forward_11_exit":sha(O/"native_lifecycle_forward"/"pengu-native-lifecycle-modeled-exits.jsonl")},
 "findings":legacy,
 "forward_weighted_trade_ledger":weighted,
 "limitations":["This is evidence of fixed PENGU source consistency, not Production installed SHA verification",
  "Native H1 resident STOP/trailing modeled stop prices are not actual exchange fills; funding omitted",
  "No shared Gross / position occupancy or correlated signal portfolio replay",
  "No 70/80 target achieved; 11 signals far too few for confidence in live win rates",
  "H1/M5 price inconsistency changes native entry price and 1 historical candidate, so dual-source STOP replay requires conservative bounds",
  "No deployed strategy/economic changes; do not treat historical rule selection as blind future success"]}
( O/"PRISM_PHASE2_VERIFIED_COMPACT_CHECKPOINT.json").write_text(
 json.dumps(audit,ensure_ascii=False,indent=2,sort_keys=True,allow_nan=False)+"\n",encoding="utf8")
with (O/"PRISM_PHASE2_NATIVE_FORWARD_PARTIAL_WEIGHTED_LEDGER.csv").open("w",encoding="utf-8-sig",newline="") as p:
 writer=csv.DictWriter(p,list(weighted[0]));writer.writeheader();writer.writerows(weighted)
print("PRISM2_INDEPENDENT_RECHECK_PASS",json.dumps({"entry116":116,"exit116":116,
 "forward11":11,"model_win10":modelstats["ALL"]["wins10"],"model_win30":modelstats["ALL"]["wins30"],
 "source_change":agg["replay_count"],"price_consistency":{k:v["open_gt_5bps"] for k,v in coherence.items()}},ensure_ascii=False),flush=True)
