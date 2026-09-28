"""Restore historical V52 model candidates from an authenticated, SHA-pinned
successful GitHub Actions artifact, avoiding Yahoo intraday-data vendor drift.

This is a source-tape restore, not a replay of an outcome or alteration of
V12 entries. Candidate tape is the original all-five Aster/Yahoo backtest
run #36325740751. Both baseline and variants must replay the same tape.
"""
from __future__ import annotations
import argparse, hashlib, json
from collections import Counter
from pathlib import Path

ARCHIVE_RUN=36325740751
DECISIONS_SHA="f1ee5c56cbc26818d0d191f370b6af4ac87f220ac58699ddb0e8fb521aa8c787"
V52_SUMMARY_SHA="e589319a497c75a26dd18e0fb578c71ed0b52bcd67702900f4a4219c61fb31a8"

def digest(path:Path)->str:
    return hashlib.sha256(path.read_bytes()).hexdigest()

def restore(archive_root:Path,output:Path)->dict:
    decision=archive_root/"formal-user-request/BRK0P75_MR0P75_FET1_DUAL_GATE/PRICE_MODEL_10BPS/candidate-decisions.jsonl"
    summary=archive_root/"formal-v52-ledger/v52-model-summary.json"
    if digest(decision)!=DECISIONS_SHA:
        raise ValueError("ARCHIVED_ORIGINAL_CANDIDATE_DECISIONS_HASH_MISMATCH")
    if digest(summary)!=V52_SUMMARY_SHA:
        raise ValueError("ARCHIVED_ORIGINAL_V52_SUMMARY_HASH_MISMATCH")
    src=json.loads(summary.read_text())
    if (src.get("status")!="RESEARCH_PRICE_MODEL_CLOSED_SAMPLE"
            or src.get("modeled_closed_trades")!=88 or src.get("entry_skipped")!=11):
        raise ValueError("ARCHIVED_ORIGINAL_V52_SOURCE_STATUS_MISMATCH")
    rows=[json.loads(line) for line in decision.read_text().splitlines() if line]
    target=[row for row in rows if row.get("strategy_id")=="V52"]
    if len(target)!=99:raise ValueError("ARCHIVED_ORIGINAL_V52_DECISION_COUNT_MISMATCH")
    lifecycles=[];counter=Counter()
    for row in target:
        decision_kind=row.get("decision")
        symbol=row["symbol"]
        if decision_kind=="EXCLUDED_PREALLOCATION":
            if row.get("reason")!="SINGLE_V50_SLOT_ALREADY_OPEN":
                raise ValueError("UNEXPECTED_ORIGINAL_V52_SKIP:"+str(row.get("reason")))
            lifecycles.append({"status":"SKIPPED_CANDIDATE","symbol":symbol,
                "decision_ts_ms":int(row["decision_ts_ms"]),
                "reason":row["reason"],"session":row.get("v52_source_session")})
            counter["skipped"]+=1
        else:
            if (row.get("upstream_status")!="MODELED_CLOSED_TRADE"
                    or decision_kind not in ("ACCEPTED_MODELED_ENTRY","REJECTED_PORTFOLIO")):
                raise ValueError("UNEXPECTED_ORIGINAL_V52_LIFECYCLE:"+str(row))
            mandatory=("entry_ts_ms","candidate_entry_price_usd","candidate_exit_ts_ms",
                       "candidate_exit_price_usd","candidate_exit_reason","side",
                       "v52_entry_basis_bps","v52_yahoo_entry_reference_usd")
            if any(row.get(k) is None for k in mandatory):
                raise ValueError("ARCHIVED_ORIGINAL_V52_LIFECYCLE_MISSING_FIELDS")
            entry=float(row["candidate_entry_price_usd"])
            exit_price=float(row["candidate_exit_price_usd"])
            side=row["side"]
            if not entry>0 or not exit_price>0 or side not in ("LONG","SHORT"):
                raise ValueError("ARCHIVED_V52_INVALID_PRICE_OR_DIRECTION")
            return_unit=(exit_price/entry-1)*(1 if side=="LONG" else -1)
            lifecycle={"status":"MODELED_CLOSED_TRADE","symbol":symbol,
                "side":side,"entry_ts_ms":int(row["entry_ts_ms"]),
                "exit_ts_ms":int(row["candidate_exit_ts_ms"]),
                "aster_entry_price_usd":entry,"aster_exit_price_usd":exit_price,
                "reason":row["candidate_exit_reason"],"gross_price_return":return_unit,
                "slot_gross":float(row.get("requested_gross") or 2.0),
                "entry_basis_bps":float(row["v52_entry_basis_bps"]),
                "yahoo_entry_reference_usd":float(row["v52_yahoo_entry_reference_usd"]),
                "session":row.get("v52_source_session"),
                "historical_fill_verified":False}
            lifecycles.append(lifecycle)
            counter["closed"]+=1
            counter["exit:"+row["candidate_exit_reason"]]+=1
    if counter["closed"]!=88 or counter["skipped"]!=11:
        raise ValueError("ARCHIVED_ORIGINAL_V52_COUNTS_DIFFER")
    exit_reasons=dict(Counter({key.split("exit:",1)[1]:value
                               for key,value in counter.items() if key.startswith("exit:")}))
    if src["exit_reasons"]!=exit_reasons:
        raise ValueError("ARCHIVED_V52_EXIT_REASON_COUNTS_MISMATCH")
    lifecycles.sort(key=lambda r:(int(r.get("entry_ts_ms") or r.get("decision_ts_ms")),r["symbol"]))
    output.mkdir(parents=True,exist_ok=True)
    ledger=output/"v52-model-ledger.jsonl"
    ledger.write_text("".join(json.dumps(r,sort_keys=True,allow_nan=False)+"\n" for r in lifecycles))
    (output/"v52-model-summary.json").write_bytes(summary.read_bytes())
    status={"status":"ARCHIVED_ORIGINAL_V52_TAPE_RESTORED_EXACT_SHA256",
            "artifact_workflow_run_id":ARCHIVE_RUN,"model_closed":88,"model_skipped":11,
            "archive_decisions_sha256":DECISIONS_SHA,
            "archive_v52_summary_sha256":V52_SUMMARY_SHA,
            "reconstructed_v52_ledger_sha256":digest(ledger),
            "original_v52_market_price_tape_reused_in_both_scenarios":True,
            "not_live_fills":True,
            "not_new_yahoo_vendor_acquisition":True}
    (output/"restore-provenance.json").write_text(json.dumps(status,indent=2,sort_keys=True)+"\n")
    print("ARCHIVED_V52_SOURCE_TAPE_RESTORED",json.dumps(status,sort_keys=True),flush=True)
    return status

if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument("--archive-root",type=Path,required=True)
    p.add_argument("--output",type=Path,required=True)
    a=p.parse_args()
    restore(a.archive_root,a.output)
