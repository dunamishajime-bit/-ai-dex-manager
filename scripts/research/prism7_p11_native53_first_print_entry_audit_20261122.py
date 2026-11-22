#!/usr/bin/env python3
"""PRISM VII P11: source natural ENTRY53 source-H1 vs real positive-print M5 audit.

Never presents source H1 open or first printed M5 open as a signed fill.
Research only. Native 53 entry/EXIT prices and PnL remain unchanged.
"""
from __future__ import annotations
import argparse
import csv
import hashlib
import json
import math
from collections import Counter,defaultdict
from pathlib import Path
from statistics import median
from prism7_native53_event_attribution_20261122 import load_m5,qtl

H=3600000
M5=300000
PIN="1657e173d250ad58f53e62f7bb0a3428fb405496"
THRESHOLDS=(.05,.1,.5,1.)

def bucket(rows):
    if not rows:
        return {"count":0,"wins":0,"losers":0,"first5_print":0,
                "first_hour_any_print":0,"hour_without_trade":0,
                "delayed_first_print":0,"median_print_delay_min":None,
                "median_abs_h1_first_print_price_gap_pct":None}
    has=[x for x in rows if x["first_trade_delay_min"] is not None]
    price=[x["abs_source_h1_vs_first_print_gap_pct"] for x in has]
    return {
       "count":len(rows),
       "wins":sum(x["native_win30"] for x in rows),
       "losers":sum(not x["native_win30"] for x in rows),
       "first5_print":sum(x["has_trade_in_first_m5"] for x in rows),
       "first_hour_any_print":len(has),
       "hour_without_trade":len(rows)-len(has),
       "delayed_first_print":sum(x["first_trade_delay_min"] is not None and
                                  x["first_trade_delay_min"]>0 for x in rows),
       "median_print_delay_min":qtl([x["first_trade_delay_min"] for x in has],.5)
                                  if has else None,
       "median_abs_h1_first_print_price_gap_pct":qtl(price,.5) if price else None,
       "gap_gt_threshold_pct":{
           str(t):sum(x["abs_source_h1_vs_first_print_gap_pct"]>t for x in has)
           for t in THRESHOLDS
       },
    }

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--native53",type=Path,required=True)
    p.add_argument("--m5",nargs="+",type=Path,required=True)
    p.add_argument("--out-csv",type=Path,required=True)
    p.add_argument("--out-summary",type=Path,required=True)
    a=p.parse_args()
    native=json.loads(a.native53.read_text(encoding="utf-8"))
    if len(native)!=53:
        raise ValueError("NATIVE53_LENGTH_INVALID")
    market,sha=load_m5(a.m5)
    keys=set()
    output=[]
    for x in native:
        period=x["period"]
        entry=int(x["entryTs"])
        source_price=float(x["entryPrice"])
        if x["parity"]!="EXACT" or source_price<=0:
            raise ValueError("NATIVE_SOURCE_PARITY_FAIL")
        key=(period,x["id"],entry)
        if key in keys:raise ValueError("DUPLICATE_NATURAL_SOURCE_ENTRY")
        keys.add(key)
        b=[]
        for i in range(12):
            t=entry+i*M5
            z=market.get(t)
            if z is None:
                raise ValueError(f"M5_MISSING_IN_NATIVE_ENTRY_HOUR:{key}:{i}")
            if int(z[0])!=t:
                raise ValueError(f"M5_TIMESTAMP_MISMATCH:{key}:{i}")
            o,hi,lo,cl,v,buy=(float(z[j]) for j in (1,2,3,4,5,9))
            if not (0<lo<=min(o,cl)<=max(o,cl)<=hi and 0<=buy<=v):
                raise ValueError(f"INVALID_SOURCE_M5_OHLC_IN_ENTRY_HOUR:{key}:{i}")
            b.append(z)
        first=next((i for i,z in enumerate(b) if float(z[5])>0),None)
        m5_open=float(b[0][1])
        if first is not None:
            point=b[first]
            first_open=float(point[1])
            first_close=float(point[4])
            gap_pct=100*(first_open/source_price-1)
            absolute=abs(gap_pct)
        else:
            first_open=first_close=gap_pct=absolute=None
        output.append({
          "period":period,"id":x["id"],"entry_ts":entry,
          "native_entry_source_h1_open":source_price,
          "native_net30_pct_unchanged":float(x["net30pct"]),
          "native_win30":int(float(x["net30pct"])>0),
          "native_exit_reason":x["exitReason"],
          "original_source_pin":PIN,
          "has_trade_in_first_m5":int(float(b[0][5])>0),
          "has_trade_during_entry_hour":int(first is not None),
          "positive_m5_bars_in_entry_hour":sum(float(z[5])>0 for z in b),
          "first_trade_delay_min":first*5 if first is not None else None,
          "first_trade_m5_open":first_open,
          "first_trade_m5_close":first_close,
          "first_trade_m5_volume":float(b[first][5]) if first is not None else None,
          "source_h1_minus_first_print_gap_pct":round(gap_pct,7) if gap_pct is not None else None,
          "abs_source_h1_vs_first_print_gap_pct":round(absolute,7) if absolute is not None else None,
          "m5_entry_hour_first_open":m5_open,
          "m5_entry_hour_last_close":float(b[-1][4]),
          "m5_entry_hour_total_volume":sum(float(z[5]) for z in b),
          "price_model_entry_is_signed_fill":False,
          "m5_positive_print_proves_user_order_fill":False,
        })
    if len(output)!=53 or sum(x["native_win30"] for x in output)!=29:
        raise ValueError("ORIGINAL_SHORT53_WIN_PARITY_FAIL")
    per={}
    for period in sorted(set(x["period"] for x in output)):
        per[period]=bucket([x for x in output if x["period"]==period])
    by_win={
      "WIN_SOURCE_MODEL":bucket([x for x in output if x["native_win30"]]),
      "LOSS_SOURCE_MODEL":bucket([x for x in output if not x["native_win30"]]),
    }
    by_reason={
      reason:bucket([x for x in output if x["native_exit_reason"]==reason])
      for reason in sorted(set(x["native_exit_reason"] for x in output))
    }
    summary={
      "schema":"prism7-p11-source-native-short53-M5-initial-positive-print-execution-audit/v1",
      "pinned_runtime_commit":PIN,
      "source_native_short53_count":len(output),
      "source_native_original_win30_count":29,
      "overall":bucket(output),
      "by_period":per,
      "by_original_outcome":by_win,
      "by_source_exit_reason":by_reason,
      "source_sha256":{
         "native53_source_evidence":hashlib.sha256(a.native53.read_bytes()).hexdigest(),
         "M5_archive_sha256":sha,
      },
      "limitations":[
       "H1 source entry price preserved; no entry reprice or native STOP recomputation.",
       "A positive printed M5 bar proves some venue prints, NOT the bot order fill.",
       "First M5 positive print after entryTs is only known in hindsight.",
       "No orderbook/quote, queue, own signed fill, partials, funding or gap-stop execution.",
       "H1 public source price may differ from public M5 source candle open.",
       "No forward untouched OOS, synthetic benchmark, compound portfolio DD or shared risk.",
      ],
    }
    a.out_csv.parent.mkdir(parents=True,exist_ok=True)
    with a.out_csv.open("w",encoding="utf-8",newline="") as f:
        w=csv.DictWriter(f,fieldnames=list(output[0]))
        w.writeheader();w.writerows(output)
    a.out_summary.write_text(json.dumps(summary,indent=2,sort_keys=True,ensure_ascii=False)+"\n",encoding="utf-8")
    print("PRISM7_P11_NATIVE53_FIRST_PRINT_AUDIT_PASS",len(output))
    print(json.dumps(summary["overall"],ensure_ascii=False))
    print("PERIOD",json.dumps(per,ensure_ascii=False))
    print("BY_WIN",json.dumps(by_win,ensure_ascii=False))
    print("OUT",a.out_summary,a.out_csv)

if __name__=="__main__":
    main()
