#!/usr/bin/env python3
"""Canonical-anchored Idle-only H1 MTM compounding + STOP budget admission.
Research only, NOT integrated Production parity. No LIVE orders or settings.
All original intent timestamps, archived Aster H1 candle opens and H1 exits
reconciled exact; 10bps source net = 24h/12h entry/exit price spread - 0.001.
"""
from __future__ import annotations
import argparse, json, math
from pathlib import Path
from collections import Counter
from idle_short_venue_h1_exit_research_20261019 import load,ROOT,HOUR

def replay(*,atr25=True,budget=20.,gap=1.,partial=True,min_gross=.25,
           cost_bps=10.,no_budget=False,risk_basis="mark",profit_lock=None):
 trades=load()
 by_time={}
 for x in trades:by_time.setdefault(x["t"],[]).append(x)
 exiting={}
 for x in trades:exiting.setdefault(int(x["exit_ts_ms"]),[]).append(x)
 start=min(x["t"] for x in trades)
 end=max(int(x["exit_ts_ms"]) for x in trades)
 active={};wallet=1.0;high=1.0;worst_dd=0.;history=[];completed=[];rejected=[];accepted=[]
 worst_assumed_risk=0.;max_gross=0.;num_stop_amendments=0
 def mark(x,ts):
  i=(ts-x["t"])//HOUR
  if not(0<=i<len(x["bars"])):raise RuntimeError("MARK_WINDOW_GAP "+str(x["idx"]))
  return float(x["bars"][i]["open"])
 def eqat(ts):
  return wallet+sum(p["qty"]*(p["trade"]["entry"]-mark(p["trade"],ts)) for p in active.values())
 for ts in range(start,end+HOUR,HOUR):
  for tr in exiting.get(ts,()):
   p=active.pop(tr["idx"],None)
   if not p:continue
   exit_fee=p["entry_notional"]*cost_bps/20000
   net=(tr["entry"]-tr["end"])*p["qty"]-p["entry_fee"]-exit_fee
   wallet+=(tr["entry"]-tr["end"])*p["qty"]-exit_fee
   completed.append({"symbol":tr["symbol"],"idx":tr["idx"],"pnl":net,"ret":tr["ret"],
                    "entry_gross":p["gross"],"entry_ts":tr["t"],"exit_ts":ts,
                    "entry_equity":p["entry_equity"]})
  # At this H1 boundary only the PREVIOUS COMPLETED candle may tighten a STOP.
  # Historical STOP amendments are hypothetical; no signed venue STOP readback.
  if profit_lock:
   activate,locked_pct=profit_lock
   for p in active.values():
    trade=p["trade"];offset=(ts-trade["t"])//HOUR
    if 1<=offset<len(trade["bars"]):
     low=float(trade["bars"][offset-1]["low"])
     p["min_low"]=min(p["min_low"],low)
     if (trade["entry"]-p["min_low"])/trade["entry"]>=activate:
      improved=min(p["stop"],trade["entry"]*(1-locked_pct))
      if improved<p["stop"]-1e-12:
       num_stop_amendments+=1
       p["stop"]=improved
  for tr in sorted(by_time.get(ts,()),key=lambda x:(x["t"],x["symbol"])):
   if atr25 and tr["atr"]>.025:
    rejected.append({"idx":tr["idx"],"reason":"ATR","historical_win":tr["ret"]>0});continue
   equity=eqat(ts)
   if equity<=0:raise RuntimeError("NONPOS_EQUITY "+str(ts))
   requested=equity*tr["weight"]
   if risk_basis=="entry":
    at_risk=sum(p["entry_notional"]*(.10+gap/100) for p in active.values())
   elif risk_basis=="mark":
    at_risk=sum(p["qty"]*max(0.,p["stop"]-mark(p["trade"],ts)+p["trade"]["entry"]*gap/100) for p in active.values())
   else:raise ValueError("UNKNOWN_RISK_BASIS")
   risk_denom=(.10+gap/100)
   max_notional=requested if no_budget else max(0,(budget/100*equity-at_risk)/(risk_denom+(budget/100)*(cost_bps/20000)))
   chosen=min(requested,max_notional) if partial else (requested if requested<=max_notional+1e-12 else 0.)
   request_fraction=chosen/equity
   if request_fraction+1e-9<min(min_gross,tr["weight"]):
    rejected.append({"idx":tr["idx"],"reason":"STOP_BUDGET","historical_win":tr["ret"]>0,
                     "requested_gross":tr["weight"],"room_gross":max_notional/equity});continue
   if profit_lock is not None:
    from idle_short_venue_h1_exit_research_20261019 import simulate
    orig_exit=simulate(tr,{"activate":profit_lock[0],"lock":profit_lock[1]})
    if orig_exit["exit_ts_ms"]<tr["exit_ts_ms"]:
     raise AssertionError("PROFIT_LOCK_WOULD_CHANGE_EXIT_AND_PNL__NEED_FULL_REPLAY")
   entry_fee=chosen*cost_bps/20000
   wallet-=entry_fee
   q=chosen/tr["entry"]
   active[tr["idx"]]={"trade":tr,"qty":q,"entry_notional":chosen,"stop":tr["entry"]*1.10,"min_low":tr["entry"],
           "entry_fee":entry_fee,"entry_equity":equity,"gross":request_fraction}
   accepted.append({"idx":tr["idx"],"symbol":tr["symbol"],"historical_win":tr["ret"]>0,
                    "entry_ts":ts,"gross":request_fraction,"requested":tr["weight"],
                    "risk_room_before_usd_units":max_notional,"entry_equity":equity})
   if risk_basis=="entry":
    risk_after=sum(p["entry_notional"]*risk_denom for p in active.values())/eqat(ts)*100
   else:
    risk_after=sum(p["qty"]*max(0.,p["stop"]-mark(p["trade"],ts)+p["trade"]["entry"]*gap/100) for p in active.values())/eqat(ts)*100
   if not no_budget and risk_after>budget+1e-8:
    raise AssertionError("POST_FEE_STOP_RISK_BUDGET_BREACH "+str(risk_after))
   worst_assumed_risk=max(worst_assumed_risk,risk_after)
  equity=eqat(ts)
  if equity<=0:raise RuntimeError("NONPOS_EQUITY_AT_MARK "+str(ts))
  high=max(high,equity)
  worst_dd=min(worst_dd,(equity/high-1)*100)
  gross=sum(p["entry_notional"]* (mark(p["trade"],ts)/p["trade"]["entry"])/equity for p in active.values())
  max_gross=max(max_gross,gross)
  history.append((ts,round(equity,12)))
 if active:raise RuntimeError("POSITIONS_OPEN_AT_END")
 pnl=[p["pnl"] for p in completed]
 gp=sum(p for p in pnl if p>0);gl=-sum(p for p in pnl if p<0)
 if abs(wallet-history[-1][1])>1e-9:raise AssertionError("FINAL_MTM_EQ_NE_WALLET")
 return {"status":"IDLE_ONLY_H1_MTM_COMPOUNDING_NOT_INTEGRATED_BT",
  "atr25":atr25,"risk_basis":risk_basis,"profit_lock":profit_lock,"stop_amendments":num_stop_amendments,"risk_budget_pct":None if no_budget else budget,
  "adverse_stop_gap_pct":gap,"partial_sizing":partial,"min_gross":min_gross,
  "cost_bps":cost_bps,"start_capital_normalized":1.0,
  "final_equity_multiple":round(wallet,6),"max_h1_mtm_drawdown_pct":round(worst_dd,4),
  "peak_h1_gross":round(max_gross,4),"peak_entry_nominal_stop_risk_pct":round(worst_assumed_risk,4),
  "trades":len(completed),"winners":sum(p>0 for p in pnl),
  "losers":sum(p<0 for p in pnl),"pf":round(gp/gl,4) if gl else None,
  "realized_winning_total_normalized":round(gp,6),
  "realized_losing_total_normalized":round(gl,6),
  "largest_realized_loss_normalized":round(min(pnl),6),
  "rejected_winners":sum(x["historical_win"] for x in rejected),
  "rejected_losers":sum(not x["historical_win"] for x in rejected),
  "downsized_winners":sum(x["historical_win"] and x["gross"]+1e-9<x["requested"] for x in accepted),
  "downsized_losers":sum(not x["historical_win"] and x["gross"]+1e-9<x["requested"] for x in accepted),
  "rejected":rejected,
  "downsized":[a for a in accepted if a["gross"]+1e-9<a["requested"]],
  "final_marks":history[-5:]}

def main():
 o=[]
 for cost in [10.,20.,30.]:
  for gap in [0.,1.,2.]:
   for risk_basis in ("entry","mark"):
    o.append({"scenario":"ATR25_ONLY_NO_BASKET","gap_assumption":gap,**replay(cost_bps=cost,no_budget=True,min_gross=.25,risk_basis=risk_basis)})
    o.append({"scenario":"ATR25_BUDGET20_FULL_OR_REJECT","gap_assumption":gap,**replay(cost_bps=cost,gap=gap,partial=False,min_gross=.25,risk_basis=risk_basis)})
    o.append({"scenario":"ATR25_BUDGET20_PARTIAL_MIN025","gap_assumption":gap,**replay(cost_bps=cost,gap=gap,partial=True,min_gross=.25,risk_basis=risk_basis)})
    if risk_basis=="mark":
     for pl in ((.05,.015),(.06,.025)):
      o.append({"scenario":"ATR25_BUDGET20_PARTIAL_PROFIT_LOCK","gap_assumption":gap,
        **replay(cost_bps=cost,gap=gap,partial=True,min_gross=.25,risk_basis=risk_basis,profit_lock=pl)})
 result={"source":"Canonical 61 exact H1 entry/exit price parity, preserved archive source SHA in companion report",
   "note":"Standalone Idle H1-only capital starts 1 and compounds. Original other runners, funding, signed STOP/path, 5m, margin and re-admission NOT replayed.",
   "results":o}
 p=ROOT/"docs/research/results/idle-short-cluster-20261019/IDLE_ONLY_COMPOUND_STOP_BUDGET_20261019.json"
 p.write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n",encoding='utf-8')
 summary=[{k:z[k] for k in ("scenario","risk_basis","profit_lock","stop_amendments","gap_assumption","cost_bps","final_equity_multiple","max_h1_mtm_drawdown_pct","trades","winners","pf","rejected_winners","downsized_winners","downsized_losers","peak_entry_nominal_stop_risk_pct","realized_losing_total_normalized","largest_realized_loss_normalized")} for z in o]
 print(json.dumps({"cases":len(o),"results":summary,"output":str(p)},ensure_ascii=False))
if __name__=="__main__":main()
