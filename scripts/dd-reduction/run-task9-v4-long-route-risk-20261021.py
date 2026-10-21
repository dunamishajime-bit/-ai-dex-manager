#!/usr/bin/env python3
"""Route-targeted V12 V4 LONG research, shared frozen full8 economic allocator.

Exploratory/POST_HOC, not LIVE: all candidate exit changes are applied before
the unified allocator chooses admissions and account sizes. No synthetic
cooldowns are inferred from candidate-only stops; signed venue fills absent.
"""
from __future__ import annotations
import argparse
import bisect
import hashlib
import importlib.util
import json
import math
import statistics
import sys
import time
from collections import Counter
from pathlib import Path

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
import task9_initial_adverse_stop_20261020 as core
from task9_legacy_evidence_capture import install_legacy_capture

spec=importlib.util.spec_from_file_location("v4route_original_frozen",HERE/"run-task9-sourcebacked-5m-bt-20261021.py")
assert spec and spec.loader
frozen=importlib.util.module_from_spec(spec)
spec.loader.exec_module(frozen)

ROOT=Path(r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research")
DEFAULT_PRIOR=ROOT/"2026-10-21_task9_full8_evidence_mtm_v3_independent"
DEFAULT_OUT=ROOT/"2026-10-21_v4_long_route_risk_analysis"
PERIOD="2025-08-10_to_2026-08-10"
TIME_ROUTES=("REC_X09_TIME_48H","REC_X10_TIME_48H","REC_X14_TIME_48H")
TIME_WEAK=("REC_X09_TIME_48H","REC_X14_TIME_48H")
REV_WEAK=("REC_Y04_REV_D2_T36","REC_Y13_REV_D2_T36","REC_Y17_REV_D1_T3")
RULES=[
 {"id":"X09_X14_INITIAL_2P5_H6","strategy":"V12","sides":["LONG"],"routes":list(TIME_WEAK),"stop_pct":.025,"arm_hours":6,"mfe_gate_pct":.005,"reentry_hours":0},
 {"id":"X09_X14_INITIAL_2P5_H6_S3","strategy":"V12","sides":["LONG"],"routes":list(TIME_WEAK),"stop_pct":.025,"arm_hours":6,"mfe_gate_pct":.005,"structure_bars":3,"structure_min_adverse_closes":2,"reentry_hours":0},
 {"id":"X09_X10_X14_INITIAL_3P0_H12_S3","strategy":"V12","sides":["LONG"],"routes":list(TIME_ROUTES),"stop_pct":.03,"arm_hours":12,"mfe_gate_pct":.01,"structure_bars":3,"structure_min_adverse_closes":2,"reentry_hours":0},
 {"id":"X09_X10_X14_INITIAL_2P5_H6_S3","strategy":"V12","sides":["LONG"],"routes":list(TIME_ROUTES),"stop_pct":.025,"arm_hours":6,"mfe_gate_pct":.005,"structure_bars":3,"structure_min_adverse_closes":2,"reentry_hours":0},
 {"id":"Y04_Y13_Y17_INITIAL_2P5_H6_S3","strategy":"V12","sides":["LONG"],"routes":list(REV_WEAK),"stop_pct":.025,"arm_hours":6,"mfe_gate_pct":.005,"structure_bars":3,"structure_min_adverse_closes":2,"reentry_hours":0},
 {"id":"X09_X14_PROFIT_3P0_FLOOR0P5_T2P0","strategy":"V12","sides":["LONG"],"routes":list(TIME_WEAK),"mode":"profit_guard","mfe_threshold":.03,"profit_floor":.005,"giveback_pct":.02,"arm_hours":1,"reentry_hours":0},
 {"id":"X09_X10_X14_PROFIT_4P0_FLOOR1P0_T2P5","strategy":"V12","sides":["LONG"],"routes":list(TIME_ROUTES),"mode":"profit_guard","mfe_threshold":.04,"profit_floor":.01,"giveback_pct":.025,"arm_hours":1,"reentry_hours":0},
 {"id":"X09_X14_DUAL_INITIAL_AND_PROFIT","strategy":"V12","sides":["LONG"],"routes":list(TIME_WEAK),"mode":"dual","stop_pct":.025,"arm_hours":6,"mfe_gate_pct":.005,"structure_bars":3,"structure_min_adverse_closes":2,"profit_threshold":.03,"profit_floor":.005,"giveback_pct":.02,"reentry_hours":0},
]
RULES_BY_ID={r["id"]:r for r in RULES}
ORIGINAL_MATCHES=core._matches
ORIGINAL_APPLY=core._apply_initial_stop

def route_matches(row:dict,overlay:dict)->bool:
    return ORIGINAL_MATCHES(row,overlay) and (not overlay.get("routes") or str(row.get("route")) in overlay["routes"])

def profit_exit(row:dict, overlay:dict, source, cost_bps:int, obs:dict,original_row=None)->dict:
    if not route_matches(row,overlay):return row
    entry=float(row["entry_price"]);entry_ts=int(row["entry_ts_ms"]);original_exit=int(row["exit_ts_ms"])
    if entry<=0 or original_exit<=entry_ts+core.M5:return row
    bars,times=source.getdata(str(row["symbol"]))
    start=bisect.bisect_left(times,entry_ts);end=bisect.bisect_left(times,original_exit)
    if start>=len(bars) or start>=end or times[start]>entry_ts+core.M5:
        obs["data_gap"]+=1;return row
    first_open=float(bars[start][1])
    if abs(first_open/entry-1)>0.025:
        obs["entry_mismatch"]+=1;return row
    scale=entry/first_open
    peak=0.0
    obs["eligible"]+=1
    for index in range(start,end):
        ts,op,hi,lo,close,_vol=bars[index]
        if index>start and ts-bars[index-1][0]!=core.M5:
            obs["internal_gap"]+=1
            return row
        op*=scale;hi*=scale;lo*=scale
        # Current bar high cannot arm a stop that triggers in this bar.
        if ts>=entry_ts+int(float(overlay.get("arm_hours",1))*core.HOUR):
            gate=float(overlay["mfe_threshold"])
            if peak>=gate:
                allowed_giveback=float(overlay["giveback_pct"])
                floor=float(overlay["profit_floor"])
                stop=entry*(1+max(floor,peak-allowed_giveback))
                if op<=stop or lo<=stop:
                    fill=min(op,stop)*(1-float(overlay.get("slip_bps",cost_bps))/10000.0)
                    exit_ts=ts+core.M5
                    if exit_ts<original_exit and fill>0:
                        obs["triggered"]+=1
                        obs["by_reason"]["PROFIT_GUARD"]+=1
                        prior=original_row or row
                        o=core.classify_pnl(prior)
                        name={"WIN":"original_winner_triggered","LOSS":"original_loser_triggered","UNSETTLED":"original_unsettled_triggered"}.get(o["status"])
                        if name:obs[name]+=1
                        actual=dict(row,exit_ts_ms=exit_ts,exit_price=fill,exit_reason="RESEARCH_V4_LONG_PROFIT_GUARD_"+overlay["id"],unit_price_return=fill/entry-1)
                        snapshot=dict(actual)
                        snapshot.pop("total_pnl_jpy",None);snapshot.pop("modeled_realized_pnl_jpy_at_exit_fx",None)
                        obs["stop_decisions"].append(core.build_exit_audit(prior,snapshot,overlay["id"]))
                        return actual
        # Peak of the bar is only eligible from the next closed M5 bar.
        peak=max(peak,hi/entry-1.0)
    return row

def route_apply(row,overlay,source,cost_bps,obs,original_row=None):
    if not route_matches(row,overlay):return row
    if overlay.get("mode")=="profit_guard":
        return profit_exit(row,overlay,source,cost_bps,obs,original_row=original_row)
    if overlay.get("mode")=="dual":
        standard={**overlay,"mode":"initial"}
        first=ORIGINAL_APPLY(row,standard,source,cost_bps,obs,original_row=original_row)
        guard={**overlay,"mode":"profit_guard","mfe_threshold":overlay["profit_threshold"]}
        # Both decisions must compete on original exit chronology, not sequential
        # lookahead; the earlier causal modeled exit wins.
        second=profit_exit(row,guard,source,cost_bps,obs,original_row=original_row)
        return min([row,first,second],key=lambda x:int(x["exit_ts_ms"]))
    return ORIGINAL_APPLY(row,overlay,source,cost_bps,obs,original_row=original_row)

def read_jsonl(p):
    return [json.loads(s) for s in p.read_text("utf8").splitlines() if s.strip()]

def ledger(root,cost):
    p=root/"engine"/"BASELINE"/"BASELINE"/f"{cost}bps"/"cases"/"V2_M150_D05_CORE_NATIVE"/"runs"/f"PRICE_MODEL_{cost}BPS"/"portfolio-trades.jsonl"
    if not p.is_file():raise FileNotFoundError(p)
    return p

def loss_metrics(trades):
    vals=[t for t in trades if t.get("strategy_id")=="V12" and t.get("side")=="LONG"]
    outcomes=[float(x["modeled_realized_pnl_jpy_at_exit_fx"]) for x in vals]
    losers=[v for v in outcomes if v<0]
    groups={}
    for route in sorted(set(t["route"] for t in vals)):
        rows=[t for t in vals if t["route"]==route]
        a=[float(t["modeled_realized_pnl_jpy_at_exit_fx"]) for t in rows]
        groups[route]={"n":len(rows),"wins":sum(v>0 for v in a),"losses":sum(v<0 for v in a),"netPnlJpy":sum(a),"avgLossJpy":statistics.fmean(v for v in a if v<0) if any(v<0 for v in a) else None}
    return {"trades":len(vals),"wins":sum(v>0 for v in outcomes),"losses":len(losers),"avgLossJpy":statistics.fmean(losers) if losers else None,"worstLossJpy":min(losers) if losers else None,"sumLossJpy":sum(losers),"netPnlJpy":sum(outcomes),"byRoute":groups}

def evaluate(out,baseline,source,bps):
    trades=read_jsonl(Path(out["ledger"]))
    original={r["candidate_id"]:r for r in baseline}
    v12=[r for r in trades if r["strategy_id"]=="V12" and r["side"]=="LONG"]
    exits=[r for r in v12 if str(r["exit_reason_actual"]).startswith("RESEARCH_")]
    damaged=[]
    rescued=[]
    for r in exits:
        orig=original.get(r["candidate_id"])
        if not orig:continue
        before=float(orig["modeled_realized_pnl_jpy_at_exit_fx"])
        after=float(r["modeled_realized_pnl_jpy_at_exit_fx"])
        if before>0:damaged.append(r["candidate_id"])
        if before<0 and after>before:rescued.append(r["candidate_id"])
    return {
     "finalEquityJpy":out["final_equity_jpy"],
     "maxMtmDdPct":out["maximum_mtm_drawdown_pct"],
     "profitFactor":out["profit_factor"],
     "closedTrades":out["closed_trades"],
     "oos":out["oos"],
     "ddImprovementPp":out["maximum_mtm_drawdown_pct"]-source["maxMtmDdPct"],
     "equityRetention":out["final_equity_jpy"]/source["finalEquityJpy"],
     "admittedV12LongStopExits":len(exits),
     "originalWinnersExitedEarly":len(damaged),
     "originalLosersImproved":len(rescued),
     "originalWinnerCandidateIds":damaged,
     "originalLoserCandidateIds":rescued,
     "longLossMetrics":loss_metrics(trades),
     "accounting":out["accounting"],
     "dataGaps":out["observations"].get("internal_gap",0),
     "researchOnly":True,
    }

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--output",type=Path,default=DEFAULT_OUT)
    ap.add_argument("--prior",type=Path,default=DEFAULT_PRIOR)
    ap.add_argument("--candidates",nargs="*",default=list(RULES_BY_ID))
    args=ap.parse_args()
    if len(args.candidates)!=len(set(args.candidates)) or set(args.candidates)-set(RULES_BY_ID):
        raise RuntimeError("UNKNOWN_DUPLICATE_CASE")
    if args.output.resolve()==args.prior.resolve() or (HERE.parents[1].resolve() in args.output.resolve().parents):
        raise RuntimeError("REFUSE_OVERWRITE_OR_GIT_OUTPUT")
    args.output.mkdir(parents=True,exist_ok=True)
    prior_manifest=json.loads((args.prior/"manifest.json").read_text("utf8"))
    if not prior_manifest.get("dynamicBaseline8LogicExact"):raise RuntimeError("SOURCE_BASELINE_NOT_EXACT")
    archive=frozen.data_inventory()
    if archive["archiveSha256"]!=prior_manifest["sourceArchive"]["archiveSha256"]:raise RuntimeError("SOURCE_ARCHIVE_DRIFT")
    core.OUTPUT=args.output
    core.BOOTSTRAP_REDIRECT=args.output/"_legacy-bootstrap-cache"
    core._transform_rows=frozen._preallocation_candidate_transform
    core._matches=route_matches
    core._apply_initial_stop=route_apply
    source,helper=core.task8.legacy.bootstrap()
    install_legacy_capture(helper)
    core.Path.write_text=core._path_write_text
    core.task8.legacy.ensure_baseline(helper)
    previous=helper.experiment_filter
    baseline={}
    baseline_rows={}
    for bps in (10,30):
        source_rows=read_jsonl(ledger(args.prior,bps))
        base=prior_manifest["baseline"][str(bps)]
        baseline[str(bps)]={
         "finalEquityJpy":base["finalEquityJpy"],
         "maxMtmDdPct":base["maximumMtmDdPct"],
         "profitFactor":base["profitFactor"],
         "closedTrades":base["closedTrades"],
         "longLossMetrics":loss_metrics(source_rows),
        }
        baseline_rows[str(bps)]=source_rows
    results={}
    for candidate in args.candidates:
        rule=RULES_BY_ID[candidate]
        print("BEGIN_CASE",candidate,flush=True)
        cases={}
        for bps in (10,30):
            policy=f"R_{candidate}_{bps}"
            out=core._run_engine(policy,"V12_LONG_COMPOSITE",[rule],bps,source,helper,previous)
            audit=evaluate(out,baseline_rows[str(bps)],baseline[str(bps)],bps)
            if audit["accounting"]!="PASS":raise RuntimeError("ECONOMIC_ACCOUNTING_FAIL")
            cases[str(bps)]=audit
            print("RESULT",candidate,bps,"DD",round(audit["maxMtmDdPct"],5),"DELTA",round(audit["ddImprovementPp"],5),"EQUITY",round(audit["finalEquityJpy"]),"LONG_STOPS",audit["admittedV12LongStopExits"],"AVGLOSS",round(audit["longLossMetrics"]["avgLossJpy"] or 0,1),flush=True)
        gate={
         "bothCostDDImproveAtLeast0p10pp": all(v["ddImprovementPp"]>=.1 for v in cases.values()),
         "bothCostEquityRetentionAtLeast75pct": all(v["equityRetention"]>=.75 for v in cases.values()),
         "bothAccountingPass":all(v["accounting"]=="PASS" for v in cases.values()),
         "profitFactorRetentionAtLeast90pct":all(v["profitFactor"]>=baseline[k]["profitFactor"]*.9 for k,v in cases.items()),
         "actualStopExitsBothCosts":all(v["admittedV12LongStopExits"]>0 for v in cases.values()),
        }
        gate["passesExploratoryGate"]=all(gate.values())
        results[candidate]={"rule":rule,"costs":cases,"gate":gate}
        (args.output/"v4-long-route-candidate-results.json").write_text(
            json.dumps({"status":"POST_HOC_EXPLORATORY_SOURCE_BACKED_PRICE_MODEL_ONLY","baseline":baseline,"results":results,"archiveSha256":archive["archiveSha256"],"period":PERIOD,"liveChanges":0},ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print("COMPLETE",len(results),flush=True)
if __name__=="__main__":
    main()
