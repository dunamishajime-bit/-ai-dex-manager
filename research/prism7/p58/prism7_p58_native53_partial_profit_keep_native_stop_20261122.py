#!/usr/bin/env python3
"""P58 Native 53 original STOP retains remaining risk after partial profit cover.

Trade first half/quarter when gain is VERIFIED on completed positive M5 candle.
Hypothetical covering at immediately NEXT M5 OPEN (not using the cover bar's
future volume). Keep remainder open until ORIGINAL pinned Native source exit.
No cancellation/loosening of Native STOP for the residual.
Fixed original P44 one-slot 33 entries, no slot unlock/new admissions, genuine
compound NAV and gross 0.75x M5 high-stress DD with partial filled cash tracked.
Research only, never live. No untouched OOS.
"""
from __future__ import annotations
import hashlib,json,math
from pathlib import Path
from collections import Counter,defaultdict
from prism7_p42_pre_onset_first_downleg_hybrid_20261122 import R,SOURCE,GROSS
from prism7_p38_causal_multihorizon_entry_20261122 import SOURCES
from prism7_native53_event_attribution_20261122 import load_m5
from prism7_p44_native53_pre_drop_context_source_exit_20261122 import source_slot,economy
M5=300000;H=3600000;DATA_END=1794960000000
PIN="1657e173d250ad58f53e62f7bb0a3428fb405496"
TARGETS=(.01,.02,.03,.05)
FRACTIONS=(.25,.50,.75)
FEES=(10,30)
COVERS=(0,100)
OUT=R/"PRISM7_P58_ORIGINAL_NATIVE53_PARTIAL_PROFIT_COVER_SOURCE_STOP_REMAINDER_20261122.json"
MD=R/"PRISM7_P58_ORIGINAL_NATIVE53_PARTIAL_PROFIT_COVER_SOURCE_STOP_REMAINDER_20261122.md"
LEDGER=R/"PRISM7_P58_ALL_FIXED33_PARTIAL_EXIT_CASE_LEDGER_20261122.jsonl"
P44=R/"PRISM7_P44_NATIVE53_PRE_DROP_CONTEXT_0P75_SINGLE_SLOT_20261122.json"
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def rd(x,n=5):return round(float(x),n)
def payload(original):
 out=[]
 for x in original:
  assert x["parity"]=="EXACT"
  assert abs(100*(1-x["exitPrice"]/x["entryPrice"])-.3-x["net30pct"])<1e-7
  out.append({"key":x["period"]+"|"+x["id"]+"|"+str(x["entryTs"]),
   "period":x["period"],"id":x["id"],"entryTs":x["entryTs"],"entryPrice":x["entryPrice"],
   "exitTs":x["exitTs"],"exitPrice":x["exitPrice"],
   "origNet30Pct":x["net30pct"],"origExitReason":x["exitReason"]})
 return out
def prep_partial(x,m5,target,guard=1):
 entry=x["entryPrice"];start=x["entryTs"];end=x["exitTs"]
 if target is None:
  return {"applied":False,"model":"NATIVE_NO_PARTIAL","partTs":None,"partPx":None,
     "coverBarVolumeEXPOST":None,"sourceStopUnchanged":True}
 for t in range(start,end,M5):
  z=m5.get(t)
  if z is None:raise ValueError("P58_M5_PRICE_HOLE")
  if float(z[5])<=0:continue
  gain=(entry-float(z[4]))/entry
  if gain+1e-12<target:continue
  known=t+M5
  if known>=end or known+guard*H>=end:continue
  nextbar=m5.get(known)
  if nextbar is None:raise ValueError("P58_NEXT_BAR_MISSING")
  px=float(nextbar[1])
  assert px>0
  return {"applied":True,"model":"PARTIAL_TP","partTs":known,"partPx":px,
   "target":target,"signalKnownAtTs":known,
   "signalCompleteM5Ts":t,
   "signalObservedGainPct":rd(100*gain),
   "coverBarVolumeEXPOST":float(nextbar[5]),
   "coverBarVolumeUnknownAtSignal":True,
   "nativeSTOPPriorityLeadHours":guard,"sourceStopUnchanged":True}
 return {"applied":False,"model":"PARTIAL_TP_NO_SIGNAL_BEFORE_NATIVE",
   "partTs":None,"partPx":None,"target":target,
   "coverBarVolumeEXPOST":None,"nativeSTOPPriorityLeadHours":guard,
   "sourceStopUnchanged":True}
def econ_partial(book,m5,parts,frac,fee,slip):
 assert book and len(book)==33
 cash=10000.;peak=10000.;realpeak=10000.
 maxCloseDD=0.;maxHighDD=0.;realDD=0.
 closed=[];lastUntil=-1
 for x in book:
  entry=x["entryPrice"];end=x["exitTs"];start=x["entryTs"]
  assert start>=lastUntil
  p=parts[x["key"]];fraction=frac if p["applied"] else 0.
  assert 0<=fraction<=1
  origCash=cash
  partialEquityPct=0.
  if fraction:
   partialEquityPct=GROSS*fraction*((entry-p["partPx"]*(1+slip/10000))/entry-fee/10000)
  remain=1-fraction
  marked=entry
  for t in range(start,end+1,M5):
   bar=m5.get(t)
   if bar is None:raise ValueError("P58_M5_BAR_MISSING")
   if float(bar[5])>0:marked=float(bar[4])
   if t==end:
     sourceRest=GROSS*remain*((entry-x["exitPrice"]*(1+slip/10000))/entry-fee/10000)
     tradeEquityPct=partialEquityPct+sourceRest
     nav=origCash*(1+tradeEquityPct)
     assert nav>0
   else:
     active=fraction and t>=p["partTs"]
     if active:
       markedPct=partialEquityPct+GROSS*remain*((entry-marked)/entry-fee/10000)
       if float(bar[5])>0:
        hiPct=partialEquityPct+GROSS*remain*((entry-float(bar[2]))/entry-fee/10000)
       else:hiPct=None
     else:
       markedPct=GROSS*((entry-marked)/entry-fee/10000)
       hiPct=GROSS*((entry-float(bar[2]))/entry-fee/10000) if float(bar[5])>0 else None
     nav=origCash*(1+markedPct)
     if hiPct is not None:
       hiNav=origCash*(1+hiPct)
       maxHighDD=max(maxHighDD,100*(1-hiNav/peak))
   peak=max(peak,nav)
   maxCloseDD=max(maxCloseDD,100*(1-nav/peak))
  cash=nav
  realpeak=max(realpeak,cash)
  realDD=max(realDD,100*(1-cash/realpeak))
  grossTotal=100*tradeEquityPct
  closed.append({"key":x["key"],"cohort":x["period"],
    "originalNativeWins":x["origNet30Pct"]>0,
    "originalNativeNet30Pct":rd(x["origNet30Pct"]),
    "newEquityReturnPct":rd(grossTotal),"newWins":grossTotal>0,
    "earlyPartialApplied":bool(p["applied"]),
    "fractionPartialCovered":fraction,
    "nativeSourceRemainderStoppedOriginalTs":end,
    "nativeSourceRemainderPrice":x["exitPrice"],
    "partialCoveredAtTs":p["partTs"],
    "partialCoverPx":p["partPx"],
    "partialCoverBarVolumeEXPOST":p["coverBarVolumeEXPOST"]})
  lastUntil=end+M5
 wins=sum(z["newWins"] for z in closed)
 gains=sum(z["newEquityReturnPct"] for z in closed if z["newEquityReturnPct"]>0)
 losses=-sum(z["newEquityReturnPct"] for z in closed if z["newEquityReturnPct"]<0)
 return {"originalFixedOneSlot33Count":33,"closed":33,"wins":wins,
  "winPct":rd(100*wins/33),"M5HighStressDDPct":rd(max(maxHighDD,maxCloseDD)),
  "M5CloseDDPct":rd(maxCloseDD),"realizedDDPct":rd(realDD),
  "NAVYen":rd(cash,2),
  "conditionalPF":rd(gains/losses) if losses>0 else None,
  "partialExits":sum(z["earlyPartialApplied"] for z in closed),
  "zeroVolumePartialCoverBarEXPOST":sum(z["earlyPartialApplied"] and (z["partialCoverBarVolumeEXPOST"]<=0) for z in closed),
  "originalWinnersTurnedLosers":sum(z["originalNativeWins"] and not z["newWins"] for z in closed),
  "originalLosersSalvaged":sum(not z["originalNativeWins"] and z["newWins"] for z in closed),
  "newTradeResultRows":closed,"noPrematureReentry":True}
def main():
 original=json.loads(SOURCE.read_text(encoding="utf8"))
 assert len(original)==53 and sum(z["net30pct"]>0 for z in original)==29
 orig=payload(original)
 slot,skipped=source_slot(orig)
 assert len(slot)==33 and len(skipped)==20
 origRef=economy(slot,load_m5(SOURCES)[0],30,0)
 assert origRef["singleSlotPositions"]==33 and origRef["wins"]==18
 m5,m5hash=load_m5(SOURCES)
 baseline=prepmap={z["key"]:prep_partial(z,m5,None) for z in slot}
 old=econ_partial(slot,m5,baseline,0.,30,0)
 assert old["closed"]==origRef["singleSlotPositions"]==33
 assert old["wins"]==origRef["wins"]==18
 assert abs(old["M5HighStressDDPct"]-origRef["M5HighStressMarkedDDPct"])<1e-3
 assert abs(old["NAVYen"]-origRef["finalNAVYen"])<1e-2
 scenarios=[];details=[]
 for target in (None,)+TARGETS:
  parts={x["key"]:prep_partial(x,m5,target) for x in slot}
  for frac in ((0.,) if target is None else FRACTIONS):
   case="NATIVE_UNCHANGED" if target is None else ("PARTIAL_TP"+str(round(100*target,1))+"_F"+str(round(100*frac)))
   for fee in FEES:
    for slip in COVERS:
     econ=econ_partial(slot,m5,parts,frac,fee,slip)
     scenarios.append({"model":case,"profitTriggerPct":rd(100*target) if target is not None else None,
       "partialCoverFractionOfOriginalNotional":frac,
       "nativeSourceSTOPLeadGuardHours":1,
       "originalOriginalSource53IntentsUnchanged":True,
       "original33SourceSlotUnchanged":True,
       "feeBps":fee,"extraBuyCoverBps":slip,"gross":GROSS,
       "capital":{k:v for k,v in econ.items() if k!="newTradeResultRows"}})
     if fee==30 and slip==0:details.append({"model":case,
        "original33StillSameSourceIds":True,"tradeDetails":econ["newTradeResultRows"],
        "sourcePriorSTOPHoldUntilOriginalExit":True})
 assert len(scenarios)==(1+len(TARGETS)*len(FRACTIONS))*len(FEES)*len(COVERS)
 regular=[z for z in scenarios if z["feeBps"]==30 and z["extraBuyCoverBps"]==0]
 baselineRow=next(z for z in regular if z["model"]=="NATIVE_UNCHANGED")
 assert baselineRow["capital"]["wins"]==18 and baselineRow["capital"]["M5HighStressDDPct"]==25.10029
 robust=[z for z in regular if z["capital"]["winPct"]>=70 and z["capital"]["M5HighStressDDPct"]<=20 and z["capital"]["NAVYen"]>=baselineRow["capital"]["NAVYen"]]
 report={"schema":"prism7-p58-native53-source-native-stop-retained-partial-m5-TP/v1",
  "status":"RESEARCH_ONLY_NO_UNSEEN_OOS",
  "sourcePinnedNativeSHA":PIN,"source53AllOriginalSourceNativeWins":29,
  "sourceOriginal33SlotBaselineExactP44Parity":True,
  "M5PartialOnlyAfterFullyClosedPrintedCandle":True,
  "partialCoverNextM5OPENFutureVolumeNotUsed":True,
  "remainingPositionAtNativeOriginalExitTsAndPx":True,
  "originalSTOPCannotBeCancelledOrPostponedInResearch":True,
  "sourceGross":GROSS,"sourceFees":FEES,"coverExtraSlippageBps":COVERS,
  "sourceOriginal53Intents":53,"sourceOriginalSelected33":33,
  "modelsFixedBeforeView":len(regular),
  "scenarioCount":len(scenarios),
  "normal30bps":regular,"allScenarios":scenarios,
  "matched70Win20DDAndProfitNotWorseExploratory":robust,
  "fullSource33PartialTradeLedger":details,
  "inputSHA":{"native53":sha(SOURCE),"originalP44":sha(P44),"M5":m5hash},
  "limits":[
   "Original Native V20 exits preserved for remaining notional. Research partial fill itself NOT exchange signed and actual STOP quantity updates, API order races, fees/funding unverified.",
   "All 33 single-slot source entrants fixed; no freed entry slots because residual position remains until original source exit. This is not a real multi-runner account.",
   "Early partial profit-taking may reduce original big winner magnitude and improve ratio of winners artificially; compare NAV and DD robustly.",
   "Cover at NEXT M5 open even when zero trade volume; cover bar volume is posthoc only, not used to select fill time.",
   "P44 source H1 exact Native exits and M5 intrabar high/low STOP uncertainty remains; original NATIVE STOP size downsizing exchange mechanics not replayed.",
   "No independent unseen period, too many tested targets/fractions, no research route can be promoted based on these P58 results.",
   "No real operation, no production Runner, STOP, order, Kill Switch or risk setting modified."
  ]}
 OUT.write_text(json.dumps(report,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf8")
 LEDGER.write_text("".join(json.dumps(z,ensure_ascii=False,sort_keys=True)+"\n" for z in details),encoding="utf8")
 lines=["# P58 Original Native53: partial realization, residual native STOP unchanged",
  "",
  "P44 baseline exact: fixed original33 one-slot, 18 wins, 25.10029% M5 high DD, NAV 14,193 yen at gross0.75, 30bps.",
  "","| Trigger favor% | Partial fraction | Wins/33 | Win% | High DD | NAV yen | Partial events | Cover no prints |",
  "|---|---:|---:|---:|---:|---:|---:|---:|"]
 for z in regular:
  e=z["capital"]
  lines.append("| "+str(z["profitTriggerPct"])+" | "+str(z["partialCoverFractionOfOriginalNotional"])+" | "+str(e["wins"])+"/33 | "+str(e["winPct"])+"% | "+str(e["M5HighStressDDPct"])+"% | "+str(e["NAVYen"])+" | "+str(e["partialExits"])+" | "+str(e["zeroVolumePartialCoverBarEXPOST"])+" |")
 lines+=["","Partial profit cover never changes original native remaining source exit; time / M5 intrabar risks and venue order fill mechanics remain unverified. No unused source winners removed, no LIVE adoption."]
 MD.write_text("\n".join(lines)+"\n",encoding="utf8")
 print("P58_NATIVE53_PARTIAL_COVER_KEEP_NATIVE_REMAINDER_P44_BASELINE_PARITY_PASS",
  json.dumps({"scenarios":len(scenarios),
    "regular":[{"model":z["model"],"win":z["capital"]["wins"],
      "wr":z["capital"]["winPct"],"DD":z["capital"]["M5HighStressDDPct"],
      "NAV":z["capital"]["NAVYen"],"partialEvents":z["capital"]["partialExits"],
      "noPrintCover":z["capital"]["zeroVolumePartialCoverBarEXPOST"],
      "savedOldLosers":z["capital"]["originalLosersSalvaged"],
      "newLosersFromOrigWinners":z["capital"]["originalWinnersTurnedLosers"]} for z in regular],
     "strictExploratoryWin70DD20NAVnotWorse":len(robust)},ensure_ascii=False),flush=True)
 print("FILES",OUT,MD,LEDGER)
if __name__=="__main__":main()
