#!/usr/bin/env python3
"""PRISM VII P6 frozen causal structure-state engine on REAL/SYNTHETIC M5.

Research only: state classification is NOT an entry veto, a new trade, or
a native source/STOP reprice. No future target participates in observations.
Precommitted economics: docs/research-results/PRISM7_P6_PRECOMMITTED_STRUCTURE_STATE_20261122.md
"""
from __future__ import annotations
import argparse
import csv
import gzip
import hashlib
import json
import math
from collections import Counter,defaultdict
from pathlib import Path
from statistics import mean,median
from prism7_native53_event_attribution_20261122 import load_csv,load_m5,qtl
from prism7_synthetic_8_regime_exit_stress_20261122 import (
    make_market, REGIMES, SEEDS, START, M5, N
)

H=3600000
PIN="1657e173d250ad58f53e62f7bb0a3428fb405496"
STATE_NAMES=("SELLER_CONTINUATION","BUYER_ABSORPTION_REVERSAL",
             "TRANSITION_OR_CONFLICT","DATA_INSUFFICIENT")


def _h1_from_positive_prints(candles,decision):
    """Returns up to 25 contiguous completed hourly OHLCV buckets, oldest first.

    Omits zero-volume candles from high/low and close. Missing hour is None;
    never backfills or accesses a bar whose right edge > decision.
    """
    assert decision%H==0 and decision>25*H
    hourly=[]
    for j in range(25,0,-1):
        h0=decision-j*H
        points=[]
        for k in range(12):
            t=h0+k*M5
            row=candles.get(t)
            if row is None:continue
            assert int(row[0])==t
            if float(row[5])>0:
                points.append(row)
        if not points:
            hourly.append(None)
        else:
            hourly.append({
                "ts":h0,
                "open":float(points[0][1]),
                "high":max(float(z[2]) for z in points),
                "low":min(float(z[3]) for z in points),
                "close":float(points[-1][4]),
                "volume":sum(float(z[5]) for z in points),
                "taker_buy":sum(float(z[9]) for z in points),
                "positive_m5":len(points)
            })
    return hourly


def _delta(a,b):
    return a/b-1


def _aggregate_counts(rows):
    return {
        "positive_m5":sum(x["positive_m5"] for x in rows),
        "volume":sum(x["volume"] for x in rows),
        "buy_taker":sum(x["taker_buy"] for x in rows),
    }


def asof_state(pengu,btc,decision):
    """Use only bars whose 5-min close time <= decision, never future labels."""
    P=_h1_from_positive_prints(pengu,decision)
    B=_h1_from_positive_prints(btc,decision)
    count3=sum(x["positive_m5"] for x in P[-3:] if x is not None)
    count6=sum(x["positive_m5"] for x in P[-6:] if x is not None)
    result={"reference_ts":decision,
            "state":"DATA_INSUFFICIENT","seller_votes":None,"buyer_votes":None,
            "positive_m5_last3":count3,"positive_m5_last6":count6}
    if count3<18 or count6<36 or any(x is None for x in P) or any(x is None for x in B):
        result["invalid_reason"]="LESS_THAN_25_COMPLETE_H1_OR_REQUIRED_POSITIVE_M5"
        return result
    p=P[-1]["close"]
    b=B[-1]["close"]
    tr=[]
    for k in range(1,25):
        hour=P[k]
        prior=P[k-1]["close"]
        tr.append(max(hour["high"]-hour["low"],
                      abs(hour["high"]-prior),abs(hour["low"]-prior)))
    # For the 24 completed H1 hours P[1..24], require prior P[0].
    assert len(tr)==24 and p>0
    atr_ratio=mean(tr)/p
    if not (.0000001<atr_ratio<2):
        result["invalid_reason"]="INVALID_ATR_PRICE_RATIO"
        return result

    last6=P[-6:]
    prev6=P[-7]
    lower_highs=sum(last6[i]["high"]<last6[i-1]["high"]
                    for i in range(1,6))
    lower_lows=sum(last6[i]["low"]<last6[i-1]["low"]
                   for i in range(1,6))
    failed_new_lows=sum(cur["low"]<prev["low"] and cur["close"]>prev["low"]
                        for cur,prev in zip(last6,P[-7:-1]))
    p3=_delta(P[-1]["close"],P[-4]["close"])
    b3=_delta(B[-1]["close"],B[-4]["close"])
    p6=_delta(P[-1]["close"],P[-7]["close"])
    prev3=_aggregate_counts(P[-6:-3])
    last3=_aggregate_counts(P[-3:])
    share3=last3["buy_taker"]/last3["volume"]
    share_prev=prev3["buy_taker"]/prev3["volume"]
    changes=[P[-6+i+1]["close"]/P[-6+i]["close"]-1 for i in range(5)]
    eff=abs(p6)/sum(abs(v) for v in changes) if sum(abs(v) for v in changes)>1e-12 else 0
    # Structural evidence chosen before looking at P6 results.
    votes_s={
       "lower_highs_and_lows":lower_highs>=4 and lower_lows>=4,
       "declining_3h_0p5atr":p3<=-.5*atr_ratio,
       "relative_weakness_to_btc":p3-b3<=-.5*atr_ratio,
       "efficient_declining_6h":p6<0 and eff>=.35,
    }
    rebound=(p-min(x["low"] for x in last6))/p/atr_ratio
    votes_b={
       "failed_new_lows":failed_new_lows>=2,
       "rising_taker_buy_pressure":share3>=.60 and share3-share_prev>=.10,
       "rebound_from_printed_low_atr":rebound>=1.0,
       "btc_and_pengu_rising":p3>.5*atr_ratio and b3>.5*atr_ratio,
    }
    seller=sum(votes_s.values())
    buyer=sum(votes_b.values())
    if seller>=3 and buyer<=1:
        state="SELLER_CONTINUATION"
    elif buyer>=3 and seller<=1:
        state="BUYER_ABSORPTION_REVERSAL"
    else:
        state="TRANSITION_OR_CONFLICT"
    result.update({
       "state":state,"seller_votes":seller,"buyer_votes":buyer,
       "atr24_from_m5_ratio":round(atr_ratio,9),
       "lower_highs_5":lower_highs,"lower_lows_5":lower_lows,
       "failed_new_lows_6":failed_new_lows,
       "p3_return":round(p3,9),"btc3_return":round(b3,9),
       "p6_return":round(p6,9),
       "taker_buy_share_3h":round(share3,7),
       "taker_buy_share_prev3h":round(share_prev,7),
       "taker_buy_share_change":round(share3-share_prev,7),
       "rebound_from_low_in_atr":round(rebound,6),
       "down_efficiency6":round(eff,6),
       "seller_evidence":";".join(k for k,v in votes_s.items() if v),
       "buyer_evidence":";".join(k for k,v in votes_b.items() if v),
    })
    return result


def future_six_h(pengu,t):
    """Diagnostic target only, NOT a feature or executable profit."""
    start=[a for ts,a in pengu.items() if t-3*H<=ts<t and float(a[5])>0]
    after=[a for ts,a in pengu.items() if t<=ts<t+6*H and float(a[5])>0]
    if not start or not after:return None
    ep=float(start[-1][4])
    last=float(after[-1][4])
    return round(100*(ep-last)/ep,6)



def load_verified_btc(paths, native_entries):
    """Quarantine known prebaseline BTC OHLC source defect outside all native T-25h.

    Fail-closed on every unexpected invalid record; do not rewrite candles.
    """
    candles={}
    sha={}
    excluded=[]
    for name in paths:
        p=Path(name)
        sha[p.name]=hashlib.sha256(p.read_bytes()).hexdigest()
        with gzip.open(p,"rt",encoding="utf-8") as f:
            for line in f:
                a=json.loads(line)
                t=int(a[0])
                if t in candles:raise ValueError(f"BTC_DUPLICATE_M5:{t}")
                o,h,l,c,vol,buy=(float(a[k]) for k in (1,2,3,4,5,9))
                valid=0<l<=min(o,c)<=max(o,c)<=h and vol>=0 and 0<=buy<=vol
                if not valid:
                    excluded.append({"ts":t,"source_file":p.name,
                                     "OHLC":[o,h,l,c],"volume":vol,"taker_buy":buy})
                    continue
                candles[t]=a
    # This exception is source-data QA, NEVER an entry feature or rewritten bar.
    if len(excluded)!=1 or excluded[0]["ts"]!=1757771400000:
        raise ValueError(f"UNEXPECTED_BTC_INVALID_M5_ROWS:{excluded[:4]}")
    for record in excluded:
        for native in native_entries:
            T=int(native["original_entryTs"])
            if T-25*H<=record["ts"]<T:
                raise ValueError(f"BTC_INVALID_SOURCE_OVERLAPS_NATIVE_25H:{T}")
    return candles,sha,excluded

def source_native_states(entry_path,anatomy_path,pengu,btc):
    original=load_csv(entry_path)
    anatomy=load_csv(anatomy_path)
    mp={"PRE_AUG_SEP_2025":"PRE_2025_AUG_SEP",
        "POST_OCT_NOV_2026":"POST_2026_OCT_NOV"}
    by={(mp.get(x["period"],x["period"]),x["id"]):x for x in anatomy
        if x["route"]=="SHORT_V20"}
    if len(original)!=len(by) or len(by)!=53:
        raise ValueError("NATIVE53_SOURCE_PAIRING")
    out=[]
    for x in original:
        key=(x["period"],x["original_signal_id"])
        if key not in by:raise ValueError("MISSING_NATIVE_ID:"+str(key))
        a=by[key]
        t=int(x["original_entryTs"])
        if t!=int(a["entry_ts"]) or int(x["original_native_exitTs"])!=int(a["exit_ts"]):
            raise ValueError("NATIVE_TIMES_CHANGED:"+str(key))
        state=asof_state(pengu,btc,t)
        row={
            "period":x["period"],"id":x["original_signal_id"],
            "source_native_sha":PIN,
            "native_exit_reason":a["native_exit_reason"],
            "native_net30_pct":round(float(a["native_net30_pct"]),6),
            "native_profitable30":int(a["native_win30"]=="True"),
            "source_diagnostic_category":a["diagnostic_category"],
            "original_entry_ts":t,
            "source_H1_atr24_ratio":round(json.loads(x["features"])["atr24_ratio"],9),
            **state
        }
        row["source_H1_minus_M5_atr_pct_point"]=round(
            100*(row["source_H1_atr24_ratio"]-state["atr24_from_m5_ratio"]),6
        ) if "atr24_from_m5_ratio" in state else None
        out.append(row)
    if len(out)!=53 or sum(x["native_profitable30"] for x in out)!=29:
        raise ValueError("NATIVE53_PNL_PARITY_FAIL")
    return out


def synthetic_checks():
    """Causal state engine from P6 on exactly 320 frozen generator paths."""
    counts=defaultdict(Counter)
    rows=[]
    synthetic_prefix_checks=0
    for regime in REGIMES:
        for seed in SEEDS:
            P,B,z=make_market(regime,seed)
            local=Counter()
            for j in range(25,67): # Future 6h fully available to t+6h <= 72h
                t=START+j*H
                row=asof_state(P,B,t)
                fut=future_six_h(P,t)
                if row["state"] not in STATE_NAMES:raise ValueError("UNDECLARED_STATE")
                counts[(regime,row["state"])]["count"]+=1
                local[row["state"]]+=1
                if fut is None:
                    counts[(regime,row["state"])]["censored"]+=1
                else:
                    counts[(regime,row["state"])]["valid_labels"]+=1
                    counts[(regime,row["state"])]["future_short_positive"]+=int(fut>0)
                    counts[(regime,row["state"])]["future_short_gt1pct"]+=int(fut>1.0)
                    counts[(regime,row["state"])]["future_short_ltminus1pct"]+=int(fut< -1.0)
                    counts[(regime,row["state"])]["future_short_net_sum_micro_pct"]+=round(fut*1000000)
                if j==36 and seed==SEEDS.start:
                    future_rows={START+(N+k)*M5: [
                         START+(N+k)*M5,1.,1.,1.,1.,1,
                         START+(N+k+1)*M5-1,1.,1,0.5,0.5,0]
                         for k in range(20)}
                    if row!=asof_state({**P,**future_rows}, {**B,**future_rows},t):
                        raise ValueError("ASOF_FUTURE_PREFIX_LEAK:"+regime)
                    synthetic_prefix_checks+=1
            rows.append({
                "regime":regime,"seed":seed,
                "n_observed_hourly_states":sum(local.values()),
                "seller":local["SELLER_CONTINUATION"],
                "buyer":local["BUYER_ABSORPTION_REVERSAL"],
                "transition":local["TRANSITION_OR_CONFLICT"],
                "insufficient":local["DATA_INSUFFICIENT"],
                "zero_prints":z,
            })
    report=[]
    for (regime,state),record in sorted(counts.items()):
        n=record["count"]
        known=record["valid_labels"]
        report.append({
            "regime":regime,"state":state,"n_hourly_states":n,
            "observed_forward_labels":known,
            "censored_labels":record["censored"],
            "future6h_short_pos_frac":round(record["future_short_positive"]/known,5) if known else None,
            "future6h_short_gt1pct_frac":round(record["future_short_gt1pct"]/known,5) if known else None,
            "future6h_short_loss_gt1pct_frac":round(record["future_short_ltminus1pct"]/known,5) if known else None,
            "mean_future6h_short_gross_pct":round(
                record["future_short_net_sum_micro_pct"]/known/1000000,5) if known else None,
        })
    return rows,report,synthetic_prefix_checks


def write_csv(path,rows):
    assert rows
    path.parent.mkdir(parents=True,exist_ok=True)
    keys=[]
    for row in rows:
        for key in row.keys():
            if key not in keys:keys.append(key)
    with path.open("w",encoding="utf-8",newline="") as f:
        w=csv.DictWriter(f,fieldnames=keys)
        w.writeheader();w.writerows(rows)


def main():
    ap=argparse.ArgumentParser()
    for name in ("--entries","--anatomy","--out-native-csv",
                 "--out-synth-csv","--out-summary"):
        ap.add_argument(name,type=Path,required=True)
    ap.add_argument("--pengu-m5",type=Path,nargs="+",required=True)
    ap.add_argument("--btc-m5",type=Path,nargs="+",required=True)
    a=ap.parse_args()
    P,ps=load_m5(a.pengu_m5)
    B,bs,btc_quarantine=load_verified_btc(a.btc_m5,load_csv(a.entries))
    native=source_native_states(a.entries,a.anatomy,P,B)
    for row in native[:3]:
        t=row["original_entry_ts"]
        changed={**P,t:None}
        # Remove future bars ONLY. Original prefix must be identical.
        with_future={**P, t+100000000000:[t+100000000000,1,1,1,1,1,0,1,1,.5,.5,0]}
        if asof_state(P,B,t)!=asof_state(with_future,B,t):
            raise ValueError("NATIVE_ASOF_FUTURE_LEAK")
    synth,states,synth_prefix=synthetic_checks()
    group=[]
    for period in sorted(set(x["period"] for x in native)):
        for state in STATE_NAMES:
            rr=[x for x in native if x["period"]==period and x["state"]==state]
            if not rr:continue
            group.append({
                "period":period,"state":state,"n":len(rr),
                "native_wins":sum(x["native_profitable30"] for x in rr),
                "direction_wrong_11":sum(x["source_diagnostic_category"]=="NO_FAVORABLE_ONE_PERCENT" for x in rr),
                "mean_native_net30_pct":round(
                    sum(x["native_net30_pct"] for x in rr)/len(rr),6),
            })
    all_groups=[]
    for state in STATE_NAMES:
        rr=[x for x in native if x["state"]==state]
        if not rr:continue
        all_groups.append({
            "state":state,"n":len(rr),
            "native_wins":sum(x["native_profitable30"] for x in rr),
            "direction_wrong_11":sum(x["source_diagnostic_category"]=="NO_FAVORABLE_ONE_PERCENT" for x in rr),
            "all_losses":sum(not x["native_profitable30"] for x in rr),
            "total_original_native_net30_pct":round(
                sum(x["native_net30_pct"] for x in rr),6),
            "mean_source_atr24_pct":round(mean(
                x["source_H1_atr24_ratio"] for x in rr)*100,6),
            "mean_m5_derived_atr24_pct":round(mean(
                x["atr24_from_m5_ratio"] for x in rr if "atr24_from_m5_ratio" in x)*100,6)
              if any("atr24_from_m5_ratio" in x for x in rr) else None,
        })
    nat_states=Counter(x["state"] for x in native)
    assert sum(nat_states.values())==53
    n_synth=sum(x["n_observed_hourly_states"] for x in synth)
    if n_synth!=320*42:raise ValueError("SYNTHETIC_HOURLY_STATE_COUNT_WRONG")
    write_csv(a.out_native_csv,native)
    write_csv(a.out_synth_csv,synth)
    output={
       "schema":"prism7-p6-frozen-structure-state-real53-synthetic320/v1",
       "source_pin":PIN,
       "native_source53_parity":"PASS_29_53_NO_REPRICE",
       "native_state_count":dict(nat_states),
       "native_state_groups":all_groups,
       "native_period_groups":group,
       "synthetic_paths":320,"synthetic_hourly_states":n_synth,
       "synthetic_prefix_checks":synth_prefix,
       "synthetic_regime_state_performance":states,
       "source_csv_sha256":{
          "native_entries":hashlib.sha256(a.entries.read_bytes()).hexdigest(),
          "native_anatomy":hashlib.sha256(a.anatomy.read_bytes()).hexdigest(),
       },
       "real_m5_sha256":ps,"real_btc_m5_sha256":bs,
       "btc_quarantined_invalid_ohlc_outside_53_asof_windows":btc_quarantine,
       "limitations":[
           "P6 structural state is NOT a new profitable native entry or exit policy.",
           "Native labels already observed; threshold logic precommitted but not blind OOS.",
           "Synthetic paths share one known artificial generator; not independent external market truth.",
           "Synthetic decisions are ALL hourly checkpoints, NOT actual pinned PENGU natural signals.",
           "Future 6h return is diagnostic only; no signed execution, STOP, Funding, Gross or DD.",
           "PENGU pinned source H1 ATR differs from recomputed printed M5; report both.",
           "Zero-print M5 is not interpolated; missing 25h history fails closed.",
       ]
    }
    a.out_summary.write_text(json.dumps(output,indent=2,sort_keys=True,ensure_ascii=False)+"\n",encoding="utf-8")
    print("PRISM7_P6_STRUCTURE_RESEARCH_PASS real",len(native),"synthetic",len(synth),"hours",n_synth)
    print("REAL_STATES",json.dumps(all_groups,ensure_ascii=False))
    print("SYNTH_STATES",json.dumps(states,ensure_ascii=False))
    print("PREFIX",synth_prefix)
    print("OUT",a.out_summary)


if __name__=="__main__":
    main()
