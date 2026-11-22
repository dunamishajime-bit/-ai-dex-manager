#!/usr/bin/env python3
"""P45 read-only hybrid lifecycle:
existing Native53 P44 context-eligible ONLY, with unchanged Native exits;
new first-downleg preALL3 first-episode crossing, common research stop72.
One sequential slot; optional Native re-entry freeze after an Early short exit.
Exact research models are not full source pin or venue-bookable.
"""
from __future__ import annotations
import json,hashlib
from pathlib import Path
from collections import Counter,defaultdict
from prism7_p38_causal_multihorizon_entry_20261122 import SOURCES
from prism7_native53_event_attribution_20261122 import load_m5
from prism7_p20_pengu_s3_market_structure_native_source_comparison_20261122 import execution_proxy,stop72,M5,H,DATA_END
from prism7_p44_native53_pre_drop_context_source_exit_20261122 import economy as source_mark_to_market_economy
from prism7_p42_pre_onset_first_downleg_hybrid_20261122 import R,GROSS,FEES,COVER_SLIPS
P43=R/"PRISM7_P43_INITIAL_DOWNLEG_CAUSAL_SIGNAL_LIST_20261122.jsonl"
P44=R/"PRISM7_P44_NATIVE53_PRE_DROP_CONTEXT_0P75_SINGLE_SLOT_20261122.json"
OUT=R/"PRISM7_P45_FIRST_DROP_PLUS_FILTERED_NATIVE_REENTRY_20261122.json"
MD=R/"PRISM7_P45_FIRST_DROP_PLUS_FILTERED_NATIVE_REENTRY_20261122.md"
DETAIL=R/"PRISM7_P45_FIRST_DROP_PLUS_FILTERED_NATIVE_REENTRY_SELECTED_20261122.jsonl"
MODES=("NATIVE_REGIME_ONLY","EARLY_FIRST_EPISODE_ONLY","HYBRID_NO_REENTRY_FREEZE",
       "HYBRID_NATIVE_FREEZE_24H_AFTER_EARLY_EXIT","HYBRID_NATIVE_FREEZE_48H_AFTER_EARLY_EXIT",
       "HYBRID_NATIVE_FREEZE_72H_AFTER_EARLY_EXIT")
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def first_eligible():
    p43=[json.loads(x) for x in P43.read_text(encoding="utf8").splitlines() if x.strip()]
    early=[]
    for x in p43:
      if x["thresholdPct"]!=3 or not x["firstDowncrossIn48h"]:continue
      f=x["prior"]["flags"]
      if not all(f[k] for k in ("btcBear","relativeWeak","emaBear")):continue
      early.append({**x,"entryIntentTs":x["intentTs"]})
    assert len(early)==15
    return early
def native_eligible():
    p44=json.loads(P44.read_text(encoding="utf8"))
    assert p44["targetNativeSourcePeriodCounts"]=={"PRE":"1/3 wins","BASE":"17/17 wins","POST":"1/1 wins"}
    nat=[x for x in p44["targetDetailed53"]["all53Matched"] if x["all3"]]
    assert len(nat)==21 and sum(x["sourceNativeNet30Pct"]>0 for x in nat)==19
    return nat
def emit_selected(e_source,n_source,m5,mode):
    selected=[];log=[];busy=-1;last_early_exit=-1
    early=mode!="NATIVE_REGIME_ONLY"
    native=mode!="EARLY_FIRST_EPISODE_ONLY"
    raw=[]
    if early:
      for x in e_source:
        raw.append({"side":"EARLY","intent":x["entryIntentTs"],"id":x["id"],"source":x})
    if native:
      for x in n_source:
        raw.append({"side":"NATIVE","intent":x["entryTs"],"id":x["key"],"source":x})
    if mode=="HYBRID_NATIVE_FREEZE_24H_AFTER_EARLY_EXIT":freeze=24*H
    elif mode=="HYBRID_NATIVE_FREEZE_48H_AFTER_EARLY_EXIT":freeze=48*H
    elif mode=="HYBRID_NATIVE_FREEZE_72H_AFTER_EARLY_EXIT":freeze=72*H
    else:freeze=0
    for c in sorted(raw,key=lambda x:(x["intent"],0 if x["side"]=="NATIVE" else 1,x["id"])):
        if c["intent"]<busy:
            log.append({"id":c["id"],"status":"OCCUPIED","intent":c["intent"]});continue
        if c["side"]=="NATIVE" and last_early_exit>0 and c["intent"]<last_early_exit+freeze:
            log.append({"id":c["id"],"status":"POST_EARLY_NATIVE_REENTRY_FREEZE","intent":c["intent"]});continue
        if c["side"]=="NATIVE":
            x=c["source"]
            z={**x,"sourceSide":"NATIVE","sourceOriginalExitRetained":True}
        else:
            x=c["source"]
            found=execution_proxy(m5,c["intent"])
            if found is None:
                log.append({"id":c["id"],"status":"NO_POSITIVE_M5_ENTRY_WITHIN1H","intent":c["intent"]});continue
            start,px,_=found
            stop=stop72(m5,start,px)
            if stop["status"]!="PRICE_PROXY_CLOSED":
                # No retrospective convenient invented exit. Position is RIGHT CENSORED.
                log.append({"id":c["id"],"status":"RIGHT_CENSORED_BLOCKS_FURTHER_TRADES",
                            "intent":c["intent"],"stop":stop})
                busy=DATA_END
                continue
            z={"key":c["id"],"period":x["cohort"],"id":c["id"],
                "entryTs":start,"entryPrice":px,
                "exitTs":stop["exitTs"],"exitPrice":stop["exitPrice"],
                "sourceExitReason":stop["exitReason"],"sourceSide":"EARLY",
                "sourceOriginalExitRetained":False}
        if z["exitTs"]<z["entryTs"]:raise ValueError("P45_BAD_EXECUTION_ORDER")
        selected.append(z)
        busy=z["exitTs"]+M5
        if c["side"]=="EARLY":last_early_exit=z["exitTs"]
        log.append({"id":c["id"],"status":"SINGLE_SLOT_SELECTED",
                    "intent":c["intent"],"entry":z["entryTs"],"exit":z["exitTs"]})
    return selected,log
def main():
    e=first_eligible()
    n=native_eligible()
    m5,shaM5=load_m5(SOURCES)
    p44=json.loads(P44.read_text(encoding="utf8"))
    sample=[]
    detail=[]
    for mode in MODES:
      rows,exclusion=emit_selected(e,n,m5,mode)
      c=Counter(z["sourceSide"] for z in rows)
      for fee in FEES:
        for slip in COVER_SLIPS:
           eco=source_mark_to_market_economy(rows,m5,fee,slip)
           rec={"model":mode,"source53NativeContextQualified":len(n),
               "firstDownlegEpisodeCandidates":len(e),
               "selectedNative":c["NATIVE"],"selectedEarly":c["EARLY"],
               "blockedBySlot":sum(z["status"]=="OCCUPIED" for z in exclusion),
               "blockedNativeByReentryFreeze":sum(z["status"]=="POST_EARLY_NATIVE_REENTRY_FREEZE" for z in exclusion),
               "sourceNativePriceBasedExitUnchanged":True,
               "earlyUsesReferenceStop72NotOriginalNativeExit":True,
               "feeBps":fee,"extraBuyCoverSlipBps":slip,
               "capital":eco}
           sample.append(rec)
           if fee==30 and slip==0:
              detail.append({"model":mode,"selected":[{"id":z["key"],
                "cohort":z["period"],"side":z["sourceSide"],"entryTs":z["entryTs"],"exitTs":z["exitTs"],
                "entryPx":z["entryPrice"],"exitPx":z["exitPrice"],
                "entryWasOriginalNative":z["sourceSide"]=="NATIVE"} for z in rows],
                "exclusion":exclusion})
    assert len(sample)==len(MODES)*len(FEES)*len(COVER_SLIPS)
    reference=next(z for z in p44["modelGrid"] if z["thresholdPct"]==3 and
         z["hours"]==48 and z["feeBps"]==30 and z["extraBuyCoverSlipBps"]==0)
    native=next(z for z in sample if z["model"]=="NATIVE_REGIME_ONLY" and z["feeBps"]==30 and z["extraBuyCoverSlipBps"]==0)
    for k in ("singleSlotPositions","wins","M5HighStressMarkedDDPct","finalNAVYen"):
       assert abs(native["capital"][k]-reference["economics"][k])<=1e-7,(k,native["capital"][k],reference["economics"][k])
    normal=[z for z in sample if z["feeBps"]==30 and z["extraBuyCoverSlipBps"]==0]
    report={
      "schema":"prism7-p45-d3-preall3-first-downleg-plus-source-native-short-retro-portfolio/v1",
      "status":"RESEARCH_ONLY_IN_SAMPLE_NOT_SAME_SOURCE_NATIVE_ENTER_EXIT",
      "sourceNative53OriginalWins29Preserved":True,
      "p44SourceRegimeNativeSingleSlotParity":True,
      "sourceNative53PriorD3All3Qualified21":len(n),
      "firstEpisodeD3PriorAll3Candidates15":len(e),
      "nativeSourceEntryAndExitExactOriginalReference":True,
      "newEarlyExperimentalEntryExitNotNative":True,
      "scenariosCount":len(sample),"models":MODES,
      "allScenarios":sample,"normal30bps":normal,
      "sampleSelectedLedgers":detail,
      "inputSHA":{"p43":sha(P43),"p44":sha(P44),"m5":shaM5},
      "fixedGross":GROSS,
      "limitations":[
       "Different entry families and exit price models: native source H1 pin price vs early source first positive M5 open + P20 reference stop72; no integrated production H1/M5 exit parity.",
       "PRE/BASE/POST have been studied extensively; the best in-sample scenario is not a true blind performance prediction.",
       "Native source 53 original entries overlap; single-slot tie and chronological exclusions approximate capital conflicts but not actual shared portfolio risk.",
       "No signed execution, funding, spot/perp bid/ask, queue, real STOP order priority, liquidation, other Runners or Production DD.",
       "Reentry freeze 24/48/72 hours is a research change, not already-deployed Native V20 policy.",
       "Original V20 runtime or LIVE orders must not be modified on this evidence."
      ]}
    OUT.write_text(json.dumps(report,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf8")
    DETAIL.write_text("".join(json.dumps(x,ensure_ascii=False,sort_keys=True)+"\n" for x in detail),encoding="utf8")
    md=[
      "# P45: First-drop early Short + Native V20 regime-confirmed rebound Short",
      "",
      "This is a research-only exact-source-Native-exit plus experimental-early-stop mixed model.",
      "",
      "| Model | Closed | Win% | M5 High DD | NAV | Native selected | Early selected |",
      "|---|---:|---:|---:|---:|---:|---:|"]
    for x in normal:
       eco=x["capital"]
       md.append("| "+x["model"]+" | "+str(eco["singleSlotPositions"])+" | "+str(eco["conditionalWinPct"])+"% | "+str(eco["M5HighStressMarkedDDPct"])+"% | "+str(eco["finalNAVYen"])+" | "+str(x["selectedNative"])+" | "+str(x["selectedEarly"])+" |")
    md.extend(["","No true holdout, no certified original Native full exit parity for newly added early trades. No LIVE promotion."])
    MD.write_text("\n".join(md)+"\n",encoding="utf8")
    print("P45_MIXED_ENTRY_NATIVE_SOURCE_EXIT_PARITY_ALL_MODELS_PASS",json.dumps({
      "sourceNativeParity":True,"scenarios":len(sample),
      "normal":[{"mode":x["model"],"closed":x["capital"]["singleSlotPositions"],"win":x["capital"]["conditionalWinPct"],
                "dd":x["capital"]["M5HighStressMarkedDDPct"],"nav":x["capital"]["finalNAVYen"],
                "native":x["selectedNative"],"early":x["selectedEarly"],
                "reentryBlocked":x["blockedNativeByReentryFreeze"]} for x in normal]
    },ensure_ascii=False),flush=True)
    print("OUT",OUT,MD,DETAIL)
if __name__=="__main__":main()
