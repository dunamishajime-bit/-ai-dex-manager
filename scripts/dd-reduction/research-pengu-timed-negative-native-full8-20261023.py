#!/usr/bin/env python3
"""Research-only AVAX initial-adverse-stop trials: keep DOGE veto, dual AVAX entry veto,
6h plus armed-3%/giveback-1.5% exit, and all other strategies unchanged.
No LIVE, venue, or production writes. Dynamic full8 wallet and cooldown re-selection.
"""
from __future__ import annotations
import argparse,bisect,collections,hashlib,importlib.util,json
from pathlib import Path
HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
ROOT=Path(r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/2026-10-22_hype_entry_plus_exit_full8")
DOC=REPO/"docs/research/results/residual-composite-20261023"
def load(name,path):
 spec=importlib.util.spec_from_file_location(name,path)
 assert spec and spec.loader
 mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
 return mod
reference=load("avax_initial_after_dual_entry_reference",HERE/"research-residual-avax-composite-entry-veto-full8-20261023.py")
native=reference.native
screen=reference.original_screen
STOCK=reference.STOCK
REFERENCE=DOC/"RESIDUAL_AVAX_WATCH35_HARD5_NATIVE_FULL8_20261023.json"
EXIT_COMBO="COMBO_TIME6_TRAIL3_GIVE1P5"
hedge=load("avax_risk35_hard5_policy",HERE/"research-residual-avax-risk35-hard5-policy-20261023.py")
policy=load("pengu_timed_negative_policy",HERE/"research-pengu-timed-negative-screen-20261023.py")
CASES={
 "BASE":None,
 "AT3_MINUS2P5_ALL":{"mode":"AT_HOURS","holdHours":3,"lossPct":2.5,"maxMfePct":None,"scope":"ALL"},
 "AT8_MINUS4_ALL":{"mode":"AT_HOURS","holdHours":8,"lossPct":4.0,"maxMfePct":None,"scope":"ALL"},
 "H1X2_MINUS3_ALL":{"mode":"SUSTAINED_H1","holdHours":2,"lossPct":3.0,"maxMfePct":None,"scope":"ALL"},
 "H1X3_MINUS3_ALL":{"mode":"SUSTAINED_H1","holdHours":3,"lossPct":3.0,"maxMfePct":None,"scope":"ALL"},
 "H1X3_MINUS4_ALL":{"mode":"SUSTAINED_H1","holdHours":3,"lossPct":4.0,"maxMfePct":None,"scope":"ALL"},
 "H1X4_MINUS4_ALL":{"mode":"SUSTAINED_H1","holdHours":4,"lossPct":4.0,"maxMfePct":None,"scope":"ALL"},
 "AT8_MINUS4_SHORT":{"mode":"AT_HOURS","holdHours":8,"lossPct":4.0,"maxMfePct":None,"scope":"SHORT"},
 "AT8_MINUS4_BASE_LONG":{"mode":"AT_HOURS","holdHours":8,"lossPct":4.0,"maxMfePct":None,"scope":"BASE_LONG"},
 "AT8_MINUS4_RECOVERY":{"mode":"AT_HOURS","holdHours":8,"lossPct":4.0,"maxMfePct":None,"scope":"RECOVERY"},
 "H1X3_MINUS3_SHORT":{"mode":"SUSTAINED_H1","holdHours":3,"lossPct":3.0,"maxMfePct":None,"scope":"SHORT"},
 "H1X3_MINUS3_RECOVERY":{"mode":"SUSTAINED_H1","holdHours":3,"lossPct":3.0,"maxMfePct":None,"scope":"RECOVERY"},
 "H1X3_MINUS4_MFE1_ALL":{"mode":"SUSTAINED_H1","holdHours":3,"lossPct":4.0,"maxMfePct":1.0,"scope":"ALL"},
 "H1X2_MINUS3_BASE_LONG":{"mode":"SUSTAINED_H1","holdHours":2,"lossPct":3.0,"maxMfePct":None,"scope":"BASE_LONG"},
 "H1X2_MINUS3_SHORT":{"mode":"SUSTAINED_H1","holdHours":2,"lossPct":3.0,"maxMfePct":None,"scope":"SHORT"},
 "H1X2_MINUS3_RECOVERY":{"mode":"SUSTAINED_H1","holdHours":2,"lossPct":3.0,"maxMfePct":None,"scope":"RECOVERY"},
 "H1X3_MINUS4_BASE_LONG":{"mode":"SUSTAINED_H1","holdHours":3,"lossPct":4.0,"maxMfePct":None,"scope":"BASE_LONG"},
 "H1X2_MINUS4_BASE_LONG":{"mode":"SUSTAINED_H1","holdHours":2,"lossPct":4.0,"maxMfePct":None,"scope":"BASE_LONG"},
 "AT3_MINUS2P5_SHORT":{"mode":"AT_HOURS","holdHours":3,"lossPct":2.5,"maxMfePct":None,"scope":"SHORT"},
 "SHORT_AT3_MINUS2P5_OR_AT8_MINUS4":{"mode":"MULTI_CHECKPOINT","scope":"SHORT","checks":[
  {"mode":"AT_HOURS","holdHours":3,"lossPct":2.5,"maxMfePct":None,"scope":"SHORT"},
  {"mode":"AT_HOURS","holdHours":8,"lossPct":4.0,"maxMfePct":None,"scope":"SHORT"}
 ]},
}

def sha(path):
 h=hashlib.sha256()
 with Path(path).open("rb") as f:
  for b in iter(lambda:f.read(1<<20),b""):h.update(b)
 return h.hexdigest()
def main():
 pa=argparse.ArgumentParser()
 pa.add_argument("--output",required=True,type=Path)
 pa.add_argument("--cases",nargs="+",default=list(CASES))
 args=pa.parse_args()
 assert args.cases and len(set(args.cases))==len(args.cases) and set(args.cases)<=set(CASES)
 assert REPO not in (args.output.resolve(),*args.output.resolve().parents)
 meta=json.loads((STOCK/"scenario-manifest.json").read_text("utf8"))
 assert meta["caseTape99Sha256"]==sha(STOCK/"v52-model-ledger.jsonl")
 anchor=json.loads(REFERENCE.read_text("utf8"))["cases"]["WATCH35_2H_PLUS_HARD5"]["costs"]
 native.m.acquire_verified_h1()
 args.output.mkdir(parents=True,exist_ok=True)
 core=native.m.m.core
 core.OUTPUT=args.output
 core.BOOTSTRAP_REDIRECT=args.output/"_legacy-bootstrap-cache"
 original_filter=native.m.m.entry_filter
 original_apply=native.m.p.apply
 original_run=core._run_engine
 original_writer=original_run.__globals__["_path_write_text"]
 def safe_research_writer(self,data,*pos,**kw):
  if args.output.name in self.parts:self.parent.mkdir(parents=True,exist_ok=True)
  return original_writer(self,data,*pos,**kw)
 original_run.__globals__["_ensure_research_output_parent_write_text"]=safe_research_writer
 fcache={};current="BASE"
 def candidate_filter(rows,overlays,source,cost_bps,obs,baseline_lookup=None):
  transformed=original_filter(rows,overlays,source,cost_bps,obs,baseline_lookup)
  out=[]
  for row in transformed:
   if row.get("strategy_id")=="PENGU" and current!="BASE":
    settings=CASES[current]
    if policy.eligible(row,settings):
     ts=row.get("entry_ts_ms")
     assert ts is not None,("PENGU_MISSING_ENTRY_TIMESTAMP",row.get("candidate_id"))
     candidate=policy.find_time_stop(row,source,settings,stats=obs.setdefault("penguM5DataQuality",collections.Counter()))
     if candidate is not None:
      assert int(row["entry_ts_ms"])<candidate["ts"]<int(row["exit_ts_ms"])
      orig=dict(row)
      sign=1 if row["side"]=="LONG" else -1
      row=dict(row,exit_ts_ms=int(candidate["ts"]),exit_price=float(candidate["fill"]),
        unit_price_return=sign*(float(candidate["fill"])/float(row["entry_price"])-1),
        exit_reason="RESEARCH_PENGU_TIMED_NEGATIVE_"+current+"_"+row["side"],
        timed_underwater_original_exit=int(orig["exit_ts_ms"]))
      obs["penguTimeStopCandidates"]=obs.get("penguTimeStopCandidates",0)+1
      obs.setdefault("penguTimeStopAudit",[]).append({"candidateId":orig.get("candidate_id"),
         "entryTsMs":ts,"originalExitTs":orig["exit_ts_ms"],
         "softExitTs":candidate["ts"],"side":orig["side"],"route":orig.get("entry_version"),
         "stopPct":candidate["modeledExitReturnPct"],"mfePct":candidate["mfeAtStopPct"],
         "anchorGapPct":candidate["modelAnchorGapPct"]})
   if row.get("strategy_id")!="RESIDUAL":
    out.append(row);continue
   if row.get("symbol")=="DOGEUSDT":
    obs["no_doge_rejected"]=obs.get("no_doge_rejected",0)+1
    continue
   if row.get("symbol")!="AVAXUSDT" or row.get("side")!="LONG":
    out.append(row);continue
   ts=row.get("entry_ts_ms")
   assert ts is not None,("AVAX_MISSING_ENTRY_TS",row.get("candidate_id"))
   avax=reference.get_feature(source,"AVAXUSDT",ts,fcache)
   btc=reference.get_feature(source,"BTCUSDT",ts,fcache)
   assert avax is not None and btc is not None,("AVAX_MISSING_CAUSAL_M5",row.get("candidate_id"),ts)
   veto=reference.reason("DUAL",avax,btc)
   if veto:
    obs["avaxGateRemoved"]=obs.get("avaxGateRemoved",0)+1
    obs.setdefault("avaxGateEvidence",[]).append({"candidateId":row.get("candidate_id"),
      "entryTsMs":ts,"reason":veto,"AVAX1h":avax["ret1h"],"AVAX3h":avax["ret3h"],
      "AVAX6h":avax["ret6h"],"BTC3h":btc["ret3h"],"BTC6h":btc["ret6h"]})
    continue
   out.append(row)
  return out
 def apply_exit(row,rule,source,cost_bps,obs,original_row=None):
  if rule.get("kind")!="residual_avax_exit_after_no_doge_20261023":
   return original_apply(row,rule,source,cost_bps,obs,original_row=original_row)
  if row.get("strategy_id")!="RESIDUAL" or row.get("symbol")!="AVAXUSDT" or row.get("side")!="LONG":
   return row
  audit=obs.setdefault("avaxDataQuality",collections.Counter())
  combo=screen._find_exit(row,EXIT_COMBO,source,audit)
  selected=combo;label="RESEARCH_AVAX_"+EXIT_COMBO
  settings={"watch":True,"hard":True}
  if settings["watch"] or settings["hard"]:
   candidate=hedge.find_risk_exit(row,source,audit,
     enable_watch=settings["watch"],enable_hard=settings["hard"])
   if candidate is not None and (selected is None or candidate["ts"]<=selected["ts"]):
    selected=candidate
    label="RESEARCH_AVAX_RISK_HEDGE_"+candidate["trigger"]
  if selected is None:return row
  assert int(row["entry_ts_ms"])<selected["ts"]<int(row["exit_ts_ms"])
  updated=dict(row,exit_ts_ms=int(selected["ts"]),exit_price=float(selected["fill"]),
     exit_reason=label,unit_price_return=float(selected["fill"])/float(row["entry_price"])-1)
  obs["by_reason"][label]+=1
  obs["avaxExitModified"]=obs.get("avaxExitModified",0)+1
  if label.startswith("RESEARCH_AVAX_RISK_HEDGE_"):
   obs.setdefault("avaxRiskHedgeAudit",[]).append({"entryTsMs":row["entry_ts_ms"],
     "oldExitTs":row["exit_ts_ms"],"newExitTs":selected["ts"],"oldExitPrice":row["exit_price"],
     "newExitPrice":selected["fill"],"trigger":selected["trigger"],
     "firstTouchTsMs":selected["touchTsMs"],"deadlineTsMs":selected["watchDeadlineMs"],
     "lowestBarPct":selected["lowRetPct"],"simulatedFillPct":selected["fillRetPct"]})
  return updated
 def run_overlay(name,phase,overlays,cost,source,helper,previous_factory,baseline_lookup=None):
  compound_overlay=reference.prior.overlay(EXIT_COMBO)
  xname=name+"_AVAX_ENTRY_"+("WATCH35_2H_PLUS_HARD5" if current=="BASE" else "PENGU_SOFTSTOP_"+current)
  namespace="cmp_"+hashlib.sha256(xname.encode("utf8")).hexdigest()[:12]
  target=(args.output/"engine"/namespace/namespace/(str(cost)+"bps")/
     "cases"/"V2_M150_D05_CORE_NATIVE"/"runs"/("PRICE_MODEL_"+str(cost)+"BPS"))
  target.mkdir(parents=True,exist_ok=True)
  original_run.__globals__["OUTPUT"]=args.output
  return original_run(xname,phase,[*overlays,*compound_overlay],cost,source,helper,previous_factory,
     baseline_lookup=baseline_lookup)
 core._transform_rows=candidate_filter
 core._apply_initial_stop=apply_exit
 core._matches=native.m.m.idle.matches
 core._run_engine=run_overlay
 source,helper=core.task8.legacy.bootstrap()
 native.m.m.base.install_legacy_capture(helper)
 core.Path.write_text=core._path_write_text
 core.task8.legacy.ensure_baseline(helper)
 previous=helper.experiment_filter
 results={"status":"RESEARCH_ONLY_PENGU_TIMED_NEGATIVE_EXIT_AFTER_ADOPTED_AVAX_NATIVE_FULL8_NOT_LIVE",
  "referenceSha":sha(REFERENCE),"reference":"RESIDUAL_AVAX_WATCH35_HARD5_NATIVE_FULL8_20261023.json",
  "scope":"Only PENGU time-underwater exits; existing hard STOP and AVAX six adopted rules preserved.",
  "exitBaseline":EXIT_COMBO,"costsBps":[10,30],"penguTimedStopCases":CASES,"cases":{},
  "limitations":["-5% historical STOP uses M5 low and floor/worse opening gap; immediate LIVE STOP requires verified native venue protective order",
    "Already explored 2025-08-10..2026-08-10 in-sample window, only 18 AVAX DUAL entries at baseline",
    "STOP on confirmed M5 close and next M5 open; intrabar under-water path may be worse",
    "Frozen V52 selected tape lacks 11 originally suppressed candidates and unrealized new raw signals",
    "No LIVE Production SHA parity or real venue order book, margin/funding/slippage parity"]}
 for case in args.cases:
  current=case
  for cost in (10,30):
   # Identical name on BASE_DUAL preserves prior veto DUAL ledger SHA for exact anchor.
   source_name="AVAX_COMBO_ENTRY_GATES_"+("WATCH35_2H_PLUS_HARD5" if case=="BASE" else "PENGU_SOFTSTOP_"+case)
   r,passes=native.replay(source_name,cost,source,helper,previous,STOCK)
   assert r["accounting"]=="PASS"
   trade=native.m.jsonl(r["ledger"])
   residual=[z for z in trade if z["strategy_id"]=="RESIDUAL"]
   avax=[z for z in residual if z["symbol"]=="AVAXUSDT"]
   assert all(z["symbol"]!="DOGEUSDT" for z in residual)
   early=[z for z in avax if str(z.get("exit_reason_actual") or z.get("exit_reason") or "").startswith("RESEARCH_AVAX_RISK_HEDGE_")]
   hard=[z for z in early if "HARD_MINUS5_ANY_TOUCH" in str(z.get("exit_reason_actual") or z.get("exit_reason"))]
   soft=[z for z in early if "SOFT_MINUS3P5_WATCH2H" in str(z.get("exit_reason_actual") or z.get("exit_reason"))]
   assert len(hard)+len(soft)==len(early)
   pengu=[z for z in trade if z["strategy_id"]=="PENGU"]
   pstop=[z for z in pengu if "RESEARCH_PENGU_TIMED_NEGATIVE_" in str(z.get("exit_reason_actual") or z.get("exit_reason") or "")]
   pstop_short=[z for z in pstop if z.get("side")=="SHORT"]
   pstop_recovery=[z for z in pstop if z.get("entry_version")=="RECOVERY_V8"]
   old=anchor[str(cost)]
   info={"costBps":cost,"finalEquityJpy":r["final_equity_jpy"],
    "deltaVsDualJpy":r["final_equity_jpy"]-old["finalEquityJpy"],
    "portfolioPF":r["profit_factor"],"ddPct":r["maximum_mtm_drawdown_pct"],
    "ddDeltaVsDualPctPoints":r["maximum_mtm_drawdown_pct"]-old["ddPct"],
    "closedTrades":r["closed_trades"],"deltaTradesVsDual":r["closed_trades"]-old["closedTrades"],
    "totalWinners":sum(float(z["total_pnl_jpy"])>0 for z in trade),
    "avaxCount":len(avax),"avaxWins":sum(float(z["total_pnl_jpy"])>0 for z in avax),
    "avaxModeledPnLJpy":sum(float(z["modeled_realized_pnl_jpy_at_exit_fx"]) for z in avax),
    "initialStopCount":len(early),"hard5Count":len(hard),"watch35Count":len(soft),
    "initialStopTimes":[z["entry_ts_ms"] for z in early],
    "penguN":len(pengu),"penguWins":sum(float(z["total_pnl_jpy"])>0 for z in pengu),
    "penguLongN":sum(z["side"]=="LONG" for z in pengu),
    "penguLongWins":sum(z["side"]=="LONG" and float(z["total_pnl_jpy"])>0 for z in pengu),
    "penguShortN":sum(z["side"]=="SHORT" for z in pengu),
    "penguShortWins":sum(z["side"]=="SHORT" and float(z["total_pnl_jpy"])>0 for z in pengu),
    "penguModeledPnLJpy":sum(float(z["modeled_realized_pnl_jpy_at_exit_fx"]) for z in pengu),
    "penguTimedStops":len(pstop),"penguTimedShortStops":len(pstop_short),
    "penguTimedRecoveryStops":len(pstop_recovery),
    "penguTimedStopEntries":[{"entryTsMs":z["entry_ts_ms"],"side":z["side"],"route":z.get("entry_version"),
      "exitTsMs":z["exit_ts_ms"],"reason":z["exit_reason_actual"]} for z in pstop],
    "byStrategy":dict(collections.Counter(z["strategy_id"] for z in trade)),
    "ledgerSha256":sha(r["ledger"]),"reselectionPasses":len(passes),"accounting":r["accounting"]}
   assert len(passes)==3,("RESELECTION_COUNT",case,cost,len(passes))
   assert sum(info["byStrategy"].values())==info["closedTrades"]
   if case=="BASE":
    assert abs(info["deltaVsDualJpy"])<.02
    assert abs(info["ddDeltaVsDualPctPoints"])<1e-8
    assert info["closedTrades"]==old["closedTrades"]
    assert info["ledgerSha256"]==old["ledgerSha256"],("BASELINE_LEDGER_NOT_IDENTICAL",cost)
    assert info["initialStopCount"]==0
   results["cases"].setdefault(case,{"timeStopRule":CASES[case],"costs":{}})["costs"][str(cost)]=info
   output=args.output/"PENGU_TIMED_NEGATIVE_NATIVE_FULL8_20261023.json"
   output.write_text(json.dumps(results,ensure_ascii=False,indent=2)+"\n",encoding="utf8",newline="\n")
   print("PENGU_TIMED_NEGATIVE_NATIVE_FULL8",case,cost,"FINAL",round(info["finalEquityJpy"]),
    "GAIN",round(info["deltaVsDualJpy"]),"DD",round(info["ddPct"],5),
    "N",info["closedTrades"],"WR",round(100*info["totalWinners"]/info["closedTrades"],3),
    "AVAX",info["avaxCount"],"AVAX_WINS",info["avaxWins"],"PENGU_STOPS",info["penguTimedStops"],
    "RISK_STOPS",info["initialStopCount"],"HARD5",info["hard5Count"],"WATCH35",info["watch35Count"],"PF",round(info["portfolioPF"],4),flush=True)
 print("PENGU_TIMED_NEGATIVE_NATIVE_FULL8_COMPLETE",len(results["cases"]))
if __name__=="__main__":main()
