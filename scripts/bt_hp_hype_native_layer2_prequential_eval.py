#!/usr/bin/env python3
"""HYPE TREND Layer2 prequential calibration, research-only selected trades.

Compare fixed trailing-20 Beta(1,1) to an all-prior Beta(1,1) baseline.
Each prediction is computed before its trade outcome. Realized outcomes may
be used only for scoring after close, never for candidate selection.
"""
from __future__ import annotations
import argparse,hashlib,json,math
from pathlib import Path
from datetime import datetime,timezone
from bt_hp_hype_native_online_layer23_shadow import past_closed_asof,trailing_prior_stats
from bt_hp_hype_single_slot_loss_audit import audit as audit_single_slot

def sha(path:Path)->str:
    return hashlib.sha256(path.read_bytes()).hexdigest()
def to_utc(t:int)->str:
    return datetime.fromtimestamp(t/1000,timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
def metrics(probs:list[float],outcomes:list[int])->dict:
    if not probs or len(probs)!=len(outcomes):
        raise ValueError("PREQUENTIAL_SAMPLE_COHORT_INVALID")
    if any(not math.isfinite(p) or not 0<p<1 for p in probs) or any(y not in (0,1) for y in outcomes):
        raise ValueError("PREQUENTIAL_PROBABILITY_OR_TARGET_INVALID")
    n=len(probs)
    brier=sum((p-y)**2 for p,y in zip(probs,outcomes))/n
    log_loss=-sum(y*math.log(p)+(1-y)*math.log1p(-p) for p,y in zip(probs,outcomes))/n
    return {"n":n,"realizedWinRate":sum(outcomes)/n,
        "meanHistoricalProbability":sum(probs)/n,
        "brierScore":brier,"meanLogLoss":log_loss}
def evaluate(model:dict,shadow:dict,candidates:list)->dict:
    if shadow.get("schema")!="disdex-bt-hype-native-layer2-3-asof-shadow/v1":
        raise ValueError("SHADOW_SCOPING_UNKNOWN")
    if shadow.get("candidateCount")!=78 or len(candidates)!=78:
        raise ValueError("NATIVE_CANDIDATES_78_REQUIRED")
    audited=audit_single_slot(model,candidates)
    if audited["singleSlotSelectedModelTrades"]!=56:
        raise ValueError("RESEARCH_SINGLE_SLOT_SOURCE_LEDGER_DRIFT")
    cases={}
    for cost in ("10bps","30bps"):
        trades=sorted(model["results"][cost]["modelTrades"],key=lambda x:x["start"])
        signals=shadow["models"][cost]["signals"]
        by_time={r["candidateEntryUtc"]:r for r in signals}
        if len(by_time)!=78:raise ValueError("SHADOW_SIGNAL_DUPLICATES_OR_INCOMPLETE")
        selected=set()
        window_p=[];all_p=[];outcomes=[];diagnostics=[]
        for trade in trades:
            stamp=to_utc(trade["start"])
            if stamp not in by_time or not by_time[stamp]["singleSlotModelSelected"]:
                raise ValueError("CLOSED_TRADE_NOT_IN_NATIVE_SHADOW_SELECTED")
            if stamp in selected:raise ValueError("SAME_TRADE_SELECTED_TWICE")
            selected.add(stamp)
            earlier=past_closed_asof(trades,trade["start"])
            online=by_time[stamp]["layer2HistoricalOnly"]
            if not online or online["observedPastClosed"]!=len(earlier):
                raise ValueError("ASOF_HISTORY_COUNT_DRIFT")
            recent=trailing_prior_stats(earlier)
            if (online["recentCount"]!=recent["recentCount"] or
                online["recentWins"]!=recent["recentWins"] or
                not math.isclose(online["beta11PosteriorMeanWinRate"],
                      recent["beta11PosteriorMeanWinRate"],rel_tol=1e-12)):
                raise ValueError("HYPE_LAYER2_ASOF_PROBABILITY_DRIFT")
            # This is a pre-declared observation rule, not a trading gate.
            if len(earlier)<20:continue
            y=int(trade["netWalletReturn"]>0)
            winp=(1+sum(z["netWalletReturn"]>0 for z in earlier))/(2+len(earlier))
            p20=recent["beta11PosteriorMeanWinRate"]
            window_p.append(p20);all_p.append(winp);outcomes.append(y)
            diagnostics.append({"entryUtc":stamp,"priorCount":len(earlier),
              "realizedOutcomeAfterModelExit":y,"recent20PastWinPosterior":p20,
              "allPriorWinPosterior":winp,
              "usedLaterTradeOutcomesToPredict":False,
              "tradeSelectionAffectedByScore":False})
        if len(selected)!=56:raise ValueError("SELECTED_COHORT_INCOMPLETE")
        recent_metrics=metrics(window_p,outcomes)
        baseline_metrics=metrics(all_p,outcomes)
        cases[cost]={
            "selectedSingleSlotTrades":len(trades),
            "observedPredictionsWith20PriorClosed":len(diagnostics),
            "testOutcomeWins":sum(outcomes),
            "recent20Beta11Historical":recent_metrics,
            "allPriorBeta11HistoricalBaseline":baseline_metrics,
            "recent20BrierMinusBaseline":recent_metrics["brierScore"]-baseline_metrics["brierScore"],
            "recent20ImprovesHistoricalBrier":recent_metrics["brierScore"]<baseline_metrics["brierScore"],
            "predictions":diagnostics}
    return {"schema":"disdex-bt-hype-native-layer2-prequential-compare/v1",
      "status":"HISTORICAL_PREQUENTIAL_SHADOW_NO_INDEPENDENT_OOS_NO_PROMOTION",
      "fixedRecentWindowInheritedFromPriorShadow":True,
      "comparisonNotPreRegisteredWithIndependentOOS":True,
      "noGateThresholdsOptimized":True,
      "historicalSelectedOnlyNotRandomUnbiasedSample":True,
      "separateCalendarMarketOOSCertified":False,
      "layer2ForecastCalibrationCertified":False,
      "layer3OpportunityRankingCertified":False,
      "economicParityCertified":False,
      "models":cases,"productionMutations":0}
def main():
    a=argparse.ArgumentParser(description=__doc__)
    a.add_argument("--single-slot",type=Path,required=True)
    a.add_argument("--native-candidates",type=Path,required=True)
    a.add_argument("--shadow",type=Path,required=True)
    a.add_argument("--output",type=Path,required=True)
    r=a.parse_args()
    report=evaluate(json.loads(r.single_slot.read_text("utf8")),
        json.loads(r.shadow.read_text("utf8")),
        json.loads(r.native_candidates.read_text("utf8")))
    report["sourceSha256"]={name:sha(path) for name,path in (
       ("singleSlot",r.single_slot),("nativeCandidates",r.native_candidates),
       ("shadow",r.shadow))}
    r.output.write_text(json.dumps(report,ensure_ascii=False,indent=2,allow_nan=False)+"\n","utf8")
    print(json.dumps({"status":report["status"],
       "costs":{cost:{"n":x["observedPredictionsWith20PriorClosed"],
          "wins":x["testOutcomeWins"],
          "BrierRecent20":x["recent20Beta11Historical"]["brierScore"],
          "BrierAllPrior":x["allPriorBeta11HistoricalBaseline"]["brierScore"],
          "recentImproves":x["recent20ImprovesHistoricalBrier"]}
          for cost,x in report["models"].items()}},ensure_ascii=False))
if __name__=="__main__":main()
