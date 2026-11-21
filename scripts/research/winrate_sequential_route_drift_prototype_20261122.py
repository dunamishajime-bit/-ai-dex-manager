#!/usr/bin/env python3
"""Sequential per-route regime shift detector. Research-only, never an order gate.

Evaluates two predeclared drift alarms against candidate-only 10/30 bps price
labels, with outcomes made available only after exit + 24h embargo.
A gate that discards winners or lacks enough signals is REJECTED, not adopted.
"""
from __future__ import annotations
import csv,datetime as dt,json,math,statistics,sys
from collections import Counter,defaultdict
from pathlib import Path

OUT=Path(sys.argv[1]) if len(sys.argv)>1 else Path(r"C:\Users\dis\Documents\DisDex_Research\WINRATE_DEEP_20261122\results")
trace=json.loads((OUT/"causal_policy_candidate_trace_10_30bps.json").read_text(encoding="utf8"))
EMBARGO=24*3600000;MAX_AGE=180*86400000
def elapsed(iso):return int(dt.datetime.fromisoformat(iso.replace("Z","+00:00")).timestamp()*1000)
def perf(v):
 n=len(v);w=sum(x["price_win"] for x in v)
 return {"n":n,"wins":w,"win_pct":round(100*w/n,2) if n else None,
         "mean_price_pct":round(sum(x["net_price_return_pct"] for x in v)/n,4) if n else None}
def alarm(row,past):
 # Use only prior, mature, same-route outcomes; keep route/source isolation.
 latest=past[-12:];prior=past[-24:-12]
 if len(latest)<8:return False,False,{"recent_n":len(latest),"prior_n":len(prior)}
 a=perf(latest);b=perf(prior)
 # D1: sustained route-local negative expected return AND losing majority.
 risk_recent=a["win_pct"]<=50 and a["mean_price_pct"]<=0
 # D2: regime deterioration needs adequate prior confidence and a
 # negative change supported by both return and win-rate dimensions.
 unstable=False
 if len(prior)>=8:
  pnew=(2+a["wins"])/(4+len(latest))
  pold=(2+b["wins"])/(4+len(prior))
  vnew=pnew*(1-pnew)/(len(latest)+5)
  vold=pold*(1-pold)/(len(prior)+5)
  z=(pold-pnew)/math.sqrt(max(1e-12,vnew+vold))
  unstable=z>=1.15 and pold-pnew>=.18 and a["mean_price_pct"]<b["mean_price_pct"]
 return risk_recent,unstable,{"recent_n":len(latest),"prior_n":len(prior),
  "recent_win_pct":a["win_pct"],"prior_win_pct":b["win_pct"],
  "recent_mean_pct":a["mean_price_pct"],"prior_mean_pct":b["mean_price_pct"] if b["n"] else None}
results=[];traces=[]
for fee in ("10","30"):
 prior_route=defaultdict(list)
 for x in trace[fee]:
  ts=elapsed(x["entry_utc"])
  prior=[u for u in prior_route[(x["strategy"],x["route"],x["side"])]
   if ts-MAX_AGE<=u["_ts"]<ts and u["exitTs"]+EMBARGO<ts]
  d1,d2,why=alarm(x,prior)
  truth={"fee":int(fee),"signal_id":x["signal_id"],"strategy":x["strategy"],"route":x["route"],
   "side":x["side"],"phase":x["phase"],"entry_utc":x["entry_utc"],"price_win":x["price_win"],
   "net_price_return_pct":x["net_price_return_pct"],
   "d1_reject":d1,"d2_reject":d2,"either_reject":d1 or d2,"why":why}
  traces.append(truth)
  prior_route[(x["strategy"],x["route"],x["side"])].append({**x,"_ts":ts})
 for strat in ("V4","Q102","PENGU","IDLE","FET","HYPE","V52"):
  for phase in ("development","validation","post_validation"):
   allrows=[z for z in traces if z["fee"]==int(fee) and z["strategy"]==strat and z["phase"]==phase]
   if not allrows:continue
   for policy in ("baseline","d1_negative_recent","d2_shift_alarm","d1_or_d2"):
    filterfn={
     "baseline":lambda z:True,
     "d1_negative_recent":lambda z:not z["d1_reject"],
     "d2_shift_alarm":lambda z:not z["d2_reject"],
     "d1_or_d2":lambda z:not z["either_reject"]}[policy]
    kept=list(filter(filterfn,allrows));discard=[z for z in allrows if not filterfn(z)]
    r=perf(kept);baseline=perf(allrows)
    results.append({"fee_bps":int(fee),"runner":strat,"phase":phase,"policy":policy,
     "baseline_n":baseline["n"],"baseline_wr_pct":baseline["win_pct"],
     "retained_n":r["n"],"retained_win_rate_pct":r["win_pct"],
     "mean_model_price_pct":r["mean_price_pct"],
     "rejected_winners":sum(z["price_win"] for z in discard),
     "rejected_losers":sum(not z["price_win"] for z in discard),
     "covered_n_pct":round(100*r["n"]/baseline["n"],2),
     "target_70_or_80_achieved":r["n"]>=10 and (r["win_pct"] or 0)>=(80 if strat=="PENGU" else 70),
     "portfolio_reexecuted":False})
print("SEQ_DRIFT_AUDIT",len(traces),"score_records",len(results),"aggregates")
(OUT/"sequential_regime_gate_causal_summary.json").write_text(json.dumps({
 "schema":"disdex-sequential-route-drift-prototype/v1",
 "purpose":"Reject stale route configurations on sequential matured failures, not a deployed policy",
 "results":results,
 "assumptions":[
  "Use only same route/side with exitTs+24h < current entry, max lookback 180 days",
  "Last12 trade D1 rejects after >=8 mature outcomes, <=50% wins and <=0 modeled price-mean",
  "D2 compares last12 and previous12 with Beta(2,2) posterior normal approximation z>=1.15, fall>=18 points, worsening return",
  "Both policies are predeclared in code and not tuned to post-validation outcomes",
  "Not enough independent evidence that any route reaches 70/80 win-rate at relevant capacity",
  "No portfolio replay, no risk DD proof; model returns exclude funding and source STOP defects",
  "Prior research used same market period so this is NOT independently blind data"
 ]},ensure_ascii=False,sort_keys=True,indent=2,allow_nan=False)+"\n",encoding="utf8")
(OUT/"sequential_regime_gate_signal_trace.json").write_text(json.dumps(
 {"schema":"disdex-sequential-route-drift-trace/v1","traces":traces},
 ensure_ascii=False,separators=(",",":"),allow_nan=False)+"\n",encoding="utf8")
with (OUT/"sequential_regime_gate_by_runner.csv").open("w",encoding="utf-8-sig",newline="") as file:
 w=csv.DictWriter(file,list(results[0]));w.writeheader();w.writerows(results)
for r in results:
 if r["fee_bps"]==30 and r["phase"]=="post_validation":
  print("OOS_30",r["runner"],r["policy"],"N",r["retained_n"],
    "WIN",r["retained_win_rate_pct"],"REJECT_W",r["rejected_winners"],"REJECT_L",r["rejected_losers"],flush=True)
