#!/usr/bin/env python3
"""Reconstruct the historically plausible frozen-baseline Idle overlay accounting.

This is research diagnostics only. Baseline accepted trades/quantities/cashflows are
immutable. Idle does not cause baseline re-admission or replacement. Idle 61 net
returns are applied at Gross 1.00x against free account equity at each prequalified
baseline-idle entry timestamp.

Two variants are emitted:
- BASE_WALLET_ONLY: each Idle size uses the original baseline wallet at entry.
- BASE_PLUS_REALIZED_IDLE: each Idle size uses baseline wallet plus previously
  realized Idle PnL. Open Idle unrealized PnL is not used for sizing.

The target_net values already include the 10bps round-trip research cost used by
the canonical candidate evidence.
"""
from __future__ import annotations
import argparse,json,bisect
from pathlib import Path

def jsonl(path):
    return [json.loads(x) for x in Path(path).read_text(encoding="utf-8").splitlines() if x.strip()]

def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))

ap=argparse.ArgumentParser()
ap.add_argument("--baseline-trades",required=True)
ap.add_argument("--baseline-events",required=True)
ap.add_argument("--baseline-metrics",required=True)
ap.add_argument("--idle-intents",required=True)
ap.add_argument("--idle-target-net",required=True)
ap.add_argument("--output",required=True)
a=ap.parse_args()

trades=jsonl(a.baseline_trades)
events=jsonl(a.baseline_events)
metrics=load(a.baseline_metrics)
idle=load(a.idle_intents)
rets=load(a.idle_target_net)
if len(trades)!=1284: raise SystemExit(f"BASELINE_TRADES_MISMATCH:{len(trades)}")
if len(idle)!=61 or len(rets)!=61: raise SystemExit(f"IDLE_ROWS_MISMATCH:{len(idle)}:{len(rets)}")

# attach exact returns in canonical order
for row,r in zip(idle,rets):
    row["target_net"]=float(r)
idle=sorted(idle,key=lambda x:(int(x["entry_ts_ms"]),x["symbol"]))

# Verify prequalified entry timestamps truly have no baseline accepted position open.
entry_idle_violations=[]
for i in idle:
    t=int(i["entry_ts_ms"])
    active=[b for b in trades if int(b["entry_ts_ms"]) <= t < int(b["exit_ts_ms"])]
    if active:
        entry_idle_violations.append({
            "idle":i,
            "active_baseline":[{
                "candidate_id":b.get("candidate_id"),"strategy_id":b.get("strategy_id"),
                "symbol":b.get("symbol"),"entry_ts_ms":b.get("entry_ts_ms"),"exit_ts_ms":b.get("exit_ts_ms")
            } for b in active]
        })
if entry_idle_violations:
    raise SystemExit("CANONICAL_IDLE_NOT_BASELINE_FLAT:"+json.dumps(entry_idle_violations[:5],sort_keys=True))

# Build original baseline wallet timeline from exact event ledger.
wallet_events=[]
for idx,e in enumerate(events):
    if e.get("wallet_after_event") is None: continue
    ts=int(e.get("ts_ms") or e.get("timestamp_ms") or 0)
    if ts<=0: continue
    wallet_events.append((ts,idx,float(e["wallet_after_event"])))
wallet_events.sort(key=lambda x:(x[0],x[1]))
times=[x[0] for x in wallet_events]
if not wallet_events: raise SystemExit("NO_WALLET_EVENTS")

def baseline_wallet_at(ts):
    j=bisect.bisect_right(times,ts)-1
    if j<0: raise RuntimeError(f"NO_BASELINE_WALLET_AT:{ts}")
    # bisect on times only lands on final occurrence of duplicate ts because bisect_right.
    # wallet_events is sorted by (ts, original index), and times mirrors that order.
    while j+1<len(wallet_events) and wallet_events[j+1][0]==ts:
        j+=1
    return wallet_events[j][2]

final_fx=float(metrics["accounting_reconciliation"]["final_fx_jpy_per_usd"])
baseline_final_jpy=float(metrics["final_equity_jpy"])
baseline_final_settlement=float(metrics["accounting_reconciliation"]["wallet_settlement_units"])
if abs(baseline_final_settlement*final_fx-baseline_final_jpy)>0.5:
    raise SystemExit("BASELINE_FINAL_RECONCILIATION_FAIL")

def run(compound_realized):
    realized=0.0
    open_positions=[]
    led=[]
    for row in idle:
        t=int(row["entry_ts_ms"])
        # Realize all prior Idle exits first. Their PnL is fixed at entry-size * target_net.
        still=[]
        for p in open_positions:
            if int(p["exit_ts_ms"])<=t:
                realized += float(p["pnl_settlement"])
                led.append({**p,"event":"IDLE_EXIT_REALIZED"})
            else:
                still.append(p)
        open_positions=still
        bw=baseline_wallet_at(t)
        entry_equity=bw+(realized if compound_realized else 0.0)
        if entry_equity<=0: raise RuntimeError("IDLE_ENTRY_EQUITY_INVALID")
        pnl=entry_equity*float(row["target_net"])
        p={
            "symbol":row["symbol"],"route":row["route"],
            "entry_ts_ms":t,"exit_ts_ms":int(row["exit_ts_ms"]),
            "target_net":float(row["target_net"]),
            "baseline_wallet_at_entry":bw,
            "overlay_realized_before_entry":realized,
            "entry_equity_settlement":entry_equity,
            "requested_gross":1.0,"accepted_gross":1.0,
            "pnl_settlement":pnl,
        }
        open_positions.append(p)
        led.append({**p,"event":"IDLE_ENTRY"})
    for p in sorted(open_positions,key=lambda x:int(x["exit_ts_ms"])):
        realized += float(p["pnl_settlement"])
        led.append({**p,"event":"IDLE_EXIT_REALIZED"})
    final_settlement=baseline_final_settlement+realized
    return {
        "idle_realized_pnl_settlement":realized,
        "idle_realized_pnl_final_fx_jpy":realized*final_fx,
        "final_settlement_units":final_settlement,
        "final_equity_jpy_at_baseline_final_fx":final_settlement*final_fx,
        "delta_vs_baseline_jpy":final_settlement*final_fx-baseline_final_jpy,
        "ledger":led,
    }

base_only=run(False)
compound=run(True)
out={
    "status":"DIAGNOSTIC_NOT_PRODUCTION_CERTIFICATE",
    "baseline_trades":len(trades),
    "idle_trades":len(idle),
    "combined_trade_count_if_no_baseline_removal":len(trades)+len(idle),
    "baseline_final_jpy":baseline_final_jpy,
    "final_fx_jpy_per_usd":final_fx,
    "baseline_idle_entry_violations":len(entry_idle_violations),
    "BASE_WALLET_ONLY":base_only,
    "BASE_PLUS_REALIZED_IDLE":compound,
    "historical_reported_anchors":{
        "final_jpy_approx":268050000.0,
        "reported_total_count":1342,
        "idle_trades":61,
        "pf_approx":2.055,
        "max_dd_approx":-0.2324,
    },
}
Path(a.output).write_text(json.dumps(out,indent=2,sort_keys=True)+"\n",encoding="utf-8")
print(json.dumps({
    "baseline_final_jpy":baseline_final_jpy,
    "baseline_idle_entry_violations":len(entry_idle_violations),
    "combined_trade_count_if_no_baseline_removal":len(trades)+len(idle),
    "base_wallet_only_final_jpy":base_only["final_equity_jpy_at_baseline_final_fx"],
    "compound_realized_idle_final_jpy":compound["final_equity_jpy_at_baseline_final_fx"],
    "base_wallet_only_idle_pnl_jpy":base_only["idle_realized_pnl_final_fx_jpy"],
    "compound_realized_idle_pnl_jpy":compound["idle_realized_pnl_final_fx_jpy"],
},sort_keys=True))
