#!/usr/bin/env python3
"""PRISM VII P7: Synthetic prices × public historical PENGU print/no-print masks.

No real prices, source returns, prior win/loss or STOP are used by the generator.
No actual PENGU pinned signals or native exits are replayed. Research only.
"""
from __future__ import annotations
import argparse
import gzip
import hashlib
import json
import math
import random
from collections import Counter,defaultdict
from pathlib import Path
from statistics import mean
from prism7_p6_pengu_causal_structure_state_20261122 import asof_state,future_six_h,write_csv,H,M5
from prism7_p6b_sparse_market_state_20261122 import asof_sparse
from prism7_synthetic_8_regime_exit_stress_20261122 import (
    START,REGIMES,N,scenario_drifts,check_path
)

SEEDS=range(2026112280,2026112292)
PROFILE_NAMES=(
    "PRE_20250801_20250924",
    "MAIN_PREFIX_20250924_20260803",
    "MAIN_SUFFIX_20260803_20261001",
    "POST_20261001_20261118",
)
STATES=("SELLER_CONTINUATION","BUYER_ABSORPTION_REVERSAL",
        "TRANSITION_OR_CONFLICT","DATA_INSUFFICIENT")


def digest_seed(*parts):
    raw="|".join(map(str,parts)).encode("utf-8")
    return int(hashlib.sha256(raw).hexdigest()[:16],16)


def load_source_mask(path):
    path=Path(path)
    flags=[]
    raw=open(path,"rb").read()
    sha=hashlib.sha256(raw).hexdigest()
    with gzip.open(path,"rt",encoding="utf-8") as f:
        last=None
        for line in f:
            a=json.loads(line)
            if len(a)<10:raise ValueError("M5_SOURCE_FIELDS_MISSING")
            t=int(a[0])
            if last is not None and t-last!=M5:
                raise ValueError(f"NONCONTIGUOUS_SOURCE_MASK:{path.name}:{t-last}")
            last=t
            flags.append(float(a[5])>0)
    if not (len(flags)>=N+12 and len(flags)%12==0):
        raise ValueError(f"INSUFFICIENT_COMPLETE_SOURCE_MASK:{path.name}:{len(flags)}")
    return flags,sha


def source_profile_metrics(flags):
    n=len(flags)
    runs=[]
    zero_run=0
    for b in flags:
        if not b:zero_run+=1
        elif zero_run:
            runs.append(zero_run)
            zero_run=0
    if zero_run:runs.append(zero_run)
    return {
        "source_M5":n,
        "zero_M5_frac":round(sum(not v for v in flags)/n,6),
        "complete_empty_hours":sum(not any(flags[i:i+12]) for i in range(0,n,12)),
        "empty_hour_frac":round(
            sum(not any(flags[i:i+12]) for i in range(0,n,12))/(n/12),6),
        "longest_zero_run_M5":max(runs) if runs else 0,
    }


def sample_mask(profile,flags,regime,seed):
    # Independent from price RNG, source market returns, and old native labels.
    rng=random.Random(digest_seed("liquidity",profile,regime,seed))
    nstarts=(len(flags)-N)//12 + 1
    j=rng.randrange(nstarts)*12
    chosen=flags[j:j+N]
    assert len(chosen)==N
    return chosen,j


def new_market(mask,regime,profile,seed):
    rng=random.Random(digest_seed("synthetic-price",regime,profile,seed))
    P,B={},{}
    pl=1.0;printed=1.0
    bl=100000.0
    for i in range(N):
        t=START+i*M5
        zbtc=rng.gauss(0,1)
        zpng=rng.gauss(0,1)
        mu,bmu,psigma,bsigma=scenario_drifts(regime,i,zbtc)
        br=bmu+bsigma*zbtc
        pr=mu+psigma*(.40*zbtc+.92*zpng)
        if regime=="DOWN_THEN_SQUEEZE" and i==30*12:pr+=.025
        if regime=="UP_THEN_DUMP" and i==35*12:pr-=.035
        if regime=="HIGH_VOL_CHOP" and i%100==50:
            pr+=.025 if (i//100)%2 else -.025
        p0=pl
        b0=bl
        pl*=math.exp(pr)
        bl*=math.exp(br)
        if mask[i]:
            o=p0;c=pl
            wick=abs(rng.gauss(0,psigma*.30))
            hi=max(o,c)*(1+wick)
            lo=min(o,c)*(1-wick)
            vol=max(1,int(rng.lognormvariate(12.0,.7)))
            buyshare=max(.02,min(.98,.5+8*pr+rng.gauss(0,.08)))
            buy=vol*buyshare
            printed=c
        else:
            o=c=hi=lo=printed
            vol=0
            buy=0
        P[t]=[t,o,hi,lo,c,vol,t+M5-1,vol*c,1 if vol else 0,
              buy,buy*c,0]
        bw=abs(rng.gauss(0,bsigma*.25))
        bv=max(1,int(rng.lognormvariate(14,.3)))
        B[t]=[t,b0,max(b0,bl)*(1+bw),min(b0,bl)*(1-bw),bl,bv,
              t+M5-1,bv*bl,2,bv*.5,bv*bl*.5,0]
    if len(P)!=N or len(B)!=N:
        raise ValueError("WRONG_SYNTHETIC_PATH_LENGTH")
    # Absolute equality proves sampled print mask is exactly applied.
    if any((float(P[START+i*M5][5])>0)!=mask[i] for i in range(N)):
        raise ValueError("SYNTHETIC_MASK_APPLIED_INCORRECTLY")
    check_path(P,B)
    return P,B


def calc_qualities(mask):
    return {
       "printed_fraction":round(sum(mask)/len(mask),6),
       "complete_empty_h1":sum(not any(mask[i:i+12]) for i in range(0,len(mask),12)),
       "longest_zero_run":max(
            (len(x) for x in "".join("1" if v else "0" for v in mask).split("1")),default=0)
    }


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--source-m5",nargs=4,type=Path,required=True)
    parser.add_argument("--out-paths",type=Path,required=True)
    parser.add_argument("--out-summary",type=Path,required=True)
    a=parser.parse_args()
    masks={}
    sources={}
    for profile,path in zip(PROFILE_NAMES,a.source_m5):
        flags,sha=load_source_mask(path)
        masks[profile]=flags
        sources[profile]={
            "archive_name":path.name,"sha256":sha,
            "observed":source_profile_metrics(flags)
        }
    results=[]
    rows=defaultdict(lambda:defaultdict(lambda:defaultdict(list)))
    prefix_tests=0
    for profile in PROFILE_NAMES:
        for regime in REGIMES:
            for seed in SEEDS:
                chosen,mask_start=sample_mask(profile,masks[profile],regime,seed)
                P,B=new_market(chosen,regime,profile,seed)
                q=calc_qualities(chosen)
                counts_p6=Counter()
                counts_p6b=Counter()
                for hour in range(25,67):
                    t=START+hour*H
                    s1=asof_state(P,B,t)
                    s2=asof_sparse(P,B,t)
                    st1=s1["state"];st2=s2["state"]
                    assert st1 in STATES and st2 in STATES
                    fut=future_six_h(P,t)
                    counts_p6[st1]+=1
                    counts_p6b[st2]+=1
                    rows[(profile,regime)]["P6"][st1].append(fut)
                    rows[(profile,regime)]["P6B"][st2].append(fut)
                    if seed==SEEDS.start and hour==36:
                        ts=t+10*H
                        future={ts:[ts,5,5,5,5,1,ts+M5-1,5,1,.5,2.5,0]}
                        for fn,original in ((asof_state,s1),(asof_sparse,s2)):
                            if fn({**P,**future},{**B,**future},t)!=original:
                                raise ValueError(f"FUTURE_PREFIX_LEAK:{fn.__name__}")
                            if fn({k:v for k,v in P.items() if k<t},
                                  {k:v for k,v in B.items() if k<t},t)!=original:
                                raise ValueError(f"TRUNCATED_PREFIX_LEAK:{fn.__name__}")
                            prefix_tests+=2
                data={
                   "mask_profile":profile,"price_regime":regime,"seed":seed,
                   "source_print_mask_start_index":mask_start,
                   "synthetic_M5":N,"state_decisions":42,
                   **q,
                }
                for k,v in counts_p6.items():data["P6_"+k]=v
                for k,v in counts_p6b.items():data["P6B_"+k]=v
                results.append(data)
    assert len(results)==4*len(REGIMES)*len(SEEDS)==384
    assert sum(x["state_decisions"] for x in results)==16128
    summary=[]
    for (profile,regime),by_method in sorted(rows.items()):
        for method,by_state in sorted(by_method.items()):
            for state,targets in sorted(by_state.items()):
                if not targets:continue
                n=len(targets)
                valid=[x for x in targets if x is not None]
                summary.append({
                   "mask_profile":profile,"price_regime":regime,
                   "classifier":method,"state":state,
                   "hourly_states":n,"forward6h_valid":len(valid),
                   "forward6h_censored":n-len(valid),
                   "forward6h_short_gross_positive_frac":
                      round(sum(x>0 for x in valid)/len(valid),6) if valid else None,
                   "forward6h_short_gross_loss_gt1pct_frac":
                      round(sum(x<-1 for x in valid)/len(valid),6) if valid else None,
                   "mean_forward6h_short_gross_pct":
                      round(mean(valid),6) if valid else None,
                })
    mask_quality=[]
    for profile in PROFILE_NAMES:
        val=[x for x in results if x["mask_profile"]==profile]
        hour=sum(x["complete_empty_h1"] for x in val)
        printfrac=1-mean(x["printed_fraction"] for x in val)
        expected=sources[profile]["observed"]
        mask_quality.append({
            "mask_profile":profile,"paths":len(val),
            "source_zero_m5_frac":expected["zero_M5_frac"],
            "sampled_zero_m5_frac":round(printfrac,6),
            "source_empty_hour_frac":expected["empty_hour_frac"],
            "sampled_empty_hour_frac":round(hour/(len(val)*72),6),
            "source_longest_zero_M5":expected["longest_zero_run_M5"],
            "sampled_max_zero_M5":max(x["longest_zero_run"] for x in val),
        })
    report={
        "schema":"prism7-p7-price8x-liquidity4x12-bootstrap-research/v1",
        "preregistered":"PRISM7_P7_PRECOMMITTED_LIQUIDITY_BOOTSTRAP_SYNTHETIC_20261122.md",
        "paths":384,"checkpoints_per_path":42,"total_hourly_state_checks":16128,
        "prefix_invariance_checks":prefix_tests,
        "source_liquidity_only":sources,
        "mask_quality_vs_real":mask_quality,
        "regime_classifier_summary":summary,
        "limitations":[
            "No native entry signal or STOP; no venue fills, Funding, Gross, portfolio DD or user money.",
            "Historical source LIQUIDITY masks are resampled as contiguous windows. Source PENGU prices and returns are not copied.",
            "Masks of 72h windows from same four seen periods overlap and are not independent observations.",
            "The synthetic price generator is stylized, not calibrated to source return dynamics or held-out exchange markets.",
            "16,128 overlapping hourly horizons are not 16,128 independent trades.",
            "No threshold/decision rule reoptimized after seeing outcomes; results are only diagnostic, not new policies.",
        ]
    }
    a.out_summary.parent.mkdir(parents=True,exist_ok=True)
    write_csv(a.out_paths,results)
    a.out_summary.write_text(json.dumps(report,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf-8")
    print("PRISM7_P7_CLUSTERED_LIQUIDITY_SYNTH_PASS",len(results),"paths",prefix_tests,"prefix_checks")
    print("QUALITY",json.dumps(mask_quality,ensure_ascii=False))
    print("SCOPE",len(summary),"regime state summaries, 16128 synthetic decision checks")
    print("OUT",a.out_summary,a.out_paths)


if __name__=="__main__":
    main()
