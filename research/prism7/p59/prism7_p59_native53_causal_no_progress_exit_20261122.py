#!/usr/bin/env python3
"""P59 Native53 early FALSE-DIRECTION rescue as-of positive M5 context.

Entry original PIN V20 retained. 12/24 losses never had 1% favorable M5 close.
Test time-indexed native-source-signal invalidation at predefined 6/12/24h
when NO 1% favorable completed printed M5 close had occurred, as well as
an explicitly opposite 1% adverse close BEFORE the first 1% favorable close.
These are ONGOING as-of state machine rules, NOT hindsight outcome-family gates.
Time/price effects decompose on fixed original source 33 and newly re-slotted
source 53. Native V20 source original EXIT has priority (1h conservative guard).
Next M5 OPEN price proxy after fully completed decision, no future candle
volume queried to determine its own entry or buy cover.
No code deploy, no order, stop or kill-switch changes.
"""
from __future__ import annotations
import json,hashlib
from collections import Counter,defaultdict
from pathlib import Path
from prism7_p38_causal_multihorizon_entry_20261122 import SOURCES
from prism7_native53_event_attribution_20261122 import load_m5
from prism7_p42_pre_onset_first_downleg_hybrid_20261122 import R,SOURCE,GROSS
from prism7_p44_native53_pre_drop_context_source_exit_20261122 import source_slot,economy
from prism7_p57_native53_source_stop_priority_m5_profit_lock_20261122 import make_base
H=3600000;M5=300000
PIN="1657e173d250ad58f53e62f7bb0a3428fb405496"
MODELS=(
  "NATIVE_SOURCE_EXIT",
  "NO_FAVORABLE1_6H",
  "NO_FAVORABLE1_12H",
  "NO_FAVORABLE1_24H",
  "NO_FAVORABLE1_36H",
  "NO_FAVORABLE2_12H",
  "NO_FAVORABLE2_24H",
  "ADVERSE1_FIRST",
  "FAIL_FAST_12H_OR_ADVERSE1",
)
FEE=(10,30)
COVER=(0,100)
OUT=R/"PRISM7_P59_NATIVE53_CAUSAL_NO_PROGRESS_INVALIDATION_20261122.json"
MD=R/"PRISM7_P59_NATIVE53_CAUSAL_NO_PROGRESS_INVALIDATION_20261122.md"
LEDGER=R/"PRISM7_P59_NATIVE53_EARLY_INVALIDATION_ALL_SOURCE_LEDGER_20261122.jsonl"
P40=R/"PRISM7_P40_ORIGINAL_NATIVE53_LOSS_ANATOMY_LEDGER_20261122.jsonl"
P44=R/"PRISM7_P44_NATIVE53_PRE_DROP_CONTEXT_0P75_SINGLE_SLOT_20261122.json"
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def rd(v,n=5):return round(float(v),n)
def rule_parse(model):
 if model.startswith("NO_FAVORABLE"):
  p,h=model[len("NO_FAVORABLE"):].split("_")
  return (float(p)/100,int(h[:-1] if h.endswith('H') else h))
 if model=="FAIL_FAST_12H_OR_ADVERSE1":return (0.01,12)
 return (None,None)
def alternate_exit(z,mode,m5):
 if mode=="NATIVE_SOURCE_EXIT":return {**z,"earlyExitApplied":False}
 entry=z["entryTs"];end=z["nativeExitTs"];price=z["entryPrice"]
 candidate=None
 maxGood=0.
 progressThreshold,hour=rule_parse(mode)
 milestone=entry+hour*H if hour is not None else None
 # iterates ONLY completed positive-volume bars. Native protective stop priority
 # by source EXIT timestamp; guard 1 full hour for unknown within-hour STOP.
 for ts in range(entry,end,M5):
  m=m5.get(ts)
  if m is None:raise ValueError("P59_M5_HOLE:"+str(ts))
  if float(m[5])>0:
   favorable=(price-float(m[4]))/price
   adverse=(float(m[4])-price)/price
   hadGood=maxGood>=.01
   maxGood=max(maxGood,favorable)
   signalCloseTs=ts+M5
   if mode in ("ADVERSE1_FIRST","FAIL_FAST_12H_OR_ADVERSE1"):
    if not hadGood and maxGood<.01 and adverse>=.01 and signalCloseTs+H<end:
     candidate={"trigger":"OPPOSITE_1PCT_BEFORE_FIRST_FAVORABLE1",
        "signalTs":signalCloseTs,"observedPct":rd(100*adverse),
        "maxFavorableCompletedM5PctAtSignal":rd(100*maxGood)}
     break
  if milestone is not None and ts+M5>=milestone:
   # Observed signal H1+N boundary, after reading all completed M5 bars
   # whose close <= milestone. No missing data is construed as a drop.
   if maxGood<progressThreshold and milestone+H<end:
    candidate={"trigger":"NO_PROGRESS_AFTER_FIXED_HOUR",
      "signalTs":milestone,"observedPct":rd(100*maxGood),
      "maxFavorableCompletedM5PctAtSignal":rd(100*maxGood),
      "milestoneHours":hour,"progressThresholdPct":100*progressThreshold}
   break
 if candidate is None:return {**z,"earlyExitApplied":False}
 t=candidate["signalTs"]
 if t<entry or t+H>=end:raise ValueError("P59_UNSAFE_NEAR_NATIVE_EXIT")
 nextbar=m5.get(t)
 if nextbar is None:raise ValueError("P59_NEXT_M5_OPEN_MISSING")
 px=float(nextbar[1])
 if not px>0:raise ValueError("P59_NEXT_OPEN_BAD_PRICE")
 return {**z,"exitTs":t,"exitPrice":px,
   "status":"RESEARCH_CAUSAL_EARLY_INVAL",
   "earlyExitApplied":True,
   "earlyReason":candidate["trigger"],
   "asofObservableSignal":candidate,
   "nativeStopOriginalExitTsPreserved":end,
   "nextM5CoverBarVolumeEXPOST":float(nextbar[5]),
   "coverBarZeroVolEXPOST":float(nextbar[5])<=0,
   "coverBarVolumeNotUsedToPickItsOwnOpen":True}
def main():
 native=json.loads(SOURCE.read_text(encoding="utf8"))
 assert len(native)==53 and sum(z["net30pct"]>0 for z in native)==29
 src=make_base(native)
 original33,blocked=source_slot(src)
 assert len(original33)==33 and len(blocked)==20
 nativekeys={z["key"] for z in original33}
 losscat={x["key"]:x["postEntryLossCategory"] for x in (json.loads(line) for line in P40.read_text(encoding="utf8").splitlines() if line.strip())}
 assert len(losscat)==53
 m5,m5sha=load_m5(SOURCES)
 old=economy(original33,m5,30,0)
 assert old["wins"]==18 and old["singleSlotPositions"]==33 and abs(old["M5HighStressMarkedDDPct"]-25.10029)<.0001
 grid=[];detail=[]
 for model in MODELS:
  alt=[alternate_exit(z,model,m5) for z in src]
  reslot,blocked2=source_slot(alt)
  fixed=[z for z in alt if z["key"] in nativekeys]
  assert len(fixed)==33 and len(set(z["key"] for z in fixed))==33
  sourceNetFlips=Counter()
  originalWinsLost=Counter()
  changedRows=[]
  for z in alt:
   org=z["sourceNativeNet30Pct"]
   new=100*(1-z["exitPrice"]/z["entryPrice"])-.3
   if org<=0 and new>0:sourceNetFlips[losscat[z["key"]]]+=1
   if org>0 and new<=0:originalWinsLost[losscat[z["key"]]]+=1
   if z["earlyExitApplied"]:
    changedRows.append({"key":z["key"],"cohort":z["period"],"sourceNativeWin":org>0,
      "sourceLossGroupPostEntryOnly":losscat[z["key"]],
      "originalNet30":rd(org),"modifiedNet30":rd(new),
      "nativeSourceSTOPFallbackTs":z["nativeExitTs"],
      "researchEarlyExitTs":z["exitTs"],
      "trigger":z["earlyReason"],
      "signal":z["asofObservableSignal"],
      "coverZeroVolumeEXPOST":z["coverBarZeroVolEXPOST"]})
  for fee in FEE:
   for slip in COVER:
    x=economy(fixed,m5,fee,slip)
    y=economy(reslot,m5,fee,slip)
    grid.append({"model":model,"nativeSource53Intents":53,
      "nativeOriginalSource33UnchangedSignalAdmission":True,
      "fixedOriginal33SourceCount":33,
      "same33OriginalOnlyNativeExitAlternatives":x,
      "chronologicalSingleSlotWithNewAdmission":y,
      "feeBps":fee,"coverExtraSlipBps":slip,"gross":GROSS,
      "selectedEarlyExitCount":sum(z["earlyExitApplied"] for z in reslot),
      "exPostZeroVolumeCoverCount":sum(z["earlyExitApplied"] and z["coverBarZeroVolEXPOST"] for z in reslot),
      "sourceNaturalExitChanges":sum(z["earlyExitApplied"] for z in alt),
      "originalWinnersFlippedToLosersSource":sum(originalWinsLost.values()),
      "lossGroupsRescuedSourcePostHoc":dict(sourceNetFlips),
      "newEntrantsFromFreedSlot":len([z for z in reslot if z["key"] not in nativekeys]),
      "original33LostUnderReSlot":len([z for z in original33 if z["key"] not in {v["key"] for v in reslot}])})
  detail.append({"model":model,"naturalSourceEarlyInvalidation":changedRows,
    "original33SourceIDsFixed":sorted(nativekeys),
    "singleSlotSelectedIDs":[z["key"] for z in reslot]})
 assert len(grid)==len(MODELS)*len(FEE)*len(COVER)
 normal=[z for z in grid if z["feeBps"]==30 and z["coverExtraSlipBps"]==0]
 b=next(z for z in normal if z["model"]=="NATIVE_SOURCE_EXIT")
 assert b["chronologicalSingleSlotWithNewAdmission"]==old
 qualifying=[z for z in normal if z["chronologicalSingleSlotWithNewAdmission"]["conditionalWinPct"]>=70 and
    z["chronologicalSingleSlotWithNewAdmission"]["M5HighStressMarkedDDPct"]<=20 and
    z["chronologicalSingleSlotWithNewAdmission"]["finalNAVYen"]>=old["finalNAVYen"] and
    z["chronologicalSingleSlotWithNewAdmission"]["singleSlotPositions"]>=25]
 out={"schema":"prism7-p59-source53-native-entry-no-progress-invalidation-state-machine/v1",
    "status":"RESEARCH_ONLY_NOT_CANDIDATE_PROMOTED",
    "nativePinnedSourceSHA":"1657e173d250ad58f53e62f7bb0a3428fb405496",
    "original53NativeSourceNet30ParityPreserved":True,
    "nativeStopSourceExitPriorityOneFullHourGuard":True,
    "allPredefinedPolicies":MODELS,
    "originalNative53Wins":29,"originalNative53Losses":24,
    "baselineSourceOneSlot33ExactP44Parity":True,
    "gross":GROSS,"fees":FEE,"additionalCoverSlippageBps":COVER,
    "scenarioCount":len(grid),"allScenarios":grid,"normal30bps":normal,
    "exploratoryWin70DD20ProfitNoninferiorMin25":qualifying,
    "allNativeSourceEarlyExitsAndAdmissionEvidence":detail,
    "sourceSHA256":{"Native53":sha(SOURCE),"P40LossFamily":sha(P40),"P44OriginalSourceOneSlot":sha(P44),"M5":m5sha},
    "limitations":[
      "No favorable1% until t is an as-of signal state, unlike future post-exit loss label; no post-entry price after current t used to decide.",
      "A strict no-progress exit may cut winning slow-start trades; winner retention, DD, NAV and fixed33 vs reslot are tracked.",
      "All Native stops priority maintained at H1 source exit, with one-hour conservative no-early-exit guard; intrabar venue STOP parity unresolved.",
      "Immediately next M5 open price may be zero-volume untradeable, and cover volume cannot be used at its own open.",
      "Source53 natural intents overlap, no actual venue fills or funding/shared multi-runner risk.",
      "Historical years previously inspected extensively, winner-only rule selection would overfit. No unseen OOS.",
      "This does not authorize LIVE deployment or modify source pinned Native V20, Runner, STOP, orders, risk caps or Kill Switch."
    ]}
 OUT.write_text(json.dumps(out,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf8")
 LEDGER.write_text("".join(json.dumps(x,ensure_ascii=False,sort_keys=True)+"\n" for x in detail),encoding="utf8")
 lines=["# P59 Native53: early no-progress / wrong-direction invalidation",
    "",
    "As-of state machine: at 6/12/24/36 hours after entry, did *any completed positive-volume M5 close* deliver 1% favorable? If NO, model early cover next bar open. Original STOP priority 1h guard. Also adverse1 first. Same original Native source53 signal/entry.",
    "",
    "| Rule | fixed33 wins | fixed33 high DD | fixed33 NAV | Dynamic reslot wins / closed | DD high | NAV | Early exit | Zero volume cover |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|"]
 for z in normal:
  x=z["same33OriginalOnlyNativeExitAlternatives"]
  y=z["chronologicalSingleSlotWithNewAdmission"]
  lines.append("| "+z["model"]+" | "+str(x["wins"])+" | "+str(x["M5HighStressMarkedDDPct"])+"% | "+str(x["finalNAVYen"])+" | "+
    str(y["wins"])+"/"+str(y["singleSlotPositions"])+" | "+str(y["M5HighStressMarkedDDPct"])+"% | "+str(y["finalNAVYen"])+" | "+str(z["selectedEarlyExitCount"])+" | "+str(z["exPostZeroVolumeCoverCount"])+" |")
 lines+=["","Original source33 exact P44 baseline was 33 closed 18 wins DD25.10029 NAV14193.07. This research gate is not validated, no new Native source signal and no LIVE modifications.",""]
 MD.write_text("\n".join(lines)+"\n",encoding="utf8")
 print("P59_NATIVE53_ASOF_NO_PROGRESS_AND_ADVERSE_FIRST_CAUSAL_RULES_PASS",json.dumps({
  "scenarioCount":len(grid),"base":old,
  "models":[{"model":z["model"],
    "fixedWins":z["same33OriginalOnlyNativeExitAlternatives"]["wins"],
    "fixedDD":z["same33OriginalOnlyNativeExitAlternatives"]["M5HighStressMarkedDDPct"],
    "fixedNAV":z["same33OriginalOnlyNativeExitAlternatives"]["finalNAVYen"],
    "closed":z["chronologicalSingleSlotWithNewAdmission"]["singleSlotPositions"],
    "wins":z["chronologicalSingleSlotWithNewAdmission"]["wins"],
    "wr":z["chronologicalSingleSlotWithNewAdmission"]["conditionalWinPct"],
    "dd":z["chronologicalSingleSlotWithNewAdmission"]["M5HighStressMarkedDDPct"],
    "nav":z["chronologicalSingleSlotWithNewAdmission"]["finalNAVYen"],
    "early":z["selectedEarlyExitCount"],"cover0volume":z["exPostZeroVolumeCoverCount"],
    "originalWinnersFlipped":z["originalWinnersFlippedToLosersSource"],
    "sourceRescuedLossFamily":z["lossGroupsRescuedSourcePostHoc"]} for z in normal],
  "historicalExploratoryPassingW70DD20NAVNoninferior":len(qualifying)
 },ensure_ascii=False),flush=True)
 print("FILES",OUT,MD,LEDGER)
if __name__=="__main__":main()
