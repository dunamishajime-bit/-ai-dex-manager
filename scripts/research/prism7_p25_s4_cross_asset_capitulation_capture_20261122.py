#!/usr/bin/env python3
"""P25 research-only cross-asset capitulation module over frozen source S4 setup120.

Only a *completed* positive PENGU M5 with BTC synchronized crash can trigger.
Exit is delayed 1/2/3 positive M5 opens after confirmation, never the signal bar's
open, and original source reference STOP/exit preempts if earlier. Full 120 setup
and single-slot source replay under each cost scenario. No live signed fills.
"""
from __future__ import annotations
import argparse,csv,gzip,json,hashlib,math
from pathlib import Path
from collections import Counter,defaultdict
from prism7_native53_event_attribution_20261122 import load_m5
from prism7_p20_pengu_s3_market_structure_native_source_comparison_20261122 import aggregate
from prism7_p21_pengu_s3_m5_seller_confirmation_fsm_20261122 import apply_single_slot
from prism7_p23_m5_mark_to_market_censored_position_risk_20261122 import stream_group
NAME="PENGU_S4_CAPITULATION_CAPTURE_V1"
M5=300000
DATA_END=1794960000000
DELAYS=(1,2,3)
FEES=(10,30)
EXTRA_BPS=(0,25,100,500,1000)
SPECIAL_KNOWN_BTC_BAD=1757771400000
ROUTES=("SELLER_PULLBACK_REJECTION","BREAKDOWN_RETEST_FAILURE","RELATIVE_WEAKNESS_DOWNSHIFT")

def load_btc_sanitized(paths,active_source):
    """Only one pre-identified bad BTC M5 entirely outside any S4 source position."""
    hashes={};bars={};bad=[]
    for p in paths:
        p=Path(p);raw=p.read_bytes()
        hashes[p.name]=hashlib.sha256(raw).hexdigest()
        with gzip.open(p,"rt",encoding="utf-8") as f:
            for line in f:
                if not line.strip():continue
                x=json.loads(line);t=int(x[0])
                if t in bars:
                    if bars[t]!=x:raise ValueError("P25_BTC_M5_TIMESTAMP_CONFLICT:"+str(t))
                    continue
                o,h,l,c,v,buy=map(float,[x[i] for i in (1,2,3,4,5,9)])
                valid=0<l<=min(o,c)<=max(o,c)<=h and v>=0 and 0<=buy<=v
                if not valid:
                    inside=[q["id"] for q in active_source if q.get("entryProxyTs") is not None and
                     q["entryProxyTs"]<=t<(q.get("exitProxyTs") or DATA_END)]
                    if t!=SPECIAL_KNOWN_BTC_BAD or inside:
                        raise ValueError("P25_INVALID_BTC_M5_INSIDE_OR_UNEXPECTED:"+str(t)+":"+str(inside))
                    bad.append({"timestamp":t,"rawGzipFile":p.name,
                                "rawGzipSHA256":hashes[p.name],
                                "overlappingS4CandidatePositions":0,
                                "priceNotModified":True})
                    continue
                bars[t]=x
    if len(bad)!=1:raise ValueError("P25_EXPECTED_1_OFF_POSITION_BTC_BAD_M5")
    return bars,hashes,bad

def last_positive_close(market,t,max_search=12):
    for i in range(1,max_search+1):
        q=market.get(t-i*M5)
        if q is not None and float(q[5])>0:return t-i*M5,float(q[4])
    return None

def original_121_source(s4events):
    x=[z for z in s4events if z["group"]=="S4_ALL_CANDIDATES"]
    if len(x)!=120 or len(set(z["id"] for z in x))!=120:
        raise ValueError("P25_SOURCE_120_ALL_CANDIDATE_COHORT_LOST")
    return x

def first_event(original,pengu,btc):
    entry=original.get("entryProxyTs")
    if entry is None:return {"state":"NEVER_ENTERED_SOURCE_CANDIDATE"}
    if original["status"] not in ("PRICE_PROXY_CLOSED","RIGHT_CENSORED_DATA_END",
                                  "RIGHT_CENSORED_NO_PRINT_BY_78H"):
        return {"state":"NOT_SOURCE_PRICE_PROXY_POSITION","originalStatus":original["status"]}
    stop=original.get("exitProxyTs") or DATA_END
    entryPrice=original.get("entryProxyPrice")
    if not entryPrice or not 0<entryPrice:raise ValueError("P25_SOURCE_ENTRY_PRICE_NULL")
    for t in range(int(entry),int(stop),M5):
        p=pengu.get(t);b=btc.get(t)
        if p is None:raise ValueError("P25_SOURCE_PENGU_M5_GAP:"+str(t))
        if b is None or float(p[5])<=0 or float(b[5])<=0:continue
        prev_p=last_positive_close(pengu,t)
        prev_b=last_positive_close(btc,t)
        if prev_p is None or prev_b is None:continue
        p_close=float(p[4]);btc_close=float(b[4])
        p_prev=prev_p[1];btc_prev=prev_b[1]
        if not(p_close<=float(entryPrice)*.75 and p_close<=p_prev*.80 and
               btc_close<=btc_prev*.97 and float(p[9])/float(p[5])<=.45):
            continue
        signal_time=t+M5
        if signal_time>=stop:return {"state":"CROSS_ASSET_CRASH_CONFIRMED_TOO_LATE"}
        print_after=[]
        for j in range(1,12*12+1):
            ts=t+j*M5
            if ts>=stop or ts>=DATA_END:break
            pb=pengu.get(ts)
            if pb is None:raise ValueError("P25_SOURCE_M5_FOLLOWUP_GAP:"+str(ts))
            if float(pb[5])>0:
                print_after.append({"ts":ts,"px":float(pb[1]),
                      "positiveVolumeUnits":float(pb[5]),
                      "positiveVolumeNotionalUSDT":float(pb[5])*float(pb[1])})
                if len(print_after)==3:break
        return {"state":"CROSS_ASSET_CAPITULATION_CONFIRMED",
          "entryTs":entry,"entryPrice":entryPrice,
          "eventM5OpenTs":t,"eventCloseTs":signal_time,
          "sourceBaselineExitTs":original.get("exitProxyTs"),
          "sourceBaselineExitReason":original.get("exitReason"),
          "sourceBaselineExitPrice":original.get("exitProxyPrice"),
          "penguM5Close":p_close,"penguPreviousPositivePrintClose":p_prev,
          "pengu5mDropPct":100*(p_close/p_prev-1),
          "penguTradeGrossShortGainAtSignalPct":100*(1-p_close/float(entryPrice)),
          "btcM5Close":btc_close,"btcPreviousPositivePrintClose":btc_prev,
          "btc5mDropPct":100*(btc_close/btc_prev-1),
          "penguTakerBuyVolumeRatio":float(p[9])/float(p[5]),
          "first3AfterSignalPositiveM5OpenProxies":print_after,
          "signalUsesFutureM5Bars":False,"venueSignedFillProven":False}
    return {"state":"NO_P25_CROSS_ASSET_CAPITULATION_BEFORE_SOURCE_EXIT"}

def rebuild(original,event,delay,slip):
    x={**original}
    x["p25DetectorEventState"]=event["state"]
    x["p25SourceReferenceStopPriorityMaintained"]=True
    x["p25ExitM5AfterCompletedSignal"]=False
    x["p25ExitExtraSlippageBps"]=0
    x["p25ExitDelayPositivePrintCount"]=delay
    x["p25EarlyExitApplied"]=False
    if event["state"]!="CROSS_ASSET_CAPITULATION_CONFIRMED":return x
    p=event["first3AfterSignalPositiveM5OpenProxies"]
    if len(p)<delay:return x
    q=p[delay-1]
    ts=q["ts"]
    old_stop=original.get("exitProxyTs") or DATA_END
    if not(event["eventCloseTs"]<=ts<old_stop):return x
    new_px=q["px"]*(1+slip/10000)
    if not new_px>0:raise ValueError("P25_BAD_BUY_PRICE")
    x["status"]="PRICE_PROXY_CLOSED"
    x["exitProxyTs"]=ts
    x["exitProxyPrice"]=new_px
    x["exitReason"]="RESEARCH_P25_CAPITULATION_CAPTURE"
    x["exitKind"]="POSITIVE_M5_OPEN_AFTER_COMPLETED_CROSS_ASSET_SHOCK"
    x["stopLevel"]=None
    x["p25ExitM5AfterCompletedSignal"]=True
    x["p25ExitExtraSlippageBps"]=slip
    x["p25EarlyExitApplied"]=True
    x["p25TradeAtM5PriceIsNotSignedFill"]=True
    x["p25ExitPositiveM5VolumeNotionalUSDT"]=q["positiveVolumeNotionalUSDT"]
    x["p25CompletedSignalCloseTs"]=event["eventCloseTs"]
    if not event["eventCloseTs"]<=x["exitProxyTs"]:
        raise ValueError("P25_FUTURE_LEAK_EXIT_ON_SIGNAL_BAR_OPEN")
    return x

def subset_summary(rows,fee,sub):
    z=[x for x in rows if sub(x)]
    return {"referenceCandidates":len(z),
            "referenceExited":sum(x["status"]=="PRICE_PROXY_CLOSED" for x in z),
            "referenceWins":sum(x["status"]=="PRICE_PROXY_CLOSED" and
                   100*(1-x["exitProxyPrice"]/x["entryProxyPrice"])-fee/100>0 for x in z),
            "referenceEarlyCapitulationExitCount":sum(x.get("p25EarlyExitApplied",False) for x in z),
            "referencePerSetupNetPctPoints":sum(100*(1-x["exitProxyPrice"]/x["entryProxyPrice"])-fee/100
                      for x in z if x["status"]=="PRICE_PROXY_CLOSED")}

def main():
    a=argparse.ArgumentParser()
    a.add_argument("--p22-events",type=Path,required=True)
    a.add_argument("--p23-source",type=Path,required=True)
    a.add_argument("--pengu-m5",type=Path,nargs="+",required=True)
    a.add_argument("--btc-m5",type=Path,nargs="+",required=True)
    a.add_argument("--out-summary",type=Path,required=True)
    a.add_argument("--out-events",type=Path,required=True)
    a.add_argument("--out-scenario-csv",type=Path,required=True)
    args=a.parse_args()
    allsource=[json.loads(x) for x in args.p22_events.read_text(encoding="utf-8").splitlines() if x.strip()]
    original=original_121_source(allsource)
    p23=json.loads(args.p23_source.read_text(encoding="utf-8"))
    pengu,ph=load_m5(args.pengu_m5)
    btc,bh,bad=load_btc_sanitized(args.btc_m5,original)
    detector={}
    for row in original:
        detector[row["id"]]=first_event(row,pengu,btc)
    p22_slot=next((x for x in p23["groups"] if x["group"]=="S4_SINGLE_SLOT" and
        x["feeBps"]==30 and x["exitSlippageBps"]==0),None)
    if p22_slot is None or abs(p22_slot["maximumM5CloseMarkToMarketDDPct"]-35.94150348)>1e-7:
        raise ValueError("P25_SOURCE_P23_BASELINE_M5_DD_MISSING")
    original_slot=[x for x in allsource if x["group"]=="S4_SINGLE_SLOT"]
    if len(original_slot)!=120:raise ValueError("P25_SOURCE_ORIGINAL_SLOT120_MISSING")
    reproduced=apply_single_slot(original)
    origmap={x["id"]:x for x in original_slot}
    for x in reproduced:
        old=origmap[x["id"]]
        for f in ("status","entryProxyTs","entryProxyPrice","exitProxyTs",
                  "exitProxyPrice","exitReason"):
            if x.get(f)!=old.get(f):
                raise ValueError("P25_ORIGINAL_S4_SINGLE_SLOT_NOT_REPRODUCED:"+x["id"]+":"+f)
    scenarios=[]
    ledgers=[]
    for delay in DELAYS:
        for extra in EXTRA_BPS:
            changed=[rebuild(o,detector[o["id"]],delay,extra) for o in original]
            byid={x["id"]:x for x in changed}
            slot=apply_single_slot(changed)
            if len(slot)!=120 or len(set(x["id"] for x in slot))!=120:
                raise ValueError("P25_SOURCE_SETUP_LOSS")
            applied=[x for x in slot if x.get("p25EarlyExitApplied") and x["status"]=="PRICE_PROXY_CLOSED"]
            original_app=Counter(x["id"] for x in applied)
            for fee in FEES:
                mc=aggregate(slot,fee,0)
                risk,_=stream_group(slot,pengu,fee,0)
                detailed={
                 "delayPositiveM5PrintsAfterSignal":delay,"additionalEntryIndependentExitSlipBps":extra,
                 "feeBps":fee,
                 "originalSourceH1StructuralSetups":120,
                 "confirmedCapitulationSourceCandidates":sum(e["state"]=="CROSS_ASSET_CAPITULATION_CONFIRMED" for e in detector.values()),
                 "source120CandidateExitOverrides":sum(x.get("p25EarlyExitApplied",False) for x in changed),
                 "selectedSingleSlotExitOverrides":len(applied),
                 "slotOwnerRouteCount":dict(Counter(x["route"] for x in applied)),
                 "referenceEconomics":mc,
                 "referenceM5MarkRisk":risk,
                 "byPrimaryRoute":{k:subset_summary(slot,fee,lambda z:z["route"]==k) for k in ROUTES},
                 "byOriginalCohort":{k:subset_summary(slot,fee,lambda z:z["cohort"]==k) for k in
                  ("PRE_2025_AUG_SEP","BASE_2025_2026","POST_2026_OCT_NOV")},
                }
                scenarios.append(detailed)
                for x in slot:
                    ledgers.append({
                       "scenarioDelay":delay,"scenarioExtraExitSlipBps":extra,"feeBps":fee,
                       "id":x["id"],"cohort":x["cohort"],"route":x["route"],
                       "sourceEntryIntentTs":x["intentTs"],
                       "status":x["status"],
                       "sourceEntryTs":x.get("entryProxyTs"),
                       "sourceEntryPrice":x.get("entryProxyPrice"),
                       "exitTs":x.get("exitProxyTs"),
                       "exitPrice":x.get("exitProxyPrice"),
                       "exitReason":x.get("exitReason"),
                       "capitulationDetected":detector[x["id"]]["state"]=="CROSS_ASSET_CAPITULATION_CONFIRMED",
                       "p25EarlyExitApplied":x.get("p25EarlyExitApplied",False),
                       "signedFill":False,
                       "netAfterScenarioFeePct":100*(1-x["exitProxyPrice"]/x["entryProxyPrice"])-fee/100 if
                         x["status"]=="PRICE_PROXY_CLOSED" else None,
                    })
    if len(scenarios)!=30 or len(ledgers)!=3600:
        raise ValueError("P25_ALL_3600_SOURCE_SCENARIOS_NOT_PRESERVED")
    main_case=next(x for x in scenarios if x["delayPositiveM5PrintsAfterSignal"]==2 and
       x["additionalEntryIndependentExitSlipBps"]==0 and x["feeBps"]==30)
    output={
      "schema":"prism7-p25-s4-capitulation-capture-source120-synthetic-execution-delay-cost/v1",
      "name":NAME,
      "pinnedV20Sha":"1657e173d250ad58f53e62f7bb0a3428fb405496",
      "source120P22AllSetupParity":"PASS",
      "sourceS4SingleSlot120BaselineReplay":"PASS",
      "sourceS4P23BaselineM5DD":p22_slot,
      "frozenDetection":{
        "penguCloseMaxRatioToEntry":.75,"penguCloseMaxRatioToPreviousPrintClose":.80,
        "btcCloseMaxRatioToPreviousPrintClose":.97,
        "penguM5TakerBuyMaxRatio":.45,
        "requireSameClockPositiveM5BTCAndPengu":True,
        "exitOnlyAfterSignalM5Complete":True,
      },
      "sourceBTCM5QuarantinedOffPosition":bad,
      "all120PerCandidateDetectionEvents":detector,
      "costAndExitDelayScenarios":scenarios,
      "mainCase30bpsDelay2ExtraSlip0":main_case,
      "inputSHA256":{
         "p22events":hashlib.sha256(args.p22_events.read_bytes()).hexdigest(),
         "p23source":hashlib.sha256(args.p23_source.read_bytes()).hexdigest(),
         "PENGU_M5":ph,"BTC_M5":bh,
      },
      "limitations":[
         "Main flash-crash event used to design the rule was ALREADY observed on 2025-10-10; entire historical period is in-sample and not predictive validation.",
         "Public positive M5 bar open not signed fill and not guaranteed executable at size or bid/ask quote.",
         "Buyer panic and orderbook shortages may exceed 1000bps slip despite USD notional volume; bar volume is not accessible L2 depth.",
         "Reference stop72 differs from original pinned SHORT V20 exits, source authorizations unchanged.",
         "Synthetic look-back future label leakage prohibited; all entry and exit events delayed after completed M5.",
         "P23 mark DD accounts for one open source right censored position; not multi-runner portfolio/cross gross/funding.",
         "Even if DD below 20, source daily shared loss7.5 and independent true OOS and synthetic dislocations remain unverified.",
      ]
    }
    args.out_summary.parent.mkdir(parents=True,exist_ok=True)
    args.out_summary.write_text(json.dumps(output,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf-8")
    args.out_events.write_text(json.dumps(detector,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf-8")
    with args.out_scenario_csv.open("w",encoding="utf-8",newline="") as f:
        w=csv.DictWriter(f,fieldnames=list(ledgers[0]))
        w.writeheader();w.writerows(ledgers)
    print("PRISM7_P25_SOURCE120_30_PRECOMMITTED_STRESS_SCENARIOS_PASS")
    print("CAPITULATION_DETECTOR",json.dumps({k:v for k,v in detector.items() if v["state"]=="CROSS_ASSET_CAPITULATION_CONFIRMED"},ensure_ascii=False))
    for q in scenarios:
        if q["feeBps"]==30 and q["additionalEntryIndependentExitSlipBps"] in (0,100,1000):
            if q["delayPositiveM5PrintsAfterSignal"] in (1,2,3):
                print("P25_FEE30_REFERENCE",json.dumps({"delay":q["delayPositiveM5PrintsAfterSignal"],
                    "extraBps":q["additionalEntryIndependentExitSlipBps"],
                    "earlyExits":q["selectedSingleSlotExitOverrides"],
                    "gross":q["referenceEconomics"],
                    "closeDD":q["referenceM5MarkRisk"]["maximumM5CloseMarkToMarketDDPct"],
                    "highDD":q["referenceM5MarkRisk"]["maximumM5HighAdverseEnvelopeDDPct"],
                    "censored":q["referenceM5MarkRisk"]["rightCensoredOpenPositions"]},ensure_ascii=False))
if __name__=="__main__":
    main()
