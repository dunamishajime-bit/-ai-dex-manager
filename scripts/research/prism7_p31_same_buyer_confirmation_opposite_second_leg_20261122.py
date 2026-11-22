#!/usr/bin/env python3
"""P31/P31A: identical source past THROUGH buyer recovery-confirmed M5, opposite futures.

Uses exact P30 detect_buyer_recovery, same SOURCE initial ENTRY/STOP72. 72 future
paths x2 delay x2fees x3slip -> 864 cost models. All market suffixes synthetic.
"""
from __future__ import annotations
import argparse,csv,hashlib,json,math
from pathlib import Path
from collections import defaultdict
from prism7_p20_pengu_s3_market_structure_native_source_comparison_20261122 import stop72
from prism7_p30_postshock_recovery_fsm_identical_prefix_futures_20261122 import (
 detect_buyer_recovery
)
ENTRY=1760130900000
SOURCE_SHOCK_BTC_CLOSE=104694.7
FUTURE=ENTRY+300000
DIVERGE=FUTURE+300000
ENTRY_PRICE=.022617
M5=300000
H=3600000
SEED0=20261122
REGIMES={
 "RECOVERY_CONTINUES":{"target":.021,"tauH":1.},
 "SECOND_LEG_CRASH":{"target":.004,"tauH":24.},
 "SECOND_LEG_FAST_CRASH":{"target":.004,"tauH":1.},
}
MASKS={"FULL_EACH_5M":1,"EVERY_3RD_M5":3,"EVERY_12TH_M5":12}
FEES=(10,30)
SLIPS=(0,100,1000)
DELAYS=(1,2)

def prefix():
    pengu={
      ENTRY:[ENTRY,.022617,.023038,.010000,.010000,1363556,ENTRY+M5-1,0,0,126929,0],
      FUTURE:[FUTURE,.010000,.010750,.009950,.010700,100000,FUTURE+M5-1,0,0,50000,0],
    }
    btc={
      ENTRY:[ENTRY,112137.0,112486.0,103541.7,SOURCE_SHOCK_BTC_CLOSE,10533.446,ENTRY+M5-1,0,0,5200.684,0],
      FUTURE:[FUTURE,SOURCE_SHOCK_BTC_CLOSE,105800.,104600.,105500.,1000,FUTURE+M5-1,0,0,500.,0],
    }
    return pengu,btc

def future(regime,seed,mask):
    pengu,btc=prefix()
    prev_p=.0107
    prev_b=105500.
    for k in range(80*12-1):
        t=DIVERGE+k*M5
        if k%mask:
            pengu[t]=[t,prev_p,prev_p,prev_p,prev_p,0,t+M5-1,0,0,0,0]
            btc[t]=[t,prev_b,prev_b,prev_b,prev_b,0,t+M5-1,0,0,0,0]
            continue
        elapsed=(k+1)/12
        tar=REGIMES[regime]
        p=tar["target"]+(.0107-tar["target"])*math.exp(-elapsed/tar["tauH"])
        p*=1+.008*math.sin((k+(SEED0+seed)*11)*.19)
        p=max(.0001,p)
        if regime=="RECOVERY_CONTINUES":
            b=115000+(105500-115000)*math.exp(-elapsed/1)
        else:
            b=95000+(105500-95000)*math.exp(-elapsed/24)
        b*=1+.006*math.sin((k+(SEED0+seed)*13)*.17)
        pengu[t]=[t,prev_p,max(prev_p,p)*1.002,min(prev_p,p)*.998,
                  p,100000,t+M5-1,0,0,50000,0]
        btc[t]=[t,prev_b,max(prev_b,b)*1.002,min(prev_b,b)*.998,
                b,1000,t+M5-1,0,0,500,0]
        prev_p=p;prev_b=b
    return pengu,btc

def tuple_case(regime,seed,mask_name):
    p,b=future(regime,seed,MASKS[mask_name])
    pre_p,pre_b=prefix()
    if (p[ENTRY]!=pre_p[ENTRY] or p[FUTURE]!=pre_p[FUTURE] or
       b[ENTRY]!=pre_b[ENTRY] or b[FUTURE]!=pre_b[FUTURE]):
       raise ValueError("P31_IDENTICAL_PENGU_BTC_SHOCK_AND_BUYER_CONFIRMED_PREFIX_CHANGED")
    source=stop72(p,ENTRY,ENTRY_PRICE,max_observation_end=ENTRY+80*H)
    if source["status"]!="PRICE_PROXY_CLOSED":
       raise ValueError("P31_SOURCE_REFERENCE_NOT_CLOSED")
    rec=detect_buyer_recovery(p,b,source["exitTs"])
    if rec["status"]!="RECOVERY_CONFIRMED_COMPLETED_M5":
       raise ValueError("P31_SOURCE_RECOVERY_PREFIX_NOT_CONFIRMED")
    if rec["confirmationM5StartTs"]!=FUTURE or rec["confirmationM5ClosedTs"]!=DIVERGE:
       raise ValueError("P31_SOURCE_RECOVERY_EARLIER_THAN_FROZEN_SAME_PREFIX")
    after=rec["nextPositiveM5OpenPriceProxies"]
    for delay in DELAYS:
        option=after[delay-1] if len(after)>=delay else None
        if option and (option["ts"]<DIVERGE or option["ts"]>=source["exitTs"]):
            raise ValueError("P31_RESEARCH_EXIT_BEFORE_FROZEN_BTC_PENGU_SOURCE_CONFIRM")
        for fee in FEES:
            for slip in SLIPS:
                ref=100*(1-source["exitPrice"]/ENTRY_PRICE)-fee/100
                if option:
                    price=option["px"]*(1+slip/10000)
                    ts=option["ts"]
                    applied=True
                else:
                    price=source["exitPrice"]
                    ts=source["exitTs"]
                    applied=False
                fin=100*(1-price/ENTRY_PRICE)-fee/100
                yield {
                  "futureRegime":regime,"seed":seed,"printMask":mask_name,
                  "sourceH1NativePinnedModel":"REFERENCE_STOP72_NOT_FULL_V20",
                  "originalSourceEntryTs":ENTRY,
                  "originalSourceEntryPrice":ENTRY_PRICE,
                  "originalSourceShockM5StartTs":ENTRY,
                  "originalSourceBuyerRecoveryM5StartTs":FUTURE,
                  "originalSourceBuyerRecoveryM5CloseTs":DIVERGE,
                  "allPreDecisionPenguBtcM5PriceAndVolumeIdentical":True,
                  "P30State":rec["status"],
                  "P30AsOfBuyerConfirmed":True,
                  "P30FutureRegimeLabelNotUsedToExit":True,
                  "feeBps":fee,"extraExitSlippageBps":slip,
                  "positiveM5DelayAfterConfirmation":delay,
                  "referenceStopTs":source["exitTs"],
                  "referenceStopReason":source["exitReason"],
                  "referenceStopExitPrice":source["exitPrice"],
                  "sourceReferenceNetPct":ref,
                  "P30EarlyExitApplied":applied,
                  "P30BuyToCoverProxyTs":ts,
                  "P30BuyToCoverProxyPrice":price,
                  "P30NetPct":fin,
                  "differenceP30MinusReferencePct":fin-ref,
                  "sourceReferenceWinnerProfitReduced":ref>0 and fin<ref,
                  "sourceReferenceWinnerTurnedLoser":ref>0 and fin<=0,
                  "sourceReferenceLoserRescued":ref<=0 and fin>0,
                  "ownSignedFillOrQuoteDepthProven":False,
                  "artificialFuturePathNoMarketOOS":True,
                }
def main():
    a=argparse.ArgumentParser()
    a.add_argument("--p30-source",type=Path,required=True)
    a.add_argument("--out-summary",type=Path,required=True)
    a.add_argument("--out-ledger",type=Path,required=True)
    args=a.parse_args()
    previous=json.loads(args.p30_source.read_text(encoding="utf-8"))
    if (previous["name"]!="PENGU_S4_RECOVERY_CONFIRMED_EXIT_V1" or
        previous["numberOfArtificialFuturePaths"]!=96):
        raise ValueError("P31_FROZEN_P30_RECOVERY_SOURCE_NOT_PINNED")
    raw=[]
    for reg in REGIMES:
        for seed in range(8):
            for mask in MASKS:
                raw.extend(tuple_case(reg,seed,mask))
    if len(raw)!=3*8*3*2*2*3:raise ValueError("P31_864_SOURCE_SCENARIOS_MISSING")
    groups=defaultdict(list)
    for z in raw:
        groups[(z["futureRegime"],z["printMask"],z["feeBps"],
                z["extraExitSlippageBps"],z["positiveM5DelayAfterConfirmation"])].append(z)
    stats=[]
    for (reg,mask,fee,slip,delay),z in sorted(groups.items()):
        if len(z)!=8:raise ValueError("P31_8_FIXED_SEEDS_PER_COHORT_NOT_PRESENT")
        stats.append({
          "futureRegime":reg,"printMask":mask,"feeBps":fee,"extraSlipBps":slip,
          "positiveM5Delay":delay,"artificialPrefixIdenticalPhaseCount":len(z),
          "sourceReferenceWins":sum(q["sourceReferenceNetPct"]>0 for q in z),
          "sourceReferenceWinnerProfitReduced":sum(q["sourceReferenceWinnerProfitReduced"] for q in z),
          "sourceReferenceWinnerBecameLoser":sum(q["sourceReferenceWinnerTurnedLoser"] for q in z),
          "P30AsOfBuyerRecoveryConfirmed":sum(q["P30AsOfBuyerConfirmed"] for q in z),
          "P30BeforeReferenceStopExecuted":sum(q["P30EarlyExitApplied"] for q in z),
          "sourceReferenceMeanNetPct":sum(q["sourceReferenceNetPct"] for q in z)/8,
          "P30MeanNetPct":sum(q["P30NetPct"] for q in z)/8,
          "P30MinusReferenceMeanPct":sum(q["differenceP30MinusReferencePct"] for q in z)/8,
          "P30MinusReferenceWorstPct":min(q["differenceP30MinusReferencePct"] for q in z),
        })
    if len(stats)!=3*3*2*3*2:raise ValueError("P31_108_GROUPS_NOT_DONE")
    pre_p,pre_b=prefix()
    prefixsha=hashlib.sha256(json.dumps({"PENGU":pre_p,"BTC":pre_b},sort_keys=True).encode()).hexdigest()
    report={
      "schema":"prism7-p31-source-identical-complete-shock-and-buyer-recovery-prefix-divergent-futures/v1",
      "researchName":"P31_IDENTICAL_PREFIX_BUYER_CONFIRMED_FALSIFICATION",
      "originalSourcePinnedSHA":"1657e173d250ad58f53e62f7bb0a3428fb405496",
      "originalP30ResearchSHA256":hashlib.sha256(args.p30_source.read_bytes()).hexdigest(),
      "samePENGUBTCPrefixIncludingBuyerRecoverySHA256":prefixsha,
      "sourceBuyerRecoveryM5ConfirmTimeTs":DIVERGE,
      "artificialFutures":72,"caseRows":len(raw),"futureRegimeNames":list(REGIMES),
      "printMasks":MASKS,"fixedPhaseSeedCount":8,
      "presetTargets":REGIMES,
      "groups":stats,
      "limitations":[
        "Research adversarial branch designed after observing P30; synthetic falsification is not independent OOS.",
        "The PENGU/BTC entire M5 history through buyer recovery confirmation at 21:25UTC is identical before future prices diverge.",
        "Original source position uses REFERENCE_STOP72 not full native pinned PENGU SHORT V20 phase and funding.",
        "No signed venue fill, bid/ask depth, multi-runner gross, true portfolio DD or reliable price execution.",
        "P30 cannot tell if recovered green M5 is beginning of rally or prelude to a fresh second-leg dump.",
      ],
    }
    args.out_summary.parent.mkdir(parents=True,exist_ok=True)
    args.out_summary.write_text(json.dumps(report,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf-8")
    with args.out_ledger.open("w",encoding="utf-8",newline="") as f:
        w=csv.DictWriter(f,fieldnames=list(raw[0]))
        w.writeheader();w.writerows(raw)
    print("PRISM7_P31_72_IDENTICAL_RECOVERY_PREFIX_FUTURES_864_SCENARIOS_PASS")
    for z in stats:
        if z["printMask"]=="FULL_EACH_5M" and z["feeBps"]==30 and z["extraSlipBps"]==0 and z["positiveM5Delay"]==1:
            print("FUTURE",z["futureRegime"],"REFERENCE",round(z["sourceReferenceMeanNetPct"],4),
              "P30",round(z["P30MeanNetPct"],4),"DELTA",round(z["P30MinusReferenceMeanPct"],4),
              "ORIGINAL_WINNERS_HARMED",z["sourceReferenceWinnerProfitReduced"],"/8")
if __name__=="__main__":main()
