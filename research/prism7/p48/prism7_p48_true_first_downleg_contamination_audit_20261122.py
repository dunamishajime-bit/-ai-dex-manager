#!/usr/bin/env python3
"""PRISM7 P48 clean first downleg vs rebound masquerading as first.
Strict causal historical evidence; no trading change.

P47 six-H1-prearm apparent 72% model may contain cases that had already
undergone a >=3% 24h fall BEFORE its preparation decision. Enforce negative
3% context at prearm and no earlier 1h break in intermediate six-hour phase.

Evaluates all time-indexed B onset events, not only 18 winners.
Strict recipe labels fixed in source; output is diagnostics, not tuned strategy.
"""
from __future__ import annotations
import json,gzip,hashlib,math
from pathlib import Path
from collections import Counter,defaultdict
from prism7_p20_pengu_s3_market_structure_native_source_comparison_20261122 import h1_source,H
from prism7_native53_event_attribution_20261122 import load_m5
from prism7_p42_pre_onset_first_downleg_hybrid_20261122 import (
 R,SOURCES,PENGUH1,BTCH1,SOURCE,economic,single_slot,GROSS
)
from prism7_p47_preonset_supply_structure_layera_onsetb_20261122 import (
 arm_pass,BMODES
)
P47=R/"PRISM7_P47_LAYER_A_SELLER_STRUCTURE_B_FIRST_DOWNLEG_20261122.json"
P47LEDGER=R/"PRISM7_P47_ALL_CAUSAL_B_ONSET_PRECONDITION_LEDGER_20261122.jsonl.gz"
OUT=R/"PRISM7_P48_TRUE_FIRST_DOWNLEG_POSTDROP_CONTAMINATION_AUDIT_20261122.json"
MD=R/"PRISM7_P48_TRUE_FIRST_DOWNLEG_POSTDROP_CONTAMINATION_AUDIT_20261122.md"
LEDGER=R/"PRISM7_P48_TRUE_FIRST_DOWNLEG_ALL_CANDIDATES_LEDGER_20261122.jsonl"
MODELS=(
 "P47_PREARM6_ORIGINAL",
 "PREARM6_CLEAN_NOT_YET_MINUS3",
 "PREARM6_CLEAN_NO_FIVE_H1_DROP",
 "PREARM6_CLEAN_NO_EARLIER_STRUCTURAL_BREAK",
 "PREARM6_CLEAN_PRE_H1_SELLER_CONFIRM",
 "PREARM6_CLEAN_PREARM3_PERSISTENCE",
)
def sha(f):return hashlib.sha256(Path(f).read_bytes()).hexdigest()
def rnd(x,n=5):return round(float(x),n)
def feature(x,p,idx):
    t=x["signalReferenceTs"];i=idx[t]
    if p[i]["time"]!=t:raise ValueError("P48_H1_TS")
    j=i-6
    hstart=p[j]
    pre=p[i-1]
    if x["layerA"]["prearmahead"][1]["asofH1ReferenceTs"]!=hstart["time"]:
        raise ValueError("P48_PREARM6_TIMING_MISMATCH")
    prearm24=hstart["close"]/p[j-24]["close"]-1
    from_prearm_to_prev=pre["close"]/hstart["close"]-1
    earlier_full_breaks=[]
    for k in range(j+1,i):
        if p[k]["open"]>0 and (p[k]["close"]/p[k]["open"]-1)<=-.01 and p[k]["close"]<p[k-1]["low"]:
            earlier_full_breaks.append(p[k]["time"])
    seg=p[j+1:i]
    segvol=sum(z["volume"] for z in seg)
    red=sum(z["volume"] for z in seg if z["close"]<z["open"])
    seller=red/segvol if segvol>0 else None
    return {
      "prearm6Time":hstart["time"],
      "prearm6Return24Pct":rnd(100*prearm24),
      "prearm6NoPriorMinus3Pct":prearm24>-.03,
      "prearm6SourceP47SameTruth":(prearm24<=-.03)==x["layerA"]["prearmahead"][1]["prior24hAlreadyUnderMinus3"],
      "prearmToBeforeBreak5hReturnPct":rnd(100*from_prearm_to_prev),
      "prearmToBeforeBreakNoDown3Pct":from_prearm_to_prev>-.03,
      "prearmToBeforeBreakPriorStructuralBreakCount":len(earlier_full_breaks),
      "earlierStructuralBreakReferenceH1":earlier_full_breaks,
      "prearmToBeforeBreakSellerPrintVolumeShare":rnd(seller) if seller is not None else None,
      "sameRegimeAsP47PREARM3":x["layerA"]["prearmahead"][0]["all3"],
      "allAsOfBeforeSignalH1Close":True,
    }
def passmodel(x,model):
    if not arm_pass(x["layerA"],"A_PREARM_6H_STABLE"):return False
    f=x["P48preOnsetProvenance"]
    if model=="P47_PREARM6_ORIGINAL":return True
    if not f["prearm6NoPriorMinus3Pct"]:return False
    if model=="PREARM6_CLEAN_NOT_YET_MINUS3":return True
    if not f["prearmToBeforeBreakNoDown3Pct"]:return False
    if model=="PREARM6_CLEAN_NO_FIVE_H1_DROP":return True
    if not f["prearmToBeforeBreakPriorStructuralBreakCount"]==0:return False
    if model=="PREARM6_CLEAN_NO_EARLIER_STRUCTURAL_BREAK":return True
    if model=="PREARM6_CLEAN_PRE_H1_SELLER_CONFIRM":
      return f["prearmToBeforeBreakSellerPrintVolumeShare"] is not None and f["prearmToBeforeBreakSellerPrintVolumeShare"]>=.55
    if model=="PREARM6_CLEAN_PREARM3_PERSISTENCE":
      return f["sameRegimeAsP47PREARM3"]
    raise ValueError("P48_UNKNOWN_MODEL")
def main():
    original=json.loads(SOURCE.read_text(encoding="utf8"))
    assert len(original)==53 and sum(x["net30pct"]>0 for x in original)==29
    p,psha=h1_source(PENGUH1)
    b,bsha=h1_source(BTCH1)
    assert len(p)==len(b) and all(a["time"]==z["time"] for a,z in zip(p,b))
    m5,m5hash=load_m5(SOURCES)
    idx={x["time"]:i for i,x in enumerate(p)}
    source47=json.loads(P47.read_text(encoding="utf8"))
    assert source47["scenarioCount"]==64
    with gzip.open(P47LEDGER,"rt",encoding="utf8") as f:
      raw=[json.loads(line) for line in f if line.strip()]
    assert len(raw)==sum(source47["rawLayerBEvents"].values())
    eligible=[]
    for x in raw:
      if x["route"]!="B_FIRST_H1_MINUS1_BREAK" or not x["episodeFirst24h"]:continue
      pfeature=feature(x,p,idx)
      if not pfeature["prearm6SourceP47SameTruth"]:raise ValueError("P48_PREARM_SOURCE_PARITY")
      x["P48preOnsetProvenance"]=pfeature
      eligible.append(x)
    assert len(eligible)==source47["oneEpisodeFirst24hCount"]["B_FIRST_H1_MINUS1_BREAK"]
    for x in eligible:
       if x["layerA"]["prearmahead"][1]["asofH1ReferenceTs"]>=x["signalReferenceTs"]:
           raise ValueError("P48_BAD_NONCAUSAL_LEAD")
    scenarios=[];cache={};rows=[]
    for mode in MODELS:
      selected_eligible=[x for x in eligible if passmodel(x,mode)]
      chosen,blocked=single_slot(selected_eligible,cache,m5)
      sourceSelected={x["id"] for x in chosen}
      if mode=="P47_PREARM6_ORIGINAL":
        ref=next(x for x in source47["allScenarios"] if x["layerA"]=="A_PREARM_6H_STABLE"
                 and x["layerB"]=="B_FIRST_H1_MINUS1_BREAK" and x["feeBps"]==30 and x["extraBuyCoverBps"]==0)
        assert len(selected_eligible)==ref["prequalifiedLayerAEligible"]
      for slip in (0,100):
        e=economic(chosen,m5,30,slip)
        scenarios.append({"model":mode,"thresholdsDeclaredBeforeEvaluation":True,
           "eligibleSourceEvents":len(selected_eligible),"oneSlotSelected":len(chosen),
           "oneSlotBlocked":blocked["blocked"],"feeBps":30,"extraBuyCoverBps":slip,
           "gross":GROSS,"capital":e})
        if mode=="P47_PREARM6_ORIGINAL" and slip==0:
          for k in ("closed","wins","M5HighStressDDPct","finalProxyNavYen"):
             if abs(e[k]-ref["capital"][k])>1e-8:
               raise ValueError("P48_P47_BASELINE_DRIFT:"+k)
      rows.append({"model":mode,"eligibleSourceCases":[{
        "id":x["id"],"cohort":x["cohort"],"intentTs":x["intentTs"],"selectedOneSlot":x["id"] in sourceSelected,
        "first6PrearmClean":x["P48preOnsetProvenance"]["prearm6NoPriorMinus3Pct"],
        "prior5hDropPct":x["P48preOnsetProvenance"]["prearmToBeforeBreak5hReturnPct"],
        "priorFiveH1EarlierStructuralBreaks":x["P48preOnsetProvenance"]["prearmToBeforeBreakPriorStructuralBreakCount"]}
        for x in selected_eligible],
       "selectedTraces":[{"id":x["id"],"cohort":x["cohort"],"entryTs":x.get("entryTs"),
              "exitTs":x.get("exitTs"),"entryPx":x.get("entryPrice"),
              "exitPx":x.get("exitPrice"),"exitReason":x.get("reason")}
              for x in chosen]})
    normal=[z for z in scenarios if z["extraBuyCoverBps"]==0]
    base=next(z for z in normal if z["model"]=="P47_PREARM6_ORIGINAL")
    clean=next(z for z in normal if z["model"]=="PREARM6_CLEAN_NOT_YET_MINUS3")
    sourceOut={
      "schema":"prism7-p48-prearm6-post-drop-contamination-audit/v1",
      "status":"READ_ONLY__NO_INDEPENDENT_HOLDOUT",
      "originalNative53Intents":53,"originalNative53WinningCases":29,
      "P47SourceAndEconomicsExactParity":True,
      "oneSlotStatic0p75AndReference72HStopNotNativeV20":True,
      "beforeOnsetResearchB":"closed H1 <=-1% bearish and previous-low break",
      "prearmWasAlreadyBelow24hMinus3":{
          "fullSourceEligible":base["eligibleSourceEvents"],
          "cleanSourceEligible":clean["eligibleSourceEvents"],
          "postDropContaminated":base["eligibleSourceEvents"]-clean["eligibleSourceEvents"],
          "selectedP47OneSlotCount":base["oneSlotSelected"],
          "selectedP47AlreadyBelowD3":sum(z["selectedOneSlot"] and not z["first6PrearmClean"] for x in rows if x["model"]=="P47_PREARM6_ORIGINAL" for z in x["eligibleSourceCases"]),
          "selectedP47NotYetBelowD3":sum(z["selectedOneSlot"] and z["first6PrearmClean"] for x in rows if x["model"]=="P47_PREARM6_ORIGINAL" for z in x["eligibleSourceCases"])
      },
      "allScenarios":scenarios,"normalFee30NoExtraSlip":normal,"individualModels":rows,
      "inputSHA":{"P47":sha(P47),"P47SourceCandidates":sha(P47LEDGER),"PENGUH1":psha,"BTCH1":bsha,"PENGUM5":m5hash},
      "provenanceLimitations":[
        "Negative3pct per-prearm price check is measured from completed H1 at i-6; it only certifies the 24h end-to-end return at that moment, not absence of a prior intra24h >3% plunge.",
        "Even with H1 early structural breaks absent, a smaller >=0.5% first tick may have occurred; M5 first downleg reconstruction needs full source and real stop.",
        "All Aug2025-Nov2026 data already studied and threshold families looked at; no unseen holdout.",
        "Economic overlay uses P20 common 72h STOP, not original V20 phase exit. NO signed fills, live positions, funding, cross-runner shared risk.",
        "No future bar in Layer A eligibility; any extra H1 confirmation occurs at i-1, before B event, but not 6h earlier.",
        "If sample <15 or 100bps stress crosses winrate/20% DD limits, treat as insufficient and NO promotion.",
      ]}
    OUT.write_text(json.dumps(sourceOut,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf8")
    LEDGER.write_text("".join(json.dumps(x,ensure_ascii=False,sort_keys=True)+"\n" for x in eligible),encoding="utf8")
    lines=["# P48: six-hour pre-arm was already a rebound-after-drop?",
      "",
      "P47 BASE was 13/18 win, 12.13% M5 DD (source proxy). However 11/18 were already down >=3% in the previous 24h at the pre-arm observation.",
      "",
      "| Rule | Eligible | Single slot closed | Wins | Win rate | DD high | NAV yen |",
      "|---|---:|---:|---:|---:|---:|---:|"]
    for x in normal:
      eco=x["capital"]
      lines.append("| "+x["model"]+" | "+str(x["eligibleSourceEvents"])+" | "+str(eco["closed"])+" | "+str(eco["wins"])+" | "+str(eco["conditionalWinPct"])+"% | "+str(eco["M5HighStressDDPct"])+"% | "+str(eco["finalProxyNavYen"])+" |")
    lines+=["","As-of pre-arm6 may already be after a drawdown: do not call the P47 72% a clean first-leg winrate. With post-drop excluded, proof sample shrinks and robustness must be separately evaluated."]
    MD.write_text("\n".join(lines)+"\n",encoding="utf8")
    print("P48_PRIOR_DOWNTREND_CONTAMINATION_CLEAN_FIRSTLEG_AUDIT_PASS",json.dumps({
      "P47base18":base["capital"]["closed"],"P47BaseWon":base["capital"]["wins"],
      "contamination":sourceOut["prearmWasAlreadyBelow24hMinus3"],
      "normal":[{"model":x["model"],"nEligible":x["eligibleSourceEvents"],"nClose":x["capital"]["closed"],
         "wins":x["capital"]["wins"],"winpct":x["capital"]["conditionalWinPct"],
         "DD":x["capital"]["M5HighStressDDPct"],"NAV":x["capital"]["finalProxyNavYen"],
         "cohort":x["capital"]["cohorts"]} for x in normal]
      },ensure_ascii=False),flush=True)
    print("FILES",OUT,LEDGER,MD)
if __name__=="__main__":main()
