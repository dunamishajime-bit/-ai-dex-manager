"""Compare alternate V12 entry routes on actual Aster H1, after adopting Score1.0/Vol0.8.

Causal pre-WinRate decision scan; past-only BTC fast regime feature. Report
24h next-bar directional price proxies separately from executable/portfolio BT.
Each scenario recomputes Top3 and 46h per-symbol episode isolation.
"""
from __future__ import annotations
import argparse
from collections import Counter,defaultdict
from datetime import datetime,timezone,timedelta,date
import json,math
from pathlib import Path
from .v12_score_gate_audit import read_rows,market_maps,HOUR,H2,utc_day,day_streak

SCORE=1.0; VOLUME=.80; COST=.003
# These are individual one-change-at-a-time diagnostics, not production recommendations.
VARIANTS={
    "ADOPTED_FROZEN_ALTS":{},
    "STRONG_MIN_SCORE_0P35":{"strong_min":.35},
    "STRONG_MIN_SCORE_0P50":{"strong_min":.50},
    "STRONG_FAST_BTC12H_ALIGNMENT":{"strong_fast":True},
    "STRONG_SCORE_0P35_AND_FAST_BTC":{"strong_min":.35,"strong_fast":True},
    "RELAXED_MIN_SCORE_0P15":{"relaxed_min":.15},
    "RELAXED_MIN_SCORE_0P35":{"relaxed_min":.35},
    "RELAXED_MIN_SCORE_0P50":{"relaxed_min":.50},
    "RELAXED_FAST_BTC12H_ALIGNMENT":{"relaxed_fast":True},
    "BOTH_ALTS_FAST_BTC12H_ALIGNMENT":{"strong_fast":True,"relaxed_fast":True},
    "STRONG_GAP_0P85_WITH_FAST_BTC":{"strong_gap":.85,"strong_fast":True},
}
def classify(candidate,regime,btc_distance,close,btc_fast_signed,variant):
    # Match baseline frozen source gates and Score1.0/Volume0.8, in exactly
    # the original evaluation order. Missing data must not become a free pass.
    try:
        score=float(candidate["score"]); volume=float(candidate["volumeRatio"])
        mom=float(candidate["momentum"]); atr=float(candidate["atr"])
        side=candidate["side"]
    except (ValueError,KeyError,TypeError):
        return "REJECT_MISSING_FEATURE"
    if not all(map(math.isfinite,[score,volume,mom,atr,close,btc_distance])):
        return "REJECT_MISSING_FEATURE"
    if volume < VOLUME: return "REJECT_VOLUME"
    if abs(mom)<6.0879*.001: return "REJECT_EDGE"
    if abs(mom)<.0227: return "REJECT_MOMENTUM"
    if regime not in ("LONG","SHORT","NEUTRAL"): return "REJECT_REGIME_MISSING"
    if regime=="LONG" and side!="LONG" or regime=="SHORT" and side!="SHORT":
        return "REJECT_DIRECTION"
    if regime=="NEUTRAL":
        return "NORMAL" if score>=SCORE else "REJECT_NEUTRAL_SCORE"
    if score>=SCORE: return "NORMAL"
    is_strong=(regime=="LONG" and btc_distance>=.0359 or regime=="SHORT" and btc_distance<=-.0359)
    atr_ratio=atr/close
    if is_strong:
        strong_min=variant.get("strong_min",.15)
        strong_max=.70
        gap=variant.get("strong_gap")
        in_band=strong_min<=score<=strong_max
        if gap is not None and gap<=score<SCORE:
            in_band=True
        if not in_band or atr_ratio<.014: return "REJECT_STRONG_QUALITY"
        if variant.get("strong_fast") and (not math.isfinite(btc_fast_signed) or btc_fast_signed<0):
            return "REJECT_STRONG_FAST_BTC"
        return "STRONG_ALT" if score<=.70 else "STRONG_GAP"
    aligned=mom if side=="LONG" else -mom
    if aligned<.054 or atr_ratio<.014: return "REJECT_RELAXED_MOMENTUM_ATR"
    if score<variant.get("relaxed_min",0):
        return "REJECT_RELAXED_SCORE"
    if variant.get("relaxed_fast") and (not math.isfinite(btc_fast_signed) or btc_fast_signed<0):
        return "REJECT_RELAXED_FAST_BTC"
    return "RELAXED_ALT"

def aggregate(outcomes):
    returns=[o["net24h"] for o in outcomes if o.get("net24h") is not None]
    gains=sum(x for x in returns if x>0)
    losses=-sum(x for x in returns if x<0)
    return {"observations":len(outcomes),"valid_forward_24h":len(returns),
            "average_net_24h_proxy":sum(returns)/len(returns) if returns else None,
            "positive_share_24h":sum(x>0 for x in returns)/len(returns) if returns else None,
            "sum_positive_returns":gains,"sum_abs_negative_returns":losses,
            "proxy_profit_factor":gains/losses if losses>0 else None}

def run(root,scan,start,end,output):
    root=Path(root); raw=list(read_rows(Path(scan)/"decisions/V12.jsonl"))
    syms=sorted(set(r["symbol"] for r in raw))
    close_by_sym,_,dist=market_maps(root,syms)
    h1_open_by_sym={}
    for s in syms:
        h1_open_by_sym[s]={int(r["event_time_ms"]):float(r["open"])
             for r in read_rows(root/"normalized/aster/klines"/(s+".jsonl"))}
    btc=close_by_sym["BTCUSDT"]
    events=defaultdict(list)
    for r in raw:
        ts=int(r.get("reference_ts_ms") or r["decision_ts_ms"])
        events[ts].append(r)
    start_date=date.fromisoformat(start)
    end_date=date.fromisoformat(end)
    days=[(start_date+timedelta(days=i)).isoformat()
          for i in range((end_date-start_date).days)]
    holdout_start=(end_date-timedelta(days=92)).isoformat()
    results={"source":"ASTER_EXACT_FROZEN_V12_SCAN","period":[start,end],
             "adopted_normal_gate":{"score":SCORE,"volume":VOLUME},
             "cost_roundtrip_assumed":COST,
             "outcome_warning":"NON_EXECUTABLE_NEXT_H2_OPEN_TO_24H_CLOSE_PROXY; NO STOP/TP/TRAIL/GROSS/FUNDING/WR OR INTEGRATED DD",
             "recent_is_not_independent_from_existing_1Y_WHEN_OVERLAPPING":True,
             "variants":{}}
    selected_by_case={}
    for name,variant in VARIANTS.items():
        rejects=Counter();before_rank=Counter();selected=Counter()
        timestamps_by_day=Counter();chosen_rows=[]
        for ts,rows in sorted(events.items()):
            if ts not in dist:continue
            regime=rows[0].get("btc_regime")
            eligible=[]
            for row in rows:
                c=row.get("candidate")
                if not c:continue
                sym=row["symbol"]
                price=close_by_sym.get(sym,{}).get(ts)
                if price is None:
                    rejects["REJECT_MISSING_CLOSE"]+=1;continue
                signed=1 if c.get("side")=="LONG" else -1
                previous_btc=btc.get(ts-6*H2)
                fast=signed*(btc[ts]/previous_btc-1) if previous_btc and ts in btc else float("nan")
                route=classify(c,regime,dist[ts],price,fast,variant)
                if route.startswith("REJECT"):
                    rejects[route]+=1;continue
                before_rank[route]+=1
                eligible.append((float(c["score"]),sym,c["side"],route))
            eligible.sort(key=lambda x:(-x[0],x[1]))
            top=eligible[:2]
            third=next((e for e in eligible[2:] if e[0]>=.70),None)
            if third:top.append(third)
            for rank,(_,sym,side,route) in enumerate(top,1):
                selected[route]+=1
                timestamps_by_day[utc_day(ts)]+=1
                entry=h1_open_by_sym[sym].get(ts)
                future=close_by_sym[sym].get(ts+24*HOUR)
                net=None
                if entry is not None and entry>0 and future is not None:
                    net=(future/entry-1)*(1 if side=="LONG" else -1)-COST
                chosen_rows.append({"ts":ts,"symbol":sym,"side":side,"route":route,
                                    "rank":rank,"net24h":net})
        # 46-hour per-symbol quarantine for independent episode proxy.
        independent=[];last={}
        for item in chosen_rows:
            sym=item["symbol"];t=item["ts"]
            if sym in last and t-last[sym]<46*HOUR:continue
            last[sym]=t;independent.append(item)
        route_stats={}
        for route in ("NORMAL","STRONG_ALT","RELAXED_ALT","STRONG_GAP"):
            all_r=[o for o in chosen_rows if o["route"]==route]
            all_i=[o for o in independent if o["route"]==route]
            final92=[o for o in all_i if utc_day(o["ts"])>=holdout_start]
            route_stats[route]={"repeated_selected":len(all_r),
                "independent_46h":aggregate(all_i),
                "final92d_independent_46h":aggregate(final92)}
        chosen_set={(r["ts"],r["symbol"],r["side"]) for r in chosen_rows}
        selected_by_case[name]=chosen_set
        d={"variant":variant,"raw_gate_passes_by_route":dict(before_rank),
          "rejected_raw_by_reason":dict(rejects),
          "selected_by_route":dict(selected),
          "repeated_top3_selected":len(chosen_rows),
          "signal_days":sum(timestamps_by_day[day]>0 for day in days),
          "no_signal_days":sum(timestamps_by_day[day]==0 for day in days),
          "longest_zero_day_streak":day_streak(days,timestamps_by_day)[0],
          "independent_46h_total":aggregate(independent),
          "final92d_independent_46h_total":aggregate(
              [o for o in independent if utc_day(o["ts"])>=holdout_start]),
          "route_breakdown":route_stats}
        results["variants"][name]=d
    reference=selected_by_case["ADOPTED_FROZEN_ALTS"]
    for name,selected in selected_by_case.items():
        results["variants"][name]["added_selected_vs_adopted"]=len(selected-reference)
        results["variants"][name]["displaced_selected_vs_adopted"]=len(reference-selected)
    assert results["variants"]["ADOPTED_FROZEN_ALTS"]["raw_gate_passes_by_route"] is not None
    # Historical Aster primary scan must reproduce the prior identical 1.00/0.80
    # pre-WinRate Top3 selection count. It is a hard parity check (not PnL parity).
    expected=2020 if [start,end]==["2025-08-10","2026-08-11"] else (
             176 if [start,end]==["2026-08-28","2026-09-27"] else None)
    observed=results["variants"]["ADOPTED_FROZEN_ALTS"]["repeated_top3_selected"]
    if expected is not None and observed!=expected:
        raise ValueError(f"BASELINE_SCORE_GATE_SELECTION_PARITY_FAIL:{observed}!={expected}")
    results["status"]="RESEARCH_ROUTE_PROXY_DONE_NO_EXECUTABLE_BT"
    p=Path(output);p.parent.mkdir(parents=True,exist_ok=True)
    p.write_text(json.dumps(results,sort_keys=True,indent=2,allow_nan=False)+"\n")
    print("ALT_REVIEW_PARITY",json.dumps({"expected":expected,"observed":observed},sort_keys=True))
    for name,d in results["variants"].items():
        print("ALT_REVIEW_CASE",json.dumps({"name":name,"selected":d["repeated_top3_selected"],
            "added":d["added_selected_vs_adopted"],"removed":d["displaced_selected_vs_adopted"],
            "routes":d["selected_by_route"],"holdout":d["final92d_independent_46h_total"]},sort_keys=True))
    return results

if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument("--root",required=True)
    p.add_argument("--scan",required=True)
    p.add_argument("--start",required=True)
    p.add_argument("--end-exclusive",required=True)
    p.add_argument("--output",required=True)
    a=p.parse_args()
    run(a.root,a.scan,a.start,a.end_exclusive,a.output)
