#!/usr/bin/env python3
"""PRISM VII: per-candidate future SHORT opportunities with PERFECT-HINDSIGHT bounds.

This asks whether original bad SHORT entries had downward waves later in their
own source-native holding window. The optimum is an ORACLE upper bound and
must never be used as an as-of trade rule. No orders or native reprice.
"""
from __future__ import annotations
import argparse
import csv
import hashlib
import json
from pathlib import Path
from collections import Counter
from prism7_native53_event_attribution_20261122 import load_csv,load_m5,qtl
H=3600000
M5=300000

def best_downswing(candles,entry,exit):
    """Choose a theoretical best SELL close followed by BUY close at later print."""
    prices=sorted((t,float(a[4])) for t,a in candles.items()
                  if entry<=t and t+M5<=exit and float(a[5])>0)
    if not prices:return {"n_print":0,"best_pct":None,"best_sell_ts":None,"best_buy_ts":None}
    high=-1
    high_ts=None
    best=0.0
    best_ts=(None,None)
    # Strictly later close avoids unknown within-M5 OHLC order.
    for ts,px in prices:
        if high>0:
            profit=100*(high-px)/high
            if profit>best:
                best=profit;best_ts=(high_ts,ts+M5)
        if px>high:
            high=px; high_ts=ts+M5
    return {"n_print":len(prices),"best_pct":round(best,6),
            "best_sell_ts":best_ts[0],"best_buy_ts":best_ts[1],
            "at_least_1pct":best>=1,"at_least_3pct":best>=3,
            "at_least_5pct":best>=5}


def run(anatomy,entries,candles,source_sha,out_csv,out_json):
    original={(r["period"],r["original_signal_id"]):r for r in entries}
    mp={"PRE_AUG_SEP_2025":"PRE_2025_AUG_SEP",
        "POST_OCT_NOV_2026":"POST_2026_OCT_NOV"}
    o=[]
    for r in anatomy:
        if r["route"]!="SHORT_V20":continue
        key=(mp.get(r["period"],r["period"]),r["id"])
        if key not in original:raise ValueError("MISSING_SOURCE:"+str(key))
        orig=original[key]
        if int(orig["original_entryTs"])!=int(r["entry_ts"]) or int(orig["original_native_exitTs"])!=int(r["exit_ts"]):
            raise ValueError("SOURCE_NATIVE_TIMES_CHANGED:"+str(key))
        d=best_downswing(candles,int(r["entry_ts"]),int(r["exit_ts"]))
        o.append({"period":r["period"],"id":r["id"],
            "loss_category":r["diagnostic_category"],
            "original_short_native_net30_pct":round(float(r["native_net30_pct"]),6),
            "original_entry_price":float(r["entry_h1_open"]),
            "native_holding_hours":(int(r["exit_ts"])-int(r["entry_ts"]))/H,
            "original_max_M5_favorable_pct":float(r["total_MFE_pct"]),
            **d})
    counts=Counter(x["loss_category"] for x in o)
    assert len(o)==53 and list(sorted(counts.values()))==[6,7,11,29],(len(o),counts)
    categories={}
    for c in sorted(counts):
        rr=[x for x in o if x["loss_category"]==c]
        categories[c]={
            "n":len(rr),
            "median_oracle_downswing_pct":qtl([x["best_pct"] for x in rr],.5),
            "oracle_close_to_close_ge1pct":sum(x["at_least_1pct"] for x in rr),
            "oracle_close_to_close_ge3pct":sum(x["at_least_3pct"] for x in rr),
            "oracle_close_to_close_ge5pct":sum(x["at_least_5pct"] for x in rr),
            "median_original_source_mfe_pct":qtl([x["original_max_M5_favorable_pct"] for x in rr],.5),
        }
    out={"schema":"prism7-v20-native53-future-downswing-oracle-feasibility/v1",
        "intents":53,"native_win":29,
        "source_pin":"1657e173d250ad58f53e62f7bb0a3428fb405496",
        "source_anatomy_sha256":source_sha,
        "cohorts":categories,
        "warning":[
          "ORACLE ONLY: best sell-then-later-buy chosen with knowledge of whole future path.",
          "Market trajectory from original entry to original native exit, not a new native position/STOP replay.",
          "Printed CLOSE-to-CLOSE profit opportunity is not executable fill probability.",
          "This upper bound is not evidence that any causal strategy can realize or choose the best price.",
          "Even a 3% future downswing may be too small after real costs, queue/STOP, funding and slippage.",
          "Loss category and all source periods already inspected; no untouched OOS or synthetic market.",
        ]}
    out_csv.parent.mkdir(exist_ok=True,parents=True)
    with out_csv.open("w",encoding="utf-8",newline="") as f:
        w=csv.DictWriter(f,fieldnames=list(o[0]));w.writeheader();w.writerows(o)
    out_json.write_text(json.dumps(out,sort_keys=True,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
    print("PRISM7_SHORT53_ORACLE_OPPORTUNITY_PASS 53")
    print(json.dumps(categories,ensure_ascii=False))
    print("OUT",out_csv,out_json)

def main():
    p=argparse.ArgumentParser()
    for k in ("--anatomy","--entries","--out-csv","--out-json"):
        p.add_argument(k,type=Path,required=True)
    p.add_argument("--m5",type=Path,nargs="+",required=True)
    a=p.parse_args()
    candles,sh=load_m5(a.m5)
    run(load_csv(a.anatomy),load_csv(a.entries),candles,
        hashlib.sha256(a.anatomy.read_bytes()).hexdigest(),
        a.out_csv,a.out_json)
if __name__=="__main__":main()
