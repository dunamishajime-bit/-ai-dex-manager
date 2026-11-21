#!/usr/bin/env python3
"""P26 independent chronology-aware 5m high stress against PRIOR completed M5 NAV peak.

H1 structure, M5 execution intent and native reference stop remain immutable.
Same-bar CLOSE cannot be known before same-bar HIGH. Baseline P23 oracle required.
Research-only, not signed exchange execution or full portfolio account DD.
"""
from __future__ import annotations
import argparse,json,hashlib
from pathlib import Path
from collections import Counter
from prism7_native53_event_attribution_20261122 import load_m5
from prism7_p21_pengu_s3_m5_seller_confirmation_fsm_20261122 import apply_single_slot
from prism7_p23_m5_mark_to_market_censored_position_risk_20261122 import stream_group,group_rows
from prism7_p25_s4_cross_asset_capitulation_capture_20261122 import rebuild,original_121_source
START_NAV=10000.
M5=300000
DATA_END=1794960000000
FEES=(10,30)
def study(rows,m5,fee):
    cs=sorted((x for x in rows if x["status"]=="PRICE_PROXY_CLOSED" or
      (x["status"].startswith("RIGHT_CENSORED") and x.get("entryProxyTs") is not None)),
      key=lambda x:x["entryProxyTs"])
    cash=START_NAV
    peak=START_NAV
    high_dd=0.
    close_dd=0.
    worst_high=None
    worst_close=None
    censored=0
    prev_end=-1
    trade_risks=[]
    for x in cs:
        entry=x["entryProxyTs"]
        if entry<prev_end+M5:raise ValueError("P26_SINGLE_SLOT_OVERLAPPING_ENTRIES")
        p=float(x["entryProxyPrice"])
        close=x["status"]=="PRICE_PROXY_CLOSED"
        exitt=int(x["exitProxyTs"]) if close else None
        end=exitt if close else DATA_END-M5
        prev_end=end
        if not close:censored+=1
        begin=cash
        last_mark=None
        worst_per_trade=0
        printbars=0
        zero=0
        for t in range(int(entry),int(end)+1,M5):
            bar=m5.get(t)
            if bar is None:raise ValueError("P26_MARK_M5_SOURCE_GAP:"+str(t))
            volume=float(bar[5])
            if volume>0:
                last_mark=float(bar[4])
                printbars+=1
            else:zero+=1
            if last_mark is None:last_mark=p
            # Exposure exits at EXIT bar OPEN; its HIGH is not an intratrade price.
            if t!=exitt and volume>0:
                high=float(bar[2])
                nav_high=begin*(1+(p-high)/p-fee/10000)
                high_after_completed_peak=100*(1-nav_high/peak)
                if high_after_completed_peak>high_dd:
                    high_dd=high_after_completed_peak
                    worst_high={
                       "id":x["id"],"route":x["route"],"cohort":x["cohort"],
                       "time":t,"sourceM5High":high,
                       "priorCompletedM5MarkPeakNAV":peak,
                       "highAdverseNAV":nav_high,
                       "entryBarHighOrderUnknown":t==entry,
                       "isStopExitM5Bar":False,
                    }
                worst_per_trade=max(worst_per_trade,high_after_completed_peak)
            # Only now commit a CLOSE mark as the next interval's known peak.
            if t!=exitt:
                mark_nav=begin*(1+(p-last_mark)/p-fee/10000)
                peak=max(peak,mark_nav)
                drawdown=100*(1-mark_nav/peak)
                if drawdown>close_dd:
                    close_dd=drawdown;worst_close={"id":x["id"],"time":t,"markNAV":mark_nav,"peak":peak}
            else:
                if volume<=0:raise ValueError("P26_EXIT_WITHOUT_POSITIVE_PRINT")
                cash=begin*(1+(p-float(x["exitProxyPrice"]))/p-fee/10000)
                peak=max(peak,cash)
                drawdown=100*(1-cash/peak)
                if drawdown>close_dd:
                    close_dd=drawdown;worst_close={"id":x["id"],"time":t,"markNAV":cash,"peak":peak}
        if not close:
            cash=begin*(1+(p-last_mark)/p-fee/10000)
            peak=max(peak,cash)
        trade_risks.append({
          "id":x["id"],"status":x["status"],"entryTs":entry,
          "exitTs":exitt,"beforeTradeCash":begin,
          "endCashOrMarked":cash,
          "worstPriorM5MarkPeakHighStressDDPctWithinPosition":round(worst_per_trade,8),
          "positiveM5PrintBars":printbars,"zeroVolumeM5Bars":zero,
          "synthesizedSignedVenueFill":False,
        })
    return {
      "singleSlotSourceIntents":len(rows),
      "completed":sum(x["status"]=="PRICE_PROXY_CLOSED" for x in cs),
      "rightCensoredMarkedOpen":censored,
      "maximum5MCloseMarkedDDPct":round(close_dd,8),
      "maximumPriorM5ClosePeakHighStressDDPct":round(high_dd,8),
      "worstChronologicalHighEvent":worst_high,
      "worst5MCloseDDRecord":worst_close,
      "finalEquityReferenceNAV":round(cash,5),
      "feesBpsRoundtrip":fee,
      "totals":{"positiveM5Bars":sum(x["positiveM5PrintBars"] for x in trade_risks),
                "zeroM5Bars":sum(x["zeroVolumeM5Bars"] for x in trade_risks)},
    },trade_risks
def main():
    a=argparse.ArgumentParser()
    a.add_argument("--p20-events",type=Path,required=True)
    a.add_argument("--p21-events",type=Path,required=True)
    a.add_argument("--p22-events",type=Path,required=True)
    a.add_argument("--p23-summary",type=Path,required=True)
    a.add_argument("--p25-summary",type=Path,required=True)
    a.add_argument("--pengu-m5",type=Path,nargs="+",required=True)
    a.add_argument("--out-summary",type=Path,required=True)
    a.add_argument("--out-ledger",type=Path,required=True)
    args=a.parse_args()
    files=[args.p20_events,args.p21_events,args.p22_events]
    p20,p21,p22=([json.loads(x) for x in f.read_text(encoding="utf-8").splitlines() if x.strip()]
                 for f in files)
    groups=group_rows(p20,p21,p22)
    p23=json.loads(args.p23_summary.read_text(encoding="utf-8"))
    prior_p23={(x["group"],x["feeBps"],x["exitSlippageBps"]):x for x in p23["groups"]}
    p25=json.loads(args.p25_summary.read_text(encoding="utf-8"))
    if p25["source120P22AllSetupParity"]!="PASS" or p25["sourceS4SingleSlot120BaselineReplay"]!="PASS":
        raise ValueError("P26_P25_SOURCE120_NOT_PARITY")
    original=original_121_source(p22)
    events=p25["all120PerCandidateDetectionEvents"]
    if set(events)!=set(x["id"] for x in original):
        raise ValueError("P26_ALL_120_EVENT_STATUS_NOT_PARITY")
    m5,mhash=load_m5(args.pengu_m5)
    scenarios=[]
    ledger=[]
    for group,rows in groups.items():
        for fee in FEES:
            ours,risk=study(rows,m5,fee)
            oracle=prior_p23[group,fee,0]
            if abs(ours["maximum5MCloseMarkedDDPct"]-oracle["maximumM5CloseMarkToMarketDDPct"])>1e-6:
                raise ValueError("P26_MARK_DD_ORIGINAL_SOURCE_NUMERIC_FAIL:"+group)
            if abs(ours["finalEquityReferenceNAV"]-oracle["referenceFinalEquityIncludingUnrealizedYen"])>1e-4:
                raise ValueError("P26_FINAL_SOURCE_EQUITY_NOT_PARITY:"+group)
            if ours["maximumPriorM5ClosePeakHighStressDDPct"]-oracle["maximumM5HighAdverseEnvelopeDDPct"]>1e-6:
                raise ValueError("P26_CAUSAL_HIGH_EXCEEDS_LEGACY_ENVELOPE")
            scenarios.append({"modelGroup":group,"feeBps":fee,"p25DelayPositivePrint":None,
              "p25ExtraExitSlippageBps":None,
              "causalPreviousCloseHighStress":ours,
              "legacyP23SameM5CloseFirstHighStressDDPct":oracle["maximumM5HighAdverseEnvelopeDDPct"],
              "legacySource5MCloseDDPct":oracle["maximumM5CloseMarkToMarketDDPct"]})
            for r in risk:ledger.append({"modelGroup":group,"feeBps":fee,**r})
    old_p25={(x["delayPositiveM5PrintsAfterSignal"],x["additionalEntryIndependentExitSlipBps"],x["feeBps"]):x
             for x in p25["costAndExitDelayScenarios"]}
    for delay in (1,2,3):
        for extra in (0,25,100,500,1000):
            new=[rebuild(x,events[x["id"]],delay,extra) for x in original]
            slot=apply_single_slot(new)
            if len(slot)!=120:raise ValueError("P26_P25_SINGLE_SLOT_120_LOST")
            for fee in FEES:
                ours,risk=study(slot,m5,fee)
                old=old_p25[delay,extra,fee]["referenceM5MarkRisk"]
                if abs(ours["maximum5MCloseMarkedDDPct"]-old["maximumM5CloseMarkToMarketDDPct"])>1e-6:
                    raise ValueError("P26_P25_M5_CLOSE_NOT_PARITY")
                if abs(ours["finalEquityReferenceNAV"]-old["referenceFinalEquityIncludingUnrealizedYen"])>1e-4:
                    raise ValueError("P26_P25_FINAL_CASH_NOT_PARITY")
                if ours["maximumPriorM5ClosePeakHighStressDDPct"]-old["maximumM5HighAdverseEnvelopeDDPct"]>1e-6:
                    raise ValueError("P26_P25_CAUSAL_HIGH_ABOVE_LEGACY")
                scenarios.append({"modelGroup":"S4_P25_CAPITULATION",
                  "feeBps":fee,"p25DelayPositivePrint":delay,
                  "p25ExtraExitSlippageBps":extra,
                  "causalPreviousCloseHighStress":ours,
                  "legacyP23SameM5CloseFirstHighStressDDPct":old["maximumM5HighAdverseEnvelopeDDPct"],
                  "legacySource5MCloseDDPct":old["maximumM5CloseMarkToMarketDDPct"]})
                if fee==30 and delay==2 and extra==0:
                    for r in risk:ledger.append({"modelGroup":"S4_P25_CAPITULATION", "feeBps":fee,
                      "p25DelayPositivePrint":delay,"p25ExtraExitSlippageBps":extra,**r})
    if len(scenarios)!=38:raise ValueError("P26_ALL_38_RISK_SCENARIOS_NOT_DONE")
    main=next(x for x in scenarios if x["modelGroup"]=="S4_P25_CAPITULATION" and
      x["feeBps"]==30 and x["p25DelayPositivePrint"]==2 and x["p25ExtraExitSlippageBps"]==0)
    s4=next(x for x in scenarios if x["modelGroup"]=="S4_SINGLE_SLOT" and x["feeBps"]==30)
    result={
      "schema":"prism7-p26-prior-completed-M5-peak-chronological-high-stress-not-samebar-close-peak/v1",
      "frozenRuleSource":"PRISM7_P26_PRECOMMITTED_CAUSAL_PREV_M5_CLOSE_PEAK_HIGH_STRESS_AUDIT_20261122.md",
      "scenarioCount":len(scenarios),
      "mainS4P22":s4,
      "mainS4P25TwoPrintExtra0":main,
      "allCostAndDelayComparisons":scenarios,
      "inputSha256":{
        "p20":hashlib.sha256(args.p20_events.read_bytes()).hexdigest(),
        "p21":hashlib.sha256(args.p21_events.read_bytes()).hexdigest(),
        "p22":hashlib.sha256(args.p22_events.read_bytes()).hexdigest(),
        "p23":hashlib.sha256(args.p23_summary.read_bytes()).hexdigest(),
        "p25":hashlib.sha256(args.p25_summary.read_bytes()).hexdigest(),
        "PENGU_M5":mhash,
      },
      "limitations":[
        "HIGH during bar may follow a LOW during the same bar; prior completed M5 peak is time-consistent but not a full microtick realized maximum drawdown.",
        "P23 higher legacy HIGH stress bound preserves an adversarial same-bar ordering stress which is not necessarily realizable.",
        "SOURCE public M5 close marked DD remains the primary DD filter, and it exceeds 20% for P25 baseline.",
        "No own orders/quotes, actual venue exit execution, funding, multi-runner shared margin, genuine unseen OOS or robust synthetic-shock proof.",
        "No effect on actual Runner or SOURCE stop; diagnostic only.",
      ]
    }
    args.out_summary.parent.mkdir(parents=True,exist_ok=True)
    args.out_summary.write_text(json.dumps(result,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf-8")
    args.out_ledger.write_text(json.dumps(ledger,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf-8")
    print("PRISM7_P26_ALL_38_CHRONOLOGICAL_M5_HIGH_STRESS_SCENARIOS_PASS")
    for a in (s4,main):
        v=a["causalPreviousCloseHighStress"]
        print("GROUP",a["modelGroup"],
           "causalPreviousPeakHighDD",v["maximumPriorM5ClosePeakHighStressDDPct"],
           "M5CloseMarkDD",v["maximum5MCloseMarkedDDPct"],
           "legacyStressHigh",a["legacyP23SameM5CloseFirstHighStressDDPct"],
           "worst",json.dumps(v["worstChronologicalHighEvent"],ensure_ascii=False))
if __name__=="__main__":main()
