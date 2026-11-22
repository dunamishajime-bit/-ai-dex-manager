#!/usr/bin/env python3
"""PRISM VII P55: M5 first-positive-volume-at-OPEN information timing audit.

Older P20/H1 research used a future M5 candle's volume >0 to select that
*same candle's OPEN* as the entry-price proxy. This volume is only confirmed
when the candle completes, so this bar-selection/price pairing is not
strictly as-of. Audit on unchanged H1 candidates.

OLD: first positive-volume M5 candle OPEN (P20 execution_proxy).
NEW: after first full positive-volume M5 has CLOSED, hypothetical short at
     the NEXT M5 candle OPEN (entry bar own volume NEVER consulted).
New next-open still not an exchange-signed fill (could be zero-volume).
Compare same source signals, gross .75, stop72 reference; no production.
"""
from __future__ import annotations
import hashlib,json,math
from collections import Counter,defaultdict
from pathlib import Path
from prism7_p20_pengu_s3_market_structure_native_source_comparison_20261122 import (
 stop72,execution_proxy,M5,DATA_END
)
from prism7_native53_event_attribution_20261122 import load_m5
from prism7_p42_pre_onset_first_downleg_hybrid_20261122 import (
 R,SOURCE,SOURCES,single_slot,economic,GROSS
)
SRC47=R/"PRISM7_P47_LAYER_A_SELLER_STRUCTURE_B_FIRST_DOWNLEG_20261122.json"
SRC48=R/"PRISM7_P48_TRUE_FIRST_DOWNLEG_ALL_CANDIDATES_LEDGER_20261122.jsonl"
SRC51=R/"PRISM7_P51_INITIAL_SHORT_M5_SELLING_PERSISTENCE_ENTRY_20261122.json"
OUT=R/"PRISM7_P55_FIRST_POSITIVE_M5_SAME_BAR_OPEN_LOOKAHEAD_AUDIT_20261122.json"
MD=R/"PRISM7_P55_FIRST_POSITIVE_M5_SAME_BAR_OPEN_LOOKAHEAD_AUDIT_20261122.md"
LEDGER=R/"PRISM7_P55_H1_CANDIDATE_OLD_NEW_FIRST_PRINT_ENTRY_LEDGER_20261122.jsonl"
SETS=("P47_ALL_FIRST_H1_BREAK_149","P47_H1_PREARM6_ALL3_21",
      "P48_STRICT_CLEAN_H1_FIRST107","P48_STRICT_CLEAN_PREARM6_8")
FEES=(10,30)
COVER_STRESS=(0,100)
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def rnd(x,n=5):return round(float(x),n)
def is_clean(x):
    f=x["P48preOnsetProvenance"]
    return f["prearm6NoPriorMinus3Pct"] and f["prearmToBeforeBreakNoDown3Pct"] and f["prearmToBeforeBreakPriorStructuralBreakCount"]==0
def prearm6(x):return x["layerA"]["prearmahead"][1]["all3"]
def first_print_audits(x,m5):
    originalIntent=x["intentTs"]
    # direct source lookahead reference (known only after the positive
    # volume bar closes, yet priced at its beginning):
    found=execution_proxy(m5,originalIntent)
    if found is None:
        return {"hasPositivePrintWithinOneHour":False,
                "sourceH1SignalIntentTs":originalIntent,
                "priorStudyFirstPositiveOpenTimingLeakPresent":False,
                "candidateWithoutPositivePrintedM5MustBeRejected":True}
    first,oldPx,delay=found
    completed=first+M5
    if completed-originalIntent>60*60000:raise ValueError("P55_TOO_LATE_PRINT")
    if float(m5[first][5])<=0:raise ValueError("P55_POSITIVE_PRINT_PARITY")
    bar=m5.get(completed)
    if bar is None:raise ValueError("P55_NEXT_OPEN_NOT_AVAILABLE")
    return {
      "sourceH1SignalIntentTs":originalIntent,
      "hasPositivePrintWithinOneHour":True,
      "P20OriginalPriceProxyM5OpenTs":first,
      "P20OriginalPriceProxyOpenPx":oldPx,
      "positivePrintBarM5VolumeKnownAtEndTs":completed,
      "positivePrintVolumeInThatBar":float(m5[first][5]),
      "newNextM5OpenTsAfterObservedPrint":completed,
      "newNextM5OpenPx":float(bar[1]),
      "entryBarNewPriceProxyFutureVolumeExPost":float(bar[5]),
      "entryBarFutureVolumeNotUsedForNewDecision":True,
      "additionalLatencyMinutes":5,
      "oldFirstPositiveM5DelayMinutes":delay,
      "oldSourceFirstPositiveAtOpenHasOwnBarVolumeLookahead":True,
      "researchAlternativeSignedFillNotProven":True
    }
def strict_select(source,m5,cached):
    selected=[];busy=-1;blocked=0;noPrint=0
    for x in sorted(source,key=lambda x:(x["intentTs"],x["id"])):
       if x["intentTs"]<busy:
          blocked+=1;continue
       audit=cached[x["id"]]
       if not audit["hasPositivePrintWithinOneHour"]:
          noPrint+=1;continue
       t=audit["newNextM5OpenTsAfterObservedPrint"]
       px=audit["newNextM5OpenPx"]
       exit_=stop72(m5,t,px)
       z={**x,"status":exit_["status"],"entryTs":t,"entryPrice":px,
          "exitTs":exit_.get("exitTs"),"exitPrice":exit_.get("exitPrice"),
          "reason":exit_.get("exitReason"),"sourceVenueSignedFill":False,
          "entryBarZeroVolumeEXPOST":not audit["entryBarNewPriceProxyFutureVolumeExPost"]>0,
          "firstPositiveM5BarWasFullyCompletedAtEntryDecision":True}
       selected.append(z)
       busy=(z["exitTs"]+M5) if exit_["status"]=="PRICE_PROXY_CLOSED" else DATA_END
    return selected,{"slotBlocked":blocked,"noPositivePrint":noPrint,
        "exPostZeroVolumeAtScheduledEntry":sum(z["entryBarZeroVolumeEXPOST"] for z in selected)}
def paired_outcomes(source,m5,cached):
    result=[];unpaired=0
    for x in source:
       audit=cached[x["id"]]
       if not audit["hasPositivePrintWithinOneHour"]:
          unpaired+=1;continue
       ot=audit["P20OriginalPriceProxyM5OpenTs"];op=audit["P20OriginalPriceProxyOpenPx"]
       nt=audit["newNextM5OpenTsAfterObservedPrint"];np=audit["newNextM5OpenPx"]
       old=stop72(m5,ot,op);new=stop72(m5,nt,np)
       def stat(t,px,e):
          if e["status"]!="PRICE_PROXY_CLOSED":return None
          return rnd(100*GROSS*((px-e["exitPrice"])/px-.003))
       result.append({"id":x["id"],"cohort":x["cohort"],"intent":x["intentTs"],
          "oldEntryTs":ot,"oldEntryPx":op,"newEntryTs":nt,"newEntryPx":np,
          "oldStatus":old["status"],"newStatus":new["status"],
          "oldEndTs":old.get("exitTs"),"newEndTs":new.get("exitTs"),
          "old30NetOnEquityPct":stat(ot,op,old),
          "new30NetOnEquityPct":stat(nt,np,new),
          "futureNewEntryBarVolExpost":audit["entryBarNewPriceProxyFutureVolumeExPost"],
          "pricesOnlyNotBooked":True})
    return result,unpaired
def main():
    source=json.loads(SOURCE.read_text(encoding="utf8"))
    assert len(source)==53 and sum(x["net30pct"]>0 for x in source)==29
    src47=json.loads(SRC47.read_text(encoding="utf8"))
    src51=json.loads(SRC51.read_text(encoding="utf8"))
    assert src47["scenarioCount"]==64 and src51["strictInitialUndroppedCandidates"]==107
    r48=[json.loads(x) for x in SRC48.read_text(encoding="utf8").splitlines() if x.strip()]
    assert len(r48)==149
    segments={
       SETS[0]:r48,
       SETS[1]:[x for x in r48 if prearm6(x)],
       SETS[2]:[x for x in r48 if is_clean(x)],
       SETS[3]:[x for x in r48 if is_clean(x) and prearm6(x)]
    }
    assert [len(segments[k]) for k in SETS]==[149,21,107,8]
    m5,msha=load_m5(SOURCES)
    audit={x["id"]:first_print_audits(x,m5) for x in r48}
    assert len(audit)==149
    result=[];traces=[]
    for segment,raw in segments.items():
        original,origBlock=single_slot(raw,{},m5)
        changed,block=strict_select(raw,m5,audit)
        if segment in SETS[:2]:
            mode="A_NONE_CONTROL" if segment==SETS[0] else "A_PREARM_6H_STABLE"
            reference=next(z for z in src47["allScenarios"] if z["layerA"]==mode and
             z["layerB"]=="B_FIRST_H1_MINUS1_BREAK" and z["feeBps"]==30 and z["extraBuyCoverBps"]==0)
            o=economic(original,m5,30,0)
            for k in ("closed","wins","finalProxyNavYen","M5HighStressDDPct"):
                assert abs(o[k]-reference["capital"][k])<1e-7,("P55_SOURCE_P47_REPRICE_DRIFT",segment,k,o[k],reference["capital"][k])
        paired,noPrint=paired_outcomes(raw,m5,audit)
        for fee in FEES:
          for cover in COVER_STRESS:
            o=economic(original,m5,fee,cover)
            n=economic(changed,m5,fee,cover)
            result.append({
              "sourceSignalFamily":segment,"sourcePotentialH1Intents":len(raw),
              "pairedIndependentIntentsWithPrintedM5":len(paired),
              "sourceNoPrintedM5Within60m":noPrint,
              "oldP20OccupiedSlot":origBlock["blocked"],
              "newCausalOccupiedSlot":block["slotBlocked"],
              "oldSelected":len(original),"newSelected":len(changed),
              "newExPostZeroEntryVolume":block["exPostZeroVolumeAtScheduledEntry"],
              "feeBps":fee,"extraBuyCoverBps":cover,
              "oldFirstPositiveBarOpen":o,"newObservedPrintedM5ThenNextOpen":n
            })
        traces.append({
          "family":segment,"oldSelectedIds":[x["id"] for x in original],
          "newSelectedIds":[x["id"] for x in changed],
          "pairedNonportfolioOutcomes":paired})
    assert len(result)==len(SETS)*len(FEES)*len(COVER_STRESS)
    normal=[z for z in result if z["feeBps"]==30 and z["extraBuyCoverBps"]==0]
    out={"schema":"prism7-p55-first-positive-M5-volume-confirmed-timing-anti-lookahead-audit/v1",
      "status":"RESEARCH_ONLY__CORRECTS_EXECUTION_TIMING_ASSUMPTION_NOT_NATIVE_RUNNER",
      "sourceNative53Wins29Unmodified":True,
      "P47OriginalFirstPositiveM5OPENEconomicSourceParity":True,
      "firstPositiveM5BarVolumeIsKnownOnlyAtBarClose":True,
      "usingThatFuturePositiveVolumeToChooseSameBarOPENIsNoncausal":True,
      "P20ExecutionProxySourceLogic":"Find first future 5m bar with its volume>0; select that SAME bar's open (5min lookahead for volume-based fill-time selection).",
      "P55TimeCausalAlternative":"After that positive-volume bar completes, submit a hypothetical order priced at the NEXT 5m bar open; no future entry bar volume gate.",
      "alternativeStillNotSignedVenueFillOrLiquidExPost":True,
      "originalSignalNativeSource53NotChanged":True,
      "groups":list(SETS),
      "gross":GROSS,"feeBps":FEES,"additionalBuyCoverStressBps":COVER_STRESS,
      "scenarioCount":len(result),"scenarios":result,
      "normal30bps":normal,
      "source149H1FirstBreakAsOfPrintAudits":audit,
      "perGroupPositionComparisons":traces,
      "sourceSHA256":{"P47":sha(SRC47),"P48":sha(SRC48),"P51":sha(SRC51),"native53":sha(SOURCE),"PENGU_M5":msha},
      "limitations":[
         "This is a research price-model timing audit, not a formal statement that the real LIVE Native V20 order engine uses a future volume bar at OPEN.",
         "Time-causal next-bar price is itself a proxy not executable evidence, especially if the next bar has zero trading volume.",
         "Changing the initial entry time also changes reference P20 72h STOP/exit and which overlapping positions get single-slot admission.",
         "These four signal families are H1-based early models, NOT exactly pinned Native V20 source entry/exit.",
         "The P20 stop72 overlay is not exact Native V20 and its protective STOP/funding/slippage may be inaccurate.",
         "No untouched OOS, no orderbook/real signed fills, cross-runner gross, exchange resident STOP priority, liquidation, margin or basis.",
         "No code deployed to LIVE; research result requires separate production pin executor review before any fixes.",
      ]}
    OUT.write_text(json.dumps(out,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf8")
    LEDGER.write_text("".join(json.dumps(x,ensure_ascii=False,sort_keys=True)+"\n" for x in traces),encoding="utf8")
    lines=["# P55 | M5 volume-based fill-time lookahead in earlier research price model",
      "",
      "Original P20 H1 study chooses first future positive-volume M5 candle *at that candle's OPEN*. But volume becomes observable only at candle CLOSE. P55 compares that optimistic open-price model with waiting to observe the printed candle and pricing the subsequent 5m OPEN.",
      "",
      "| Signal source | Source H1 candidates | Old closed | Old wins | Old M5 DD | Old ¥10k NAV | New closed | New wins | New M5 DD | New ¥10k NAV | New entry bar zero-volume ex post |",
      "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|"]
    for x in normal:
       o=x["oldFirstPositiveBarOpen"];n=x["newObservedPrintedM5ThenNextOpen"]
       lines.append("| "+x["sourceSignalFamily"]+" | "+str(x["sourcePotentialH1Intents"])+" | "+str(o["closed"])+" | "+str(o["wins"])+" | "+str(o["M5HighStressDDPct"])+"% | "+str(o["finalProxyNavYen"])+" | "+
         str(n["closed"])+" | "+str(n["wins"])+" | "+str(n["M5HighStressDDPct"])+"% | "+str(n["finalProxyNavYen"])+" | "+
         str(x["newExPostZeroEntryVolume"])+" |")
    lines+=["","**This is a research execution-model correction test.** It does not imply the real Native V20 LIVE runner reads future M5 volume. Both old and new are not signed fills. No production modification."]
    MD.write_text("\n".join(lines)+"\n",encoding="utf8")
    print("P55_FIRST_POSITIVE_M5_VOLUME_SAME_BAR_OPEN_CAUSAL_RETIMING_P47_SOURCE_PARITY_PASS",
      json.dumps({"cases":len(result),
        "normal":[{"family":x["sourceSignalFamily"],"candidates":x["sourcePotentialH1Intents"],
          "oldN":x["oldFirstPositiveBarOpen"]["closed"],"oldWins":x["oldFirstPositiveBarOpen"]["wins"],
          "oldDD":x["oldFirstPositiveBarOpen"]["M5HighStressDDPct"],
          "newN":x["newObservedPrintedM5ThenNextOpen"]["closed"],"newWins":x["newObservedPrintedM5ThenNextOpen"]["wins"],
          "newDD":x["newObservedPrintedM5ThenNextOpen"]["M5HighStressDDPct"],
          "oldNav":x["oldFirstPositiveBarOpen"]["finalProxyNavYen"],
          "newNav":x["newObservedPrintedM5ThenNextOpen"]["finalProxyNavYen"],
          "newZeroVolumeAtEntry":x["newExPostZeroEntryVolume"]}
          for x in normal]},ensure_ascii=False),flush=True)
    print("FILES",OUT,MD,LEDGER)
if __name__=="__main__":main()
