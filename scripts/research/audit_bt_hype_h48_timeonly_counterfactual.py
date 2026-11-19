#!/usr/bin/env python3
"""Isolated HYPE H48 research exit counterfactual (no venue, portfolio or orders).

Compares old pretarget H48 6%-STOP+TIME M5 exit rows to 48-hour H1
next-open prices on the same modeled 27 research entries. This is NOT
certified LIVE fill, shared-risk, gross, slippage, funding or portfolio BT.
"""
from __future__ import annotations
import argparse,gzip,hashlib,json,math
from datetime import datetime,timezone
from pathlib import Path

HOUR=3_600_000
PARAMS={"holdHours":48,"hardStop":0.06,"takeProfit":None,"softLoss":None,"watchHours":0}

def sha(path:Path)->str:
 h=hashlib.sha256()
 with path.open("rb") as f:
  for block in iter(lambda:f.read(1<<20),b""):h.update(block)
 return h.hexdigest()

def load_h1(path:Path)->dict[int,float]:
 data={}
 with gzip.open(path,"rt",encoding="utf8") as f:
  for line in f:
   if not line.strip():continue
   r=json.loads(line)
   if not isinstance(r,list) or len(r)<5:raise ValueError("INVALID_H1_SOURCE_ROW")
   t=int(r[0]);op,hi,lo,close=map(float,r[1:5])
   if t in data or t%HOUR or any(not math.isfinite(x) or x<=0 for x in (op,hi,lo,close)) or hi<max(op,close) or lo>min(op,close):
    raise ValueError("H1_SOURCE_INVALID_OR_DUPLICATE")
   data[t]=op
 return data

def evaluate(rows:list[dict],open_prices:dict[int,float],bps:int)->dict:
 if bps not in (10,30):raise ValueError("ONLY_STANDALONE_10_30BPS_ALLOWED")
 if len(rows)!=27:raise ValueError("RESEARCH_ENTRY_COHORT_NOT_27")
 seen=set()
 detail=[]
 for model in rows:
  t=model["entryTs"]
  if type(t) is not int or t in seen:raise ValueError("INVALID_OR_DUPLICATE_MODEL_ENTRY")
  seen.add(t)
  reason=model["reason"]
  if reason not in ("STOP","TIME"):raise ValueError("UNTRUSTED_EXIT_MODEL_REASON")
  entry,old_exit=map(float,(model["entryPrice"],model["exitPrice"]))
  if not all(math.isfinite(x) and x>0 for x in (entry,old_exit)):raise ValueError("INVALID_MODELED_PRICE")
  if model["exitTs"]<=t:raise ValueError("NONCAUSAL_OLD_EXIT")
  scheduled=t+48*HOUR
  price=open_prices.get(scheduled)
  if price is None:raise ValueError("MISSING_H48_H1_BOUNDARY_OPEN")
  if not math.isfinite(price) or price<=0:raise ValueError("INVALID_48H_BOUNDARY")
  old_gross=old_exit/entry-1
  new_gross=price/entry-1
  cost=bps/10000
  detail.append({
   "modeled_entry_utc":datetime.fromtimestamp(t/1000,tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
   "old_model_exit_reason":reason,
   "old_model_exit_utc":datetime.fromtimestamp(model["exitTs"]/1000,tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
   "hypothetical_h48_utc":datetime.fromtimestamp(scheduled/1000,tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
   "same_research_entry_price":entry,
   "old_model_exit_price":old_exit,
   "hypothetical_h48_h1_open":price,
   "old_standalone_return_net_pct":round(100*(old_gross-cost),6),
   "hypothetical_time_only_return_net_pct":round(100*(new_gross-cost),6),
   "time_only_minus_stopped_model_pct_points":round(100*(new_gross-old_gross),6),
  })
 old=[r["old_standalone_return_net_pct"] for r in detail]
 new=[r["hypothetical_time_only_return_net_pct"] for r in detail]
 return {
  "research_model_candidates":len(detail),
  "old_model_stop_count":sum(r["old_model_exit_reason"]=="STOP" for r in detail),
  "old_standalone_win_rate_pct":round(100*sum(x>0 for x in old)/len(old),4),
  "hypothetical_time_only_win_rate_pct":round(100*sum(x>0 for x in new)/len(new),4),
  "old_standalone_mean_trade_return_net_pct":round(sum(old)/len(old),6),
  "hypothetical_time_only_mean_trade_return_net_pct":round(sum(new)/len(new),6),
  "old_standalone_worst_trade_return_net_pct":min(old),
  "hypothetical_time_only_worst_trade_return_net_pct":min(new),
  "old_standalone_sum_trade_return_net_pct_not_compounded":round(sum(old),6),
  "hypothetical_time_only_sum_trade_return_net_pct_not_compounded":round(sum(new),6),
  "rows":detail,
 }

def main():
 root=Path(__file__).resolve().parents[2]
 evidence=root/"docs/research-results"
 p=argparse.ArgumentParser(description=__doc__)
 p.add_argument("--cohort",type=Path,required=True)
 p.add_argument("--hype-h1",type=Path,required=True)
 p.add_argument("--output",type=Path,default=evidence/"BT_HYPE_H48_TIME_ONLY_STANDALONE_COUNTERFACTUAL_20261119_UNCERTIFIED.json")
 args=p.parse_args()
 old=json.loads(args.cohort.read_text(encoding="utf8"))
 latest=json.loads((evidence/"BT_HYPE_H48_EXIT_POLICY_PARITY_20261119_UNCERTIFIED.json").read_text(encoding="utf8"))
 early=json.loads((evidence/"BT_HYPE_EARLY_COOLDOWN_RECONSTRUCTION_20261119_UNCERTIFIED.json").read_text(encoding="utf8"))
 if latest.get("schema")!="disdex-bt-hype-h48-exit-policy-parity-audit/v1" or latest.get("production_bt_parity_certified") is not False:
  raise ValueError("H48_CERTIFICATE_SOURCE_AUDIT_REQUIRED")
 if sha(args.cohort)!=latest["pretarget_study_cohort_sha256"] or sha(args.hype_h1)!=early["hype_h1_sha256"]:
  raise ValueError("H48_RESEARCH_OR_H1_SHA256_MISMATCH")
 x=[v for v in old.get("topPretargetDiagnostics",[]) if v.get("params")==PARAMS]
 if len(x)!=1:raise ValueError("H48_MODEL_SOURCE_MISSING")
 original=x[0]["targetRows"]
 prices=load_h1(args.hype_h1)
 scenarios={str(bps):evaluate(original,prices,bps) for bps in (10,30)}
 report={
  "schema":"disdex-bt-hype-h48-exit-standalone-counterfactual/v1",
  "created_utc":datetime.now(timezone.utc).isoformat(),
  "study_source_sha256":sha(args.cohort),
  "hype_h1_source_sha256":sha(args.hype_h1),
  "counterfactual":"same_27_historical_model_entries; H1 open 48h after entry; no resident stop or TP; fixed 10/30bps round-trip cost",
  "old_model":"M5 6pct hard stop first or next 48h open; research pretarget 27 independent candidates",
  "actual_execution_count_verified":False,
  "historical_research_selected_hype_count_exhaustive_of_pinned_pure_signal":False,
  "preemption_and_competing_runner_priority_replayed":False,
  "cross_runner_portfolio_shared_risk_gross_replayed":False,
  "funding_real_slippage_and_order_lifecycle_replayed":False,
  "max_drawdown_computed":False,
  "production_bt_parity_certified":False,
  "scenarios":scenarios,
 }
 args.output.write_text(json.dumps(report,indent=2,ensure_ascii=False)+"\n",encoding="utf8")
 for bps,s in scenarios.items():
  print(f"{bps}bps independent-model HYPE 27 oldSTOPs={s['old_model_stop_count']} oldWin={s['old_standalone_win_rate_pct']}pct timeOnlyWin={s['hypothetical_time_only_win_rate_pct']}pct oldWorst={s['old_standalone_worst_trade_return_net_pct']}pct timeOnlyWorst={s['hypothetical_time_only_worst_trade_return_net_pct']}pct")
 print("COUNTERFACTUAL_ONLY_NO_SHARED_RISK_OR_VENUE_ORDER")
if __name__=="__main__":
 main()
