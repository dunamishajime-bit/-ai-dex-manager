#!/usr/bin/env python3
"""HYPE TREND 78-candidate Layer2 online *shadow*, Layer3 context audit.

Causal at each entry: only prior single-slot model trades with exitTs < entryTs.
Does NOT select/reject a position, optimize thresholds or certify venue fills.
Layer3 records as-of source model Gross context but cannot rank competitors
without independently validated per-runner expected values.
"""
from __future__ import annotations
import argparse,hashlib,json,math
from datetime import datetime,timezone
from pathlib import Path
from bt_hp_hype_single_slot_loss_audit import audit as audit_single_slot
from bt_hp_source_model_gross import load_model_gross

START=1759276800000;END=1790812800000
MIN_OBSERVATIONS=20;RECENT_WINDOW=20
def iso(t):
    return datetime.fromtimestamp(t/1000,timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
def checksum(p:Path)->str:
    return hashlib.sha256(p.read_bytes()).hexdigest()
def wilson(wins:int,n:int,z:float=1.96)->list[float]|None:
    if n<=0:return None
    phat=wins/n;z2=z*z;d=1+z2/n
    c=(phat+z2/(2*n))/d
    h=z*math.sqrt((phat*(1-phat)+z2/(4*n))/n)/d
    return [max(0.,c-h),min(1.,c+h)]
def trailing_prior_stats(prior:list,*,window:int=RECENT_WINDOW)->dict:
    recent=prior[-window:]
    n=len(recent)
    wins=sum(x["netWalletReturn"]>0 for x in recent)
    values=[float(x["netWalletReturn"]) for x in recent]
    if any(not math.isfinite(x) for x in values):raise ValueError("NONFINITE_PRIOR_MODEL_WALLET_RETURN")
    return {
      "observedPastClosed":len(prior),
      "window":window,"recentCount":n,
      "recentWins":wins,
      "beta11PosteriorMeanWinRate":(1+wins)/(2+n),
      "historicalWilson95":wilson(wins,n),
      "recentMeanNetWalletPct":100*sum(values)/n if n else None,
      "confidenceStatus":"EXPLORATORY_ONLY_NOT_CALIBRATED" if n>=MIN_OBSERVATIONS
                         else "INSUFFICIENT_PAST_CLOSED_TRADES",
      "candidateSelectionAuthorized":False
    }
def past_closed_asof(trades:list,t:int)->list:
    if any(int(x["end"])<=int(x["start"]) for x in trades):
        raise ValueError("MODEL_TRADE_INTERVAL_INVALID")
    out=[x for x in trades if int(x["end"])<t]
    if any(int(x["end"])>=t for x in out):
        raise ValueError("FUTURE_EXIT_LEAKED_INTO_ONLINE_SCORE")
    return sorted(out,key=lambda x:x["end"])

def build(model:dict,candidates:list,context10:dict,context30:dict)->dict:
    if model.get("schema")!="disdex-hype-pinned-aster-funding-sensitivity/v1" or len(candidates)!=78:
        raise ValueError("EXPECTED_SOURCE_HYPE_MODEL_SCHEMA_AND_CANDIDATES")
    # Reuse immutable ledger arithmetic/one-slot and cost-case identity checks.
    ledger=audit_single_slot(model,candidates)
    if ledger["singleSlotSelectedModelTrades"]!=56:raise ValueError("MODEL_SELECTED_TRADES_NOT_56")
    signals=sorted(candidates,key=lambda x:x["entry_ts_ms"])
    if len({x["entry_ts_ms"] for x in signals})!=78:
        raise ValueError("DUPLICATE_HYPE_NATIVE_SIGNAL_TIMESTAMP")
    results={}
    for case,context in (("10bps",context10),("30bps",context30)):
        trades=sorted(model["results"][case]["modelTrades"],key=lambda t:t["start"])
        if len(trades)!=56:raise ValueError("RESEARCH_HYPE_SINGLE_SLOT_TRADES_NOT_56")
        if any(trades[i]["end"]>trades[i+1]["start"] for i in range(len(trades)-1)):
            raise ValueError("RESEARCH_SINGLE_SLOT_TRADE_OVERLAP")
        # Construct the causal history using an exit-time cursor, independent of
        # future outcomes. Do not touch a future trade to produce earlier score.
        out=[]
        chosen={t["start"] for t in trades}
        if len(chosen)!=56:raise ValueError("DUPLICATE_SELECTED_ENTRY")
        for sig in signals:
            t=sig["entry_ts_ms"]
            if not START<=t<END or sig["route"]!="HYPE_TREND_LONG_PINNED":
                raise ValueError("HYPE_NATIVE_SIGNAL_SCOPE_INVALID")
            known=past_closed_asof(trades,t)
            k=iso(t)
            if k not in context:raise ValueError("MISSING_ASOF_GROSS_SOURCE_CONTEXT:"+k)
            rows=context[k]
            gross_crypto=sum(x["gross"] for x in rows if x["_category"]=="crypto")
            gross_stock=sum(x["gross"] for x in rows if x["_category"]=="stock")
            total=gross_crypto+gross_stock
            if not all(math.isfinite(x) and x>=0 for x in (gross_crypto,gross_stock,total)):
                raise ValueError("MALFORMED_SOURCE_GROSS_CONTEXT")
            selected=t in chosen
            shadow=trailing_prior_stats(known)
            out.append({
                "candidateEntryUtc":k,
                "nativeHypeSignalId":sig.get("source_signal_id") or sig.get("id"),
                "singleSlotModelSelected":selected,
                "singleSlotHistoricalModelStillActiveBeforeEntry":any(x["start"]<t<x["end"] for x in trades),
                "layer2HistoricalOnly":shadow,
                "layer3SourceGrossBeforeEntry":{
                    "totalGrossX":total,"cryptoGrossX":gross_crypto,"stockGrossX":gross_stock,
                    "occupiedModelFamilies":sorted({x["logic"] for x in rows}),
                    "sourceOrigin":"STABLE4_NATIVE_HYPE_RESEARCH_MODEL_MARK_NOT_VENUE",
                    "competitorExpectedValuesAvailable":False,
                    "candidateOpportunityRank":None,
                    "portfolioGateCertified":False},
                "hindsightOutcomeUsedToAcceptCandidate":False
            })
        # All 56 model admissions represented in the 78 native source signals.
        if sum(x["singleSlotModelSelected"] for x in out)!=56:
            raise ValueError("SINGLE_SLOT_ADMISSION_COHORT_DRIFT")
        results[case]={
         "candidates":len(out),"singleSlotModelAdmissions":56,
         "pastClosedAtFinalSignal":out[-1]["layer2HistoricalOnly"]["observedPastClosed"],
         "sufficientHistoryForDescriptiveRate":sum(
             x["layer2HistoricalOnly"]["recentCount"]>=MIN_OBSERVATIONS for x in out),
         "signals":out
        }
    if [x["candidateEntryUtc"] for x in results["10bps"]["signals"]] != [
       x["candidateEntryUtc"] for x in results["30bps"]["signals"]]:
        raise ValueError("COST_CASE_NATIVE_SIGNAL_COHORT_DRIFT")
    return {"schema":"disdex-bt-hype-native-layer2-3-asof-shadow/v1",
      "status":"ASOF_DESCRIPTIVE_SHADOW_ONLY_NO_LAYER2_OR_LAYER3_ADOPTION",
      "candidateCount":78,"singleSlotLedgerValidated":True,
      "minPriorExitsForDescriptiveRate":MIN_OBSERVATIONS,
      "recentTradeWindow":RECENT_WINDOW,
      "models":results,
      "timeCausality":"Only archived trade outcomes with exitMs strictly before candidate entryMs",
      "layer2CalibrationCertified":False,
      "layer3CompetingRunnerExpectedValuesReconstructed":False,
      "thresholdsFrozenBeforeTarget":False,
      "selectionOrTradingActions":0,"venueExecutionCertified":False,
      "productionMutationCount":0}
def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--single-slot",type=Path,required=True)
    ap.add_argument("--native-candidates",type=Path,required=True)
    ap.add_argument("--gross10",type=Path,required=True)
    ap.add_argument("--gross30",type=Path,required=True)
    ap.add_argument("--output",type=Path,required=True)
    a=ap.parse_args()
    result=build(json.loads(a.single_slot.read_text("utf8")),
        json.loads(a.native_candidates.read_text("utf8")),
        load_model_gross(a.gross10),load_model_gross(a.gross30))
    result["sourceSha256"]={label:checksum(p) for label,p in (
       ("singleSlot",a.single_slot),("nativeCandidates",a.native_candidates),
       ("gross10",a.gross10),("gross30",a.gross30))}
    a.output.write_text(json.dumps(result,ensure_ascii=False,indent=2,allow_nan=False)+"\n","utf8")
    print(json.dumps({"status":result["status"],
      "10bps":{"candidates":result["models"]["10bps"]["candidates"],
               "historicalWindowAvailable":result["models"]["10bps"]["sufficientHistoryForDescriptiveRate"]},
      "30bps":{"candidates":result["models"]["30bps"]["candidates"],
               "historicalWindowAvailable":result["models"]["30bps"]["sufficientHistoryForDescriptiveRate"]}},
      ensure_ascii=False))
if __name__=="__main__":main()
