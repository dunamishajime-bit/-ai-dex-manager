#!/usr/bin/env python3
"""PRISM VII P27 causal M5 close accounting of S4+P25 residual drawdown peak origins.

Independent bookkeeping, no change to source ENTRY/STOP/EXIT or real orders.
"""
from __future__ import annotations
import argparse,json,hashlib,datetime
from pathlib import Path
from collections import Counter
from prism7_native53_event_attribution_20261122 import load_m5
from prism7_p21_pengu_s3_m5_seller_confirmation_fsm_20261122 import apply_single_slot
from prism7_p25_s4_cross_asset_capitulation_capture_20261122 import rebuild,original_121_source
from prism7_p26_previous_completed_m5_peak_high_stress_20261122 import study as p26study
M5=300000
DATA_END=1794960000000
FEE=30
START_NAV=10000.
def iso(t):
 return datetime.datetime.fromtimestamp(t/1000,datetime.timezone.utc).isoformat() if t is not None else None
def attribution(rows,m5):
    positions=sorted((x for x in rows if x["status"]=="PRICE_PROXY_CLOSED" or
                (x["status"].startswith("RIGHT_CENSORED") and x.get("entryProxyTs") is not None)),
       key=lambda x:x["entryProxyTs"])
    cash=START_NAV
    high={"NAV":cash,"id":None,"time":None,"kind":"REALIZED_START","price":None}
    worst={"drawdownPct":0}
    max_highstress={"drawdownPct":0}
    last_end=-1
    transactions=[]
    for position in positions:
        entry=int(position["entryProxyTs"])
        if entry<last_end+M5:raise ValueError("P27_TIME_OVERLAP")
        p=float(position["entryProxyPrice"])
        complete=position["status"]=="PRICE_PROXY_CLOSED"
        exitt=int(position["exitProxyTs"]) if complete else None
        end=exitt if complete else DATA_END-M5
        last_end=end
        begin=cash
        peak_before=dict(high)
        last_mark=None
        best_mfe=0
        worst_mae=0
        worst_running_dd_in_trade=0
        positive=0
        first_positive_ts=None
        zero=0
        min_low=p
        max_high=p
        for t in range(entry,end+1,M5):
            row=m5.get(t)
            if row is None:raise ValueError("P27_SOURCE_M5_GAP")
            if float(row[5])>0:
                positive+=1
                if first_positive_ts is None:first_positive_ts=t
                last_mark=float(row[4])
                min_low=min(min_low,float(row[3]))
                max_high=max(max_high,float(row[2]))
                best_mfe=max(best_mfe,100*(1-min_low/p))
                worst_mae=min(worst_mae,100*(1-max_high/p))
            else:zero+=1
            if last_mark is None:last_mark=p
            # HIGH stress is measured against LAST FULLY COMPLETED M5 peak only
            # before the present M5 CLOSE enters available information.
            if t!=exitt and float(row[5])>0:
                hpx=float(row[2])
                hnav=begin*(1+(p-hpx)/p-FEE/10000)
                hdd=100*(1-hnav/high["NAV"])
                if hdd>max_highstress["drawdownPct"]:
                    max_highstress={"drawdownPct":hdd,"peak":dict(high),
                      "valley":{"id":position["id"],"time":t,
                        "riskHighM5":hpx,"NAV":hnav,"entryBar":t==entry}}
            if t!=exitt:
                marked_nav=begin*(1+(p-last_mark)/p-FEE/10000)
                if marked_nav>high["NAV"]:
                    high={"NAV":marked_nav,"id":position["id"],"time":t,
                          "kind":"UNREALIZED_M5_CLOSE","price":last_mark}
                dd=100*(1-marked_nav/high["NAV"])
                if dd>worst["drawdownPct"]:
                    worst={"drawdownPct":dd,
                        "peak":dict(high),
                        "valley":{"id":position["id"],"time":t,
                          "kind":"UNREALIZED_M5_CLOSE","price":last_mark,
                          "NAV":marked_nav}}
                worst_running_dd_in_trade=max(worst_running_dd_in_trade,dd)
            else:
                if float(row[5])<=0:raise ValueError("P27_NO_POSITIVE_EXIT_M5")
                exitpx=float(position["exitProxyPrice"])
                cash=begin*(1+(p-exitpx)/p-FEE/10000)
                if cash>high["NAV"]:
                    high={"NAV":cash,"id":position["id"],"time":t,
                          "kind":"REALIZED_EXIT","price":exitpx}
                dd=100*(1-cash/high["NAV"])
                if dd>worst["drawdownPct"]:
                    worst={"drawdownPct":dd,
                        "peak":dict(high),
                        "valley":{"id":position["id"],"time":t,
                          "kind":"REALIZED_EXIT","price":exitpx,"NAV":cash}}
                worst_running_dd_in_trade=max(worst_running_dd_in_trade,dd)
        if not complete:
            cash=begin*(1+(p-last_mark)/p-FEE/10000)
            if cash>high["NAV"]:
                high={"NAV":cash,"id":position["id"],"time":DATA_END-M5,
                      "kind":"UNREALIZED_CENSORED_LAST_CLOSE","price":last_mark}
        transactions.append({
          "id":position["id"],"route":position["route"],
          "cohort":position["cohort"],
          "sourceStatus":position["status"],
          "entryTs":entry,"entryPrice":p,
          "exitTs":exitt,"exitPrice":position.get("exitProxyPrice"),
          "exitReason":position.get("exitReason"),
          "cashAtEntry":begin,
          "NAVAtExitOrFinalMark":cash,
          "runningM5NAVPeakAtEntry":peak_before,
          "maxMarkedDrawdownAgainstPriorGlobalPeakDuringTradePct":worst_running_dd_in_trade,
          "maxAdverseM5HighVsEntryGrossPct":-worst_mae,
          "maxFavorableM5LowVsEntryGrossPct":best_mfe,
          "positiveM5Bars":positive,"zeroM5Bars":zero,
          "entryAndExitSourceSignedVenueFill":False,
        })
    if abs(worst["drawdownPct"]-21.958773232604944)>1e-7:
        raise ValueError("P27_DD_21_9587_NOT_EXACT")
    if abs(max_highstress["drawdownPct"]-21.958773232604944)>1e-7:
        raise ValueError("P27_CAUSAL_HIGH_DD_NOT_EXACT")
    if abs(cash-35621.10473)>1e-3:raise ValueError("P27_FINAL_MARK_MUST_MATCH_P25")
    return worst,max_highstress,transactions,cash
def main():
    a=argparse.ArgumentParser()
    a.add_argument("--p22-events",type=Path,required=True)
    a.add_argument("--p25-summary",type=Path,required=True)
    a.add_argument("--p26-summary",type=Path,required=True)
    a.add_argument("--pengu-m5",type=Path,nargs="+",required=True)
    a.add_argument("--out-summary",type=Path,required=True)
    a.add_argument("--out-trades",type=Path,required=True)
    args=a.parse_args()
    p22=[json.loads(x) for x in args.p22_events.read_text(encoding="utf-8").splitlines() if x.strip()]
    p25=json.loads(args.p25_summary.read_text(encoding="utf-8"))
    p26=json.loads(args.p26_summary.read_text(encoding="utf-8"))
    original=original_121_source(p22)
    ev=p25["all120PerCandidateDetectionEvents"]
    edited=[rebuild(x,ev[x["id"]],2,0) for x in original]
    rows=apply_single_slot(edited)
    if len(rows)!=120:raise ValueError("P27_ALL120_ORIGINAL_SOURCE_INTENTS_LOST")
    market,rawhash=load_m5(args.pengu_m5)
    worst,high,ledger,cash=attribution(rows,market)
    oracle,_=p26study(rows,market,30)
    if abs(oracle["maximum5MCloseMarkedDDPct"]-worst["drawdownPct"])>1e-7:
        raise ValueError("P27_P26_REF_CLOSE_INCONSISTENT")
    if abs(oracle["maximumPriorM5ClosePeakHighStressDDPct"]-high["drawdownPct"])>1e-7:
        raise ValueError("P27_P26_REF_HIGH_INCONSISTENT")
    expected=p26["mainS4P25TwoPrintExtra0"]["causalPreviousCloseHighStress"]
    if abs(expected["maximum5MCloseMarkedDDPct"]-worst["drawdownPct"])>1e-7:
        raise ValueError("P27_READ_P26_SOURCE_RESULT_CHANGED")
    for t in (worst,high):
        for k in ("peak","valley"):
            if "time" in t[k]:t[k]["timeUtc"]=iso(t[k]["time"])
    rec={
      "schema":"prism7-p27-source120-remaining-DD-peak-origin-after-capture/v1",
      "mainSourceS4P25Delay":2,
      "mainSourceExitExtraSlippageBps":0,
      "mainSourceRoundtripFeesBps":30,
      "allInitialP22StructuralSetupsPreserved":120,
      "completedReferencePositions":sum(x["sourceStatus"]=="PRICE_PROXY_CLOSED" for x in ledger),
      "rightCensoredMarkedPositions":sum(x["sourceStatus"].startswith("RIGHT_CENSORED") for x in ledger),
      "maxDrawdownM5Close":worst,
      "maxDrawdownCausallyOrderedM5High":high,
      "finalMarkedSourceEquityYen":cash,
      "sourceComparisonsSourceOriginalP25P26ExactNumericParity":True,
      "inputSha256":{
        "p22Events":hashlib.sha256(args.p22_events.read_bytes()).hexdigest(),
        "p25Summary":hashlib.sha256(args.p25_summary.read_bytes()).hexdigest(),
        "p26Summary":hashlib.sha256(args.p26_summary.read_bytes()).hexdigest(),
        "PENGU_M5":rawhash,
      },
      "limitations":[
        "Peak included unexecutable unrealized H1/M5 source price proxy; same as P23/24/26 consistent source accounting.",
        "Legacy source STOP is REFERENCE_STOP72, not pinned native PENGU V20's own phase/STOP.",
        "Worst valley trade may be net profitable even though portfolio drawdown occurred during its holding.",
        "No real book liquidity/signed fills/funding/otherRunner gross/cross margin, and DD21.96 >20.",
        "This known historical period was used to design P25 cross-asset event; cannot call it blind OOS.",
      ],
    }
    args.out_summary.parent.mkdir(parents=True,exist_ok=True)
    args.out_summary.write_text(json.dumps(rec,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf-8")
    args.out_trades.write_text(json.dumps(ledger,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf-8")
    print("PRISM7_P27_SOURCE120_CAUSAL_PEAK_ORIGIN_ATTRIBUTION_PASS")
    print("WORST_P25_CLOSE",json.dumps(worst,ensure_ascii=False))
    print("WORST_P25_HIGH",json.dumps(high,ensure_ascii=False))
    print("PROFITABLE_WORST_VALLEY_TRADE",json.dumps([x for x in ledger if x["id"]==worst["valley"]["id"]],ensure_ascii=False))
if __name__=="__main__":main()
