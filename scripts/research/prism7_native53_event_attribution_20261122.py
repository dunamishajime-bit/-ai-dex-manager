#!/usr/bin/env python3
"""PRISM VII P7-2: Short V20 53 native intent event attribution (diagnostics only).

Events are stamped only after the relevant positive-volume 5-minute bar CLOSES.
No look-ahead, no order, no alleged execution price. Native exits and outcomes
remain unchanged. Source H1/M5 mismatch is explicitly not repaired here.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import math
from collections import Counter, defaultdict
from pathlib import Path
from statistics import median

FIVE_MIN_MS = 300000
CATEGORY = ("NO_FAVORABLE_ONE_PERCENT", "PROFIT_GIVEBACK_AFTER_MFE3",
            "MODEST_FAVORABLE_BUT_NET_LOSS", "WIN_NATIVE_EXIT_PRICE_MODEL")


def load_csv(path):
    with open(path, "r", encoding="utf-8-sig", newline="") as file:
        return list(csv.DictReader(file))


def load_m5(paths):
    """Load only provided printed candles; no fabricated interpolation."""
    found = {}
    source_files = {}
    for path in paths:
        p = Path(path)
        source_files[p.name] = hashlib.sha256(p.read_bytes()).hexdigest()
        with gzip.open(p, "rt", encoding="utf-8") as file:
            for line in file:
                a = json.loads(line)
                ts = int(a[0])
                if ts in found:
                    if found[ts] != a:
                        raise ValueError(f"DUPLICATE_DISAGREE_M5:{ts}:{p.name}")
                else:
                    if len(a) < 11:
                        raise ValueError("M5_FIELDS_MISSING")
                    o,h,l,c = (float(a[i]) for i in (1,2,3,4))
                    vol,taker = float(a[5]),float(a[9])
                    if not (0<l<=min(o,c)<=max(o,c)<=h and vol>=0 and 0<=taker<=vol):
                        raise ValueError(f"INVALID_M5_OHLC_OR_VOLUME:{ts}")
                    found[ts] = a
    return found, source_files


def qtl(v, p):
    v = sorted(x for x in v if x is not None and math.isfinite(x))
    if not v:return None
    z=(len(v)-1)*p
    k=int(z)
    return round(v[k]+(v[min(k+1,len(v)-1)]-v[k])*(z-k),5)


def analyze_one(entry, candles, asof=None):
    """As-of event trace, with optional strict observation cutoff for prefix tests."""
    start = entry["entry_ts"]
    stop = entry["exit_ts"]
    cost = 0.3
    price = entry["entry_price"]
    assert stop>start
    if asof is not None:
        stop = min(stop, asof)
    chosen = [
        (ts,a) for ts,a in candles.items()
        if start <= ts and ts+FIVE_MIN_MS <= stop and float(a[5])>0
    ]
    chosen.sort(key=lambda p:p[0])
    # Event timestamps are close times, not candle start.
    first = {
        "first_close_favorable_1pct":None,
        "first_close_favorable_3pct":None,
        "first_after_3pct_close_below_1pct":None,
        "first_after_3pct_close_net_nonpositive":None,
        "first_close_adverse_1pct":None,
        "first_close_adverse_3pct":None,
    }
    maxf=0
    maxa=0
    first3=False
    n3,n6=0,0
    zero3,zero6=0,0
    taker_first3=[0.,0.]
    for ts,a in chosen:
        lo,hi,close,vol,buy = float(a[3]),float(a[2]),float(a[4]),float(a[5]),float(a[9])
        # Short favorable movement uses LOW; adverse movement uses HIGH.
        maxf=max(maxf,100*(price-lo)/price)
        maxa=max(maxa,100*(hi-price)/price)
        # At this close, the close price is genuinely observable.
        mark=100*(price-close)/price
        time_closed=ts+FIVE_MIN_MS
        def record(k,condition):
            if first[k] is None and condition:
                first[k] = time_closed
        record("first_close_favorable_1pct",mark>=1.0)
        record("first_close_favorable_3pct",mark>=3.0)
        if first["first_close_favorable_3pct"] is not None:
            first3=True
        record("first_after_3pct_close_below_1pct",first3 and mark<1.0)
        record("first_after_3pct_close_net_nonpositive",first3 and mark<=cost)
        record("first_close_adverse_1pct",mark<=-1.0)
        record("first_close_adverse_3pct",mark<=-3.0)
        if time_closed<=start+3*3600000:
            n3+=1
            taker_first3[0]+=buy
            taker_first3[1]+=vol
        if time_closed<=start+6*3600000:n6+=1
    # Number of bins without prints; bounded to the observed time horizon.
    for h in (3,6):
        hrs_stop=min(start+h*3600000,stop)
        if hrs_stop>start:
            expected=(hrs_stop-start)//FIVE_MIN_MS
            observed=n3 if h==3 else n6
            missing=max(0,expected-observed)
            if h==3:zero3=missing
            else:zero6=missing
    result={
        "n_printed_m5_lifetime":len(chosen),
        "maxf_m5_pct":round(maxf,6),
        "maxa_m5_pct":round(maxa,6),
        "n_positive_print_m5_first3":n3,
        "n_no_print_m5_first3":zero3,
        "n_positive_print_m5_first6":n6,
        "n_no_print_m5_first6":zero6,
        "first3_taker_buy_ratio":round(taker_first3[0]/taker_first3[1],6)
            if taker_first3[1] else None,
    }
    result.update(first)
    return result


def run(anatomy_path, entry_path, m5_paths, out_csv, out_json):
    native=[r for r in load_csv(anatomy_path) if r["route"]=="SHORT_V20"]
    orig=[r for r in load_csv(entry_path)]
    if len(native)!=53 or len(orig)!=53:
        raise ValueError(f"SOURCE_COUNT_NOT_53:{len(native)}:{len(orig)}")
    orig_keys={(r["period"],r["original_signal_id"]):r for r in orig}
    if len(orig_keys)!=53:raise ValueError("DUPLICATE_ORIGINAL_ID")
    candle,source_files=load_m5(m5_paths)
    detail=[]
    cases=[]
    for a in native:
        period_map={"PRE_AUG_SEP_2025":"PRE_2025_AUG_SEP",
                    "POST_OCT_NOV_2026":"POST_2026_OCT_NOV"}
        k=(period_map.get(a["period"],a["period"]),a["id"])
        if k not in orig_keys:raise ValueError(f"NO_MATCH_NATIVE:{k}")
        o=orig_keys[k]
        if a["diagnostic_category"] not in CATEGORY:
            raise ValueError(f"UNKNOWN_TAXONOMY:{a['diagnostic_category']}")
        if abs(float(a["native_net30_pct"])-float(o["original_native_net30_pct"]))>1e-5:
            raise ValueError(f"NATIVE_OUTCOME_MISMATCH:{k}")
        if int(a["entry_ts"])!=int(o["original_entryTs"]):
            raise ValueError(f"ENTRY_TS_MISMATCH:{k}")
        if int(a["exit_ts"])!=int(o["original_native_exitTs"]):
            raise ValueError(f"EXIT_TS_MISMATCH:{k}")
        info={
            "period":a["period"],"id":a["id"],"entry_ts":int(a["entry_ts"]),
            "exit_ts":int(a["exit_ts"]),"entry_price":float(a["entry_h1_open"])
        }
        if abs(info["entry_price"]-float(o["original_native_entry_price"]))>1e-9:
            raise ValueError(f"ENTRY_PRICE_MISMATCH:{k}")
        ev=analyze_one(info,candle)
        n_m5=max(1,ev["n_printed_m5_lifetime"])
        row={
            "period":a["period"],"id":a["id"],
            "category":a["diagnostic_category"],
            "win30":int(a["native_win30"]=="True"),
            "native_net30_pct":round(float(a["native_net30_pct"]),6),
            "native_exit_reason":a["native_exit_reason"],
            "entry_ts":info["entry_ts"],"exit_ts":info["exit_ts"],
            "hold_hours":round((info["exit_ts"]-info["entry_ts"])/3600000,3),
            "source_mfe_pct":round(float(a["total_MFE_pct"]),6),
            "source_mae_pct":round(float(a["total_MAE_pct"]),6),
            "m5_mfe_diff_pct":round(ev["maxf_m5_pct"]-float(a["total_MFE_pct"]),6),
            "m5_mae_diff_pct":round(ev["maxa_m5_pct"]-float(a["total_MAE_pct"]),6),
        }
        row.update(ev)
        detail.append(row)
        cases.append((info,ev))
    if Counter(r["category"] for r in detail)!={
            "WIN_NATIVE_EXIT_PRICE_MODEL":29,
            "NO_FAVORABLE_ONE_PERCENT":11,
            "PROFIT_GIVEBACK_AFTER_MFE3":7,
            "MODEST_FAVORABLE_BUT_NET_LOSS":6}:
        raise ValueError("LOSS_FAMILIES_NOT_29_11_7_6")
    summary={}
    for category in CATEGORY:
        subset=[r for r in detail if r["category"]==category]
        def n(k):return sum(x[k] is not None for x in subset)
        def median_gap(a,b):return qtl(
            [(r[b]-r[a])/3600000 for r in subset if r[a] and r[b]],.5)
        summary[category]={
            "n":len(subset),
            "median_original_native_net30_pct":qtl([x["native_net30_pct"] for x in subset],.5),
            "median_native_holding_hours":qtl([x["hold_hours"] for x in subset],.5),
            "median_source_MFE_pct":qtl([x["source_mfe_pct"] for x in subset],.5),
            "median_source_MAE_pct":qtl([x["source_mae_pct"] for x in subset],.5),
            "closed_M5_3pct_confirm_count":n("first_close_favorable_3pct"),
            "closed_M5_3pct_then_net_loss_count":n("first_after_3pct_close_net_nonpositive"),
            "median_hours_from_3pct_close_to_breakeven_loss":
                median_gap("first_close_favorable_3pct","first_after_3pct_close_net_nonpositive"),
            "median_first3_positive_prints":qtl([x["n_positive_print_m5_first3"] for x in subset],.5),
            "median_first3_taker_buy_ratio":qtl(
                [x["first3_taker_buy_ratio"] for x in subset if x["first3_taker_buy_ratio"] is not None],.5),
        }
    source_mfe_err=[abs(x["m5_mfe_diff_pct"]) for x in detail]
    source_mae_err=[abs(x["m5_mae_diff_pct"]) for x in detail]
    output={
        "schema":"prism7-pengu-short53-closed-m5-event-attribution/v1",
        "source_pin":"1657e173d250ad58f53e62f7bb0a3428fb405496",
        "native_intents":len(detail),
        "native_winners":sum(x["win30"] for x in detail),
        "loss_11_7_6_source_parity":True,
        "source_anatomy_sha256":hashlib.sha256(Path(anatomy_path).read_bytes()).hexdigest(),
        "source_entry_sha256":hashlib.sha256(Path(entry_path).read_bytes()).hexdigest(),
        "public_m5_sha256":source_files,
        "all":summary,
        "m5_full_life_vs_anatomy_mfe_max_abs_pct":round(max(source_mfe_err),6),
        "m5_full_life_vs_anatomy_mae_max_abs_pct":round(max(source_mae_err),6),
        "m5_full_life_mfe_diff_gt_0p1pct_count":sum(x>0.1 for x in source_mfe_err),
        "m5_full_life_mae_diff_gt_0p1pct_count":sum(x>0.1 for x in source_mae_err),
        "limits":[
            "Closed M5 event timestamps use ts+5min; all prices are printed public candles, not signed fills.",
            "This is loss attribution only: not a strategy, exit reprice, or economic improvement.",
            "M5 positive-volume candles do not prove execution or fill queue priority.",
            "Native exit remains source H1 while event detection is M5; H1/M5 provider coherence is unresolved.",
            "Intra-bar event ordering cannot be inferred from OHLC.",
            "Zero-trade bars are not proof that a market order would never execute.",
            "All 53 candidates across the three periods were already viewed in prior research.",
            "No threshold was fit, no synthetic market generated, no untouched OOS assessed.",
        ],
    }
    out_csv.parent.mkdir(parents=True,exist_ok=True)
    with out_csv.open("w",encoding="utf-8",newline="") as f:
        w=csv.DictWriter(f,fieldnames=list(detail[0]))
        w.writeheader()
        w.writerows(detail)
    out_json.write_text(json.dumps(output,indent=2,ensure_ascii=False,sort_keys=True)+"\n",encoding="utf-8")
    print("P7_2_EVENT_ATTRIBUTION_PASS 53 29 11/7/6")
    print("SOURCE_DISCREPANCY",max(source_mfe_err),max(source_mae_err))
    print("SUMMARY",out_json)
    print("LEDGER",out_csv)
    print("GROUPS",json.dumps(summary,ensure_ascii=False))


def main():
    p=argparse.ArgumentParser()
    for x in ("--anatomy","--entries","--out-csv","--out-json"):
        p.add_argument(x,required=True,type=Path)
    p.add_argument("--m5",nargs="+",required=True,type=Path)
    a=p.parse_args()
    run(a.anatomy,a.entries,a.m5,a.out_csv,a.out_json)


if __name__=="__main__":
    main()
