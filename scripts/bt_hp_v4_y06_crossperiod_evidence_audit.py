#!/usr/bin/env python3
"""V4 REC_Y06 archived pretarget/forward robustness audit (research only).

Audit native STOP-preserving time/lock candidates, route-level online skip
and target BT modeled fills. Does not pick target-year thresholds.
"""
from __future__ import annotations
import argparse,csv,hashlib,json,math
from collections import Counter,defaultdict
from pathlib import Path

ROUTE="REC_Y06_REV_D0_T72";START="2025-10-01T00:00:00Z";END="2026-10-01T00:00:00Z"
SPLITS={"train":123,"validation":55,"prehold":14,"forward":20}
def sha(p:Path)->str:return hashlib.sha256(p.read_bytes()).hexdigest()
def read(p:Path)->dict:return json.loads(p.read_text("utf-8-sig"))
def near(a,b)->bool:return math.isclose(float(a),float(b),rel_tol=1e-9,abs_tol=1e-9)
def check_grid(doc:dict,expected_status:str,expected_n:int)->dict:
    if doc.get("status")!=expected_status or doc.get("route")!=ROUTE:
        raise ValueError("V4_Y06_RESEARCH_GRID_SOURCE_IDENTITY_DRIFT")
    if doc.get("counts")!=SPLITS or doc.get("robustN")!=0 or doc.get("selected") is not None:
        raise ValueError("V4_Y06_PRETARGET_FORWARD_NO_SELECTION_CONTRACT_DRIFT")
    if "target-year" not in doc.get("method",""):
        raise ValueError("V4_Y06_TARGET_YEAR_SELECTION_SAFEGUARD_UNKNOWN")
    grid=doc.get("grid",[])
    if len(grid)!=expected_n:raise ValueError("V4_Y06_GRID_ROW_COUNT_DRIFT")
    seen=set();summaries=[]
    for item in grid:
        param=item.get("hours") if expected_status.startswith("V4_Y06_HORIZON") else (item.get("trigger"),item.get("floor"))
        if param in seen:raise ValueError("V4_Y06_DUPLICATE_GRID_PARAMS")
        seen.add(param)
        if item.get("robust") is not False or item.get("trainQualified") is not False:
            raise ValueError("V4_Y06_UNSUPPORTED_ROBUST_CANDIDATE")
        deltas={}
        for name,n in SPLITS.items():
            record=item.get(name)
            if not record or int(record["native"]["n"])!=n or int(record["candidate"]["n"])!=n:
                raise ValueError("V4_Y06_SPLIT_MEMBER_COUNT_DRIFT")
            for part in ("native","candidate"):
                x=record[part]
                if not near(x["sum"],x["mean"]*n) or not 0<=x["wr"]<=1:
                    raise ValueError("V4_Y06_METRICS_ARITHMETIC_INVALID")
            if not near(record["deltaSum"],record["candidate"]["sum"]-record["native"]["sum"]):
                raise ValueError("V4_Y06_DELTA_ARITHMETIC_DRIFT")
            deltas[name]=record["deltaSum"]
        summaries.append({"parameter":param,"deltaSumBySplit":deltas,
            "trainQualified":False,"robust":False})
    return {"status":expected_status,"gridSize":len(summaries),
            "nativeSourcePretargetCounts":SPLITS,"adoptedCandidates":0,
            "noTargetYearParamSelection":True,"summaries":summaries}
def check_online(online:dict)->dict:
    if online.get("status")!="RESEARCH_ONLY" or online.get("policies_count")!=65:
        raise ValueError("V4_Y06_ONLINE_SHADOW_SOURCE_UNRECOGNIZED")
    if online.get("positive_train_validation")!=0 or online.get("top_trainval")!=[]:
        raise ValueError("V4_Y06_ONLINE_POLICY_NOT_PRETARGET_ROBUST")
    if len(online.get("all_policies",[]))!=65:
        raise ValueError("V4_Y06_ONLINE_POLICY_COUNT_MISMATCH")
    if "exitTs<=current entryTs" not in online.get("method",""):
        raise ValueError("V4_Y06_CAUSAL_EXIT_HISTORY_CONTRACT_UNKNOWN")
    return {"status":"NO_TRAIN_VALIDATION_POSITIVE_ONLINE_SKIP_POLICY",
      "exploredPolicies":65,"passedTrainAndValidation":0,
      "sourceEconomicScope":"route-only, not full integrated gross"}
def modeled_fills(file:Path,bps:int)->dict:
    if bps not in (10,30):raise ValueError("UNKNOWN_FEE_MODEL")
    seen=set();selected=[]
    with file.open(encoding="utf-8-sig",newline="") as f:
      reader=csv.DictReader(f)
      required={"trade_id","strategy","route","symbol","side","entry_utc","exit_utc",
                "net_pnl_jpy","actual_venue_order_id","actual_filled_quantity",
                "signed_execution_verified","model_entry_price","model_exit_price"}
      if not reader.fieldnames or not required.issubset(reader.fieldnames):
          raise ValueError("Y06_FILL_COLUMNS_MISSING")
      for r in reader:
        tid=r["trade_id"]
        if not tid or tid in seen:raise ValueError("DUPLICATE_RESEARCH_FILL")
        seen.add(tid)
        if r["strategy"]!="V4" or r["route"]!=ROUTE:continue
        if r["side"]!="SHORT" or r["symbol"][-4:]!="USDT":
            raise ValueError("Y06_FIXED_SHORT_SOURCE_DRIFT")
        if not START<=r["entry_utc"]<r["exit_utc"]<=END:
            raise ValueError("Y06_MODEL_FILL_OUTSIDE_TARGET_PERIOD")
        if r["actual_venue_order_id"] or r["actual_filled_quantity"] or r["signed_execution_verified"]!="False":
            raise ValueError("Y06_RESEARCH_PRETENDS_ACTUAL_FILL")
        entry=float(r["model_entry_price"]);exit=float(r["model_exit_price"]);pnl=float(r["net_pnl_jpy"])
        if min(entry,exit)<=0 or not all(math.isfinite(x) for x in (entry,exit,pnl)):
            raise ValueError("Y06_PRICE_PNL_INVALID")
        selected.append({"sourceSignalId":r["source_signal_id"],"symbol":r["symbol"],
             "entryUtc":r["entry_utc"],"modeledNetJpy":pnl,
             "adversePriceMove":exit>entry})
    if len(selected) not in (119,113):
        raise ValueError("Y06_INTEGRATED_COHORT_COUNT_UNEXPECTED")
    return {"bps":bps,"modeledClosed":len(selected),
        "wins":sum(r["modeledNetJpy"]>0 for r in selected),
        "losses":sum(r["modeledNetJpy"]<0 for r in selected),
        "priceAdverse":sum(r["adversePriceMove"] for r in selected),
        "modeledNetJpy":sum(r["modeledNetJpy"] for r in selected),
        "bySymbol":{k:{"closed":len([r for r in selected if r["symbol"]==k]),
                       "modelNetJpy":sum(r["modeledNetJpy"] for r in selected if r["symbol"]==k)}
                    for k in sorted({r["symbol"] for r in selected})},
        "closedModelEntries":selected}
def build(h:dict,lock:dict,online:dict,ten:dict,thirty:dict)->dict:
    times=check_grid(h,"V4_Y06_HORIZON_PRETARGET_FORWARD",4)
    locks=check_grid(lock,"V4_Y06_PROFIT_LOCK_PRETARGET_FORWARD",10)
    skip=check_online(online)
    if ten["bps"]!=10 or thirty["bps"]!=30 or ten["modeledClosed"]!=119 or thirty["modeledClosed"]!=113:
        raise ValueError("V4_Y06_COST_CASE_COHORT_DRIFT")
    keys10={r["sourceSignalId"] for r in ten["closedModelEntries"]}
    keys30={r["sourceSignalId"] for r in thirty["closedModelEntries"]}
    # Cost-dependent portfolio risk and slot order can alter which Y06
    # signals get admitted. Do not falsely require 30bps subset of 10bps.
    overlap={
       "both":len(keys10 & keys30),
       "only10bps":len(keys10-keys30),
       "only30bps":len(keys30-keys10)}
    if (overlap["both"]+overlap["only10bps"]!=ten["modeledClosed"] or
       overlap["both"]+overlap["only30bps"]!=thirty["modeledClosed"]):
        raise ValueError("V4_Y06_COST_CASE_SET_ARITHMETIC_DRIFT")
    return {"schema":"disdex-bt-v4-y06-pretarg-and-model-cohort-audit/v1",
      "status":"Y06_NO_REPRODUCED_PRETARGET_EXIT_OR_ONLINE_GATE_DO_NOT_PROMOTE",
      "sourceRoute":ROUTE,
      "horizon":{"gridSize":times["gridSize"],"adopted":0},
      "profitLock":{"gridSize":locks["gridSize"],"adopted":0},
      "onlineShadow":skip,
      "costCaseAdmittedSignalOverlap":overlap,
      "targetYearResearch":{"10bps":ten,"30bps":thirty},
      "targetYearUsedToSelectExitThreshold":False,
      "targetYearWinsMayNotBeCrossPeriodEvidence":True,
      "liveRuntimeEconomicParityCertified":False,"v4CodexCutoverTouched":False,
      "productionMutations":0}
def main():
    p=argparse.ArgumentParser(description=__doc__)
    for key in ("horizon","lock","online","fills10","fills30","output"):
        p.add_argument("--"+key,type=Path,required=True)
    a=p.parse_args()
    data=build(read(a.horizon),read(a.lock),read(a.online),
               modeled_fills(a.fills10,10),modeled_fills(a.fills30,30))
    data["sourceSha256"]={k:sha(getattr(a,k)) for k in ("horizon","lock","online","fills10","fills30")}
    a.output.write_text(json.dumps(data,ensure_ascii=False,indent=2,allow_nan=False)+"\n","utf8")
    print(json.dumps({"status":data["status"],
       "gridRejected":[data["horizon"]["gridSize"],data["profitLock"]["gridSize"],
            data["onlineShadow"]["exploredPolicies"]],
       "10bps":{"n":data["targetYearResearch"]["10bps"]["modeledClosed"],
           "wins":data["targetYearResearch"]["10bps"]["wins"]},
       "30bps":{"n":data["targetYearResearch"]["30bps"]["modeledClosed"],
           "wins":data["targetYearResearch"]["30bps"]["wins"]}},ensure_ascii=False))
if __name__=="__main__":main()
