#!/usr/bin/env python3
"""Provenance: distinguish raw native source from V2 hindsight-shadow outcomes.
Match only closed-bar source timestamp/symbol/sourceSide; no future labels.
"""
from pathlib import Path
import collections,hashlib,json
ROOT=Path(r"C:\tmp\disdex-bt-20251001-20261001")
N=ROOT/"DIRECTION_RESEARCH_20261109"/"NATIVE_CAUSAL_SOURCE_REPLAY_20261110"
B=ROOT/"DIRECTION_RESEARCH_20261109"
native=[json.loads(z) for z in (N/"asof-native-v12-source-signals.jsonl").open(encoding="utf8") if z.strip()]
legacy=[json.loads(z) for z in (B/"v4_source_strength_threeperiod.jsonl").open(encoding="utf8") if z.strip()]
old=[json.loads(z) for z in (ROOT/"native-new-signal-20251001-20261001"/"native-V4-raw-intentions.jsonl").open(encoding="utf8") if z.strip()]
target_start=1759276800000;target_end=1790812800000
nkeys={(r["decisionTs"],r["symbol"],r["side"]) for r in native}
nkey_prices={(r["decisionTs"],r["symbol"],r["side"]):r for r in native}
assert len(nkeys)==len(native),(len(nkeys),len(native))
assert len(old)==1394
assert len(legacy)==(598+1394+127),len(legacy)
assert all(r.get("sourceSignalTs") is not None and r.get("sourceSide") for r in legacy)
reports={}
for p,lo,hi in [("pre",1740787200000,target_start),("target",target_start,target_end)]:
 l=[z for z in legacy if lo<=z["decisionTs"]<hi]
 ns=[z for z in native if z["period"]==p]
 matched=[z for z in l if (z["sourceSignalTs"],z["symbol"],z["sourceSide"]) in nkeys]
 first_match=[z for z in l if (z["decisionTs"],z["symbol"],z["sourceSide"]) in nkeys]
 notmatched=[z for z in l if (z["sourceSignalTs"],z["symbol"],z["sourceSide"]) not in nkeys]
 native_referenced={(z["sourceSignalTs"],z["symbol"],z["sourceSide"]) for z in matched}
 matched_by_route=collections.Counter(z["route"] for z in matched)
 missing_by_route=collections.Counter(z["route"] for z in notmatched)
 recovered_by_symbol=collections.Counter(z["symbol"] for z in ns)
 reports[p]={"legacy_v2_rows":len(l),"pure_native_source_rows":len(ns),
  "legacy_rows_matching_native_source_time_symbol_side":len(matched),
  "legacy_rows_matching_same_decision_time_source_side":len(first_match),
  "unique_native_source_events_referenced_by_v2":len(native_referenced),
  "native_events_not_consumed_by_v2":len(ns)-len(native_referenced),
  "legacy_mismatch":len(notmatched),
  "native_source_side_counts":dict(collections.Counter(z["side"] for z in ns)),
  "matched_by_route":dict(matched_by_route),
  "mismatched_by_route":dict(missing_by_route),
  "mismatch_samples":[{k:z.get(k) for k in ["decisionTs","sourceSignalTs","symbol","side","sourceSide","route"]} for z in notmatched[:20]],
  "native_by_symbol":dict(recovered_by_symbol)}
# Compare target original tape parity across source strength row list (sourceSide independent)
targetlegacy=[z for z in legacy if target_start<=z["decisionTs"]<target_end]
v2set=collections.Counter((r["decisionTs"],r["symbol"],r["side"],r["route"]) for r in old)
oldset=collections.Counter((r["decisionTs"],r["symbol"],r["side"],r["route"]) for r in targetlegacy)
assert v2set==oldset,(len(v2set),len(oldset))
report={"status":"SOURCE_REPLAY_PROVENANCE_ONLY_NOT_PORTFOLIO_BT",
 "policy_not_clean_outofsample":"The native generator itself was fitted/committed in 2026. This test examines no-future-candle availability of its signals; no historical original-deployment claim.",
 "match_definition":"sourceSignalTs,symbol,sourceSide vs re-run native source decisionTs,symbol,side",
 "native_signal_tape_sha256":hashlib.sha256((N/"asof-native-v12-source-signals.jsonl").read_bytes()).hexdigest(),
 "legacy_strength_sha256":hashlib.sha256((B/"v4_source_strength_threeperiod.jsonl").read_bytes()).hexdigest(),
 "target_intention_sha256":hashlib.sha256((ROOT/"native-new-signal-20251001-20261001"/"native-V4-raw-intentions.jsonl").read_bytes()).hexdigest(),
 "per_period":reports}
out=N/"native_vs_hindsight_v2_matching_audit.json"
out.write_text(json.dumps(report,indent=2,ensure_ascii=False)+"\n",encoding="utf8")
print("OUTPUT",out)
for k,v in reports.items():
 print("PERIOD",k,"legacy",v["legacy_v2_rows"],"native",v["pure_native_source_rows"],"matched",v["legacy_rows_matching_native_source_time_symbol_side"],"mismatch",v["legacy_mismatch"],
 "native_unique_consumed",v["unique_native_source_events_referenced_by_v2"])
 print("MISMATCH_ROUTES",v["mismatched_by_route"])
 print("SAMPLES",v["mismatch_samples"][:4])
