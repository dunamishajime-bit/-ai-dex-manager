#!/usr/bin/env python3
"""PRISM IV all-runner route-level false-entry and execution-quality triage.

Only study historical modeled fills. Do not confuse net PnL loss with a
proved wrong-direction entry: classify regime, exit/cost, fee and M5
source execution uncertainty separately.

Risk metrics: per-trade NET price PnL per notional, both 10/30bps, quarter
stability, Wilson interval, and independently audited H1/M5 print anomalies.
Do not use hindsight cohort labels as real-time vetoes.

Source STABLE3/Gross4.25 research, NOT live Production parity.
"""
from __future__ import annotations
import csv,datetime as dt,json,math,statistics,sys
from collections import defaultdict,Counter
from pathlib import Path
ROOT=Path(r"C:\tmp\disdex-bt-20251001-20261001")
OUT=Path(r"C:\Users\dis\Documents\DisDex_Research\WINRATE_DEEP_20261122\phase2_results")
CONTROL=ROOT/"DD_MLX_COHERENT_CONTROL_20261121"
FORENSIC=OUT/"PRISM4_ALL_RUNNER_ENTRY_PRICE_PRINT_INTEGRITY.csv"
def asutc(s):return dt.datetime.fromisoformat(s.replace("Z","+00:00"))
def qa_file(path):
 with path.open(encoding="utf-8-sig",newline="") as f:return list(csv.DictReader(f))
audits=qa_file(FORENSIC)
audit={}
for x in audits:
 if x["case"]!="BASE_GROSS425":continue
 key=(int(x["fee"]),x["trade_id"])
 if key in audit:raise ValueError("DUPLICATE_AUDIT_TRADE_ID")
 audit[key]=x
allrows=[]
for fee in (10,30):
 p=list(CONTROL.glob(f"*_{fee}BPS_FILLS.csv"))
 if len(p)!=1:raise ValueError("CONTROL_TAPE_MISSING")
 rows=qa_file(p[0])
 expect={10:1072,30:804}[fee]
 if len(rows)!=expect:raise ValueError("CONTROL_TAPE_DIFFERENT")
 for x in rows:
  n=float(x["notional_jpy"])
  if not n>0:raise ValueError("NOTIONAL_NOT_POSITIVE")
  net=float(x["net_pnl_jpy"]);when=asutc(x["entry_utc"])
  qa=audit.get((fee,x["trade_id"]))
  if x["strategy"]!="V52" and qa is None:
   raise ValueError("M5_PROVENANCE_MISSING:"+x["trade_id"])
  if qa and qa["source_file"]!=p[0].name:
   raise ValueError("M5_AUDIT_WRONG_SOURCE")
  allrows.append({"fee":fee,"strategy":x["strategy"],"route":x["route"],
   "symbol":x["symbol"],"side":x["side"],"id":x["source_signal_id"],
   "trade_id":x["trade_id"],"month":when.strftime("%Y-%m"),
   "quarter":f"{when.year}Q{(when.month-1)//3+1}",
   "entry_utc":x["entry_utc"],"exit_utc":x["exit_utc"],
   "exit_reason":x["exit_model_reason"],"net_pnl_jpy":net,
   "notional_jpy":n,"net_notional_return_pct":100*net/n,
   "profitable":net>0,
   "source_price_gt5bps":bool(qa and qa["entry_source_stale"]=="True"),
   "source_no_print_entry_H1":bool(qa and qa["status"]=="NO_PRINT_IN_ENTRY_H1"),
   "source_missing":bool(qa and qa["status"]=="MISSING_H1_OR_M5"),
   "model_order_earlier_than_first_print":bool(qa and qa["model_entered_before_first_traded_M5"]=="True")})
assert len(allrows)==1876
def ci95(w,n):
 z=1.9599639845;p=w/n;d=1+z*z/n;c=(p+z*z/(2*n))/d
 h=z*math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d
 return [round(100*max(0,c-h),2),round(100*min(1,c+h),2)]
def group(rows,label,frequency,fee,segment):
 n=len(rows);w=sum(x["profitable"] for x in rows)
 rets=[x["net_notional_return_pct"] for x in rows]
 pos=sum(max(x,0) for x in rets);loss=sum(max(-x,0) for x in rets)
 return {"segment":segment,"period":frequency,"fee_bps":fee,**label,
 "n":n,"wins":w,"losses":n-w,"win_pct":round(100*w/n,2),
 "wilson95_win_pct":ci95(w,n),
 "median_net_notional_pct":round(statistics.median(rets),4),
 "mean_net_notional_pct":round(statistics.mean(rets),4),
 "sum_net_notional_pct":round(sum(rets),3),
 "price_profit_factor":round(pos/loss,3) if loss else None,
 "stale_M5_entry_count":sum(x["source_price_gt5bps"] for x in rows),
 "no_print_entry_count":sum(x["source_no_print_entry_H1"] for x in rows),
 "M5_source_missing_count":sum(x["source_missing"] for x in rows),
 "entry_timestamp_before_trade_print_count":sum(x["model_order_earlier_than_first_print"] for x in rows),
 "loss_reason_counts":dict(Counter(x["exit_reason"] for x in rows if not x["profitable"]))}
groups=[]
for fee in (10,30):
 a=[r for r in allrows if r["fee"]==fee]
 for fieldset in (("strategy",),("strategy","route"),("strategy","route","symbol","side")):
  bx=defaultdict(list)
  for x in a:bx[tuple(x[f] for f in fieldset)].append(x)
  for key,data in sorted(bx.items()):
   label={f:k for f,k in zip(fieldset,key)}
   groups.append(group(data,label,"FULL_2025OCT_2026SEP",fee,"_".join(fieldset)))
   for quarter in sorted(set(r["quarter"] for r in data)):
    subset=[r for r in data if r["quarter"]==quarter]
    groups.append(group(subset,label,quarter,fee,"_".join(fieldset)))
def csv_save(path,xx):
 keys=list(dict.fromkeys(k for x in xx for k in x))
 with path.open("w",encoding="utf-8-sig",newline="") as f:
  w=csv.DictWriter(f,keys);w.writeheader()
  for x in xx:w.writerow({k:json.dumps(v) if isinstance(v,(dict,list)) else v for k,v in x.items()})
csv_save(OUT/"PRISM4_ALL_RUNNER_ROUTE_LOSS_ATTRIBUTION.csv",groups)
csv_save(OUT/"PRISM4_ALL_RUNNER_MODELED_TRADE_REGIME_1876.csv",allrows)
candidates=[x for x in groups if x["segment"]=="strategy_route"
  and x["period"]=="FULL_2025OCT_2026SEP" and x["n"]>=10 and x["strategy"]!="V52"]
candidates=sorted(candidates,key=lambda x:(x["mean_net_notional_pct"],-x["n"]))
summary={
 "schema":"disdex-prism4-all-runner-route-winloss-source-audit/v1",
 "inputs":{"portfolio":"STABLE3 Gross425 V52latch research, NOT native Production parity",
 "modeled_fill_records":len(allrows),"fees":[10,30],"period":"2025-10-01/2026-10-01"},
 "runner_all":[x for x in groups if x["segment"]=="strategy" and x["period"]=="FULL_2025OCT_2026SEP"],
 "worst10_route_by_net_notional_return":[x for x in candidates if x["segment"]=="strategy_route"][:30],
 "routed_portfolio_candidates":len(candidates),
 "limitations":[
 "The profit/loss sign of an exit is not proof that the entry direction was incorrect",
 "Gross425, stable3 retrospective gates and fees are research source, not deployed pin",
 "Q102 missing history is UNKNOWN, never classified as untradeable",
 "Do not select trade route disable/threshold based on this same retrospective data",
 "Most route groups small and overlap across quarters; 95% Wilson only describes sample uncertainty",
 "Notional-return does not include full account compounding and open-position cross-correlations",
 "No signed venue fills or actual stop execution, funding and realized slippage are verified"
 ]}
(OUT/"PRISM4_ALL_RUNNER_ROUTE_LOSS_ATTRIBUTION_SUMMARY.json").write_text(
 json.dumps(summary,ensure_ascii=False,indent=2,sort_keys=True,allow_nan=False)+"\n",encoding="utf8")
print("ALL_RUNNER_ROUTE_ATTRIBUTION",len(allrows),"GROUPS",len(groups),flush=True)
for x in summary["runner_all"]:
 print("RUNNER",x["segment"],x["strategy"],x["n"],x["win_pct"],x["mean_net_notional_pct"],
   "no_print",x["no_print_entry_count"],"source_mismatch",x["stale_M5_entry_count"],flush=True)
for x in candidates[:20]:
 print("LOSS_ROUTE",x["strategy"],x["route"],"n",x["n"],"WR",x["win_pct"],
  "MEAN",x["mean_net_notional_pct"],"NO_PRINT",x["no_print_entry_count"],flush=True)
