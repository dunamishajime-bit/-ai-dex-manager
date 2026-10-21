#!/usr/bin/env python3
"""Cumulative four user-accepted V12 V4 exits then Q102 experiments (8-logic BT).
Research model only. The four V4 rules are permanently locked across cases.
Uses the historical native allocator after market-price transformation.
SHARED short cooldown: only previous pass's ADMITTED actual initial stop fills.
DO NOT confuse this model with signed venue certification.
"""
from __future__ import annotations
import argparse,bisect,hashlib,importlib.util,json,math,sys
from pathlib import Path
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
import task9_initial_adverse_stop_20261020 as core
from task9_legacy_evidence_capture import install_legacy_capture
def load(alias, name):
 s=importlib.util.spec_from_file_location(alias,HERE/name)
 assert s and s.loader
 obj=importlib.util.module_from_spec(s);s.loader.exec_module(obj)
 return obj
frozen=load("frozen_causal_full8","run-task9-sourcebacked-5m-bt-20261021.py")
long=load("v4_long_complete","run-task9-v4-long-time37-profit-stop-20261021.py")
short=load("v4_short_two_axis","run-task9-v4-short-two-axis-20261021.py")
HOUR=core.HOUR;M5=core.M5
ROOT=Path(r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research")
PRIOR=ROOT/"2026-10-21_task9_full8_evidence_mtm_v3_independent"
OUT=ROOT/"2026-10-22_q102_prearm_family_exits_after_v4"
SOURCE_SHA="4081eb37fe23f884a4d1fa93e2b608e388bf7071"
LONGSTOP={"id":"LONG_TIME37_2P_ARM_MINUS5","strategy":"V12","sides":["LONG"],
 "mode":"layered_h1_and_m5_stop","routes":long.TIME_ROUTES,
 "mfe_gte":999.,"close_floor":.01,"bear_bars":2,"pre_arm_mfe":.02,"m5_floor":-.05}
LONGPROFIT={"id":"LONG_X3_3P_TO_1P_BEAR2","strategy":"V12","sides":["LONG"],
 "mode":"profit_h1","routes":long.old.ROUTES_X,"mfe_gte":.03,"close_floor":.01,"bear_bars":2}
SHORTPROFIT={"id":"SHORT_TIME37_5P_TO_2P_BULL2","strategy":"V12","sides":["SHORT"],
 "mode":"profit","mfe_gte":.05,"profit_floor":.02}
V4={"id":"V4_ACCEPTED_ALL4_20261021","strategy":"V12","sides":["LONG","SHORT"]}
Q102_CASES={
 "Q102_PROFIT_ARM2_FLOOR0P5":{"id":"Q102_PROFIT_ARM2_FLOOR0P5","strategy":"Q102","sides":["LONG","SHORT"],"kind":"profit_floor","arm":.02,"floor":.005},
 "Q102_INIT_2P5_6H_MFE0P5":{"id":"Q102_INIT_2P5_6H_MFE0P5","strategy":"Q102","sides":["LONG","SHORT"],"kind":"early_adverse","arm_hours":6,"stop_pct":.025,"mfe_gate_pct":.005,"reentry_hours":0},
 "Q102_INIT_2P5_12H_MFE1":{"id":"Q102_INIT_2P5_12H_MFE1","strategy":"Q102","sides":["LONG","SHORT"],"kind":"early_adverse","arm_hours":12,"stop_pct":.025,"mfe_gate_pct":.01,"reentry_hours":0},
 "Q102_MR_SHORT_INIT2P5_6H":{"id":"Q102_MR_SHORT_INIT2P5_6H","strategy":"Q102","sides":["SHORT"],"family":"MR","kind":"early_adverse","arm_hours":6,"stop_pct":.025,"mfe_gate_pct":.005,"reentry_hours":0},
 "Q102_HV_LONG_INIT2P5_6H":{"id":"Q102_HV_LONG_INIT2P5_6H","strategy":"Q102","sides":["LONG"],"family":"HIGH_VOL","kind":"early_adverse","arm_hours":6,"stop_pct":.025,"mfe_gate_pct":.005,"reentry_hours":0},
 "Q102_PB_LONG_INIT1P5_3H_MFE0P5":{"id":"Q102_PB_LONG_INIT1P5_3H_MFE0P5","strategy":"Q102","sides":["LONG"],"family":"PB","kind":"early_adverse","arm_hours":3,"stop_pct":.015,"mfe_gate_pct":.005,"reentry_hours":0},
 "Q102_PB_LONG_INIT2P0_6H_MFE0P5":{"id":"Q102_PB_LONG_INIT2P0_6H_MFE0P5","strategy":"Q102","sides":["LONG"],"family":"PB","kind":"early_adverse","arm_hours":6,"stop_pct":.02,"mfe_gate_pct":.005,"reentry_hours":0},
 "Q102_MR_SHORT_INIT2P5_12H_MFE1":{"id":"Q102_MR_SHORT_INIT2P5_12H_MFE1","strategy":"Q102","sides":["SHORT"],"family":"MR","kind":"early_adverse","arm_hours":12,"stop_pct":.025,"mfe_gate_pct":.01,"reentry_hours":0},
 "Q102_PROFIT_ARM3_FLOOR1":{"id":"Q102_PROFIT_ARM3_FLOOR1","strategy":"Q102","sides":["LONG","SHORT"],"kind":"profit_floor","arm":.03,"floor":.01},
 "Q102_PROFIT_ARM5_FLOOR2":{"id":"Q102_PROFIT_ARM5_FLOOR2","strategy":"Q102","sides":["LONG","SHORT"],"kind":"profit_floor","arm":.05,"floor":.02},
 "Q102_PROFIT_ARM4_FLOOR1P5":{"id":"Q102_PROFIT_ARM4_FLOOR1P5","strategy":"Q102","sides":["LONG","SHORT"],"kind":"profit_floor","arm":.04,"floor":.015},
 "Q102_MR_SHORT_PREARM4P0_H3":{"id":"Q102_MR_SHORT_PREARM4P0_H3","strategy":"Q102","sides":["SHORT"],"family":"MR","kind":"early_adverse","arm_hours":3,"stop_pct":.04,"mfe_gate_pct":.02,"reentry_hours":0},
 "Q102_HV_LONG_PREARM3P0_H3":{"id":"Q102_HV_LONG_PREARM3P0_H3","strategy":"Q102","sides":["LONG"],"family":"HIGH_VOL","kind":"early_adverse","arm_hours":3,"stop_pct":.03,"mfe_gate_pct":.02,"reentry_hours":0},
 "Q102_PB_LONG_PREARM3P0_H3":{"id":"Q102_PB_LONG_PREARM3P0_H3","strategy":"Q102","sides":["LONG"],"family":"PB","kind":"early_adverse","arm_hours":3,"stop_pct":.03,"mfe_gate_pct":.02,"reentry_hours":0},
 "Q102_FAMILY_PREARM3H_CAPPED6":{"id":"Q102_FAMILY_PREARM3H_CAPPED6","strategy":"Q102","sides":["LONG","SHORT"],"kind":"family_prearm_bundle"},
 "Q102_BOTH_PROFIT2_AND_INITIAL6H":{"id":"Q102_BOTH_PROFIT2_AND_INITIAL6H","strategy":"Q102","sides":["LONG","SHORT"],"kind":"q102_both","arm":.02,"floor":.005,"arm_hours":6,"stop_pct":.025,"mfe_gate_pct":.005,"reentry_hours":0}
}
CURRENT={}
ORIGINAL_APPLY=core._apply_initial_stop
ORIGINAL_MATCHES=core._matches
assert len(long.TIME_ROUTES)==37 and len(long.old.ROUTES_X)==3 and len(short.TIME_ROUTES)==37
assert short.INITIAL["reentry_hours"]==12

def q102_floor(row,rule,source,cost_bps,obs):
 if row.get("strategy_id")!="Q102" or row.get("side") not in ("LONG","SHORT"):return row
 entry=float(row["entry_price"]);st0=int(row["entry_ts_ms"]);en=int(row["exit_ts_ms"])
 if entry<=0 or en-st0<2*M5:return row
 bars,times=source.getdata(str(row["symbol"]))
 st=bisect.bisect_left(times,st0);ed=bisect.bisect_left(times,en)
 if st>=len(bars) or st>=ed or times[st]>st0+M5:obs["data_gap"]+=1;return row
 anchor=float(bars[st][1])
 if abs(anchor/entry-1)>.025:obs["entry_mismatch"]+=1;return row
 scale=entry/anchor;side=row["side"];peak=0.
 obs["eligible"]+=1
 for i in range(st,ed):
  ts,op,hi,lo,close,vol=bars[i]
  if i>st and ts-bars[i-1][0]!=M5:obs["internal_gap"]+=1;return row
  openpx=float(op)*scale;high=float(hi)*scale;low=float(lo)*scale
  if peak>=rule["arm"]:
   floor=entry*(1+rule["floor"] if side=="LONG" else 1-rule["floor"])
   trigger=(openpx<=floor or low<=floor) if side=="LONG" else (openpx>=floor or high>=floor)
   if trigger:
    raw_fill=min(openpx,floor) if side=="LONG" else max(openpx,floor)
    fill=raw_fill*(1-cost_bps/10000 if side=="LONG" else 1+cost_bps/10000)
    if ts+M5<en and fill>0:
     obs["triggered"]+=1;obs["by_reason"]["Q102_PROFIT_GUARD"]+=1
     return dict(row,exit_ts_ms=ts+M5,exit_price=fill,
      exit_reason="RESEARCH_Q102_PROFIT_ARM2_FLOOR0P5",
      unit_price_return=(fill/entry-1 if side=="LONG" else 1-fill/entry))
  favorable=(float(close)*scale/entry-1) if side=="LONG" else (1-float(close)*scale/entry)
  # Q102 approved contract arms ONLY on a fully completed M5 close.
  peak=max(peak,favorable)
 return row

def short_initial_exit(row,source,cost_bps,obs,original_row):
 return short.ORIGINAL_APPLY(row,short.INITIAL,source,cost_bps,obs,original_row=original_row)

PREARM_FAMILY_LIMITS={
 ("MR","SHORT"):.04,
 ("HIGH_VOL","LONG"):.03,
 ("PB","LONG"):.03,
 ("REV","SHORT"):.04,
 ("REV","LONG"):.03,
 ("PB","SHORT"):.03,
}
assert len(PREARM_FAMILY_LIMITS)==6

def apply(row,rule,source,cost_bps,obs,original_row=None):
 if not ORIGINAL_MATCHES(row,rule):return row
 if rule["id"]==V4["id"]:
  if row["side"]=="LONG":
   # +2% STOP at -5% across all TIME37 LONG; H1 +3->+1 only X09/X10/X14
   s=long.apply_layered(row,LONGSTOP,source,cost_bps,obs,original_row=original_row)
   h=long.apply_layered(row,LONGPROFIT,source,cost_bps,obs,original_row=original_row)
   return min((row,s,h),key=lambda x:int(x["exit_ts_ms"]))
  if row["side"]=="SHORT":
   i=short_initial_exit(row,source,cost_bps,obs,original_row=original_row)
   h=short.profit_exit(row,SHORTPROFIT,source,cost_bps,obs)
   return min((row,i,h),key=lambda x:int(x["exit_ts_ms"]))
  return row
 if row.get("strategy_id")=="Q102":
  if rule.get("family") and row.get("family")!=rule["family"]:return row
  mode=rule.get("kind")
  if mode=="profit_floor":return q102_floor(row,rule,source,cost_bps,obs)
  if mode=="family_prearm_bundle":
   pct=PREARM_FAMILY_LIMITS.get((str(row.get("family")),str(row.get("side"))))
   if pct is None:return row
   policy={"id":"Q102_FAMILY_PREARM_"+str(row.get("family"))+"_"+str(row.get("side")),
    "strategy":"Q102","sides":[str(row["side"])],"stop_pct":pct,
    "arm_hours":3,"mfe_gate_pct":.02,"reentry_hours":0}
   return ORIGINAL_APPLY(row,policy,source,cost_bps,obs,original_row=original_row)
  if mode=="early_adverse":return ORIGINAL_APPLY(row,rule,source,cost_bps,obs,original_row=original_row)
  if mode=="q102_both":
   first=ORIGINAL_APPLY(row,rule,source,cost_bps,obs,original_row=original_row)
   second=q102_floor(row,rule,source,cost_bps,obs)
   return min((row,first,second),key=lambda x:int(x["exit_ts_ms"]))
 return row

def readjsonl(path):
 return [json.loads(s) for s in Path(path).read_text("utf8").splitlines() if s.strip()]
def filtered_transform(rows,overlays,source,cost_bps,obs,baseline_lookup=None):
 after=frozen._preallocation_candidate_transform(rows,overlays,source,cost_bps,obs,baseline_lookup)
 if not CURRENT.get("cooldown_events"):return after
 result=[]
 for row in after:
  if row.get("strategy_id")=="V12" and row.get("side")=="SHORT":
   symbol=str(row["symbol"]);ts=int(row["entry_ts_ms"])
   blocked=any(sy==symbol and end<=ts<end+12*HOUR for sy,end,_ in CURRENT["cooldown_events"])
   if blocked:
    obs["reentry_rejected"]+=1
    obs["by_reason"]["ACCEPTED_SHORT_INITIAL_STOP_COOLDOWN"]+=1
    continue
  result.append(row)
 return result
def actual_cooldown_events(out):
 trades=readjsonl(out["ledger"])
 stopped=[row for row in trades if row.get("strategy_id")=="V12" and row.get("side")=="SHORT" and
  str(row.get("exit_reason_actual","")).startswith("RESEARCH_INITIAL_ADVERSE_STOP_"+short.INITIAL_ID)]
 return sorted(set((str(x["symbol"]),int(x["exit_ts_ms"]),str(x.get("candidate_id",""))) for x in stopped))
def summary(out,source_base,baseline_rows):
 trades=readjsonl(out["ledger"])
 exits={}
 for row in trades:
  reason=str(row.get("exit_reason_actual",""))
  if reason.startswith("RESEARCH_"):exits[reason]=exits.get(reason,0)+1
 bc={str(row.get("strategy_id"))+"_"+str(row.get("side")):0 for row in trades}
 for row in trades:
  key=str(row.get("strategy_id"))+"_"+str(row.get("side"));bc[key]+=1
 return {"finalEquityJpy":out["final_equity_jpy"],"maxMtmDdPct":out["maximum_mtm_drawdown_pct"],
  "profitFactor":out["profit_factor"],"winRate":out["win_rate"],"closedTrades":out["closed_trades"],
  "closedByStrategySide":bc,"exitReasons":exits,
  "ddImprovementVersusSourceBaselinePp":out["maximum_mtm_drawdown_pct"]-source_base["maxMtmDdPct"],
  "q102TradeCount":sum(x.get("strategy_id")=="Q102" for x in trades),"oos":out["oos"],
  "accounting":out["accounting"],"venueCertified":False}

def main():
 parser=argparse.ArgumentParser()
 parser.add_argument("--output",type=Path,default=OUT)
 parser.add_argument("--cases",nargs="*",default=["V4_LOCKED"]+list(Q102_CASES))
 parser.add_argument("--cooldown",action="store_true",help="iterative venue-like accepted-fill model, no fictitious proposal cooldown")
 args=parser.parse_args()
 names=["V4_LOCKED"]+list(Q102_CASES)
 if len(args.cases)!=len(set(args.cases)) or not set(args.cases).issubset(names):raise RuntimeError("INVALID_CASES")
 if args.output.resolve()==PRIOR.resolve() or HERE.parents[1].resolve() in args.output.resolve().parents:
  raise RuntimeError("REFUSE_OUTPUT_COLLISION")
 args.output.mkdir(parents=True,exist_ok=True)
 m=json.loads((PRIOR/"manifest.json").read_text("utf8"))
 assert m["dynamicBaseline8LogicExact"]
 core.OUTPUT=args.output;core.BOOTSTRAP_REDIRECT=args.output/"_legacy-bootstrap-cache"
 core._transform_rows=filtered_transform
 core._apply_initial_stop=apply;core._matches=ORIGINAL_MATCHES
 source,helper=core.task8.legacy.bootstrap()
 install_legacy_capture(helper)
 core.Path.write_text=core._path_write_text
 core.task8.legacy.ensure_baseline(helper)
 previous=helper.experiment_filter
 bases={}
 for c in (10,30):
  q=m["baseline"][str(c)]
  assert q["accounting"]=="PASS"
  bases[str(c)]={"finalEquityJpy":q["finalEquityJpy"],"maxMtmDdPct":q["maximumMtmDdPct"],
   "profitFactor":q["profitFactor"],"closedTrades":q["closedTrades"]}
 results={}
 for name in args.cases:
  overlays=[V4]+([Q102_CASES[name]] if name!="V4_LOCKED" else [])
  cases={}
  for cost in (10,30):
   CURRENT.clear()
   previous_events=None
   iterations=[]
   count=5 if args.cooldown else 1
   final=None
   for ix in range(count):
    if previous_events is not None:CURRENT["cooldown_events"]=previous_events
    run=core._run_engine("V4LOCKED_"+name+"_C"+str(cost)+"_I"+str(ix),
      "V12_LONG_COMPOSITE",overlays,cost,source,helper,previous)
    if run["accounting"]!="PASS":raise RuntimeError("ACCOUNTING_FAILED")
    ev=actual_cooldown_events(run)
    iterations.append({"iteration":ix,"observedAdmittedInitialShortStops":len(ev),
      "enforcedPriorCooldownEventCount":len(previous_events or []),
      "policyId":run["candidate"],"finalEquityJpy":run["final_equity_jpy"]})
    final=run
    if not args.cooldown:
     break
    if ev==previous_events:break
    if ix==count-1:
     print("NONCONVERGENT_SHORT_COOLDOWN",name,cost,flush=True)
     raise RuntimeError("FAIL_CLOSED_SHORT_COOLDOWN_NO_FIXED_POINT")
    previous_events=ev
   sm=summary(final,bases[str(cost)],None)
   sm["acceptedShortStopCooldownEvents"]=len(actual_cooldown_events(final))
   sm["cooldownPasses"]=iterations
   sm["cooldownModel"]="ADMITTED_FILL_FIXED_POINT" if args.cooldown else "NOT_REPLAYED"
   cases[str(cost)]=sm
   print("CASE",name,cost,"EQ",round(sm["finalEquityJpy"]),
    "DD",round(sm["maxMtmDdPct"],5),"PF",round(sm["profitFactor"],4),
    "TRADES",sm["closedTrades"],"STOP_EVENTS",sm["acceptedShortStopCooldownEvents"],
    "ITERATIONS",len(iterations),flush=True)
  results[name]={"rules":overlays,"costs":cases,"all4Locked":True}
  report={"status":"FOUR_V4_POLICIES_ACCEPTED_RESEARCH_BASELINE_NEXT_Q102",
    "frozenV4SourceHandoffSha":SOURCE_SHA,
    "baselineType":"FOUR_POLICIES_LOCKED_ACROSS_ALL_Q102_CASES",
    "period":"2025-08-10_to_2026-08-10","initialCapitalJpy":10000,
    "priorUntouchedBaseline":bases,
    "researchOnly":True,"currentProductionAndVenueUnverified":True,
    "nonVenueSignedCooldownModel":True,"sourceArchiveSha256":m["sourceArchive"]["archiveSha256"],
    "cooldownModel":"ACCEPTED_FILL_FIXED_POINT" if args.cooldown else "NOT_REPLAYED",
    "results":results}
  (args.output/"v4-locked-q102-cumulative-results.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n","utf8")
 print("COMPLETE",len(results),flush=True)
if __name__=="__main__":main()
