from pathlib import Path
import json,csv,collections,hashlib
R=Path(r"C:\tmp\disdex-prism7-p107-parity-audit-20261122")
D=Path(r"C:\tmp\disdex-bt-20251001-20261001\native-new-signal-20251001-20261001")
f=R/"P107_V4_PIN_NATIVE_H1_1YEAR_DECISION_SCAN_20261123.json"
e=json.loads(f.read_text(encoding="utf8"))
current=[]
for event in e["results"]:
 if event.get("result")!="PIN_SOURCE_NATIVE_DECISION":continue
 for x in event["candidates"]:
  current.append({"decisionTs":event["decisionTs"],"symbol":x["symbol"],"side":x["effectiveSide"],"route":x["route"],"rank":x["rank"],"entryTs":x["eligibleEntryTs"],"sourceFingerprint":event["sourceFingerprint"],"btcRegime":event["btcRegime"]})
prev=[json.loads(x) for x in (D/"native-V4-raw-intentions.jsonl").read_text(encoding="utf8").splitlines() if x.strip()]
def key(x):
 return (str(x["decisionTs"]),str(x["symbol"]),str(x["side"]),str(x["route"]),int(x["rank"]),int(x["entryTs"]))
a=collections.Counter(key(x) for x in current);b=collections.Counter(key(x) for x in prev)
only_new=a-b;only_old=b-a
by_now={int(x["decisionTs"]):x for x in e["results"] if x.get("result")=="PIN_SOURCE_NATIVE_DECISION"}
finger_mismatch=[{"decisionTs":x["decisionTs"],"symbol":x["symbol"],"oldFingerprint":x["sourceFingerprint"],"newFingerprint":by_now[x["decisionTs"]]["sourceFingerprint"]} for x in prev if x["decisionTs"] in by_now and by_now[x["decisionTs"]]["sourceFingerprint"]!=x["sourceFingerprint"]]
oldShas=sorted(set(x.get("source_runtime_sha") for x in prev))
out={
 "schema":"p107-v4-native-pin-vs-20261109-legacy-entry-identity-v1",
 "pinned_new_SHA":"e788abc82e80f9fc7ab0e1ba83fdb8be267eb513",
 "old_tape_source_shas":oldShas,
 "new_current_count":len(current),"old_research_count":len(prev),
 "matching_key_occurrences":sum((a&b).values()),
 "new_not_old_occurrences":sum(only_new.values()),
 "old_not_new_occurrences":sum(only_old.values()),
 "new_not_old_examples":[list(x) for x in list(only_new)[:12]],
 "old_not_new_examples":[list(x) for x in list(only_old)[:12]],
 "sourceFingerprintMismatches":len(finger_mismatch),
 "sourceFingerprintMismatchExamples":finger_mismatch[:8],
 "commonDecisionTimestamps":len(set(x["decisionTs"] for x in current)&set(x["decisionTs"] for x in prev)),
 "current_pin_source_native_entry_production_parity":len(current)==len(prev) and not only_new and not only_old,
 "live_order_and_exit_parity":False,
 "old_source_sha_of_legacy_tape":oldShas,
 "sourceInputHash":hashlib.sha256(f.read_bytes()).hexdigest(),
 "legacyInputHash":hashlib.sha256((D/"native-V4-raw-intentions.jsonl").read_bytes()).hexdigest(),
}
p=R/"P107_V4_1394_ENTRY_IDENTITY_VS_OLD_LEDGER_20261123.json"
p.write_text(json.dumps(out,indent=2,ensure_ascii=False)+"\n",encoding="utf8")
print("IDENTITY",len(current),len(prev),"MATCHED",out["matching_key_occurrences"],"NEW_ONLY",out["new_not_old_occurrences"],"OLD_ONLY",out["old_not_new_occurrences"],"FINGERPRINT_MISMATCH",out["sourceFingerprintMismatches"])
print("EXAMPLE_MISMATCH",out["new_not_old_examples"][:2],out["old_not_new_examples"][:2])
