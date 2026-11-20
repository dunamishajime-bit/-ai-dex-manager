#!/usr/bin/env python3
"""Aggregate historical STABLE4 modeled V4/HYPE exits, with provenance gates.

No venue fills, no market-data downloads, no order operations. Data may not match LIVE.
"""
from __future__ import annotations
import argparse
from collections import defaultdict
import csv
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import math

CASE="EFFECTIVE_CURRENT_CANONICAL_CAUSAL_THREE_PRETARGET_STABLE3_Q102_ADOPTED_ON"
TARGETS=frozenset({"V4","HYPE"})
START="2025-10-01T00:00:00Z"
END="2026-10-01T00:00:00Z"

def file_sha(path: Path)->str:
    h=hashlib.sha256()
    with path.open("rb") as f:
        for part in iter(lambda:f.read(1<<20),b""):
            h.update(part)
    return h.hexdigest()

def valid_float(value: str, label: str)->float:
    try:
        n=float(value)
    except (TypeError,ValueError):
        raise ValueError(f"invalid number: {label}")
    if not math.isfinite(n):
        raise ValueError(f"nonfinite number: {label}")
    return n

def make_bucket()->dict:
    return {"exits":0,"wins":0,"net_losses":0,"adverse_price_exits":0,
            "positive_pnl_jpy":0.0,"negative_pnl_jpy":0.0,"net_pnl_jpy":0.0,
            "worst_exit_pnl_jpy":None,"exit_reasons":defaultdict(int),"model_classes":defaultdict(int)}

def add(bucket: dict,row:dict)->None:
    pnl=valid_float(row["net_pnl_jpy"],"net_pnl_jpy")
    start=valid_float(row["model_entry_price"],"entry_price")
    end=valid_float(row["model_exit_price"],"exit_price")
    if start<=0 or end<=0 or row["side"] not in ("LONG","SHORT"):
        raise ValueError("invalid side or model price")
    bucket["exits"]+=1
    bucket["wins"]+=int(pnl>0)
    bucket["net_losses"]+=int(pnl<0)
    adverse=end<start if row["side"]=="LONG" else end>start
    bucket["adverse_price_exits"]+=int(adverse)
    bucket["positive_pnl_jpy"]+=max(0,pnl)
    bucket["negative_pnl_jpy"]+=min(0,pnl)
    bucket["net_pnl_jpy"]+=pnl
    w=bucket["worst_exit_pnl_jpy"]
    bucket["worst_exit_pnl_jpy"]=pnl if w is None else min(w,pnl)
    bucket["exit_reasons"][row["exit_model_reason"]]+=1
    bucket["model_classes"][row["model_class"]]+=1

def finalize(bucket:dict)->dict:
    n=bucket["exits"]
    return {
        **{k:(round(v,6) if isinstance(v,float) else v) for k,v in bucket.items() if k not in ("exit_reasons","model_classes")},
        "win_rate_pct":round(bucket["wins"]*100/n,4) if n else None,
        "negative_pnl_exit_pct":round(bucket["net_losses"]*100/n,4) if n else None,
        "adverse_exit_price_direction_pct":round(bucket["adverse_price_exits"]*100/n,4) if n else None,
        "exit_reasons":dict(sorted(bucket["exit_reasons"].items())),
        "model_classes":dict(sorted(bucket["model_classes"].items())),
    }

def aggregate(rows:list[dict],study_scenario:dict,observed:dict)->dict:
    expected=study_scenario["modeled_exits"]
    if len(rows)!=expected:
        raise ValueError("Research fill count mismatch")
    seen=set()
    records={name:{"total":make_bucket(),"routes":defaultdict(make_bucket),"symbols":defaultdict(make_bucket),"months":defaultdict(make_bucket)} for name in TARGETS}
    expected_sha={model["model"]:model for model in observed["models"] if model["model"] in TARGETS}
    if set(expected_sha)!=TARGETS:
        raise ValueError("Missing source pin records")
    for row in rows:
        i=row["trade_id"]
        if i in seen:
            raise ValueError("Duplicate model trade ID")
        seen.add(i)
        if row["actual_venue_order_id"] or row["signed_execution_verified"]!="False":
            raise ValueError("Unexpected actual execution evidence")
        if not START<=row["entry_utc"]<END or not row["entry_utc"]<=row["exit_utc"]:
            raise ValueError("Out-of-range modeled fill")
        name=row["strategy"]
        if name not in TARGETS:
            continue
        sha=row["source_runtime_sha"]
        if sha not in expected_sha[name]["source_shas"]:
            raise ValueError("Fill source SHA violates research audit")
        group=records[name]
        add(group["total"],row)
        add(group["routes"][row["route"]],row)
        add(group["symbols"][row["symbol"]],row)
        add(group["months"][row["entry_utc"][:7]],row)
    return {
        name:{
            "research_source_shas":expected_sha[name]["source_shas"],
            "observed_live_sha":expected_sha[name]["observed_live_sha"],
            "current_live_source_matches":expected_sha[name]["source_sha_matches_live"],
            "requires_live_code_reexecution":True,
            "total":finalize(group["total"]),
            "routes":{key:finalize(value) for key,value in sorted(group["routes"].items())},
            "symbols":{key:finalize(value) for key,value in sorted(group["symbols"].items())},
            "entry_months":{key:finalize(value) for key,value in sorted(group["months"].items())},
        } for name,group in records.items()
    }

def verify_source_integrity(report:dict,source_audit:dict,study:dict)->None:
    if source_audit.get("schema")!="disdex-bt-stable4-research-source-audit/v1":
        raise ValueError("Untrusted independent source audit")
    for bps in ("10","30"):
        recorded=report["scenarios"][bps]
        basis=source_audit["scenarios"][bps]
        if recorded["fills_source_sha256"]!=basis["fills_file_sha256"]:
            raise ValueError("Research fills SHA256 mismatch")
        if recorded["source_modeled_exits"]!=basis["modeled_exits"]:
            raise ValueError("Independent research fill count mismatch")
        model_count={m["model"]:m["modeled_exits"] for m in study["scenarios"][bps]["models"]}
        for name in TARGETS:
            if recorded["by_model"][name]["total"]["exits"]!=model_count[name]:
                raise ValueError("Runner modeled exit provenance mismatch")


def audit(data_root:Path,study:dict)->dict:
    if study.get("schema")!="disdex-bt-stable4-vps-source-comparison/v1":
        raise ValueError("Unknown study audit")
    results={}
    for bps in ("10","30"):
        name=f"{CASE}_{bps}BPS_FILLS.csv"
        path=data_root/name
        if not path.is_file():
            raise ValueError("Missing research model ledger")
        # Verify source file digest from the independent prior research audit.
        source=json.loads((data_root/f"{CASE}_{bps}BPS_SUMMARY.json").read_text(encoding="utf-8"))
        if source.get("modeled_fills")!=study["scenarios"][bps]["modeled_exits"]:
            raise ValueError("Research model exit count mismatch")
        with path.open(encoding="utf-8-sig",newline="") as fh:
            rows=list(csv.DictReader(fh))
        results[bps]={
            "fills_source_sha256":file_sha(path),
            "source_modeled_exits":len(rows),
            "by_model":aggregate(rows,study["scenarios"][bps],study["scenarios"][bps]),
        }
    return {
        "schema":"disdex-bt-model-only-v4-hype-loss-forensics/v1",
        "created_utc":datetime.now(timezone.utc).isoformat(),
        "period_utc_start_inclusive":START,"period_utc_end_exclusive":END,
        "not_actual_exchange_fills":True,"historical_research_not_current_live":True,
        "future_information_leakage_and_causal_replay_verified":False,
        "modeled_adverse_price_not_wrong_signal_proof":True,
        "production_bt_parity_certified":False,
        "scenarios":results,
    }

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    root=Path(__file__).resolve().parents[2]
    parser.add_argument("--data-root",required=True,type=Path)
    parser.add_argument("--source-audit",type=Path,default=root/"docs/research-results/BT_STABLE4_SOURCE_PARITY_AUDIT_20261119.json")
    parser.add_argument("--study",type=Path,default=root/"docs/research-results/BT_STABLE4_VS_LIVE_SOURCE_20261119_UNCERTIFIED.json")
    parser.add_argument("--output",type=Path,default=root/"docs/research-results/BT_STABLE4_V4_HYPE_LOSS_FORENSICS_20261119_UNCERTIFIED.json")
    args=parser.parse_args()
    study=json.loads(args.study.read_text(encoding="utf-8"))
    report=audit(args.data_root,study)
    verify_source_integrity(report,json.loads(args.source_audit.read_text(encoding="utf-8")),study)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    for bps,case in report["scenarios"].items():
        for name,row in case["by_model"].items():
            s=row["total"]
            print(f"{bps}bps {name}: model_exits={s['exits']} wins={s['wins']} loss_exits={s['net_losses']} adverse={s['adverse_price_exits']} model_net_pnl_jpy={s['net_pnl_jpy']:.2f} live_sha_mismatch={not row['current_live_source_matches']}")
    print("NOT_CERTIFIED_MODELED_RESEARCH_NOT_LIVE")
if __name__=="__main__":
    main()
