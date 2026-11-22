#!/usr/bin/env python3
"""PRISM VII P35 pre-registered negative control: original V20 native53 at fixed gross0.75.
Tests BTC6h/relative weakness research gates as retrospective shadow only.
Original 53 native entries/exits unchanged. Overlapping original positions => NEVER
aggregate into a single-slot portfolio DD or multi-runner actual risk.
"""
from __future__ import annotations
import argparse,json,hashlib,math
from pathlib import Path
from collections import Counter,defaultdict
from prism7_p20_pengu_s3_market_structure_native_source_comparison_20261122 import h1_source
H=3600000
MODELS=("NATIVE53_UNMODIFIED","NATIVE53_SHADOW_BTC6H_NONPOSITIVE",
        "NATIVE53_SHADOW_PENGU_REL_WEAK6H","NATIVE53_SHADOW_BOTH")
PIN="1657e173d250ad58f53e62f7bb0a3428fb405496"
GROSS=.75
FEE=30

def shadow_case(row,pm,bm):
    ts=int(row["entryTs"])-H
    if ts not in pm or ts not in bm or ts-6*H not in pm or ts-6*H not in bm:
        return {"state":"INELIGIBLE_NO_SOURCE_COMPLETE_H1","entryTs":row["entryTs"],
                "lastCompletedH1Ts":ts}
    if any(not 0<d[t] for d,t in ((pm,ts),(pm,ts-6*H),(bm,ts),(bm,ts-6*H))):
        raise ValueError("P35_SOURCE_H1_INVALID_CLOSE")
    pengu6=pm[ts]/pm[ts-6*H]-1
    btc6=bm[ts]/bm[ts-6*H]-1
    return {
      "state":"CAUSAL_LAST_COMPLETED_H1_PRICE_CONTEXT",
      "lastCompletedH1Ts":ts,
      "lastCompletedAtOriginalNativeEntryTs":row["entryTs"],
      "btcReturnLast6CompletedH1":btc6,
      "penguReturnLast6CompletedH1":pengu6,
      "penguMinusBTC6H":pengu6-btc6,
      "BTCret6NonPositive":btc6<=0,
      "PENGURelativelyWeak6H":pengu6<=btc6,
      "signalUsesFuturePrice":False,
    }

def eligible(model,context):
    if model=="NATIVE53_UNMODIFIED":return True
    if context["state"]!="CAUSAL_LAST_COMPLETED_H1_PRICE_CONTEXT":return False
    if model=="NATIVE53_SHADOW_BTC6H_NONPOSITIVE":return context["BTCret6NonPositive"]
    if model=="NATIVE53_SHADOW_PENGU_REL_WEAK6H":return context["PENGURelativelyWeak6H"]
    if model=="NATIVE53_SHADOW_BOTH":
        return context["BTCret6NonPositive"] and context["PENGURelativelyWeak6H"]
    raise ValueError("P35_INVALID_SHADOW_MODEL")

def outcomes(original,cases,model):
    kept=[x for x in original if eligible(model,cases[x["entryTs"]])]
    keptmap={x["entryTs"]:x for x in kept}
    rejected=[x for x in original if x["entryTs"] not in keptmap]
    pnls=[float(x["net30pct"])*GROSS for x in kept]
    gain=sum(p for p in pnls if p>0)
    loss=-sum(p for p in pnls if p<0)
    buckets=[]
    for c in ("PRE_2025_AUG_SEP","BASE_2025_2026","POST_2026_OCT_NOV"):
        b=[x for x in kept if x["period"]==c]
        buckets.append({
          "cohort":c,
          "originSourceCount":sum(x["period"]==c for x in original),
          "shadowKeptCount":len(b),
          "shadowWinCount":sum(float(x["net30pct"])>0 for x in b),
          "shadowWonNetPctPointSumOnCapital":sum(float(x["net30pct"])*GROSS for x in b if x["net30pct"]>0),
          "shadowLossNetPctPointSumOnCapital":sum(float(x["net30pct"])*GROSS for x in b if x["net30pct"]<0),
        })
    return {
       "model":model,"originalPinnedNativeV20Intents":len(original),
       "retrospectiveShadowKept":len(kept),"retrospectiveShadowRejected":len(rejected),
       "grossExposureIfConceptuallyExecuted":GROSS,"sourceNativeRoundtripFeeBps":FEE,
       "keptWins":sum(x["net30pct"]>0 for x in kept),
       "keptLosses":sum(x["net30pct"]<0 for x in kept),
       "conditionalWinRatePct":round(100*sum(x["net30pct"]>0 for x in kept)/len(kept),8) if kept else None,
       "conditionalMeanNetPctOnCapital":round(sum(pnls)/len(kept),8) if kept else None,
       "nativeRetrospectiveShadowProfitFactor":round(gain/loss,8) if loss else None,
       "netPctPointSumPer53OriginalOpportunitiesAtFixedGross":round(sum(pnls),8),
       "nativeLostWinnerIds":[f"{x['id']}@{x['entryTs']}" for x in rejected if x["net30pct"]>0],
       "nativeAvoidedLoserIds":[f"{x['id']}@{x['entryTs']}" for x in rejected if x["net30pct"]<0],
       "nativeOriginalWinningGrossReturnPctPointsLostAt0p75":round(sum(float(x["net30pct"])*GROSS for x in rejected if x["net30pct"]>0),8),
       "nativeOriginalLosingGrossReturnPctPointsAvoidedAt0p75":round(-sum(float(x["net30pct"])*GROSS for x in rejected if x["net30pct"]<0),8),
       "originalSourceNativePnLAndExitForKept":[{"id":x["id"],"entryTs":x["entryTs"],"exitTs":x["exitTs"],"period":x["period"],"originalSourceNet30Pct":x["net30pct"],
           "conceptualGross0p75ReturnOnPortfolioAllocationPctPoints":round(float(x["net30pct"])*GROSS,8)}
           for x in kept],
       "preBasePostCohortOutcome":buckets,
       "recreateSingleSlotDDPermitted":False,
       "allOriginalSource53ExitsUnchanged":True,
    }

def positions_intersections(rows):
    overlap=0
    maxOpen=0
    for i,x in enumerate(rows):
        for y in rows[i+1:]:
            if x["entryTs"]<y["exitTs"] and y["entryTs"]<x["exitTs"]:overlap+=1
    boundaries=sorted([(x["entryTs"],1) for x in rows]+[(x["exitTs"],-1) for x in rows],
                  key=lambda x:(x[0],x[1]))
    opened=0
    for _,delta in boundaries:
        opened+=delta
        maxOpen=max(maxOpen,opened)
    return {"sourceOriginal53PairwiseOverlappingWindows":overlap,
            "sourceOriginal53MaximumConcurrentReferencePositions":maxOpen,
            "neverInterpret53AsRealOneSlotCapitalAllocation":overlap>0}

def main():
    a=argparse.ArgumentParser()
    a.add_argument("--native53",type=Path,required=True)
    a.add_argument("--pengu-h1",type=Path,nargs="+",required=True)
    a.add_argument("--btc-h1",type=Path,nargs="+",required=True)
    a.add_argument("--out-summary",type=Path,required=True)
    a.add_argument("--out-all53",type=Path,required=True)
    args=a.parse_args()
    original=json.loads(args.native53.read_text(encoding="utf-8"))
    if not(len(original)==53 and len(set(x["entryTs"] for x in original))==53 and
           sum(x["net30pct"]>0 for x in original)==29 and
           all(x["parity"]=="EXACT" for x in original)):
        raise ValueError("P35_PINNED_NATURAL53_ENTRY_EXIT_SOURCE_PARITY_MISSING")
    for x in original:
        expected=100*(1-float(x["exitPrice"])/float(x["entryPrice"]))-FEE/100
        if abs(expected-float(x["net30pct"]))>1e-5:
            raise ValueError("P35_NATIVE53_ORIGINAL_PRICE_FEES_NOT_MATCH:"+x["id"])
    p,psha=h1_source(args.pengu_h1)
    b,bsha=h1_source(args.btc_h1)
    pm={int(x["time"]):float(x["close"]) for x in p}
    bm={int(x["time"]):float(x["close"]) for x in b}
    if set(pm)!=set(bm):raise ValueError("P35_SOURCE_H1_PENGU_BTC_MISALIGNED")
    contexts={x["entryTs"]:shadow_case(x,pm,bm) for x in original}
    if sum(z["state"]=="CAUSAL_LAST_COMPLETED_H1_PRICE_CONTEXT" for z in contexts.values())!=53:
        raise ValueError("P35_CAUSAL_H1_DATA_NOT_AVAILABLE_FOR_ALL_53")
    events=[{**x,"originalNativeShortSignalUnchanged":True,
             "p35AsOfFeature":contexts[x["entryTs"]],
             "p35ShadowEligibility":{model:eligible(model,contexts[x["entryTs"]]) for model in MODELS},
             "p35SourceNet30Pct":x["net30pct"],
             "p35ReferenceCapitalPctPointsAt0p75":float(x["net30pct"])*GROSS,
             "P35VenueSignedFillProof":False}
             for x in original]
    result=[outcomes(original,contexts,model) for model in MODELS]
    originalReference=result[0]
    if not(originalReference["keptWins"]==29 and
            originalReference["retrospectiveShadowKept"]==53 and
            originalReference["retrospectiveShadowRejected"]==0):
        raise ValueError("P35_NATIVE53_UNMODIFIED_NOT_PARITY")
    overlap=positions_intersections(original)
    if overlap["sourceOriginal53PairwiseOverlappingWindows"]<1:
        raise ValueError("P35_ORIGINAL53_OVERLAPPING_ORIGIN_ASSUMPTION_CHANGED")
    data={
      "schema":"prism7-p35-pengu-original-native53-0p75-btc6h-shadow-negative-control/v1",
      "originalNativePinnedSHA":PIN,
      "originalSource53Parity":"EXACT_53_53_WINS29",
      "original53NaturalEntryAndExitUntouched":True,
      "grossFixed":GROSS,"feeBps":FEE,
      "sourceH1PriceAlignment":"PENGU_BTC_H1_EXACT_FULL_CALENDAR",
      "causalSignalReferenceHour":"native entryTs - H, not bar of entryTs and no future bars",
      "native53OverlapCaveat":overlap,
      "models":MODELS,
      "allFourRetrospectiveShadowModels":result,
      "sourceHashes":{
       "originalNative53Json":hashlib.sha256(args.native53.read_bytes()).hexdigest(),
       "PENGUH1":psha,"BTCH1":bsha,
      },
      "limitations":[
       "Original pinned native V20 signals have different meaning and entry/exit than S4 SELLER research route. A global BTC6h gate on all original53 is a negative-control shadow, NOT a proposed V20 live filter.",
       "Native source53 intervals overlap and cannot be stacked into real single-slot compounding or portfolio M5 mark DD. P35 reports per-opportunity raw native PnL scaled by gross0.75 only.",
       "Historical source53 was previously used in research, so this is neither independent time OOS nor blind statistical corroboration.",
       "No new signal or exit, no actual order book or venue signed fills, funding or actual Shared Runner Risk. Production not touched.",
      ],
    }
    args.out_summary.parent.mkdir(parents=True,exist_ok=True)
    args.out_summary.write_text(json.dumps(data,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf-8")
    args.out_all53.write_text(json.dumps(events,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf-8")
    print("PRISM7_P35_ORIGINAL_PIN_NATIVE53_EXACT_PARITY_BTC_H1_CAUSAL_SHADOW_0P75_PASS")
    print("INTERVAL_OVERLAP",json.dumps(overlap))
    for x in result:
      print("NEGATIVE_CONTROL",json.dumps({k:x[k] for k in (
       "model","retrospectiveShadowKept","keptWins","keptLosses","conditionalWinRatePct",
       "conditionalMeanNetPctOnCapital","nativeRetrospectiveShadowProfitFactor",
       "netPctPointSumPer53OriginalOpportunitiesAtFixedGross",
       "nativeOriginalWinningGrossReturnPctPointsLostAt0p75",
       "nativeOriginalLosingGrossReturnPctPointsAvoidedAt0p75")}))
if __name__=="__main__":main()
