#!/usr/bin/env python3
"""Q102 LONG historical H1 price-path profit-floor comparison.
Research only; 5-minute overlay in current runtime is a DIFFERENT source.
Only original Q102_TIME_EXIT accepted-intents may have their exit shifted.
"""
from __future__ import annotations
from pathlib import Path
from datetime import datetime,timezone
import json,itertools,hashlib,statistics
from long_loss_causal_h1_filter_study_20261019 import ROOT,ARCHIVE,read,HOUR,SPLIT
OUT=ROOT/"docs/research/results/long-loss-research-20261019/Q102_LONG_PROFIT_FLOOR_H1_SIM_20261019.json"

def floor_exit(tr,market,trigger,locked,gap):
 ts=int(tr["entry_ts_ms"]);te=int(tr["exit_ts_ms"])
 entry=float(tr["entry_price"])
 original=float(tr["exit_price"])
 if tr["exit_reason_actual"]!="Q102_TIME_EXIT":
  return {"stop_hits":0,"new_exit_price":original,"new_exit_ts":te,"delta_fraction_of_equity":0.,
    "reason":"ORIGINAL_NON_TIME_EXIT_UNCHANGED"}
 assert te%HOUR==0 and ts%HOUR==0
 if abs(float(market[tr["symbol"]][ts]["open"])-entry)>1e-10:
  raise RuntimeError("ENTRY_NOT_ANCHORED_TO_H1")
 if abs(float(market[tr["symbol"]][te]["open"])-original)>1e-10:
  raise RuntimeError("EXIT_NOT_ANCHORED_TO_H1")
 active=False
 stop=entry*(1+locked)
 for offset in range((te-ts)//HOUR):
  bar=market[tr["symbol"]].get(ts+offset*HOUR)
  if not bar:raise RuntimeError("MISSING_H1 "+str(tr["symbol"]))
  op,lo,hi=float(bar["open"]),float(bar["low"]),float(bar["high"])
  if active:
   if op<=stop:
    px=op-entry*gap
    return {"stop_hits":1,"new_exit_price":px,"new_exit_ts":ts+offset*HOUR,
       "delta_fraction_of_equity":float(tr["accepted_gross"])*(px-original)/entry,
       "reason":"STOP_GAP_AT_H1_OPEN"}
   if lo<=stop:
    px=stop-entry*gap
    return {"stop_hits":1,"new_exit_price":px,"new_exit_ts":ts+offset*HOUR,
       "delta_fraction_of_equity":float(tr["accepted_gross"])*(px-original)/entry,
       "reason":"STOP_H1_INTRABAR"}
  # H1 bar completes; only then can STOP ratchet for NEXT H1
  if hi>=entry*(1+trigger):active=True
 return {"stop_hits":0,"new_exit_price":original,"new_exit_ts":te,
         "delta_fraction_of_equity":0.,"reason":"ORIGINAL_TIME_EXIT"}

def calculate(group,market,trigger,lock,gap):
 changed=[]
 for tr in group:
  y=floor_exit(tr,market,trigger,lock,gap)
  change=y["delta_fraction_of_equity"]
  current=float(tr["total_pnl_jpy"])/float(tr["entry_equity"])
  changed.append((tr,y,current,current+change))
 before=sum(x[2] for x in changed);after=sum(x[3] for x in changed)
 return {
   "n":len(changed),"original_winners":sum(x[2]>0 for x in changed),
   "new_winners":sum(x[3]>0 for x in changed),
   "historical_pnl_contribution_pp":round(before*100,5),
   "new_pnl_contribution_pp":round(after*100,5),
   "delta_pp":round((after-before)*100,5),
   "changed_trades":sum(x[1]["stop_hits"] for x in changed),
   "winner_to_loser":sum(x[2]>0 and x[3]<=0 for x in changed),
   "loser_to_winner":sum(x[2]<=0 and x[3]>0 for x in changed),
   "affected":[{
    "symbol":tr["symbol"],"family":tr.get("family"),
    "entry_date":datetime.fromtimestamp(int(tr["entry_ts_ms"])/1000,timezone.utc).strftime("%Y-%m-%d"),
    "old_return_pct":round(before*100,4),"new_return_pct":round(new*100,4),
    "exit_time_ms":out["new_exit_ts"],"exit_reason":out["reason"]}
    for tr,out,before,new in changed if out["stop_hits"]]
  }

def main():
 ledger,long,market=read()
 q=[x for x in long if x["strategy_id"]=="Q102"]
 families={"ALL_Q102_TIME_EXIT":q,
   "HIGH_VOL_LONG":[x for x in q if x.get("family")=="HIGH_VOL"],
   "Q102_PB_REV_BRK":[x for x in q if x.get("family")!="HIGH_VOL"],
   }
 arr=[]
 for name,sub in families.items():
  for trigger,lock,gap in itertools.product([.02,.03,.04,.05,.06,.08],[0.,.005,.01,.015,.02,.03],[0.,.005,.01,.02]):
   # Lock must be below trigger otherwise profit floor would be upward of current evidence
   if lock>=trigger:continue
   pre=calculate([x for x in sub if int(x["entry_ts_ms"])<SPLIT],market,trigger,lock,gap)
   post=calculate([x for x in sub if int(x["entry_ts_ms"])>=SPLIT],market,trigger,lock,gap)
   arr.append({"scope":name,"trigger_pct":trigger*100,"locked_pct":lock*100,
      "exit_adverse_slippage_pct":gap*100,"train":pre,"holdout":post,
      "both_period_gain":pre["delta_pp"]>0 and post["delta_pp"]>0})
 OUT.parent.mkdir(parents=True,exist_ok=True)
 OUT.write_text(json.dumps({"status":"RESEARCH_H1_CONSERVATIVE_NOT_VERIFIED_5M_VENUE",
    "ledger_sha256":hashlib.sha256((ROOT/"docs/research/results/dd1296-final-20261005/portfolio-trades.jsonl").read_bytes()).hexdigest(),
    "all_results":arr},ensure_ascii=False,indent=2)+"\n",encoding="utf8")
 print("VARIANTS",len(arr))
 for scope in families:
  subset=[r for r in arr if r["scope"]==scope and r["exit_adverse_slippage_pct"] in (0.,1.)]
  for row in sorted(subset,key=lambda r:r["train"]["delta_pp"],reverse=True)[:5]:
   print("TOP_TRAIN",scope,"trigger",row["trigger_pct"],"lock",row["locked_pct"],"gap",row["exit_adverse_slippage_pct"],"train",row["train"]["delta_pp"],"hold",row["holdout"]["delta_pp"],"early",row["train"]["changed_trades"],row["holdout"]["changed_trades"])
  for pct in [(2.,.5,0.),(2.,.5,1.),(3.,1.,0.),(4.,1.5,1.),(5.,2.,1.),(6.,2.5,1.)]:
   matched=[x for x in arr if x["scope"]==scope and all(abs(a-b)<1e-5 for a,b in zip((x["trigger_pct"],x["locked_pct"],x["exit_adverse_slippage_pct"]),pct))]
   if matched:print("PRIOR_CONTRACT",scope,pct,"train",matched[0]["train"],"hold",matched[0]["holdout"])
 print("OUTPUT",OUT)
if __name__=="__main__":main()
