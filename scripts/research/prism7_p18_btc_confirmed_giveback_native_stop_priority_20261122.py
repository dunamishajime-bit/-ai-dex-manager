#!/usr/bin/env python3
"""PRISM VII P18: prespecified MFE3 profit giveback, BTC corroboration, source-native P14 STOP priority.

P14 entry and exit event-clock proxy are the ONLY baseline, 53 intents
retained. This script never creates a signed fill or touches Production.
"""
from __future__ import annotations
import argparse
import csv
import json
import math
from collections import Counter,defaultdict
from pathlib import Path

from prism7_native53_event_attribution_20261122 import load_csv,load_m5

H=3600000
M5=300000
PIN="1657e173d250ad58f53e62f7bb0a3428fb405496"
RULES=("SOURCE_P14_NATIVE_M5_BASELINE",
       "BTC_CONFIRM_GAIN_LOCK","BTC_STRONG_BOUNCE_LOCK")
FEES=(10,30)
SLIP=(0,10,25)


def load_btc_with_source_exemption(paths,p14cases):
    """Keep raw archived OHLCV unchanged; quarantine ONLY one audited off-trade bar."""
    import gzip
    import hashlib
    candles={}
    hashes={}
    quarantined=[]
    active=[(int(z["model"]["observedEntryTs"])-H,
             int(z["model"]["observedExitBarStartTs"]),z["period"],z["id"])
            for z in p14cases if z["model"]["status"]=="PRICE_PROXY_CLOSED"]
    if len(active)!=52:
        raise ValueError("P18_SOURCE_NATIVE52_ACTIVE_WINDOWS_REQUIRED")
    for file in paths:
        f=Path(file)
        raw=f.read_bytes()
        hashes[f.name]=hashlib.sha256(raw).hexdigest()
        for line in gzip.decompress(raw).decode("utf-8").splitlines():
            if not line.strip():continue
            bar=json.loads(line)
            ts=int(bar[0])
            if ts in candles:
                if candles[ts]!=bar:raise ValueError(f"P18_BTC_DUPLICATE_SOURCE_DISAGREE:{ts}")
                continue
            valid=False
            if len(bar)>=11:
                o,h,l,c=(float(bar[i]) for i in (1,2,3,4))
                vol,buy=float(bar[5]),float(bar[9])
                valid=(0<l<=min(o,c)<=max(o,c)<=h and vol>=0 and 0<=buy<=vol)
            if not valid:
                conflicting=[(period,case) for start,end,period,case in active
                             if start<=ts<end]
                if conflicting:
                    raise ValueError(f"P18_BTC_MALFORMED_OVERLAPS_SOURCE_POSITION:{ts}:{conflicting}")
                if ts!=1757771400000 or f.name!="BTCUSDT-5m-20250801-20250924.jsonl.gz":
                    raise ValueError(f"P18_UNEXPECTED_MALFORMED_BTC_M5:{ts}")
                quarantined.append({"sourceFile":f.name,"sourceSha256":hashes[f.name],
                     "timestamp":ts,"reason":"OHLC_OPEN_ABOVE_HIGH",
                     "activeSourcePositionOverlapCount":0,
                     "priceDataModified":False})
                continue
            candles[ts]=bar
    if len(quarantined)!=1:
        raise ValueError(f"P18_EXPECTED_EXACTLY_ONE_OUT_OF_SCOPE_BAD_BTC_M5:{len(quarantined)}")
    return candles,hashes,quarantined

def positive_sorted(candles,entry,exit_ts):
    return [(t,a) for t,a in sorted(candles.items())
            if entry<=t<exit_ts and float(a[5])>0]

def find_exit(rule,source_p,source_b,entry,original_exit_ts,entry_price,atr_ratio):
    """Signal exclusively after closed M5; execute only next positive bar before P14 native exit."""
    eligible=positive_sorted(source_p,entry,original_exit_ts)
    trailing=[]
    best_gross=0.0
    activated=False
    for i,(t,a) in enumerate(eligible):
        closed=t+M5
        if closed>original_exit_ts:break
        trailing.append((t,a))
        mark=100*(entry_price-float(a[4]))/entry_price
        best_gross=max(best_gross,mark)
        if mark>=3:activated=True
        if not activated or len(trailing)<3:continue
        prev,prior=trailing[-2][1],trailing[-3][1]
        if not (float(a[4])>float(prev[4])>float(prior[4])):continue
        v=sum(float(r[1][5]) for r in trailing[-3:])
        if v<=0:continue
        buy_ratio=sum(float(r[1][9]) for r in trailing[-3:])/v
        if buy_ratio<.60:continue
        giveback=best_gross-mark
        if giveback+1e-10<max(1.0,.75*atr_ratio*100):continue
        if mark<.75:continue
        bt=source_b.get(t)
        past=source_b.get(t-12*M5)
        if not bt or not past or float(bt[5])<=0 or float(past[5])<=0:
            continue
        b_return=float(bt[4])/float(past[4])-1
        if rule=="BTC_CONFIRM_GAIN_LOCK":
            if b_return<.003:continue
        elif rule=="BTC_STRONG_BOUNCE_LOCK":
            if b_return<.005 or len(trailing)<6:continue
            pengu_recent_gain=float(a[4])/float(trailing[-6][1][4])-1
            if pengu_recent_gain<.01:continue
        else:raise ValueError("P18_UNKNOWN_RULE")
        for execution_ts,next_bar in eligible[i+1:]:
            if closed<=execution_ts<original_exit_ts:
                return {
                   "signal_close_ts":closed,
                   "proxy_execution_m5_ts":execution_ts,
                   "execution_price":float(next_bar[1]),
                   "time_to_next_positive_print_minutes":(execution_ts-closed)/60000,
                   "gross_mfe_at_decision_pct":round(best_gross,7),
                   "current_gross_short_gain_pct":round(mark,7),
                   "profit_giveback_pct":round(giveback,7),
                   "positive_m5_triple_taker_buy_ratio":round(buy_ratio,7),
                   "btc_prior_1h_return_pct":round(b_return*100,7),
                   "signal_uses_future_data":False,
                   "source_native_stop_priority_respected":True,
                }
        return None
    return None

def metrics(rows):
    witnessed=[r for r in rows if r["scenario_net_pct"] is not None]
    pnl=[r["scenario_net_pct"] for r in witnessed]
    win=sum(x>0 for x in pnl)
    pos=sum(x for x in pnl if x>0)
    neg=-sum(x for x in pnl if x<0)
    source=[r["original_p14_net_pct"] for r in witnessed]
    original_pos=sum(x for x in source if x>0)
    original_neg=-sum(x for x in source if x<0)
    return {
       "sourceIntents":len(rows),"priceProxyComplete":len(witnessed),
       "unobservedEntryOrExit":len(rows)-len(witnessed),
       "sourceWinnersSameSubset":sum(x>0 for x in source),
       "sourceMeanNetSameSubset":round(sum(source)/len(source),6) if source else None,
       "sourcePfSameSubset":round(original_pos/original_neg,6) if original_neg else None,
       "scenarioWins":win,"scenarioWinrateConditionalPct":round(win/len(pnl)*100,5) if pnl else None,
       "scenarioMeanNetConditionalPct":round(sum(pnl)/len(pnl),6) if pnl else None,
       "scenarioPfConditional":round(pos/neg,6) if neg else None,
       "researchEarlyExits":sum(x["scenario_exit_type"]=="FIRST_NEXT_POSITIVE_M5" for x in rows),
       "sourceWinnersNowLose":sum(r["original_p14_net_pct"]>0 and r["scenario_net_pct"]<=0 for r in witnessed),
       "sourceLosersNowWin":sum(r["original_p14_net_pct"]<=0 and r["scenario_net_pct"]>0 for r in witnessed),
       "sourceWinnerTotalProfitDeltaPct":round(sum(r["scenario_net_pct"]-r["original_p14_net_pct"]
                   for r in witnessed if r["original_p14_net_pct"]>0),6),
       "sourceLoserTotalProfitDeltaPct":round(sum(r["scenario_net_pct"]-r["original_p14_net_pct"]
                   for r in witnessed if r["original_p14_net_pct"]<=0),6),
    }

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--anatomy",type=Path,required=True)
    p.add_argument("--p14events",type=Path,required=True)
    p.add_argument("--m5-pengu",type=Path,nargs="+",required=True)
    p.add_argument("--m5-btc",type=Path,nargs="+",required=True)
    p.add_argument("--out-json",type=Path,required=True)
    p.add_argument("--out-csv",type=Path,required=True)
    a=p.parse_args()
    native_cases=[{"period":x["period"],"id":x["id"],"native":x,
                   "atr_ratio":float(x["H1_asof_source_ATR24"])}
                  for x in load_csv(a.anatomy) if x["route"]=="SHORT_V20"]
    source14=json.loads(a.p14events.read_text(encoding="utf-8"))
    if len(native_cases)!=53 or len(source14)!=53:
        raise ValueError("P18_P14_NATIVE_SOURCE53_MISSING")
    p14by={(x["period"],x["id"]):x for x in source14}
    source_period_alias={"PRE_AUG_SEP_2025":"PRE_2025_AUG_SEP",
                         "POST_OCT_NOV_2026":"POST_2026_OCT_NOV"}
    pengu,phash=load_m5(a.m5_pengu)
    btc,bhash,btc_qa=load_btc_with_source_exemption(a.m5_btc,source14)
    scenario_records=[]
    diag=[]
    for row in native_cases:
        k=(source_period_alias.get(row["period"],row["period"]),row["id"])
        if k not in p14by:raise ValueError("P18_P14_CASE_MISSING:"+str(k))
        s=p14by[k]
        m=s["model"]
        if (s["sourcePin"]!=PIN or
            int(row["native"]["entry_ts"])!=s["sourceEntryTs"] or
            int(row["native"]["exit_ts"])!=s["sourceExitTs"] or
            abs(float(row["native"]["entry_h1_open"])-s["sourceEntryPrice"])>1e-12):
            raise ValueError("P18_PIN_NATIVE_SOURCE_ENTRY_EXIT_PARITY_FAIL:"+str(k))
        if m["status"]=="PRICE_PROXY_CLOSED":
            entry=int(m["observedEntryTs"])
            exit_ts=int(m["observedExitBarStartTs"])
            entry_price=float(m["observedEntryPrice"])
            baseline_exit_price=float(m["observedExitPrice"])
            if exit_ts<=entry:raise ValueError("P18_BAD_P14_EVENT_ORDER")
        elif m["status"]=="NO_ENTRY_POSITIVE_PRINT_IN_H1":
            entry=exit_ts=entry_price=baseline_exit_price=None
        else:
            raise ValueError("P18_UNKNOWN_P14_STATUS:"+m["status"])
        event_by_rule={}
        for rule in RULES:
            if rule==RULES[0] or entry is None:
                event_by_rule[rule]=None
            else:
                event_by_rule[rule]=find_exit(rule,pengu,btc,entry,exit_ts,
                                            entry_price,row["atr_ratio"])
                if event_by_rule[rule] is not None:
                    ev=event_by_rule[rule]
                    if not (entry<=ev["signal_close_ts"]<=ev["proxy_execution_m5_ts"]<exit_ts):
                        raise ValueError("P18_NATIVE_STOP_OR_EXIT_PRIORITY_VIOLATION")
        diag.append({
          "period":k[0],"id":k[1],
          "diagnosticCategory":row["native"]["diagnostic_category"],
          "sourceNativeWin30":s["sourceNativeNet30Pct"]>0,
          "p14ObservedStatus":m["status"],"p14BaselineExitType":m.get("observedExitType"),
          "p14ExitTimeM5Ts":exit_ts,"sourceH1ExitTs":s["sourceExitTs"],
          "triggerByRule":{r:event_by_rule[r] for r in RULES if r!=RULES[0]},
        })
        for rule in RULES:
            event=event_by_rule[rule]
            for fee in FEES:
                for slippage in SLIP:
                    if entry is None:
                        new_net=baseline_net=None
                    else:
                        new_exit=event["execution_price"] if event else baseline_exit_price
                        baseline_net=100*(1-baseline_exit_price/entry_price)-(fee+slippage)/100
                        new_net=100*(1-new_exit/entry_price)-(fee+slippage)/100
                    scenario_records.append({
                      "period":k[0],"id":k[1],"originalSourcePeriod":row["period"],
                      "lossCategory":row["native"]["diagnostic_category"],
                      "sourceNativeWin30":s["sourceNativeNet30Pct"]>0,
                      "sourceNativeNet30Pct":s["sourceNativeNet30Pct"],
                      "sourceEntryTs":s["sourceEntryTs"],
                      "P14ModelStatus":m["status"],
                      "originalP14M5ExitTs":exit_ts,
                      "rule":rule,"feeBps":fee,"additionalExitSlippageBps":slippage,
                      "scenario_exit_type":"FIRST_NEXT_POSITIVE_M5" if event else
                          "P14_SOURCE_NATIVE_BASELINE" if entry is not None else "ENTRY_PRICE_UNOBSERVED",
                      "scenario_signal_close_ts":event["signal_close_ts"] if event else None,
                      "scenario_exit_m5_open_ts":event["proxy_execution_m5_ts"] if event else exit_ts,
                      "scenario_exit_m5_open_price":event["execution_price"] if event else baseline_exit_price,
                      "btc_1h_return_pct_asof_signal":event["btc_prior_1h_return_pct"] if event else None,
                      "MFE3_peak_at_signal_gross_pct":event["gross_mfe_at_decision_pct"] if event else None,
                      "original_p14_net_pct":round(baseline_net,7) if baseline_net is not None else None,
                      "scenario_net_pct":round(new_net,7) if new_net is not None else None,
                      "original_winner_destroyed":baseline_net>0 and new_net<=0 if new_net is not None else None,
                      "original_loser_converted":baseline_net<=0 and new_net>0 if new_net is not None else None,
                      "signedVenueFill":False,"sourceNativeStopPriorityMaintained":True,
                    })
    if len(scenario_records)!=53*len(RULES)*len(FEES)*len(SLIP):
        raise ValueError("P18_954_SCENARIOS_NOT_ALL_PRESENT")
    summary=[]
    for rule in RULES:
        for fee in FEES:
            for slippage in SLIP:
                z=[x for x in scenario_records if x["rule"]==rule and
                     x["feeBps"]==fee and x["additionalExitSlippageBps"]==slippage]
                group=metrics(z)
                group.update({"rule":rule,"feeBps":fee,"additionalExitSlippageBps":slippage})
                summary.append(group)
    base=next(x for x in summary if x["rule"]==RULES[0] and x["feeBps"]==30 and x["additionalExitSlippageBps"]==0)
    if (base["sourceIntents"]!=53 or base["priceProxyComplete"]!=52 or
        base["scenarioWins"]!=29 or abs(base["scenarioMeanNetConditionalPct"]-.858779)>1e-5):
        raise ValueError("P18_BASE_SOURCE_P14_52_PARITY_FAILED")
    result={
       "schema":"prism7-p18-btc-confirm-profit-giveback-native-p14-53eventclock/v1",
       "pinnedRuntimeSha":PIN,
       "baseSourceP14M5EventNativeParity":"PASS_53_INTENTS_52_PRICE_OBSERVED",
       "precommitment":"PRISM7_P18_PRECOMMITTED_BTC_CONFIRMED_PROFIT_GIVEBACK_SOURCE53_20261122.md",
       "naturalShortIntentCount":53,"cases":len(scenario_records),
       "rules":list(RULES),"feesBps":list(FEES),"additionalExitSlippageBps":list(SLIP),
       "resultSummary":summary,
       "btcSourceQualityQuarantinedOutsidePositionWindows":btc_qa,
       "inputSha256":{
          "anatomy":__import__("hashlib").sha256(a.anatomy.read_bytes()).hexdigest(),
          "p14_events":__import__("hashlib").sha256(a.p14events.read_bytes()).hexdigest(),
          "penguM5":phash,"btcM5":bhash,
       },
       "limitations":[
         "All source53 outcomes and 7 giveback case labels already known; no independent OOS.",
         "Source native resident STOP first P14 traded M5 touch strictly preempts research exit.",
         "OHLCV positive M5 open is not executable ASK, venue signed fill or STOP market order gap bound.",
         "All profitability metrics use 52 observable price proxies and retain 1 source intent without entry-print.",
         "Taker buy volume ratio from completed printed M5 and BTC 1h closing reference only; no future data.",
         "Funding, venue queue, book spread, shared risk and portfolio compound DD not evaluated.",
       ],
    }
    a.out_json.parent.mkdir(parents=True,exist_ok=True)
    a.out_json.write_text(json.dumps(result,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf-8")
    with a.out_csv.open("w",encoding="utf-8",newline="") as f:
        w=csv.DictWriter(f,fieldnames=list(scenario_records[0]))
        w.writeheader();w.writerows(scenario_records)
    a.out_json.with_name(a.out_json.stem+"_53_EVENTS.json").write_text(
        json.dumps(diag,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf-8")
    print("PRISM7_P18_NATIVE_STOP_PRIORITY_BTC_GIVEBACK_954_PASS")
    print("RESULTS_30BPS_NO_ADD_SLIP")
    for x in summary:
      if x["feeBps"]==30 and x["additionalExitSlippageBps"]==0:
         print(json.dumps(x,ensure_ascii=False))
    print("OUT",a.out_json,a.out_csv)
if __name__=="__main__":
    main()
