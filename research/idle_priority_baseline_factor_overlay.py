#!/usr/bin/env python3
"""Exogenous baseline-equity-factor Idle overlay diagnostic.

Reconstructs the canonical baseline H1 settlement-equity curve exactly from the
1284 accepted trades + event ledger. It then preserves the baseline H1 return
factor sequence and injects the canonical 61 Idle trade returns at their exits.
No baseline candidate is re-selected and no historical outcome is used for
admission. Research diagnostic only.
"""
from __future__ import annotations
import argparse,json,bisect
from pathlib import Path
from collections import defaultdict
from datetime import datetime,timezone

HOUR=3_600_000
START=int(datetime(2025,8,10,tzinfo=timezone.utc).timestamp()*1000)
END=int(datetime(2026,8,11,tzinfo=timezone.utc).timestamp()*1000)

def jl(p):return [json.loads(x) for x in Path(p).read_text(encoding="utf-8").splitlines() if x.strip()]
def j(p):return json.loads(Path(p).read_text(encoding="utf-8"))
def rows(p):return jl(p)

ap=argparse.ArgumentParser()
ap.add_argument("--baseline-trades",required=True)
ap.add_argument("--baseline-events",required=True)
ap.add_argument("--baseline-metrics",required=True)
ap.add_argument("--idle-intents",required=True)
ap.add_argument("--idle-target-net",required=True)
ap.add_argument("--data-root",required=True)
ap.add_argument("--output",required=True)
a=ap.parse_args()

trades=jl(a.baseline_trades);events=jl(a.baseline_events);metrics=j(a.baseline_metrics)
idle=j(a.idle_intents);rets=j(a.idle_target_net)
if len(trades)!=1284 or len(idle)!=61 or len(rets)!=61:raise SystemExit("COUNT_MISMATCH")
for x,r in zip(idle,rets):x["target_net"]=float(r)
idle=sorted(idle,key=lambda x:(int(x["entry_ts_ms"]),x["symbol"]))

symbols={str(t["symbol"]) for t in trades}
market={}
root=Path(a.data_root)
for sym in sorted(symbols):
    c=root/"normalized/aster/klines"/f"{sym}.jsonl"
    s=root/"normalized/aster_stock/klines"/f"{sym}.jsonl"
    p=c if c.is_file() else s
    if not p.is_file():raise SystemExit(f"MARKET_MISSING:{sym}")
    rr=rows(p);rr.sort(key=lambda x:int(x["event_time_ms"]))
    market[sym]={"rows":rr,"times":[int(x["event_time_ms"]) for x in rr]}

def mark(sym,ts):
    q=market[sym];i=bisect.bisect_right(q["times"],ts)-1
    if i<0:return None
    r=q["rows"][i];start=int(r["event_time_ms"])
    if start==ts:return float(r["open"])
    if ts>=start+HOUR:return float(r["close"]) if ts==start+HOUR else None
    if i<1:return None
    prev=q["rows"][i-1]
    if int(prev["event_time_ms"])+HOUR!=start:return None
    return float(prev["close"])
def sign(side):return 1.0 if side=="LONG" else -1.0

# Exact timestamp cashflows from canonical event ledger.
cashflow=defaultdict(float);contrib=defaultdict(float)
for e in events:
    et=e.get("event_type");ts=int(e.get("ts_ms") or 0)
    if not ts:continue
    if et=="MONTHLY_CONTRIBUTION":
        v=float(e["settlement_cashflow"]);cashflow[ts]+=v;contrib[ts]+=v
    elif et=="MODELED_ENTRY":
        cashflow[ts]-=float(e["fee_settlement"])
    elif et=="FUNDING":
        cashflow[ts]+=float(e["cashflow_settlement"])
    elif et=="MODELED_PARTIAL_EXIT":
        cashflow[ts]+=float(e["net_cashflow_settlement"])
    elif et=="MODELED_EXIT":
        cashflow[ts]+=float(e["net_cashflow_settlement"])

by_entry=defaultdict(list);by_exit=defaultdict(list)
for t in trades:
    by_entry[int(t["entry_ts_ms"])].append(t);by_exit[int(t["exit_ts_ms"])].append(t)
event_times=sorted(set(cashflow)|set(by_entry)|set(by_exit));ei=0
cash=0.0;active={};curve=[]
for ts in range(START,END+1,HOUR):
    while ei<len(event_times) and event_times[ei]<=ts:
        et=event_times[ei]
        cash+=cashflow.get(et,0.0)
        for t in by_exit.get(et,[]):active.pop(int(t["position_id"]),None)
        for t in by_entry.get(et,[]):
            if int(t["exit_ts_ms"])>et:active[int(t["position_id"])]=t
        ei+=1
    unreal=0.0
    for t in active.values():
        m=mark(t["symbol"],ts)
        if m is None:raise SystemExit(f"MARK_MISSING:{t['symbol']}:{ts}")
        qty=float(t["original_quantity"])
        pa=t.get("partial_actual")
        if pa and ts>=int(pa["ts"]):qty*=1-float(pa["fraction"])
        unreal+=sign(t["side"])*qty*(m-float(t["entry_price"]))
    curve.append((ts,cash+unreal))

final_settle=float(metrics["accounting_reconciliation"]["wallet_settlement_units"])
curve_final=curve[-1][1]
if abs(curve_final-final_settle)>max(1e-6,abs(final_settle)*1e-9):
    raise SystemExit(f"BASELINE_CURVE_RECONCILIATION_FAIL:{curve_final}:{final_settle}")
final_fx=float(metrics["accounting_reconciliation"]["final_fx_jpy_per_usd"])

entries=defaultdict(list);exits=defaultdict(list)
for idx,x in enumerate(idle):
    xx={**x,"idx":idx}
    entries[int(x["entry_ts_ms"])].append(xx);exits[int(x["exit_ts_ms"])].append(xx)

# Apply each baseline H1 factor to integrated equity, then Idle exits, then entries.
E=curve[0][1]
Bprev=curve[0][1]
open_idle={};idle_ledger=[];idle_pnl=0.0
monthly={}
for ts,B in curve[1:]:
    c=contrib.get(ts,0.0)
    denom=Bprev+c
    if denom<=0:raise SystemExit(f"BASE_FACTOR_DENOM:{ts}")
    factor=B/denom
    E=(E+c)*factor
    # Scheduled Idle exits before new entries.
    for x in exits.get(ts,[]):
        p=open_idle.pop(x["idx"],None)
        if p is None:raise SystemExit(f"IDLE_EXIT_WITHOUT_ENTRY:{x['idx']}:{ts}")
        pnl=float(p["entry_equity"])*float(x["target_net"])
        E+=pnl;idle_pnl+=pnl
        idle_ledger.append({"event":"EXIT","ts":ts,"symbol":x["symbol"],"entry_equity":p["entry_equity"],"target_net":x["target_net"],"pnl_settlement":pnl,"equity_after":E})
    for x in entries.get(ts,[]):
        open_idle[x["idx"]]={"entry_equity":E}
        idle_ledger.append({"event":"ENTRY","ts":ts,"symbol":x["symbol"],"entry_equity":E,"target_net":x["target_net"]})
    monthly[datetime.fromtimestamp(ts/1000,timezone.utc).strftime("%Y-%m")]=E*final_fx
    Bprev=B
if open_idle:raise SystemExit("IDLE_OPEN_AT_END")

out={
 "status":"DIAGNOSTIC_NOT_PRODUCTION_CERTIFICATE",
 "model":"CANONICAL_BASELINE_H1_RETURN_FACTOR_PLUS_IDLE_REALIZED_RETURNS",
 "baseline_curve_points":len(curve),
 "baseline_curve_final_settlement":curve_final,
 "baseline_anchor_settlement":final_settle,
 "baseline_anchor_jpy":float(metrics["final_equity_jpy"]),
 "idle_trades":len(idle),
 "combined_count_no_baseline_removal":1284+len(idle),
 "idle_pnl_settlement":idle_pnl,
 "idle_pnl_final_fx_jpy":idle_pnl*final_fx,
 "final_settlement":E,
 "final_equity_jpy":E*final_fx,
 "reported_anchor_jpy_approx":268050000.0,
 "delta_to_reported_anchor_jpy":E*final_fx-268050000.0,
 "monthly_equity_jpy_at_final_fx":monthly,
 "idle_ledger":idle_ledger,
}
Path(a.output).write_text(json.dumps(out,indent=2,sort_keys=True)+"\n",encoding="utf-8")
print(json.dumps({k:out[k] for k in ["model","baseline_curve_points","baseline_curve_final_settlement","baseline_anchor_settlement","baseline_anchor_jpy","idle_trades","combined_count_no_baseline_removal","idle_pnl_final_fx_jpy","final_equity_jpy","reported_anchor_jpy_approx","delta_to_reported_anchor_jpy"]},sort_keys=True))
