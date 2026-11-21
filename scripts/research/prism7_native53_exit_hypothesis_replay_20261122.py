#!/usr/bin/env python3
"""PRISM VII P7-3: prespecified causal exit-intent experiments (not venue fills).

Each scenario keeps 53 ORIGINAL trades and the native entry. Every exit-intent
is decided on CLOSED, positive-print 5-minute candles; repriced from the FIRST
SUBSEQUENT print open, only before original native exit. Original native EXIT
is unchanged when earlier than the experimental action. Assumptions: no pending
STOP/funding/venue queue resolution; this is NOT Production-complete BT.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
from collections import Counter, defaultdict
from pathlib import Path
from statistics import median

from prism7_native53_event_attribution_20261122 import load_csv, load_m5, qtl

M5=300000
H=3600000
RULES=(
    "CONTROL_FIXED_GIVEBACK",
    "BUY_FLOW_2UP",
    "MICRO_BREAKOUT",
    "ATR_TREND_RECLAIM",
)
COSTS=(10,30)
EXTRA=(0,10,25)


def event_trigger(rule, now, trailing, atr_ratio):
    """Only use known current/earlier CLOSED candles."""
    if len(trailing)<3:return False
    t, p, entry_price, peak = now
    prev1=trailing[-2][1]
    prev2=trailing[-3][1]
    clos=float(p[4])
    total=sum(float(v[1][5]) for v in trailing[-3:])
    if total<=0:return False
    buy=sum(float(v[1][9]) for v in trailing[-3:])/total
    # record MAX favorable close accumulated separately (see state machine)
    curr=100*(entry_price-clos)/entry_price
    fall=peak-curr
    if rule=="CONTROL_FIXED_GIVEBACK":
        return fall>=1.5
    if rule=="BUY_FLOW_2UP":
        return (fall>=max(1.0,0.75*atr_ratio*100)
                and clos>float(prev1[4])>float(prev2[4]) and buy>=.55)
    prior=[x[1] for x in trailing[-13:-1] if x[0]>=t-H]
    if rule=="MICRO_BREAKOUT":
        return (len(prior)>=2 and clos>max(float(x[2]) for x in prior)
                and buy>=.55)
    if rule=="ATR_TREND_RECLAIM":
        if len(prior)<2:return False
        return (fall>=max(1.5,1.5*atr_ratio*100)
                and clos>float(prior[0][4]) and buy>=.55)
    raise ValueError(rule)


def decide(candles, entry_price, atr_ratio, entry_ts, native_exit_ts, rule):
    """Return signal close and next-print-open execution, or None."""
    records=sorted(
        (ts,a) for ts,a in candles.items()
        if entry_ts<=ts<native_exit_ts and float(a[5])>0
    )
    eligible=[]
    peak=0.0
    activated=False
    for i,(ts,a) in enumerate(records):
        closed=ts+M5
        if closed>native_exit_ts:break
        eligible.append((ts,a))
        mark=100*(entry_price-float(a[4]))/entry_price
        peak=max(peak,mark)
        if mark>=3.0:activated=True
        if not activated:continue
        # auxiliary "now" tuple: current start, candle, initial entry price,
        # and historical max favorable CLOSE profit; known at this close.
        ctx=(ts,a,entry_price,peak)
        if not event_trigger(rule,ctx,eligible,atr_ratio):
            continue
        # A confirmed candle's close is observable at t+5m, no earlier.
        for execute_ts, next_a in records[i+1:]:
            if execute_ts>=closed and execute_ts<native_exit_ts:
                return {
                    "signal_close_ts":closed,
                    "execution_print_ts":execute_ts,
                    "execution_proxy_open":float(next_a[1]),
                    "peak_profit_gross_when_signal_pct":round(peak,6),
                    "marked_profit_gross_when_signal_pct":round(mark,6),
                    "next_print_delay_mins":round((execute_ts-closed)/60000,2),
                }
        return None
    return None


def model_trades(anatomy, originals, candles):
    o={(r["period"],r["original_signal_id"]):r for r in originals}
    prefix={"PRE_AUG_SEP_2025":"PRE_2025_AUG_SEP",
            "POST_OCT_NOV_2026":"POST_2026_OCT_NOV"}
    entries=[]
    for a in anatomy:
        if a["route"]!="SHORT_V20":continue
        k=(prefix.get(a["period"],a["period"]),a["id"])
        if k not in o:raise ValueError(f"MISSING_ENTRY_FEATURES:{k}")
        old=o[k]
        if (int(old["original_entryTs"])!=int(a["entry_ts"])
              or int(old["original_native_exitTs"])!=int(a["exit_ts"])):
            raise ValueError(f"DIFFERENT_SOURCE_TIMELINE:{k}")
        a={"native":a,"id":a["id"],"period":a["period"],
           "entry_price":float(a["entry_h1_open"]),
           "atr_ratio":float(json.loads(old["features"])["atr24_ratio"])}
        entries.append(a)
    if len(entries)!=53:raise ValueError(f"SHORT_NOT_53:{len(entries)}")
    return entries


def metrics(rows):
    pnl=[r["ret_net_pct"] for r in rows]
    wins=sum(x>0 for x in pnl)
    pos=sum(x for x in pnl if x>0)
    neg=-sum(x for x in pnl if x<0)
    return {"n":len(rows),"wins":wins,
            "winrate_pct":round(wins/len(rows)*100,3),
            "mean_net_pct":round(sum(pnl)/len(rows),6),
            "profit_factor":round(pos/neg,6) if neg else None,
            "total_equal_notional_net_pct":round(sum(pnl),6)}


def run(anatomy_path, entry_path, m5_paths, out_csv, out_json):
    entries=load_csv(entry_path)
    anatomy=load_csv(anatomy_path)
    candles,sources=load_m5(m5_paths)
    cases=model_trades(anatomy,entries,candles)
    ledger=[]
    for data in cases:
        a=data["native"]
        native_win=float(a["native_net30_pct"])>0
        cat=a["diagnostic_category"]
        origin30=float(a["native_net30_pct"])
        origin10=float(a["native_net10_pct"])
        native_ts=int(a["exit_ts"])
        start=int(a["entry_ts"])
        for rule in ("NATIVE",)+RULES:
            event=decide(candles,data["entry_price"],data["atr_ratio"],start,native_ts,rule) if rule!="NATIVE" else None
            if event is not None and event["execution_print_ts"]>=native_ts:
                raise ValueError("LOOKAHEAD_EXECUTION")
            for cost in COSTS:
                for extra in EXTRA:
                    baseline=origin10 if cost==10 else origin30
                    net=baseline
                    if event is not None:
                        net=100*(data["entry_price"]-event["execution_proxy_open"])/data["entry_price"]
                        net-=(cost+extra)/100.0
                    ledger.append({
                        "period":data["period"],"id":data["id"],"category":cat,
                        "original_win30":native_win,"native_exit_reason":a["native_exit_reason"],
                        "rule":rule,"fee_bps":cost,"additional_slippage_bps":extra,
                        "native_baseline_net_pct":round(baseline,6),
                        "scenario_exit_mode":"FIRST_NEXT_PRINT_OPEN" if event else "ORIGINAL_NATIVE",
                        "signal_close_ts":event["signal_close_ts"] if event else None,
                        "execution_print_ts":event["execution_print_ts"] if event else None,
                        "signal_to_print_delay_minutes":event["next_print_delay_mins"] if event else None,
                        "scenario_exit_price":event["execution_proxy_open"] if event else float(a["exit_model_price"]),
                        "ret_net_pct":round(net,6),
                        "won":net>0,
                        "native_winner_destroyed":native_win and net<=0,
                        "native_loser_converted":not native_win and net>0,
                        "native_winner_profit_delta_pct":round(net-baseline,6) if native_win else None,
                        "source_not_signed_fill":True,
                    })
    expected=53*(len(RULES)+1)*len(COSTS)*len(EXTRA)
    if len(ledger)!=expected:raise ValueError(f"WRONG_CASE_COUNT:{len(ledger)}/{expected}")
    summaries=[]
    for rule in ("NATIVE",)+RULES:
        for fee in COSTS:
            for additional in EXTRA:
                subset=[r for r in ledger if r["rule"]==rule and r["fee_bps"]==fee and r["additional_slippage_bps"]==additional]
                group=metrics(subset)
                group.update({"rule":rule,"fee_bps":fee,"extra_slip_bps":additional,
                    "preempted_native_exits":sum(x["scenario_exit_mode"]=="FIRST_NEXT_PRINT_OPEN" for x in subset),
                    "native_29_winners_destroyed":sum(x["native_winner_destroyed"] for x in subset),
                    "native_24_losers_converted":sum(x["native_loser_converted"] for x in subset),
                    "native_29_winner_total_profit_delta_pct":round(sum(x["native_winner_profit_delta_pct"] for x in subset if x["native_winner_profit_delta_pct"] is not None),6),
                    "retained_original_candidates":53,
                    "natural_short_intents":53})
                summaries.append(group)
    native={x["fee_bps"]:x for x in summaries if x["rule"]=="NATIVE" and x["extra_slip_bps"]==0}
    if native[30]["wins"]!=29 or abs(native[30]["mean_net_pct"]-1.000655)>.00001:
        raise ValueError("NATIVE30_PARITY_FAIL")
    if native[10]["wins"]!=29:
        raise ValueError("NATIVE10_PARITY_FAIL")
    out_json.parent.mkdir(parents=True,exist_ok=True)
    output={
        "schema":"prism7-pengu-v20-precommitted-native53-causal-exit-research/v1",
        "source_short_pin":"1657e173d250ad58f53e62f7bb0a3428fb405496",
        "source_53_native_parity":"PASS",
        "precommitment":"PRISM7_P7_3_PRECOMMITTED_EXIT_HYPOTHESES_20261122.md",
        "n_original_candidate_intents":53,
        "tested_rules":list(RULES),
        "cost_bps":list(COSTS),"additional_slippage_bps":list(EXTRA),
        "results":summaries,
        "m5_source_sha256":sources,
        "limitations":[
            "All 53 periods viewed in prior research; not untouched OOS.",
            "An exit signal from closed M5 with next printed M5 open proxy is NOT a venue fill.",
            "STOP priority intra-bar, funding, native STOP state on early action, order queue, Gross, shared risk, slippage microstructure unresolved.",
            "Price models 10/30bps with additional optional 0/10/25bps exit slippage.",
            "No production parity or portfolio compounding/DD asserted.",
            "No parameters optimized after examining this grid; failed rules retained.",
        ],
    }
    out_json.write_text(json.dumps(output,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf-8")
    with out_csv.open("w",encoding="utf-8",newline="") as f:
        writer=csv.DictWriter(f,fieldnames=list(ledger[0]))
        writer.writeheader()
        writer.writerows(ledger)
    print("P7_3_NATIVE53_EXIT_SCENARIO_PASS",len(ledger),"NATIVE_29_53_PASS")
    print("RESULTS_30BPS_NO_ADDITIONAL_SLIPPAGE")
    for z in summaries:
        if z["fee_bps"]==30 and z["extra_slip_bps"]==0:
            print(json.dumps(z,ensure_ascii=False))
    print("LEDGER",out_csv)
    print("SUMMARY",out_json)


def main():
    parser=argparse.ArgumentParser()
    for a in ("--anatomy","--entries","--out-csv","--out-json"):
        parser.add_argument(a,type=Path,required=True)
    parser.add_argument("--m5",nargs="+",type=Path,required=True)
    a=parser.parse_args()
    run(a.anatomy,a.entries,a.m5,a.out_csv,a.out_json)


if __name__=="__main__":
    main()
