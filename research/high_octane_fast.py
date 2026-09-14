#!/usr/bin/env python3
"""Representative five-round search using the same gates as the full run."""
from __future__ import annotations
import json
from pathlib import Path
import pandas as pd
from research import integrated_profit_portfolio as b
from research import high_octane_iterative as h

OUT = Path("backtest_output_high_octane_fast")


def r1(fx):
    ts = [b.TrendSpec("FT1", (7,21,63), .10), b.TrendSpec("FT2", (21,63,189), .15)]
    es = [b.EventSpec("FE1", 1.5, .5, 6), b.EventSpec("FE2", 2.5, 1.0, 18)]
    tt = {x.name:b.trend_target(fx,x) for x in ts}; et={x.name:b.event_target(fx,x) for x in es}
    out=[]; n=1
    for t in ts:
      for e in es:
       for ew in [.25,.55]:
        for vol in [.60,.90]:
         raw=(1-ew)*tt[t.name]+ew*et[e.name]
         out.append(h.Trial(1,"concentrated_trend_breakout",f"F1_{n:02d}",{"trend":t.name,"event":e.name,"event_weight":ew,"target_vol":vol},h.scale_target(raw,fx,vol,3.0,1.8))); n+=1
    return out


def r2(fx):
    out=[]; n=1
    for lb in [10,40]:
     for vz in [1.0,1.75]:
      for hold in [6,24]:
       for mode in ["all","regime"]:
        raw=h.squeeze_target(fx,lb,.20,vz,hold,mode)
        for vol in [.60,.90]:
         out.append(h.Trial(2,"volatility_squeeze_release",f"F2_{n:02d}",{"lookback":lb,"volume_z":vz,"hold":hold,"mode":mode,"target_vol":vol},h.scale_target(raw,fx,vol,3.0,2.2))); n+=1
    return out


def r3(fx):
    out=[]; n=1
    for hz in [(3,10,30),(14,42,84),(21,63,126)]:
     for k in [1,2]:
      for reb in [1,7]:
       spec=b.CrossSpec(f"FC{n}",hz,k,k,reb,0.0); raw=b.cross_target(fx,spec)
       for vol in [.60,.90]:
        out.append(h.Trial(3,"concentrated_relative_momentum",f"F3_{n:02d}_{int(vol*100)}",{"horizons":hz,"k":k,"rebalance":reb,"target_vol":vol},h.scale_target(raw,fx,vol,3.0,2.0)))
       n+=1
    return out


def r4(fx):
    out=[]; n=1
    for rz in [2.0,4.0]:
     for fz in [1.0,2.0]:
      for hold in [3,12]:
       for mode in ["reversal","continuation","squeeze"]:
        raw=h.shock_target(fx,rz,fz,hold,mode,True)
        for vol in [.60,.90]:
         out.append(h.Trial(4,"funding_shock_event",f"F4_{n:02d}_{int(vol*100)}",{"return_z":rz,"funding_z":fz,"hold":hold,"mode":mode,"target_vol":vol},h.scale_target(raw,fx,vol,3.0,2.2)))
        n+=1
    return out


def r5(fx,funding,best_targets):
    sr={n:b.simulate(fx,t,funding,risk_scale=.75).returns for n,t in best_targets.items()}; sr=pd.DataFrame(sr)
    out=[]; n=1
    for lb in [30,120]:
     for top in [1,2]:
      for reb in [3,14]:
       for vol in [.60,.90]:
        for gross in [2.0,3.0]:
         target=h.meta_target(best_targets,sr,lb,top,reb,fx,vol,gross)
         out.append(h.Trial(5,"adaptive_meta_allocator",f"F5_{n:02d}",{"lookback":lb,"top_k":top,"rebalance":reb,"target_vol":vol,"max_gross":gross},target)); n+=1
    return out


def main():
    OUT.mkdir(parents=True,exist_ok=True)
    b.base.SYMBOLS=b.UNIVERSE; b.base.START_MONTH=b.START_MONTH; b.base.END_MONTH=b.END_MONTH; b.base.CACHE_DIR=b.PRICE_CACHE
    data=b.base.load_universe(); panel=b.build_panel(data)
    idx=panel["close"].index; idx=idx[(idx>=h.DEV_START)&(idx<h.FINAL_END)]
    for k in panel: panel[k]=panel[k].loc[idx]
    funding,latest,coverage=b.load_funding(idx,list(panel["close"].columns)); fx=b.build_features(panel,latest)
    rows=[]; refs=[]; best_targets={}
    for no,builder in enumerate([r1,r2,r3,r4],start=1):
      ranking,best,sim,diag=h.evaluate_trials(builder(fx),fx,funding); ok,failed=h.acceptance(diag)
      ranking.to_csv(OUT/f"round_{no}_ranking.csv",index=False); best_targets[f"round_{no}"]=best.target
      refs.append({"round":no,"family":best.family,"best":best.name,"reflection":"accepted" if ok else "Rejected: "+", ".join(failed)+". Changed edge family next."})
      rows.append({"round":no,"family":best.family,"best":best.name,"params":json.dumps(best.params,sort_keys=True),**{f"holdout_{k}":v for k,v in diag["holdout"].items()},**{f"stress_{k}":v for k,v in diag["stress_10bps_funding_1p5x"].items()},**{f"delay_{k}":v for k,v in diag["delay_8h"].items()},**diag["bootstrap"],"accepted":ok,"failed_checks":";".join(failed)})
    ranking,best,sim,diag=h.evaluate_trials(r5(fx,funding,best_targets),fx,funding); ok,failed=h.acceptance(diag)
    ranking.to_csv(OUT/"round_5_ranking.csv",index=False)
    refs.append({"round":5,"family":best.family,"best":best.name,"reflection":"accepted" if ok else "Rejected: "+", ".join(failed)+". Five distinct rounds completed."})
    rows.append({"round":5,"family":best.family,"best":best.name,"params":json.dumps(best.params,sort_keys=True),**{f"holdout_{k}":v for k,v in diag["holdout"].items()},**{f"stress_{k}":v for k,v in diag["stress_10bps_funding_1p5x"].items()},**{f"delay_{k}":v for k,v in diag["delay_8h"].items()},**diag["bootstrap"],"accepted":ok,"failed_checks":";".join(failed)})
    pd.DataFrame(rows).to_csv(OUT/"five_round_summary.csv",index=False); pd.DataFrame(refs).to_csv(OUT/"five_round_reflections.csv",index=False)
    sim.returns.to_csv(OUT/"round5_returns.csv"); sim.positions.to_csv(OUT/"round5_positions.csv")
    lines=["# Representative Five-Round High-Octane Search","","|Round|Family|CAGR|Median month|Best month|Max DD|Sharpe|10bps stress CAGR|Accepted|","|---:|---|---:|---:|---:|---:|---:|---:|---|"]
    for x in rows: lines.append(f"|{x['round']}|{x['family']}|{x['holdout_cagr']:.2%}|{x['holdout_monthly_median']:.2%}|{x['holdout_monthly_best']:.2%}|{x['holdout_max_drawdown']:.2%}|{x['holdout_sharpe']:.2f}|{x['stress_cagr']:.2%}|{x['accepted']}|")
    lines += ["","## Reflections"]+[f"- Round {x['round']}: {x['reflection']}" for x in refs]+["","## Verdict","APPROVE FOR PAPER TEST ONLY" if any(x['accepted'] for x in rows) else "REJECT FOR DEPLOYMENT"]
    (OUT/"report.md").write_text("\n".join(lines),encoding="utf-8"); print("\n".join(lines))

if __name__=="__main__": main()
