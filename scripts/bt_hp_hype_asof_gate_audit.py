#!/usr/bin/env python3
"""Audit HYPE source admissions across 10/30bps and historical LIVE gate proof.

A historical model entry is NEVER classified as accepted by current LIVE.
Missing as-of Kill Switch/V4 STOP owner/Gross evidence stays UNKNOWN.
No API clients, trading or runtime mutation. Research result only.
"""
from __future__ import annotations
import argparse,csv,json,math,hashlib
from pathlib import Path
from datetime import datetime,timezone

GATES=("shared_kill_switch","v4_stop_ownership","shared_gross","market_data")
FIELDS={"trade_id","utc","logic","symbol","route","side","source_signal_id","source_runtime_sha"}
FILL_FIELDS={"trade_id","strategy","symbol","entry_utc","exit_utc","net_pnl_jpy"}
PROOF_FIELDS={"source_signal_id","utc","symbol","route","observed_utc",*GATES}
ALLOWED={"PASS","BLOCK"}

def utc(x:str)->datetime:
    d=datetime.fromisoformat(x.strip().replace("Z","+00:00"))
    if d.tzinfo is None:raise ValueError("Naive timestamp")
    return d.astimezone(timezone.utc)

def read(path:Path, required:set[str])->list[dict]:
    with path.open("r",encoding="utf-8-sig",newline="") as fp:
        r=csv.DictReader(fp)
        if not r.fieldnames or not required.issubset(set(r.fieldnames)):
            raise ValueError("Missing evidence columns: "+path.name)
        return list(r)

def digest(path:Path)->str:
    h=hashlib.sha256()
    with path.open("rb") as f:
        for x in iter(lambda:f.read(1048576),b""):h.update(x)
    return h.hexdigest()

def load_case(entries_path:Path,fills_path:Path)->dict:
    rows=read(entries_path,FIELDS)
    fills=read(fills_path,FILL_FIELDS)
    all_entry_ids=set()
    hype=[]
    for rec in rows:
        key=rec["trade_id"].strip()
        if not key or key in all_entry_ids:raise ValueError("Invalid/duplicate admission ID")
        all_entry_ids.add(key)
        if rec["logic"]!="HYPE":continue
        if rec["symbol"]!="HYPEUSDT" or not rec["route"] or not rec["source_signal_id"]:
            raise ValueError("HYPE source identity incomplete")
        if len(rec["source_runtime_sha"])!=40:raise ValueError("Invalid HYPE source SHA")
        hype.append(rec)
    by_id={}
    for row in fills:
        key=row["trade_id"]
        if key in by_id:raise ValueError("Duplicate model fill ID")
        by_id[key]=row
    out={}
    for row in hype:
        f=by_id.get(row["trade_id"])
        if f is None:raise ValueError("HYPE model exit absent: "+row["trade_id"])
        if f["strategy"]!="HYPE" or f["symbol"]!=row["symbol"] or utc(f["entry_utc"])!=utc(row["utc"]):
            raise ValueError("HYPE fill/admission identity mismatch")
        pnl=float(f["net_pnl_jpy"])
        if not math.isfinite(pnl) or utc(f["exit_utc"])<=utc(row["utc"]):
            raise ValueError("Invalid HYPE exit/PnL")
        key=(utc(row["utc"]).isoformat(),row["source_signal_id"],row["symbol"],row["route"])
        if key in out:raise ValueError("Duplicate HYPE signal admission")
        out[key]={"time":row["utc"],"signalId":row["source_signal_id"],
                 "symbol":row["symbol"],"route":row["route"],"sourceSha":row["source_runtime_sha"],
                 "tradeId":row["trade_id"],"exitUtc":f["exit_utc"],"modelNetPnlJpy":pnl}
    if not out:raise ValueError("No HYPE source admissions")
    return out

def proof_map(path:Path|None)->dict:
    if path is None:return {}
    found={}
    for row in read(path,PROOF_FIELDS):
        key=(utc(row["utc"]).isoformat(),row["source_signal_id"],row["symbol"],row["route"])
        if key in found:raise ValueError("Duplicate historic gate observation")
        t=utc(row["utc"]); obs=utc(row["observed_utc"])
        if obs>t or (t-obs).total_seconds()>300:
            raise ValueError("Noncausal or stale historic gate evidence")
        if any(row[g] not in ALLOWED for g in GATES):
            raise ValueError("Unverifiable gate state (PASS/BLOCK required)")
        found[key]={g:row[g] for g in GATES}
    return found

def audit(ten:dict,thirty:dict,proof:dict)->dict:
    if set(ten)!=set(thirty):raise ValueError("10bps/30bps HYPE admission sets drift")
    if set(proof)-set(ten):raise ValueError("Unknown historical gate signal")
    signals=[]
    for key in sorted(ten):
        a,b=ten[key],thirty[key]
        if a["sourceSha"]!=b["sourceSha"] or a["exitUtc"]!=b["exitUtc"]:
            raise ValueError("10bps/30bps HYPE lifecycle/source drift")
        states=proof.get(key)
        decision="UNKNOWN_NO_HISTORICAL_GATE_PROOF"
        if states:
            decision="HISTORICAL_GATE_BLOCK_OBSERVED" if "BLOCK" in states.values() else "HISTORICAL_GATE_PASS_OBSERVED_NOT_LIVE_PARITY"
        signals.append({
            "sourceTime":a["time"],"signalId":a["signalId"],"symbol":a["symbol"],
            "route":a["route"],"researchSourceSha":a["sourceSha"],
            "gateState":{g:states[g] if states else "UNKNOWN" for g in GATES},
            "comparisonStatus":decision,
            "modeledOutcome10bps":{"won":a["modelNetPnlJpy"]>0,"netPnlJpy":a["modelNetPnlJpy"]},
            "modeledOutcome30bps":{"won":b["modelNetPnlJpy"]>0,"netPnlJpy":b["modelNetPnlJpy"]},
        })
    return {
        "schema":"disdex-bt-hype-asof-gate-evidence/v1",
        "status":"HISTORICAL_GATES_UNVERIFIED" if len(proof)<len(ten) else "GATE_OBSERVATIONS_PRESENT_NOT_ECONOMIC_PARITY",
        "historicalSignals":len(signals),"historicalProofCount":len(proof),
        "unverifiedSignals":sum(not x["comparisonStatus"].startswith("HISTORICAL_GATE_") for x in signals),
        "modeledWins10bps":sum(x["modeledOutcome10bps"]["won"] for x in signals),
        "modeledWins30bps":sum(x["modeledOutcome30bps"]["won"] for x in signals),
        "sourceModelOnly":True,"economicParityCertified":False,
        "portfolioResimulationCompleted":False,"liveOrdersChanged":False,
        "signals":signals,
    }

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--entries10",type=Path,required=True)
    p.add_argument("--fills10",type=Path,required=True)
    p.add_argument("--entries30",type=Path,required=True)
    p.add_argument("--fills30",type=Path,required=True)
    p.add_argument("--gate-proof",type=Path)
    p.add_argument("--output",type=Path)
    a=p.parse_args()
    result=audit(load_case(a.entries10,a.fills10),load_case(a.entries30,a.fills30),proof_map(a.gate_proof))
    result["sourceSha256"]={x.name:digest(x) for x in (a.entries10,a.fills10,a.entries30,a.fills30)}
    if a.gate_proof:result["sourceSha256"][a.gate_proof.name]=digest(a.gate_proof)
    payload=json.dumps(result,indent=2,ensure_ascii=False,allow_nan=False)+"\n"
    if a.output:a.output.write_text(payload,encoding="utf8")
    print(payload)
    return 2 if result["status"]=="HISTORICAL_GATES_UNVERIFIED" else 0

if __name__=="__main__":raise SystemExit(main())
