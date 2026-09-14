#!/usr/bin/env python3
"""Round 9 fixed audit of the pre-holdout-selected dual-gate strategy."""
from __future__ import annotations
import json
from pathlib import Path
import numpy as np
import pandas as pd
from research import integrated_profit_portfolio as b
from research import high_octane_iterative as h
from research import high_octane_followup as f

OUT=Path("backtest_output_high_octane_round9")


def active_month_stats(sim):
    ret=h.b.cut(sim.returns,h.VAL_END,h.FINAL_END)
    pos=sim.positions.loc[ret.index]
    monthly=(1+ret).resample("ME").prod()-1
    gross=pos.abs().sum(axis=1).resample("ME").mean()
    active=gross>0.02
    ar=monthly[active]
    return {
        "calendar_months":int(len(monthly)),"active_months":int(active.sum()),
        "active_month_ratio":float(active.mean()),
        "active_month_median":float(ar.median()) if len(ar) else np.nan,
        "active_month_mean":float(ar.mean()) if len(ar) else np.nan,
        "active_month_positive_ratio":float((ar>0).mean()) if len(ar) else np.nan,
        "active_month_best":float(ar.max()) if len(ar) else np.nan,
        "active_month_worst":float(ar.min()) if len(ar) else np.nan,
        "zero_exposure_months":int((~active).sum()),
    },pd.DataFrame({"return":monthly,"average_gross":gross,"active":active})


def make_fixed(fx,funding,breadth,target_vol):
    r1,r5=f.reconstruct_sleeves(fx,funding)
    raw=.5*r1+.5*r5
    return f.trailing_gate_target(raw,fx,funding,60,.75,breadth,target_vol)


def main():
    OUT.mkdir(parents=True,exist_ok=True)
    b.base.SYMBOLS=b.UNIVERSE; b.base.START_MONTH=b.START_MONTH; b.base.END_MONTH=b.END_MONTH; b.base.CACHE_DIR=b.PRICE_CACHE
    data=b.base.load_universe(); panel=b.build_panel(data)
    idx=panel["close"].index; idx=idx[(idx>=h.DEV_START)&(idx<h.FINAL_END)]
    for k in panel: panel[k]=panel[k].loc[idx]
    funding,latest,coverage=b.load_funding(idx,list(panel["close"].columns)); fx=b.build_features(panel,latest)

    rows=[]; targets={}
    for breadth in [.4,.5,.6]:
      for vol in [.6,.9]:
        name=f"B{int(breadth*100)}V{int(vol*100)}"; target=make_fixed(fx,funding,breadth,vol); targets[name]=target
        sim=b.simulate(fx,target,funding); stats=h.report_stats(sim,h.VAL_END,h.FINAL_END); active,_=active_month_stats(sim)
        rows.append({"name":name,"breadth":breadth,"target_vol":vol,**stats,**active})
    neighborhood=pd.DataFrame(rows)
    neighborhood.to_csv(OUT/"fixed_neighborhood_holdout.csv",index=False)

    target=targets["B40V90"]
    base_sim=b.simulate(fx,target,funding)
    active,monthly=active_month_stats(base_sim); monthly.to_csv(OUT/"fixed_monthly_returns_and_exposure.csv")
    yearly=((1+h.b.cut(base_sim.returns,h.VAL_END,h.FINAL_END)).resample("YE").prod()-1); yearly.to_csv(OUT/"fixed_yearly_returns.csv")
    base_sim.positions.loc[(base_sim.positions.index>=h.VAL_END)&(base_sim.positions.index<h.FINAL_END)].to_csv(OUT/"fixed_positions.csv")
    base_sim.returns.loc[(base_sim.returns.index>=h.VAL_END)&(base_sim.returns.index<h.FINAL_END)].to_csv(OUT/"fixed_returns.csv")

    sensitivity=[]
    for cost in [6,10,15]:
      for fm in [1.0,1.5,2.0]:
       sim=b.simulate(fx,target,funding,one_way_cost=cost/10000,funding_multiplier=fm)
       sensitivity.append({"cost_bps":cost,"funding_multiplier":fm,**h.report_stats(sim,h.VAL_END,h.FINAL_END)})
    for delay in [1,2,3]:
      sim=b.simulate(fx,target,funding,delay_bars=delay)
      sensitivity.append({"cost_bps":6,"funding_multiplier":1.0,"delay_bars":delay,**h.report_stats(sim,h.VAL_END,h.FINAL_END)})
    for scale in [.75,1.0,1.25]:
      sim=b.simulate(fx,target,funding,risk_scale=scale)
      sensitivity.append({"cost_bps":6,"funding_multiplier":1.0,"risk_scale":scale,**h.report_stats(sim,h.VAL_END,h.FINAL_END)})
    pd.DataFrame(sensitivity).to_csv(OUT/"fixed_sensitivity.csv",index=False)

    asset_ret=fx["asset_return"].loc[base_sim.positions.index]
    hold_idx=base_sim.positions.index[(base_sim.positions.index>=h.VAL_END)&(base_sim.positions.index<h.FINAL_END)]
    gross_contrib=(base_sim.positions.loc[hold_idx]*asset_ret.loc[hold_idx]).sum().sort_values(ascending=False)
    gross_contrib.rename("gross_return_contribution").to_csv(OUT/"asset_contribution.csv")
    boot=h.bootstrap_risk(h.b.cut(base_sim.returns,h.VAL_END,h.FINAL_END),30000)
    fixed=h.report_stats(base_sim,h.VAL_END,h.FINAL_END)
    with open(OUT/"fixed_summary.json","w") as fh: json.dump({"stats":fixed,"active":active,"bootstrap":boot},fh,indent=2)

    near_positive=float((neighborhood.cagr>0).mean()); near_ge20=float((neighborhood.cagr>=.20).mean())
    lines=["# Round 9 Fixed Robustness Audit","",f"Fixed CAGR: {fixed['cagr']:.2%}",f"Fixed max DD: {fixed['max_drawdown']:.2%}",f"Fixed Sharpe: {fixed['sharpe']:.2f}",f"Best month: {fixed['monthly_best']:.2%}",f"Worst month: {fixed['monthly_worst']:.2%}",f"Active months: {active['active_months']}/{active['calendar_months']}",f"Active-month median: {active['active_month_median']:.2%}",f"Active-month win ratio: {active['active_month_positive_ratio']:.2%}",f"Nearby settings positive: {near_positive:.2%}",f"Nearby settings CAGR >=20%: {near_ge20:.2%}",f"Bootstrap P(loss): {boot['bootstrap_p_loss']:.2%}",f"Bootstrap P(DD<=-50%): {boot['bootstrap_p_dd50']:.2%}","","## Verdict","PAPER TEST CANDIDATE; NOT LIVE-DEPLOYMENT APPROVED"]
    (OUT/"report.md").write_text("\n".join(lines),encoding="utf-8"); print("\n".join(lines))

if __name__=="__main__": main()
