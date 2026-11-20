#!/usr/bin/env python3
"""Reproduce historical HYPE 48h-before-rel24 selection with pinned pure signals.

Read-only Aster H1 research analysis. This is NOT a portfolio admission,
execution, stop, funding or validated LIVE backtest.
"""
from __future__ import annotations
import argparse
from datetime import datetime,timezone
import gzip
import hashlib
import json
import math
from pathlib import Path
import re

HOUR=3_600_000
START=int(datetime(2025,10,1,tzinfo=timezone.utc).timestamp()*1000)
END=int(datetime(2026,10,1,tzinfo=timezone.utc).timestamp()*1000)
PARAMETER_NAMES={"BASE_H12_MAX":"h12Max","BASE_H24_MIN":"h24Min","WSIG_REL24_MAX":"rel24Max"}

def iso(ms:int)->str:
    return datetime.fromtimestamp(ms/1000,tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def sha(path:Path)->str:
    h=hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda:fh.read(1024*1024),b""):h.update(chunk)
    return h.hexdigest()

def check_generator(source:str)->dict[str,float]:
    # Fail closed if the original study generator's two-stage ordering changes.
    anchors=['base=[];free=-1','if x["entryTs"]<free: continue',
             'base.append(x);free=x["entryTs"]+48*H',
             'return [x for x in base if x["rel24"]<=WSIG_REL24_MAX]',
             'for e in range(start,end,6*H):','s=e-H; ent=hd.get(e)']
    positions=[]
    for item in anchors:
        if source.count(item)!=1:
            raise ValueError("UNKNOWN_HYPE_GENERATOR_ORDER_OR_DUPLICATE:"+item[:28])
        positions.append(source.index(item))
    if not (positions[0]<positions[1]<positions[2]<positions[3]):
        raise ValueError("HYPE_GENERATOR_ORDER_NOT_PROVEN")
    result={}
    for old,short in PARAMETER_NAMES.items():
        matches=re.findall(r"^"+re.escape(old)+r"=([0-9.]+)$",source,re.M)
        if len(matches)!=1:raise ValueError("SOURCE_THRESHOLD_NOT_VERIFIED:"+old)
        result[short]=float(matches[0])
        if not math.isfinite(result[short]):raise ValueError("INVALID_SOURCE_THRESHOLD")
    return result

def candles(path:Path)->dict[int,tuple[float,float]]:
    output={}
    with gzip.open(path,"rt",encoding="utf8") as f:
        for line in f:
            if not line.strip():continue
            row=json.loads(line)
            if not isinstance(row,list) or len(row)<5:
                raise ValueError("MALFORMED_HYPE_H1_BAR")
            ms=int(row[0]);op=float(row[1]);close=float(row[4])
            if ms in output or ms%HOUR or op<=0 or close<=0 or not math.isfinite(close):
                raise ValueError("DUPLICATE_OR_INVALID_H1_BAR")
            output[ms]=(op,close)
    return output

def raw_candidates(hype:dict[int,tuple[float,float]],btc:dict[int,tuple[float,float]],p:dict[str,float])->list[dict]:
    rows=[]
    for entry in range(START,END,6*HOUR):
        s=entry-HOUR
        needs=((hype,entry),(hype,s),(hype,s-12*HOUR),(hype,s-24*HOUR),(btc,s),(btc,s-24*HOUR))
        if any(t not in d for d,t in needs):
            continue
        h12=hype[s][1]/hype[s-12*HOUR][1]-1
        h24=hype[s][1]/hype[s-24*HOUR][1]-1
        b24=btc[s][1]/btc[s-24*HOUR][1]-1
        if h12<=p["h12Max"] and h24>=p["h24Min"]:
            rows.append({"ts":entry,"rel24":h24-b24})
    return rows

def apply_ordering(base:list[dict],max_rel:float,window_ms:int=48*HOUR)->dict:
    if any(base[i]["ts"]>=base[i+1]["ts"] for i in range(len(base)-1)):
        raise ValueError("UNSORTED_HYPE_BASE_CANDIDATES")
    before=[]
    suppressed=[]
    free=-1
    blocker=None
    for row in base:
        if row["ts"]<free:
            suppressed.append({"candidate_ts":row["ts"],"rel24":row["rel24"],
                               "prior_base_ts":blocker["ts"],"prior_base_rel24_passes":blocker["rel24"]<=max_rel})
            continue
        before.append(row)
        blocker=row
        free=row["ts"]+window_ms
    selected=[x["ts"] for x in before if x["rel24"]<=max_rel]
    # A distinct counterfactual, not a proposal to authorize additional orders.
    signature=[x for x in base if x["rel24"]<=max_rel]
    free=-1
    after=[]
    for row in signature:
        if row["ts"]<free:continue
        after.append(row["ts"])
        free=row["ts"]+window_ms
    return {"base_count":len(base),"after_early_cooldown_count":len(before),
            "after_early_cooldown_and_rel24_count":len(selected),
            "all_signature_qualified_count":len(signature),
            "signature_first_then_cooldown_count":len(after),
            "historical_selected_times":selected,
            "independently_qualified_times":[x["ts"] for x in signature],
            "suppressed_base":suppressed,
            "counterfactual_late_cooldown_times":after}

def main()->None:
    parser=argparse.ArgumentParser(description=__doc__)
    root=Path(__file__).resolve().parents[2]
    evidence=root/"docs/research-results"
    parser.add_argument("--original-generator",type=Path,required=True)
    parser.add_argument("--original-cohort",type=Path,required=True)
    parser.add_argument("--hype-h1",type=Path,required=True)
    parser.add_argument("--btc-h1",type=Path,required=True)
    parser.add_argument("--pinned-pure",type=Path,default=evidence/"BT_HYPE_PINNED_PURE_SIGNAL_REPLAY_20261119_UNCERTIFIED.json")
    parser.add_argument("--pretarget-audit",type=Path,default=evidence/"BT_HYPE_PRETARGET_COHORT_COVERAGE_20261119_UNCERTIFIED.json")
    parser.add_argument("--output",type=Path,default=evidence/"BT_HYPE_EARLY_COOLDOWN_RECONSTRUCTION_20261119_UNCERTIFIED.json")
    args=parser.parse_args()
    p=check_generator(args.original_generator.read_text(encoding="utf8"))
    original=json.loads(args.original_cohort.read_text(encoding="utf8"))
    candidates=[r for r in original.get("topPretargetDiagnostics",[]) if r.get("params")==
        {"holdHours":48,"hardStop":0.06,"takeProfit":None,"softLoss":None,"watchHours":0}]
    if len(candidates)!=1:raise ValueError("PRETARGET_H48R4_COHORT_NOT_UNIQUE")
    expected=sorted(int(row["entryTs"]) for row in candidates[0]["targetRows"])
    pure=json.loads(args.pinned_pure.read_text(encoding="utf8"))
    prev=json.loads(args.pretarget_audit.read_text(encoding="utf8"))
    if pure.get("schema")!="disdex-bt-hype-pinned-pure-signal-replay/v1" or prev.get("schema")!="disdex-bt-hype-pretarget-cohort-source-coverage/v1":
        raise ValueError("HISTORICAL_COMPARISON_EVIDENCE_REQUIRED")
    if sha(args.original_cohort)!=prev.get("study_source_sha256"):
        raise ValueError("H48R4_COHORT_SHA256_MISMATCH")
    if sha(args.hype_h1)!=pure["market_h1_files"]["hype_sha256"] or sha(args.btc_h1)!=pure["market_h1_files"]["btc_sha256"]:
        raise ValueError("H1_MARKET_DATA_SHA256_MISMATCH")
    base=raw_candidates(candles(args.hype_h1),candles(args.btc_h1),p)
    result=apply_ordering(base,p["rel24Max"])
    if sorted(result["historical_selected_times"])!=expected:
        raise ValueError("HISTORICAL_27_COHORT_NOT_REPRODUCED")
    accepted=sorted(int(datetime.fromisoformat(r["utc"].replace("Z","+00:00")).timestamp()*1000) for r in pure["accepted_pure_signals"])
    if accepted!=result["independently_qualified_times"]:
        raise ValueError("PINNED_PURE_SIGNAL_OUTPUT_NOT_REPRODUCED")
    missing=sorted(set(accepted)-set(expected))
    suppressed={row["candidate_ts"]:row for row in result["suppressed_base"]}
    if len(missing)!=8 or not all(t in suppressed for t in missing):
        raise ValueError("MISSING_HYPE_PURE_SIGNALS_NOT_FULLY_EXPLAINED_BY_EARLY_COOLDOWN")
    if [iso(t) for t in missing]!=prev["scenarios"]["10"]["missing_candidate_timestamps"]:
        raise ValueError("HISTORICAL_GAP_IDENTITIES_DIFFER")
    gaps=[{"candidate_utc":iso(t),
           "prior_base_candidate_utc":iso(suppressed[t]["prior_base_ts"]),
           "prior_base_signal_rel24_gate_passed":suppressed[t]["prior_base_rel24_passes"],
           "hours_after_earlier_base_candidate":(t-suppressed[t]["prior_base_ts"])/HOUR,
           "reason_in_original_generator":"48_HOUR_PRE_SIGNATURE_COOLDOWN",
           "real_venue_order_block_confirmed":False} for t in missing]
    report={
      "schema":"disdex-bt-hype-early-cooldown-source-reproduction/v1",
      "created_utc":datetime.now(timezone.utc).isoformat(),
      "scope":"HISTORICAL_RESEARCH_ENTRY_COHORT_ONLY",
      "original_generator_sha256":sha(args.original_generator),
      "original_cohort_sha256":sha(args.original_cohort),
      "hype_h1_sha256":sha(args.hype_h1),"btc_h1_sha256":sha(args.btc_h1),
      "source_thresholds":p,
      "raw_h12_h24_candidates":result["base_count"],
      "raw_after_early_48h_cooldown":result["after_early_cooldown_count"],
      "historical_after_rel24_gate":result["after_early_cooldown_and_rel24_count"],
      "pinned_pure_signature_qualified":result["all_signature_qualified_count"],
      "pure_candidate_gaps_explained_by_early_cooldown":len(gaps),
      "gaps_with_earlier_base_failing_final_signature":sum(not x["prior_base_signal_rel24_gate_passed"] for x in gaps),
      "counterfactual_signature_first_48h_count":result["signature_first_then_cooldown_count"],
      "counterfactual_is_admitted_trade_count":False,
      "historical_selected_dates": [iso(t) for t in expected],
      "unrepresented_pure_candidate_details":gaps,
      "alternative_exit_funding_risk_and_dd_reexecuted":False,
      "production_bt_parity_certified":False,
    }
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
    print(f"RAW_BASE={report['raw_h12_h24_candidates']} EARLY_COOLDOWN={report['raw_after_early_48h_cooldown']} HISTORICAL={report['historical_after_rel24_gate']} PINNED_PURE={report['pinned_pure_signature_qualified']}")
    print(f"MISSING_EARLY_COOLDOWN={len(gaps)} BLOCKERS_FAIL_REL24={report['gaps_with_earlier_base_failing_final_signature']} SIGNATURE_FIRST_THEN_48H={report['counterfactual_signature_first_48h_count']}")
    print("H48R4_HISTORICAL_SOURCE_REPRODUCED_NOT_CURRENT_PRODUCTION_BTEQUIVALENCE")
if __name__=="__main__":
    main()
