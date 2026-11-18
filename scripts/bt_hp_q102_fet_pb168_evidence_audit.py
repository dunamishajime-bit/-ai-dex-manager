#!/usr/bin/env python3
"""Q102 FET PB168 pre-target / integrated-replay audit, research only.

Do not select a gate using 2025-10..2026-10 target trades. Archived pretarget
Binance proxy is not exact Aster production fill evidence; preserve all splits.
"""
from __future__ import annotations
import argparse,csv,hashlib,json,math
from pathlib import Path

ROUTE="FET|PB168_0.1_P24_0.02_H12"
REQUIRED_SPLITS=("train","validation","prehold")
START="2025-10-01T00:00:00Z";END="2026-10-01T00:00:00Z"

def read_json(path:Path)->dict:
    return json.loads(path.read_text(encoding="utf-8-sig"))
def digest(path:Path)->str:
    return hashlib.sha256(path.read_bytes()).hexdigest()
def close(a,b)->bool:
    return math.isclose(float(a),float(b),rel_tol=1e-10,abs_tol=1e-10)
def validate_source(freeze:dict,recheck:dict)->dict:
    if freeze.get("status")!="Q102_FET_ROUTE_PRETARGET_FREEZE_FORWARD_VETO_ONLY" or freeze.get("costBps")!=30:
        raise ValueError("PRETARGET_FREEZE_SOURCE_SCHEMA_UNKNOWN")
    if freeze.get("pretargetSplit")!={"train":"2025-03-22..2025-06-30",
             "validation":"2025-07..08","prehold":"2025-09"}:
        raise ValueError("PRETARGET_SPLITS_CHANGED")
    if ROUTE not in freeze.get("audit",{}):raise ValueError("PRETARGET_ROUTE_MISSING")
    evidence=freeze["audit"][ROUTE]
    split=evidence["splits30"]
    for key in REQUIRED_SPLITS:
        z=split.get(key)
        if not isinstance(z,dict) or int(z["n"])<=0:
            raise ValueError("PRETARGET_SPLIT_INCOMPLETE:"+key)
        if not close(z["sum"],z["mean"]*z["n"]):
            raise ValueError("PRETARGET_SPLIT_PNL_IDENTITY:"+key)
        if not 0<=float(z["wr"])<=1 or float(z["pf"])<0:
            raise ValueError("PRETARGET_SPLIT_METRICS_INVALID:"+key)
    full=evidence["full30"]
    if int(full["n"])!=sum(int(split[x]["n"]) for x in REQUIRED_SPLITS):
        raise ValueError("PRETARGET_FULL_N_SUM_DRIFT")
    if not close(full["sum"],sum(float(split[x]["sum"]) for x in REQUIRED_SPLITS)):
        raise ValueError("PRETARGET_FULL_PNL_SUM_DRIFT")
    if evidence["freezePretargetOnly"] is not False or ROUTE in freeze["frozenPretargetOnly"]:
        raise ValueError("PRETARGET_FREEZE_EXPECTATION_CHANGED")
    if freeze["forwardOneShot"] or freeze["acceptedAfterForwardVeto"] or freeze["rejectedByForward"]:
        raise ValueError("UNEXPECTED_FORWARD_SELECTION_FOR_UNFROZEN_ROUTE")
    if (recheck.get("status")!="Q102_FET_RET14_GATE_PRETARGET_INDEPENDENT_RECHECK" or
       recheck.get("decision")!="DOWNGRADE_REJECT_AS_PRETARGET_CAUSAL" or
       recheck.get("selectionUsesTargetYear") is not False or
       recheck.get("acceptedAsPretargetCausal") is not False):
        raise ValueError("FET_RET14_POLICY_SOURCE_CONFLICT")
    all_pre=recheck["metrics"]["allPretarget"]
    if all_pre["gated"]["pf"]>=all_pre["native"]["pf"]:
        raise ValueError("FET_RET14_ALLPRETARGET_POLICY_FACT_DRIFT")
    return {
       "route":ROUTE,
       "training":split["train"],"validation":split["validation"],
       "prehold":split["prehold"],"allPretarget":full,
       "pretargFreezeApplied":False,
       "ret14PretargGateAccepted":False,
       "ret14AllPretargetNativePf":all_pre["native"]["pf"],
       "ret14AllPretargetGatedPf":all_pre["gated"]["pf"],
       "sourceDomain":"Binance FET local proxy, NOT native Aster venue"
    }
def replay_fills(file:Path,bps:int)->dict:
    if bps not in (10,30):raise ValueError("COST_MODEL_INVALID")
    rows=[];seen=set()
    with file.open(encoding="utf-8-sig",newline="") as f:
        reader=csv.DictReader(f)
        required={"trade_id","strategy","route","symbol","side","entry_utc",
                  "exit_utc","net_pnl_jpy","model_entry_price","model_exit_price",
                  "signed_execution_verified","actual_venue_order_id","actual_filled_quantity"}
        if not reader.fieldnames or not required.issubset(reader.fieldnames):
            raise ValueError("RESEARCH_FILL_COLUMNS_MISSING")
        for row in reader:
            tid=row["trade_id"]
            if not tid or tid in seen:raise ValueError("DUPLICATE_RESEARCH_FILL_ID")
            seen.add(tid)
            if row["strategy"]!="Q102" or row["route"]!=ROUTE:continue
            if row["symbol"]!="FETUSDT" or row["side"] not in ("LONG","SHORT"):
                raise ValueError("FET_PB168_FILL_IDENTITY_DRIFT")
            if not START<=row["entry_utc"]<row["exit_utc"]<=END:
                raise ValueError("MODEL_TRADE_OUTSIDE_TARGET_YEAR")
            if row["signed_execution_verified"]!="False" or row["actual_venue_order_id"] or row["actual_filled_quantity"]:
                raise ValueError("RESEARCH_FILL_CLAIMS_ACTUAL_VENUE")
            pnl=float(row["net_pnl_jpy"])
            if not math.isfinite(pnl):
                raise ValueError("NONFINITE_MODEL_PNL")
            entry=float(row["model_entry_price"])
            exit=float(row["model_exit_price"])
            if min(entry,exit)<=0:raise ValueError("MODEL_PRICE_INVALID")
            rows.append({"entryUtc":row["entry_utc"],"exitUtc":row["exit_utc"],
                        "side":row["side"],"modeledNetJpy":pnl,
                        "priceAdverse":exit<entry if row["side"]=="LONG" else exit>entry,
                        "modelExitReason":row["exit_model_reason"]})
    if not rows:raise ValueError("NO_Q102_FET_PB168_MODELED_FILLS")
    if rows!=sorted(rows,key=lambda r:r["entryUtc"]):raise ValueError("FET_MODELED_FILLS_NOT_CHRONOLOGICAL")
    return {
      "bps":bps,"n":len(rows),
      "wins":sum(r["modeledNetJpy"]>0 for r in rows),
      "losses":sum(r["modeledNetJpy"]<0 for r in rows),
      "netPnlJpy":sum(r["modeledNetJpy"] for r in rows),
      "adversePriceMoves":sum(r["priceAdverse"] for r in rows),
      "hardStops":sum("HARD_STOP" in r["modelExitReason"] for r in rows),
      "modeledRows":rows
    }
def build(freeze:dict,recheck:dict,ten:dict,thirty:dict)->dict:
    before=validate_source(freeze,recheck)
    if ten["bps"]!=10 or thirty["bps"]!=30 or ten["n"]!=thirty["n"]:
        raise ValueError("COST_MODEL_ENTRY_POPULATION_DRIFT")
    if [r["entryUtc"] for r in ten["modeledRows"]]!=[r["entryUtc"] for r in thirty["modeledRows"]]:
        raise ValueError("COST_MODEL_TRADE_COHORT_INCONSISTENT")
    return {
     "schema":"disdex-bt-q102-fet-pb168-pretarget-target-evidence/v1",
     "status":"PRETARGET_CONFLICT_NO_ROUTE_FREEZE_MODEL_TARGET_DIAGNOSTIC_ONLY",
     "historicalPreTargetProxy":before,
     "targetYearIntegratedResearch":{"10bps":ten,"30bps":thirty},
     "targetYearUsedToSelectRouteOrThreshold":False,
     "recommendation":"DO_NOT_REMOVE_OR_REWEIGHT_FROM_SINGLE_TARGET_LOSS; independent data and release contract first",
     "independentPretargetProxyIsSignedVenueParity":False,
     "liveEconomicParityCertified":False,"productionMutations":0
    }
def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--freeze",type=Path,required=True)
    ap.add_argument("--ret14-recheck",type=Path,required=True)
    ap.add_argument("--fills10",type=Path,required=True)
    ap.add_argument("--fills30",type=Path,required=True)
    ap.add_argument("--output",type=Path,required=True)
    a=ap.parse_args()
    report=build(read_json(a.freeze),read_json(a.ret14_recheck),
                 replay_fills(a.fills10,10),replay_fills(a.fills30,30))
    report["inputSha256"]={
       label:digest(p) for label,p in {"freeze":a.freeze,"recheck":a.ret14_recheck,
                      "fills10":a.fills10,"fills30":a.fills30}.items()}
    a.output.write_text(json.dumps(report,ensure_ascii=False,indent=2,allow_nan=False)+"\n",encoding="utf8")
    print(json.dumps({"status":report["status"],
         "pretarget":{"train":report["historicalPreTargetProxy"]["training"]["pf"],
          "validation":report["historicalPreTargetProxy"]["validation"]["pf"],
          "prehold":report["historicalPreTargetProxy"]["prehold"]["pf"]},
         "target":{k:{"n":v["n"],"wins":v["wins"],"losses":v["losses"],
                       "netJpy":round(v["netPnlJpy"],2)}
          for k,v in report["targetYearIntegratedResearch"].items()}},ensure_ascii=False))
if __name__=="__main__":main()
