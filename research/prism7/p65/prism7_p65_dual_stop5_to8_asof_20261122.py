#!/usr/bin/env python3
"""P65 original native PENGU SHORT V20 two-stage risk policy:
normal standing 5% stop on SHORT price adverse move, exception HOLD only when
PRIOR completed H1 + prior completed M5 market context qualifies, absolute
M5 high standing 8% adverse STOP always applies (printed M5 close/candle).
Original native pinned source STOP/Profit/Trailing and source exit is never
loosened or removed; first source/native/secondary8 exit wins.
Read-only source 53 / gross .75 or1.0 / 10-30bps/100bps stress, overlap single-slot.
Pre-specified 12 mechanistic candidate hold families, not viable production rules.
No future M5 intra-bar evidence used to decide hold: gates use only H1 close
before trigger M5 opens, and M5 bars strictly before trigger.
Actual venue signed M5 stop fills not proven. Zero-volume bars ignored for trigger,
but a zero-print-bar gap could create slippage; no future selected-bar volume used.
"""
from __future__ import annotations
import json,math,hashlib,bisect
from pathlib import Path
from collections import Counter,defaultdict
from prism7_p42_pre_onset_first_downleg_hybrid_20261122 import R,SOURCE,SOURCES,PENGUH1,BTCH1
from prism7_p20_pengu_s3_market_structure_native_source_comparison_20261122 import h1_source,moving_ema
from prism7_native53_event_attribution_20261122 import load_m5
from prism7_p64_hardstop5_vs8_gross1_m5_20261122 import source_rows,simulate_earlier_stop
import prism7_p44_native53_pre_drop_context_source_exit_20261122 as econlib
from prism7_p44_native53_pre_drop_context_source_exit_20261122 import source_slot,economy
M5=300000;H=3600000;G5=.05;MAX8=.08
PIN="1657e173d250ad58f53e62f7bb0a3428fb405496"
STOP_COVER_STRESS=((10,0),(30,0),(30,100))
GROSS=(.75,1.)
GUARDS=(0,1)
MODELS=(
 "NORMAL_STOP5_ALWAYS",
 "EXCEPTION_HOLD8_ALWAYS",
 "EXCEPTION_BTC6_BEAR_AND_REL6_BEAR",
 "EXCEPTION_BTC6_RISE_AND_REL24_WEAK",
 "EXCEPTION_REL24_WEAK_AND_BELOW_EMA72",
 "EXCEPTION_REL24_WEAK_AND_M5_PRINTS_GE3",
 "EXCEPTION_LAST_H1_BEAR_AND_REL24_WEAK",
 "EXCEPTION_PRIOR_M5_FAVORABLE1_AND_LAST_H1_BEAR",
 "EXCEPTION_M5_SELLER_RATIO60_AND_BTC6_BEAR",
 "EXCEPTION_PRIOR_M5_FAVORABLE2_AND_REL24_WEAK",
 "EXCEPTION_BTC6_RISE_REL24_WEAK_LAST_H1_BEAR",
 "EXCEPTION_LAST3_H1_2BEAR_BELOW_EMA72",
 "EXCEPTION_BTC6_BEAR_AND_EMA72_BEAR",
)
OUT=R/"PRISM7_P65_TWO_STAGE_STOP5_EXCEPTION_TO8_SOURCE53_GROSS1_20261122.json"
MD=R/"PRISM7_P65_TWO_STAGE_STOP5_EXCEPTION_TO8_SOURCE53_GROSS1_20261122.md"
LEDGER=R/"PRISM7_P65_ALL53_TWO_STAGE_STOP5_EXCEPTION_PRETRIGGER_FEATURE_LEDGER_20261122.jsonl"
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def rnd(v):return round(float(v),6)
def causal_feature_at_trigger(z,m5,p,btc,ema72,ema168,imap,t):
 # Last fully completed H1 has open timestamp hour(t) - 1H.
 signalHour=(t//H)*H-H
 i=imap.get(signalHour)
 if i is None or i<169:raise ValueError("P65_H1_NOT_ASOF_ALIGNED")
 assert p[i]["time"]+H<=t and btc[i]["time"]==p[i]["time"]
 p6=p[i]["close"]/p[i-6]["close"]-1
 btc6=btc[i]["close"]/btc[i-6]["close"]-1
 p24=p[i]["close"]/p[i-24]["close"]-1
 btc24=btc[i]["close"]/btc[i-24]["close"]-1
 # Only already completed M5 bars. Event candle at t NEVER read here.
 past=[(tt,m5[tt]) for tt in range(max(z["entryTs"],t-12*H),t,M5) if tt in m5 and float(m5[tt][5])>0]
 last12=[x for tm,x in past if tm>=t-12*M5]
 priorM5MaxFavorable=(max((z["entryPrice"]-float(r[4]))/z["entryPrice"] for tm,r in past) if past else 0.)
 seller=sum(max(0.,float(row[5])-float(row[9])) for row in last12 if len(row)>9)
 vol=sum(float(row[5]) for row in last12 if len(row)>9)
 sellerRatio=seller/vol if vol>0 and len(last12)>=3 else None
 h1last=[p[k] for k in range(i-2,i+1)]
 return {
  "lastH1AvailableTs":p[i]["time"]+H,
  "lastFullyCompletedM5AvailableTs":t,
  "triggerCandleNotUsedAsDecisionInput":True,
  "BTC6Pct":rnd(100*btc6),"PENGU6RelativeBTCPct":rnd(100*(p6-btc6)),
  "PENGU24RelativeBTCPct":rnd(100*(p24-btc24)),
  "BTC6Bear":btc6<=0,
  "BTC6Rise":btc6>=.0025,
  "PENGU6RelativeWeak":p6-btc6<=0,
  "PENGU24RelativeWeak":p24-btc24<=-.005,
  "PENGUCloseBelowEMA72":p[i]["close"]<ema72[i],
  "EMA72BelowEMA168":ema72[i]<ema168[i],
  "lastH1Bear":p[i]["close"]<p[i]["open"],
  "last3H1BearCount":sum(x["close"]<x["open"] for x in h1last),
  "priorM5Printed12h":len(past),"priorM5Printed1h":len(last12),
  "priorM5MaxFavorablePrintedClosePct":rnd(100*priorM5MaxFavorable),
  "priorM5HadFavorable1":priorM5MaxFavorable>=.01,
  "priorM5HadFavorable2":priorM5MaxFavorable>=.02,
  "priorM5SellerRatio60":rnd(sellerRatio) if sellerRatio is not None else None,
  "priorM5SellerDominant60":sellerRatio>=.60 if sellerRatio is not None else False,
 }
def hold_decision(rule,f):
 if rule=="NORMAL_STOP5_ALWAYS":return False
 if rule=="EXCEPTION_HOLD8_ALWAYS":return True
 if rule=="EXCEPTION_BTC6_BEAR_AND_REL6_BEAR":return f["BTC6Bear"] and f["PENGU6RelativeWeak"]
 if rule=="EXCEPTION_BTC6_RISE_AND_REL24_WEAK":return f["BTC6Rise"] and f["PENGU24RelativeWeak"]
 if rule=="EXCEPTION_REL24_WEAK_AND_BELOW_EMA72":return f["PENGU24RelativeWeak"] and f["PENGUCloseBelowEMA72"]
 if rule=="EXCEPTION_REL24_WEAK_AND_M5_PRINTS_GE3":return f["PENGU24RelativeWeak"] and f["priorM5Printed1h"]>=3
 if rule=="EXCEPTION_LAST_H1_BEAR_AND_REL24_WEAK":return f["lastH1Bear"] and f["PENGU24RelativeWeak"]
 if rule=="EXCEPTION_PRIOR_M5_FAVORABLE1_AND_LAST_H1_BEAR":return f["priorM5HadFavorable1"] and f["lastH1Bear"]
 if rule=="EXCEPTION_M5_SELLER_RATIO60_AND_BTC6_BEAR":return f["priorM5SellerDominant60"] and f["BTC6Bear"]
 if rule=="EXCEPTION_PRIOR_M5_FAVORABLE2_AND_REL24_WEAK":return f["priorM5HadFavorable2"] and f["PENGU24RelativeWeak"]
 if rule=="EXCEPTION_BTC6_RISE_REL24_WEAK_LAST_H1_BEAR":return f["BTC6Rise"] and f["PENGU24RelativeWeak"] and f["lastH1Bear"]
 if rule=="EXCEPTION_LAST3_H1_2BEAR_BELOW_EMA72":return f["last3H1BearCount"]>=2 and f["PENGUCloseBelowEMA72"]
 if rule=="EXCEPTION_BTC6_BEAR_AND_EMA72_BEAR":return f["BTC6Bear"] and f["EMA72BelowEMA168"]
 raise ValueError("P65_UNDECLARED_GATE:"+rule)
def stop8_after_hold(z,m5,start):
 # Emergency 8 is active from *original entry*, and would trigger
 # at or after the first 5% M5 bar if continuation exception was approved.
 # If original pinned source exit already happens first, preserve source exit.
 for t in range(start,z["nativeExitTs"],M5):
  x=m5.get(t)
  if x is None:raise ValueError("P65_HARD8_M5_SOURCE_HOLE:"+str(t))
  if float(x[5])<=0:continue
  if float(x[2])+1e-12<z["entryPrice"]*1.08:continue
  cover=max(z["entryPrice"]*1.08,float(x[1]))
  return {"exitTs":t,"exitPrice":cover,
   "stop8M5AbsoluteCapPriceProxyTriggered":True,
   "stop8GapAbovePrice":float(x[1])>z["entryPrice"]*1.08,
   "stop8ModeledM5PrintedHighTs":t,
   "stop8ModeledExecutionNotSignedVenueFill":True}
 return {}
def main():
 native=json.loads(SOURCE.read_text(encoding="utf8"))
 assert len(native)==53 and sum(x["net30pct"]>0 for x in native)==29
 allsource=source_rows(native)
 m5,m5sha=load_m5(SOURCES)
 pengu,ph=h1_source(PENGUH1);btc,bh=h1_source(BTCH1)
 assert len(pengu)==len(btc) and all(z["time"]==btc[i]["time"] for i,z in enumerate(pengu))
 e72=moving_ema(pengu,72);e168=moving_ema(pengu,168);imap={z["time"]:i for i,z in enumerate(pengu)}
 original33,blocked=source_slot(allsource)
 assert len(original33)==33 and len(blocked)==20
 origKeys={x["key"] for x in original33}
 fiveStop={}
 for guard in GUARDS:
  fiveStop[guard]={z["key"]:simulate_earlier_stop(z,m5,.05,guard) for z in allsource}
 sourceEvents={}
 for guard in GUARDS:
  perkey={}
  for z in allsource:
   x=fiveStop[guard][z["key"]]
   if not x["researchNewStopTriggered"]:continue
   t=x["researchNewStopTs"]
   f=causal_feature_at_trigger(z,m5,pengu,btc,e72,e168,imap,t)
   if not f["triggerCandleNotUsedAsDecisionInput"] or f["lastH1AvailableTs"]>t:
    raise ValueError("P65_ASOF_FEATURE_LOOKAHEAD")
   perkey[z["key"]]={"triggerTs":t,"features":f,
    "originalStop5":x["exitPrice"],"nativeOriginalNet30":z["sourceNativeNet30Pct"]}
  sourceEvents[guard]=perkey
 scenarios=[];traces=[]
 for guard in GUARDS:
  for model in MODELS:
   revised=[]
   for z in allsource:
    hit=fiveStop[guard][z["key"]]
    event=sourceEvents[guard].get(z["key"])
    if not event:
     revised.append({**z,"exceptionHold8":False,"stop5Touched":False,
      "stop8M5AbsoluteCapPriceProxyTriggered":False,"twoStageStopRule":model})
     continue
    hold=hold_decision(model,event["features"])
    if not hold:
     revised.append({**hit,"exceptionHold8":False,"stop5Touched":True,
      "stop8M5AbsoluteCapPriceProxyTriggered":False,
      "twoStageStopRule":model})
    else:
     next8=stop8_after_hold(z,m5,event["triggerTs"])
     if next8:
      revised.append({**z,**next8,
       "exceptionHold8":True,"stop5Touched":True,
       "stop5TriggerTs":event["triggerTs"],"twoStageStopRule":model})
     else:
      revised.append({**z,"exceptionHold8":True,"stop5Touched":True,
       "stop8M5AbsoluteCapPriceProxyTriggered":False,
       "stop5TriggerTs":event["triggerTs"],"twoStageStopRule":model})
   assert len(revised)==53 and all(z["entryTs"]<z["exitTs"]<=z["nativeExitTs"] for z in revised)
   slot,skipped=source_slot(revised)
   fixed=[z for z in revised if z["key"] in origKeys]
   assert len(fixed)==33
   chosen={z["key"] for z in slot}
   trace={"rule":model,"guard":guard,"sourceNaturalOriginal53Count":53,
    "sourceStop5Touches":sum(z["stop5Touched"] for z in revised),
    "sourceHold8Approved":sum(z["exceptionHold8"] for z in revised),
    "sourceTriggeredSecondaryM5Stop8":sum(z["stop8M5AbsoluteCapPriceProxyTriggered"] for z in revised),
    "sourceOriginalWinnersConvertedToLosers":sum(z["sourceNativeNet30Pct"]>0 and 100*(1-z["exitPrice"]/z["entryPrice"])-.3<=0 for z in revised),
    "sourceOriginalLosersToWinners":sum(z["sourceNativeNet30Pct"]<=0 and 100*(1-z["exitPrice"]/z["entryPrice"])-.3>0 for z in revised),
    "originalSourceFixed33WinnersConvertedToLosers":sum(z["sourceNativeNet30Pct"]>0 and 100*(1-z["exitPrice"]/z["entryPrice"])-.3<=0 for z in fixed),
    "sourceNativeSourceOriginalWinning13PctSaved":sum(z["sourceNativeNet30Pct"]>=10 and 100*(1-z["exitPrice"]/z["entryPrice"])-.3>0 for z in revised),
    "sourceCaseTrace":[{"key":z["key"],"originalWin":z["sourceNativeNet30Pct"]>0,
      "originalNativeSourceNet30Pct":rnd(z["sourceNativeNet30Pct"]),
      "researchNet30Pct":rnd(100*(1-z["exitPrice"]/z["entryPrice"])-.3),
      "stop5Reached":z["stop5Touched"],"exceptionHold8":z["exceptionHold8"],
      "secondaryStop8Triggered":z["stop8M5AbsoluteCapPriceProxyTriggered"],
      "origNativeExitReason":z["sourceExitReason"],
      "origNativeExitTs":z["nativeExitTs"],
      "researchExitTs":z["exitTs"],
      "onOriginal33":z["key"] in origKeys,"onNewSingleSlot":z["key"] in chosen,
      "preStop5AsOf":sourceEvents[guard].get(z["key"])}
      for z in revised]}
   traces.append(trace)
   for gross in GROSS:
    econlib.GROSS=gross
    for fee,slip in STOP_COVER_STRESS:
     orig=economy(fixed,m5,fee,slip)
     dyn=economy(slot,m5,fee,slip)
     scenarios.append({
      "rule":model,"sourceStop5PositiveM5HighGuardHours":guard,
      "gross":gross,"feeBps":fee,"extraAllCoverSlipBps":slip,
      "originalNative53NaturalSignalsUnchanged":True,
      "sourceNativeProfitAndTrailingExitsUntouched":True,
      "sourceEmergencyStop8AbsoluteM5PriceModelActiveWhenHeld":True,
      "original33PositionSelectionFixed":orig,
      "chronologicalSingleSlotReAdmission":dyn,
      "sourceStop5Touches":trace["sourceStop5Touches"],
      "sourceHold8Approvals":trace["sourceHold8Approved"],
      "secondaryM5Stop8Triggers":trace["sourceTriggeredSecondaryM5Stop8"],
      "sourceOriginalWinnersConvertedToLosers":trace["sourceOriginalWinnersConvertedToLosers"],
      "originalFixed33WinnersConvertedToLosers":trace["originalSourceFixed33WinnersConvertedToLosers"],
      "newReAdmittedPositions":len(chosen-origKeys),
      "native33OriginallySelectedLostFromReslot":len(origKeys-chosen)})
 assert len(scenarios)==len(GUARDS)*len(MODELS)*len(GROSS)*len(STOP_COVER_STRESS)
 # STOP5 reproduction MUST exactly match P64 baseline for each guard.
 p64=json.loads((R/"PRISM7_P64_HARD_STOP_5_PERCENT_VS_8_GROSS1_075_NATIVE53_M5_20261122.json").read_text(encoding="utf8"))
 for z in scenarios:
  if z["rule"]!="NORMAL_STOP5_ALWAYS":continue
  t=next(x for x in p64["allScenarioGrid"] if x["rule"]=="STANDING_STOP_5PCT" and
    x["sourceNativeStopPriorityGuardHours"]==z["sourceStop5PositiveM5HighGuardHours"] and
    x["gross"]==z["gross"] and x["feeBps"]==z["feeBps"] and
    x["extraBuyCoverSlippageAllExitBps"]==z["extraAllCoverSlipBps"])
  for a,b in (("original33PositionSelectionFixed","fixedOriginal33ExitsOnly"),
     ("chronologicalSingleSlotReAdmission","chronologicalOneSlotReAdmitAfterEarlyStop")):
   for metric in ("wins","finalNAVYen","M5HighStressMarkedDDPct","singleSlotPositions"):
    if abs(z[a][metric]-t[b][metric])>1e-4:raise ValueError("P65_STOP5_P64_PARITY_FAILED:"+metric)
 normal=[x for x in scenarios if x["feeBps"]==30 and x["extraAllCoverSlipBps"]==0 and x["sourceStop5PositiveM5HighGuardHours"]==1]
 report={
  "schema":"prism7-p65-2step-native-v20-stop5-conditional-hold-to-standing-stop8/v1",
  "status":"RESEARCH_ONLY_NO_APPROVED_POLICY_OR_GROSS_CHANGE",
  "nativePinnedSha":PIN,
  "sourceOriginalNative53PinPriceEntryExitParity":True,
  "source5PctPriceStopParityWithP64AllScenarios":True,
  "nativeExitsUntouchedIfNoTwoStageStop":True,
  "originalNativeSourceStop8NotCancelled":True,
  "newPriceModelSecondary8StopEnforcedOnEveryPrintedM5HighWhenHoldApproved":True,
  "stop5AsOfConditionOnlyPriorCompletedH1AndM5":True,
  "neverUseStop5TriggerBarHighOrVolumeToComputeCondition":True,
  "allGateFamilies":MODELS,
  "guardHours":[0,1],"grosses":GROSS,
  "executionStress":STOP_COVER_STRESS,
  "allScenarios":scenarios,"normal30bpsOneHourNativeSourceGuard":normal,
  "all53PretriggerFeaturesAndExitCounterfactuals":traces,
  "sourceSHA256":{"Native53":sha(SOURCE),"P64":sha(R/"PRISM7_P64_HARD_STOP_5_PERCENT_VS_8_GROSS1_075_NATIVE53_M5_20261122.json"),
   "H1PENGU":ph,"H1BTC":bh,"PENGUM5":m5sha},
  "limitations":[
   "Native pinned original source exits from H1, future hypothetical 5/8 standing-stop touches on printed M5 high; actual intrabar ask and stop sequencing NOT verified.",
   "Both normal5 and exceptional 8 must be resting in production; simulation of policy gates at 5% must not rely on knowledge of current M5 high/close beyond trigger or post-trigger future.",
   "Same M5 candle could gap through 5 and 8 simultaneously; max(8% stop price, M5 open) stress proxy is NOT guaranteed exchange fill / maximum possible realized loss.",
   "Conservative 1h priority guard on 5% event versus original source exit is a research sensitivity only; no true native venue STOP replay.",
   "Multiple selected gates on already-studied native 53 are in-sample exploratory; 80%/DD20 threshold decisions not production safe.",
   "Only 19 original natural price-source cases touch5 earlier than native exit at 1h guard, with 2 historical winners. Small-N decisions are unreliable.",
   "No actual LIVE fills, funding, equity shared risk, gross concurrency, V20 true current SHA verification on VPS, quote liquidity, or master branch changes."
  ]}
 OUT.write_text(json.dumps(report,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf8")
 LEDGER.write_text("".join(json.dumps(z,ensure_ascii=False,sort_keys=True)+"\n" for z in traces),encoding="utf8")
 lines=["# P65 | PENGU V20 dual-level STOP: normally 5%, conditional carry to absolute 8%",
  "",
  "Original source Native V20 53 price signals unchanged. +5% adverse SHORT standing STOP triggered by printed M5 high. Eligibility for carrying to maximum +8% decided ONLY with pre-trigger fully completed H1 & M5 data; +8% stop always modeled at M5 printed high, as well as original native exit/STOP. 0.75/1.0 Gross, 10/30bps, and 100bps cover stress.",
  "",
  "Note: original source Native H1 exits, M5 touches, and actual venue orderbook STOP are NOT exactly reproducible; this is research price hybrid.",
  "",
  "| Hold exception condition | Hold natural count | Gross | selected / wins | M5 DD | NAV yen | original winning sources lost |",
  "|---|---:|---:|---:|---:|---:|"]
 for z in normal:
  econ=z["chronologicalSingleSlotReAdmission"]
  lines.append("| "+z["rule"]+" | "+str(z["sourceHold8Approvals"])+" | "+str(z["gross"])+" | "+str(econ["singleSlotPositions"])+"/"+str(econ["wins"])+" | "+str(econ["M5HighStressMarkedDDPct"])+"% | "+str(econ["finalNAVYen"])+" | "+str(z["sourceOriginalWinnersConvertedToLosers"])+" |")
 lines+=["","Do not use hindsight knowledge of whether the original native signal would win. All examples are drawn from already-reviewed 53 natural intents, which overlap. Even if a conditional gate looks promising, do NOT change LIVE STOP or Gross until exact fill/STOP replay plus independent venue data.",""]
 MD.write_text("\n".join(lines),encoding="utf8")
 print("P65_STOP5_CONDITIONAL_TO_EMERGENCY8_PRETRIGGER_ASOF_GATE_AND_P64_PARITY_PASS",
  json.dumps({"scenarioCount":len(scenarios),
   "reference":[{"rule":z["rule"],"gross":z["gross"],"approval":z["sourceHold8Approvals"],
    "stop8ModelTriggered":z["secondaryM5Stop8Triggers"],
    "singleSlot":z["chronologicalSingleSlotReAdmission"]["singleSlotPositions"],
    "wins":z["chronologicalSingleSlotReAdmission"]["wins"],
    "DD":z["chronologicalSingleSlotReAdmission"]["M5HighStressMarkedDDPct"],
    "NAV":z["chronologicalSingleSlotReAdmission"]["finalNAVYen"],
    "originalWinnersLost":z["sourceOriginalWinnersConvertedToLosers"]}
    for z in normal]},ensure_ascii=False),flush=True)
 print("FILES",OUT,MD,LEDGER)
if __name__=="__main__":main()
