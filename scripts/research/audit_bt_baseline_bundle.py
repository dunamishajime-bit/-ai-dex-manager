#!/usr/bin/env python3
"""Read-only integrity check for the 2025-2026 reusable BT evidence bundle."""
import argparse, hashlib, json, pathlib, re, sys
p=argparse.ArgumentParser()
p.add_argument("bundle",type=pathlib.Path)
p.add_argument("--out",type=pathlib.Path)
args=p.parse_args()
root=args.bundle
required=["RECONCILIATION.json","SHA256SUMS.txt","ENTRY_SIGNAL_LEDGER.csv","MODELED_EXECUTIONS_AND_PNL.csv","SOURCE_FILE_HASH_INDEX.csv"]
issues=["MISSING:"+n for n in required if not (root/n).is_file()]
rec={}
if not issues:
    rec=json.loads((root/"RECONCILIATION.json").read_text(encoding="utf-8-sig"))
if rec.get("period_utc_start_inclusive")!="2025-10-01T00:00:00Z" or rec.get("period_utc_end_exclusive")!="2026-10-01T00:00:00Z":
    issues.append("PERIOD_MISMATCH")
if rec.get("schema")!="disdex-reusable-bt-evidence-20251001-20261001/v1":
    issues.append("SCHEMA_MISMATCH")
checked=0
if (root/"SHA256SUMS.txt").is_file():
    for line in (root/"SHA256SUMS.txt").read_text(encoding="utf-8-sig").splitlines():
        if not line.strip():continue
        match=re.fullmatch(r"([a-fA-F0-9]{64})\s+\*?(.+)",line.strip())
        if not match:
            issues.append("HASH_LINE_INVALID");continue
        expected,name=match.groups()
        file=root/name
        if not file.is_file() or file.resolve().parent!=root.resolve():
            issues.append("HASH_FILE_MISSING:"+name);continue
        if hashlib.sha256(file.read_bytes()).hexdigest()!=expected.lower():
            issues.append("HASH_MISMATCH:"+name)
        else:checked+=1
result={
    "dataset_id":"baseline-20251001-20261001-reusable-ledger-v1",
    "period_utc_start_inclusive":"2025-10-01T00:00:00Z",
    "period_utc_end_exclusive":"2026-10-01T00:00:00Z",
    "integrity":"PASS" if not issues else "FAIL",
    "verified_file_hashes":checked,"issues":issues,
    "source_status":rec.get("status"),
    "raw_intents_total":rec.get("raw_intents_total"),
    "raw_intents_by_source":rec.get("by_source"),
    "unique_modeled_trades":rec.get("unique_modeled_trades"),
    "standalone_scenario_rows":rec.get("modeled_scenario_execution_rows"),
    "actual_exchange_fills_verified":rec.get("actual_exchange_fills_verified"),
    "certification":"NOT_CERTIFIED_EIGHT_RUNNER",
    "complete_eight_runner_portfolio":False,
    "note":"Integrity PASS does not establish production runner parity or a complete integrated portfolio."
}
output=json.dumps(result,ensure_ascii=False,indent=2)+"\n"
if args.out:
    args.out.parent.mkdir(parents=True,exist_ok=True)
    args.out.write_text(output,encoding="utf-8")
print(output)
sys.exit(0 if not issues else 2)