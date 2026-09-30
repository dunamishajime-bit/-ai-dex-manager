#!/usr/bin/env python3
"""Fixed accepted-trade schedule, realized-equity compounding diagnostic.

No candidate is re-selected. All 1284 canonical baseline accepted trades remain
as immutable intents, plus the canonical 61 Idle intents. Each trade's original
net account-return coefficient is scaled to the realized account wallet at its
entry. This tests whether the historical JPY268.05M overlay re-compounded later
baseline trade sizes after Idle profits without re-running candidate admission.
"""
from __future__ import annotations
import argparse,json,heapq
from pathlib import Path

def jl(p): return [json.loads(x) for x in Path(p).read_text(encoding="utf-8").splitlines() if x.strip()]
def j(p): return json.loads(Path(p).read_text(encoding="utf-8"))

ap=argparse.ArgumentParser()
ap.add_argument("--baseline-trades",required=True)
ap.add_argument("--baseline-events",required=True)
ap.add_argument("--baseline-metrics",required=True)
ap.add_argument("--idle-intents",required=True)
ap.add_argument("--idle-target-net",required=True)
ap.add_argument("--output",required=True)
a=ap.parse_args()

base=jl(a.baseline_trades); events=jl(a.baseline_events); metrics=j(a.baseline_metrics)
idle=j(a.idle_intents); rets=j(a.idle_target_net)
if len(base)!=1284 or len(idle)!=61 or len(rets)!=61: raise SystemExit("ROW_COUNT_MISMATCH")
for x,r in zip(idle,rets): x["target_net"]=float(r)

# Contribution cashflows are exact settlement-unit amounts from the canonical run.
contrib=[]
for e in events:
    if e.get("event_type")=="MONTHLY_CONTRIBUTION":
        ts=int(e["ts_ms"])
        amount=e.get("settlement_cashflow")
        if amount is None:
            before=float(e.get("wallet_after_event") or 0)
            raise SystemExit("CONTRIBUTION_SETTLEMENT_CASHFLOW_MISSING:"+str(ts))
        contrib.append((ts,float(amount)))
if len(contrib)!=13: raise SystemExit(f"CONTRIBUTION_COUNT_MISMATCH:{len(contrib)}")

# Build immutable intent list with original baseline net account-return coefficients.
intents=[]
for idx,t in enumerate(base):
    entry_eq=float(t["entry_equity"])
    pnl=float(t["total_pnl_jpy"])  # field is settlement units in the canonical replay source.
    if entry_eq<=0: raise SystemExit("ENTRY_EQUITY_INVALID")
    intents.append({
      "kind":"BASELINE","id":f"B{idx:04d}","strategy":t["strategy_id"],"symbol":t["symbol"],
      "entry":int(t["entry_ts_ms"]),"exit":int(t["exit_ts_ms"]),
      "account_return":pnl/entry_eq,
      "original_entry_equity":entry_eq,
      "original_pnl_settlement":pnl,
      "candidate_id":t.get("candidate_id"),"position_id":t.get("position_id"),
    })
for idx,t in enumerate(idle):
    intents.append({
      "kind":"IDLE","id":f"I{idx:02d}","strategy":"IDLE_PRIORITY_SHORT","symbol":t["symbol"],
      "entry":int(t["entry_ts_ms"]),"exit":int(t["exit_ts_ms"]),
      "account_return":float(t["target_net"]),
      "route":t["route"],
    })

# Event ordering: contributions then exits then entries at same timestamp.
by_entry={}
for x in intents: by_entry.setdefault(x["entry"],[]).append(x)
by_contrib={}
for ts,amt in contrib: by_contrib.setdefault(ts,0.0); by_contrib[ts]+=amt
entry_times=sorted(by_entry); contrib_times=sorted(by_contrib)
ei=ci=0; wallet=0.0; seq=0; exits=[]; ledger=[]; completed=[]
while True:
    ne=entry_times[ei] if ei<len(entry_times) else 10**30
    nc=contrib_times[ci] if ci<len(contrib_times) else 10**30
    nx=exits[0][0] if exits else 10**30
    ts=min(ne,nc,nx)
    if ts>=10**30: break
    if nc==ts:
        wallet+=by_contrib[ts]
        ledger.append({"event":"CONTRIBUTION","ts":ts,"amount":by_contrib[ts],"wallet":wallet})
        ci+=1
    while exits and exits[0][0]==ts:
        _,_,pos=heapq.heappop(exits)
        wallet+=pos["pnl"]
        completed.append(pos)
        ledger.append({"event":"EXIT","ts":ts,"id":pos["id"],"kind":pos["kind"],"strategy":pos["strategy"],"symbol":pos["symbol"],"pnl":pos["pnl"],"wallet":wallet})
    if ne==ts:
        # All same-timestamp intents size from the same realized wallet snapshot.
        entry_wallet=wallet
        rows=sorted(by_entry[ts],key=lambda x:(0 if x["kind"]=="BASELINE" else 1,x["strategy"],x["symbol"],x["id"]))
        for x in rows:
            pnl=entry_wallet*float(x["account_return"])
            pos={**x,"entry_wallet":entry_wallet,"pnl":pnl}
            seq+=1; heapq.heappush(exits,(x["exit"],seq,pos))
            ledger.append({"event":"ENTRY","ts":ts,"id":x["id"],"kind":x["kind"],"strategy":x["strategy"],"symbol":x["symbol"],"entry_wallet":entry_wallet,"account_return":x["account_return"],"scheduled_pnl":pnl})
        ei+=1

if len(completed)!=1345: raise SystemExit(f"COMPLETED_COUNT_MISMATCH:{len(completed)}")
final_fx=float(metrics["accounting_reconciliation"]["final_fx_jpy_per_usd"])
final_jpy=wallet*final_fx
base_completed=[x for x in completed if x["kind"]=="BASELINE"]
idle_completed=[x for x in completed if x["kind"]=="IDLE"]
out={
 "status":"DIAGNOSTIC_NOT_PRODUCTION_CERTIFICATE",
 "model":"FIXED_ACCEPTED_SCHEDULE_REALIZED_WALLET_COMPOUNDING",
 "baseline_trades":len(base_completed),"idle_trades":len(idle_completed),"combined_trades":len(completed),
 "final_wallet_settlement":wallet,"final_fx_jpy_per_usd":final_fx,"final_equity_jpy":final_jpy,
 "baseline_anchor_jpy":float(metrics["final_equity_jpy"]),
 "reported_idle_anchor_jpy_approx":268050000.0,
 "idle_pnl_settlement":sum(x["pnl"] for x in idle_completed),
 "baseline_pnl_settlement":sum(x["pnl"] for x in base_completed),
 "ledger":ledger,
}
Path(a.output).write_text(json.dumps(out,indent=2,sort_keys=True)+"\n",encoding="utf-8")
print(json.dumps({k:out[k] for k in ["model","baseline_trades","idle_trades","combined_trades","final_equity_jpy","baseline_anchor_jpy","reported_idle_anchor_jpy_approx","idle_pnl_settlement","baseline_pnl_settlement"]},sort_keys=True))
