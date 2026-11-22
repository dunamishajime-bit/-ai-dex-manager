#!/usr/bin/env python3
"""P57 immutable Native53 original entry + fully observed positive M5 exit overlays.

Research only. No source code, STOP, LIVE or trade actions.
Baseline EXACT P44: 53 natural original native entries and exits, one slot,
0.75x, 30bps, buy-cover +0bps: 33 closed/18 wins, M5 DD25.10029%.

Any early exit:
 - Source native exitTs/exitPrice remains higher priority.
 - signal from fully completed positive M5 close only.
 - hypothetical cover priced at NEXT M5 open, regardless of future bar volume.
 - research strict native-exit lead guard 0h and 1h.
 - Original native53 all original prices/exits verified before modification.
 - Fixed original33 single-slot trade book and dynamically re-slotted source53
   compared separately; exclusion of losers via freed slot is not counted
   as source entry prediction.
 - All scenarios on already-viewed PRE/BASE/POST -> no fresh OOS.
"""
from __future__ import annotations
import json,hashlib,math
from collections import Counter,defaultdict
from pathlib import Path
from prism7_p38_causal_multihorizon_entry_20261122 import SOURCES
from prism7_native53_event_attribution_20261122 import load_m5
from prism7_p42_pre_onset_first_downleg_hybrid_20261122 import R,SOURCE,GROSS
from prism7_p44_native53_pre_drop_context_source_exit_20261122 import source_slot,economy
M5=300000;H=3600000
MODELS=("NATIVE_PINNED_REFERENCE",
 "TP_1PCT_CONFIRMED_CLOSE",
 "TP_2PCT_CONFIRMED_CLOSE",
 "TP_3PCT_CONFIRMED_CLOSE",
 "TP_5PCT_CONFIRMED_CLOSE",
 "MFE1_GIVEBACK_HALF",
 "MFE3_GIVEBACK_HALF",
 "MFE3_GIVEBACK_TO1PCT")
GUARDS=(0,1)
FEE=(10,30)
SLIPPAGE=(0,100)
PIN="1657e173d250ad58f53e62f7bb0a3428fb405496"
P40=R/"PRISM7_P40_ORIGINAL_NATIVE53_LOSS_ANATOMY_LEDGER_20261122.jsonl"
P44=R/"PRISM7_P44_NATIVE53_PRE_DROP_CONTEXT_0P75_SINGLE_SLOT_20261122.json"
OUT=R/"PRISM7_P57_NATIVE53_ORIGINAL_STOP_PRIORITY_ASOF_M5_PROFIT_LOCK_20261122.json"
MD=R/"PRISM7_P57_NATIVE53_ORIGINAL_STOP_PRIORITY_ASOF_M5_PROFIT_LOCK_20261122.md"
LEDGER=R/"PRISM7_P57_NATIVE53_ALL_SOURCE_ENTRY_EXIT_ALTERNATIVES_20261122.jsonl"
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def rd(x,n=5):return round(float(x),n)
def make_base(native):
 out=[]
 for z in native:
  key=z["period"]+"|"+z["id"]+"|"+str(z["entryTs"])
  assert abs(100*(1-z["exitPrice"]/z["entryPrice"])-.3-z["net30pct"])<1e-7
  out.append({"key":key,"id":z["id"],"period":z["period"],
    "entryTs":z["entryTs"],"entryPrice":z["entryPrice"],
    "exitTs":z["exitTs"],"exitPrice":z["exitPrice"],
    "nativeExitTs":z["exitTs"],"nativeExitPrice":z["exitPrice"],
    "sourceExitReason":z["exitReason"],"sourceNativeNet30Pct":z["net30pct"],
    "earlyExitApplied":False,"venueSignedFillProven":False})
 return sorted(out,key=lambda x:x["entryTs"])
def get_exit(z,rule,guard,m5):
 # EXACT orig native event untouched. Never simulate a STOP cancellation.
 if rule=="NATIVE_PINNED_REFERENCE":
  return dict(z)
 px=z["entryPrice"];ent=z["entryTs"];end=z["exitTs"];origPx=z["exitPrice"]
 grossPeak=0.
 printed=0
 for t in range(ent,end,M5):
  row=m5.get(t)
  if row is None:raise ValueError("P57_MISSING_PENGU_M5:"+str(t))
  if float(row[5])<=0:continue
  printed+=1
  observedClose=float(row[4])
  favorable=1-observedClose/px
  olderPeak=grossPeak
  grossPeak=max(grossPeak,favorable)
  trigger=False
  if rule=="TP_1PCT_CONFIRMED_CLOSE":trigger=favorable>=.01
  elif rule=="TP_2PCT_CONFIRMED_CLOSE":trigger=favorable>=.02
  elif rule=="TP_3PCT_CONFIRMED_CLOSE":trigger=favorable>=.03
  elif rule=="TP_5PCT_CONFIRMED_CLOSE":trigger=favorable>=.05
  elif rule=="MFE1_GIVEBACK_HALF":
    trigger=olderPeak>=.01 and favorable<=max(0,olderPeak*.5)
  elif rule=="MFE3_GIVEBACK_HALF":
    trigger=olderPeak>=.03 and favorable<=olderPeak*.5
  elif rule=="MFE3_GIVEBACK_TO1PCT":
    trigger=olderPeak>=.03 and favorable<=.01
  else:raise ValueError("P57_UNDECLARED_MODE")
  if not trigger:continue
  known=t+M5
  # Same open time as known end of signal bar. No entry/cover bar's
  # future volume is consulted; next open may not actually trade.
  if known>=end or known>=(end-guard*H):
    continue
  # Suppression of early signals near Native exit cannot move the STOP
  # later. Native source remains sole fallback if no safe prior cover.
  cover=m5.get(known)
  if cover is None:raise ValueError("P57_NEXT_OPEN_SOURCE_M5_HOLE:"+str(known))
  coverPx=float(cover[1])
  if not coverPx>0:raise ValueError("P57_COVER_PRICE_INVALID")
  return {**z,"exitTs":known,"exitPrice":coverPx,
      "earlyExitApplied":True,
      "originalSourceStopPriorityPreservedAtSourceH1Resolution":True,
      "exitSignalKnownAt":known,
      "exitSignalObservedM5CandleTs":t,
      "exitSignalObservedFavorablePct":rd(100*favorable),
      "observedPeakCompletedM5Pct":rd(100*grossPeak),
      "exitTypeResearchOnly":rule,
      "printedBarsBeforeExitSignal":printed,
      "coverBarVolumeEXPOST":float(cover[5]),
      "coverBarZeroVolumeEXPOST":float(cover[5])<=0,
      "coverVolumeNotUsedToSelectItsOwnOPEN":True}
 return dict(z)
def describe_base(source,slot,keys,mode):
 selkeys={z["key"] for z in slot}
 assert len(selkeys)==len(slot)
 count=Counter()
 category=Counter()
 changes=[]
 for z in source:
  if z["earlyExitApplied"]:
    count["earlyExitAppliedSourceNatural"]+=1
    if z["key"] in selkeys:count["earlyExitAppliedSingleSlot"]+=1
    if z["key"] not in keys:count["newlyAdmittedOriginalSlotSource"]+=1
  if z["key"] in selkeys:
    # Original source profit may be adversely affected by alternate exit,
    # class tag used solely for POST-TRADE diagnostics.
    newPct=100*(1-z["exitPrice"]/z["entryPrice"])-.3
    orig=z["sourceNativeNet30Pct"]
    if orig<=0 and newPct>0:
       category["originalLoserToWinner"]+=1
    if orig>0 and newPct<=0:
       category["originalWinnerToLoser"]+=1
    changes.append({"key":z["key"],"cohort":z["period"],"originNativeWin":orig>0,
       "oldNetNotional30Pct":rd(orig),"newNetNotional30Pct":rd(newPct),
       "earlyExit":z["earlyExitApplied"],"origExitTs":z["nativeExitTs"],
       "resultExitTs":z["exitTs"],"firstNativeExitPriority":True,
       "sourceLossCategory":mode[z["key"]]["postEntryLossCategory"]})
 return {"counts":dict(count),"changedSigns":dict(category),
         "originalSlotKept":len(keys),"newAdmittedOriginalSlotKeys":sorted(selkeys-keys),
         "originalSlotLostKeys":sorted(keys-selkeys),"selectedSourceCaseChanges":changes}
def main():
    native=json.loads(SOURCE.read_text(encoding="utf8"))
    assert len(native)==53 and sum(x["net30pct"]>0 for x in native)==29
    p44=json.loads(P44.read_text(encoding="utf8"))
    loss={x["key"]:x for x in (json.loads(s) for s in P40.read_text(encoding="utf8").splitlines() if s.strip())}
    assert len(loss)==53
    m5,m5sha=load_m5(SOURCES)
    base=make_base(native)
    baseSlot,baseSkipped=source_slot(base)
    assert len(baseSlot)==33 and len(baseSkipped)==20
    old33={z["key"] for z in baseSlot}
    pure=economy(baseSlot,m5,30,0)
    ref=p44["native53OriginalOverlapSingleSlotReference"]["economics"]
    assert pure["wins"]==ref["wins"]==18
    assert pure["singleSlotPositions"]==ref["singleSlotPositions"]==33
    assert abs(pure["M5HighStressMarkedDDPct"]-25.10029)<1e-4
    assert abs(pure["finalNAVYen"]-14193.07)<.01
    scenarios=[];traces=[]
    for mode in MODELS:
      for guard in GUARDS:
       new=[get_exit(z,mode,guard,m5) for z in base]
       assert len(new)==53
       assert all(z["exitTs"]<=z["nativeExitTs"] for z in new)
       assert all(z["entryTs"]<z["exitTs"] for z in new)
       for z in new:
         if z["earlyExitApplied"]:
           assert z["exitSignalKnownAt"]==z["exitTs"]
           assert z["exitSignalObservedM5CandleTs"]+M5==z["exitTs"]
           assert z["exitTs"]+guard*H<z["nativeExitTs"]+1
       reslot,skipped=source_slot(new)
       fixedSlot=[z for z in new if z["key"] in old33]
       assert len(fixedSlot)==33
       assert len({z["key"] for z in fixedSlot})==33
       extra=describe_base(new,reslot,old33,loss)
       byfam=Counter(z["postEntryLossCategory"] for z in loss.values())
       flips=Counter()
       origOutcomes=[]
       for z in new:
         origNet=z["sourceNativeNet30Pct"]
         changedNet=100*(1-z["exitPrice"]/z["entryPrice"])-.3
         family=loss[z["key"]]["postEntryLossCategory"]
         if origNet<=0 and changedNet>0:flips[family]+=1
         if origNet>0 and changedNet<=0:flips["NATIVE_WINNER_FLIPPED_TO_LOSS"]+=1
         if z["earlyExitApplied"]:
           origOutcomes.append({"key":z["key"],"family":family,
              "nativeNet30":rd(origNet),"changedNet30":rd(changedNet),
              "sourceTime":z["entryTs"],"nativeExitTime":z["nativeExitTs"],
              "earlyExitTime":z["exitTs"],"coverZeroVolumeEXPOST":z["coverBarZeroVolumeEXPOST"],
              "signalM5Pct":z["exitSignalObservedFavorablePct"]})
       for fee in FEE:
        for slip in SLIPPAGE:
         res=economy(reslot,m5,fee,slip)
         fixed=economy(fixedSlot,m5,fee,slip)
         scenarios.append({"model":mode,"nativePriorityGuardHours":guard,
           "originalNative53NaturalIntents":53,
           "originalBaselineOneSlotCount":len(baseSlot),
           "dynamicOneSlotCount":len(reslot),
           "originalSlotFixed33Count":len(fixedSlot),
           "earlyExitNaturalSource":sum(z["earlyExitApplied"] for z in new),
           "earlyExitAmongDynamicSlot":sum(z["earlyExitApplied"] for z in reslot),
           "zeroVolumeCoverAmongDynamicEarlyExitsEXPOST":sum(z["earlyExitApplied"] and z["coverBarZeroVolumeEXPOST"] for z in reslot),
           "nativeSourceOverlapBlocked":len(skipped),
           "sourceFamilyLostToWonNatural":dict(flips),
           "changedSourceNativeOriginalWinnersToLosers":flips.get("NATIVE_WINNER_FLIPPED_TO_LOSS",0),
           "feeBps":fee,"additionalBuyCoverSlipBps":slip,
           "gross":GROSS,
           "sameOriginal33SourceTradesOnlyExitChanged":fixed,
           "reSlotChronologicalNewlyFreedIntents":res,
           "reslotNewAdmissions":len(extra["newAdmittedOriginalSlotKeys"]),
           "reslotOriginalSlotLost":len(extra["originalSlotLostKeys"])})
       traces.append({"model":mode,"nativePriorityGuardHours":guard,
        "earlyExitAllOriginal53":origOutcomes,
        "dynamicSelected33OrMore":[{"key":z["key"],"period":z["period"],"entryTs":z["entryTs"],
           "exitTs":z["exitTs"],"entryPx":z["entryPrice"],"exitPx":z["exitPrice"],
           "earlyExit":z["earlyExitApplied"],
           "originalNativeWin":z["sourceNativeNet30Pct"]>0,
           "originalLossGroup":loss[z["key"]]["postEntryLossCategory"],
           "earlyExitSignalTs":z.get("exitSignalKnownAt"),
           "zeroVolumeCoverEXPOST":z.get("coverBarZeroVolumeEXPOST")} for z in reslot],
        "originalBaseline33Reused":sorted(old33),"reslotNewAdmissions":extra["newAdmittedOriginalSlotKeys"],
        "reslotExcludedOriginal33":extra["originalSlotLostKeys"]})
    assert len(scenarios)==len(MODELS)*len(GUARDS)*len(FEE)*len(SLIPPAGE)
    norm=[z for z in scenarios if z["feeBps"]==30 and z["additionalBuyCoverSlipBps"]==0]
    b0=next(z for z in norm if z["model"]=="NATIVE_PINNED_REFERENCE" and z["nativePriorityGuardHours"]==1)
    assert b0["reSlotChronologicalNewlyFreedIntents"]==pure
    winners_pure=pure["wins"]
    strong=[z for z in norm if z["reSlotChronologicalNewlyFreedIntents"]["singleSlotPositions"]>=20 and
      z["reSlotChronologicalNewlyFreedIntents"]["conditionalWinPct"]>=80 and
      z["reSlotChronologicalNewlyFreedIntents"]["M5HighStressMarkedDDPct"]<=20]
    report={
      "schema":"prism7-p57-source53-native-exit-protected-M5-profit-lock/v1",
      "status":"RESEARCH_ONLY_NOT_INDEPENDENT_OOS",
      "originalPinnedNativeV20SHA":PIN,"fullOriginal53NativeEntryPriceExitParity53":True,
      "native53OriginalWins29Lost24":True,"originalSourceNativeExitTimesPriority":True,
      "tradeSourceNativeFixed33ExactP44RiskProfitParity":True,
      "sourceM5NextOpenCoverBarVolumeNotUsedToPickThisOpen":True,
      "coverPriceStillNotExchangeSignedFill":True,
      "fixedGross":GROSS,"fees":FEE,"exitCoverExtraSlip":SLIPPAGE,
      "sourceNativeM5H1StopPriorityGuardHours":GUARDS,
      "predeclaredExitMechanisms":MODELS,
      "originalNativeBaselineFixedSingleSlot33":pure,
      "scenarioCount":len(scenarios),"allScenarios":scenarios,"normal30bpsNoExtraSlip":norm,
      "exploratoryWin80DD20Min20":strong,
      "perModelExactSourceEarlyExitAndSlotDiagnostics":traces,
      "sourceNative53OriginalLossCategories":dict(Counter(z["postEntryLossCategory"] for z in loss.values())),
      "sourceSHA256":{"native53":sha(SOURCE),"P40":sha(P40),"P44":sha(P44),"m5":m5sha},
      "limitations":[
        "Post-entry MFE and future price are used only for REAL-TIME CAUSAL HOLD-AND-TRIGGER simulation, never an entry gate. No future M5 beyond signal close is read to authorize the cover.",
        "Native P35 recorded source exitTs is an H1-level time, so event priority within the final hour is uncertain; 1h native-exit lead guard sensitivity included.",
        "A next-M5-OPEN cover price may have zero volume; this is an audit proxy, not a signed venue fill, nor proof exchange STOP could be amended.",
        "Original source 53 natural intents contain overlapping positions, only 33 originally admitted by this one-slot model. New freed-slot admissions can confound exit improvements; fixed33 reused scenario is reported separately.",
        "Native stops were never removed in calculations. Earlier signal cover cannot override original source exitTs. Exact venue intrabar STOP order remains unknown.",
        "Earlier profit-taking may boost observed win rate while destroying big winning trade magnitude and lowering NAV; both must be compared.",
        "Study Aug2025-Nov2026 is historically over-inspected; selecting best threshold here is severe multiple testing. New future feed needed.",
        "No actual production Runner, all-asset shared gross, funding, portfolio DD or market impact parity."
      ]}
    OUT.write_text(json.dumps(report,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf8")
    LEDGER.write_text("".join(json.dumps(z,ensure_ascii=False,sort_keys=True)+"\n" for z in traces),encoding="utf8")
    lines=["# P57 Native V20 original source53 entry preserved: M5 causal profit lock vs original STOP priority",
     "",
     "Original source 53/53 entry/exit/30bps parity, 29 wins, 24 losses. First one-slot 33 filled proxy rows 18 wins, DD25.10029%, NAV14193.07 at gross0.75. Original native source STOP is not cancelled, early exits must predate source native exit.",
     "",
     "| Mode | Lead guard H | Original33 fixed wins/closed | Fixed DD | Fixed NAV ¥ | Reslot wins/closed | Reslot DD | Reslot NAV ¥ | Early covers | Zero volume cover |",
     "|---|---:|---|---:|---:|---|---:|---:|---:|---:|"]
    for z in norm:
      a=z["sameOriginal33SourceTradesOnlyExitChanged"]
      b=z["reSlotChronologicalNewlyFreedIntents"]
      lines.append("| "+z["model"]+" | "+str(z["nativePriorityGuardHours"])+" | "+str(a["wins"])+"/"+str(a["singleSlotPositions"])+" | "+str(a["M5HighStressMarkedDDPct"])+"% | "+str(a["finalNAVYen"])+" | "+str(b["wins"])+"/"+str(b["singleSlotPositions"])+" | "+str(b["M5HighStressMarkedDDPct"])+"% | "+str(b["finalNAVYen"])+" | "+str(z["earlyExitAmongDynamicSlot"])+" | "+str(z["zeroVolumeCoverAmongDynamicEarlyExitsEXPOST"])+" |")
    lines+=["","The old and new source cases remain the same 53 original Native V20 entry signals; no extra early SHORT added. 1h priority guard is safer for H1 source stop ambiguity. No LIVE promotion or fresh OOS." ]
    MD.write_text("\n".join(lines)+"\n",encoding="utf8")
    print("P57_ORIGINAL_PINNED53_SOURCE_STOP_PRIORITY_CAUSAL_EXIT_ALTERNATIVES_PARITY_PASS",
     json.dumps({"nativeBaseline":{"closed":33,"wins":18,"DD":pure["M5HighStressMarkedDDPct"],"NAV":pure["finalNAVYen"]},
      "scenarios":len(scenarios),
      "regular":[{"mode":z["model"],"guard":z["nativePriorityGuardHours"],
        "fixed33Wins":z["sameOriginal33SourceTradesOnlyExitChanged"]["wins"],
        "fixed33DD":z["sameOriginal33SourceTradesOnlyExitChanged"]["M5HighStressMarkedDDPct"],
        "fixed33NAV":z["sameOriginal33SourceTradesOnlyExitChanged"]["finalNAVYen"],
        "closed":z["reSlotChronologicalNewlyFreedIntents"]["singleSlotPositions"],
        "wins":z["reSlotChronologicalNewlyFreedIntents"]["wins"],
        "wr":z["reSlotChronologicalNewlyFreedIntents"]["conditionalWinPct"],
        "DD":z["reSlotChronologicalNewlyFreedIntents"]["M5HighStressMarkedDDPct"],
        "NAV":z["reSlotChronologicalNewlyFreedIntents"]["finalNAVYen"],
        "earlyExit":z["earlyExitAmongDynamicSlot"],
        "zeroCover":z["zeroVolumeCoverAmongDynamicEarlyExitsEXPOST"],
        "loserGroupsRescued":z["sourceFamilyLostToWonNatural"]}
       for z in norm],
      "potentialResearchRuleCountWin80DD20":len(strong)},ensure_ascii=False),flush=True)
    print("FILES",OUT,MD,LEDGER)
if __name__=="__main__":main()
