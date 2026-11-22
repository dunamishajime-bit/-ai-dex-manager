#!/usr/bin/env python3
"""PRISM VII P52: genuine 5m FIRST downside breakout detector.

Unlike P51/P47, P52 source candidates are detected from a *completed M5*
bearish candle and prior 12 completed M5 low. No H1 candle currently in
progress is read; only the most recent FULLY CLOSED H1 for regime/gates.

At t+5m after M5 event t, a hypothetical short price proxy is the next bar
OPEN; the entry bar's still-future volume is never used to select signals.
One-position 0.75x P20 stop72 M5 reference economic test, not exact V20
runtime. All signals PRE/BASE/POST historically inspected, not OOS.

BTC M5 one invalid public bar is quarantined; it is never interpolated.
"""
from __future__ import annotations
import hashlib,json,math,datetime
from collections import Counter,defaultdict
from pathlib import Path
from prism7_p20_pengu_s3_market_structure_native_source_comparison_20261122 import (
   h1_source,moving_ema,stop72,H,M5,cohort,DATA_END
)
from prism7_native53_event_attribution_20261122 import load_m5
from prism7_p38_causal_multihorizon_entry_20261122 import BTC,load_btc_quarantine
from prism7_p42_pre_onset_first_downleg_hybrid_20261122 import (
   R,SOURCE,PENGUH1,BTCH1,SOURCES,GROSS,economic
)
P51=R/"PRISM7_P51_INITIAL_SHORT_M5_SELLING_PERSISTENCE_ENTRY_20261122.json"
OUTPUT=R/"PRISM7_P52_TRUE_M5_FIRST_DROP_TAKER_SELL_CONTEXT_20261122.json"
NOTE=R/"PRISM7_P52_TRUE_M5_FIRST_DROP_TAKER_SELL_CONTEXT_20261122.md"
EVENTS=R/"PRISM7_P52_TRUE_M5_FIRST_DROP_ALL_ELIGIBLE_EVENT_LEDGER_20261122.jsonl"
SELECTED=R/"PRISM7_P52_TRUE_M5_FIRST_DROP_ALL_MODELS_EXECUTION_LEDGER_20261122.jsonl"
THRESHOLDS=(.003,.005)
COOLDOWN_H=24
ARMS=(
 "RAW_FIRST_M5_BREAK",
 "M5_TAKER_SELL55",
 "M5_TAKER_SELL60",
 "M5_SELLER_RELATIVE_TO_BTC",
 "PRIOR_H1_BTC_BEAR",
 "PRIOR_H1_RELATIVE_WEAK",
 "PRIOR_H1_EMA_BEAR",
 "PRIOR_H1_2OF3",
 "PRIOR_H1_ALL3",
 "M5_TAKER_SELL55_AND_H1_2OF3",
 "M5_TAKER_SELL55_AND_REL_BTC",
 "M5_TAKER_SELL55_AND_LIQUID6OF12",
 "M5_TAKER_BUY60_NEG_CONTROL",
)
FEES=(10,30)
COVER=(0,100)
def sha(f):return hashlib.sha256(Path(f).read_bytes()).hexdigest()
def rnd(z,n=6):return None if z is None else round(float(z),n)
def build(p,b,m,btcm5):
    pidx={z["time"]:i for i,z in enumerate(p)}
    ema72=moving_ema(p,72);ema168=moving_ema(p,168)
    out=[]
    for t in sorted(m):
      if t<1754006400000+200*H or t>=DATA_END-M5:continue
      now=m[t]
      if len(now)<11:raise ValueError("P52_PENGU_FIELDS")
      op,hi,lo,cl,vol,buy=[float(now[j]) for j in (1,2,3,4,5,9)]
      if not(0<lo<=min(op,cl)<=max(op,cl)<=hi and vol>=0 and 0<=buy<=vol):
        raise ValueError("P52_INVALID_PENGU_M5:"+str(t))
      if vol<=0 or cl>=op or cl/op-1>-.003:continue
      lastH1Start=t//H*H-H
      i=pidx.get(lastH1Start)
      if i is None or i<200:continue
      if p[i]["time"]+H>t:raise ValueError("P52_H1_NOT_ASOF")
      prev24=p[i]["close"]/p[i-24]["close"]-1
      if prev24<=-.03:continue
      bars=[m.get(t-k*M5) for k in range(12,0,-1)]
      if any(z is None for z in bars):raise ValueError("P52_M5_HISTORY_HOLE")
      priorLastHourRet=float(bars[-1][4])/float(bars[0][1])-1
      if priorLastHourRet<=-.01:continue
      prior12Low=min(float(z[3]) for z in bars)
      if not cl<prior12Low:continue
      if (now[0] if len(now) else None) is None:raise ValueError("P52_BAD_M5")
      refBTC=btcm5.get(t)
      btcRatio=None
      if refBTC is not None and float(refBTC[5])>0:
         v=float(refBTC[5]);bc=float(refBTC[9])
         if not(0<=bc<=v):raise ValueError("P52_BTC_TAKER_QA")
         btcRatio=bc/v
      pngBuyRatio=buy/vol
      btc24=b[i]["close"]/b[i-24]["close"]-1
      rel=prev24-btc24
      h1flags={
       "btcBear":btc24<=0,
       "relativeWeak":rel<=-.01,
       "emaBear":ema72[i]<ema168[i] and p[i]["close"]<ema72[i]
      }
      event={
       "id":"M5_"+str(t),
       "sourceM5ReferenceTs":t,
       "signalKnownAtTs":t+M5,
       "entryIntentTs":t+M5,
       "cohort":cohort(t+M5),
       "sourceNativeV20NewSignal":False,
       "M5BodyMovePct":rnd(100*(cl/op-1)),
       "eventCloseBelowPrior12M5LowPct":rnd(100*(cl/prior12Low-1)),
       "eventM5PENGUTakerBuyRatio":rnd(pngBuyRatio),
       "eventM5BTCTakerBuyRatio":rnd(btcRatio),
       "eventM5PENGUMinusBTCTakerBuyRatio":rnd(pngBuyRatio-btcRatio) if btcRatio is not None else None,
       "eventM5PositiveVolume":vol,
       "last12M5PositivePrintCount":sum(float(z[5])>0 for z in bars),
       "last12M5VolumeSum":rnd(sum(float(z[5]) for z in bars),6),
       "priorH1LastCompletedStart":p[i]["time"],
       "priorH1Return24Pct":rnd(100*prev24),
       "priorH1BtcReturn24Pct":rnd(100*btc24),
       "priorH1PenguVsBtcReturn24Pct":rnd(100*rel),
       "priorH1Flags":h1flags,
       "prior12M5CloseReturnPct":rnd(100*priorLastHourRet),
       "signalCausalM5AndPriorCompletedH1":True,
       "sourceM5EventHasPositiveVolume":True,
       "entryBarOwnVolumeNotInspected":True
      }
      if event["cohort"]=="OUTSIDE_COHORT":continue
      out.append(event)
    out.sort(key=lambda x:x["entryIntentTs"])
    # Use SAME initial events across all H1 and taker gates so they are directly
    # comparable and never resample just profitable periods. First raw per24h.
    last=-1
    for event in out:
       event["firstRawDownBreakIn24h"]=last<0 or event["entryIntentTs"]-last>COOLDOWN_H*H
       last=event["entryIntentTs"]
    return out
def gate(z,rule):
    f=z["priorH1Flags"];p=z["eventM5PENGUTakerBuyRatio"]
    q=z["eventM5BTCTakerBuyRatio"]
    cnt=sum(bool(z) for z in f.values())
    if rule=="RAW_FIRST_M5_BREAK":return True
    if rule=="M5_TAKER_SELL55":return p<=.45
    if rule=="M5_TAKER_SELL60":return p<=.40
    if rule=="M5_SELLER_RELATIVE_TO_BTC":return q is not None and p<=q-.05
    if rule=="PRIOR_H1_BTC_BEAR":return f["btcBear"]
    if rule=="PRIOR_H1_RELATIVE_WEAK":return f["relativeWeak"]
    if rule=="PRIOR_H1_EMA_BEAR":return f["emaBear"]
    if rule=="PRIOR_H1_2OF3":return cnt>=2
    if rule=="PRIOR_H1_ALL3":return cnt==3
    if rule=="M5_TAKER_SELL55_AND_H1_2OF3":return p<=.45 and cnt>=2
    if rule=="M5_TAKER_SELL55_AND_REL_BTC":return q is not None and p<=.45 and p<=q-.05
    if rule=="M5_TAKER_SELL55_AND_LIQUID6OF12":return p<=.45 and z["last12M5PositivePrintCount"]>=6
    if rule=="M5_TAKER_BUY60_NEG_CONTROL":return p>=.60
    raise ValueError("P52_UNDECLARED_GATE:"+rule)
def select(raw,m,rule):
    busy=-1;selected=[];blocked=[];bad=0
    for e in raw:
      t=e["entryIntentTs"]
      if t<busy:
         blocked.append(e["id"]);continue
      entry=m.get(t)
      if entry is None:raise ValueError("P52_SCHEDULED_M5_MISSING")
      price=float(entry[1])
      if not price>0:raise ValueError("P52_BAD_PROXY_PRICE")
      stop=stop72(m,t,price)
      z={"id":e["id"],"route":rule,"cohort":e["cohort"],"entryTs":t,
         "entryPrice":price,"exitTs":stop.get("exitTs"),
         "exitPrice":stop.get("exitPrice"),"status":stop["status"],
         "reason":stop.get("exitReason"),
         "sourceM5EventPositiveVolumeKnownAtDecision":True,
         "entryM5BarPositiveVolumeExPost":float(entry[5])>0,
         "entryM5VolumeNotUsedToGate":True}
      if float(entry[5])<=0:bad+=1
      selected.append(z)
      if stop["status"]=="PRICE_PROXY_CLOSED":busy=stop["exitTs"]+M5
      else:busy=DATA_END
    return selected,{"blocked":len(blocked),"blockedIds":blocked,"exPostZeroVolumeEntryCount":bad}
def main():
    native=json.loads(SOURCE.read_text(encoding="utf8"))
    assert len(native)==53 and sum(x["net30pct"]>0 for x in native)==29
    p,psha=h1_source(PENGUH1);b,bsha=h1_source(BTCH1)
    assert len(p)==len(b) and all(x["time"]==z["time"] for x,z in zip(p,b))
    m,msha=load_m5(SOURCES)
    btc,btchashes,badbtc=load_btc_quarantine(BTC)
    assert len(badbtc)==1 and len(btc)==len(m)-1
    raw=build(p,b,m,btc)
    assert len(raw)>30 and all(x["signalKnownAtTs"]==x["entryIntentTs"] for x in raw)
    first=[x for x in raw if x["firstRawDownBreakIn24h"]]
    assert len(first)>10
    allresults=[];ledgers=[]
    print("P52_TRUE_M5_RAW_ONSET",len(raw),"FIRST_24H",len(first),
        "BTC_INVALID_QUARANTINE",len(badbtc),flush=True)
    for threshold in THRESHOLDS:
      filt=[x for x in first if x["M5BodyMovePct"]<=-100*threshold]
      for arm in ARMS:
        sig=[x for x in filt if gate(x,arm)]
        rows,block=select(sig,m,arm)
        for fee in FEES:
          for slip in COVER:
            eco=economic(rows,m,fee,slip)
            allresults.append({"threshold":threshold,
               "arm":arm,"predeclaredH1Prior24ReturnGreaterThanMinus3":True,
               "prior12M5ReturnGreaterThanMinus1":True,
               "firstRawEventPer24h":True,
               "allInitialEventCandidates":len(first),
               "modelEligible":len(sig),
               "oneSlotSelected":len(rows),
               "slotBlocked":block["blocked"],
               "feeBps":fee,"extraBuyCoverBps":slip,"gross":GROSS,
               "exPostZeroVolumeAtEntryOpen":block["exPostZeroVolumeEntryCount"],
               "capital":eco})
        ledgers.append({"threshold":threshold,"arm":arm,
           "eligibleEventIds":[x["id"] for x in sig],
           "blockedBySlotIds":block["blockedIds"],
           "selected":[{"id":z["id"],"entryTs":z["entryTs"],"entryPrice":z["entryPrice"],
              "exitTs":z["exitTs"],"exitPrice":z["exitPrice"],
              "exitReason":z["reason"],"zeroVolumeAtEntry":not z["entryM5BarPositiveVolumeExPost"],
              "cohort":z["cohort"]} for z in rows]})
    assert len(allresults)==len(THRESHOLDS)*len(ARMS)*len(FEES)*len(COVER)
    regular=[x for x in allresults if x["feeBps"]==30 and x["extraBuyCoverBps"]==0]
    candidate=[x for x in regular if x["capital"]["closed"]>=20 and
      x["capital"]["conditionalWinPct"]>=70 and x["capital"]["M5HighStressDDPct"]<=20]
    report={
      "schema":"prism7-p52-genuine-first-M5-break-with-prior-completed-H1-asof-context/v1",
      "status":"CAUSAL_RESEARCH_NO_LIVE_OR_UNSEEN_OOS",
      "rawM5DownsideEventsBefore24hCooldown":len(raw),
      "firstRawEventPer24h":len(first),
      "H1LookbackStrictPreviousCompletedHour":True,
      "sourceNativeV20Unmodified":53,"sourceNativeV20Wins":29,
      "priorH1BtcComparisonFullCompletedCandle":True,
      "BTCInvalidBarQuarantined":badbtc,
      "eventM5TakerBuyVolumeObservedAtCloseBeforeNextM5Open":True,
      "nextM5EntryBarOwnVolumeExcludedFromAllGates":True,
      "nextM5EntryOpenOnlyProxyNotSignedFill":True,
      "allThresholdsPredeclared":THRESHOLDS,"allGatesPredeclared":ARMS,
      "gross":GROSS,"feeBps":FEES,"extraBuyCoverStressBps":COVER,
      "scenarioCount":len(allresults),
      "allScenarios":allresults,
      "regular30bpsNoExtraSlip":regular,
      "exploratoryPassingWin70DD20N20":candidate,
      "fullGeneratedM5EventLedger":raw,
      "individualScenarioEligibilityAndBookedPositions":ledgers,
      "sourceSHA256":{"P51PreviousH1AfterCloseStudy":sha(P51),
         "NativeSource53":sha(SOURCE),"PENGUH1":psha,"BTCH1":bsha,
         "PENGUM5":msha,"BTCM5Raw":btchashes},
      "limitations":[
        "M5 early drop detector fires on a completed bearish M5 whose CLOSE fell below prior 12 M5 low, not before the first trade of price decline.",
        "The previous 24h H1 return >-3% and previous 12 M5 return >-1% reduce already-ended decline but do NOT rule out larger prior intraday drop and rebound.",
        "BTC M5 has one invalid OHLC source bar quarantined; any missing BTC M5 relative features are refused, not invented.",
        "Source one-position P20 hard8 trail activation15 retrace4 max72h exits, not exact Native V20 phase exits; no venue STOP or signed fill.",
        "The next M5 scheduled open may not be tradeable (bar zero volume); ex-post volume tracked as an audit but never used to select entry.",
        "Execution price is an OHLC archive not bid/ask or orderbook quote; 100bps cover stress not full execution/slippage proof.",
        "All historical PRE/BASE/POST data already seen in P8-P51. Any good threshold in this 104-scenario family risks cherry picking.",
        "0.75x one-slot M5 marked DD excludes other Runners, funding, liquidity/liquidation and portfolio risk.",
        "No true unseen OOS or artificial market stress validation. No new live signals can be promoted."
      ]}
    OUTPUT.write_text(json.dumps(report,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf8")
    EVENTS.write_text("".join(json.dumps(x,ensure_ascii=False,sort_keys=True)+"\n" for x in raw),encoding="utf8")
    SELECTED.write_text("".join(json.dumps(x,ensure_ascii=False,sort_keys=True)+"\n" for x in ledgers),encoding="utf8")
    lines=["# P52: True initial M5 drop without waiting for H1 close",
      "",
      "PENGU M5 first red breakdown below prior12 M5 low, prior H1 24h drop still under3%, previous M5 last60m not down1%. M5 event and taker buy ratios are fully completed before entry.",
      "",
      "| Body threshold | Rule | Eligible | Closed | Wins | Win% | DD high | NAV | Entry 5m zero-volume |",
      "|---|---|---:|---:|---:|---:|---:|---:|---:|"]
    for x in regular:
      eco=x["capital"]
      lines.append("| "+str(round(100*x["threshold"],2))+"% | "+x["arm"]+" | "+str(x["modelEligible"])+" | "+
       str(eco["closed"])+" | "+str(eco["wins"])+" | "+str(eco["conditionalWinPct"])+"% | "+
       str(eco["M5HighStressDDPct"])+"% | "+str(eco["finalProxyNavYen"])+" | "+str(x["exPostZeroVolumeAtEntryOpen"])+" |")
    lines+=["","Study is retrospective and there is NO independent OOS. All execution and STOPs price proxies only. No LIVE adoption."]
    NOTE.write_text("\n".join(lines)+"\n",encoding="utf8")
    print("P52_TRUE_M5_PRE_H1_CLOSE_FIRST_DOWNLEG_TAKER_CAUSAL_PASS",
     json.dumps({"rawM5":len(raw),"first24":len(first),"scenarios":len(allresults),
       "regular":[{"threshold":x["threshold"],"arm":x["arm"],"eligible":x["modelEligible"],
         "closed":x["capital"]["closed"],"wins":x["capital"]["wins"],
         "winpct":x["capital"]["conditionalWinPct"],"dd":x["capital"]["M5HighStressDDPct"],
         "nav":x["capital"]["finalProxyNavYen"],"entryZeroVol":x["exPostZeroVolumeAtEntryOpen"],
         "cohorts":x["capital"]["cohorts"]}
        for x in regular],
       "candidateStrong":len(candidate)},ensure_ascii=False),flush=True)
    print("FILES",OUTPUT,NOTE,EVENTS,SELECTED)
if __name__=="__main__":main()
