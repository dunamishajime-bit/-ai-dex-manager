#!/usr/bin/env python3
"""PRISM IV V4 Recovery-X12/X02 structural-regime falsification.

READ-ONLY research. Uses fully closed H1 as-of decision features, 30/10bps
price source-proxy native modeled exits. NOT a deployed Runner, no orders.

Three phases:
- freeze volatility thresholds to 2025Q4 NON-LABELLED candidate medians,
- test 2026Q1 and Q2/Q3 chronologically, NEVER update from test losses,
- compare win, mean price return, PF and opportunity (retained winners/losses).

This does NOT claim blind OOS: the full year had already been studied.
"""
from __future__ import annotations
import csv,datetime as dt,json,math,statistics,sys
from pathlib import Path
from collections import defaultdict,Counter
R=Path(r"C:\Users\dis\Documents\DisDex_Research\WINRATE_DEEP_20261122\phase2_results")
FEATURES=R/"prism_h1_source_closed_entry_features.jsonl"
RETURNS=R/"PRISM4_ALL_RUNNER_MODELED_TRADE_REGIME_1876.csv"
a=[json.loads(line) for line in FEATURES.open(encoding="utf8") if line.strip()]
with RETURNS.open(encoding="utf-8-sig",newline="") as f:replay=list(csv.DictReader(f))
ROUTES=("REC_X12_TIME_12H","REC_X02_TIME_36H")
native=[z for z in a if z["strategy"]=="V4" and z["route"] in ROUTES]
assert len(native)==98,len(native)
def ts(iso):return int(dt.datetime.fromisoformat(iso.replace("Z","+00:00")).timestamp()*1000)
def quarter(t):
 d=dt.datetime.fromtimestamp(t/1000,dt.timezone.utc)
 return f"{d.year}Q{(d.month-1)//3+1}"
replay_ix={(z["strategy"],z["route"],z["symbol"],z["side"],ts(z["entry_utc"]),int(z["fee"])):z
 for z in replay if z["strategy"]=="V4" and z["route"] in ROUTES}
checked=0;flips=0;maxdiff=0
for x in native:
 key=(x["strategy"],x["route"],x["symbol"],x["side"],x["entryTs"],30)
 z=replay_ix.get(key)
 if not z:continue
 expected=(x["gross"]-.003)*100
 observed=float(z["net_notional_return_pct"])
 checked+=1;maxdiff=max(maxdiff,abs(expected-observed))
 if (expected>0)!=(observed>0):flips+=1
if checked!=49 or flips or maxdiff>.051:raise ValueError("SHADOW_TO_PORTFOLIO_PRICE_LABEL_PARITY_FAIL:"+str({"checked":checked,"flips":flips,"maxdiff":maxdiff}))
print("V4_ROUTE_PRICE_RETURN_PARITY",checked,"WIN_SIGN_FLIPS",flips,"MAX_ABS_PCT",maxdiff,flush=True)
byroute=defaultdict(list)
for x in native:
 q=quarter(x["entryTs"])
 byroute[x["route"]].append({**x,"quarter":q})
policies=(
 "NO_EXTRA_GATE",
 "BASE_Q4_MEDIAN_VOL24",
 "VOL24_NOT_ABOVE_VOL72",
 "STRUCTURE_ALIGNED6_24_BTC6",
 "MULTI_TREND_AND_COOLING",
 "VOL_COOLING_AND_EFFICIENCY",
 "AVOID_BTC_ASSET_SIMULTANEOUS_REBOUND",
)
Q4_MEDIAN={}
for route in ROUTES:
 dev=[x["features"]["sym_vol24"] for x in byroute[route] if x["quarter"]=="2025Q4"]
 if len(dev)<5:raise ValueError("INADEQUATE_Q4_VOL_BASE")
 Q4_MEDIAN[route]=statistics.median(dev)
print("FROZEN_NO_LABEL_Q4_MEDIAN_VOL",Q4_MEDIAN,flush=True)
def gate(route,policy,features):
 f=features
 vol=f["sym_vol24"];vol72=f["sym_vol72"];eff=f["sym_eff24"]
 aligned=f["aligned_sym6"]>=0 and f["aligned_sym24"]>=0 and f["aligned_btc6"]>=0
 cool=vol<=vol72
 if policy=="NO_EXTRA_GATE":return True
 if policy=="BASE_Q4_MEDIAN_VOL24":return vol<=Q4_MEDIAN[route]
 if policy=="VOL24_NOT_ABOVE_VOL72":return cool
 if policy=="STRUCTURE_ALIGNED6_24_BTC6":return aligned
 if policy=="MULTI_TREND_AND_COOLING":return aligned and cool
 if policy=="VOL_COOLING_AND_EFFICIENCY":return cool and eff>=.15
 if policy=="AVOID_BTC_ASSET_SIMULTANEOUS_REBOUND":
  return not (f["aligned_btc6"]<0 and f["aligned_sym6"]<0)
 raise ValueError("UNKNOWN_GATE")
def stats(trades,bps):
 n=len(trades)
 if not n:return {"n":0,"wins":0,"wr":None,"mean":None,"pf":None}
 val=[100*(x["gross"]-bps/10000) for x in trades]
 wins=sum(z>0 for z in val)
 gain=sum(max(z,0) for z in val);lose=sum(max(-z,0) for z in val)
 return {"n":n,"wins":wins,"wr":round(100*wins/n,2),
  "mean":round(statistics.mean(val),4),"sum":round(sum(val),3),
  "pf":round(gain/lose,3) if lose>0 else None}
out=[]
for route in ROUTES:
 for ph in ("2025Q4","2026Q1","2026Q2","2026Q3","FULL_PERIOD_ALREADY_RESEARCHED"):
  group=[x for x in byroute[route] if ph=="FULL_PERIOD_ALREADY_RESEARCHED" or x["quarter"]==ph]
  if not group:continue
  for fee in (10,30):
   b=stats(group,fee)
   for policy in policies:
    keep=[x for x in group if gate(route,policy,x["features"])]
    dis=[x for x in group if not gate(route,policy,x["features"])]
    r=stats(keep,fee)
    out.append({"route":route,"period":ph,"bps":fee,"rule":policy,
      "dev_frozen_q4_median_vol24":Q4_MEDIAN[route],
      "native_n":len(group),"native_wr":b["wr"],"native_mean":b["mean"],
      "kept":r["n"],"kept_wins":r["wins"],"kept_wr":r["wr"],
      "mean_net_notional_pct":r.get("mean"),"price_pf":r.get("pf"),
      "retained_frac":round(len(keep)/len(group),3),
      "rejected_winners":stats(dis,fee)["wins"],
      "rejected_losers":len(dis)-stats(dis,fee)["wins"],
      "source":"V4_PINNED_SHADOW_NATIVE_MODELED_EXIT_NOT_PRODUCTION_ORDERS"})
def savecsv(path,records):
 cols=list(dict.fromkeys(k for r in records for k in r))
 with path.open("w",encoding="utf-8-sig",newline="") as f:
  writer=csv.DictWriter(f,cols);writer.writeheader();writer.writerows(records)
savecsv(R/"PRISM4_V4_RECOVERY_X12_X02_CAUSAL_Q4_FREEZE_Q1_Q2_Q3.csv",out)
summary={"schema":"disdex-prism4-V4-X12-X02-causal-regime-ablation/v1",
 "source_pinned_runtime_sha":"3ad65403013b701db5d9e53e8814e6ab827a28e8",
 "source_type":"V4 shadow native candidate prior BT study, not LIVE venue orders",
 "source_trade_parity":{"matches":checked,"win_label_flips":flips,"max_return_pct_diff":maxdiff},
 "no_label_Q4_volatility_median_by_route":Q4_MEDIAN,
 "policy_gate_descriptions":policies,"results":out,
 "adoption_decision":"NOT_ELIGIBLE_RESEARCH_ONLY",
 "limitations":["The source V4 shadow routes have orderEnabled=false, and Gross4.25 historical portfolio is not currently deployed V4.",
 "The first quarter training window and subsequent quarters were previously observed by this research program, not a blind OOS.",
 "A model that rejects losing trades may also reject many winners, and its effect on shared Gross, profit and 30bps DD is not available here.",
 "No extra gate based on these results may be proposed for Production until new unseen market and exchange execution parity."]}
(R/"PRISM4_V4_RECOVERY_X12_X02_Q4_FROZEN_REGIME_SUMMARY.json").write_text(
 json.dumps(summary,indent=2,ensure_ascii=False,sort_keys=True,allow_nan=False)+"\n",encoding="utf8")
for x in out:
 if x["bps"]==30 and x["period"] in ("2026Q1","2026Q2","2026Q3") and x["rule"] in ("NO_EXTRA_GATE","BASE_Q4_MEDIAN_VOL24","MULTI_TREND_AND_COOLING","VOL_COOLING_AND_EFFICIENCY"):
  print("V4_SHADOW_CAUSAL",x["route"],x["period"],x["rule"],"n",x["kept"],"WR",x["kept_wr"],"MEAN",x["mean_net_notional_pct"],"EXCLUDE_WIN",x["rejected_winners"],flush=True)
print("V4_X12_X02_STRUCTURAL_GATE_FALSIFICATION_COMPLETE",len(out),flush=True)
