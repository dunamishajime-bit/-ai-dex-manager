#!/usr/bin/env python3
"""Read-only HYPE H48 exit-policy drift audit. No order, STOP or VPS mutation."""
from __future__ import annotations
import argparse, csv, hashlib, json, re, subprocess
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROUTE="HYPE_REDESIGN_CAUSAL_H48R4_WSIG"
CASE="EFFECTIVE_CURRENT_CANONICAL_CAUSAL_THREE_PRETARGET_STABLE3_Q102_ADOPTED_ON"
FILES=(
    "lib/hype-stable4-time-only-contract.ts",
    "lib/hype-stable4-time-only-authority.ts",
    "lib/hype-zec-long-runner.ts",
)

def digest(path:Path)->str:
    h=hashlib.sha256()
    with path.open("rb") as f:
        for part in iter(lambda:f.read(1<<20),b""):h.update(part)
    return h.hexdigest()

def pinned(repo:Path, sha:str, path:str)->bytes:
    if not re.fullmatch(r"[0-9a-f]{40}",sha):raise ValueError("UNTRUSTED_HYPE_SOURCE_SHA")
    call=subprocess.run(["git","-C",str(repo),"show",f"{sha}:{path}"],
                        capture_output=True,timeout=25)
    if call.returncode!=0:raise ValueError("PINNED_HYPE_SOURCE_UNAVAILABLE")
    return call.stdout

def source_exit_contract(blobs:dict[str,bytes])->dict:
    if set(blobs)!=set(FILES):raise ValueError("SOURCE_GRAPH_INCOMPLETE")
    contract=blobs[FILES[0]].decode("utf-8-sig")
    authority=blobs[FILES[1]].decode("utf-8-sig")
    runner=blobs[FILES[2]].decode("utf-8-sig")
    markers={
       "logical_48h_exit":"logicalExitTs:identity.logicalEntryTs+48*HOUR" in contract,
       "verified_next_open_exit":"HYPE_REDESIGN_TIME48_NEXTOPEN" in contract and "boundary.openTs!==c.logicalExitTs" in contract,
       "certificate_no_resident_stop":"v.residentStopRequired!==false" in authority,
       "certificate_no_resident_take_profit":"v.residentTakeProfitRequired!==false" in authority,
       "runner_persists_time_only_contract":"if(nativeExitContract)pendingEntry.nativeExitContract=nativeExitContract;" in runner,
       "runner_returns_before_legacy_protective_orders":"return{status:\"completed\",message:\"HYPE_H48_TIME_ONLY_ENTRY_COMPLETED\"" in runner and runner.find("HYPE_H48_TIME_ONLY_ENTRY_COMPLETED")<runner.find("this.dependencies.adapter.placeStopMarket"),
       "runner_requires_signed_h48_before_entry":"await this.assertH48TimeOnlyPolicy(nativeExitContract,quantity.quantity,lock,\"ENTRY\")" in runner,
       "runner_h48_owner_early_exit_path":"async preemptH48ForV4(" in runner,
    }
    if not all(markers.values()):
        raise ValueError("PINNED_HYPE_H48_EXIT_CONTRACT_CHANGED_OR_NOT_PROVEN")
    return markers

def model_exit_counts(target_rows:list[dict])->dict[str,int]:
    if len(target_rows)!=27:raise ValueError("UNEXPECTED_H48_RESEARCH_TARGET_SIZE")
    reasons=Counter()
    seen=set()
    for row in target_rows:
        timestamp=row["entryTs"]
        if not isinstance(timestamp,int) or timestamp in seen:
            raise ValueError("DUPLICATE_OR_INVALID_HYPE_TARGET")
        seen.add(timestamp)
        reason=row["reason"]
        if reason not in ("STOP","TIME"):raise ValueError("UNSUPPORTED_STUDY_EXIT_REASON")
        if row["exitTs"]<=timestamp:raise ValueError("STUDY_EXIT_NOT_AFTER_ENTRY")
        reasons[reason]+=1
    return dict(sorted(reasons.items()))

def research_hype_integrated_counts(path:Path,expected_sha:str)->dict[str,int]:
    if digest(path)!=expected_sha:raise ValueError("INTEGRATED_MODEL_FILL_SHA256_MISMATCH")
    with path.open("r",encoding="utf-8-sig",newline="") as fp:
        rows=[row for row in csv.DictReader(fp) if row["strategy"]=="HYPE"]
    if len(rows)!=5:raise ValueError("INTEGRATED_MODEL_EXIT_COUNT_MISMATCH")
    if len({row["trade_id"] for row in rows})!=len(rows):
        raise ValueError("INTEGRATED_MODEL_TRADE_ID_NOT_UNIQUE")
    return dict(sorted(Counter(row["exit_model_reason"] for row in rows).items()))

def build(repo:Path,source_files:dict[str,bytes],observed:dict,verified:dict,prior:dict,study:dict,study_path:Path,forensic:dict,model_path_by_bps:dict[str,Path])->dict:
    if observed.get("schema")!="disdex-bt-vps-entrypoint-parity/v1" or observed.get("all_entrypoints_verified") is not True:
        raise ValueError("OBSERVED_VPS_SHA_EVIDENCE_REQUIRED")
    pins=[row for row in observed.get("rows",[]) if row.get("runner")=="HYPE" and row.get("verified") is True]
    if len(pins)!=1:raise ValueError("HYPE_VPS_SHA_AMBIGUOUS")
    if verified.get("schema")!="disdex-bt-live-vps-dependency-bytes/v1" or verified.get("all_files_match") is not True:
        raise ValueError("VPS_SOURCE_BYTES_NOT_VERIFIED")
    for filename in FILES:
        matches=[r for r in verified["rows"] if r.get("runner")=="HYPE" and r.get("path")==filename and r.get("verified") is True]
        if len(matches)!=1:raise ValueError("HYPE_EXIT_FILE_NOT_VPS_VERIFIED:"+filename)
    if prior.get("schema")!="disdex-bt-hype-early-cooldown-source-reproduction/v1" or digest(study_path)!=prior["original_cohort_sha256"]:
        raise ValueError("PRETARGET_COHORT_SOURCE_PROOF_MISSING")
    if forensic.get("schema")!="disdex-bt-model-only-v4-hype-loss-forensics/v1":
        raise ValueError("INDEPENDENT_INTEGRATED_FILL_AUDIT_REQUIRED")
    source_markers=source_exit_contract(source_files)
    rows=[r for r in study["topPretargetDiagnostics"] if r.get("params")=={"holdHours":48,"hardStop":0.06,"takeProfit":None,"softLoss":None,"watchHours":0}]
    if len(rows)!=1:raise ValueError("H48_RESEARCH_EXIT_PARAMS_AMBIGUOUS")
    standalone=model_exit_counts(rows[0]["targetRows"])
    if standalone!={"STOP":6,"TIME":21}:raise ValueError("PRETARGET_H48_EXIT_DISTRIBUTION_CHANGED")
    integrated={}
    for bps in ("10","30"):
        expected=forensic["scenarios"][bps]["fills_source_sha256"]
        counts=research_hype_integrated_counts(model_path_by_bps[bps],expected)
        if counts!={"FORMAL_PRIORITY":2,"HYPE_REDESIGN_TIME48_NEXTOPEN":3}:
            raise ValueError("INTEGRATED_HYPE_EXIT_TYPES_CHANGED")
        integrated[bps]={"model_exits":sum(counts.values()),"model_exit_reasons":counts,
                         "source_model_fills_sha256":expected}
    return {
       "schema":"disdex-bt-hype-h48-exit-policy-parity-audit/v1",
       "generated_utc":datetime.now(timezone.utc).isoformat(),
       "observed_hype_git_sha":pins[0]["git_commit"],
       "observed_snapshot_utc":observed["observed_utc"],
       "pinned_vps_source_byte_matching_verified":True,
       "pinned_source_sha256":{k:hashlib.sha256(v).hexdigest() for k,v in source_files.items()},
       "pinned_source_contract_markers":source_markers,
       "pretarget_study_cohort_sha256":digest(study_path),
       "original_research_h48_independent_candidate_exit_count":sum(standalone.values()),
       "original_research_h48_independent_candidate_exit_reasons":standalone,
       "original_research_h48_stop_pct":6.0,
       "pinned_h48_certificate_requires_resident_stop":False,
       "pinned_h48_certificate_requires_resident_take_profit":False,
       "pinned_h48_time_exit_hours":48,
       "pinned_h48_conditional_v4_preemption_possible":True,
       "integrated_stable4_modeled_hype_exits":integrated,
       "exit_policy_difference_requires_reexecution":True,
       "historical_exit_outcomes_mapped_to_current_h48":False,
       "signed_certificate_runtime_activation_verified":False,
       "live_stop_inventory_and_trade_fills_verified":False,
       "current_live_exit_slippage_or_dd_computed":False,
       "production_bt_parity_certified":False,
    }

def main():
    repo=Path(__file__).resolve().parents[2]
    evidence=repo/"docs/research-results"
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--study-root",type=Path,required=True)
    ap.add_argument("--cohort",type=Path,required=True)
    ap.add_argument("--output",type=Path,default=evidence/"BT_HYPE_H48_EXIT_POLICY_PARITY_20261119_UNCERTIFIED.json")
    args=ap.parse_args()
    observed=json.loads((evidence/"BT_VPS_ENTRYPOINT_PARITY_20261119_UNCERTIFIED.json").read_text(encoding="utf-8"))
    rows=[r for r in observed["rows"] if r.get("runner")=="HYPE" and r.get("verified") is True]
    if len(rows)!=1:raise ValueError("HYPE_SHA_AMBIGUOUS")
    blobs={p:pinned(repo,rows[0]["git_commit"],p) for p in FILES}
    paths={bps:args.study_root/f"{CASE}_{bps}BPS_FILLS.csv" for bps in ("10","30")}
    report=build(repo,blobs,observed,
       json.loads((evidence/"BT_LIVE_VPS_DEPENDENCY_BYTES_20261119_UNCERTIFIED.json").read_text(encoding="utf-8")),
       json.loads((evidence/"BT_HYPE_EARLY_COOLDOWN_RECONSTRUCTION_20261119_UNCERTIFIED.json").read_text(encoding="utf-8")),
       json.loads(args.cohort.read_text(encoding="utf-8")),args.cohort,
       json.loads((evidence/"BT_STABLE4_V4_HYPE_LOSS_FORENSICS_20261119_UNCERTIFIED.json").read_text(encoding="utf-8")),
       paths)
    args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print("PINNED_HYPE_H48_NO_RESIDENT_STOP_AND_NO_TAKE_PROFIT_CERTIFICATE_REQUIRED")
    print("INDEPENDENT_STUDY_MODEL_EXITS="+json.dumps(report["original_research_h48_independent_candidate_exit_reasons"],sort_keys=True))
    for bps,values in report["integrated_stable4_modeled_hype_exits"].items():
        print(bps+"bps_INTEGRATED_MODELED_EXITS="+json.dumps(values["model_exit_reasons"],sort_keys=True))
    print("CURRENT_LIVE_EXIT_POLICY_PARITY=BLOCKED_REPLAY_REQUIRED")
if __name__=="__main__":
    main()
