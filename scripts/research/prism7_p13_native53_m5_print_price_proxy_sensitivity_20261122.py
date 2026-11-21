#!/usr/bin/env python3
"""PRISM VII P13: frozen SOURCE native53 event-time + M5 print-price sensitivity.

NOT a native strategy re-backtest, NOT quote/orderbook/signed fill proof.
Original source ENTRY/EXIT intents and stop levels are unchanged. Paired proxy
only; all 53 intents including no-witness cases stay in every denominator.
"""
from __future__ import annotations
import argparse
import csv
import hashlib
import json
from collections import Counter
from pathlib import Path

from prism7_native53_event_attribution_20261122 import load_m5

PIN="1657e173d250ad58f53e62f7bb0a3428fb405496"
M5=300000
H=3600000
SCENARIOS=("STOP_AT_SOURCE_LEVEL","STOP_GAP_AT_FIRST_PRINT_OPEN")
FEE_BPS=(10,30)
EXTRA_SLIP_BPS=(0,10,25)

def csvrows(p):
    with p.open("r",encoding="utf-8-sig",newline="") as f:
        return list(csv.DictReader(f))

def float_or_none(x):
    return None if x is None or x=="" else float(x)

def first_positive(candles,start,max_bars):
    for k in range(max_bars):
        t=start+k*M5
        if t not in candles:raise ValueError(f"M5_MISSING_WHILE_MONITORING_MARKET_PRINT:{t}")
        row=candles[t]
        if int(row[0])!=t:raise ValueError("SOURCE_M5_BAD_TIME")
        if float(row[5])>0:
            return {
               "time_bar_open":t,"delay_minutes":k*5,
               "price":float(row[1]),"volume":float(row[5]),
               "m5_high":float(row[2]),"m5_low":float(row[3])
            }
    return None

def aggregate(rows):
    valid=[x for x in rows if x["status"]=="PRICE_PROXY_OBSERVED"]
    vals=[x["net_pct"] for x in valid]
    positive=sum(x for x in vals if x>0)
    negative=-sum(x for x in vals if x<0)
    return {
       "sourceIntentCount":len(rows),
       "entryProxyNotWitnessed":sum(x["status"]=="NO_ENTRY_POSITIVE_PRINT_IN_H1" for x in rows),
       "exitProxyNotWitnessed":sum(x["status"]=="NO_EXIT_POSITIVE_PRINT_IN_6H" for x in rows),
       "proxyComplete":len(valid),
       "proxyWinsConditionalOnObserved":sum(x>0 for x in vals),
       "proxyWinRateConditionalPct":round(100*sum(x>0 for x in vals)/len(vals),6) if vals else None,
       "proxyMeanNetConditionalPct":round(sum(vals)/len(vals),8) if vals else None,
       "proxyPricePfConditional":round(positive/negative,8) if negative>0 else None,
       "sourceWinsAllIntents":sum(x["sourceNativeWin30"] for x in rows),
       "sourceWinsAmongProxyComplete":sum(x["sourceNativeWin30"] for x in valid),
       "nativeWinsToProxyLossConditional":sum(x["sourceNativeWin30"] and x["net_pct"]<=0 for x in valid),
       "nativeLossToProxyWinConditional":sum(not x["sourceNativeWin30"] and x["net_pct"]>0 for x in valid),
    }

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--p11-entry-csv",type=Path,required=True)
    p.add_argument("--p12-exit-csv",type=Path,required=True)
    p.add_argument("--m5",type=Path,nargs="+",required=True)
    p.add_argument("--out-csv",type=Path,required=True)
    p.add_argument("--out-json",type=Path,required=True)
    a=p.parse_args()
    e=csvrows(a.p11_entry_csv)
    x=csvrows(a.p12_exit_csv)
    if len(e)!=53 or len(x)!=53:raise ValueError("SOURCE53_INPUT_FILES_LEN_CHANGED")
    paired={(z["period"],z["id"],int(z["entry_ts"])):z for z in x}
    if len(paired)!=53:raise ValueError("P12_SOURCE_NATIVE53_DUPLICATE")
    candles,m5sha=load_m5(a.m5)
    ledger=[]
    noFillKeys=[]
    for src in e:
        k=(src["period"],src["id"],int(src["entry_ts"]))
        if k not in paired:raise ValueError("P11_P12_SOURCE_JOIN_MISSING")
        original=paired[k]
        price=float(src["native_entry_source_h1_open"])
        if (price<=0 or
            original["source_entry_price"]=="" or
            abs(float(original["source_entry_price"])-price)>1e-12 or
            abs(float(original["source_native_net30_pct"])-float(src["native_net30_pct_unchanged"]))>1e-10):
            raise ValueError("NATIVE_SOURCE_PRICE_OR_PNL_NOT_EQUAL")
        hasEntry=int(src["has_trade_during_entry_hour"])==1
        if hasEntry:
            delay=int(src["first_trade_delay_min"])
            entry=first_positive(candles,k[2],12)
            if entry is None or entry["delay_minutes"]!=delay:
                raise ValueError("FIRST_PRINT_ENTRY_NOT_MATCH_P11")
            if abs(entry["price"]-float(src["first_trade_m5_open"]))>1e-12:
                raise ValueError("P11_FIRSTPRINT_ENTRY_PRICE_CHANGED")
        else:
            entry=None
            noFillKeys.append(k)
        exitTS=int(original["source_exit_ts"])
        nativeReason=original["source_exit_reason"]
        isStop=int(original["exit_is_stop"])==1
        if isStop:
            touch=float_or_none(original["first_positive_M5_stop_touch_ts"])
            if touch is None:raise ValueError("P12_STOP_TOUCH_MISSING")
            touch=int(touch)
            if entry and touch<entry["time_bar_open"]:
                raise ValueError("M5_STOP_TOUCH_BEFORE_WITNESSED_ENTRY")
            observed=candles.get(touch)
            if observed is None or not float(observed[5])>0:
                raise ValueError("STOP_TOUCH_WITHOUT_POSITIVE_PRINT")
            stop=float(original["source_stop_price"])
            if float(observed[2])+1e-11<stop:raise ValueError("STOP_PRICE_NOT_TOUCHED")
            exitCandidate={
                "time_bar_open":touch,
                "delay_minutes":(touch-exitTS)/60000,
                "price":stop,
                "stopGapBuyProxy":max(stop,float(observed[1])),
                "firstM5Open":float(observed[1]),
                "positiveM5Volume":float(observed[5]),
                "exitKind":"SOURCE_STOP_TOUCH"
            }
        else:
            observed=first_positive(candles,exitTS,72)
            if observed:
                exitCandidate={
                   "time_bar_open":observed["time_bar_open"],
                   "delay_minutes":observed["delay_minutes"],
                   "price":observed["price"],
                   "stopGapBuyProxy":None,
                   "firstM5Open":observed["price"],
                   "positiveM5Volume":observed["volume"],
                   "exitKind":"SOURCE_OTHER_EXIT_FIRST_PRINT"
                }
            else:
                exitCandidate=None
        for mode in SCENARIOS:
            for fee in FEE_BPS:
                for slip in EXTRA_SLIP_BPS:
                    if entry is None:status="NO_ENTRY_POSITIVE_PRINT_IN_H1"
                    elif exitCandidate is None:status="NO_EXIT_POSITIVE_PRINT_IN_6H"
                    else:status="PRICE_PROXY_OBSERVED"
                    if status=="PRICE_PROXY_OBSERVED":
                        execExit=exitCandidate["stopGapBuyProxy"] if isStop and mode=="STOP_GAP_AT_FIRST_PRINT_OPEN" else exitCandidate["price"]
                        net=100*(entry["price"]-execExit)/entry["price"] -fee/100-slip/100
                    else:
                        execExit=net=None
                    row={
                      "period":k[0],"id":k[1],"entryTs":k[2],
                      "sourceRoute":"SHORT_V20","pinnedRuntimeSha":PIN,
                      "sourceNativeNet30Pct":float(src["native_net30_pct_unchanged"]),
                      "sourceNativeWin30":int(src["native_win30"]),
                      "sourceNativeEntryH1Price":price,
                      "sourceExitReason":nativeReason,"sourceExitTs":exitTS,
                      "sourceExitPrice":float(original["source_exit_price"]),
                      "sourceExitIsStop":int(isStop),
                      "priceScenario":mode,"feeBps":fee,"additionalExitSlippageBps":slip,
                      "status":status,
                      "entryWitnessM5OpenTs":entry["time_bar_open"] if entry else None,
                      "entryWitnessDelayMin":entry["delay_minutes"] if entry else None,
                      "entryWitnessTradeOpen":entry["price"] if entry else None,
                      "exitWitnessM5OpenTs":exitCandidate["time_bar_open"] if exitCandidate else None,
                      "exitWitnessDelayFromSourceExitMin":exitCandidate["delay_minutes"] if exitCandidate else None,
                      "exitWitnessPositiveVolume":exitCandidate["positiveM5Volume"] if exitCandidate else None,
                      "exitExecutionPriceProxy":execExit,
                      "grossReturnPct":100*(entry["price"]-execExit)/entry["price"] if execExit is not None else None,
                      "net_pct":round(net,8) if net is not None else None,
                      "proxyNotSignedOwnerFill":True,
                      "fullNativeDynamicStopReplayedWithProxyEntry":False,
                    }
                    ledger.append(row)
    if len(ledger)!=53*2*2*3:
        raise ValueError("SOURCE53_SCENARIOS_NOT_COMPLETE")
    groups=[]
    for mode in SCENARIOS:
        for fee in FEE_BPS:
            for slip in EXTRA_SLIP_BPS:
                subset=[z for z in ledger if z["priceScenario"]==mode and
                  z["feeBps"]==fee and z["additionalExitSlippageBps"]==slip]
                if len(subset)!=53:raise ValueError("SCENARIO_SOURCE53_SHORT_INTENTS_CHANGED")
                groups.append({"scenario":mode,"feeBps":fee,"additionalExitSlippageBps":slip,
                               **aggregate(subset)})
    group0=[z for z in ledger if z["priceScenario"]==SCENARIOS[0] and
       z["feeBps"]==30 and z["additionalExitSlippageBps"]==0]
    origWins=sum(x["sourceNativeWin30"] for x in group0)
    if origWins!=29:raise ValueError("SOURCE29_WIN_CHANGED")
    report={
       "schema":"prism7-p13-53-source-intents-M5-print-timed-entry-exit-proxy/v1",
       "pinnedRuntimeSha":PIN,
       "naturalSource53Intents":53,
       "sourceModelWins30":29,
       "sourceModelMean30Pct":round(sum(x["sourceNativeNet30Pct"] for x in group0)/53,8),
       "sourceEntryNotWitnessedCaseIds":[{"period":k[0],"id":k[1],"entryTs":k[2]} for k in noFillKeys],
       "summary":groups,
       "totalRows":len(ledger),
       "inputSha256":{
          "P11_entry":hashlib.sha256(a.p11_entry_csv.read_bytes()).hexdigest(),
          "P12_exit":hashlib.sha256(a.p12_exit_csv.read_bytes()).hexdigest(),
          "M5_public_source_archives":m5sha,
       },
       "limitations":[
           "SOURCE native exit intents and STOP prices are frozen, not recalculated after proxy entry price/time.",
           "First positive M5 trade OPEN is not bot orderbook bid/ask nor signed fill; any apparent winrate is conditional on witnessed print.",
           "No filled trade for source intent without positive print in first entry H1; excluded from conditional profit but counted in all 53 intents.",
           "SOURCE STOP positive M5 high touch does not prove fill at stop price; gap-open scenario is not worst-case bound.",
           "A market order requires opposing liquidity, which OHLCV bars cannot establish.",
           "Stop touch M5 open timestamp is only start of the 5m period; actual price touch within bar may occur later.",
           "No funding, quote/slippage model, source strategy position-state repricing, concurrent gross, portfolio DD or blind future OOS.",
       ],
    }
    a.out_csv.parent.mkdir(parents=True,exist_ok=True)
    with a.out_csv.open("w",encoding="utf-8",newline="") as f:
        w=csv.DictWriter(f,fieldnames=list(ledger[0]))
        w.writeheader();w.writerows(ledger)
    a.out_json.write_text(json.dumps(report,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf-8")
    print("PRISM7_P13_53_SOURCE_INTENTS_PRICE_PROXY_PASS",len(ledger))
    for g in groups:print(json.dumps(g,ensure_ascii=False))
    print("OUT",a.out_json,a.out_csv)

if __name__=="__main__":
    main()
