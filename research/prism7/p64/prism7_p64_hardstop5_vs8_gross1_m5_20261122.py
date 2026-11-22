#!/usr/bin/env python3
"""PRISM VII P64: counterfactual hard SHORT STOP 8% -> 5% only, original V20 entry and
profit exits unchanged. Source P35 immutable 53 natural events, chronological one slot
with repricing on PENGU M5 printed-bar HIGH crosses. Gross 0.75 and 1.00,
10/30bps fees, and +100bps cover stress. Research ONLY, not certified production.

STOP execution model: stop rests at source H1-entry OPEN, mark if positive-volume
M5 HIGH >= entry*(1+stopPct). Price proxy is max(standing STOP trigger, M5 OPEN)
and NEVER M5 close or future next bar volume. When M5 t >= source native
original exitTs, original source exit wins. Guard 0/1H below is sensitivity for
unknown within-H1 native STOP event priority (not executable source priority).
No intrabar orderbook/ask depth or signed fills; ZERO_VOLUME candles ignored.
"""
from __future__ import annotations
import json,math,hashlib
from pathlib import Path
from collections import Counter,defaultdict
from prism7_p38_causal_multihorizon_entry_20261122 import SOURCES
from prism7_native53_event_attribution_20261122 import load_m5
import prism7_p44_native53_pre_drop_context_source_exit_20261122 as p44
from prism7_p44_native53_pre_drop_context_source_exit_20261122 import source_slot,economy
ROOT=Path(__file__).resolve().parent.parent
R=ROOT/"results"
NATIVE=R/"PRISM7_P35_ORIGINAL_NATIVE53_075_ALL53_H1_CONTEXT_AND_POSITIONS_20261122.json"
P44=R/"PRISM7_P44_NATIVE53_PRE_DROP_CONTEXT_0P75_SINGLE_SLOT_20261122.json"
OUT=R/"PRISM7_P64_HARD_STOP_5_PERCENT_VS_8_GROSS1_075_NATIVE53_M5_20261122.json"
LEDGER=R/"PRISM7_P64_ALL53_HARD_STOP_5_PERCENT_NATIVE_SOURCE_M5_TRACE_20261122.jsonl"
MD=R/"PRISM7_P64_HARD_STOP_5_PERCENT_GROSS1_075_NATIVE_SOURCE_COMPARE_20261122.md"
M5=300000;H=3600000
PIN="1657e173d250ad58f53e62f7bb0a3428fb405496"
TARGETS=(None,.04,.05,.06)
GUARDS=(0,1)
GROSSES=(.75,1.0)
EXEC=((10,0),(30,0),(30,100))
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def rnd(x):return round(float(x),6)
def source_rows(native):
 out=[]
 for x in native:
  assert x["parity"]=="EXACT" and x["native_short_signal"]
  assert abs(100*(1-x["exitPrice"]/x["entryPrice"])-.3-x["net30pct"])<1e-7
  out.append({"key":x["period"]+"|"+x["id"]+"|"+str(x["entryTs"]),
    "period":x["period"],"id":x["id"],
    "entryTs":x["entryTs"],"entryPrice":x["entryPrice"],
    "exitTs":x["exitTs"],"exitPrice":x["exitPrice"],
    "sourceExitReason":x["exitReason"],"sourceNativeNet30Pct":x["net30pct"],
    "nativeExitTs":x["exitTs"],"nativeExitPrice":x["exitPrice"],
    "researchNewStopTriggered":False,
    "researchSTOPPriceModelNotActualVenueFill":True})
 return sorted(out,key=lambda z:z["entryTs"])
def simulate_earlier_stop(x,m5,threshold,guard):
 if threshold is None:return dict(x)
 entry=x["entryTs"];end=x["nativeExitTs"];px=x["entryPrice"]
 stop=px*(1+threshold)
 # Scan only printed M5 data whose timestamp precedes native recorded exit.
 for t in range(entry,end,M5):
  candle=m5.get(t)
  if candle is None:raise ValueError("P64_MISSING_M5:"+str(t))
  if float(candle[5])<=0:continue
  high=float(candle[2]);baropen=float(candle[1])
  if high+1e-12<stop:continue
  if t+guard*H>=end:
   # A source exit may have occurred already in the adjacent H1; guard
   # avoids treating ambiguous source entry+close as earlier STOP.
   continue
  chosen_cover=max(stop,baropen)
  assert chosen_cover>0 and t<end
  return {**x,"exitTs":t,"exitPrice":chosen_cover,
   "researchNewStopTriggered":True,
   "researchNewStopPct":threshold,
   "researchNewStopTs":t,"researchNewStopPx":chosen_cover,
   "researchBarM5Open":baropen,"researchBarM5High":high,
   "researchBarM5PositiveVolume":float(candle[5]),
   "researchOpenGapWorseThanStop":baropen>stop,
   "researchMaxFillAssumesStopOrderRestingAtOriginalEntry":True,
   "sourceOriginalNativeExitTsKeptAsPriorityReference":end,
   "sourceNativeExitReasonOriginal":x["sourceExitReason"],
   "sourceNativeStopPriorityGuardHours":guard}
 return dict(x)
def main():
 native=json.loads(NATIVE.read_text(encoding="utf8"))
 assert len(native)==53 and sum(z["net30pct"]>0 for z in native)==29
 m5,m5sha=load_m5(SOURCES)
 rows=source_rows(native)
 fixed,skipped=source_slot(rows)
 assert len(fixed)==33 and len(skipped)==20
 originalkeys={z["key"] for z in fixed}
 before=json.loads(P44.read_text(encoding="utf8"))["native53OriginalOverlapSingleSlotReference"]["economics"]
 p44.GROSS=.75
 orig=economy(fixed,m5,30,0)
 assert orig["singleSlotPositions"]==before["singleSlotPositions"]==33
 assert orig["wins"]==before["wins"]==18
 assert abs(orig["finalNAVYen"]-14193.07)<.01
 assert abs(orig["M5HighStressMarkedDDPct"]-25.10029)<.0001
 grid=[];detail=[]
 for target in TARGETS:
  for guard in GUARDS:
   case="SOURCE_NATIVE_HARD_STOP_8PCT" if target is None else f"STANDING_STOP_{int(target*100)}PCT"
   alt=[simulate_earlier_stop(z,m5,target,guard) for z in rows]
   assert len(alt)==53
   assert all(z["exitTs"]<=z["nativeExitTs"] for z in alt)
   revised,blocked=source_slot(alt)
   old33=[z for z in alt if z["key"] in originalkeys]
   assert len(old33)==33
   winsOrigLost=Counter()
   losersSaved=Counter()
   origHard=[]
   stopDetails=[]
   for z in alt:
    if z["sourceExitReason"]=="SHORT_HARD_STOP":origHard.append(z)
    old=z["sourceNativeNet30Pct"]
    new=100*(1-z["exitPrice"]/z["entryPrice"])-.3
    if old>0 and new<=0:winsOrigLost[z["period"]]+=1
    if old<0 and new>0:losersSaved[z["period"]]+=1
    if z["researchNewStopTriggered"]:
     stopDetails.append({"key":z["key"],"originalNet30Pct":rnd(old),
       "changedNet30Pct":rnd(new),"origWin":old>0,
       "origReason":z["sourceExitReason"],
       "origExitTs":z["nativeExitTs"],"origExitPrice":z["nativeExitPrice"],
       "newExitTs":z["exitTs"],"newExitPrice":z["exitPrice"],
       "printedPositiveVolumeM5":z["researchBarM5PositiveVolume"],
       "sourceM5GapAtStop":z["researchOpenGapWorseThanStop"],
       "wasOriginalFixed33":z["key"] in originalkeys,
       "isNewReslot":z["key"] in {q["key"] for q in revised}})
   for gross in GROSSES:
    p44.GROSS=gross
    for fee,slip in EXEC:
     ss=economy(revised,m5,fee,slip)
     fs=economy(old33,m5,fee,slip)
     grid.append({"rule":case,"stopLevelPct":None if target is None else rnd(100*target),
      "sourceNativeStopPriorityGuardHours":guard,"gross":gross,"feeBps":fee,
      "extraBuyCoverSlippageAllExitBps":slip,
      "nativeOriginalNaturalEvents":53,"baselineOneSlot33":True,
      "sourceOriginalEntrySignalsUnchanged":True,
      "fixedOriginal33ExitsOnly":fs,
      "chronologicalOneSlotReAdmitAfterEarlyStop":ss,
      "nativeOriginal33StillSelected":len({z["key"] for z in revised}&originalkeys),
      "newNativeSourceIntentsAdmitted":len({z["key"] for z in revised}-originalkeys),
      "stoppedOriginalWinningNaturalSignals":sum(winsOrigLost.values()),
      "stoppedOriginalWinningFixed33":sum(z["sourceNativeNet30Pct"]>0 and
        100*(1-z["exitPrice"]/z["entryPrice"])-.3<=0 for z in old33),
      "stoppedOriginalLossesImprovedToWinnersNatural":sum(losersSaved.values()),
      "sourceNewFivePercentStopsAllNatural":sum(z["researchNewStopTriggered"] for z in alt),
      "sourceNewFivePercentStopsDynamicOneSlot":sum(z["researchNewStopTriggered"] for z in revised),
      "sourceOriginalHardStopCountAllNatural":sum(z["sourceExitReason"]=="SHORT_HARD_STOP" for z in rows),
      "sourceOriginalHardStopPreventedByEarlierStop":sum(z["researchNewStopTriggered"] for z in origHard),
      "sourceGappedStopPriceNatural":sum(z.get("researchOpenGapWorseThanStop",False) for z in alt)})
   detail.append({"rule":case,"guardHours":guard,
      "allNewStoppedNaturalSignalTrades":stopDetails,
      "sourceNoPriceSTOPHitBeforeNativeExitAmongOrigHard":
        [z["key"] for z in origHard if not z["researchNewStopTriggered"]],
      "selectedPositionsNativeSlotIDs":[z["key"] for z in revised],
      "original33FixedIDs":sorted(originalkeys)})
 assert len(grid)==len(TARGETS)*len(GUARDS)*len(GROSSES)*len(EXEC)
 normal=[x for x in grid if x["feeBps"]==30 and x["extraBuyCoverSlippageAllExitBps"]==0]
 o=next(x for x in normal if x["rule"]=="SOURCE_NATIVE_HARD_STOP_8PCT" and x["gross"]==1 and x["sourceNativeStopPriorityGuardHours"]==1)
 assert o["fixedOriginal33ExitsOnly"]["wins"]==18
 assert abs(o["fixedOriginal33ExitsOnly"]["M5HighStressMarkedDDPct"]-32.11305)<.0001
 assert abs(o["chronologicalOneSlotReAdmitAfterEarlyStop"]["finalNAVYen"]-15557.46)<.01
 report={
  "schema":"prism7-p64-native-v20-8-stop-to-5-stop-m5-printed-high-source-replay/v1",
  "status":"RESEARCH_ONLY_NOT_STOP_CHANGE_APPROVAL",
  "pinnedOriginalNativeV20SHA":PIN,
  "originalNativeSource53Wins29Losses24":True,
  "baselineGross075NativeEntryExitP44Parity":True,
  "sourceLiveStop8PercentNeverChanged":True,
  "sourceNativeEntryAndProfitExitNeverChanged":True,
  "contemplatedResearchStopAbsolutePriceMovePct":5,
  "precommittedStopLevelsForSensitivity":TARGETS,
  "sourceNativeSTOPSameBarPriorityUncertainGuardHours":GUARDS,
  "grossResearch":GROSSES,
  "feeBpsResearch":[10,30],"extraAllCoverBpsStress":[0,100],
  "sourceM5TriggerPositiveVolumeHighAndStandingStopPrice":True,
  "sourceM5GapAboveStopOpenUsesWorseOpen":True,
  "sourceStopPriceStillNotExchangeSignedFill":True,
  "allScenarioGrid":grid,"scenarioCount":len(grid),
  "normal30bpsNoAdditionalSlippage":normal,
  "traceAllNaturalOriginalSource53":detail,
  "sourceSHA256":{"originalNative53":sha(NATIVE),"P44":sha(P44),"penguM5":m5sha},
  "limitations":[
   "Original source H1 exits are pinned, while new stop changes use printed M5 highs. This is a hybrid hypothetical exit, not production Native EXIT-parity or genuine venue STOP fill.",
   "STANDING STOP must be placed at entry in actual engine and filled at stop or worse after gaps. Intrabar sequence and orderbook ask liquidity not available; marker of M5 high is a modeled touch only.",
   "Original source 53 natural event signals overlap; source one-slot 33 historical, new earlier STOP permits different admissions; both fixed33 and dynamic re-slot compared.",
   "Extra cover +100bps applies at every exit in stress, not necessarily realized slippage measured in market.",
   "Study dates already inspected. Stop5 selection may overfit once outcome known; future independent Aster data needed.",
   "Original winner losses can occur if a SHORT temporarily rallies >=5% before significant downward trend; count these as severe opportunity cost.",
   "No exchange signed fill/funding/shared Runner gross/account liquidation or actual account DD, only research M5 printed high price-source mark.",
   "No original Runner, STOP, HP, risk Gross, orders, positions, VPS or GitHub master changed."
  ]}
 OUT.write_text(json.dumps(report,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf8")
 LEDGER.write_text("".join(json.dumps(x,ensure_ascii=False,sort_keys=True)+"\n" for x in detail),encoding="utf8")
 lines=["# P64 Gross1.0 and -5% hard STOP research for pinned original V20",
  "",
  "Retain original Native entries and all profit exits. Source stop8 unchanged in pinned runtime. Simulate standing short STOP when positive-volume M5 HIGH first touches 1.05 entry; exit at max(M5 open, resting STOP limit), NOT a signed venue fill. 1-hour guard models uncertain within-H1 priority; same original 33 and re-slot independently.",
  "",
  "| Stop level | Guard H | Gross | fixed33 winners | fixed33 M5 DD | fixed33 NAV ¥ | Re-slot closed | Re-slot winners | Re-slot DD | Re-slot NAV ¥ | original winners turned loser |",
  "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|"]
 for x in normal:
  a=x["fixedOriginal33ExitsOnly"]; b=x["chronologicalOneSlotReAdmitAfterEarlyStop"]
  lines.append("| "+x["rule"]+" | "+str(x["sourceNativeStopPriorityGuardHours"])+" | "+str(x["gross"])+" | "+
    str(a["wins"])+"/33 | "+str(a["M5HighStressMarkedDDPct"])+"% | "+str(a["finalNAVYen"])+" | "+
    str(b["singleSlotPositions"])+" | "+str(b["wins"])+" | "+str(b["M5HighStressMarkedDDPct"])+"% | "+
    str(b["finalNAVYen"])+" | "+str(x["stoppedOriginalWinningNaturalSignals"])+" |")
 lines+=["","**Decision gate:** Do not reduce live STOP from8 to5 or raise Gross to1 based on this study; require positive source improvement in DD and capital NAV after fees/slippage and original winner retention plus full production venue stop execution and independent data checks.",""]
 MD.write_text("\n".join(lines),encoding="utf8")
 print("P64_SOURCE_NATIVE53_HARDSTOP5_AGAINST8_075_1_GROSS_M5_REPLAY_PASS",json.dumps({
  "scenarioCount":len(grid),
  "keyRows":[{"rule":x["rule"],"guard":x["sourceNativeStopPriorityGuardHours"],
    "gross":x["gross"],"fixedWins":x["fixedOriginal33ExitsOnly"]["wins"],
    "fixedDD":x["fixedOriginal33ExitsOnly"]["M5HighStressMarkedDDPct"],
    "fixedNAV":x["fixedOriginal33ExitsOnly"]["finalNAVYen"],
    "oneSlot":x["chronologicalOneSlotReAdmitAfterEarlyStop"]["singleSlotPositions"],
    "oneSlotWin":x["chronologicalOneSlotReAdmitAfterEarlyStop"]["wins"],
    "oneSlotDD":x["chronologicalOneSlotReAdmitAfterEarlyStop"]["M5HighStressMarkedDDPct"],
    "oneSlotNAV":x["chronologicalOneSlotReAdmitAfterEarlyStop"]["finalNAVYen"],
    "origWinnerToLoserNatural":x["stoppedOriginalWinningNaturalSignals"],
    "stopOriginalHard":x["sourceOriginalHardStopPreventedByEarlierStop"],
    "originalHardTotal":x["sourceOriginalHardStopCountAllNatural"]}
   for x in normal if x["rule"] in ("SOURCE_NATIVE_HARD_STOP_8PCT","STANDING_STOP_5PCT") and x["sourceNativeStopPriorityGuardHours"]==1],
  "sourceFullTracePath":str(LEDGER)},ensure_ascii=False),flush=True)
 print("FILES",OUT,MD,LEDGER)
if __name__=="__main__":main()
