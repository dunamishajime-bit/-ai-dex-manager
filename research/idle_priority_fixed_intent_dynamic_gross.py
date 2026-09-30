#!/usr/bin/env python3
"""Fixed accepted-intent schedule with dynamic MTM Gross replay.

Research-only parity diagnostic. It never promotes a baseline candidate that was
rejected in the canonical baseline. The input is the canonical 1284 accepted
trade ledger. Each accepted intent is re-sized against current equity while
normal shared Gross caps are enforced. Original per-position event cashflows are
scaled linearly by the new/original quantity ratio, preserving fee/funding/
partial/exit timing. Idle intents are full 1.00x and non-preemptible.
"""
from __future__ import annotations
import argparse, json, heapq, math, sys
from pathlib import Path
from collections import Counter

CRYPTO_CAP=3.0
STOCK_CAP=4.0
TOTAL_CAP=4.25
STRATEGY_CAP={"V12":2.0,"PENGU":1.0,"Q102":3.0,"FET":2.25,"V52":4.0}
FET_MIN=0.05
COST_SIDE=0.0005
PRIORITY={"V52":0,"PENGU":1,"V12":2,"Q102":3,"FET":4}

def jl(p): return [json.loads(x) for x in Path(p).read_text(encoding="utf-8").splitlines() if x.strip()]
def j(p): return json.loads(Path(p).read_text(encoding="utf-8"))

ap=argparse.ArgumentParser()
ap.add_argument("--baseline-trades",required=True)
ap.add_argument("--baseline-events",required=True)
ap.add_argument("--baseline-metrics",required=True)
ap.add_argument("--idle-intents",required=True)
ap.add_argument("--idle-target-net",required=True)
ap.add_argument("--data-root",required=True)
ap.add_argument("--request-mode",choices=["accepted","candidate"],default="accepted")
ap.add_argument("--without-idle",action="store_true")
ap.add_argument("--idle-fee-path",choices=["split","net_exit"],default="split")
ap.add_argument("--roundtrip-bps",type=float,choices=[8.0,10.0],default=10.0)
ap.add_argument("--output",required=True)
a=ap.parse_args()
COST_SIDE=float(a.roundtrip_bps)/20000.0

def _rows(path):
    out=[]
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        if line.strip(): out.append(json.loads(line))
    return out

def _market(data_root,symbols):
    output={}
    root=Path(data_root)
    for symbol in sorted(symbols):
        crypto=root/"normalized/aster/klines"/f"{symbol}.jsonl"
        stock=root/"normalized/aster_stock/klines"/f"{symbol}.jsonl"
        source=crypto if crypto.is_file() else stock
        if not source.is_file():
            raise RuntimeError(f"MARKET_FILE_MISSING:{symbol}:{crypto}:{stock}")
        rows=_rows(source)
        rows.sort(key=lambda r:int(r["event_time_ms"]))
        output[symbol]={"rows":rows,"times":[int(r["event_time_ms"]) for r in rows]}
    return output

def _mark(market,symbol,ts):
    import bisect
    series=market[symbol]
    idx=bisect.bisect_right(series["times"],int(ts))-1
    if idx<0:return None
    row=series["rows"][idx]
    start=int(row["event_time_ms"])
    HOUR=3600_000
    if start==ts:return float(row["open"])
    if ts>=start+HOUR:
        return float(row["close"]) if ts==start+HOUR else None
    if idx<1:return None
    prev=series["rows"][idx-1]
    if int(prev["event_time_ms"])+HOUR!=start:return None
    return float(prev["close"])

def _side_sign(side):
    return 1.0 if side=="LONG" else -1.0

base=jl(a.baseline_trades)
events=jl(a.baseline_events)
metrics=j(a.baseline_metrics)
idle=j(a.idle_intents)
rets=j(a.idle_target_net)
if len(base)!=1284: raise SystemExit(f"BASELINE_ROWS_MISMATCH:{len(base)}")
if len(idle)!=61 or len(rets)!=61: raise SystemExit("IDLE_ROWS_MISMATCH")
for x,r in zip(idle,rets):
    x["target_net_10bps"]=float(r)
    # Canonical CSV target_net is a 10bps round-trip research return.
    # Keep the same gross price path and adjust only the round-trip cost.
    x["target_net"]=float(r)+(10.0-float(a.roundtrip_bps))/10000.0
if a.without_idle: idle=[]

by_pid={}
for t in base:
    by_pid[int(t["position_id"])]=t

ev_by_pid={}
contrib=[]
for order,e in enumerate(events):
    et=e.get("event_type")
    if et=="MONTHLY_CONTRIBUTION":
        contrib.append((int(e["ts_ms"]),order,float(e["settlement_cashflow"])))
    if e.get("position_id") is not None:
        ev_by_pid.setdefault(int(e["position_id"]),[]).append((order,e))
if len(contrib)!=13: raise SystemExit(f"CONTRIBUTIONS:{len(contrib)}")

# Market coverage for all baseline and Idle symbols.
symbols={str(x["symbol"]) for x in base}|{str(x["symbol"]) for x in idle}
market=_market(Path(a.data_root),symbols)

# Exact original entry fee/event map and post-entry position event templates.
entry_event={}
position_templates={}
for pid,rows in ev_by_pid.items():
    ent=[e for _,e in rows if e.get("event_type")=="MODELED_ENTRY"]
    if len(ent)!=1: raise SystemExit(f"ENTRY_EVENT_COUNT:{pid}:{len(ent)}")
    entry_event[pid]=ent[0]
    position_templates[pid]=[(order,e) for order,e in rows if e.get("event_type")!="MODELED_ENTRY"]

def request_gross(t):
    if a.request_mode=="candidate":
        v=t.get("candidate_requested_gross")
        if v is not None and float(v)>0: return float(v)
    return float(t["accepted_gross"])

def active_equity(wallet,active,ts):
    eq=wallet
    for p in active.values():
        mark=_mark(market,p["symbol"],ts)
        if mark is None: raise RuntimeError(f"MARK_MISSING:{p['symbol']}:{ts}")
        eq += _side_sign(p["side"])*float(p["quantity"])*(mark-float(p["entry_price"]))
    return eq

def pgross(p,ts,eq):
    mark=_mark(market,p["symbol"],ts)
    if mark is None or eq<=0: return math.inf
    return abs(float(p["quantity"])*mark)/eq

# Event heap: (ts, phase, seq, kind, payload)
# phase 0 contribution, 1 scheduled cashflow, 2 baseline entry, 3 Idle entry.
heap=[]; seq=0
def push(ts,phase,kind,payload):
    global seq
    seq+=1; heapq.heappush(heap,(int(ts),phase,seq,kind,payload))

for ts,order,amt in contrib:
    push(ts,0,"CONTRIB",{"amount":amt,"order":order})
for t in sorted(base,key=lambda x:(int(x["entry_ts_ms"]),PRIORITY[x["strategy_id"]],int(x.get("rank") or 0),x["symbol"],int(x["position_id"]))):
    push(int(t["entry_ts_ms"]),2,"BASE_ENTRY",t)
for x in idle:
    push(int(x["entry_ts_ms"]),3,"IDLE_ENTRY",x)

# Hourly marks are research-only and do not affect admission ordering.
# They let this diagnostic report MTM drawdown on the same H1 cadence.
all_starts=[ts for ts,_,_ in contrib]+[int(t["entry_ts_ms"]) for t in base]+[int(x["entry_ts_ms"]) for x in idle]
all_ends=[int(t["exit_ts_ms"]) for t in base]+[int(x["exit_ts_ms"]) for x in idle]
mark_start=min(all_starts)
mark_end=max(all_ends)
HOUR=3600_000
mark_start=(mark_start//HOUR)*HOUR
mark_end=((mark_end+HOUR-1)//HOUR)*HOUR
for mts in range(mark_start,mark_end+1,HOUR):
    push(mts,9,"MARK",{})

wallet=0.0
active={}
equity_marks=[]
next_idle_pid=-1
completed=[]
rejected=[]
accepted=[]
baseline_scale_errors=[]
idle_return_price_check=[]
# Track original-baseline replay expected quantity for baseline-only validation.
while heap:
    ts,phase,_,kind,payload=heapq.heappop(heap)
    if kind=="MARK":
        eqmark=active_equity(wallet,active,ts)
        equity_marks.append((ts,eqmark))
        continue
    if kind=="CONTRIB":
        wallet+=float(payload["amount"])
        continue
    if kind=="SCHEDULED_BASE":
        pid=payload["pid"]
        p=active.get(pid)
        if not p: continue
        e=payload["event"]; scale=float(p["scale"]); et=e["event_type"]
        if et=="FUNDING":
            cash=float(e["cashflow_settlement"])*scale
            wallet+=cash
            p["funding_pnl"]=float(p.get("funding_pnl") or 0.0)+cash
        elif et=="MODELED_PARTIAL_EXIT":
            cash=float(e["net_cashflow_settlement"])*scale
            wallet+=cash
            close_qty=float(e["quantity"])*scale
            p["price_pnl"]=float(p.get("price_pnl") or 0.0)+float(e.get("price_pnl_settlement") or 0.0)*scale
            p["exit_fee"]=float(p.get("exit_fee") or 0.0)+float(e.get("fee_settlement") or 0.0)*scale
            p["quantity"]=max(0.0,float(p["quantity"])-close_qty)
        elif et=="MODELED_EXIT":
            wallet+=float(e["net_cashflow_settlement"])*scale
            original=by_pid[pid]
            completed.append({
                "kind":"BASELINE","strategy":p["strategy_id"],"symbol":p["symbol"],
                "position_id":pid,"candidate_id":original.get("candidate_id"),
                "entry_ts_ms":p["entry_ts_ms"],"exit_ts_ms":ts,
                "accepted_gross":p["accepted_gross"],
                "scale":scale,
                "trade_pnl_settlement":float(original["total_pnl_jpy"])*scale,
            })
            active.pop(pid,None)
        continue
    if kind=="IDLE_EXIT":
        pid=payload["pid"]; p=active.get(pid)
        if not p: continue
        # target_net is exact canonical net return after 10bps research cost.
        total=float(p["entry_equity"])*float(p["target_net"])
        # Entry fee was paid at entry, so exit wallet cashflow restores that fee
        # plus exact total net PnL.
        wallet += total + float(p["entry_fee"])
        completed.append({
            "kind":"IDLE","strategy":"IDLE_PRIORITY_SHORT","symbol":p["symbol"],
            "position_id":pid,"entry_ts_ms":p["entry_ts_ms"],"exit_ts_ms":ts,
            "accepted_gross":1.0,"trade_pnl_settlement":total,
        })
        active.pop(pid,None)
        continue

    # New entry.
    eq=active_equity(wallet,active,ts)
    if eq<=0: raise SystemExit(f"EQUITY_INVALID:{ts}")
    total_g=sum(pgross(p,ts,eq) for p in active.values())
    crypto_g=sum(pgross(p,ts,eq) for p in active.values() if p["strategy_id"]!="V52")
    stock_g=sum(pgross(p,ts,eq) for p in active.values() if p["strategy_id"]=="V52")

    if kind=="IDLE_ENTRY":
        req=1.0
        room=min(CRYPTO_CAP-crypto_g,TOTAL_CAP-total_g)
        if room+1e-9<1.0:
            rejected.append({"kind":"IDLE","symbol":payload["symbol"],"ts":ts,"reason":"NO_FULL_GROSS","room":room,"crypto_gross":crypto_g,"total_gross":total_g})
            continue
        entry_price=_mark(market,payload["symbol"],ts)
        exit_price=_mark(market,payload["symbol"],int(payload["exit_ts_ms"]))
        if entry_price is None or exit_price is None: raise SystemExit(f"IDLE_PRICE_MISSING:{payload['symbol']}:{ts}")
        # Verify the canonical target return is compatible with open-to-open short price path.
        raw=(entry_price-exit_price)/entry_price
        approx_net=raw-COST_SIDE-(exit_price/entry_price)*COST_SIDE
        idle_return_price_check.append(abs(approx_net-float(payload["target_net"])))
        qty=eq/entry_price
        fee=eq*COST_SIDE if a.idle_fee_path=="split" else 0.0
        wallet-=fee
        pid=next_idle_pid; next_idle_pid-=1
        active[pid]={
            "strategy_id":"IDLE_PRIORITY_SHORT","symbol":payload["symbol"],"side":"SHORT",
            "entry_ts_ms":ts,"entry_price":entry_price,"quantity":qty,
            "accepted_gross":1.0,"entry_equity":eq,"entry_fee":fee,
            "target_net":float(payload["target_net"]),
        }
        accepted.append({"kind":"IDLE","symbol":payload["symbol"],"ts":ts,"accepted_gross":1.0,"equity":eq,"crypto_before":crypto_g,"total_before":total_g})
        push(int(payload["exit_ts_ms"]),1,"IDLE_EXIT",{"pid":pid})
        continue

    t=payload; strat=t["strategy_id"]; pid=int(t["position_id"])
    req=request_gross(t)
    strat_g=sum(pgross(p,ts,eq) for p in active.values() if p["strategy_id"]==strat)
    strat_room=max(0.0,STRATEGY_CAP[strat]-strat_g)
    sleeve_room=max(0.0,(STOCK_CAP-stock_g) if strat=="V52" else (CRYPTO_CAP-crypto_g))
    total_room=max(0.0,TOTAL_CAP-total_g)
    room=min(strat_room,sleeve_room,total_room)

    # Canonical allocator contract: FET is residual and preemptible by core
    # crypto before a PENGU/V12/Q102 accepted intent is rejected or shrunk.
    if strat in {"PENGU","V12","Q102"} and room+1e-12<req:
        fet_rows=[(fp,pp) for fp,pp in active.items() if pp["strategy_id"]=="FET"]
        if fet_rows:
            fpid,fpos=fet_rows[0]
            fmark=_mark(market,fpos["symbol"],ts)
            if fmark is not None:
                fqty=float(fpos["quantity"])
                fprice_pnl=_side_sign(fpos["side"])*fqty*(fmark-float(fpos["entry_price"]))
                fexit_fee=abs(fqty*fmark)*COST_SIDE
                wallet+=fprice_pnl-fexit_fee
                ftotal=(
                    float(fpos.get("price_pnl") or 0.0)+fprice_pnl+
                    float(fpos.get("funding_pnl") or 0.0)-
                    float(fpos.get("entry_fee") or 0.0)-
                    float(fpos.get("exit_fee") or 0.0)-fexit_fee
                )
                completed.append({
                    "kind":"BASELINE","strategy":"FET","symbol":fpos["symbol"],
                    "position_id":fpid,"candidate_id":fpos.get("candidate_id"),
                    "entry_ts_ms":fpos["entry_ts_ms"],"exit_ts_ms":ts,
                    "accepted_gross":fpos["accepted_gross"],"scale":fpos["scale"],
                    "trade_pnl_settlement":ftotal,"exit_reason":"CORE_PREEMPT:"+strat,
                })
                active.pop(fpid,None)
                eq=active_equity(wallet,active,ts)
                strat_g=sum(pgross(p,ts,eq) for p in active.values() if p["strategy_id"]==strat)
                total_g=sum(pgross(p,ts,eq) for p in active.values())
                crypto_g=sum(pgross(p,ts,eq) for p in active.values() if p["strategy_id"]!="V52")
                stock_g=sum(pgross(p,ts,eq) for p in active.values() if p["strategy_id"]=="V52")
                strat_room=max(0.0,STRATEGY_CAP[strat]-strat_g)
                sleeve_room=max(0.0,(STOCK_CAP-stock_g) if strat=="V52" else (CRYPTO_CAP-crypto_g))
                total_room=max(0.0,TOTAL_CAP-total_g)
                room=min(strat_room,sleeve_room,total_room)

    ag=min(req,room)
    if strat=="PENGU" and ag+1e-9<req:
        rejected.append({"kind":"BASELINE","strategy":strat,"symbol":t["symbol"],"ts":ts,"position_id":pid,"candidate_id":t.get("candidate_id"),"reason":"PENGU_NO_LOT_SHRINK","requested":req,"room":room,"crypto_gross":crypto_g,"total_gross":total_g})
        continue
    if strat=="FET" and ag+1e-9<FET_MIN:
        rejected.append({"kind":"BASELINE","strategy":strat,"symbol":t["symbol"],"ts":ts,"position_id":pid,"candidate_id":t.get("candidate_id"),"reason":"FET_RESIDUAL_LT_MIN","requested":req,"room":room,"crypto_gross":crypto_g,"total_gross":total_g})
        continue
    if ag<=1e-9:
        rejected.append({"kind":"BASELINE","strategy":strat,"symbol":t["symbol"],"ts":ts,"position_id":pid,"candidate_id":t.get("candidate_id"),"reason":"NO_GROSS_ROOM","requested":req,"room":room,"crypto_gross":crypto_g,"total_gross":total_g})
        continue

    entry_price=float(t["entry_price"])
    qty=eq*ag/entry_price
    orig_qty=float(t["original_quantity"])
    if orig_qty<=0: raise SystemExit(f"ORIG_QTY_INVALID:{pid}")
    scale=qty/orig_qty
    ent=entry_event[pid]
    fee=float(ent["fee_settlement"])*scale
    wallet-=fee
    active[pid]={
        "strategy_id":strat,"symbol":t["symbol"],"side":t["side"],
        "entry_ts_ms":ts,"entry_price":entry_price,"quantity":qty,
        "accepted_gross":ag,"entry_equity":eq,"scale":scale,
        "candidate_id":t.get("candidate_id"),"entry_fee":fee,
        "price_pnl":0.0,"funding_pnl":0.0,"exit_fee":0.0,
    }
    accepted.append({"kind":"BASELINE","strategy":strat,"symbol":t["symbol"],"ts":ts,"position_id":pid,"candidate_id":t.get("candidate_id"),"requested":req,"accepted_gross":ag,"equity":eq,"scale":scale,"crypto_before":crypto_g,"total_before":total_g})
    # Preserve exact original position cashflow schedule, scaled by quantity.
    order_rank={"FUNDING":0,"MODELED_PARTIAL_EXIT":1,"MODELED_EXIT":2}
    for original_order,e in position_templates[pid]:
        et=e.get("event_type")
        if et not in order_rank: continue
        push(int(e["ts_ms"]),1,"SCHEDULED_BASE",{"pid":pid,"event":e,"original_order":original_order})

final_fx=float(metrics["accounting_reconciliation"]["final_fx_jpy_per_usd"])
final_jpy=wallet*final_fx
base_completed=[x for x in completed if x["kind"]=="BASELINE"]
idle_completed=[x for x in completed if x["kind"]=="IDLE"]
rej_base=[x for x in rejected if x["kind"]=="BASELINE"]
rej_idle=[x for x in rejected if x["kind"]=="IDLE"]

pnls=[float(x["trade_pnl_settlement"]) for x in completed]
gains=sum(x for x in pnls if x>0)
losses=-sum(x for x in pnls if x<0)
profit_factor=(gains/losses) if losses>0 else math.inf
idle_pnls=[float(x["trade_pnl_settlement"]) for x in idle_completed]
idle_gains=sum(x for x in idle_pnls if x>0)
idle_losses=-sum(x for x in idle_pnls if x<0)
idle_profit_factor=(idle_gains/idle_losses) if idle_losses>0 else math.inf
peak=None
max_dd=0.0
for _,v in equity_marks:
    if peak is None or v>peak: peak=v
    if peak and peak>0:
        max_dd=min(max_dd,v/peak-1.0)
strategy_counts=dict(Counter(x["strategy"] for x in completed))
out={
 "status":"DIAGNOSTIC_NOT_PRODUCTION_CERTIFICATE",
 "request_mode":a.request_mode,"without_idle":a.without_idle,"idle_fee_path":a.idle_fee_path,
 "roundtrip_bps":a.roundtrip_bps,
 "baseline_input":len(base),"idle_input":len(idle),
 "baseline_completed":len(base_completed),"idle_completed":len(idle_completed),
 "baseline_rejected":len(rej_base),"idle_rejected":len(rej_idle),
 "combined_completed":len(completed),
 "profit_factor":profit_factor,
 "max_mtm_drawdown":max_dd,
 "idle_profit_factor":idle_profit_factor,
 "idle_pnl_settlement":sum(idle_pnls),
 "idle_pnl_jpy_final_fx":sum(idle_pnls)*final_fx,
 "strategy_counts":strategy_counts,
 "equity_mark_count":len(equity_marks),
 "final_wallet_settlement":wallet,"final_fx_jpy_per_usd":final_fx,"final_equity_jpy":final_jpy,
 "baseline_anchor_jpy":float(metrics["final_equity_jpy"]),
 "baseline_anchor_trades":int(metrics["closed_trades"]),
 "rejections_by_strategy":dict(Counter(x.get("strategy","IDLE") for x in rejected)),
 "rejections":rejected,
 "accepted_tail":accepted[-30:],
 "idle_price_return_max_abs_error":max(idle_return_price_check) if idle_return_price_check else None,
}
Path(a.output).write_text(json.dumps(out,indent=2,sort_keys=True)+"\n",encoding="utf-8")
print(json.dumps({k:out[k] for k in ["request_mode","without_idle","idle_fee_path","roundtrip_bps","baseline_input","idle_input","baseline_completed","idle_completed","baseline_rejected","idle_rejected","combined_completed","final_equity_jpy","baseline_anchor_jpy","profit_factor","max_mtm_drawdown","idle_pnl_jpy_final_fx","idle_profit_factor","strategy_counts","rejections_by_strategy","idle_price_return_max_abs_error"]},sort_keys=True))
print("REJECTIONS="+json.dumps(rejected,sort_keys=True))
