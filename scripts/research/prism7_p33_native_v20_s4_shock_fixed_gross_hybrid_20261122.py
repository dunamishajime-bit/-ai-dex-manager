#!/usr/bin/env python3
"""P33 Source S4 structural entry+native V20 pure EXIT+M5 shock+fixed gross.

FROZEN 120 opportunity source original pinned SHA; no selection based on PnL.
Re-detect all native-position candidate cross-asset shocks up to native EXIT (not
P22 reference stop), add optional post-event positive print execution and re-run
1slot opportunity admissions. Research price proxies, NO signed fills.
"""
from __future__ import annotations
import argparse,json,csv,hashlib
from pathlib import Path
from collections import Counter
from prism7_native53_event_attribution_20261122 import load_m5
from prism7_p25_s4_cross_asset_capitulation_capture_20261122 import (
 load_btc_sanitized,first_event,rebuild
)
from prism7_p21_pengu_s3_m5_seller_confirmation_fsm_20261122 import apply_single_slot
from prism7_p28_layer3_fixed_gross_capital_allocation_20261122 import scan
GROSS=(.75,1.,1.25)
DELAY=(1,2,3)
SLIP=(0,25,100,500,1000)
FEES=(10,30)
STOP_NATIVE="PINNED_SOURCE_SHORT_V20_P32_NATIVE_EXIT"
SOURCE_PIN="1657e173d250ad58f53e62f7bb0a3428fb405496"
REF_COHORTS=("PRE_2025_AUG_SEP","BASE_2025_2026","POST_2026_OCT_NOV")
def source_slot_all(native):
    slot=apply_single_slot(native)
    if len(slot)!=120:return None
    return slot
def robust_scan_native(row,pengu,btc):
    if row["entryProxyTs"] is None:return {"state":"NEVER_ENTERED_SOURCE_CANDIDATE"}
    # P25 source scanner recognizes first two SOURCE right censor statuses.
    # P32 model has the equivalent, distinct right-censored name.
    asif={**row}
    if row["status"].startswith("RIGHT_CENSORED"):
        asif["status"]="RIGHT_CENSORED_DATA_END"
    if asif["status"] not in ("PRICE_PROXY_CLOSED","RIGHT_CENSORED_DATA_END"):
        return {"state":"SOURCE_NATIVE_EXIT_NO_VALID_PRICE_PROXY","sourceStatus":row["status"]}
    return first_event(asif,pengu,btc)
def strict_replay_native_slot(native,oldSlot):
    a=source_slot_all(native)
    if a is None:raise ValueError("P33_NATIVE_SOURCE_CANDIDATE120_LOST")
    baseline={x["id"]:x for x in oldSlot}
    if len(baseline)!=120:raise ValueError("P33_SOURCE_NATIVE_SINGLE120_LOST")
    for x in a:
        o=baseline[x["id"]]
        for f in ("status","entryProxyTs","entryProxyPrice","exitProxyTs",
                  "exitProxyPrice","exitReason"):
            if x.get(f)!=o.get(f):
                raise ValueError("P33_BASE_NATIVE_SOURCE_ONE_SLOT_NOT_EXACT:"+x["id"]+":"+f)
    return a
def keep_case(row,detector,delay,slip):
    # preserve SOURCE native same bar STOP and phase priority.
    y=rebuild(row,detector,delay,slip)
    y["originalNativeV20ExitTs"]=row.get("exitProxyTs")
    y["originalNativeV20ExitPrice"]=row.get("exitProxyPrice")
    y["originalNativeV20ExitReason"]=row.get("exitReason")
    if y.get("p25EarlyExitApplied"):
        if y["exitProxyTs"]>=row.get("exitProxyTs",float("inf")):
            raise ValueError("P33_V20_SOURCE_STOP_MUST_PREEMPT_SHOCK_EXIT")
        if y["entryProxyTs"]>y["p25CompletedSignalCloseTs"]:
            raise ValueError("P33_SHOCK_TURNED_ON_BEFORE_OPEN")
    return y
def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--p32-all",type=Path,required=True)
    ap.add_argument("--p32-single",type=Path,required=True)
    ap.add_argument("--p32-summary",type=Path,required=True)
    ap.add_argument("--p32-risk",type=Path,required=True)
    ap.add_argument("--p25-summary",type=Path,required=True)
    ap.add_argument("--pengu-m5",type=Path,nargs="+",required=True)
    ap.add_argument("--btc-m5",type=Path,nargs="+",required=True)
    ap.add_argument("--out-summary",type=Path,required=True)
    ap.add_argument("--out-source-detections",type=Path,required=True)
    ap.add_argument("--out-trades",type=Path,required=True)
    a=ap.parse_args()
    native=json.loads(a.p32_all.read_text(encoding="utf-8"))
    native_slot=json.loads(a.p32_single.read_text(encoding="utf-8"))
    native_summary=json.loads(a.p32_summary.read_text(encoding="utf-8"))
    native_risk=json.loads(a.p32_risk.read_text(encoding="utf-8"))
    p25=json.loads(a.p25_summary.read_text(encoding="utf-8"))
    if not(len(native)==len(native_slot)==120 and len(set(x["id"] for x in native))==120):
        raise ValueError("P33_S4_120_ORIGINAL_ENTRIES_MUST_BE_INTACT")
    if (native_summary["immutablePinnedV20Sha"]!=SOURCE_PIN or
       native_summary["sourceNative53OriginalTradeParity"]!="PASS_53_53"):
        raise ValueError("P33_PINNED_NATIVE_SOURCE_53_NOT_PARITY")
    if p25["source120P22AllSetupParity"]!="PASS":
        raise ValueError("P33_P25_SOURCE120_UNCHANGED_NOT_PARITY")
    native_slot_repro=strict_replay_native_slot(native,native_slot)
    pm5,pm5sha=load_m5(a.pengu_m5)
    bm5,bm5sha,bad=load_btc_sanitized(a.btc_m5,native)
    source_events={x["id"]:robust_scan_native(x,pm5,bm5) for x in native}
    events=[x for x in native if source_events[x["id"]]["state"]=="CROSS_ASSET_CAPITULATION_CONFIRMED"]
    if len(events)>30:raise ValueError("P33_MANY_UNEXPECTED_SOURCE_PENGU_CAP_EVENTS")
    comparisons={}
    ref=p25["all120PerCandidateDetectionEvents"]
    for x in events:
      e=source_events[x["id"]];o=ref[x["id"]]
      comparisons[x["id"]]={
        "newSourceNativePriceEventTs":e["eventM5OpenTs"],
        "p25ReferenceEventState":o["state"],
        "p25ReferenceEventTs":o.get("eventM5OpenTs"),
        "nativeEntrySourceMatchesP25":o["state"]=="CROSS_ASSET_CAPITULATION_CONFIRMED" and
           e["eventM5OpenTs"]==o.get("eventM5OpenTs"),
        "sourceRealNativeExitTs":x.get("exitProxyTs"),
        "newEventMustBeBeforeNativeExit":e["eventCloseTs"]<(x.get("exitProxyTs") or 1794960000000),
      }
    fixedBaseline=next(z for z in native_risk["allCostRiskAndGrossScenarios"] if
      z["group"]=="PINNED_V20_EXIT_ON_S4" and z["feeBps"]==30 and
      z["sourceGrossMultiplier"]==1 and z["additionalExitSlipBps"]==0 and
      "capitalModel" not in z)
    if (fixedBaseline["priceProxyClosed"]!=21 or
       abs(fixedBaseline["sourceM5CloseMarkDDPct"]-35.94150348)>1e-6):
      raise ValueError("P33_SOURCE_NATIVE_V20_BASELINE_RISK_NOT_APPROVED")
    # Strict source compare even BEFORE adding shock overlay or choosing exposure.
    beforeSource,sourcePositions=scan(native_slot_repro,pm5,1.,30)
    if abs(beforeSource["sourceM5CloseMarkedDDPct"]-fixedBaseline["sourceM5CloseMarkDDPct"])>1e-6:
        raise ValueError("P33_NATIVE_V20_BASELINE_M5_MARK_DD_NOT_PARITY")
    if abs(beforeSource["sourceReferenceFinalEquityInclCensoredMarkYen"]-
          fixedBaseline["finalMarkedNAVYen"])>1e-4:
        raise ValueError("P33_NATIVE_V20_BASELINE_FINAL_NAV_NOT_PARITY")
    base30=next(z for z in native_summary["allCostAndSourceComparatorStats"]
      if z["group"]=="PINNED_NATIVE_S4_SINGLE_SLOT" and z["feeBps"]==30)
    if (beforeSource["conditionalWinCount"]!=base30["wins"] or
        beforeSource["originalSourceCompletedTradeCount"]!=base30["priceProxyClosed"] or
        abs(beforeSource["conditionalMeanNetReturnPctOnEquity"]-base30["meanNetPctConditional"])>1e-6):
        raise ValueError("P33_NATIVE_V20_ORIGINAL_WINRATE_PROFIT_NOT_PARITY")
    outputs=[]
    traces=[]
    caseMainCandidates=None
    for delay in DELAY:
      for slip in SLIP:
        new=[keep_case(x,source_events[x["id"]],delay,slip) for x in native]
        slot=source_slot_all(new)
        if len(slot)!=120:raise ValueError("P33_SLOT_120_SOURCE_CANDIDATES_LOST")
        fills=[z for z in slot if z["status"]=="PRICE_PROXY_CLOSED"]
        censored=[z for z in slot if z["status"].startswith("RIGHT_CENSORED")]
        occupied=sum(z["status"]=="OCCUPIED_SLOT" for z in slot)
        activated=[z for z in slot if z.get("p25EarlyExitApplied") and
                   z["status"]=="PRICE_PROXY_CLOSED"]
        counterfactualId={z["id"]:z for z in native_slot}
        newlyAdmitted=sum(z["status"]=="PRICE_PROXY_CLOSED" and
                        counterfactualId[z["id"]]["status"]=="OCCUPIED_SLOT" for z in slot)
        originalWon= {z["id"] for z in native_slot if z["status"]=="PRICE_PROXY_CLOSED" and
                100*(1-z["exitProxyPrice"]/z["entryProxyPrice"])-.3>0}
        for fee in FEES:
          for gross in GROSS:
            econ,records=scan(slot,pm5,gross,fee)
            item={
              "positiveM5ExitPrintAfterCausalShock":delay,
              "extraBuyToCoverSlipBps":slip,
              "roundtripFeeBps":fee,
              "grossPerSourceEntryEquity":gross,
              "originalH1S4Setups":len(slot),
              "sourceNativeExitUsesP32Pin":True,
              "sourceNativeUnchangedBaselineM5DDPct":fixedBaseline["sourceM5CloseMarkDDPct"],
              "allNativeEntryPriceProxyCount":sum(z["entryProxyTs"] is not None for z in native),
              "nativePriceExitBeforeShockDecisionKept":True,
              "sourceDetectedCrossAssetEvents":len(events),
              "singleSlotShockBuyToCoverApplied":len(activated),
              "nativeSourceSlotReferenceCompleted":base30["priceProxyClosed"],
              "selectedPriceProxyCompleted":len(fills),
              "selectedRightCensored":len(censored),
              "occupiedSourceSetups":occupied,
              "sourcePreviouslyOccupiedNewlyAdmitted":newlyAdmitted,
              "oldNativeWinnersPreservedAsWinners":
                 sum(z["id"] in originalWon and
                     100*(1-z["exitProxyPrice"]/z["entryProxyPrice"])-fee/100>0 for z in fills),
              "referenceEconomicsAndRisk":econ,
            }
            outputs.append(item)
            for rec in records:
              traces.append({
                 "delay":delay,"extraExitSlipBps":slip,"feeBps":fee,"gross":gross,
                 "shockEarlyExitApplied":any(a["id"]==rec["id"] for a in activated),
                 **rec})
            if (delay==2 and slip==0 and fee==30 and gross==.75):
                caseMainCandidates=slot
    if len(outputs)!=90:raise ValueError("P33_NOT_PRECOMMITTED_90_SCENARIOS")
    if caseMainCandidates is None:raise ValueError("P33_MAIN_CASE_SOURCE_NOT_FOUND")
    originalSourceMarketPriceSignals={x["id"]:source_events[x["id"]] for x in native}
    report={
       "schema":"prism7-p33-s4-native-pin-v20-exit-capitulation-0p75fixed-gross-90cases/v1",
       "originalPinnedNativeV20SHA":SOURCE_PIN,
       "originalNatural53SourceParity":"PASS_53_53_29_WINS",
       "originalS4Source120StructureUnchanged":True,
       "nativeSource120OneSlotRecomputedAndExactCompared":True,
       "nativeSourceOriginal30BpsBeforeShock":beforeSource,
       "p25SourceKnownEventVsNewNativeExitEventComparison":comparisons,
       "eventSourceNativeNewScanCount":len(events),
       "eventSourceNativeCandidates":[x["id"] for x in events],
       "precommittedGrid":{"gross":GROSS,"delayPositiveM5":DELAY,
                           "additionalExitSlipBps":SLIP,"roundtripFeeBps":FEES},
       "allNinetyJointEconomicAndRiskScenarios":outputs,
       "sourceBTCM5OffPositionMalformed":bad,
       "inputHashes":{
         "sourceNativeP32AllCandidates":hashlib.sha256(a.p32_all.read_bytes()).hexdigest(),
         "sourceNativeP32SingleSlot":hashlib.sha256(a.p32_single.read_bytes()).hexdigest(),
         "sourceNativeP32Summary":hashlib.sha256(a.p32_summary.read_bytes()).hexdigest(),
         "sourceNativeP32Risk":hashlib.sha256(a.p32_risk.read_bytes()).hexdigest(),
         "originalP25":hashlib.sha256(a.p25_summary.read_bytes()).hexdigest(),
         "PENGU5M":pm5sha,"BTC5M":bm5sha,
       },
       "limitations":[
          "P33 shock thresholds were originally chosen AFTER seeing October 2025 historic flash event; the same period is in-sample and not independent OOS.",
          "P29 and P31 prove identical known shock/buyer-recovery prefixes can be followed by opposite trend; early-exit destroys original SHORT winner in downtrend futures.",
          "Native pinned V20 pure exit is adapted to new S4 entry; original V20 native signal did not produce that entry. This is NOT a production-equivalent S4Runner.",
          "Source positive M5 OPEN and within 5M STOP touches are not signed venue fills nor executable orderbook asks or market size.",
          "All-runner shared margin gross, funding, liquidation, daily loss7.5%, true portfolio mark DD unavailable.",
          "A numeric below20% isolated model DD for 1known shock would not qualify for live deployment.",
       ],
    }
    a.out_summary.parent.mkdir(parents=True,exist_ok=True)
    a.out_summary.write_text(json.dumps(report,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf-8")
    a.out_source_detections.write_text(json.dumps(originalSourceMarketPriceSignals,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf-8")
    with a.out_trades.open("w",encoding="utf-8",newline="") as f:
        w=csv.DictWriter(f,fieldnames=list(traces[0]))
        w.writeheader();w.writerows(traces)
    print("PRISM7_P33_NATIVE_EXIT_S4_SOURCE120_PLUS_FULL_CAUSAL_SHOCK_SCAN_90_GRID_PASS")
    for z in outputs:
        if (z["roundtripFeeBps"]==30 and z["grossPerSourceEntryEquity"] in (.75,1.) and
           z["extraBuyToCoverSlipBps"] in (0,1000) and
           z["positiveM5ExitPrintAfterCausalShock"] in (2,3)):
           a=z["referenceEconomicsAndRisk"]
           print("MAIN",json.dumps({"gross":z["grossPerSourceEntryEquity"],"delay":z["positiveM5ExitPrintAfterCausalShock"],
            "extra":z["extraBuyToCoverSlipBps"],"detected":z["sourceDetectedCrossAssetEvents"],
            "selectedShock":z["singleSlotShockBuyToCoverApplied"],
            "reAdmitted":z["sourcePreviouslyOccupiedNewlyAdmitted"],
            "closed":a["originalSourceCompletedTradeCount"],"win":a["conditionalWinCount"],
            "mean":a["conditionalMeanNetReturnPctOnEquity"],"pf":a["conditionalProfitFactor"],
            "M5DD":a["sourceM5CloseMarkedDDPct"],"highDD":a["sourcePrevCompletedM5PeakHighStressDDPct"],
            "NAV":a["sourceReferenceFinalEquityInclCensoredMarkYen"]}))
if __name__=="__main__":main()
