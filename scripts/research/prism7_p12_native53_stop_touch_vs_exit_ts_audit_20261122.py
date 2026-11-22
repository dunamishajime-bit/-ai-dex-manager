#!/usr/bin/env python3
"""PRISM VII P12: immutable SOURCE SHORT V20 native53 STOP touch/M5 price prints.

Research-only M5 chronology for source STOP decision H1 and nonresident NEXT
H1. Do not alter native positions, source PnL, stop prices, or actual orders.
"""
from __future__ import annotations
import argparse
import csv
import gzip
import hashlib
import json
from collections import Counter,defaultdict
from pathlib import Path
from statistics import median
from prism7_native53_event_attribution_20261122 import load_m5,qtl

H=3600000
M5=300000
PIN="1657e173d250ad58f53e62f7bb0a3428fb405496"
STOPS={"SHORT_HARD_STOP","SHORT_TRAILING_STOP"}
OTHER={"SHORT_MAX_HOLD","SHORT_V20_DEADLINE_EXIT"}

def read_native(path):
    rows=[]
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        if line.strip():rows.append(json.loads(line))
    return rows

def load_h1(paths):
    source={}
    sh={}
    for p in paths:
        p=Path(p)
        sh[p.name]=hashlib.sha256(p.read_bytes()).hexdigest()
        with gzip.open(p,"rt",encoding="utf-8") as f:
            for line in f:
                r=json.loads(line)
                t=int(r[0])
                if t in source:raise ValueError(f"DUPLICATE_SOURCE_H1:{t}")
                o,hi,lo,c,v=(float(r[i]) for i in (1,2,3,4,5))
                if not (0<lo<=min(o,c)<=max(o,c)<=hi and v>=0):
                    # The exact SOURCE PENGU H1 is known to have open mismatch
                    # with M5 in some hours; H1 own OHLC must be internally valid.
                    raise ValueError(f"INVALID_H1_SOURCE_CANDLE:{t}")
                source[t]=r
    return source,sh

def checked_m5_hour(candles,t):
    rows=[]
    for n in range(12):
        ts=t+n*M5
        z=candles.get(ts)
        if z is None:raise ValueError(f"MISSING_M5_IN_NATIVE_DECISION_OR_EXIT_HOUR:{ts}")
        if int(z[0])!=ts:raise ValueError(f"BAD_M5_TS:{ts}")
        o,hi,lo,cl,v,buy=(float(z[i]) for i in (1,2,3,4,5,9))
        if not (0<lo<=min(o,cl)<=max(o,cl)<=hi and 0<=buy<=v):
            raise ValueError(f"INVALID_NATIVE_M5_PRICE_DATA:{ts}")
        rows.append(z)
    return rows

def agg(rows):
    return {
        "count":len(rows),
        "native_wins":sum(x["native_win30"] for x in rows),
        "stops":sum(x["exit_is_stop"] for x in rows),
        "stop_trade_touch_yes":sum(x["exit_is_stop"] and x["decision_h1_M5_positive_stop_touch"] for x in rows),
        "stop_trade_touch_no":sum(x["exit_is_stop"] and not x["decision_h1_M5_positive_stop_touch"] for x in rows),
        "nonstop_next_h1_immediate_trade":sum(not x["exit_is_stop"] and x["next_h1_first_m5_has_trade"] for x in rows),
        "nonstop_next_h1_later_trade":sum(not x["exit_is_stop"] and x["next_h1_print_delay_min"] is not None and x["next_h1_print_delay_min"]>0 for x in rows),
        "nonstop_next_h1_no_trade":sum(not x["exit_is_stop"] and x["next_h1_print_delay_min"] is None for x in rows),
    }

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--native53",type=Path,required=True)
    p.add_argument("--raw-native-jsonl",nargs=3,type=Path,required=True)
    p.add_argument("--pengu-m5",nargs="+",type=Path,required=True)
    p.add_argument("--pengu-h1",nargs="+",type=Path,required=True)
    p.add_argument("--out-csv",type=Path,required=True)
    p.add_argument("--out-summary",type=Path,required=True)
    a=p.parse_args()
    orig=json.loads(a.native53.read_text(encoding="utf-8"))
    if len(orig)!=53:raise ValueError("SOURCE53_NOT_53")
    tape={}
    rawSha={}
    for period,path in zip(("PRE_2025_AUG_SEP","BASE_2025_2026","POST_2026_OCT_NOV"),a.raw_native_jsonl):
        rawSha[period]=hashlib.sha256(path.read_bytes()).hexdigest()
        for raw in read_native(path):
            if raw.get("route")!="SHORT_V20":continue
            key=(period,raw["id"],int(raw["entryTs"]))
            if key in tape:raise ValueError("NATIVE_RAW_DUPLICATE:"+str(key))
            tape[key]=raw
    if len(tape)!=53:raise ValueError("RAW_NATIVE53_NOT_53")
    m5,m5sha=load_m5(a.pengu_m5)
    h1,h1sha=load_h1(a.pengu_h1)
    results=[]
    for x in orig:
        key=(x["period"],x["id"],int(x["entryTs"]))
        if key not in tape:raise ValueError("MISSING_REAL_SOURCE_RAW:"+str(key))
        r=tape[key]
        if (r["sourceRuntimeSha"]!=PIN or x["parity"]!="EXACT" or
            int(r["exitTs"])!=int(x["exitTs"]) or
            r["exitReason"]!=x["exitReason"] or
            abs(float(r["entryPrice"])-float(x["entryPrice"]))>1e-12 or
            abs(float(r["exitPrice"])-float(x["exitPrice"]))>1e-12):
            raise ValueError("SOURCE_NATIVE53_PARITY_CHANGED:"+str(key))
        decision=int(r["decisionReferenceTs"])
        exitTs=int(x["exitTs"])
        if exitTs-decision!=H or decision%H:
            raise ValueError("NATIVE_STOP_DECISION_EXIT_TIMING_CHANGED:"+str(key))
        if decision not in h1:raise ValueError("MISSING_SOURCE_DECISION_H1:"+str(key))
        sourceH1=h1[decision]
        if int(sourceH1[0])!=decision:raise ValueError("H1_DECISION_TIME_BAD")
        reason=x["exitReason"]
        isStop=reason in STOPS
        if not isStop and reason not in OTHER:
            raise ValueError("UNEXPECTED_SOURCE_EXIT_REASON:"+reason)
        decisionM5=checked_m5_hour(m5,decision)
        exitM5=checked_m5_hour(m5,exitTs)
        stopPrice=float(x["exitPrice"]) if isStop else None
        sourceHigh=float(sourceH1[2])
        if isStop and sourceHigh+1e-11<stopPrice:
            raise ValueError("SOURCE_H1_PRICE_DID_NOT_MEET_NATIVE_STOP:"+str(key))
        touched=None
        if isStop:
            touched=next((i for i,z in enumerate(decisionM5)
                          if float(z[5])>0 and float(z[2])+1e-11>=stopPrice),None)
        firstExitPrint=None
        if not isStop:
            firstExitPrint=next((i for i,z in enumerate(exitM5)
                                 if float(z[5])>0),None)
        if firstExitPrint is not None:
            nextPrintOpen=float(exitM5[firstExitPrint][1])
            nextGapPct=round(100*(nextPrintOpen/float(x["exitPrice"])-1),8)
        else:
            nextPrintOpen=nextGapPct=None
        results.append({
           "period":key[0],"id":key[1],
           "entry_ts":key[2],"decision_reference_ts":decision,
           "source_exit_ts":exitTs,
           "source_exit_reason":reason,
           "source_exit_price":float(x["exitPrice"]),
           "source_entry_price":float(x["entryPrice"]),
           "source_native_net30_pct":float(x["net30pct"]),
           "native_win30":int(x["net30pct"]>0),
           "exit_is_stop":int(isStop),
           "source_decision_H1_high":sourceHigh,
           "source_decision_H1_volume":float(sourceH1[5]),
           "source_stop_price":stopPrice,
           "decision_h1_M5_positive_stop_touch":int(touched is not None),
           "first_positive_M5_stop_touch_ts":decision+touched*M5 if touched is not None else None,
           "first_stop_touch_minutes_after_decision_h1_start":touched*5 if touched is not None else None,
           "first_stop_touch_to_source_exitTs_min":round((exitTs-decision-touched*M5)/60000,5) if touched is not None else None,
           "decision_h1_M5_positive_bars":sum(float(z[5])>0 for z in decisionM5),
           "decision_h1_M5_max_positive_high":max((float(z[2]) for z in decisionM5 if float(z[5])>0),default=None),
           "next_h1_first_m5_has_trade":int(float(exitM5[0][5])>0) if not isStop else None,
           "next_h1_print_delay_min":firstExitPrint*5 if firstExitPrint is not None else None,
           "next_h1_first_positive_trade_open":nextPrintOpen,
           "source_exit_price_vs_next_first_print_open_pct":nextGapPct,
           "native_exit_is_signed_fill":False,
           "positive_print_touch_proves_owner_stop_fill":False,
        })
    if len(results)!=53 or sum(x["native_win30"] for x in results)!=29:
        raise ValueError("SOURCE53_RESULTS_LOST")
    stats={key:agg([x for x in results if x["source_exit_reason"]==key]) for key in sorted(STOPS|OTHER)}
    stopTouch=[x["first_stop_touch_to_source_exitTs_min"] for x in results if x["exit_is_stop"] and x["first_stop_touch_to_source_exitTs_min"] is not None]
    summary={
       "schema":"prism7-p12-native-short-v20-source53-stop-positive-print-touch-timing/v1",
       "source_fixed_pinned_sha":PIN,
       "natural_source_short_count":53,
       "native_source_winners":29,
       "overall":agg(results),
       "by_reason":stats,
       "by_period":{
         period:agg([x for x in results if x["period"]==period])
         for period in sorted({x["period"] for x in results})
       },
       "stop_print_touch_source_exit_latency_minutes":{
          "n":len(stopTouch),
          "median":qtl(stopTouch,.5) if stopTouch else None,
          "minimum":min(stopTouch) if stopTouch else None,
          "maximum":max(stopTouch) if stopTouch else None,
       },
       "source_sha256":{
           "raw_native_exit_tape":rawSha,
           "original_53_source_cases":hashlib.sha256(a.native53.read_bytes()).hexdigest(),
           "PENGU_M5_archives":m5sha,
           "PENGU_H1_archives":h1sha,
       },
       "limitations":[
          "STOP touch uses M5 HIGH in native decision H1 only; no bid/ask or signed order fill.",
          "Native STOP timestamp is decisionH1+60min, not verified real order execution time.",
          "Positive M5 trade could print at a price above STOP; actual fill price may be worse.",
          "Source H1 high and M5 public archive may differ; touched is not fill-proven.",
          "Nonresident exit H1 first M5 open is observable only after its print; no auto-fill at hour boundary.",
          "Original native ENTRY/STOP parameters, win count and economic PnL are intentionally unchanged.",
          "Funding/price impact/orderbook/shared risk/portfolio DD and unseen OOS not evaluated.",
       ]
    }
    a.out_csv.parent.mkdir(parents=True,exist_ok=True)
    with a.out_csv.open("w",encoding="utf-8",newline="") as f:
        w=csv.DictWriter(f,fieldnames=list(results[0]))
        w.writeheader();w.writerows(results)
    a.out_summary.write_text(json.dumps(summary,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf-8")
    print("PRISM7_P12_NATIVE53_EXIT_M5_TOUCH_AUDIT_PASS",len(results))
    print("OVERALL",json.dumps(summary["overall"],ensure_ascii=False))
    print("REASONS",json.dumps(stats,ensure_ascii=False))
    print("LATENCY",json.dumps(summary["stop_print_touch_source_exit_latency_minutes"],ensure_ascii=False))
    print("OUT",a.out_summary,a.out_csv)

if __name__=="__main__":
    main()
