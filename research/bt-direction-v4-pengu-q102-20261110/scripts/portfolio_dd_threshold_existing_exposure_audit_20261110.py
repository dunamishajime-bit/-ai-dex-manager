#!/usr/bin/env python3
"""Research-only causal cross-sectional risk-at-trigger audit.
Classify open positions / newly admitted after DD threshold, without falsely allocating
full lifetime PnL to MTM drawdown interval. Uses immutable integrated research CSVs.
"""
import collections,csv,datetime as dt,hashlib,json
from pathlib import Path
R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
BASE=R/"VPS_DD_V4_SORT_PINNED_STOCK15_20261110"
D=R/"DIRECTION_RESEARCH_20261109"
PRE="Y06_NATIVE_LIFECYCLE_M5_AB_"
def table(cost,name):
 p=BASE/(f"{PRE}{cost}BPS_{name}.csv")
 with p.open(encoding="utf-8-sig",newline="") as f:rows=list(csv.DictReader(f))
 return p,rows
def gettime(s):return dt.datetime.fromisoformat(s.replace("Z","+00:00"))
report={"status":"RESEARCH_ONLY_RISK_ATTRIBUTION_WITHOUT_EXACT_INCRMTM_BY_TRADE",
 "model":"PINNED_RANK_STOCK_GROSS_1.5X_NATIVE_EXITS_20261110",
 "method":"Find first DD threshold after same peak preceding global trough; classify existing and post-threshold modeled admissions. Do not treat full-lifetime PnL as interval contribution.",
 "cost":{}}
for cost in [10,30]:
 path,e=table(cost,"EQUITY_30MIN");_,fills=table(cost,"FILLS")
 summary=json.loads((BASE/f"{PRE}{cost}BPS_SUMMARY.json").read_text(encoding="utf8"))
 peak=0;peak_idx=0;worst=0;worst_i=0;worst_peak_i=0
 for i,z in enumerate(e):
  eq=float(z["compounded_mtm_equity_jpy"])
  if eq>peak:peak=eq;peak_idx=i
  if peak>0 and eq/peak-1<worst:
   worst=eq/peak-1;worst_i=i;worst_peak_i=peak_idx
 assert abs(worst*100-summary["max_hourly_dd_pct"])<1e-6
 t0=e[worst_peak_i]["utc"];t1=e[worst_i]["utc"]
 epoch=gettime(t0);bottom=gettime(t1)
 rows=e[worst_peak_i:worst_i+1]
 def classify(x):
  d=gettime(x["entry_utc"]);en=gettime(x["exit_utc"])
  return d,en
 out={"peak_utc":t0,"trough_utc":t1,"peak_equity":float(e[worst_peak_i]["compounded_mtm_equity_jpy"]),
      "trough_equity":float(e[worst_i]["compounded_mtm_equity_jpy"]),
      "peak_to_trough_drawdown_pct":worst*100,
      "risk_trigger_levels":{}}
 for threshold in [.10,.15,.20,.25,.30]:
  goal=(1-threshold)*out["peak_equity"]
  first=next((z for z in rows if float(z["compounded_mtm_equity_jpy"])<=goal),None)
  if first is None:continue
  ts=gettime(first["utc"])
  existing=[x for x in fills if classify(x)[0]<=ts<classify(x)[1]]
  subsequent=[x for x in fills if ts<classify(x)[0]<=bottom]
  closed=[x for x in subsequent if classify(x)[1]<=bottom]
  still=[x for x in subsequent if classify(x)[1]>bottom]
  loss_closed=[x for x in closed if float(x["net_pnl_jpy"])<0]
  existing_until_bottom=[x for x in existing if classify(x)[1]>=bottom]
  risk_gross=sum(float(x["gross_x"]) for x in existing)
  ranks=collections.Counter(x["strategy"] for x in existing)
  new_by=collections.defaultdict(lambda:{"n":0,"closed_count":0,"closed_lifetime_pnl_jpy":0.0})
  for x in subsequent:
   z=new_by[x["strategy"]];z["n"]+=1
  for x in closed:
   z=new_by[x["strategy"]];z["closed_count"]+=1;z["closed_lifetime_pnl_jpy"]+=float(x["net_pnl_jpy"])
  out["risk_trigger_levels"][str(int(threshold*100))]=dict(trigger_utc=first["utc"],
    equity=float(first["compounded_mtm_equity_jpy"]),mtm_relative_to_peak=100*(float(first["compounded_mtm_equity_jpy"])/out["peak_equity"]-1),
    existing_open_count=len(existing),existing_gross_x=risk_gross,
    existing_by_strategy=dict(ranks),
    existing_positions=[{"id":x["source_signal_id"],"s":x["strategy"],"route":x["route"],
                        "symbol":x["symbol"],"gross_x":float(x["gross_x"]),"entry":x["entry_utc"],"exit":x["exit_utc"]} for x in existing],
    existing_survive_to_trough=[x["source_signal_id"] for x in existing_until_bottom],
    admitted_after_trigger=len(subsequent),
    closed_by_trough=len(closed),
    still_open_at_trough=len(still),
    closed_after_trigger_negative=len(loss_closed),
    post_trigger_new_admission_by_strategy=dict(new_by),
    post_trigger_closed_full_lifetime_pnl_sum=sum(float(x["net_pnl_jpy"]) for x in closed))
 # At trough exposures and OPEN order derived directly by filed modeled fill.
 at=[x for x in fills if classify(x)[0]<=bottom<classify(x)[1]]
 out["trough_open_positions"]=[{"id":x["source_signal_id"],"strategy":x["strategy"],"route":x["route"],
  "symbol":x["symbol"],"side":x["side"],"gross_x":float(x["gross_x"])} for x in at]
 out["trough_open_gross"]=sum(float(x["gross_x"]) for x in at)
 out["trough_open_counts_by_strategy"]=dict(collections.Counter(x["strategy"] for x in at))
 out["no_exact_runner_intratrade_mtm"]=[
 "Full lifetime fill PnL is NOT the post-threshold drawdown contribution; entry or exit may straddle trigger and trough.",
 "Partial protective exits and funding may cause separate event-level PnL; do not recompute exact risk attribution without per-tick open-book and position ledger.",
 "Stock1.5, native exits and funded research engine still approximate venue fills, esp V52."]
 report["cost"][str(cost)]=out
report["source_sha256"]={str(c):hashlib.sha256((BASE/f"{PRE}{c}BPS_EQUITY_30MIN.csv").read_bytes()).hexdigest() for c in [10,30]}
p=D/"v4_pengu_portfolio_risk_threshold_exposure_20261110.json"
p.write_text(json.dumps(report,indent=2,ensure_ascii=False)+"\n",encoding="utf8")
print("OUTPUT",p)
for cost,x in report["cost"].items():
 print("COST",cost,"peak",x["peak_utc"],"trough",x["trough_utc"],"DD",x["peak_to_trough_drawdown_pct"])
 for k,z in x["risk_trigger_levels"].items():
  print("TRIGGER",k,z["trigger_utc"],"open",z["existing_open_count"],"gross",round(z["existing_gross_x"],3),
   "admitted_after",z["admitted_after_trigger"],"closed_losses",z["closed_after_trigger_negative"],
   "new_by",[(s,v["n"]) for s,v in z["post_trigger_new_admission_by_strategy"].items()])
 print("TROUGH_OPEN",x["trough_open_positions"])
