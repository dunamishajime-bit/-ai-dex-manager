#!/usr/bin/env python3
"""Diagnose historical Idle overlay admission semantics without retuning outcomes.

Inputs:
- canonical 1284-row baseline portfolio-trades.jsonl
- canonical 63-row idle_candidate_filtered.csv

This does NOT certify production. It tests a specific historically plausible
overlay accounting model: freeze the baseline accepted-trade intent schedule,
derive 61 Idle intents causally by same-symbol occupancy, and reserve Gross by
the accepted_gross contract values of currently retained positions rather than
recomputing MTM Gross from a newly diverged integrated equity path.

It also emits a no-cap control. No rejected baseline candidate is promoted.
"""
from __future__ import annotations
import argparse, csv, json
from pathlib import Path
from collections import Counter

CRYPTO_CAP=3.0
TOTAL_CAP=4.25
IDLE_GROSS=1.0
BASELINE_STRATEGIES={"V12","PENGU","Q102","FET","V52"}

def load_jsonl(path:Path):
    out=[]
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip(): out.append(json.loads(line))
    return out

def load_idle(path:Path):
    with path.open(newline="",encoding="utf-8") as f:
        rows=list(csv.DictReader(f))
    if len(rows)!=63:
        raise SystemExit(f"IDLE_FILTERED_ROWS_MISMATCH:{len(rows)}")
    rows.sort(key=lambda r:(int(r["t"]),r["symbol"]))
    active={}
    admitted=[]; rejected=[]
    for r in rows:
        t=int(r["t"]); hold=int(r["hold_h"])
        for sym in list(active):
            if active[sym]["exit"]<=t: del active[sym]
        if r["symbol"] in active:
            rejected.append({
                "symbol":r["symbol"],"t":t,"reason":"IDLE_SAME_SYMBOL_ACTIVE",
                "blocking_entry_t":active[r["symbol"]]["entry"],
                "blocking_exit_t":active[r["symbol"]]["exit"],
            })
            continue
        rr=dict(r); rr["entry_ts_ms"]=t; rr["exit_ts_ms"]=t+hold*3600_000
        admitted.append(rr)
        active[r["symbol"]]={"entry":t,"exit":rr["exit_ts_ms"]}
    if len(admitted)!=61 or len(rejected)!=2:
        raise SystemExit(f"IDLE_63_61_PARITY_FAIL:{len(admitted)}:{len(rejected)}")
    return admitted,rejected

def gross_of(trade):
    for k in ("accepted_gross","candidate_requested_gross","requested_gross"):
        v=trade.get(k)
        if v is not None:
            try:
                x=float(v)
                if x>0:return x
            except Exception: pass
    raise ValueError("BASELINE_GROSS_MISSING:"+json.dumps({
        "position_id":trade.get("position_id"),"candidate_id":trade.get("candidate_id"),
        "strategy_id":trade.get("strategy_id"),"symbol":trade.get("symbol")
    },sort_keys=True))

def ident(trade):
    return {
        "candidate_id":trade.get("candidate_id"),
        "position_id":trade.get("position_id"),
        "strategy_id":trade.get("strategy_id"),
        "symbol":trade.get("symbol"),
        "entry_ts_ms":int(trade["entry_ts_ms"]),
        "exit_ts_ms":int(trade["exit_ts_ms"]),
        "accepted_gross":gross_of(trade),
    }

def reservation_replay(baseline,idle):
    baseline=sorted(baseline,key=lambda x:(int(x["entry_ts_ms"]),str(x.get("strategy_id")),str(x.get("symbol"))))
    idle=sorted(idle,key=lambda x:(int(x["entry_ts_ms"]),x["symbol"]))
    events=[]
    for i,t in enumerate(baseline):
        if t.get("strategy_id") not in BASELINE_STRATEGIES:
            raise ValueError("UNEXPECTED_BASELINE_STRATEGY:"+str(t.get("strategy_id")))
        events.append((int(t["entry_ts_ms"]),2,"BASE_ENTRY",i,t))
        events.append((int(t["exit_ts_ms"]),0,"BASE_EXIT",i,t))
    for i,t in enumerate(idle):
        events.append((int(t["entry_ts_ms"]),3,"IDLE_ENTRY",i,t))
        events.append((int(t["exit_ts_ms"]),1,"IDLE_EXIT",i,t))
    # At same ts: baseline exits, Idle exits, baseline entries, Idle entries.
    events.sort(key=lambda e:(e[0],e[1],e[2],e[3]))

    active_base={}; active_idle={}
    retained=[]; rejected_base=[]; accepted_idle=[]; rejected_idle=[]
    for ts,_,kind,i,row in events:
        if kind=="BASE_EXIT":
            active_base.pop(i,None); continue
        if kind=="IDLE_EXIT":
            active_idle.pop(i,None); continue

        crypto=sum(gross_of(t) for t in active_base.values() if t["strategy_id"]!="V52") + len(active_idle)*IDLE_GROSS
        total=sum(gross_of(t) for t in active_base.values()) + len(active_idle)*IDLE_GROSS

        if kind=="BASE_ENTRY":
            g=gross_of(row); strat=row["strategy_id"]
            crypto_after=crypto+(0 if strat=="V52" else g)
            total_after=total+g
            ok=(crypto_after<=CRYPTO_CAP+1e-12 and total_after<=TOTAL_CAP+1e-12)
            audit={**ident(row),"crypto_gross_before":crypto,"total_gross_before":total,
                   "crypto_gross_after":crypto_after,"total_gross_after":total_after}
            if ok:
                active_base[i]=row; retained.append(audit)
            else:
                audit["reason"]="RESERVATION_GROSS_CAP"
                rejected_base.append(audit)
            continue

        # The canonical 63 rows were prequalified from baseline-only idle windows.
        # Still enforce actual overlay capacity among already-open Idle sleeves and
        # any retained later baseline positions; never partial-size.
        crypto_after=crypto+IDLE_GROSS; total_after=total+IDLE_GROSS
        audit={"symbol":row["symbol"],"entry_ts_ms":int(row["entry_ts_ms"]),
               "exit_ts_ms":int(row["exit_ts_ms"]),"route":row["route"],
               "crypto_gross_before":crypto,"total_gross_before":total,
               "crypto_gross_after":crypto_after,"total_gross_after":total_after}
        if crypto_after<=CRYPTO_CAP+1e-12 and total_after<=TOTAL_CAP+1e-12:
            active_idle[i]=row; accepted_idle.append(audit)
        else:
            audit["reason"]="IDLE_RESERVATION_GROSS_CAP"
            rejected_idle.append(audit)

    return retained,rejected_base,accepted_idle,rejected_idle

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--baseline-trades",type=Path,required=True)
    ap.add_argument("--idle-filtered",type=Path,required=True)
    ap.add_argument("--output",type=Path,required=True)
    a=ap.parse_args()
    base=load_jsonl(a.baseline_trades)
    if len(base)!=1284:
        raise SystemExit(f"BASELINE_ROWS_MISMATCH:{len(base)}")
    idle,idle_same=load_idle(a.idle_filtered)
    retained,rejected,accepted_idle,rejected_idle=reservation_replay(base,idle)
    out={
        "status":"DIAGNOSTIC_NOT_PRODUCTION_CERTIFICATE",
        "model":"FROZEN_BASELINE_ACCEPTED_INTENTS_PLUS_ACCEPTED_GROSS_RESERVATIONS",
        "baseline_input":len(base),
        "idle_filtered_input":63,
        "idle_after_same_symbol":len(idle),
        "idle_same_symbol_rejections":idle_same,
        "baseline_retained":len(retained),
        "baseline_rejected":len(rejected),
        "idle_retained_under_reservation_caps":len(accepted_idle),
        "idle_rejected_under_reservation_caps":len(rejected_idle),
        "integrated_trade_count":len(retained)+len(accepted_idle),
        "baseline_rejections":rejected,
        "idle_capacity_rejections":rejected_idle,
        "baseline_rejections_by_strategy":dict(Counter(r["strategy_id"] for r in rejected)),
        "anchors_only_not_tuning_targets":{
            "reported_integrated_trades":1342,
            "reported_final_jpy_approx":268_050_000,
            "reported_pf_approx":2.055,
            "reported_max_dd_approx":-0.2324,
        },
        "control_no_cap_trade_count":len(base)+len(idle),
    }
    a.output.parent.mkdir(parents=True,exist_ok=True)
    a.output.write_text(json.dumps(out,indent=2,sort_keys=True)+"\n",encoding="utf-8")
    print(json.dumps({k:out[k] for k in (
        "baseline_input","idle_after_same_symbol","baseline_retained","baseline_rejected",
        "idle_retained_under_reservation_caps","idle_rejected_under_reservation_caps",
        "integrated_trade_count","control_no_cap_trade_count")},sort_keys=True))
    print("BASELINE_REJECTIONS",json.dumps(rejected,sort_keys=True))
    print("IDLE_CAPACITY_REJECTIONS",json.dumps(rejected_idle,sort_keys=True))

if __name__=="__main__":main()
