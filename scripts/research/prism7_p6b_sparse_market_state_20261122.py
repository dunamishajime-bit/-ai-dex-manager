#!/usr/bin/env python3
"""P7 P6B: fixed, non-fitted sparse-market causal regime observer.

Full original native53 intentions remain untouched, no native trade repricing.
Uses exact same as-of state function for real source and synthetic M5.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path
from statistics import mean
from prism7_native53_event_attribution_20261122 import load_csv,load_m5
from prism7_p6_pengu_causal_structure_state_20261122 import (
    _h1_from_positive_prints,load_verified_btc,future_six_h,
    _aggregate_counts,write_csv,H,M5,PIN,STATE_NAMES
)
from prism7_synthetic_8_regime_exit_stress_20261122 import (
    make_market,REGIMES,SEEDS,START
)

def _anchor(P, k):
    """Last valid hourly close for anchor T-k hours, at most 3h stale."""
    # -k-1 gives bucket closing at T-kH.
    idx=25-k-1
    for back in range(3):
        j=idx-back
        if j>=0 and P[j] is not None:
            return P[j],j
    return None,None


def asof_sparse(pengu,btc,T):
    """No price from right of T; no zero-print synthetic OHLC."""
    P=_h1_from_positive_prints(pengu,T)
    B=_h1_from_positive_prints(btc,T)
    p3=sum(x["positive_m5"] for x in P[-3:] if x)
    p6=sum(x["positive_m5"] for x in P[-6:] if x)
    present=sum(x is not None for x in P)
    result={"reference_ts":T,"state":"DATA_INSUFFICIENT",
        "positive_hours25":present,
        "positive_m5_last3":p3,"positive_m5_last6":p6}
    def bad(reason):
        result["insufficient_reason"]=reason
        return result
    if present<15 or P[-1] is None or p3<3 or p6<6:
        return bad("SPARSE_COVERAGE_OR_STALE_LATEST_H1")
    if any(x is None for x in (B[-1],B[-4],B[-7])):
        return bad("BTC_ANCHOR_MISSING")
    last3=_aggregate_counts([x for x in P[-3:] if x])
    prev3=_aggregate_counts([x for x in P[-6:-3] if x])
    if not (last3["volume"]>0 and prev3["volume"]>0):
        return bad("TAKER_SHARE_WINDOW_MISSING")

    positive=[x for x in P if x is not None]
    true_ranges=[]
    gaps=[]
    for prior,cur in zip(positive[:-1],positive[1:]):
        gap=round((cur["ts"]-prior["ts"])/H)
        if gap<=3:
            true_ranges.append(max(cur["high"]-cur["low"],
                abs(cur["high"]-prior["close"]),
                abs(cur["low"]-prior["close"])))
            gaps.append(gap)
    if len(true_ranges)<12:
        return bad("LESS_THAN_12_GAP_BOUNDED_ATR_TRUE_RANGES")
    close=P[-1]["close"]
    atr=mean(true_ranges)/close
    if not (1e-7<atr<2):
        return bad("NONPOSITIVE_SPARSE_ATR")
    p3anchor,p3i=_anchor(P,3)
    p6anchor,p6i=_anchor(P,6)
    if p3anchor is None or p6anchor is None or B[p3i] is None or B[p6i] is None:
        return bad("STALE_3H_OR_6H_RETURN_ANCHOR")
    p3=close/p3anchor["close"]-1
    b3=B[-1]["close"]/B[p3i]["close"]-1
    p6=close/p6anchor["close"]-1

    # Six most recent printed hours within 9h. All comparisons gap-bounded.
    structure=[x for x in P[-9:] if x][-6:]
    if len(structure)<5:
        return bad("INSUFFICIENT_9H_STRUCTURE_BUCKETS")
    comparable=[(a,b) for a,b in zip(structure[:-1],structure[1:])
                if b["ts"]-a["ts"]<=2*H]
    if len(comparable)<3:
        return bad("LESS_THAN_THREE_NEIGHBOR_PAIRS")
    lower=sum(nxt["high"]<old["high"] and nxt["low"]<old["low"]
              for old,nxt in comparable)
    lower_fraction=lower/len(comparable)
    absorption=sum(new["low"]<old["low"] and new["close"]>old["low"]
                   for old,new in comparable)
    close_seq=[p6anchor]+[
        x for x in P[p6i+1:] if x is not None
    ]
    changes=[nxt["close"]/old["close"]-1
             for old,nxt in zip(close_seq[:-1],close_seq[1:])]
    denom=sum(abs(v) for v in changes)
    efficiency=abs(p6)/denom if denom>1e-12 else 0.0
    share3=last3["buy_taker"]/last3["volume"]
    share_prev=prev3["buy_taker"]/prev3["volume"]
    last6=[x for x in P[-6:] if x]
    rebound=(close-min(x["low"] for x in last6))/close/atr

    seller={
        "gap_aware_lower_high_low":lower_fraction>=.75,
        "recent_3h_down_0p5atr":p3<=-.5*atr,
        "relative_weak_to_btc":p3-b3<=-.5*atr,
        "declining_6h_with_efficiency":p6<0 and efficiency>=.35
    }
    buyer={
        "gap_aware_failed_low_breaks":absorption>=2,
        "accelerating_3h_taker_buy":share3>=.60 and share3-share_prev>=.10,
        "rebound_from_6h_printed_low_atr":rebound>=1.,
        "btc_and_pengu_3h_rising":p3>.5*atr and b3>.5*atr
    }
    s=sum(seller.values())
    b=sum(buyer.values())
    state=("SELLER_CONTINUATION" if s>=3 and b<=1 else
           "BUYER_ABSORPTION_REVERSAL" if b>=3 and s<=1 else
           "TRANSITION_OR_CONFLICT")
    result.update({
        "state":state,"seller_votes":s,"buyer_votes":b,
        "atr24_sparse_print_ratio":round(atr,9),
        "atr_traded_pairs":len(true_ranges),"atr_max_gap_hours":max(gaps),
        "structure_9h_pair_count":len(comparable),
        "lower_high_low_frac":round(lower_fraction,7),
        "failed_low_break_count":absorption,
        "p3_return":round(p3,9),"btc3_return":round(b3,9),
        "p6_return":round(p6,9),
        "taker_buy3":round(share3,7),
        "taker_buy_prev3":round(share_prev,7),
        "taker_buy_change":round(share3-share_prev,7),
        "rebound_atr":round(rebound,6),
        "six_h_efficiency":round(efficiency,6),
        "seller_evidence":";".join(k for k,v in seller.items() if v),
        "buyer_evidence":";".join(k for k,v in buyer.items() if v),
    })
    return result


def native_states(original,old_p6_csv,P,B):
    ref=load_csv(old_p6_csv)
    old={(x["period"],x["id"]):x for x in ref}
    if len(old)!=53 or len(original)!=53:
        raise ValueError("SOURCE_53_COUNT")
    out=[]
    for x in original:
        key=(x["period"],x["original_signal_id"])
        if key not in old:raise ValueError("NATIVE_ID_UNMATCHED:"+str(key))
        prior=old[key]
        t=int(x["original_entryTs"])
        if t!=int(prior["original_entry_ts"]):
            raise ValueError("NATIVE_ENTRY_TS_MISMATCH")
        z=asof_sparse(P,B,t)
        out.append({
            "period":key[0],"id":key[1],"original_entry_ts":t,
            "p6_strict_state":prior["state"],
            "native_profitable30":int(prior["native_profitable30"]),
            "native_net30_pct":float(prior["native_net30_pct"]),
            "source_diagnostic_category":prior["source_diagnostic_category"],
            **z
        })
        out[-1]["native_asof_prefix_check"]=(
            z==asof_sparse({k:v for k,v in P.items() if k<t},B,t)
        )
        if not out[-1]["native_asof_prefix_check"]:
            raise ValueError(f"ASOF_REAL_PREFIX_INVARIANT_FAIL:{key}")
    if len(out)!=53 or sum(z["native_profitable30"] for z in out)!=29:
        raise ValueError("NATIVE_SOURCE_WIN_COUNTS")
    return out


def synthetic_states():
    rows=[]
    groups=defaultdict(lambda:defaultdict(list))
    checked=0
    for regime in REGIMES:
        for seed in SEEDS:
            P,B,nzero=make_market(regime,seed)
            counts=Counter()
            for hour in range(25,67):
                t=START+hour*H
                z=asof_sparse(P,B,t)
                state=z["state"]
                if state not in STATE_NAMES:raise ValueError("UNDECLARED_STATE")
                counts[state]+=1
                target=future_six_h(P,t)
                groups[regime][state].append(target)
                if hour==36 and seed==SEEDS.start:
                    tail={**P,START+100*H:[START+100*H,1,1,1,1,1,START+100*H+M5-1,1,1,.5,.5,0]}
                    if z!=asof_sparse(tail,B,t):
                        raise ValueError("SYNTHETIC_PREFIX_INVARIANCE_FAIL")
                    checked+=1
            rows.append({
                "regime":regime,"seed":seed,
                "SELLER_CONTINUATION":counts["SELLER_CONTINUATION"],
                "BUYER_ABSORPTION_REVERSAL":counts["BUYER_ABSORPTION_REVERSAL"],
                "TRANSITION_OR_CONFLICT":counts["TRANSITION_OR_CONFLICT"],
                "DATA_INSUFFICIENT":counts["DATA_INSUFFICIENT"],
                "zero_print_m5":nzero,
                "total_states":sum(counts.values())
            })
    assert len(rows)==320 and sum(z["total_states"] for z in rows)==13440
    summary=[]
    for regime in REGIMES:
        for state in STATE_NAMES:
            vals=groups[regime][state]
            if not vals:continue
            valid=[v for v in vals if v is not None]
            summary.append({
                "regime":regime,"state":state,
                "hourly_checks":len(vals),
                "observed_6h_labels":len(valid),
                "censored_6h_labels":len(vals)-len(valid),
                "future6h_short_positive_frac":round(
                    sum(v>0 for v in valid)/len(valid),6) if valid else None,
                "future6h_short_loss_more_than1pct_frac":round(
                    sum(v< -1 for v in valid)/len(valid),6) if valid else None,
                "future6h_short_mean_gross_pct":round(mean(valid),6) if valid else None,
            })
    return rows,summary,checked


def main():
    p=argparse.ArgumentParser()
    p.add_argument("--entries",type=Path,required=True)
    p.add_argument("--original-p6-csv",type=Path,required=True)
    p.add_argument("--pengu-m5",nargs="+",type=Path,required=True)
    p.add_argument("--btc-m5",nargs="+",type=Path,required=True)
    p.add_argument("--out-native-csv",type=Path,required=True)
    p.add_argument("--out-synthetic-csv",type=Path,required=True)
    p.add_argument("--out-summary",type=Path,required=True)
    a=p.parse_args()
    orig=load_csv(a.entries)
    P,ps=load_m5(a.pengu_m5)
    B,bs,quarantine=load_verified_btc(a.btc_m5,orig)
    native=native_states(orig,a.original_p6_csv,P,B)
    sim,groups,checked=synthetic_states()
    stats=[]
    for state in STATE_NAMES:
        part=[x for x in native if x["state"]==state]
        if not part:continue
        stats.append({
          "state":state,"n":len(part),
          "original_winners":sum(x["native_profitable30"] for x in part),
          "no_favorable_1pct_11":sum(
              x["source_diagnostic_category"]=="NO_FAVORABLE_ONE_PERCENT" for x in part),
          "original_losses":sum(not x["native_profitable30"] for x in part),
          "original_native_net30_sum_pct":round(
              sum(x["native_net30_pct"] for x in part),6),
          "source_natural_intents_retained":len(part)
        })
    transitions=Counter((x["p6_strict_state"],x["state"]) for x in native)
    report={
        "schema":"prism7-p6b-trade-aware-sparse-structure-real53-synthetic320/v1",
        "source_pin":PIN,
        "natural_signal_count":53,
        "native_winner_parity":29,
        "original_11_no_favorable_count":sum(
            x["source_diagnostic_category"]=="NO_FAVORABLE_ONE_PERCENT" for x in native),
        "native_state_groups":stats,
        "p6_to_p6b_state_transitions":[
            {"p6":k[0],"p6b":k[1],"n":v}
            for k,v in sorted(transitions.items())],
        "synthetic_paths":320,"synthetic_hourly_checks":13440,
        "synthetic_regime_states":groups,
        "synthetic_prefix_invariance_count":checked,
        "native_prefix_invariance_count":53,
        "input_sha256":{
            "entries":hashlib.sha256(a.entries.read_bytes()).hexdigest(),
            "original_p6_csv":hashlib.sha256(a.original_p6_csv.read_bytes()).hexdigest()
        },
        "source_m5_sha256":ps,"btc_m5_sha256":bs,
        "btc_quarantine":quarantine,
        "limitations":[
            "Sparse trade-aware ATR is a research feature, not native H1 ATR parity.",
            "P6B does not modify, reprice, veto or execute any of the 53 native trades.",
            "Synthetic hourly observations are NOT actual native PENGU signals or STOP model.",
            "One previously inspected real source 53 and one fixed generator; NOT independent OOS.",
            "Independent OOS, synthetic native entry/STOP, funding, fills and portfolio DD untested.",
        ]
    }
    a.out_summary.parent.mkdir(parents=True,exist_ok=True)
    write_csv(a.out_native_csv,native)
    write_csv(a.out_synthetic_csv,sim)
    a.out_summary.write_text(
        json.dumps(report,ensure_ascii=False,sort_keys=True,indent=2)+"\n",
        encoding="utf-8")
    print("PRISM7_P6B_SPARSE_STATE_PASS REAL53 SYNTH320 HOURS13440")
    print("REAL",json.dumps(stats,ensure_ascii=False))
    print("TRANSITIONS",json.dumps(report["p6_to_p6b_state_transitions"],ensure_ascii=False))
    print("SYNTH",json.dumps(groups,ensure_ascii=False))
    print("OUT",a.out_summary)


if __name__=="__main__":
    main()
