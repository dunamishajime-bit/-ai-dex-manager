#!/usr/bin/env python3
"""P29: 72 artificial positive-5m futures from one source-identical crash prefix.

Falsification research for previously-seen BTC/PENGU crash-trigger. Synthetic
future PRICE is NOT market data. Source entry, event M5 close and previous
source high/low are always identical. Native reference STOP72 versus frozen
P25 exit 1/2/3 positive-M5 next opens, source STOP first on tie.
"""
from __future__ import annotations
import argparse,csv,hashlib,json,math
from collections import defaultdict,Counter
from pathlib import Path
from prism7_p20_pengu_s3_market_structure_native_source_comparison_20261122 import stop72
ENTRY=1760130900000
FUTURE=ENTRY+300000
ENTRY_PRICE=.022617
SOURCE_SIGNAL_CLOSE=.010000
SEED=20261122
M5=300000
H=3600000
TMAX=80*H
FEE=(10,30)
SLIP=(0,100,1000)
DELAY=(1,2,3)
MASKS={"FULL_EACH_5M":1,"EVERY_3RD_M5":3,"EVERY_12TH_M5":12}
WORLDS={
 "RECOVER_FAST":{"target":.021,"tauH":1.0},
 "CONTINUE_DOWN":{"target":.004,"tauH":24.0},
 "CHOPPY_REBOUND":{"target":.015,"tauH":4.0},
}
def fixedprefix():
 # Source PENGU event M5 2025-10-10 21:15:00 UTC pinned from P25 and source archive.
 return {ENTRY:[
  ENTRY,.022617,.023038,.010000,.010000,1363556,ENTRY+299999,
  0,0,126929,0
 ]}
def generated(regime,seed,mask):
    target=WORLDS[regime]["target"];tau=WORLDS[regime]["tauH"]
    p=fixedprefix()
    previous=SOURCE_SIGNAL_CLOSE
    for i in range(TMAX//M5):
        t=FUTURE+i*M5
        if i%mask!=0:
            p[t]=[t,previous,previous,previous,previous,0,t+M5-1,0,0,0,0]
            continue
        elapsedHours=(i+1)/12
        # Smooth directional trend with a deterministic SMALL alternating fluctuation:
        # No future outcome label ever enters source entry or exit policy.
        end=target+(SOURCE_SIGNAL_CLOSE-target)*math.exp(-elapsedHours/tau)
        end*=1+.008*math.sin((i+(SEED+seed)*11)*.19)
        end=max(.0001,end)
        hi=max(previous,end)*1.002
        lo=min(previous,end)*.998
        p[t]=[t,previous,hi,lo,end,100000,t+M5-1,0,0,50000,0]
        previous=end
    return p

def prices_after_event(cand,native_time,delay):
    # The event M5 [ENTRY,ENTRY+5min) has completed before earliest possible order.
    after=[]
    for k in range(960):
        t=FUTURE+k*M5
        if t>=native_time:break
        bar=cand.get(t)
        if bar is None:raise ValueError("P29_SOURCE_M5_SYNTHETIC_GAP")
        if float(bar[5])<=0:continue
        after.append({"ts":t,"positiveM5OpenPrice":float(bar[1]),
                      "positiveM5VolumeUnits":float(bar[5])})
        if len(after)==delay:return after[-1],after
    return None,after

def generate_case(regime,seed,maskname):
    market=generated(regime,seed,MASKS[maskname])
    if list(market[ENTRY])[:6]!=list(fixedprefix()[ENTRY])[:6]:
        raise ValueError("P29_IDENTICAL_SOURCE_PREFIX_FAILED")
    baseline=stop72(market,ENTRY,ENTRY_PRICE,max_observation_end=ENTRY+TMAX)
    if baseline["status"]!="PRICE_PROXY_CLOSED":
        raise ValueError("P29_SYNTHETIC_REFERENCE_STOP72_NOT_CLOSED")
    for d in DELAY:
        event,seen=prices_after_event(market,baseline["exitTs"],d)
        for fee in FEE:
            for sl in SLIP:
                if event is None:
                    exit_ts=baseline["exitTs"];exit_price=baseline["exitPrice"]
                    reason="SOURCE_REFERENCE_STOP_PREEMPTED_OR_NO_SECOND_PRINT"
                    applied=False
                else:
                    exit_ts=event["ts"]
                    exit_price=event["positiveM5OpenPrice"]*(1+sl/10000)
                    reason="P25_SYNTHETIC_CAPITULATION_AFTER_COMPLETED_SIGNAL"
                    applied=True
                    if exit_ts<FUTURE or exit_ts>=baseline["exitTs"]:
                        raise ValueError("P29_ORDER_BEFORE_SOURCE_SIGNAL_OR_AFTER_STOP")
                nativeNet=100*(1-baseline["exitPrice"]/ENTRY_PRICE)-fee/100
                strategyNet=100*(1-exit_price/ENTRY_PRICE)-fee/100
                yield {
                  "regime":regime,"seed":seed,"positiveM5Mask":maskname,
                  "allSourceIdenticalPrefix":True,
                  "originalSourceEventTimeM5StartTs":ENTRY,
                  "originalSourceEventCloseTs":FUTURE,
                  "sourceEntryPrice":ENTRY_PRICE,
                  "sourceEventPenguClose":SOURCE_SIGNAL_CLOSE,
                  "sourceEventBtcCrashPreconfirmed":True,
                  "sourceReferenceExitTs":baseline["exitTs"],
                  "sourceReferenceExitPrice":baseline["exitPrice"],
                  "sourceReferenceExitReason":baseline["exitReason"],
                  "feeBps":fee,"extraP25ExitSlippageBps":sl,
                  "numberOfPositiveM5AfterTriggerForExit":d,
                  "capitulationEarlyExitExecutedInPriceModel":applied,
                  "exitProxyTs":exit_ts,"exitProxyPrice":exit_price,
                  "exitReasonModel":reason,
                  "nativeReferenceNetPct":nativeNet,
                  "newCapitulationNetPct":strategyNet,
                  "deltaCapitulationMinusNativePct":strategyNet-nativeNet,
                  "nativeReferenceWinner":nativeNet>0,
                  "newCapitulationWinner":strategyNet>0,
                  "earlyExitDestroyedSourceWinnerProfit":nativeNet>0 and strategyNet<nativeNet,
                  "earlyExitChangedWinnerToLoser":nativeNet>0 and strategyNet<=0,
                  "sourceSignedVenueFillProven":False,
                  "syntheticMarketPathNotActualOOS":True,
                }

def summary(rows):
    a=defaultdict(list)
    for x in rows:
      a[(x["regime"],x["positiveM5Mask"],x["feeBps"],x["extraP25ExitSlippageBps"],
         x["numberOfPositiveM5AfterTriggerForExit"])].append(x)
    out=[]
    for (reg,mask,fee,slip,d),q in sorted(a.items()):
       if len(q)!=8:raise ValueError("P29_NOT_8_SEEDS_IN_SAME_SCENARIO")
       delta=[z["deltaCapitulationMinusNativePct"] for z in q]
       out.append({
         "regime":reg,"mask":mask,"feeBps":fee,
         "extraSlippageBps":slip,"delayPositiveM5PrintCount":d,
         "sourceTwinPaths":len(q),
         "p25EarlyExitModelCases":sum(x["capitulationEarlyExitExecutedInPriceModel"] for x in q),
         "sourceReferenceModelWinners":sum(x["nativeReferenceWinner"] for x in q),
         "sourceReferenceWinnersWithProfitCut":sum(x["earlyExitDestroyedSourceWinnerProfit"] for x in q),
         "sourceReferenceWinnersConvertedToLosers":sum(x["earlyExitChangedWinnerToLoser"] for x in q),
         "p25PriceModelWins":sum(x["newCapitulationWinner"] for x in q),
         "averageSourceNetPct":sum(x["nativeReferenceNetPct"] for x in q)/len(q),
         "averageP25NetPct":sum(x["newCapitulationNetPct"] for x in q)/len(q),
         "meanP25MinusReferenceNetPct":sum(delta)/len(delta),
         "bestDeltaPct":max(delta),"worstDeltaPct":min(delta),
       })
    return out
def main():
    p=argparse.ArgumentParser()
    p.add_argument("--p25-source",type=Path,required=True)
    p.add_argument("--out-summary",type=Path,required=True)
    p.add_argument("--out-cases",type=Path,required=True)
    a=p.parse_args()
    orig=json.loads(a.p25_source.read_text(encoding="utf-8"))
    x=orig["all120PerCandidateDetectionEvents"]["S3_01700"]
    if (x["state"]!="CROSS_ASSET_CAPITULATION_CONFIRMED" or
        x["entryPrice"]!=ENTRY_PRICE or x["eventM5OpenTs"]!=ENTRY or
        x["eventCloseTs"]!=FUTURE or x["penguM5Close"]!=SOURCE_SIGNAL_CLOSE):
        raise ValueError("P29_SOURCE_P25_PRE_EVENT_PREFIX_PARITY_NOT_PROVEN")
    cases=[]
    for regime in WORLDS:
      for seed in range(8):
        for mask in MASKS:
          cases.extend(generate_case(regime,seed,mask))
    if len(cases)!=72*len(DELAY)*len(FEE)*len(SLIP):
      raise ValueError("P29_NOT_1296_SYNTHETIC_SCENARIOS")
    stats=summary(cases)
    if len(stats)!=3*3*2*3*3:raise ValueError("P29_NOT_162_SAME_TWIN_SUBGROUPS")
    result={
     "schema":"prism7-p29-frozen-prefix-72-artificial-futures-1296-reference-capitulation-cases/v1",
     "sourceP25PinnedSHA":"1657e173d250ad58f53e62f7bb0a3428fb405496",
     "sourceP25ReadOnlySHA256":hashlib.sha256(a.p25_source.read_bytes()).hexdigest(),
     "sourceEventS3_01700SamePrefixAcrossAll":True,
     "numberOfSourceTwinArtificialFutures":72,
     "costAndDelayModelRows":len(cases),
     "frozenThreeRegimes":WORLDS,
     "positivePrintMasks":MASKS,
     "independentFixedSeedCountPerRegimeMask":8,
     "consolidatedByRegimeMaskAndCost":stats,
     "limitations":[
       "These 72 futures are synthetic, all share known past source 2025-10-10 event, not market OOS.",
       "The shock detector had already fired before counterfactual future begins and can never know future rebound versus downcontinuation.",
       "SOURCE reference STOP72 is not the full original native PENGU V20 dynamic phase/STOP.",
       "Artificial fixed positive candle volume/masks do not establish live orderbook or signed fills.",
       "Economic comparison is one trade, not multi-runner compounding/Gross/DD or guaranteed trading performance.",
     ],
    }
    a.out_summary.parent.mkdir(parents=True,exist_ok=True)
    a.out_summary.write_text(json.dumps(result,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf-8")
    with a.out_cases.open("w",encoding="utf-8",newline="") as f:
      w=csv.DictWriter(f,fieldnames=list(cases[0]))
      w.writeheader();w.writerows(cases)
    print("PRISM7_P29_72_IDENTICAL_PREFIX_FUTURES_1296_CASES_PASS")
    for x in stats:
      if (x["mask"]=="FULL_EACH_5M" and x["feeBps"]==30 and
         x["extraSlippageBps"]==0 and x["delayPositiveM5PrintCount"]==2):
        print("WORLD",x["regime"],"nativeMean",round(x["averageSourceNetPct"],4),
         "p25Mean",round(x["averageP25NetPct"],4),"delta",round(x["meanP25MinusReferenceNetPct"],4),
         "winnerProfitCut",x["sourceReferenceWinnersWithProfitCut"],"/",x["sourceTwinPaths"])
if __name__=="__main__":main()
