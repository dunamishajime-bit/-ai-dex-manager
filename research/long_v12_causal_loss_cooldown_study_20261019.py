#!/usr/bin/env python3
"""V12 LONG streak-based causal cooldown study on frozen DD1296 accepted intents.
No future outcomes at admission; only completed accepted exits count.
Does not model substitution trades, shared gross or current V4 routes.
"""
from __future__ import annotations
import json,heapq
from pathlib import Path
from datetime import datetime,timezone

ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/"docs/research/results/dd1296-final-20261005/portfolio-trades.jsonl"
OUT=ROOT/"docs/research/results/long-loss-research-20261019/V12_LONG_STREAK_COOLDOWN_GRID_20261019.json"
HOUR=3_600_000
SPLIT=int(datetime(2026,5,1,tzinfo=timezone.utc).timestamp()*1000)

def records():
 rows=[json.loads(s) for s in SOURCE.read_text("utf8").splitlines() if s.strip()]
 z=[x for x in rows if x.get("side")=="LONG" and x.get("strategy_id")=="V12"]
 assert len(z)==379
 return z

def simulate(rows,n,delay_h):
 heap=[];seq=0
 for i,x in enumerate(rows):
  seq+=1;heap.append((int(x["entry_ts_ms"]),1,seq,"ENTRY",i))
 heapq.heapify(heap)
 state={"losing_streak":0,"cooldown_until":0}
 accepted=set();skipped=set();ret_out=[]
 while heap:
  ts,_,_,kind,i=heapq.heappop(heap)
  x=rows[i]
  if kind=="ENTRY":
   if ts<state["cooldown_until"]:
    skipped.add(i);ret_out.append((x,"SKIP"));continue
   accepted.add(i);ret_out.append((x,"ACCEPT"))
   seq+=1;heapq.heappush(heap,(int(x["exit_ts_ms"]),0,seq,"EXIT",i))
  else:
   if i not in accepted:raise RuntimeError("EXIT_WAS_NOT_ACCEPTED")
   if float(x["total_pnl_jpy"])<0:state["losing_streak"]+=1
   else:state["losing_streak"]=0
   if state["losing_streak"]>=n:
    state["cooldown_until"]=max(state["cooldown_until"],ts+delay_h*HOUR)
    state["losing_streak"]=0
 assert len(accepted)+len(skipped)==len(rows)
 def summary(subset):
  m=len(subset);w=[x for x in subset if float(x["total_pnl_jpy"])>0];l=[x for x in subset if float(x["total_pnl_jpy"])<0]
  saved=-sum(float(x["total_pnl_jpy"])/float(x["entry_equity"]) for x in l)
  forgone=sum(float(x["total_pnl_jpy"])/float(x["entry_equity"]) for x in w)
  return {"n":m,"wins_removed":len(w),"losers_avoided":len(l),"loss_avoided_pp":round(saved*100,4),"win_profit_lost_pp":round(forgone*100,4),"net_delta_pp":round((saved-forgone)*100,4)}
 sk=[rows[i] for i in sorted(skipped)]
 return {"n_losers_before_cooldown":n,"cooldown_hours":delay_h,
  "full":summary(sk),"train":summary([x for x in sk if int(x["entry_ts_ms"])<SPLIT]),
  "holdout":summary([x for x in sk if int(x["entry_ts_ms"])>=SPLIT]),
  "accepted_count":len(accepted)}

def main():
 rr=records()
 results=[simulate(rr,n,h) for n in (2,3,4,5,6) for h in (3,6,12,24)]
 OUT.parent.mkdir(parents=True,exist_ok=True)
 OUT.write_text(json.dumps({"source_trades":len(rr),"status":"fixed V12 pre-V4 accepted replay only, not integrated gross simulation","results":results},indent=2)+"\n",encoding="utf8")
 for x in sorted(results,key=lambda z:z["train"]["net_delta_pp"],reverse=True):
  print("CANDIDATE",x["n_losers_before_cooldown"],x["cooldown_hours"],"train",x["train"],"holdout",x["holdout"])
if __name__=="__main__":main()
