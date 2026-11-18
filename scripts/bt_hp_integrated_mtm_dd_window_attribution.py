#!/usr/bin/env python3
"""Integrated modeled portfolio 5m maximum DD window and adverse-side audit.

Prices, quantities and venues are MODEL evidence. Returns by close-in-window
are descriptive (not exact causality of peak-to-trough due open/close timing).
"""
from __future__ import annotations
import argparse,csv,hashlib,json,math
from collections import defaultdict,Counter
from pathlib import Path
START="2025-10-01T00:00:00Z";END="2026-10-01T00:00:00Z"
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def rows(p):
 with p.open(encoding="utf-8-sig",newline="") as f:yield from csv.DictReader(f)
def num(value):
 v=float(value)
 if not math.isfinite(v):raise ValueError("MODEL_FINITE_NUMBER_REQUIRED")
 return v
def almost(a,b):
 return math.isclose(a,b,rel_tol=1e-11,abs_tol=1e-6)
def adverse(side,entry,exit):
 if side not in ("LONG","SHORT") or min(entry,exit)<=0:
  raise ValueError("MODEL_DIRECTION_OR_PRICE_INVALID")
 return exit>entry if side=="SHORT" else exit<entry
def check_net_pnl_model(row):
 net=num(row["net_pnl_jpy"])
 gross=num(row["pnl_before_cost_jpy"])
 entryfee=num(row["entry_fee_jpy"]);exitfee=num(row["exit_fee_jpy"])
 funding=num(row["funding_model_jpy"])
 if not almost(net,gross-entryfee-exitfee+funding):
  raise ValueError("SOURCE_MODELED_NET_PNL_IDENTITY_BROKEN")
 return net

def window(equity_path:Path,manifest_row:dict)->dict:
 peak=0.;peakt=None;peakrow=None;troughrow=None;min_dd=0.;rows_seen=0
 for r in rows(equity_path):
  t=r["utc"];v=num(r["compounded_mtm_equity_jpy"])
  if rows_seen==0 and t!=START:raise ValueError("MODEL_PERIOD_START_INVALID")
  if v<=0:raise ValueError("MODEL_EQUITY_NOT_POSITIVE")
  rows_seen+=1
  if v>peak:peak=v;peakt=t;peakrow=r
  dd=100*(v/peak-1)
  if dd<min_dd:
   min_dd=dd;troughrow=r;troughpeak=peakrow;troughstart=peakt
 if rows_seen!=105121 or t!=END or troughrow is None:
  raise ValueError("MODEL_MTM_WINDOW_INCOMPLETE")
 if not almost(min_dd,manifest_row["max_hourly_dd_pct"]) or troughrow["utc"]!=manifest_row["dd_time_utc"]:
  raise ValueError("MODEL_DD_SOURCE_SUMMARY_MISMATCH")
 return {"peakUtc":troughstart,"troughUtc":troughrow["utc"],
   "peak":troughpeak,"trough":troughrow,"ddPct":min_dd,
   "sourceFiveMinuteSnapshots":rows_seen}
def positions_at(path:Path,start:str,end:str)->dict:
 output={start:[],end:[]}
 for r in rows(path):
  t=r["utc"]
  if t not in output or not r["trade_id"]:continue
  fields=("current_notional_jpy","entry_price","mark_price","account_equity_jpy")
  vals={k:num(r[k]) for k in fields}
  if any(vals[k]<=0 for k in fields) or r["side"] not in ("LONG","SHORT"):
   raise ValueError("POSITION_ENDMARK_OR_DIRECTION_INVALID")
  n=vals["current_notional_jpy"];base=n*vals["entry_price"]/vals["mark_price"]
  pnl=n-base if r["side"]=="LONG" else base-n
  output[t].append({"logic":r["logic"],"symbol":r["symbol"],
    "modeledUnrealizedJpy":pnl,"grossX":num(r["current_gross_x"]),
    "equity":vals["account_equity_jpy"],"tradeId":r["trade_id"]})
 return output
def summarize_pnl(seq:list[dict])->dict:
 d=Counter();pnl=0.
 for x in seq:
  p=num(x["modelNetJpy"])
  pnl+=p;d["n"]+=1;d["wins"]+=int(p>0);d["losses"]+=int(p<0)
  d["adversePriceDirection"]+=int(x["adverseDirection"])
 return {"closedModeledFills":d["n"],"wins":d["wins"],"losses":d["losses"],
   "adversePriceDirection":d["adversePriceDirection"],"modeledNetJpy":pnl}
def audit_case(folder:Path,bps:int,summary:dict)->dict:
 def p(tail):
  x=list(folder.glob(f"*_{bps}BPS_{tail}"))
  if len(x)!=1:raise ValueError("SOURCE_CASE_UNIQUE_FILE_REQUIRED:"+tail)
  return x[0]
 eq=window(p("EQUITY_30MIN.csv"),summary)
 start=eq["peakUtc"];end=eq["troughUtc"]
 endpoint_pos=positions_at(p("POSITION_GROSS_SNAPSHOTS.csv"),start,end)
 un={}
 for t in (start,end):
  pos=endpoint_pos[t]
  if not pos:raise ValueError("RESEARCH_PEAK_TROUGH_POSITION_SOURCE_EMPTY")
  row=eq["peak"] if t==start else eq["trough"]
  e=num(row["compounded_mtm_equity_jpy"]);cash=num(row["wallet_cash_jpy"])
  unreal=sum(x["modeledUnrealizedJpy"] for x in pos)
  if not almost(e-cash,unreal):raise ValueError("MTM_EQUITY_CASH_UNREALIZED_IDENTITY_MISMATCH")
  if any(not almost(e,x["equity"]) for x in pos):
   raise ValueError("SOURCE_SNAPSHOT_ACCOUNT_EQUITY_CONFLICT")
  bylogic=defaultdict(float)
  for x in pos:bylogic[x["logic"]]+=x["modeledUnrealizedJpy"]
  un[t]={"cashJpy":cash,"unrealizedJpy":unreal,"equityJpy":e,
         "unrealizedByLogic":dict(sorted(bylogic.items())),
         "openModels":len(pos)}
 delta_cash=un[end]["cashJpy"]-un[start]["cashJpy"]
 delta_unreal=un[end]["unrealizedJpy"]-un[start]["unrealizedJpy"]
 delta_equity=un[end]["equityJpy"]-un[start]["equityJpy"]
 if not almost(delta_cash+delta_unreal,delta_equity):
  raise ValueError("PORTFOLIO_DD_PNL_IDENTITY_MISMATCH")
 direct=[];seen=set();nfill=0
 for r in rows(p("FILLS.csv")):
  nfill+=1;tid=r["trade_id"]
  if not tid or tid in seen:raise ValueError("DUPLICATE_MODEL_FILL")
  seen.add(tid)
  if r["signed_execution_verified"]!="False" or r["actual_venue_order_id"] or r["actual_filled_quantity"]:
   raise ValueError("MODEL_FILL_MISLABELED_AS_VENUE_FILL")
  net=check_net_pnl_model(r)
  if not START<=r["entry_utc"]<r["exit_utc"]<=END:
   raise ValueError("MODEL_FILL_OUTSIDE_STUDY")
  if not start<r["exit_utc"]<=end:continue
  direction=adverse(r["side"],num(r["model_entry_price"]),num(r["model_exit_price"]))
  direct.append({"tradeId":tid,"logic":r["strategy"],"route":r["route"],
   "symbol":r["symbol"],"side":r["side"],"exitUtc":r["exit_utc"],
   "modelNetJpy":net,"adverseDirection":direction})
 if nfill!=summary["modeled_fills"]:
  raise ValueError("MODEL_CLOSED_FILL_COUNT_SUMMARY_DRIFT")
 by_strategy=defaultdict(list);by_route=defaultdict(list)
 for x in direct:
  by_strategy[x["logic"]].append(x)
  by_route[(x["logic"],x["route"])].append(x)
 return {"bps":bps,"maxFiveMinuteDDPct":eq["ddPct"],
   "peakUtc":start,"troughUtc":end,
   "peakToTroughEquityLossJpy":delta_equity,
   "cashDeltaJpy":delta_cash,"openPositionUnrealizedDeltaJpy":delta_unreal,
   "endpointEquityCashUnrealizedModelIdentity":True,
   "peakMark":un[start],"troughMark":un[end],
   "closedModeledFillsInWindow":summarize_pnl(direct),
   "byStrategy":{k:summarize_pnl(v) for k,v in sorted(by_strategy.items())},
   "negativeCloseNetRoutes":sorted([
      {"logic":a,"route":b,**summarize_pnl(v)}
      for (a,b),v in by_route.items() if sum(x["modelNetJpy"] for x in v)<0],
      key=lambda x:x["modeledNetJpy"]),
   "fillsInWindowAreNotFullEconomicDDAttribution":True,
   "tradingRiskNotModified":True,
   "sourceSha256":{t:sha(p(t)) for t in ("EQUITY_30MIN.csv","POSITION_GROSS_SNAPSHOTS.csv","FILLS.csv")}}
def build(folder:Path)->dict:
 m=json.loads((folder/"RUN_MANIFEST.json").read_text("utf8"))
 if m.get("status")!="STRICT_V2_PLUS_V4Q102_PENGU_RECOVERY_REVERSAL_RESEARCH_ONLY_NOT_FULL_PRODUCTION_PARITY" or m.get("period")!=[START,END]:
  raise ValueError("CANONICAL_SOURCE_MANIFEST_UNKNOWN")
 bybps={str(v["cost_bps_roundtrip"]):v for v in m["results"]}
 if set(bybps)!={"10","30"}:raise ValueError("BPS_RESULTS_UNEXPECTED")
 d={cost:audit_case(folder,int(cost),man) for cost,man in bybps.items()}
 return {"schema":"bt481-integrated-mtm-dd-window-adverse-direction/v1",
   "status":"MODEL_WINDOW_RECONCILED_DIRECTION_LABELS_DESCRIPTIVE_ONLY",
   "sourceStatus":m["status"],"cases":d,
   "targetWindowNotUsedForGateTraining":True,
   "strategySpecificCausalOpportunityAttributionCertified":False,
   "v4CodexSourceEconomicParityCertified":False,
   "liveTradeActions":0}
def main():
 p=argparse.ArgumentParser(description=__doc__)
 p.add_argument("--case-dir",type=Path,required=True)
 p.add_argument("--output",type=Path,required=True)
 a=p.parse_args();result=build(a.case_dir)
 a.output.write_text(json.dumps(result,ensure_ascii=False,indent=2,allow_nan=False)+"\n","utf8")
 print(json.dumps({"status":result["status"],"cases":{
 bp:{"maxDD":x["maxFiveMinuteDDPct"],"peak":x["peakUtc"],"trough":x["troughUtc"],
 "peakToTroughLossJpy":round(x["peakToTroughEquityLossJpy"],2),
 "closedFills":x["closedModeledFillsInWindow"]["closedModeledFills"],
 "worstExitStrategies":sorted([(k,v["modeledNetJpy"]) for k,v in x["byStrategy"].items()],key=lambda r:r[1])[:3]}
 for bp,x in result["cases"].items()}},ensure_ascii=False))
if __name__=="__main__":main()
