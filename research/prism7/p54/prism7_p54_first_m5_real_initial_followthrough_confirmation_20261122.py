#!/usr/bin/env python3
"""PRISM VII P54: first-drop M5 buyer/seller and next M5 follow-through.

P53 determined 39/142 P52 first episodes with NO prior 3% down path in prior
24h completed M5 closes. ALL candidate groups based on this fixed, observable
historical window; no winner/loser selection. Compare conditional buyer-side
absorption hypothesis with SELL aggression, no-filter, and next candle control.

At event t: completed M5 known at t+5.
For follow-through bar t+5: completed at t+10. Enter at next M5 open t+10,
NEVER reading the entry bar's future volume as a gate. The immediate version
enters at t+5. One position, max72h P20 research exit, 0.75x gross, 30bps.
No live modification, no unseen OOS.
"""
from __future__ import annotations
import json,hashlib,math
from collections import Counter,defaultdict
from pathlib import Path
from prism7_p20_pengu_s3_market_structure_native_source_comparison_20261122 import stop72,H,M5,DATA_END
from prism7_native53_event_attribution_20261122 import load_m5
from prism7_p42_pre_onset_first_downleg_hybrid_20261122 import R,SOURCES,SOURCE,economic,GROSS
P53=R/"PRISM7_P53_FIRST_M5_TAKER_BUY_ABSORPTION_AND_PRIOR_DROP_AUDIT_20261122.json"
P52=R/"PRISM7_P52_TRUE_M5_FIRST_DROP_TAKER_SELL_CONTEXT_20261122.json"
OUT=R/"PRISM7_P54_FIRST_M5_CLEAN_DROP_FOLLOWTHROUGH_AND_FILL_AUDIT_20261122.json"
MD=R/"PRISM7_P54_FIRST_M5_CLEAN_DROP_FOLLOWTHROUGH_AND_FILL_AUDIT_20261122.md"
LEDGER=R/"PRISM7_P54_CLEAN_FIRST39_ALL_MODELS_SELECTED_POSITION_LEDGER_20261122.jsonl"
CASES=(
 ("ALL_CLEAN_DIRECT",0),
 ("ALL_CLEAN_WAIT5_CONTROL",1),
 ("BUY60_DIRECT",0),
 ("SELL55_DIRECT",0),
 ("BUY60_WAIT5_CONTROL",1),
 ("SELL55_WAIT5_CONTROL",1),
 ("BUY60_FOLLOWTHROUGH_DOWN5",1),
 ("SELL55_FOLLOWTHROUGH_DOWN5",1),
 ("ALL_FOLLOWTHROUGH_DOWN5",1),
 ("ALL_FOLLOWTHROUGH_UP5_CONTROL",1),
 ("BUY60_FOLLOWTHROUGH_DOWN10",2),
 ("SELL55_FOLLOWTHROUGH_DOWN10",2),
 ("BUY60_REVERTED_BUY_TO_SELL5",1),
 ("BUY60_AND_PRIOR_WICK_DD_LT3",0),
 ("SELL55_AND_PRIOR_WICK_DD_LT3",0),
)
FEES=(10,30)
COVER_STRESS=(0,100)
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def rnd(x,d=5):return round(float(x),d)
def ft(x,m,completed):
    t=x["sourceM5ReferenceTs"]
    entry=t+(completed+1)*M5
    bars=[]
    for i in range(1,completed+1):
       z=m.get(t+i*M5)
       if z is None:raise ValueError("P54_M5_FOLLOWTHROUGH_MISSING")
       bars.append(z)
    eventclose=float(m[t][4])
    future_entry=m.get(entry)
    if future_entry is None:raise ValueError("P54_ENTRY_BAR_MISSING")
    s={
      "asofSignalEventM5CloseTs":t+M5,
      "allCompletedBarsBeforeTrade":completed,
      "windowKnownAtEntryIntentTs":entry,
      "entryIntentTs":entry,
      "signalEventClose":eventclose,
      "eventTakerBuyRatio":x["eventM5PENGUTakerBuyRatio"],
      "entryBarVolumeForGate":False,
      "next5mHasPositivePrintedVolume":float(bars[0][5])>0 if bars else None,
      "down5":completed>=1 and float(bars[0][5])>0 and float(bars[0][4])<eventclose,
      "up5":completed>=1 and float(bars[0][5])>0 and float(bars[0][4])>eventclose,
      "next5mTakerBuyRatio":float(bars[0][9])/float(bars[0][5]) if bars and float(bars[0][5])>0 else None,
      "down10":completed==2 and all(float(z[5])>0 for z in bars) and
          float(bars[-1][4])<min(eventclose,float(bars[0][4])),
      "exPostEntryBarHasVolume":float(future_entry[5])>0,
      "exPostEntryBarVolume":float(future_entry[5]),
    }
    return s
def filt(row,name,f):
    taker=row["eventM5PENGUTakerBuyRatio"]
    if name in ("ALL_CLEAN_DIRECT","ALL_CLEAN_WAIT5_CONTROL"):return True
    if name in ("BUY60_DIRECT","BUY60_WAIT5_CONTROL"):return taker>=.60
    if name in ("SELL55_DIRECT","SELL55_WAIT5_CONTROL"):return taker<=.45
    if name=="BUY60_FOLLOWTHROUGH_DOWN5":return taker>=.60 and f["down5"]
    if name=="SELL55_FOLLOWTHROUGH_DOWN5":return taker<=.45 and f["down5"]
    if name=="ALL_FOLLOWTHROUGH_DOWN5":return f["down5"]
    if name=="ALL_FOLLOWTHROUGH_UP5_CONTROL":return f["up5"]
    if name=="BUY60_FOLLOWTHROUGH_DOWN10":return taker>=.60 and f["down10"]
    if name=="SELL55_FOLLOWTHROUGH_DOWN10":return taker<=.45 and f["down10"]
    if name=="BUY60_REVERTED_BUY_TO_SELL5":
       return taker>=.60 and f["down5"] and f["next5mTakerBuyRatio"] is not None and f["next5mTakerBuyRatio"]<=.50
    if name=="BUY60_AND_PRIOR_WICK_DD_LT3":
       return taker>=.60 and row["observedPrior24M5"]["maxCompletedM5HighToLaterLowPct"]<3
    if name=="SELL55_AND_PRIOR_WICK_DD_LT3":
       return taker<=.45 and row["observedPrior24M5"]["maxCompletedM5HighToLaterLowPct"]<3
    raise ValueError("P54_UNKNOWN_GATE:"+name)
def execute(eligible,m5,name,wait,fmap):
    selected=[];busy=-1;blocked=[];entryZero=0;sourceCensored=0
    for x in sorted(eligible,key=lambda z:z["entryIntentTs"]):
       sig=fmap[(x["id"],wait)]
       t=sig["entryIntentTs"]
       if t<busy:
          blocked.append(x["id"]);continue
       bar=m5.get(t)
       if bar is None:raise ValueError("P54_M5_FUTURE_BAR_MISSING")
       px=float(bar[1])
       if not px>0:raise ValueError("P54_SCHEDULED_ENTRY_PRICE_BAD")
       stop=stop72(m5,t,px)
       row={"id":x["id"],"route":name,"cohort":x["cohort"],
         "entryTs":t,"entryPrice":px,"exitTs":stop.get("exitTs"),
         "exitPrice":stop.get("exitPrice"),"status":stop["status"],
         "reason":stop.get("exitReason"),
         "entryBarVolumeExPost":float(bar[5]),"exPostEntryHasTrade":float(bar[5])>0,
         "signalledAtOrBeforeEntryTs":True,
         "fullVenueExecutionNotProven":True,
         "sourceNativeV20FullExitNotReplayed":True}
       selected.append(row)
       if float(bar[5])<=0:entryZero+=1
       if stop["status"]=="PRICE_PROXY_CLOSED":busy=stop["exitTs"]+M5
       else:sourceCensored+=1;busy=DATA_END
    return selected,{"blocked":len(blocked),"blockedIds":blocked,"entryZeroExPost":entryZero,"censored":sourceCensored}
def main():
   source=json.loads(SOURCE.read_text(encoding="utf8"))
   assert len(source)==53 and sum(x["net30pct"]>0 for x in source)==29
   p53=json.loads(P53.read_text(encoding="utf8"))
   p52=json.loads(P52.read_text(encoding="utf8"))
   assert p53["P52OriginalSelectedReferenceParity"] and p52["firstRawEventPer24h"]==142
   m5,m5sha=load_m5(SOURCES)
   raw=p53["perCandidateAsOfAndPosthocLedger"]
   assert len(raw)==142
   clean=[x for x in raw if x["observedPrior24M5"]["maxCompletedM5ClosePeakToLaterCloseTroughPct"]<3]
   assert len(clean)==39
   assert sum(x["eventM5PENGUTakerBuyRatio"]>=.60 for x in clean)==10
   assert sum(x["eventM5PENGUTakerBuyRatio"]<=.45 for x in clean)==24
   fmap={}
   for x in clean:
      for wait in (0,1,2):
         v=ft(x,m5,wait)
         assert v["entryIntentTs"]==x["sourceM5ReferenceTs"]+(wait+1)*M5
         fmap[(x["id"],wait)]=v
   reportScenarios=[];traces=[]
   for name,wait in CASES:
      chosen=[x for x in clean if filt(x,name,fmap[(x["id"],wait)])]
      # Note outcomes were observed in P52/P53. All P54 filters are exploratory
      # sensitivity tests, never independent selection.
      booked,blocks=execute(chosen,m5,name,wait,fmap)
      for fee in FEES:
         for slip in COVER_STRESS:
            econ=economic(booked,m5,fee,slip)
            reportScenarios.append({"model":name,"waitAfterM5SignalMinutes":wait*5,
             "fullyCompletedM5FollowThroughBars":wait,
             "originalCleanSource39":39,"ruleMatched":len(chosen),
             "bookedOneSlot":len(booked),"slotBlocked":blocks["blocked"],
             "zeroVolumeAtScheduledEntryExPost":blocks["entryZeroExPost"],
             "priceModelCensored":blocks["censored"],
             "feeBps":fee,"extraCoverSlippageBps":slip,"gross":GROSS,"capital":econ})
      traces.append({"model":name,
         "eligibleIds":[x["id"] for x in chosen],
         "blockedIds":blocks["blockedIds"],
         "selected":[{"id":z["id"],"cohort":z["cohort"],
             "entryTs":z["entryTs"],"entryPx":z["entryPrice"],
             "exitTs":z["exitTs"],"exitPx":z["exitPrice"],
             "exitReason":z["reason"],"zeroVolEntry":not z["exPostEntryHasTrade"]}
           for z in booked]})
   assert len(reportScenarios)==len(CASES)*len(FEES)*len(COVER_STRESS)
   # P53 P52 per-candidate original immediate source exit parity, ensuring delay
   # does not accidentally change baseline direct scenario.
   originalMap={x["id"]:x for x in clean}
   direct=next(x for x in traces if x["model"]=="ALL_CLEAN_DIRECT")
   for z in direct["selected"]:
      ref=originalMap[z["id"]]["referencePriceModelExit"]
      assert ref["entryTs"]==z["entryTs"]
      assert ref["entryProxyPrice"]==z["entryPx"]
      assert ref["exitTs"]==z["exitTs"]
      assert ref["exitProxyPrice"]==z["exitPx"]
   n=[x for x in reportScenarios if x["feeBps"]==30 and x["extraCoverSlippageBps"]==0]
   candidates=[x for x in n if x["capital"]["closed"]>=20 and x["capital"]["conditionalWinPct"]>=70 and x["capital"]["M5HighStressDDPct"]<=20]
   manifest={
    "schema":"prism7-p54-genuine-first-M5-downleg-clean39-five-minute-followthrough-replay/v1",
    "status":"RESEARCH_ONLY_NOT_UNSEEN_OOS",
    "allSourceNative53UnmodifiedAnd29Wins":True,
    "P52P53SourceFirstM5NextBarEntryExitParity":True,
    "source142InitialFirstEpisodes":142,
    "source24hCompletedM5PricePathDDLess3Pct":len(clean),
    "sourceSubgroupsBuyerTaker60":10,"sourceSubgroupsSellerTaker55":24,
    "pendingNextM5CompletionAlwaysBeforeExtra5mEntry":True,
    "entryBarFutureVolumeNeverUsedAsGate":True,
    "zeroVolumeScheduledEntriesExPostAuditOnly":True,
    "sourceSTOP72ResearchNotSourceNativeV20":True,
    "gross":GROSS,"feeBps":FEES,"extraBuyCoverStress":COVER_STRESS,
    "scenarioCount":len(reportScenarios),"predeclaredSourceCases":CASES,
    "allScenarios":reportScenarios,"normal30bps":n,
    "exploratoryStrongMin20Win70DD20":candidates,
    "allModelSelectedAndOmittedLedger":traces,
    "sourceSHA256":{"P53":sha(P53),"P52":sha(P52),
     "native53":sha(SOURCE),"PENGUM5":m5sha},
    "limitations":[
      "All source periods P8-P53 already seen. Any winning result selected from P54 is IN-SAMPLE and cannot validate LIVE signal.",
      "Prior24h historical M5 max-close drawdown <3% still permits >3% wicks and an earlier partial downleg/recovery.",
      "Buyer-taker60 red candle may reflect passive seller absorption but raw volume proxy cannot infer participant intent; possible low-liquidity artifacts.",
      "Requiring a follow-through M5 is a causal additional +5/+10 minute delay; next OPEN is an archival proxy, not signed venue fill. Entry own bar volume is ex-post audit only.",
      "Research P20 stop72 8% hard/trail activate15/retrace4 max72h, not actual native V20 phase exit.",
      "Risk excludes shared runner opportunities, portfolio exposure caps, funding, venue resident STOP, M5 intrabar high/low and gap slippage.",
      "No direct live deployment, signal execution, owner approval or production risk changes.",
    ]
   }
   OUT.write_text(json.dumps(manifest,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf8")
   LEDGER.write_text("".join(json.dumps(x,ensure_ascii=False,sort_keys=True)+"\n" for x in traces),encoding="utf8")
   lines=["# P54: true early first M5 break, buyer-seller flow and confirmation",
    "",
    "P53 candidate142 -> prior completed M5 24h path-close drawdown <3 ->39. Taker BUY60 in bearish M5 is an exploratory negative control, not an accepted entry. All source decisions as-of.",
    "",
    "| Rule | Wait | Eligible | One-slot closed | Wins | Win% | M5 high DD | NAV | Entry bar zero-vol (ex post) |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|"]
   for x in n:
      z=x["capital"]
      lines.append("| "+x["model"]+" | "+str(x["waitAfterM5SignalMinutes"])+" min | "+str(x["ruleMatched"])+" | "+str(z["closed"])+" | "+str(z["wins"])+" | "+str(z["conditionalWinPct"])+"% | "+str(z["M5HighStressDDPct"])+"% | "+str(z["finalProxyNavYen"])+" | "+str(x["zeroVolumeAtScheduledEntryExPost"])+" |")
   lines+=["","All historical months already inspected; new entry route source/native economic parity and actual signed fills missing; do not adopt to LIVE."]
   MD.write_text("\n".join(lines)+"\n",encoding="utf8")
   print("P54_TRUE_M5_FIRST39_SUBGROUP_FOLLOWTHROUGH_ASOF_EXIT_PARITY_PASS",
     json.dumps({"strictClean":len(clean),"scenarios":len(reportScenarios),
        "regular":[{"model":x["model"],"n":x["ruleMatched"],"closed":x["capital"]["closed"],
            "wins":x["capital"]["wins"],"winpct":x["capital"]["conditionalWinPct"],
            "DD":x["capital"]["M5HighStressDDPct"],"NAV":x["capital"]["finalProxyNavYen"],
            "entryZeroVol":x["zeroVolumeAtScheduledEntryExPost"],
            "cohorts":x["capital"]["cohorts"]} for x in n],
        "win70DD20N20":len(candidates)},ensure_ascii=False),flush=True)
   print("FILES",OUT,MD,LEDGER)
if __name__=="__main__":main()
