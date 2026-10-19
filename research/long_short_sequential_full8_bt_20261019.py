#!/usr/bin/env python3
"""Cumulative candidate-by-candidate latest 2026-10-17 full8 DD research.
Original full8 entry signal, source engine, HYPE/Q102 M5 overlays and Idle
DOT/RENDER 0.25x+trail are preserved. No production/LIVE, no orders.
Each stage composes only earlier accepted prior steps. Compare 10 and 30bps,
prefer lower integrated H1 mark-to-market DD AND less loss exposure.
"""
from __future__ import annotations
import argparse,bisect,hashlib,json,math,time,statistics
from pathlib import Path
from long_two_axis_latest_full8_20261019 import ROOT,OUT,REFERENCE,bootstrap,ensure_baseline

REPORT=ROOT/"docs/research/results/long-loss-research-20261019"
M5=300_000
SEED="LATEST_20261017_BASELINE"
ORIG={
 10:{"final_jpy":222818966.87803495,"max_dd_pct":-15.62063681288941,"trade_count":1310},
 30:{"final_jpy":124289206.81827945,"max_dd_pct":-16.78776877493442,"trade_count":1307},
}
R=None;P=None;EXT_OBS={}

# Prespecified coarse grid. A separate candidate stage is always measured vs
# most recently accepted CUMULATIVE portfolio, not the untouched 2026-10-17
# benchmark. Do not combine different alternatives within a stage.
ARM1={
 "id":"V12_SHORT_PROFIT_2_TO_0P5",
 "target":"V12","side":"SHORT","axis":"profit_reversal",
 "arm_close_pct":.02,"locked_profit_pct":.005,"stop_slip_bps":10}
ARM2={
 "id":"V12_SHORT_PROFIT_3_TO_1",
 "target":"V12","side":"SHORT","axis":"profit_reversal",
 "arm_close_pct":.03,"locked_profit_pct":.01,"stop_slip_bps":10}
EARLY1={
 "id":"V12_SHORT_INITIAL_WALLET_1P0",
 "target":"V12","side":"SHORT","axis":"initial_adverse",
 "max_initial_wallet_loss_pct":.01,"stop_slip_bps":10}
EARLY2={
 "id":"V12_SHORT_INITIAL_WALLET_1P5",
 "target":"V12","side":"SHORT","axis":"initial_adverse",
 "max_initial_wallet_loss_pct":.015,"stop_slip_bps":10}
# Second stage only after first V12 SHORT policy is adopted (if none is
# accepted, second stage builds on unchanged 2026-10-17 baseline).
HYPE1={"id":"HYPE_LONG_PROFIT_1P5_TO_0P25","target":"HYPE_LONG","side":"LONG",
 "axis":"profit_reversal","arm_close_pct":.015,"locked_profit_pct":.0025,"stop_slip_bps":10}
HYPE2={"id":"HYPE_LONG_INITIAL_WALLET_1P5","target":"HYPE_LONG","side":"LONG",
 "axis":"initial_adverse","max_initial_wallet_loss_pct":.015,"stop_slip_bps":10}
BASE_STAGES=[
 {"stage":"S01","scope":"V12 SHORT","candidates":[ARM1,ARM2,EARLY1,EARLY2]},
 {"stage":"S02","scope":"HYPE LONG","candidates":[HYPE1,HYPE2]},
]

def eligibility(tr,plan):
 return tr.get("strategy_id")==plan["target"] and tr.get("side")==plan["side"]

def projected_exit(tr,plan):
 """M5 independent STOP candidate; never mutate frozen original trade.
 Activation after fully closed M5; same M5 bar cannot both activate/fill STOP.
 Existing baseline protective EXIT takes precedence if earlier. No re-entry.
 """
 ts=int(tr["entry_ts_ms"]);end=int(tr["exit_ts_ms"])
 if end<=ts+M5:return tr
 entry=float(tr["entry_price"])
 gross=float(tr.get("accepted_gross") or tr.get("candidate_requested_gross") or 1.)
 if not (math.isfinite(gross) and gross>0 and math.isfinite(entry) and entry>0):return tr
 sg=1 if tr["side"]=="LONG" else -1
 bars,times=R.getdata(tr["symbol"])
 idx=bisect.bisect_left(times,ts)
 jend=bisect.bisect_left(times,end)
 if idx>=len(bars) or idx>=jend or times[idx]>ts+M5:return tr
 first=bars[idx]
 if abs(first[1]/entry-1)>.025:return tr
 scale=entry/first[1]
 stop=None
 if plan["axis"]=="initial_adverse":
  cap=plan["max_initial_wallet_loss_pct"]/gross
  stop=entry*(1-sg*cap)
  if stop<=0:return tr
 peak=0.
 for j in range(idx,jend):
  t,op,hi,lo,cl,_vol=bars[j]
  if t>=end:break
  if j>idx and t!=bars[j-1][0]+M5:return tr
  op*=scale;hi*=scale;lo*=scale;cl*=scale
  if stop is not None and ((lo<=stop or op<=stop) if sg==1 else (hi>=stop or op>=stop)):
   if t+M5>=end:return tr  # refuse same original EXIT race.
   fill=(min(op,stop) if sg==1 else max(op,stop))
   fill*=1-sg*plan["stop_slip_bps"]/10_000
   if not(fill>0):return tr
   reason="RESEARCH_"+plan["id"]+"_5M_STOP"
   result=dict(tr,exit_ts_ms=t+M5,exit_price=fill,exit_reason=reason,
    unit_price_return=sg*(fill/entry-1))
   EXT_OBS[plan["id"]]["preempted"]+=1
   EXT_OBS[plan["id"]]["by_outcome"]["original_win" if float(tr.get("unit_price_return") or 0)>0 else "original_loss"]+=1
   return result
  # Only completed M5 CLOSE contributes to the profit floor.
  if plan["axis"]=="profit_reversal":
   favor=sg*(cl/entry-1)
   peak=max(peak,favor)
   if peak>=plan["arm_close_pct"]:
    proposed=entry*(1+sg*plan["locked_profit_pct"])
    if stop is None:stop=proposed
    elif sg==1:stop=max(stop,proposed)
    else:stop=min(stop,proposed)
 return tr

def setup_for_runs():
 global R,P
 R,P=bootstrap()
 ensure_baseline(P)
 prev_factory=P.experiment_filter
 def cumulative_factory(base_filter,policy,obs):
  old=prev_factory(base_filter,policy,obs)
  specs=P.POLICIES[policy].get("cumulative_sequential_specs",[])
  def run(candidates,case):
   rows=old(candidates,case)
   for pl in specs:
    rows=[projected_exit(row,pl) if eligibility(row,pl) else row for row in rows]
   return rows
  return run
 P.base.wrapped_filter=cumulative_factory

def register(name,specs):
 if name in P.POLICIES and name!=SEED:raise RuntimeError("POLICY_ALREADY_REGISTERED")
 base=P.POLICIES[SEED]
 P.POLICIES[name]={**base,
  "sizes":dict(base["sizes"]),"symbols":set(base["symbols"]),
  "cumulative_sequential_specs":[dict(s) for s in specs]}

def portfolio_run(name,specs,cost):
 register(name,specs) if name not in P.POLICIES else None
 global EXT_OBS
 EXT_OBS={x["id"]:{"preempted":0,"by_outcome":{"original_win":0,"original_loss":0}} for x in specs}
 got=P.run(name,cost)
 report={
 "policy":name,"cost_bps":cost,
 "full8_final_jpy":got["final_jpy"],"full8_max_dd_pct":got["max_dd_pct"],
 "full8_pf":got["pf"],"win_pct":got["win_pct"],
 "closed_trades":got["annual_trades"],"accounting":got["accounting"],
 "scenario_specs":specs,"exit_audit":EXT_OBS,
 "model":"2026-10-17 latest8 M5 public historical normalized Aster, frozen V4 source",
 "research_only":True}
 (REPORT/f"SEQUENTIAL_{name}_{cost}BPS.json").write_text(
   json.dumps(report,indent=2,ensure_ascii=False)+"\n",encoding="utf8")
 if got["accounting"]!="PASS":raise AssertionError("FINANCIAL_ACCOUNTING_FAILED")
 return report

def better_than(new,control):
 return round(new["full8_max_dd_pct"],4)>round(control["full8_max_dd_pct"],4)
def run_stages(maxstages=2):
 setup_for_runs()
 REPORT.mkdir(parents=True,exist_ok=True)
 control=[]
 for c in (10,30):
  got=portfolio_run(SEED,[],c)
  target=ORIG[c]
  for k,z in [("full8_final_jpy","final_jpy"),("full8_max_dd_pct","max_dd_pct")]:
   if not math.isclose(got[k],target[z],rel_tol=5e-9,abs_tol=1e-4):raise AssertionError("LATEST_8LOGIC_ANCHOR_MISMATCH")
  control.append(got)
 print("FROZEN_8LOGIC_10_30_CONTROL_PASS",flush=True)
 cumulative=[]
 registry=[]
 for stage in BASE_STAGES[:maxstages]:
  trials=[]
  for c in stage["candidates"]:
   name=stage["stage"]+"_"+c["id"]
   steps=cumulative+[c]
   cc=[]
   for cost in (10,30):cc.append(portfolio_run(name,steps,cost))
   match=[control[z] for z in range(2)]
   inc10=round(cc[0]["full8_max_dd_pct"]-match[0]["full8_max_dd_pct"],5)
   inc30=round(cc[1]["full8_max_dd_pct"]-match[1]["full8_max_dd_pct"],5)
   trials.append({"candidate":c,"policy":name,"metrics":cc,
     "dd_delta_pctpoints":[inc10,inc30],
     "accept_dd":inc10>0.0001 and inc30>0.0001,
     "delta_assets_jpy":[cc[0]["full8_final_jpy"]-match[0]["full8_final_jpy"],
       cc[1]["full8_final_jpy"]-match[1]["full8_final_jpy"]]})
   print("STAGE_TRIAL",stage["stage"],c["id"],
      "DD10",cc[0]["full8_max_dd_pct"],"DD30",cc[1]["full8_max_dd_pct"],
      "DELTA",inc10,inc30,
      "JPY10",round(cc[0]["full8_final_jpy"]),flush=True)
  # Only candidates passing BOTH cost DD bounds may promote; select
  # highest min-DD-gain, tie with actual final JPY. Caution in-sample.
  winners=[x for x in trials if x["accept_dd"]]
  chosen=max(winners,key=lambda x:(min(x["dd_delta_pctpoints"]),x["delta_assets_jpy"][0])) if winners else None
  if chosen:
   cumulative.append(chosen["candidate"])
   control=chosen["metrics"]
  registry.append({"stage":stage["stage"],"side_scope":stage["scope"],
   "input_cumulative_ids":[x["id"] for x in cumulative[:-1] if chosen] if chosen else [x["id"] for x in cumulative],
   "trials":trials,
   "selected_research_candidate":chosen["candidate"]["id"] if chosen else None,
   "output_cumulative_ids":[x["id"] for x in cumulative],
   "post_selection_control":control})
  print("STAGE_DECISION",stage["stage"],"CUMULATIVE",",".join(x["id"] for x in cumulative) or "UNCHANGED",
   "SELECTED",chosen["candidate"]["id"] if chosen else "NONE_DD_BOTH_COSTS",flush=True)
  result={"status":"RESEARCH_ONLY_SELECTION_VALIDATION_PENDING",
   "source_8logic":"2026-10-17 5m + 8 strategies, frozen 2026-10-08 V12 V4",
   "selection":"both 10 and 30 bps maxDD strictly better, in-sample screening not LIVE",
   "latest_reference":ORIG,"stages":registry,
   "cumulative_research_adopted_specs":cumulative,
   "current_cumulative_control":control,
   "safety":"no LIVE changes / no submitted orders / profit-stop signed venue certification pending"}
  (REPORT/"SEQUENTIAL_FULL8_ACCEPTED_CHAIN_20261019.json").write_text(
      json.dumps(result,indent=2,ensure_ascii=False)+"\n",encoding="utf8")
 return registry

if __name__=="__main__":
 a=argparse.ArgumentParser()
 a.add_argument("--max-stages",type=int,default=2)
 n=a.parse_args()
 got=run_stages(n.max_stages)
 print("COMPLETE",len(got),flush=True)
