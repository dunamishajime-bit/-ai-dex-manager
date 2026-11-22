#!/usr/bin/env python3
"""P28 Layer3 PENGU S4 source: 0.75 / 1.00 / 1.25x frozen notional exposure tests.

Never change frozen H1 setup120, M5 entry/exit or P25 shock state.
Accounting is modelled JPY initial NAV10k, NOT a live quote/margin simulator.
"""
from __future__ import annotations
import argparse,json,hashlib
from pathlib import Path
from collections import Counter
from prism7_native53_event_attribution_20261122 import load_m5
from prism7_p21_pengu_s3_m5_seller_confirmation_fsm_20261122 import apply_single_slot
from prism7_p25_s4_cross_asset_capitulation_capture_20261122 import rebuild,original_121_source
from prism7_p26_previous_completed_m5_peak_high_stress_20261122 import study as frozen1x
M5=300000
DATA_END=1794960000000
NAV0=10000.
GROSS=(.75,1.0,1.25)
DELAYS=(1,2,3)
SLIPS=(0,25,100,500,1000)
FEES=(10,30)
def scan(rows,m5,gross,fee):
    natural_intents=len(rows)
    if natural_intents!=120:raise ValueError("P28_ORIGINAL_120_CANDIDATE_COHORT_LOST")
    positions=sorted((x for x in rows if x["status"]=="PRICE_PROXY_CLOSED" or
        (x["status"].startswith("RIGHT_CENSORED") and x.get("entryProxyTs") is not None)),
        key=lambda x:x["entryProxyTs"])
    cash=NAV0
    peak=NAV0
    realized_peak=NAV0
    markdd=0.;highdd=0.;rdd=0.
    max_mark=None;max_high=None
    last_end=-1
    pnl=[]
    pnl_kind=[]
    records=[]
    for x in positions:
        entry=int(x["entryProxyTs"])
        if entry<last_end+M5:raise ValueError("P28_SOURCE_MULTIPLE_POSITIONS_SAME_SLOT")
        price=float(x["entryProxyPrice"])
        exit_=int(x["exitProxyTs"]) if x["status"]=="PRICE_PROXY_CLOSED" else None
        end=exit_ if exit_ is not None else DATA_END-M5
        if end<entry:raise ValueError("P28_SOURCE_STOP_BEFORE_ENTRY")
        last_end=end
        prior_cash=cash
        last=None
        last_positive_ts=None
        localDD=0.
        localHighDD=0.
        positive=0
        bars=0
        for t in range(entry,end+1,M5):
            bar=m5.get(t)
            if bar is None:raise ValueError("P28_SOURCE_M5_PRICE_GAP:"+str(t))
            vol=float(bar[5]);bars+=1
            if vol>0:
                positive+=1;last_positive_ts=t
                last=float(bar[4])
            if last is None:last=price
            # SOURCE M5 current HIGH is physically earlier than this bar's final CLOSE.
            if vol>0 and t!=exit_:
                high=float(bar[2])
                hnav=prior_cash*(1+gross*((price-high)/price-fee/10000))
                dh=100*(1-hnav/peak)
                if dh>highdd:
                    highdd=dh;max_high={"id":x["id"],"time":t,"sourceHigh":high,
                                       "equity":hnav,"priorCompletedPeak":peak}
                localHighDD=max(localHighDD,dh)
            if t!=exit_:
                nav=prior_cash*(1+gross*((price-last)/price-fee/10000))
                if nav>peak:peak=nav
                dd=100*(1-nav/peak)
                if dd>markdd:
                    markdd=dd;max_mark={"id":x["id"],"time":t,"sourceCloseMark":last,
                                        "equity":nav,"priorPeak":peak}
                localDD=max(localDD,dd)
            else:
                if vol<=0:raise ValueError("P28_EXIT_M5_WITHOUT_POSITIVE_PRICE")
                px=float(x["exitProxyPrice"])
                cash=prior_cash*(1+gross*((price-px)/price-fee/10000))
                if cash>peak:peak=cash
                dd=100*(1-cash/peak)
                if dd>markdd:
                    markdd=dd;max_mark={"id":x["id"],"time":t,"exitPrice":px,
                                        "equity":cash,"priorPeak":peak}
                localDD=max(localDD,dd)
                if cash>realized_peak:realized_peak=cash
                dr=100*(1-cash/realized_peak)
                rdd=max(rdd,dr)
        if exit_ is None:
            cash=prior_cash*(1+gross*((price-last)/price-fee/10000))
            peak=max(peak,cash)
            realizedReturn=None
        else:
            realizedReturn=100*gross*((price-float(x["exitProxyPrice"]))/price-fee/10000)
            pnl.append(realizedReturn)
        records.append({
          "id":x["id"],"route":x["route"],"cohort":x["cohort"],
          "sourceStatus":x["status"],"entryTs":entry,"entryPrice":price,
          "exitTs":exit_,"exitPrice":x.get("exitProxyPrice"),
          "sourceOriginalExitReason":x.get("exitReason"),
          "notionalGrossVsCurrentEquity":gross,"roundTripFeeBpsOnNotional":fee,
          "initialEquityYen":prior_cash,"notionalAtEntryAccountingUnit":prior_cash*gross,
          "endingCashOrLastUnrealizedNAV":cash,
          "realizedNetPctOnEntryEquityIfClosed":realizedReturn,
          "worstHoldingPortfolioM5CloseDDPct":localDD,
          "worstHoldingPortfolioChronologicalHighDDPct":localHighDD,
          "positiveM5BarCount":positive,"totalM5BarCount":bars,
          "sourceM5SignedVenueFillProven":False,
        })
    n=len(pnl)
    gains=sum(v for v in pnl if v>0)
    loss=-sum(v for v in pnl if v<0)
    return {
      "originalSourceStructuralSetups":natural_intents,
      "originalSourceCompletedTradeCount":n,
      "sourceCensoredOpenPositionCount":sum(x["exitTs"] is None for x in records),
      "sourceGross":gross,"sourceRoundtripFeeBps":fee,
      "conditionalWinCount":sum(v>0 for v in pnl),
      "conditionalWinratePct":round(100*sum(v>0 for v in pnl)/n,8) if n else None,
      "conditionalMeanNetReturnPctOnEquity":round(sum(pnl)/n,8) if n else None,
      "conditionalProfitFactor":round(gains/loss,8) if loss>0 else None,
      "sourceSingleSlotTotalReturnPointsOnEquity":round(sum(pnl),8),
      "sourceRealizedOnlyDDPct":round(rdd,8),
      "sourceM5CloseMarkedDDPct":round(markdd,8),
      "sourcePrevCompletedM5PeakHighStressDDPct":round(highdd,8),
      "sourceReferenceFinalEquityInclCensoredMarkYen":round(cash,6),
      "worstMarkEvent":max_mark,
      "worstChronologicalHighEvent":max_high,
      "notActualPortfolioDD":True,
    },records
def main():
    a=argparse.ArgumentParser()
    a.add_argument("--p22-events",type=Path,required=True)
    a.add_argument("--p25-summary",type=Path,required=True)
    a.add_argument("--p26-summary",type=Path,required=True)
    a.add_argument("--pengu-m5",type=Path,nargs="+",required=True)
    a.add_argument("--out-summary",type=Path,required=True)
    a.add_argument("--out-ledger",type=Path,required=True)
    args=a.parse_args()
    old=[json.loads(x) for x in args.p22_events.read_text(encoding="utf-8").splitlines() if x]
    natural=original_121_source(old)
    p25=json.loads(args.p25_summary.read_text(encoding="utf-8"))
    p26=json.loads(args.p26_summary.read_text(encoding="utf-8"))
    if len(natural)!=120 or len(p25["all120PerCandidateDetectionEvents"])!=120:
        raise ValueError("P28_SOURCE_120_REQUIRED")
    detector=p25["all120PerCandidateDetectionEvents"]
    prior={(z["p25DelayPositivePrint"],z["p25ExtraExitSlippageBps"],z["feeBps"]):z for z in
       p26["allCostAndDelayComparisons"] if z["modelGroup"]=="S4_P25_CAPITULATION"}
    if len(prior)!=30:raise ValueError("P28_P26_REFERENCE_RISK30_NOT_PARITY")
    market,mhash=load_m5(args.pengu_m5)
    outcomes=[]
    trace=[]
    for delay in DELAYS:
        for slip in SLIPS:
            each=[rebuild(x,detector[x["id"]],delay,slip) for x in natural]
            slot=apply_single_slot(each)
            if len(slot)!=120:raise ValueError("P28_NO_LOST_CANDIDATES")
            for fee in FEES:
                for gross in GROSS:
                    result,positions=scan(slot,market,gross,fee)
                    if gross==1.0:
                        ref=prior[delay,slip,fee]["causalPreviousCloseHighStress"]
                        for ours,theirs in (
                            (result["sourceM5CloseMarkedDDPct"],ref["maximum5MCloseMarkedDDPct"]),
                            (result["sourcePrevCompletedM5PeakHighStressDDPct"],ref["maximumPriorM5ClosePeakHighStressDDPct"]),
                            (result["sourceReferenceFinalEquityInclCensoredMarkYen"],ref["finalEquityReferenceNAV"])):
                            if abs(ours-theirs)>2e-5:
                                raise ValueError(f"P28_MANDATORY_GROSS1_SOURCE_P26_PARITY_FAIL:{delay}:{slip}:{fee}:{ours}:{theirs}")
                    outcomes.append({"delayPositivePrints":delay,"extraExitSlipBps":slip,"feeBps":fee,
                                     "gross":gross,"capitalAndRisk":result})
                    for x in positions:trace.append({"delayPositivePrints":delay,
                        "extraExitSlipBps":slip,"feeBps":fee,"gross":gross,**x})
    if len(outcomes)!=90 or len(trace)!=22*90:
        raise ValueError("P28_NOT_90_SCENARIOS_1980_TRADE_RECORDS")
    main=[x for x in outcomes if x["delayPositivePrints"]==2 and x["feeBps"]==30 and
          x["extraExitSlipBps"]==0]
    if len(main)!=3:raise ValueError("P28_BASELINE_NOT_3_GROSS_COHORTS")
    original_win_count={r["capitalAndRisk"]["conditionalWinCount"] for r in outcomes}
    if original_win_count!={15}:raise ValueError("P28_GROSS_ALLOCATION_CHANGED_SOURCE_TRADE_WINS")
    body={
      "schema":"prism7-p28-layer3-fixed-0p75-1p00-1p25-gross-S4-capture-source120-90cases/v1",
      "sourceOriginalH1SetupsPreserved":120,"originalClosed":21,"originalWins":15,
      "sourceCensoredOpenCount":1,
      "sourceNaturalPinnedRuntimeSha":"1657e173d250ad58f53e62f7bb0a3428fb405496",
      "fixedGrossMultipliers":list(GROSS),
      "allNinetyResults":outcomes,
      "main30Bps2PositivePrintZeroSlipGrossComparison":main,
      "inputSHA256":{
        "p22Events":hashlib.sha256(args.p22_events.read_bytes()).hexdigest(),
        "p25Source":hashlib.sha256(args.p25_summary.read_bytes()).hexdigest(),
        "p26Source":hashlib.sha256(args.p26_summary.read_bytes()).hexdigest(),
        "PENGU_M5":mhash,
      },
      "limitations":[
        "This gross-only allocation changes position sizing and capital path, not signal alpha, wins, entry timing or source stop logic.",
        "P25 single flash crash rule was built from known 2025Oct historical outcome: not unseen OOS or generically verified risk.",
        "SOURCE position market price and bid/ask signed fills missing, 10/30bps simplified, no funding/other runners/Shared Risk/Gross correlation.",
        "Gross=1.25x requires exchange margin, liquidation rules and gross caps not modelled.",
        "M5 close DD under 20 on one asset alone is not overall multi-Runner DD <=20 compliance.",
      ],
    }
    args.out_summary.parent.mkdir(parents=True,exist_ok=True)
    args.out_summary.write_text(json.dumps(body,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf-8")
    args.out_ledger.write_text(json.dumps(trace,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf-8")
    print("PRISM7_P28_90_FROZEN_GROSS_SCENARIOS_P26_PARITY_ALL_PASS")
    for z in main:
        x=z["capitalAndRisk"]
        print("MAIN_GROSS",z["gross"],
          "win",x["conditionalWinCount"],"mean",x["conditionalMeanNetReturnPctOnEquity"],
          "PF",x["conditionalProfitFactor"],"DD_M5_CLOSE",x["sourceM5CloseMarkedDDPct"],
          "DD_CAUSAL_HIGH",x["sourcePrevCompletedM5PeakHighStressDDPct"],
          "FINAL_NAV",x["sourceReferenceFinalEquityInclCensoredMarkYen"])
if __name__=="__main__":main()
