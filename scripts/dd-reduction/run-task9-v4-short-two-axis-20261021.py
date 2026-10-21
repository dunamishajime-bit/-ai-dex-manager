#!/usr/bin/env python3
"""V12 V4 SHORT: initial adverse loss and recovered-profit protection, full8 model.
Research-only, historical M5 causal exits; no signed exchange orders or LIVE changes.
"""
from __future__ import annotations
import argparse,bisect,hashlib,importlib.util,json,math,sys
from pathlib import Path
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
import task9_initial_adverse_stop_20261020 as core
from task9_legacy_evidence_capture import install_legacy_capture
spec=importlib.util.spec_from_file_location("original_frozen",HERE/"run-task9-sourcebacked-5m-bt-20261021.py")
frozen=importlib.util.module_from_spec(spec);spec.loader.exec_module(frozen)
ROOT=Path(r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research")
DEFAULT_PRIOR=ROOT/"2026-10-21_task9_full8_evidence_mtm_v3_independent"
DEFAULT_OUT=ROOT/"2026-10-21_v4_short_profit_initial_8logic"
CATALOG=HERE.parents[1]/"docs/research/results/v12-v4-long-route-risk-20261021/V12_V4_LONG_FROZEN_TIME37_ROUTE_CATALOG_20261021.json"
TIME_ROUTES=frozenset(json.loads(CATALOG.read_text("utf8"))["routes"])
assert len(TIME_ROUTES)==37
HOUR=core.HOUR;M5=core.M5
INITIAL_ID="V12_SHORT_PCT2P5_12H_MFE1P0_R12"
INITIAL={
 "id":INITIAL_ID,"strategy":"V12","sides":["SHORT"],
 "stop_pct":.025,"arm_hours":12,"mfe_gate_pct":.01,"reentry_hours":12,
}
PARAMS=[
 ("SHORT_INIT_2P5_H12_MFE1_CD12","initial",0.,0.),
 ("SHORT_PROFIT_2P_TO_0P5_BULL2","profit",.02,.005),
 ("SHORT_PROFIT_3P_TO_1P_BULL2","profit",.03,.01),
 ("SHORT_PROFIT_5P_TO_2P_BULL2","profit",.05,.02),
 ("SHORT_BOTH_2P5_AND_2P_TO_0P5","combined",.02,.005),
 ("SHORT_BOTH_2P5_AND_3P_TO_1P","combined",.03,.01),
 ("SHORT_BOTH_2P5_AND_5P_TO_2P","combined",.05,.02),
]
RULES={name:{"id":name,"strategy":"V12","sides":["SHORT"],"mode":mode,
             "mfe_gte":mfe,"profit_floor":floor,"bearish_bars":2}
       for name,mode,mfe,floor in PARAMS}
# SHORT-specific: price rises on a reversal, so *bullish* H1 confirmation.
ORIGINAL_APPLY=core._apply_initial_stop
ORIGINAL_MATCHES=core._matches
def matches(row,rule):
 return ORIGINAL_MATCHES(row,rule)
def profit_exit(row,rule,source,cost,obs):
 if row.get("route") not in TIME_ROUTES or not matches(row,rule):return row
 entry=float(row["entry_price"]);st0=int(row["entry_ts_ms"]);en=int(row["exit_ts_ms"])
 if entry<=0 or en-st0<3*HOUR:return row
 bars,times=source.getdata(str(row["symbol"]))
 start=bisect.bisect_left(times,st0);end=bisect.bisect_left(times,en)
 if start>=len(bars) or start>=end or times[start]>st0+M5:
  obs["data_gap"]+=1;return row
 anchor=float(bars[start][1])
 if abs(anchor/entry-1)>.025:obs["entry_mismatch"]+=1;return row
 scale=entry/anchor;peak=0.;obs["eligible"]+=1
 for i in range(start,end):
  ts,op,hi,lo,close,vol=bars[i]
  if i>start and ts-bars[i-1][0]!=M5:
   obs["internal_gap"]+=1;return row
  # Decision at boundary ts uses only preceding CLOSED candles.
  # Three completed hourly closes are needed for 2-bar bullish reversal.
  if ts%HOUR==0 and ts>=st0+3*HOUR and i-start>=36:
   c0=float(bars[i-1][4])*scale
   c1=float(bars[i-13][4])*scale
   c2=float(bars[i-25][4])*scale
   if peak>=rule["mfe_gte"] and c0>=entry*(1-rule["profit_floor"]) and c0>c1>c2:
    fill=float(op)*scale*(1+cost/10000)
    if fill>0 and ts+M5<en:
     obs["triggered"]+=1;obs["by_reason"]["SHORT_PROFIT_CONFIRMED_BULL2"]+=1
     return dict(row,exit_ts_ms=ts+M5,exit_price=fill,
       exit_reason="RESEARCH_V4_SHORT_PROFIT_"+rule["id"],
       unit_price_return=1-fill/entry)
  # Favorable SHORT excursion is the LOW, not HIGH; no same-bar arm/exit.
  peak=max(peak,1-float(lo)*scale/entry)
 return row
def apply_exit(row,rule,source,cost,obs,original_row=None):
 if not matches(row,rule):return row
 mode=rule["mode"]
 if mode=="initial":
  return ORIGINAL_APPLY(row,INITIAL,source,cost,obs,original_row=original_row)
 if mode=="profit":return profit_exit(row,rule,source,cost,obs)
 if mode=="combined":
  # Evaluate both plans against ORIGINAL exit, then use earlier causal time.
  # The initial STOP identifier is frozen so the source-based accepted-fill
  # lifecycle can start 12h cooldown only if this STOP actually filled.
  initial=ORIGINAL_APPLY(row,INITIAL,source,cost,obs,original_row=original_row)
  profit=profit_exit(row,rule,source,cost,obs)
  return min((row,initial,profit),key=lambda x:int(x["exit_ts_ms"]))
 raise RuntimeError("UNKNOWN_SHORT_MODE")
def readjsonl(path):
 return [json.loads(line) for line in path.read_text("utf8").splitlines() if line.strip()]
def old_ledger(cost):
 return DEFAULT_PRIOR/"engine"/"BASELINE"/"BASELINE"/f"{cost}bps"/"cases"/"V2_M150_D05_CORE_NATIVE"/"runs"/f"PRICE_MODEL_{cost}BPS"/"portfolio-trades.jsonl"
def metrics(out,base_rows,base):
 trades=readjsonl(Path(out["ledger"]))
 old={str(r.get("candidate_id")):r for r in base_rows}
 short=[x for x in trades if x.get("strategy_id")=="V12" and x.get("side")=="SHORT"]
 changed=[x for x in short if str(x.get("exit_reason_actual","")).startswith(("RESEARCH_V4_SHORT_PROFIT_","RESEARCH_INITIAL_ADVERSE_STOP_"+INITIAL_ID))]
 rescued=[];cut=[];reasons={}
 for tr in changed:
  before=old.get(str(tr.get("candidate_id")))
  if not before:continue
  delta0=float(before["modeled_realized_pnl_jpy_at_exit_fx"])
  delta1=float(tr["modeled_realized_pnl_jpy_at_exit_fx"])
  if delta0<0 and delta1>delta0:rescued.append(tr["candidate_id"])
  if delta0>0 and delta1<delta0:cut.append(tr["candidate_id"])
  reason=str(tr["exit_reason_actual"])
  reasons[reason]=reasons.get(reason,0)+1
 dd=float(out["maximum_mtm_drawdown_pct"])
 return {
  "finalEquityJpy":out["final_equity_jpy"],
  "maxMtmDdPct":dd,"ddImprovementPp":dd-base["maxMtmDdPct"],
  "profitFactor":out["profit_factor"],
  "closedTrades":out["closed_trades"],"oos":out["oos"],
  "equityRetention":out["final_equity_jpy"]/base["finalEquityJpy"],
  "shortExitCount":len(changed),"exitReasons":reasons,
  "baselineLosersImproved":len(rescued),"baselineWinnersDamaged":len(cut),
  "baselineLoserIds":rescued[:20],"baselineWinnerIds":cut[:20],
  "accounting":out["accounting"],"priceModelOnly":True,
 }
def main():
 ap=argparse.ArgumentParser()
 ap.add_argument("--output",type=Path,default=DEFAULT_OUT)
 ap.add_argument("--candidates",nargs="*",default=list(RULES))
 args=ap.parse_args()
 if set(args.candidates)-set(RULES) or len(args.candidates)!=len(set(args.candidates)):raise RuntimeError("INVALID_CASES")
 if HERE.parents[1].resolve() in args.output.resolve().parents or args.output.resolve()==DEFAULT_PRIOR.resolve():
  raise RuntimeError("REFUSE_OUTPUT_COLLISION")
 args.output.mkdir(parents=True,exist_ok=True)
 manifest=json.loads((DEFAULT_PRIOR/"manifest.json").read_text("utf8"))
 assert manifest["dynamicBaseline8LogicExact"],"FROZEN_BASELINE_NOT_CERTIFIED"
 core.OUTPUT=args.output;core.BOOTSTRAP_REDIRECT=args.output/"_legacy-bootstrap-cache"
 core._transform_rows=frozen._preallocation_candidate_transform
 core._matches=matches;core._apply_initial_stop=apply_exit
 source,helper=core.task8.legacy.bootstrap()
 install_legacy_capture(helper)
 core.Path.write_text=core._path_write_text
 core.task8.legacy.ensure_baseline(helper)
 factory=helper.experiment_filter
 bases={};ledgers={}
 for cost in (10,30):
  b=manifest["baseline"][str(cost)]
  assert b["accounting"]=="PASS"
  bases[str(cost)]={"finalEquityJpy":b["finalEquityJpy"],
   "maxMtmDdPct":b["maximumMtmDdPct"],"profitFactor":b["profitFactor"],
   "closedTrades":b["closedTrades"]}
  ledgers[str(cost)]=readjsonl(old_ledger(cost))
 results={}
 for name in args.candidates:
  rows={}
  for cost in (10,30):
   run=core._run_engine(f"SHORT2AX_{name}_{cost}","V12_SHORT_COMPOSITE",
    [RULES[name]],cost,source,helper,factory)
   record=metrics(run,ledgers[str(cost)],bases[str(cost)])
   if record["accounting"]!="PASS":raise RuntimeError("ECONOMIC_ACCOUNTING_FAIL")
   rows[str(cost)]=record
   print("CASE",name,cost,"EQ",round(record["finalEquityJpy"]),
    "DD",round(record["maxMtmDdPct"],5),"DIFF",round(record["ddImprovementPp"],5),
    "EXITS",record["shortExitCount"],"SAVED",record["baselineLosersImproved"],
    "WINNERS_CUT",record["baselineWinnersDamaged"],flush=True)
  results[name]={"rule":RULES[name],"costs":rows,
   "bothCostsDdImproved":all(a["ddImprovementPp"]>=.1 for a in rows.values())}
  (args.output/"v4-short-two-axis-results.json").write_text(
   json.dumps({"status":"RESEARCH_ONLY_NATIVE_ECONOMIC_CORE_SOURCE_MODEL","baseline":bases,
    "results":results,"sourceArchiveSha256":manifest["sourceArchive"]["archiveSha256"],
    "signedVenueCertified":False,"currentTsDynamicReplayParity":False,
    "productionChanges":0},ensure_ascii=False,indent=2)+"\n",encoding="utf8")
 print("DONE",len(results),flush=True)
if __name__=="__main__":main()
