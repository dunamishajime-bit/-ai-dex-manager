#!/usr/bin/env python3
"""P51: H1-first-break onset -> M5 strictly causal post-onset confirmation.

Research ONLY. Source Native53 unchanged. All 149 P48 first-break events, and
107 strict-clean-first event candidates (no prior D3 in preparation; no prior
>=3% five-hour drop; no prior >=1% structural bearish H1 break).

Decision at t0 + N completed M5, NEVER reads entry bar's own volume for a gate.
Entry proxy is scheduled next M5 bar OPEN after the known N completed M5.
There is no quote or order-book evidence that open is fillable; ex-post
positive-volume flag for scheduled entry bar is an AUDIT, not a strategy gate.
Reference protective exit is P20 research stop72, not pinned V20 native exits.
"""
from __future__ import annotations
import json,hashlib,math,collections,datetime
from pathlib import Path
from prism7_native53_event_attribution_20261122 import load_m5
from prism7_p20_pengu_s3_market_structure_native_source_comparison_20261122 import (
  h1_source,stop72,H,M5,DATA_END
)
from prism7_p42_pre_onset_first_downleg_hybrid_20261122 import (
  R,PENGUH1,BTCH1,SOURCES,SOURCE,economic,GROSS
)
INPUT=R/"PRISM7_P48_TRUE_FIRST_DOWNLEG_ALL_CANDIDATES_LEDGER_20261122.jsonl"
P48=R/"PRISM7_P48_TRUE_FIRST_DOWNLEG_POSTDROP_CONTAMINATION_AUDIT_20261122.json"
OUTPUT=R/"PRISM7_P51_INITIAL_SHORT_M5_SELLING_PERSISTENCE_ENTRY_20261122.json"
NOTE=R/"PRISM7_P51_INITIAL_SHORT_M5_SELLING_PERSISTENCE_ENTRY_20261122.md"
LEDGER=R/"PRISM7_P51_ALL149_INITIAL_SHORT_M5_PREENTRY_FEATURE_LEDGER_20261122.jsonl"
CASES=(
  ("D0_H1_OPEN",0),
  ("WAIT15_ONLY",3),
  ("WAIT30_ONLY",6),
  ("WAIT60_ONLY",12),
  ("WAIT15_LIQUID_2OF3",3),
  ("WAIT15_SELL_VOL60",3),
  ("WAIT15_CONTINUATION_0P3",3),
  ("WAIT30_LIQUID_3OF6",6),
  ("WAIT30_SELL_VOL60",6),
  ("WAIT30_LOWER_LOW",6),
  ("WAIT30_SELL_AND_BREAK",6),
  ("WAIT30_NO_REBOUND",6),
  ("WAIT30_BEAR_MOMENTUM",6),
  ("WAIT30_BULL_RECOVERY_CONTROL",6),
  ("WAIT60_SELL_AND_BREAK",12),
)
GROUPS=("ALL149_P48","STRICT107_FIRST_UNDROPPED")
FEES=(10,30)
STRESS=(0,100)
def sha(f):return hashlib.sha256(Path(f).read_bytes()).hexdigest()
def rnd(v,n=5):return round(float(v),n)
def valid_bar(b):
    if b is None or len(b)<6:raise ValueError("P51_M5_MISSING_BAR")
    o,h,l,c,v=(float(b[j]) for j in (1,2,3,4,5))
    if not (0<l<=min(o,c) and h>=max(o,c) and v>=0):raise ValueError("P51_M5_BAD_OHLCV")
    return (o,h,l,c,v)
def after_features(x,m5,h1ref,wait):
    t0=x["intentTs"]
    h1=h1ref[x["signalReferenceTs"]]
    assert x["signalReferenceTs"]+H==t0
    prev_event=m5.get(t0-M5)
    if prev_event is None:raise ValueError("P51_H1_FINAL_M5_MISSING")
    if abs(float(prev_event[4])-h1["close"])>1e-10:
        raise ValueError("P51_H1_M5_LAST_CLOSE_MISMATCH:"+x["id"])
    if wait==0:
        return {"elapsedCompletedM5":0,"positivePrintBars":0,"signalKnownAt":t0,
             "barWindowEndExclusive":t0,"preEntryCausal":True,
             "entryBarOwnVolumeUsedToGate":False,"windowChecksOnly":False}
    bars=[]
    for k in range(wait):
        tt=t0+k*M5
        v=m5.get(tt)
        if v is None:raise ValueError("P51_HIST_M5_MISSING:"+str(tt))
        bars.append(valid_bar(v))
    positive=[z for z in bars if z[4]>0]
    vol=sum(z[4] for z in positive)
    sellVol=sum(z[4] for z in positive if z[3]<z[0])
    last=bars[-1]
    # Counts directional closes across completed printed M5; unprinted candles are
    # NEUTRAL in red/candle count. H1 event-price is itself already known.
    reds=sum(z[4]>0 and z[3]<z[0] for z in bars)
    high=max(z[1] for z in bars)
    low=min(z[2] for z in bars)
    priceDelta=(last[3]/h1["close"]-1)
    data={
       "elapsedCompletedM5":wait,
       "positivePrintBars":len(positive),
       "redPrintedM5Count":reds,
       "sellerPrintedVolumeRatio":rnd(sellVol/vol) if vol>0 else None,
       "sumPrintedVolume":rnd(vol,6),
       "lastCompletedPriceVsH1EventClosePct":rnd(100*priceDelta),
       "lastCompletedClose":rnd(last[3],12),
       "H1EventClose":rnd(h1["close"],12),"H1EventLow":rnd(h1["low"],12),
       "lastCompletedCloseBelowOriginalH1Low":last[3]<h1["low"],
       "minCompletedM5Low":rnd(low,12),"maxCompletedM5High":rnd(high,12),
       "maxCompletedM5HighVsH1EventClosePct":rnd(100*(high/h1["close"]-1)),
       "noReboundOver0p5pct":high<=h1["close"]*1.005,
       "signalKnownAt":t0+wait*M5,
       "barWindowEndExclusive":t0+wait*M5,
       "preEntryCausal":True,
       "entryBarOwnVolumeUsedToGate":False,"windowChecksOnly":True,
    }
    if data["signalKnownAt"]!=t0+wait*M5:
        raise ValueError("P51_ASOF_VIOLATION")
    return data
def decision(name,f):
    if name=="D0_H1_OPEN":return True
    if name in ("WAIT15_ONLY","WAIT30_ONLY","WAIT60_ONLY"):return True
    n=f["positivePrintBars"]
    s=f.get("sellerPrintedVolumeRatio")
    if name=="WAIT15_LIQUID_2OF3":return n>=2
    if name=="WAIT15_SELL_VOL60":
        return n>=2 and s is not None and s>=.6 and f["lastCompletedPriceVsH1EventClosePct"]<=0
    if name=="WAIT15_CONTINUATION_0P3":
        return n>=2 and f["lastCompletedPriceVsH1EventClosePct"]<=-.3
    if name=="WAIT30_LIQUID_3OF6":return n>=3
    if name=="WAIT30_SELL_VOL60":
        return n>=3 and s is not None and s>=.6 and f["lastCompletedPriceVsH1EventClosePct"]<=0
    if name=="WAIT30_LOWER_LOW":
        return n>=3 and f["lastCompletedCloseBelowOriginalH1Low"]
    if name=="WAIT30_SELL_AND_BREAK":
        return n>=3 and s is not None and s>=.6 and f["lastCompletedCloseBelowOriginalH1Low"]
    if name=="WAIT30_NO_REBOUND":
        return n>=3 and f["noReboundOver0p5pct"] and f["lastCompletedPriceVsH1EventClosePct"]<=0
    if name=="WAIT30_BEAR_MOMENTUM":
        return n>=3 and f["lastCompletedPriceVsH1EventClosePct"]<=-.5
    if name=="WAIT30_BULL_RECOVERY_CONTROL":
        return n>=3 and s is not None and s<=.4 and f["lastCompletedPriceVsH1EventClosePct"]>=.3
    if name=="WAIT60_SELL_AND_BREAK":
        return n>=5 and s is not None and s>=.6 and f["lastCompletedCloseBelowOriginalH1Low"]
    raise ValueError("P51_UNDECLARED_CASE:"+name)
def strict_first(x):
    p=x["P48preOnsetProvenance"]
    return p["prearm6NoPriorMinus3Pct"] and p["prearmToBeforeBreakNoDown3Pct"] and p["prearmToBeforeBreakPriorStructuralBreakCount"]==0
def schedule_trade(x,scenario_name,wait,m5,ft):
    intent=x["intentTs"]+wait*M5
    # Call it an observed OPEN-price proxy only. NO future-bar-volume condition
    # is consulted to decide whether to take a candidate.
    assert ft["signalKnownAt"]==intent
    bar=m5.get(intent)
    if bar is None:
        return {"status":"SOURCE_CENSORED_M5_ENTRY_MISSING","entryTs":None}
    o,h,l,c,vol=valid_bar(bar)
    if intent>=DATA_END:
        return {"status":"RIGHT_CENSORED_DATA_END","entryTs":intent,
               "entryPrice":o,"exitTs":None,"exitPrice":None}
    stop=stop72(m5,intent,o)
    return {"id":x["id"],"scenario":scenario_name,
      "intentTs":intent,"cohort":x["cohort"],"entryTs":intent,"entryPrice":o,
      "exitTs":stop.get("exitTs"),"exitPrice":stop.get("exitPrice"),
      "status":stop["status"],"reason":stop.get("exitReason"),
      "entryBarOwnFutureVolumeExPost":vol,
      "entryAtZeroVolumeBarExPost":vol<=0,
      "tradeAtBarOpenNotVenueSignedFill":True,
      "entryBarVolumeNotUsedForStrategyDecision":True,
      "stop72OverlayNotExactNativeV20":True,
      "knownAtExecutionTime":intent}
def collect_single_slot(eligible,m5,scenario_name,wait,feat_by_id):
    busy=-1;blocked=0;selected=[];censored=0;zeroEntry=0
    blockedids=[]
    for x in sorted(eligible,key=lambda z:(z["intentTs"],z["id"])):
        t=x["intentTs"]+wait*M5
        if t<busy:
            blocked+=1;blockedids.append(x["id"]);continue
        trow=schedule_trade(x,scenario_name,wait,m5,feat_by_id[(x["id"],wait)])
        if trow["status"]=="SOURCE_CENSORED_M5_ENTRY_MISSING":
            raise ValueError("P51_BAD_SOURCE_M5_ENTRY")
        selected.append(trow)
        if trow.get("entryAtZeroVolumeBarExPost"):zeroEntry+=1
        if trow["status"]=="PRICE_PROXY_CLOSED":
            busy=trow["exitTs"]+M5
        else:
            censored+=1;busy=DATA_END
    return selected,{"blockedOccupied":blocked,"blockedIds":blockedids,
        "rightCensored":censored,
        "exPostZeroVolumeAtScheduledEntry":zeroEntry,
        "positiveVolumeAtEntryNotVerifiedExAnte":True}
def main():
    native=json.loads(SOURCE.read_text(encoding="utf8"))
    assert len(native)==53 and sum(x["net30pct"]>0 for x in native)==29
    p,psha=h1_source(PENGUH1);b,bsha=h1_source(BTCH1)
    assert len(p)==len(b) and all(x["time"]==z["time"] for x,z in zip(p,b))
    m5,msha=load_m5(SOURCES)
    h1ref={z["time"]:z for z in p}
    raw=[json.loads(z) for z in INPUT.read_text(encoding="utf8").splitlines() if z.strip()]
    assert len(raw)==149 and len({z["id"] for z in raw})==149
    cleaned=[z for z in raw if strict_first(z)]
    assert len(cleaned)==107
    p48=json.loads(P48.read_text(encoding="utf8"))
    assert p48["P47SourceAndEconomicsExactParity"] and p48["prearmWasAlreadyBelow24hMinus3"]["selectedP47AlreadyBelowD3"]==11
    waits=sorted({wait for _,wait in CASES})
    feature_by_id={}
    audit=[]
    for x in raw:
       fts={}
       for wait in waits:
           f=after_features(x,m5,h1ref,wait)
           feature_by_id[(x["id"],wait)]=f
           fts[str(wait*5)+"m"]=f
       audit.append({"id":x["id"],"cohort":x["cohort"],
         "originalH1ReferenceTs":x["signalReferenceTs"],"originalH1KnownAt":x["intentTs"],
         "isStrictFirstNotPriorD3":strict_first(x),
         "allM5PostOnsetAsOfFeatures":fts,
         "nativeSourceSHA":"1657e173d250ad58f53e62f7bb0a3428fb405496",
         "noFutureEntryBarVolumeForGate":True})
    allresults=[];details=[]
    for group,source in [(GROUPS[0],raw),(GROUPS[1],cleaned)]:
      for name,wait in CASES:
        available=[x for x in source if decision(name,feature_by_id[(x["id"],wait)])]
        selected,extra=collect_single_slot(available,m5,name,wait,feature_by_id)
        for fee in FEES:
          for slip in STRESS:
             econ=economic(selected,m5,fee,slip)
             allresults.append({"group":group,"model":name,"waitM5":wait,
                "waitMinutes":wait*5,"sourceH1IntentCandidates":len(source),
                "M5ConfirmedEligibleBeforeEntry":len(available),
                "oneSlotSelected":len(selected),
                "exPostZeroVolumeAtScheduledEntry":extra["exPostZeroVolumeAtScheduledEntry"],
                "oneSlotBlocked":extra["blockedOccupied"],
                "rightCensored":extra["rightCensored"],
                "feeBps":fee,"extraCoverSlipBps":slip,"gross":GROSS,
                "capital":econ})
        details.append({"group":group,"model":name,
           "eligibleIds":[x["id"] for x in available],
           "blockedBySlotIds":extra["blockedIds"],
           "selected":[{"id":x["id"],"cohort":x["cohort"],"entryTs":x["entryTs"],
              "entryPrice":x["entryPrice"],"exitTs":x["exitTs"],
              "exitPrice":x["exitPrice"],"reason":x["reason"],
              "exPostEntryBarPrintedVolume":x["entryBarOwnFutureVolumeExPost"],
              "status":x["status"]} for x in selected]})
    assert len(allresults)==len(GROUPS)*len(CASES)*len(FEES)*len(STRESS)
    clean_baseline=next(z for z in allresults if z["group"]==GROUPS[1] and z["model"]=="D0_H1_OPEN"
                        and z["feeBps"]==30 and z["extraCoverSlipBps"]==0)
    norm=[x for x in allresults if x["feeBps"]==30 and x["extraCoverSlipBps"]==0]
    significant=[x for x in norm if x["capital"]["closed"]>=20 and
      x["capital"]["conditionalWinPct"]>=70 and x["capital"]["M5HighStressDDPct"]<=20]
    manifest={
     "schema":"prism7-p51-causal-M5-post-H1-first-break-confirmation-no-future-entry-bar-gates/v1",
     "status":"RESEARCH_ONLY_NO_BLIND_OOS",
     "sourceNative53IntentsUnchanged":53,
     "sourceNative53Wins29Losses24":True,
     "H1SourceM5CloseParityAll149":True,
     "allP48FirstH1BreakCandidates":len(raw),"strictInitialUndroppedCandidates":len(cleaned),
     "modelRoutes":CASES,
     "scheduledM5OpenPriceUsedAfterCompleteM5ContextOnly":True,
     "scheduledEntryCurrentBarVolumeNOTUsedToSelectCandidate":True,
     "scheduledEntryOpeningPrintNotVerifiedVenueFill":True,
     "entryStopExitPriceFromP20ResearchStop72":True,
     "p20Stop72NotFullPinnedNativeV20":True,
     "feeBps":FEES,"extraCoverSlipStressBps":STRESS,"gross":GROSS,
     "scenarioCount":len(allresults),"allScenarios":allresults,
     "baselineStrictNoWait30bps":clean_baseline,
     "normal30bpsNoCoverStress":norm,
     "predeclared70Win20DDN20ResearchOnly":significant,
     "fullEntryDecisionAndBlockedTradeLedger":details,
     "perSourceAll149AsOfM5":audit,
     "inputSHA":{"P48_149_ledger":sha(INPUT),"P48_summary":sha(P48),
       "native53":sha(SOURCE),"PENGUH1":psha,"BTCH1":bsha,"PENGUM5":msha},
     "limitations":[
       "All test dates Aug2025-Nov2026 have been studied in P8-P50; there is NO independent blind OOS.",
       "Layer B is a fully CLOSED H1 >=1% bearish low breakout; confirming after it waits 0/15/30/60 min, not the first 5m down tick.",
       "A scheduled M5 OPEN after complete waiting bars is a price proxy only, no signed venue fill or order-book market depth. Ex-post scheduled-entry-bar volume is an audit, not a signal.",
       "Unlike older P20 first positive M5 open, current strategy does NOT use the entry bar's yet-unobserved positive-volume status to select a filled trade.",
       "Source M5 has many bars with zero volume; zero-volume scheduled-entry-bar price may be a stale quote and cannot certify actual execution even after extra cover slippage.",
       "M5 volume/red-candle classification may be misleading in illiquid PENGU feed; do not infer order-book imbalance from executed volume distribution alone.",
       "Same P20 reference hardStop8%, trail activate15/retrace4 and max hold72h; not Native V20 pinned phase-specific source-exit function.",
       "M5 intra-bar high/low order not known and stop gaps/market impact/funding/liquidation are not certified.",
       "Gross0.75 one-slot research PnL/DD only; missing all other Runners and real shared risk limits and open-position unrealized account drawdown.",
       "Multiple tested windows/filters raise selection bias; NONE can be promoted based solely on in-sample winner counts."
     ]
    }
    OUTPUT.write_text(json.dumps(manifest,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf8")
    LEDGER.write_text("".join(json.dumps(z,ensure_ascii=False,sort_keys=True)+"\n" for z in audit),encoding="utf8")
    lines=["# P51: M5 continuation / rebound after CLOSED H1 first-break event",
       "",
       "Source 149 H1 first-break candidates, 107 cleaner pre-drop, 53 Native V20 source cases frozen.",
       "All M5 gates use ONLY fully completed bars before entry. Zero volume candles are not selling pressure. Entry uses scheduled future M5 OPEN price proxy, independent of that bar's future volume.",
       "",
       "| Group | Mode | Wait | Eligible | Closed | Wins | Win% | M5 High DD | ¥10k NAV | Zero-vol at entry (ex post) |",
       "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|"]
    for x in norm:
        y=x["capital"]
        lines.append("| "+x["group"]+" | "+x["model"]+" | "+str(x["waitMinutes"])+" | "+
          str(x["M5ConfirmedEligibleBeforeEntry"])+" | "+str(y["closed"])+" | "+
          str(y["wins"])+" | "+str(y["conditionalWinPct"])+"% | "+
          str(y["M5HighStressDDPct"])+"% | "+str(y["finalProxyNavYen"])+" | "+str(x["exPostZeroVolumeAtScheduledEntry"])+" |")
    lines+=["","All scenario metrics are research-only, no true OOS, no real venue execution. M5 event starts after a CLOSED H1 decline, so this tests continuation after the first H1 move, not truly predictive pre-drop entry.",""]
    NOTE.write_text("\n".join(lines),encoding="utf8")
    print("P51_M5_CAUSAL_FIRST_H1_POST_BREAK_ECONOMICS_ALL_SCENARIOS_PASS",
       json.dumps({"source149":len(raw),"clean107":len(cleaned),"scenarios":len(allresults),
         "normalStrict":[{"route":x["model"],"m":x["waitMinutes"],
           "eligible":x["M5ConfirmedEligibleBeforeEntry"],
           "closed":x["capital"]["closed"],"win":x["capital"]["conditionalWinPct"],
           "DD":x["capital"]["M5HighStressDDPct"],"NAV":x["capital"]["finalProxyNavYen"],
           "zeroEntryVol":x["exPostZeroVolumeAtScheduledEntry"],
           "cohorts":x["capital"]["cohorts"]}
           for x in norm if x["group"]==GROUPS[1]],
         "nWin70DD20N20Research":len(significant)},ensure_ascii=False),flush=True)
    print("FILES",OUTPUT,NOTE,LEDGER)
if __name__=="__main__":main()
