#!/usr/bin/env python3
"""Identify the provenance boundary of missing HYPE research decisions.

Compares immutable-model source HYPE 48h pretarget cohort with saved PURE
pinned live candidate time keys and the ORIGINAL STABLE4 research decision CSV.
Never treats source selection as proof of a LIVE portfolio decision or fill.
"""
from __future__ import annotations
import argparse
import csv
from datetime import datetime,timezone
import hashlib
import json
from pathlib import Path

CASE="EFFECTIVE_CURRENT_CANONICAL_CAUSAL_THREE_PRETARGET_STABLE3_Q102_ADOPTED_ON"
EXPECTED_PARAMS={"holdHours":48,"hardStop":0.06,"takeProfit":None,"softLoss":None,"watchHours":0}
START="2025-10-01T00:00:00Z"
END="2026-10-01T00:00:00Z"

def sha(path:Path)->str:
    return hashlib.sha256(path.read_bytes()).hexdigest()

def source_dates(source:dict)->list[str]:
    if source.get("status")!="RESEARCH_ONLY_HYPE_WSIG_FIXED_ENTRY_M5_EXIT_PRETARGET_SELECTION":
        raise ValueError("UNTRUSTED_PRETARGET_SOURCE")
    if source.get("selectionUsesTarget") is not False:
        raise ValueError("PRETARGET_SELECTION_LEAKAGE_UNVERIFIED")
    target=int(source.get("entryCounts",{}).get("TARGET",-1))
    cohorts=[row for row in source.get("topPretargetDiagnostics",[]) if row.get("params")==EXPECTED_PARAMS]
    if len(cohorts)!=1 or not isinstance(cohorts[0].get("targetRows"),list):
        raise ValueError("UNIQUE_H48R4_COHORT_NOT_IDENTIFIED")
    ts_list=[row["entryTs"] for row in cohorts[0]["targetRows"]]
    if len(ts_list)!=target or not all(type(ts) is int and ts>0 for ts in ts_list) or len(set(ts_list))!=len(ts_list):
        raise ValueError("INCOMPLETE_OR_DUPLICATE_H48R4_TARGET_COHORT")
    times=[datetime.fromtimestamp(ts/1000,tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") for ts in ts_list]
    if any(not START<=iso<END for iso in times):
        raise ValueError("H48R4_TARGET_OUTSIDE_STUDY")
    return sorted(times)

def compare(target:list[str], decisions:list[dict], pure:list[str])->dict:
    if len(target)!=len(set(target)) or len(pure)!=len(set(pure)):
        raise ValueError("DUPLICATE_COHORT_OR_PINNED_SIGNAL")
    if len(decisions)!=len({row["utc"] for row in decisions}):
        raise ValueError("DUPLICATE_STABLE4_HYPE_DECISION")
    when={row["utc"] for row in decisions}
    if when!=set(target):
        raise ValueError("MODEL_DECISIONS_DO_NOT_EQUAL_PRETARGET_COHORT")
    if not when.issubset(set(pure)):
        raise ValueError("PRETARGET_COHORT_NOT_SUBSET_OF_PINNED_PURE_SIGNALS")
    if any(row["decision"] not in ("MODEL_ENTER","BLOCK") for row in decisions):
        raise ValueError("UNEXPECTED_DECISION_CLASS")
    extra=sorted(set(pure)-when)
    return {
        "pretarget_h48r4_source_candidates":len(target),
        "study_portfolio_decision_rows":len(decisions),
        "pinned_pure_signal_candidates":len(pure),
        "pure_signals_missing_from_pretarget_cohort":len(extra),
        "missing_candidate_timestamps":extra,
        "pretarget_cohort_equals_study_hype_decision_dates":True,
        "research_cohort_selection_exclusion_reason_verified":False,
        "HYPE_venue_execution_count_verified":False,
    }

def audit(source:dict,source_sha:str,pure:dict,decision_data:dict[str,tuple[list[dict],str]],existing:dict)->dict:
    if pure.get("schema")!="disdex-bt-hype-pinned-pure-signal-replay/v1" or pure.get("production_bt_parity_certified") is not False:
        raise ValueError("PINNED_PURE_SIGNAL_EVIDENCE_UNCERTIFIED_REQUIRED")
    if existing.get("schema")!="disdex-bt-hype-pinned-signal-to-model-decision-reconciliation/v1":
        raise ValueError("ORIGINAL_RESEARCH_RECONCILIATION_REQUIRED")
    target=source_dates(source)
    pinned=[row["utc"] for row in pure["accepted_pure_signals"]]
    if len(pinned)!=pure.get("accepted_pure_signal_count"):
        raise ValueError("PINNED_CANDIDATE_COUNT_MISMATCH")
    scenarios={}
    for bps in ("10","30"):
        rows,decision_sha=decision_data[bps]
        if decision_sha!=existing["scenarios"][bps]["decision_csv_sha256"]:
            raise ValueError("INDEPENDENT_DECISION_SHA256_MISMATCH")
        data=compare(target,rows,pinned)
        if data["missing_candidate_timestamps"]!=existing["scenarios"][bps]["pure_signals_without_hype_decision"]:
            raise ValueError("MISSING_CANDIDATE_IDS_CONFLICT")
        scenarios[bps]={**data,"original_decisions_sha256":decision_sha}
    return {
        "schema":"disdex-bt-hype-pretarget-cohort-source-coverage/v1",
        "created_utc":datetime.now(timezone.utc).isoformat(),
        "study_source_sha256":source_sha,
        "study_source_status":source["status"],
        "selectionUsesTarget":False,
        "source_cohort_entry_rule":source["entryRule"],
        "source_selected_params":EXPECTED_PARAMS,
        "pinned_live_hype_pure_source_sha":pure["observed_live_git_commit"],
        "causal_selection_exclusion_logic_reproduced":False,
        "all_live_portfolio_gates_reproduced":False,
        "research_vs_current_economic_parity_certified":False,
        "scenarios":scenarios,
    }

def main()->None:
    repo=Path(__file__).resolve().parents[2]
    evidence=repo/"docs/research-results"
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--cohort-file",required=True,type=Path)
    p.add_argument("--study-root",required=True,type=Path)
    p.add_argument("--pure",type=Path,default=evidence/"BT_HYPE_PINNED_PURE_SIGNAL_REPLAY_20261119_UNCERTIFIED.json")
    p.add_argument("--decisions-evidence",type=Path,default=evidence/"BT_HYPE_PURE_SIGNAL_MODEL_DECISION_RECONCILE_20261119_UNCERTIFIED.json")
    p.add_argument("--output",type=Path,default=evidence/"BT_HYPE_PRETARGET_COHORT_COVERAGE_20261119_UNCERTIFIED.json")
    args=p.parse_args()
    lookup={}
    for bps in ("10","30"):
        file=args.study_root / f"{CASE}_{bps}BPS_DECISIONS.csv"
        with file.open("r",encoding="utf-8-sig",newline="") as fh:
            rows=[row for row in csv.DictReader(fh) if row["strategy"]=="HYPE"]
        lookup[bps]=(rows,sha(file))
    report=audit(json.loads(args.cohort_file.read_text(encoding="utf-8")),sha(args.cohort_file),
                 json.loads(args.pure.read_text(encoding="utf-8")),lookup,
                 json.loads(args.decisions_evidence.read_text(encoding="utf-8")))
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    for bps,row in report["scenarios"].items():
        print(f"{bps}bps target_cohort={row['pretarget_h48r4_source_candidates']} research_decisions={row['study_portfolio_decision_rows']} pure_signals={row['pinned_pure_signal_candidates']} missing_from_source={row['pure_signals_missing_from_pretarget_cohort']}")
    print("PRETARGET_COHORT_BOUNDARY_IDENTIFIED_SELECTION_REASON_NOT_YET_REPRODUCED")

if __name__=="__main__":
    main()
