#!/usr/bin/env python3
"""P24: exact P23 peak/trough reconstruction for S4 (trade-level causes of M5 DD).

Risk attribution only: all native original source trade intents, S4 proxies,
STOP rules, wins/losses and order permissions unchanged.
"""
from __future__ import annotations
import argparse,json,hashlib,datetime
from pathlib import Path
from collections import Counter,defaultdict
from prism7_native53_event_attribution_20261122 import load_m5
START_NAV=10000
M5=300000
DATA_END=1794960000000
FEE_BPS=30
SLIPPAGE_BPS=0
def dtstr(x):return datetime.datetime.fromtimestamp(x/1000,datetime.timezone.utc).isoformat() if x is not None else None
def study(events,m5):
    c=sorted((x for x in events if x["group"]=="S4_SINGLE_SLOT" and (
      x["status"]=="PRICE_PROXY_CLOSED" or (
        x["status"].startswith("RIGHT_CENSORED") and x.get("entryProxyTs") is not None))),
      key=lambda x:x["entryProxyTs"])
    if len(c)!=22 or sum(x["status"]=="PRICE_PROXY_CLOSED" for x in c)!=21:
        raise ValueError("P24_S4_MUST_HAVE_21_CLOSED_1_CENSORED")
    cash=START_NAV
    global_peak={"time":None,"equity":cash,"kind":"REALIZED_START","id":None,"price":None}
    global_dd={"pct":0}
    global_high={"pct":0}
    realized_peak={"time":None,"equity":cash,"kind":"REALIZED_START","id":None}
    realized_dd={"pct":0}
    detail=[]
    last_end=-1
    marks_seen=0
    for x in c:
        eid=x["id"]
        entry=int(x["entryProxyTs"]);p0=float(x["entryProxyPrice"])
        if entry<last_end+M5:raise ValueError("P24_SOURCE_SLOT_OVERLAP")
        is_closed=x["status"]=="PRICE_PROXY_CLOSED"
        exit=int(x["exitProxyTs"]) if is_closed else None
        last_end=exit if is_closed else DATA_END-M5
        begin=cash
        mark=None
        local_peak={"equity":begin,"time":entry,"price":p0}
        local_trough={"equity":begin,"time":entry,"price":p0}
        local_best_gross=-1e9
        local_worst_gross=1e9
        in_flight_best_mfe=0
        high_at_entry=None
        high_at_dd=None
        local_events=0
        positive=0
        stale=0
        max_stale=0
        last_pos_t=None
        worst_global_for_trade={"pct":0}
        peak_before_trade=dict(global_peak)
        for ts in range(entry,(exit if exit is not None else DATA_END-M5)+1,M5):
            bar=m5.get(ts)
            if bar is None:raise ValueError("P24_M5_SOURCE_TIME_GAP:"+str(ts))
            vol=float(bar[5])
            if vol>0:
                positive+=1;stale=0
                mark=float(bar[4]);high=float(bar[2]);low=float(bar[3])
                last_pos_t=ts
                best_gross=100*(1-low/p0)
                worst_gross=100*(1-high/p0)
                local_best_gross=max(local_best_gross,best_gross)
                local_worst_gross=min(local_worst_gross,worst_gross)
                if ts==entry:high_at_entry=high
            else:
                stale+=1;max_stale=max(max_stale,stale)
                high=None
            if mark is None:mark=p0
            v=begin*(1+(p0-mark)/p0-(FEE_BPS+SLIPPAGE_BPS)/10000)
            if ts!=exit:
                local_events+=1;marks_seen+=1
                if v>global_peak["equity"]:
                    global_peak={"time":ts,"equity":v,"kind":"UNREALIZED_M5_CLOSE",
                                  "id":eid,"price":mark,"originalTradeEntryTs":entry}
                if v>local_peak["equity"]:
                    local_peak={"time":ts,"equity":v,"price":mark}
                if v<local_trough["equity"]:
                    local_trough={"time":ts,"equity":v,"price":mark}
                dd=100*(1-v/global_peak["equity"])
                if dd>global_dd["pct"]:
                    global_dd={"pct":dd,"valley":{
                        "time":ts,"id":eid,"equity":v,"markPrice":mark,
                        "sourceEvent":"UNREALIZED_M5_CLOSE"},
                      "peak":dict(global_peak),
                      "peakWasUnrealized":global_peak["kind"]=="UNREALIZED_M5_CLOSE",
                      "crossedTrades":global_peak.get("id")!=eid}
                if dd>worst_global_for_trade["pct"]:
                    worst_global_for_trade={"pct":dd,"time":ts,"beforePeak":dict(global_peak)}
            if high is not None:
                vh=begin*(1+(p0-high)/p0-(FEE_BPS+SLIPPAGE_BPS)/10000)
                hd=100*(1-vh/global_peak["equity"])
                if hd>global_high["pct"]:
                    global_high={"pct":hd,"worst":{
                       "time":ts,"id":eid,"equity":vh,"highPx":high,
                       "entryBarIntrabarOrderUnknown":ts==entry,
                       "isExitBar":ts==exit},
                     "peak":dict(global_peak),
                     "peakWasUnrealized":global_peak["kind"]=="UNREALIZED_M5_CLOSE"}
            if ts==exit:
                exit_price=float(x["exitProxyPrice"])
                cash=begin*(1+(p0-exit_price)/p0-(FEE_BPS+SLIPPAGE_BPS)/10000)
                if cash>global_peak["equity"]:
                    global_peak={"time":ts,"equity":cash,"kind":"REALIZED_EXIT",
                                  "id":eid,"price":exit_price}
                if cash>realized_peak["equity"]:
                    realized_peak={"time":ts,"equity":cash,"kind":"REALIZED_EXIT","id":eid}
                d=100*(1-cash/global_peak["equity"])
                if d>global_dd["pct"]:
                    global_dd={"pct":d,"valley":{"time":ts,"id":eid,"equity":cash,
                         "markPrice":exit_price,"sourceEvent":"REALIZED_EXIT"},
                       "peak":dict(global_peak),
                       "peakWasUnrealized":global_peak["kind"]=="UNREALIZED_M5_CLOSE",
                       "crossedTrades":global_peak.get("id")!=eid}
                dr=100*(1-cash/realized_peak["equity"])
                if dr>realized_dd["pct"]:
                    realized_dd={"pct":dr,"valley":{"time":ts,"id":eid,"equity":cash},
                                 "peak":dict(realized_peak)}
        if not is_closed:
            cash=begin*(1+(p0-mark)/p0-(FEE_BPS+SLIPPAGE_BPS)/10000)
            if cash>global_peak["equity"]:
                global_peak={"time":DATA_END-M5,"equity":cash,
                             "kind":"UNREALIZED_CENSORED_LAST_MARK","id":eid,"price":mark}
        detail.append({
          "id":eid,"route":x["route"],"cohort":x["cohort"],"sourceStatus":x["status"],
          "entryTs":entry,"entryUtc":dtstr(entry),"entryPrice":p0,
          "exitTs":exit,"exitUtc":dtstr(exit),
          "exitReason":x.get("exitReason"),"exitPrice":x.get("exitProxyPrice"),
          "initialEquityAtEntry":begin,"finalEquityOrCensoredMark":cash,
          "referenceNetReturn30BpsPctIfClosed":
              100*(1-float(x["exitProxyPrice"])/p0)-.3 if is_closed else None,
          "maximumPositivePrintGrossMFEFromM5LowPct":local_best_gross,
          "minimumPositivePrintGrossMAEFromM5HighPct":local_worst_gross,
          "tradeLocalBestM5CloseEquity":local_peak,
          "tradeLocalWorstM5CloseEquity":local_trough,
          "portfolioPeakAtTradeStart":peak_before_trade,
          "worstPortfolioMarkDDWithinTrade":worst_global_for_trade,
          "entryBarHigh":high_at_entry,
          "positiveM5Bars":positive,"m5MarksIncludedBeforeExit":local_events,
          "maxStaleConsecutiveNoPrint":max_stale,
          "signedOwnerFillProven":False,
        })
    for d in (global_dd,global_high):
        if "valley" in d:
            d["peak"]["timeUtc"]=dtstr(d["peak"].get("time"))
            d["valley"]["timeUtc"]=dtstr(d["valley"].get("time"))
        if "worst" in d:
            d["peak"]["timeUtc"]=dtstr(d["peak"].get("time"))
            d["worst"]["timeUtc"]=dtstr(d["worst"].get("time"))
    if abs(global_dd["pct"]-35.94150347867552)>1e-7:
        raise ValueError("P24_STRICT_SOURCE_P23_M5_DD_FAIL:"+str(global_dd))
    if abs(global_high["pct"]-37.64670275567175)>1e-7:
        raise ValueError("P24_STRICT_SOURCE_P23_HIGH_DD_FAIL:"+str(global_high))
    if abs(cash-25557.31687)>2e-4:
        raise ValueError("P24_STRICT_SOURCE_P23_FINAL_MARK_FAIL")
    return {
      "allEntryAndExitSourceModelUnchanged":True,
      "sourceOriginalSetups":120,
      "singleSlotCompleted":21,
      "singleSlotCensored1":1,
      "markSequenceCount":marks_seen,
      "finalReferenceMarkedNAVYen":cash,
      "sourceRealizedOnlyDDPct":16.101754,
      "independentRealizedOnlyDDPct":realized_dd,
      "maxM5CloseDD":global_dd,
      "maxM5HighAdverseStressDD":global_high,
      "lastRunningGlobalPeak":global_peak,
      "exposure1xWithoutFundingOrCrossGross":True,
      "limitations":[
       "OHLC and own order events unavailable; M5 high stress can occur before or after entry/STOP inside same bar.",
       "Unrealized running peak may be an intra-position mark that did not realize or remain executable.",
       "All SOURCE S4 P22 outcomes and source H1/M5 have been seen by research; no genuine future OOS.",
       "A 20 percent DD pass cannot be inferred by correcting any single trade after observing its outcome.",
       "Daily shared 7.5 percent loss rule and multi-runner gross capital are not modeled.",
      ]
    },detail
def main():
    p=argparse.ArgumentParser()
    p.add_argument("--p22-events",type=Path,required=True)
    p.add_argument("--p23-source-summary",type=Path,required=True)
    p.add_argument("--pengu-m5",type=Path,nargs="+",required=True)
    p.add_argument("--out-summary",type=Path,required=True)
    p.add_argument("--out-ledger",type=Path,required=True)
    a=p.parse_args()
    ev=[json.loads(x) for x in a.p22_events.read_text(encoding="utf-8").splitlines() if x.strip()]
    original=json.loads(a.p23_source_summary.read_text(encoding="utf-8"))
    p23=next(x for x in original["groups"] if x["group"]=="S4_SINGLE_SLOT" and
             x["feeBps"]==30 and x["exitSlippageBps"]==0)
    m5,sha=load_m5(a.pengu_m5)
    result,ledger=study(ev,m5)
    if abs(result["maxM5CloseDD"]["pct"]-p23["maximumM5CloseMarkToMarketDDPct"])>1e-7:
       raise ValueError("P24_FAILED_P23_REPLAY_MARK")
    if abs(result["maxM5HighAdverseStressDD"]["pct"]-p23["maximumM5HighAdverseEnvelopeDDPct"])>1e-7:
       raise ValueError("P24_FAILED_P23_REPLAY_HIGH")
    result["inputsSha256"]={
      "p22_events":hashlib.sha256(a.p22_events.read_bytes()).hexdigest(),
      "p23_source_summary":hashlib.sha256(a.p23_source_summary.read_bytes()).hexdigest(),
      "marketSource":sha}
    a.out_summary.parent.mkdir(parents=True,exist_ok=True)
    a.out_summary.write_text(json.dumps(result,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf-8")
    a.out_ledger.write_text(json.dumps(ledger,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf-8")
    for key in ("maxM5CloseDD","maxM5HighAdverseStressDD","independentRealizedOnlyDDPct"):
        print("P24_DD_PEAK_TO_VALLEY",key,json.dumps(result[key],ensure_ascii=False))
    print("P24_STRICT_SOURCE_P23_DD_PARITY_PASS",len(ledger),"S4 source price-proxy positions")
if __name__=="__main__":main()
