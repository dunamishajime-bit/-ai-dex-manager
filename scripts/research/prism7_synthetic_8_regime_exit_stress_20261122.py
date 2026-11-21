#!/usr/bin/env python3
"""PRISM VII P7-4: 8-regime synthetic MARKET MECHANICS stress only.

Forced SHORT once per simulation path is NOT a PINNED PENGU entry or native
position/STOP engine. We only test frozen P7-3 exit-intent causality and
path robustness, never assert PENGU strategy 80% or portfolio DD20% here.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import random
from collections import defaultdict
from pathlib import Path

from prism7_native53_exit_hypothesis_replay_20261122 import decide, RULES
from prism7_native53_event_attribution_20261122 import qtl

M5=300000
N=72*12
START=1800000000000
SEEDS=range(2026112200,2026112240)
REGIMES=(
    "PERSISTENT_DOWN","PERSISTENT_UP","SIDEWAYS",
    "DOWN_THEN_SQUEEZE","UP_THEN_DUMP","HIGH_VOL_CHOP",
    "ILLIQUID_ZERO_PRINT","BTC_PENGU_DIVERGENCE",
)
ATR_RATIO=.0146848
FEES_BPS=30
EXTRA_SLIP_BPS=(0,10)


def scenario_drifts(regime,i,btc_noise):
    h=i/12
    if regime=="PERSISTENT_DOWN":return -.00027,-.00009,.0028,.0014
    if regime=="PERSISTENT_UP":return +.00027,+.00008,.0028,.0014
    if regime=="SIDEWAYS":return 0,0,.0038,.0017
    if regime=="DOWN_THEN_SQUEEZE":
        return (-.00030 if h<30 else +.00042),(-.00008 if h<30 else +.00015),.0035,.0017
    if regime=="UP_THEN_DUMP":
        return (+.00027 if h<35 else -.00048),(+.00010 if h<35 else -.00018),.0034,.0018
    if regime=="HIGH_VOL_CHOP":
        return (.00035 if (int(h)//8)%2 else -.00035),0,.0080,.0035
    if regime=="ILLIQUID_ZERO_PRINT":
        return -.00005,-.00002,.0045,.0022
    if regime=="BTC_PENGU_DIVERGENCE":
        return +.00021,-.00017,.0032,.0019
    raise ValueError(regime)


def make_market(regime,seed):
    rng=random.Random(seed+REGIMES.index(regime)*100000)
    pengu,bct={},{}
    p_latent=1.0
    p_print=1.0
    b_latent=100000.0
    b_print=100000.0
    zero_count=0
    for i in range(N):
        ts=START+i*M5
        z_b=rng.gauss(0,1)
        z_p=rng.gauss(0,1)
        mu,bmu,psigma,bsigma=scenario_drifts(regime,i,z_b)
        btc_r=bmu+bsigma*z_b
        png_r=mu+psigma*(0.40*z_b+0.92*z_p)
        if regime=="DOWN_THEN_SQUEEZE" and i==30*12: png_r+=.025
        if regime=="UP_THEN_DUMP" and i==35*12:png_r-=.035
        if regime=="HIGH_VOL_CHOP" and i%100==50:png_r+=(.025 if (i//100)%2 else -.025)
        bp=b_latent
        b_latent*=math.exp(btc_r)
        p0=p_latent
        p_latent*=math.exp(png_r)
        illiquid = regime=="ILLIQUID_ZERO_PRINT"
        trade=(i==0 or rng.random()>(.56 if illiquid else .025))
        if trade:
            o=p0
            c=p_latent
            wick=abs(rng.gauss(0,psigma*.30))
            hi=max(o,c)*(1+wick)
            lo=min(o,c)*(1-wick)
            v=max(1,int(rng.lognormvariate(11.8 if illiquid else 12.2,.7)))
            ratio=max(.02,min(.98,.5+8*png_r+rng.gauss(0,.08)))
            taker=v*ratio
            p_print=c
        else:
            zero_count+=1
            o=c=hi=lo=p_print
            v=0
            taker=0
        pengu[ts]=[ts,o,hi,lo,c,v,ts+M5-1,v*c,1 if v else 0,taker,taker*c,0]
        # BTC and PENGU share an observable correlated factor.
        bo=bp;bc=b_latent
        bwin=abs(rng.gauss(0,bsigma*.25))
        bv=max(1,int(rng.lognormvariate(14,.3)))
        bct[ts]=[ts,bo,max(bo,bc)*(1+bwin),min(bo,bc)*(1-bwin),bc,
                 bv,ts+M5-1,bv*bc,2,bv*max(.02,min(.98,.5+6*btc_r)),0,0]
    assert len(pengu)==len(bct)==N
    check_path(pengu,bct)
    return pengu,bct,zero_count


def check_path(pengu,btc):
    """OHLC and time continuity, M5->H1 aggregate sanity."""
    for name,candles in (("PENGU",pengu),("BTC",btc)):
        times=sorted(candles)
        assert len(times)==N
        assert times[0]==START and times[-1]+M5==START+N*M5
        assert all(times[i+1]-times[i]==M5 for i in range(N-1))
        for t in times:
            a=candles[t]
            assert a[0]==t and a[6]==t+M5-1
            assert 0<a[3]<=min(a[1],a[4])<=max(a[1],a[4])<=a[2]
            assert a[5]>=0 and 0<=a[9]<=a[5]
            if a[5]==0:assert a[1]==a[2]==a[3]==a[4]
        for i in range(0,len(times),12):
            rows=[candles[t] for t in times[i:i+12]]
            opening=rows[0][1]
            closing=rows[-1][4]
            high=max(r[2] for r in rows)
            low=min(r[3] for r in rows)
            # Reconstructed H1 has physically valid OHLC.
            assert low<=min(opening,closing)<=max(opening,closing)<=high


def evaluate(candles,regime,seed,zero):
    entry=1.0
    exit_time=START+N*M5
    final_print=next(a[4] for a in reversed(list(candles.values())) if a[5]>0)
    hold_gross=100*(entry-final_print)/entry
    res=[]
    for rule in ("FORCED_HOLD_72H",)+RULES:
        event=decide(candles,entry,ATR_RATIO,START,exit_time,rule) if rule!="FORCED_HOLD_72H" else None
        if event:
            assert START<event["signal_close_ts"]<=event["execution_print_ts"]<exit_time
            px=event["execution_proxy_open"]
        else:
            px=final_print
        for slip in EXTRA_SLIP_BPS:
            # Extra execution cost only applies to new early exits.
            additional=slip/100 if event else 0
            net=100*(entry-px)/entry-FEES_BPS/100-additional
            res.append({"regime":regime,"seed":seed,"rule":rule,
                "additional_slippage_bps":slip,"zero_volume_m5_bars":zero,
                "early_exit":bool(event),
                "exit_delay_mins":event["next_print_delay_mins"] if event else None,
                "net_pct":round(net,6),
                "win":net>0})
    return res


def main():
    p=argparse.ArgumentParser()
    p.add_argument("--out-json",type=Path,required=True)
    a=p.parse_args()
    rows=[]
    prefix_checks=0
    for regime in REGIMES:
        for seed in SEEDS:
            candles,btc,zero=make_market(regime,seed)
            # Future append cannot alter decisions before native horizon.
            if seed==2026112200:
                future={START+(N+i)*M5:[START+(N+i)*M5,1.0,1.0,1.0,1.0,100,
                  START+(N+i+1)*M5-1,100,1,50,50,0] for i in range(10)}
                expanded={**candles,**future}
                for rule in RULES:
                    assert decide(candles,1.0,ATR_RATIO,START,START+N*M5,rule)==decide(
                        expanded,1.0,ATR_RATIO,START,START+N*M5,rule)
                    prefix_checks+=1
            rows+=evaluate(candles,regime,seed,zero)
    report=[]
    for regime in REGIMES:
        for rule in ("FORCED_HOLD_72H",)+RULES:
            for slip in EXTRA_SLIP_BPS:
                bucket=[r for r in rows if r["regime"]==regime and r["rule"]==rule
                    and r["additional_slippage_bps"]==slip]
                assert len(bucket)==40
                v=[r["net_pct"] for r in bucket]
                pos=sum(max(0,x) for x in v)
                neg=sum(max(0,-x) for x in v)
                report.append({
                    "regime":regime,"rule":rule,
                    "additional_slippage_bps":slip,
                    "paths":40,"forced_short_signals":40,
                    "win_rate_pct":round(100*sum(x>0 for x in v)/40,3),
                    "mean_net_pct":round(sum(v)/40,6),
                    "price_pf":round(pos/neg,6) if neg else None,
                    "early_exit_count":sum(x["early_exit"] for x in bucket),
                    "median_zero_print_m5_bars":qtl([x["zero_volume_m5_bars"] for x in bucket],.5),
                    "p10_net_pct":qtl(v,.1),
                    "p90_net_pct":qtl(v,.9),
                })
    out={
        "schema":"prism7-p7-4-synthetic-8-regime-frozen-module-stress/v1",
        "seed_start":min(SEEDS),"seed_end":max(SEEDS),
        "regimes":list(REGIMES),"paths_per_regime":40,"m5_per_path":N,
        "generated_paths":len(REGIMES)*len(SEEDS),
        "strategy_signal_condition":"FORCED_SHORT_EACH_PATH_NOT_NATIVE_PENGU",
        "native_exit_substitute":"FORCED_HOLD_72H_NOT_PINNED_STOP",
        "source_p7_3_frozen_rules":list(RULES),
        "fee_bps":FEES_BPS,"slippage_bps":list(EXTRA_SLIP_BPS),
        "closed_m5_prefix_invariance_checks":prefix_checks,
        "ohlc_h1_aggregability_checks":"PASS_320_PATHS_BOTH_SYMBOLS",
        "rows":report,
        "limitations":[
            "Synthetic parameters are invented stress conditions, not calibrated independent venue truth.",
            "PENGU signal formation and native STOP are NOT executed; no claim of a full synthetic backtest.",
            "All paths force a SHORT by construction even when the market is strongly bullish.",
            "Only exit-intent and price-print proxy can be investigated, not order book, fill probability or native risk.",
            "Winrate and PF here belong to the artificial forced-short test, NOT actual SHORT V20.",
            "No portfolio risk, Gross, compounding or peak-to-trough DD reproduction.",
        ],
    }
    a.out_json.parent.mkdir(parents=True,exist_ok=True)
    a.out_json.write_text(json.dumps(out,sort_keys=True,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print("PRISM7_SYNTHETIC_MODULE_STRESS_PASS",len(REGIMES)*len(SEEDS),
          "paths",prefix_checks,"prefix_invariance")
    for r in report:
        if r["additional_slippage_bps"]==0 and r["rule"] in ("FORCED_HOLD_72H","BUY_FLOW_2UP","MICRO_BREAKOUT"):
            print(json.dumps(r,ensure_ascii=False))
    print("OUT",a.out_json)


if __name__=="__main__":
    main()
