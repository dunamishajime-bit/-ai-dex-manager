#!/usr/bin/env python3
"""P30: source-identical PENGU/BTC shock past, new buyer recovery state confirmed M5 close.

CAUSAL: P30 exit only after completed positive PENGU/BTC M5 green+rise and
following M5 positive OPEN. Counterexample FAKE_BOUNCE_DUMP fixed before results.
SOURCE original REFERENCE_STOP72 always preempts. Synthetic artificial not OOS.
"""
from __future__ import annotations
import argparse,csv,hashlib,json,math
from collections import Counter,defaultdict
from pathlib import Path
from prism7_p20_pengu_s3_market_structure_native_source_comparison_20261122 import stop72
from prism7_p29_identical_past_two_opposite_shock_futures_20261122 import (
 generated as p29generated,ENTRY,FUTURE,ENTRY_PRICE,M5,H,SEED,MASKS,WORLDS
)
NAME="PENGU_S4_RECOVERY_CONFIRMED_EXIT_V1"
ORIGINAL_SHOCK_PENGU_CLOSE=.010000
ORIGINAL_SHOCK_BTC_CLOSE=104694.7
POST_SHOCK_RECOVERY_PENGU_MULT=1.01
POST_SHOCK_RECOVERY_BTC_MULT=1.005
MAX_POST_SHOCK_SEARCH_BARS=24
BTC_FUTURES={
 "RECOVER_FAST":{"target":115000.,"tauH":1.},
 "CONTINUE_DOWN":{"target":95000.,"tauH":24.},
 "CHOPPY_REBOUND":{"target":110000.,"tauH":4.},
}
RECOVERY_FAKE="FALSE_BOUNCE_DUMP"
FEE=(10,30)
EXTRA=(0,100,1000)
DELAY=(1,2)
ALL_REGIMES=(*WORLDS,RECOVERY_FAKE)
def deterministic_end(t_elapsed,seed,origin,target,tau):
    base=target+(origin-target)*math.exp(-t_elapsed/tau)
    return max(.000001,base*(1+.008*math.sin((t_elapsed*12+(SEED+seed)*11)*.19)))
def false_price(t_hours,seed,origin,bounce,target):
    # Fixed 30m "false recovery", then downward selloff over ~12h.
    if t_hours<=.5:
        return deterministic_end(t_hours,seed,origin,bounce,.15)
    at_split=bounce+(origin-bounce)*math.exp(-.5/.15)
    return deterministic_end(t_hours-.5,seed,at_split,target,12.)
def make_pengu(regime,seed,mask):
    if regime!=RECOVERY_FAKE:
        return p29generated(regime,seed,mask)
    src={
        ENTRY:[ENTRY,.022617,.023038,.010000,.010000,1363556,ENTRY+M5-1,0,0,126929,0]
    }
    prev=ORIGINAL_SHOCK_PENGU_CLOSE
    for i in range(80*12):
        ts=FUTURE+i*M5
        if i%mask!=0:
            src[ts]=[ts,prev,prev,prev,prev,0,ts+M5-1,0,0,0,0]
            continue
        hours=(i+1)/12
        close=false_price(hours,seed,.01,.012,.004)
        hi=max(prev,close)*1.002;lo=min(prev,close)*.998
        src[ts]=[ts,prev,hi,lo,close,100000,ts+M5-1,0,0,50000,0]
        prev=close
    return src
def make_btc(regime,seed,mask):
    original=[
      ENTRY,112137.0,112486.0,103541.7,ORIGINAL_SHOCK_BTC_CLOSE,
      10533.446,ENTRY+M5-1,0,0,5200.684,0
    ]
    future={ENTRY:original}
    prev=ORIGINAL_SHOCK_BTC_CLOSE
    for i in range(80*12):
        ts=FUTURE+i*M5
        if i%mask!=0:
            future[ts]=[ts,prev,prev,prev,prev,0,ts+M5-1,0,0,0,0]
            continue
        hours=(i+1)/12
        if regime==RECOVERY_FAKE:
            px=false_price(hours,seed,ORIGINAL_SHOCK_BTC_CLOSE,107000.,95000.)
        else:
            target=BTC_FUTURES[regime]
            px=deterministic_end(hours,seed,ORIGINAL_SHOCK_BTC_CLOSE,
                                 target["target"],target["tauH"])
        high=max(prev,px)*1.002
        low=min(prev,px)*.998
        future[ts]=[ts,prev,high,low,px,1000,ts+M5-1,0,0,500,0]
        prev=px
    return future
def detect_buyer_recovery(pengu,btc,baseline_exit_ts):
    # All source past shock 21:15 COMPLETE (close at 21:20).
    # Scan at most 2h of *newly complete* post-shock M5.
    for i in range(MAX_POST_SHOCK_SEARCH_BARS):
        ts=FUTURE+i*M5
        if ts>=baseline_exit_ts:break
        p=pengu.get(ts);b=btc.get(ts)
        if not p or not b:raise ValueError("P30_SYNTHETIC_CORRUPT_M5")
        if float(p[5])<=0 or float(b[5])<=0:continue
        if not(float(p[4])>=ORIGINAL_SHOCK_PENGU_CLOSE*POST_SHOCK_RECOVERY_PENGU_MULT and
                float(p[4])>float(p[1]) and
                float(b[4])>=ORIGINAL_SHOCK_BTC_CLOSE*POST_SHOCK_RECOVERY_BTC_MULT):
            continue
        confirmation_close=ts+M5
        if confirmation_close>=baseline_exit_ts:continue
        matches=[]
        for j in range(i+1,MAX_POST_SHOCK_SEARCH_BARS+24):
            nextt=FUTURE+j*M5
            if nextt>=baseline_exit_ts:break
            candle=pengu.get(nextt)
            if candle is None:raise ValueError("P30_FUTURE_M5_MISSING")
            if float(candle[5])>0:
                matches.append({"ts":nextt,"px":float(candle[1])})
                if len(matches)>=2:break
        return {
           "status":"RECOVERY_CONFIRMED_COMPLETED_M5",
           "confirmationM5StartTs":ts,
           "confirmationM5ClosedTs":confirmation_close,
           "penguRecoveredClose":float(p[4]),
           "btcRecoveredClose":float(b[4]),
           "penguM5OpenedBeforeClose":float(p[1]),
           "futureRegimeLabelUsedAsSignal":False,
           "nextPositiveM5OpenPriceProxies":matches,
        }
    return {"status":"NO_POSITIVE_M5_CROSS_ASSET_RECOVERY_WITHIN_2H",
            "nextPositiveM5OpenPriceProxies":[],
            "futureRegimeLabelUsedAsSignal":False}
def old_p25_unconditional(pengu,stop_ts,delay):
    after=[]
    for j in range(80*12):
        ts=FUTURE+j*M5
        if ts>=stop_ts:break
        bar=pengu.get(ts)
        if bar is None:raise ValueError("P30_P25_OLD_SOURCE_MISSING_M5")
        if float(bar[5])>0:
            after.append((ts,float(bar[1])))
            if len(after)==delay:return after[-1]
    return None

def case_future(regime,seed,maskname):
    mask=MASKS[maskname]
    pengu=make_pengu(regime,seed,mask)
    btc=make_btc(regime,seed,mask)
    if (pengu[ENTRY][4]!=ORIGINAL_SHOCK_PENGU_CLOSE or
        btc[ENTRY][4]!=ORIGINAL_SHOCK_BTC_CLOSE or
        pengu[ENTRY][1]!=ENTRY_PRICE):
        raise ValueError("P30_IDENTICAL_PRE_SHOCK_SOURCE_PREFIX_CHANGED")
    native=stop72(pengu,ENTRY,ENTRY_PRICE,max_observation_end=ENTRY+80*H)
    if native["status"]!="PRICE_PROXY_CLOSED":
        raise ValueError("P30_SOURCE_REFERENCE_EXIT_NOT_CLOSED")
    confirm=detect_buyer_recovery(pengu,btc,native["exitTs"])
    for delay in DELAY:
        old=old_p25_unconditional(pengu,native["exitTs"],delay)
        after=confirm["nextPositiveM5OpenPriceProxies"]
        new=after[delay-1] if len(after)>=delay else None
        for fee in FEE:
            for slip in EXTRA:
                base_net=100*(1-native["exitPrice"]/ENTRY_PRICE)-fee/100
                if old is not None:
                    oldPx=old[1]*(1+slip/10000)
                    oldTime=old[0]
                else:
                    oldPx=native["exitPrice"];oldTime=native["exitTs"]
                if new is not None and new["ts"]<native["exitTs"]:
                    newPx=new["px"]*(1+slip/10000)
                    newTs=new["ts"];newTrigger=True
                else:
                    newPx=native["exitPrice"]
                    newTs=native["exitTs"];newTrigger=False
                if newTs<confirm.get("confirmationM5ClosedTs",FUTURE) and newTrigger:
                    raise ValueError("P30_RECOVERY_EXIT_BEFORE_COMPLETED_CONFIRMATION")
                out={
                    "regime":regime,"phaseSeed":seed,"printMask":maskname,
                    "identicalSourceEventEntryTs":ENTRY,
                    "identicalSourceEventCloseTs":FUTURE,
                    "sourcePinnedEntryPrice":ENTRY_PRICE,
                    "originalPenguShockClose":ORIGINAL_SHOCK_PENGU_CLOSE,
                    "originalBtcShockClose":ORIGINAL_SHOCK_BTC_CLOSE,
                    "feeBps":fee,"extraExitSlippageBps":slip,
                    "postConfirmDelayPositiveM5":delay,
                    "sourceReferenceExitTs":native["exitTs"],
                    "sourceReferenceExitPrice":native["exitPrice"],
                    "sourceReferenceExitReason":native["exitReason"],
                    "P30State":confirm["status"],
                    "P30RecoveryConfirmM5StartTs":confirm.get("confirmationM5StartTs"),
                    "P30RecoverySignalClosedTs":confirm.get("confirmationM5ClosedTs"),
                    "P30ConfirmationPenguClose":confirm.get("penguRecoveredClose"),
                    "P30ConfirmationBtcClose":confirm.get("btcRecoveredClose"),
                    "P30ExitTriggeredAfterNewInformation":newTrigger,
                    "P30ExitTs":newTs,"P30ExitPriceProxy":newPx,
                    "P25OldUnconditionalExitTs":oldTime,
                    "P25OldUnconditionalExitPriceProxy":oldPx,
                    "sourceReferenceNetPct":base_net,
                    "P25UnconditionalNetPct":100*(1-oldPx/ENTRY_PRICE)-fee/100,
                    "P30RecoveredExitNetPct":100*(1-newPx/ENTRY_PRICE)-fee/100,
                    "P30MinusSourceNetPct":100*(native["exitPrice"]-newPx)/ENTRY_PRICE,
                    "P30OriginalWinnerProfitReduced":base_net>0 and newPx>native["exitPrice"],
                    "P30ChangedSourceWinToLoss":base_net>0 and 100*(1-newPx/ENTRY_PRICE)-fee/100<=0,
                    "P30OriginalLoserRescued":base_net<=0 and 100*(1-newPx/ENTRY_PRICE)-fee/100>0,
                    "sourceOrderbookOrSignedFillProven":False,
                    "artificialPriceFutureNotRealOOS":True,
                }
                yield out
def main():
    a=argparse.ArgumentParser()
    a.add_argument("--p25-source",type=Path,required=True)
    a.add_argument("--out-summary",type=Path,required=True)
    a.add_argument("--out-cases",type=Path,required=True)
    args=a.parse_args()
    known=json.loads(args.p25_source.read_text(encoding="utf-8"))
    event=known["all120PerCandidateDetectionEvents"]["S3_01700"]
    if not(event["state"]=="CROSS_ASSET_CAPITULATION_CONFIRMED" and
           event["entryPrice"]==ENTRY_PRICE and event["penguM5Close"]==ORIGINAL_SHOCK_PENGU_CLOSE and
           event["btcM5Close"]==ORIGINAL_SHOCK_BTC_CLOSE and
           event["eventCloseTs"]==FUTURE):
        raise ValueError("P30_NATIVE_CROSSASSET_SHOCK_SOURCE_PARITY_FAIL")
    rows=[]
    for world in ALL_REGIMES:
        for seed in range(8):
            for mask in MASKS:
                rows.extend(case_future(world,seed,mask))
    if len(rows)!=96*len(DELAY)*len(FEE)*len(EXTRA):
        raise ValueError("P30_NOT_FULL_1152_FUTURE_OUTCOME_CASES")
    grouped=defaultdict(list)
    for x in rows:
        k=(x["regime"],x["printMask"],x["feeBps"],x["extraExitSlippageBps"],x["postConfirmDelayPositiveM5"])
        grouped[k].append(x)
    stats=[]
    for (reg,mask,fee,slip,delay),aa in sorted(grouped.items()):
        if len(aa)!=8:raise ValueError("P30_EIGHT_PHASE_VARIANTS_MISSING")
        stats.append({
            "regime":reg,"printMask":mask,"feeBps":fee,"extraSlipBps":slip,
            "positiveM5DelayAfterRecoveryConfirm":delay,"numberArtificialPricePaths":8,
            "recoveryConfirmedCount":sum(z["P30State"]=="RECOVERY_CONFIRMED_COMPLETED_M5" for z in aa),
            "recoveryModelExecutedBeforeReferenceStop":sum(z["P30ExitTriggeredAfterNewInformation"] for z in aa),
            "sourceBaselineWins":sum(z["sourceReferenceNetPct"]>0 for z in aa),
            "sourceOriginalWinnerProfitReduced":sum(z["P30OriginalWinnerProfitReduced"] for z in aa),
            "sourceWinnerBecomesLoser":sum(z["P30ChangedSourceWinToLoss"] for z in aa),
            "sourceLoserRescued":sum(z["P30OriginalLoserRescued"] for z in aa),
            "sourceMeanNetPct":sum(z["sourceReferenceNetPct"] for z in aa)/8,
            "P25OldUnconditionalMeanNetPct":sum(z["P25UnconditionalNetPct"] for z in aa)/8,
            "P30RecoveredExitMeanNetPct":sum(z["P30RecoveredExitNetPct"] for z in aa)/8,
            "meanP30MinusReferencePct":sum(z["P30MinusSourceNetPct"] for z in aa)/8,
            "worstP30MinusReferencePct":min(z["P30MinusSourceNetPct"] for z in aa),
        })
    if len(stats)!=4*3*2*3*2:raise ValueError("P30_UNEXPECTED_GROUP_COUNT")
    result={
        "schema":"prism7-p30-buyer-recovery-asof-M5-confirmed-next-positive-print-1152-artificial/v1",
        "name":NAME,"pinnedOriginalRuntimeSHA":"1657e173d250ad58f53e62f7bb0a3428fb405496",
        "precommit":"PRISM7_P30_PRECOMMITTED_POST_SHOCK_BUYER_RECOVERY_FSM_AND_FALSE_BOUNCE_20261122.md",
        "numberOfArtificialFuturePaths":96,"allScenarioRows":len(rows),
        "worlds":list(ALL_REGIMES),"masks":MASKS,
        "frozenPenguRecoveryThreshold":POST_SHOCK_RECOVERY_PENGU_MULT,
        "frozenBtcRecoveryThreshold":POST_SHOCK_RECOVERY_BTC_MULT,
        "frozenSearchHoursAfterShock":2,
        "newFalseBouncePreset":{"penguBounce":.012,"btcBounce":107000.,
              "penguFutureDown":.004,"btcFutureDown":95000.,
              "bounceH":.5,"recoveryTauH":.15,"downTauH":12},
        "sourceP25SHA256":hashlib.sha256(args.p25_source.read_bytes()).hexdigest(),
        "groups":stats,
        "limitations":[
            "New P30 rule designed AFTER examining prior P29 three artificial futures and one known October 2025 actual flash crash: NOT out of sample.",
            "Same source shock prefix and artificial price futures do not prove future real trading effectiveness.",
            "FALSE_BOUNCE_DUMP actively probes false recovery where originally correct SHORT may be exited too early.",
            "A confirmed M5 green candle and BTC recovery does not guarantee trend reversal or the next source price being fillable.",
            "SOURCE reference STOP72 is research overlay, not pinned PENGU V20 phase native exit.",
            "No owner signed fills, bid/ask orderbook, slippage tails beyond model, funding or shared account DD.",
        ],
    }
    args.out_summary.parent.mkdir(parents=True,exist_ok=True)
    args.out_summary.write_text(json.dumps(result,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf-8")
    with args.out_cases.open("w",encoding="utf-8",newline="") as f:
        w=csv.DictWriter(f,fieldnames=list(rows[0]))
        w.writeheader();w.writerows(rows)
    print("PRISM7_P30_FOUR_IDENTICAL_PREFIX_WORLDS_96_FUTURES_1152_CASES_PASS")
    for g in stats:
        if (g["printMask"]=="FULL_EACH_5M" and g["feeBps"]==30 and
            g["extraSlipBps"]==0 and g["positiveM5DelayAfterRecoveryConfirm"]==1):
            print("WORLD",g["regime"],
             "reference",round(g["sourceMeanNetPct"],5),
             "oldAlwaysExit",round(g["P25OldUnconditionalMeanNetPct"],5),
             "P30BuyerRecoveryExit",round(g["P30RecoveredExitMeanNetPct"],5),
             "relative",round(g["meanP30MinusReferencePct"],5),
             "originalWinnerProfitCut",g["sourceOriginalWinnerProfitReduced"],"/8")
if __name__=="__main__":main()
