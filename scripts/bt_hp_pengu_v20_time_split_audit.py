#!/usr/bin/env python3
"""Audit PENGU fixed SHORT_V20 pretarget/forward contradictions and target ledger.

Research-only. No target-year threshold optimization or live runner mutation.
"""
from __future__ import annotations
import argparse,csv,hashlib,json,math
from collections import Counter
from pathlib import Path

ROUTE="SHORT_V20";STRATEGY="PENGU";SYMBOL="PENGUUSDT"
VALID_SPLITS=("train","valid","prehold","forward")
def digest(path:Path)->str:return hashlib.sha256(path.read_bytes()).hexdigest()
def read_json(path:Path)->dict:return json.loads(path.read_text("utf-8-sig"))
def close(a,b)->bool:return math.isclose(float(a),float(b),rel_tol=1e-10,abs_tol=1e-10)
def check_pretarget(pre:dict,redesign:dict,rank1:dict)->dict:
    if pre.get("status")!="CAUSAL_PRETARGET_PROXY_TRAIN_VALID_PREHOLD_PLUS_TRUE_FORWARD_FALSIFICATION":
        raise ValueError("PRETARGET_EVIDENCE_UNKNOWN_SCHEMA")
    if pre.get("route") not in (ROUTE,"PENGU_SHORT_V20"):
        raise ValueError("PRETARGET_NOT_SHORT_V20")
    counts=pre["counts"]
    if counts["train"]+counts["valid"]+counts["prehold"]!=counts["pre"]:
        raise ValueError("PRETARGET_SPLIT_COUNT_INCONSISTENT")
    if not (counts["pre"]==72 and counts["forwardMatched"]==6 and pre["robustN"]==0
            and pre["candidateRuleN"]>=100 and pre["robust"]==[]):
        raise ValueError("PRETARGET_FROZEN_ZERO_ROBUST_DRIFT")
    for name in VALID_SPLITS:
        summary=pre["baseline30"][name]
        if int(summary["n"])<1 or not close(summary["sum"],summary["n"]*summary["mean"]):
            raise ValueError("PRETARGET_METRIC_SUM_INCONSISTENT:"+name)
    if pre.get("method","").find("Target year is never read.")<0:
        raise ValueError("PRETARGET_SELECTION_PROTOCOL_CHANGED")
    if redesign.get("status")!="RESEARCH_ONLY_SHORT_FIXED_MARKET_REGIME_REDESIGN_V1":
        raise ValueError("V20_REDESIGN_SOURCE_UNKNOWN")
    policy=redesign["policy"]
    if (policy.get("direction")!="SHORT_FIXED" or
        policy.get("use_market_regime")!="ENTRY_ALLOW_BLOCK_ONLY" or
        policy.get("target_not_used_for_selection") is not True):
        raise ValueError("SHORT_FIXED_ROUTE_OR_SELECTION_POLICY_DRIFT")
    if redesign["counts"]["pre"]!=counts["pre"] or redesign["counts"]["target"]!=40:
        raise ValueError("SOURCE_COUNTS_MISMATCH")
    for segment in ("train","valid","prehold"):
        v=redesign["baseline30"][segment]
        p=pre["baseline30"][segment]
        if v!=p:raise ValueError("PRETARGET_SPLITS_SOURCE_DIVERGE:"+segment)
    if rank1.get("status")!="TRUE_FORWARD_FALSIFICATION_OF_PRETARGET_FROZEN_V20_SHADOW_HEALTH_RANK1":
        raise ValueError("RANK1_FORWARD_EVIDENCE_INVALID")
    if rank1["selectionUsesTarget"] is not False or rank1["selectionUsesForward"] is not False:
        raise ValueError("RANK1_DATA_SELECTION_CONTAMINATION")
    decisions=rank1["decisions"]
    if rank1["forwardModeledN"]!=6 or len(decisions)!=6:
        raise ValueError("RANK1_FORWARD_COHORT_NOT_SIX")
    if any(x["allow"] is not False for x in decisions):
        raise ValueError("RANK1_FORWARD_BLOCKS_NOT_SIX")
    if len({x["entryTs"] for x in decisions})!=6:
        raise ValueError("DUPLICATE_FORWARD_TIMESTAMP")
    if rank1["forward30"]["n"]!=0 or rank1["forward30"]["blocked"]!=6:
        raise ValueError("RANK1_FORWARD_BLOCK_COVERAGE_DRIFT")
    if rank1["forward10"]["n"]!=0 or rank1["forward10"]["blocked"]!=6:
        raise ValueError("RANK1_10BPS_FORWARD_BLOCK_COVERAGE_DRIFT")
    baseline=rank1["forwardBaseline30"]
    if baseline["n"]!=6 or not close(baseline["sum"],pre["baseline30"]["forward"]["sum"]):
        raise ValueError("INDEPENDENT_FORWARD_BASELINE_DISAGREES")
    return {
      "pretarget":{name:pre["baseline30"][name] for name in VALID_SPLITS},
      "candidateFiltersSearchedPretarget":pre["candidateRuleN"],
      "robustPreTargetFilters":0,
      "redesignPretargetExploratorySelectedRules":len(redesign.get("selectedPretargetTop",[])),
      "rank1FrozenOnlineShadowParams":rank1["params"],
      "rank1TrueForwardAllBlocked":6,
      "rank1TrueForwardWinsBlocked":sum(float(x["rawReturn"])>.003 for x in decisions),
      "forwardNoRemainingExecutedModelTrades":True,
      "selectionUsesTargetYear":False,
      "pretargPricesVenue": "Binance-UM proxy, not native Aster",
      "sourceForwardSampleSize":6,
    }
def audit_fills(file:Path,bps:int)->dict:
    if bps not in (10,30):raise ValueError("UNKNOWN_COST_MODEL")
    all_ids=set();out=[]
    with file.open(encoding="utf-8-sig",newline="") as f:
      dr=csv.DictReader(f)
      required={"trade_id","strategy","symbol","side","route","entry_utc",
                "exit_utc","net_pnl_jpy","actual_venue_order_id","actual_filled_quantity",
                "signed_execution_verified","model_entry_price","model_exit_price"}
      if not dr.fieldnames or not required.issubset(dr.fieldnames):
          raise ValueError("INTEGRATED_RESEARCH_FILL_FIELDS_MISSING")
      for row in dr:
          tid=row["trade_id"]
          if not tid or tid in all_ids:raise ValueError("DUPLICATE_MODEL_FILL_ID")
          all_ids.add(tid)
          if row["strategy"]!=STRATEGY or row["route"]!=ROUTE:continue
          if row["symbol"]!=SYMBOL or row["side"]!="SHORT":
              raise ValueError("SHORT_V20_DIRECTION_FIXED_INVARIANT")
          if (row["actual_venue_order_id"] or row["actual_filled_quantity"] or
              row["signed_execution_verified"]!="False"):
              raise ValueError("SHORT_V20_MODEL_CLAIMS_LIVE_FILL")
          if not ("2025-10-01T00:00:00Z"<=row["entry_utc"]<row["exit_utc"]<=
                   "2026-10-01T00:00:00Z"):
              raise ValueError("MODEL_V20_TARGET_PERIOD_DRIFT")
          raw=float(row["model_entry_price"]);end=float(row["model_exit_price"])
          pnl=float(row["net_pnl_jpy"])
          if not all(math.isfinite(x) for x in (raw,end,pnl)) or min(raw,end)<=0:
              raise ValueError("MODEL_V20_PRICE_PNL_INVALID")
          out.append({"entryUtc":row["entry_utc"],"exitUtc":row["exit_utc"],
                      "netModelPnlJpy":pnl,"adversePriceDirection":end>raw,
                      "exitReason":row["exit_model_reason"]})
    if len(out)!=7 or any(x["entryUtc"]>=out[i+1]["entryUtc"] for i,x in enumerate(out[:-1])):
        raise ValueError("MODEL_V20_SELECTED_COHORT_NOT_SEVEN_ORDERED")
    return {"bps":bps,"selectedModelTrades":len(out),
      "wins":sum(x["netModelPnlJpy"]>0 for x in out),
      "losses":sum(x["netModelPnlJpy"]<0 for x in out),
      "adversePriceDirections":sum(x["adversePriceDirection"] for x in out),
      "modelNetJpy":sum(x["netModelPnlJpy"] for x in out),
      "rows":out}
def build(pre:dict,redesign:dict,rank1:dict,ten:dict,thirty:dict)->dict:
    hist=check_pretarget(pre,redesign,rank1)
    if (ten["bps"]!=10 or thirty["bps"]!=30 or
       [x["entryUtc"] for x in ten["rows"]] != [x["entryUtc"] for x in thirty["rows"]]):
        raise ValueError("COST_MODEL_V20_COHORT_DRIFT")
    return {"schema":"disdex-bt-pengu-short-v20-time-split-audit/v1",
      "status":"SHORT_V20_PRETARGET_FORWARD_CONFLICT_RESEARCH_ONLY_NO_GATE_PROMOTION",
      "historicalSelection":hist,
      "integratedTargetResearch":{"10bps":ten,"30bps":thirty},
      "targetYearUsedForGateThresholdSelection":False,
      "applyRank1ToProduction":False,
      "forwardBlockingEveryCandidateIsNotProofOfImprovedRealizedWinRate":True,
      "shortDirectionNeverFlipped":True,
      "tradingOrRiskConfigurationChanges":0}
def main():
    a=argparse.ArgumentParser(description=__doc__)
    for key in ("pretarg","redesign","rank1","fills10","fills30","output"):
        a.add_argument("--"+key,required=True,type=Path)
    r=a.parse_args()
    out=build(read_json(r.pretarg),read_json(r.redesign),read_json(r.rank1),
              audit_fills(r.fills10,10),audit_fills(r.fills30,30))
    out["sourceSha256"]={k:digest(getattr(r,k)) for k in
       ("pretarg","redesign","rank1","fills10","fills30")}
    r.output.write_text(json.dumps(out,ensure_ascii=False,indent=2,allow_nan=False)+"\n","utf8")
    print(json.dumps({"status":out["status"],
       "historicalRobustCandidates":out["historicalSelection"]["robustPreTargetFilters"],
       "forwardFrozenRank1Blocked":out["historicalSelection"]["rank1TrueForwardAllBlocked"],
       "targetModel":{b:{"n":m["selectedModelTrades"],"wins":m["wins"],
                         "losses":m["losses"],"netJpy":round(m["modelNetJpy"],2)}
                    for b,m in out["integratedTargetResearch"].items()}},ensure_ascii=False))
if __name__=="__main__":main()
