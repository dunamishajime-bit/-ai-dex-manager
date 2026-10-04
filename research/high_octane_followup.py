#!/usr/bin/env python3
"""Rounds 6-8: learn from five rejected high-octane families."""
from __future__ import annotations
import json, math
from pathlib import Path
import numpy as np
import pandas as pd
from research import integrated_profit_portfolio as b
from research import high_octane_iterative as h

OUT=Path("backtest_output_high_octane_followup")


def reconstruct_sleeves(fx,funding):
    t=b.trend_target(fx,b.TrendSpec("FT1",(7,21,63),.10))
    e=b.event_target(fx,b.EventSpec("FE2",2.5,1.0,18))
    r1=h.scale_target(.45*t+.55*e,fx,.60,3.0,1.8)
    r2=h.scale_target(h.squeeze_target(fx,10,.20,1.75,24,"all"),fx,.60,3.0,2.2)
    c=b.cross_target(fx,b.CrossSpec("FC",(14,42,84),1,1,1,0.0))
    r3=h.scale_target(c,fx,.60,3.0,2.0)
    r4=h.scale_target(h.shock_target(fx,4.0,1.0,3,"continuation",True),fx,.90,3.0,2.2)
    sleeves={"r1":r1,"r2":r2,"r3":r3,"r4":r4}
    sr=pd.DataFrame({n:b.simulate(fx,x,funding,risk_scale=.75).returns for n,x in sleeves.items()})
    r5=h.meta_target(sleeves,sr,30,1,3,fx,.90,2.0)
    return r1,r5


def market_state(fx):
    close=fx["close"]
    ema60=close.ewm(span=60*6,adjust=False,min_periods=45*6).mean()
    mom30=close/close.shift(30*6)-1
    breadth=((close>ema60)&(mom30>0)&fx["available"]).sum(axis=1)/fx["available"].sum(axis=1).replace(0,np.nan)
    btc=close["BTCUSDT"]
    btc200=btc.ewm(span=200*6,adjust=False,min_periods=150*6).mean()
    btc30=btc/btc.shift(30*6)-1
    return breadth.fillna(.5),btc,btc200,btc30


def gate_target(target,fx,bull_breadth,bear_breadth,require_btc):
    breadth,btc,btc200,btc30=market_state(fx)
    bull=(breadth>=bull_breadth)
    bear=(breadth<=bear_breadth)
    if require_btc:
        bull &= (btc>btc200)&(btc30>0)
        bear &= (btc<btc200)&(btc30<0)
    out=target.copy()
    out=out.where(~((out>0).mul(~bull,axis=0)),0.0)
    out=out.where(~((out<0).mul(~bear,axis=0)),0.0)
    return out


def round6(fx,r1):
    out=[]; n=1
    for bull in [.45,.55,.65]:
     for bear in [.25,.35,.45]:
      for require in [False,True]:
       raw=gate_target(r1,fx,bull,bear,require)
       for vol in [.60,.90]:
        out.append(h.Trial(6,"breadth_gated_burst",f"R6_{n:02d}",{"bull_breadth":bull,"bear_breadth":bear,"require_btc":require,"target_vol":vol},h.scale_target(raw,fx,vol,3.0,1.5))); n+=1
    return out


def long_leader_target(fx,k,rebalance,breadth_floor,horizons):
    close,rv=fx["close"],fx["rv21"]
    score=b.momentum_score(close,rv,horizons)
    breadth,btc,btc200,btc30=market_state(fx)
    target=pd.DataFrame(0.0,index=close.index,columns=close.columns)
    reb=rebalance*6
    for i in range(200*6,len(close)-1):
        if i%reb:
            target.iloc[i]=target.iloc[i-1]; continue
        risk_on=bool((breadth.iloc[i]>=breadth_floor) and (btc.iloc[i]>btc200.iloc[i]) and (btc30.iloc[i]>0))
        if not risk_on:
            continue
        names=b.valid_liquid_symbols(fx,i,limit=10)
        row=score.iloc[i][names].dropna().sort_values(ascending=False)
        funding=fx["funding_z"].iloc[i]
        leaders=[s for s in row.head(k*2).index if not np.isfinite(funding.get(s,np.nan)) or funding[s]<2.0][:k]
        w=b.inverse_vol_weights(leaders,1.0,rv.iloc[i],1.0,.55)
        target.loc[target.index[i],w.index]=w
    return target.ffill().fillna(0.0)


def round7(fx):
    out=[]; n=1
    for k in [1,2,3]:
     for reb in [1,3,7]:
      for breadth in [.45,.55,.65]:
       for hz in [(7,21,63),(14,42,84)]:
        raw=long_leader_target(fx,k,reb,breadth,hz)
        for vol in [.60,.90]:
         out.append(h.Trial(7,"bull_leader_long_only",f"R7_{n:03d}",{"k":k,"rebalance":reb,"breadth":breadth,"horizons":hz,"target_vol":vol},h.scale_target(raw,fx,vol,3.0,2.0))); n+=1
    return out


def trailing_gate_target(raw,fx,funding,lookback_days,min_sharpe,breadth_floor,target_vol):
    baseline=b.simulate(fx,raw,funding,risk_scale=.75).returns
    window=lookback_days*6
    mu=baseline.rolling(window,min_periods=max(30,window//2)).mean().shift(1)
    sd=baseline.rolling(window,min_periods=max(30,window//2)).std().shift(1)
    sh=mu/sd.replace(0,np.nan)*math.sqrt(b.ANNUAL_BARS)
    breadth,btc,btc200,btc30=market_state(fx)
    on=(sh>=min_sharpe)&(breadth>=breadth_floor)&(btc>btc200)&(btc30>0)
    gated=raw.mul(on.astype(float),axis=0)
    return h.scale_target(gated,fx,target_vol,3.0,1.7)


def round8(fx,funding,r1,r5):
    out=[]; n=1
    for mix in [.25,.50,.75]:
     raw=mix*r1+(1-mix)*r5
     for lb in [30,60,120]:
      for msh in [-.25,.25,.75]:
       for breadth in [.40,.50,.60]:
        for vol in [.60,.90]:
         target=trailing_gate_target(raw,fx,funding,lb,msh,breadth,vol)
         out.append(h.Trial(8,"dual_performance_market_gate",f"R8_{n:03d}",{"r1_weight":mix,"lookback":lb,"min_sharpe":msh,"breadth":breadth,"target_vol":vol},target)); n+=1
    return out


def main():
    OUT.mkdir(parents=True,exist_ok=True)
    b.base.SYMBOLS=b.UNIVERSE; b.base.START_MONTH=b.START_MONTH; b.base.END_MONTH=b.END_MONTH; b.base.CACHE_DIR=b.PRICE_CACHE
    data=b.base.load_universe(); panel=b.build_panel(data)
    idx=panel["close"].index; idx=idx[(idx>=h.DEV_START)&(idx<h.FINAL_END)]
    for k in panel: panel[k]=panel[k].loc[idx]
    funding,latest,coverage=b.load_funding(idx,list(panel["close"].columns)); fx=b.build_features(panel,latest)
    r1,r5=reconstruct_sleeves(fx,funding)
    rows=[]; refs=[]
    for no,trials in [(6,round6(fx,r1)),(7,round7(fx)),(8,round8(fx,funding,r1,r5))]:
        ranking,best,sim,diag=h.evaluate_trials(trials,fx,funding); ok,failed=h.acceptance(diag)
        ranking.to_csv(OUT/f"round_{no}_ranking.csv",index=False)
        rows.append({"round":no,"family":best.family,"best":best.name,"params":json.dumps(best.params,sort_keys=True),**{f"holdout_{k}":v for k,v in diag["holdout"].items()},**{f"stress_{k}":v for k,v in diag["stress_10bps_funding_1p5x"].items()},**{f"delay_{k}":v for k,v in diag["delay_8h"].items()},**diag["bootstrap"],"accepted":ok,"failed_checks":";".join(failed)})
        refs.append({"round":no,"reflection":"accepted" if ok else "Rejected: "+", ".join(failed)})
    pd.DataFrame(rows).to_csv(OUT/"followup_summary.csv",index=False); pd.DataFrame(refs).to_csv(OUT/"followup_reflections.csv",index=False)
    lines=["# High-Octane Rejection-Learning Follow-up","","|Round|Family|CAGR|Median month|Best month|Max DD|Sharpe|Stress CAGR|Accepted|","|---:|---|---:|---:|---:|---:|---:|---:|---|"]
    for x in rows: lines.append(f"|{x['round']}|{x['family']}|{x['holdout_cagr']:.2%}|{x['holdout_monthly_median']:.2%}|{x['holdout_monthly_best']:.2%}|{x['holdout_max_drawdown']:.2%}|{x['holdout_sharpe']:.2f}|{x['stress_cagr']:.2%}|{x['accepted']}|")
    lines += ["","## Verdict","APPROVE FOR PAPER TEST ONLY" if any(x['accepted'] for x in rows) else "REJECT FOR DEPLOYMENT"]
    (OUT/"report.md").write_text("\n".join(lines),encoding="utf-8"); print("\n".join(lines))

if __name__=="__main__": main()
