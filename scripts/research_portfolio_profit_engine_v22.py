"""Portfolio Profit Engine V22 — frozen V15 + idle cross-sectional spread.

Independent edge hypothesis after V20/V21 rejected further V15 entry/exit edits:
when V15 is CASH, absolute market direction may be weak but cross-sectional
leadership can still be strong. V22 therefore trades only relative performance.

Frozen rules before first result:
- V15 Trend is unchanged and always has priority;
- while V15 is CASH, at a 12H checkpoint choose the strongest V14-aligned
  positive asset as a 50% LONG leg and weakest V14-aligned negative asset as a
  50% SHORT leg;
- both signs must exist; no magnitude threshold or symbol-specific rule;
- total gross exposure = 50% + 50% = 100%, net exposure approximately 0%;
- hold the spread 84H or close exactly when the next V15 Trend position starts;
- Normal/Stress costs are charged to the full 100% gross spread;
- no leverage above 1.0x gross, no parameter grid, V/E selection, or Fresh OOS.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import research_pairwise_clean_sheet_3y as base
import research_portfolio_profit_engine_v8 as v8
import research_portfolio_profit_engine_v11 as v11
import research_portfolio_profit_engine_v14 as v14
import research_portfolio_profit_engine_v15 as v15
import research_portfolio_profit_engine_v17 as v17

HOUR = base.HOUR
CHECK_MS = 12 * HOUR
SPREAD_HOLD_HOURS = 84


def _spread_candidate(ts: int, features) -> dict[str, Any] | None:
    longs=[]; shorts=[]
    for symbol in v14.UNIVERSE:
        x=features[symbol].get(ts)
        if x is None:
            return None
        nm=float(x['normalizedMomentum20'])
        if x['close'] > x['sma50'] and nm > 0:
            longs.append((nm,symbol))
        if x['close'] < x['sma50'] and nm < 0:
            shorts.append((nm,symbol))
    if not longs or not shorts:
        return None
    longs.sort(key=lambda z:(-z[0],z[1])); shorts.sort(key=lambda z:(z[0],z[1]))
    lnm,ls=longs[0]; snm,ss=shorts[0]
    if ls==ss:
        return None
    return {'longSymbol':ls,'shortSymbol':ss,'longScore':float(lnm),'shortScore':float(snm),'score':float(lnm-snm)}


def _price(candles,index,symbol:str,ts:int,field:str='open') -> float | None:
    i=index[symbol].get(ts)
    if i is None:return None
    return float(candles[symbol][i][field])


def simulate_spread(candles,index,features,trend_records,start:int,end:int,cost_bps:float,delay_bars:int):
    timeline=[ts for ts in sorted(features['BTC']) if start<=ts<end and (ts-base.START_2023)%CHECK_MS==0]
    records=[]; available_after=start
    for ts in timeline:
        if ts < available_after or v17._trend_occupied(trend_records,ts):
            continue
        cand=_spread_candidate(ts,features)
        if cand is None:
            continue
        ls=str(cand['longSymbol']); ss=str(cand['shortSymbol'])
        li=index[ls].get(ts); si=index[ss].get(ts)
        if li is None or si is None:
            continue
        lei=li+1+delay_bars; sei=si+1+delay_bars
        if lei>=len(candles[ls]) or sei>=len(candles[ss]):
            continue
        entry_ts=max(int(candles[ls][lei]['ts']),int(candles[ss][sei]['ts']))
        if entry_ts>=end or v17._trend_occupied(trend_records,entry_ts):
            continue
        next_trend=v17._next_trend_entry(trend_records,entry_ts)
        planned_exit=entry_ts+SPREAD_HOLD_HOURS*HOUR
        exit_ts=min(planned_exit,next_trend) if next_trend is not None else planned_exit
        if exit_ts>=end:
            exit_ts=max(int(r['ts']) for r in candles[ls] if start<=int(r['ts'])<end)
        if exit_ts<=entry_ts:
            continue
        le=_price(candles,index,ls,entry_ts,'open'); se=_price(candles,index,ss,entry_ts,'open')
        lx=_price(candles,index,ls,exit_ts,'open'); sx=_price(candles,index,ss,exit_ts,'open')
        if None in (le,se,lx,sx):
            continue
        long_ret=(float(lx)/float(le)-1.0)*100.0
        short_ret=-(float(sx)/float(se)-1.0)*100.0
        gross=0.5*long_ret+0.5*short_ret
        net=gross-cost_bps/100.0
        records.append({
            'symbol':'SPREAD','side':'MARKET_NEUTRAL','sideSign':0,
            'longSymbol':ls,'shortSymbol':ss,
            'entryTs':entry_ts,'exitTs':exit_ts,
            'entryPrice':1.0,'exitPrice':1.0+gross/100.0,
            'longEntryPrice':float(le),'longExitPrice':float(lx),
            'shortEntryPrice':float(se),'shortExitPrice':float(sx),
            'longLegReturnPct':long_ret,'shortLegReturnPct':short_ret,
            'grossReturnPct':gross,'netReturnPct':net,'entryScore':float(cand['score']),
            'exitReason':'TREND_TAKEOVER' if next_trend is not None and exit_ts==next_trend else 'FIXED_84H_SPREAD_RELEASE',
            'holdingHours':int((exit_ts-entry_ts)//HOUR),'sleeve':'RELATIVE_VALUE',
        })
        available_after=exit_ts
    return records


def _combined_dd(records,candles,index,cost_bps:float) -> float:
    eq=1.0; peak=1.0; worst=0.0
    for r in sorted(records,key=lambda x:(int(x['entryTs']),int(x['exitTs']))):
        start_eq=eq; entry=int(r['entryTs']); exit_ts=int(r['exitTs'])
        # Hourly MTM while exposed; half the round-trip cost is conservatively
        # charged at entry for drawdown accounting.
        for ts in range(entry,exit_ts+1,HOUR):
            if r.get('sleeve')=='RELATIVE_VALUE':
                lp=_price(candles,index,str(r['longSymbol']),ts,'close'); sp=_price(candles,index,str(r['shortSymbol']),ts,'close')
                if lp is None or sp is None:continue
                lr=(float(lp)/float(r['longEntryPrice'])-1.0)*100.0
                sr=-(float(sp)/float(r['shortEntryPrice'])-1.0)*100.0
                mtm=0.5*lr+0.5*sr-cost_bps/200.0
            else:
                p=_price(candles,index,str(r['symbol']),ts,'close')
                if p is None:continue
                sign=int(r.get('sideSign',1)); mtm=sign*(float(p)/float(r['entryPrice'])-1.0)*100.0-cost_bps/200.0
            mark=start_eq*max(0.000001,1.0+mtm/100.0)
            peak=max(peak,mark); worst=min(worst,(mark/peak-1.0)*100.0)
        eq=start_eq*max(0.000001,1.0+float(r['netReturnPct'])/100.0)
        peak=max(peak,eq); worst=min(worst,(eq/peak-1.0)*100.0)
    return worst


def run_period(candles,index,features,start,end,cost_bps,delay_bars):
    trend_metric,trend_records=v15.simulate(candles,index,features,start,end,cost_bps,delay_bars)
    spread_records=simulate_spread(candles,index,features,trend_records,start,end,cost_bps,delay_bars)
    combined=v17._combine_records(trend_records,spread_records)
    dd=_combined_dd(combined,candles,index,cost_bps)
    metric=v8._metric(combined,start,end,dd)
    metric['trendTrades']=len(trend_records); metric['spreadTrades']=len(spread_records)
    metric['trendReturnPctStandalone']=float(trend_metric['returnPct'])
    metric['spreadArithmeticContributionPctPoints']=sum(float(r['netReturnPct']) for r in spread_records)
    metric['grossExposureCapPct']=100.0; metric['spreadNetExposurePct']=0.0
    return metric,combined,spread_records


def main():
    candles,index,_=base.v109.b.base.load(); features=v11._sampled_features(candles)
    annual={}; annual_stress={}
    for label in ('development','validation','evaluation'):
        a,b=base.PERIODS[label]; annual[label],_,_=run_period(candles,index,features,a,b,v8.NORMAL_BPS,0); annual_stress[label],_,_=run_period(candles,index,features,a,b,v8.STRESS_BPS,v8.STRESS_DELAY)
    a,b=base.PERIODS['combined']; combined,records,spread=run_period(candles,index,features,a,b,v8.NORMAL_BPS,0); stress,_,_=run_period(candles,index,features,a,b,v8.STRESS_BPS,v8.STRESS_DELAY)
    gate=v8._historical_gate(combined,stress,annual)
    out={
      'researchLine':'PORTFOLIO_PROFIT_ENGINE_V22_V15_PLUS_IDLE_RELATIVE_VALUE',
      'researchOnly':True,'productionChanged':False,'vpsChanged':False,'liveChanged':False,'realTradingEnabled':False,'liveEligible':False,
      'freshOosRead':False,'freshOosConsumed':False,'freshOosPermission':bool(gate['historicalCandidatePass']),
      'target':{'main3YCagrPct':100.0,'progressFloorCagrPct':80.0,'grossExposureCapPct':100.0,'leverageMultiplier':1.0},
      'architecture':'Frozen V15 Trend priority -> idle 50/50 strongest-long weakest-short relative-value spread -> 84H release / exact Trend takeover',
      'spreadRule':{'longAllocationPct':50.0,'shortAllocationPct':50.0,'grossPct':100.0,'netPctApprox':0.0,'holdHours':SPREAD_HOLD_HOURS,'magnitudeThreshold':None},
      'diagnosisBasis':{'source':'V20/V21 rejection and V15 2024-25 cross-symbol divergence','finding':'absolute direction failed while LINK strongly outperformed AVAX/SOL; isolate cross-sectional spread rather than retune V15'},
      'antiOverfit':{'parameterGrid':False,'perSymbolParameters':False,'sameRunRetuning':False,'developmentSelection':False,'validationUsedForSelection':False,'evaluationUsedForSelection':False,'freshOosUsedForTuning':False,'leverageUsedToReachTarget':False},
      'costs':{'normalTotalBpsPerRoundTrip':v8.NORMAL_BPS,'stressTotalBpsPerRoundTrip':v8.STRESS_BPS,'stressExtraDelayBars':v8.STRESS_DELAY},
      'periods':base.PERIODS,'annual':annual,'annualStress':annual_stress,'combined3Y':combined,'combined3YStress':stress,'historicalGate':gate,
      'spreadTrades3Y':len(spread),
    }
    root=Path(os.environ.get('RESEARCH_STATE_DIR','.research-state')); root.mkdir(parents=True,exist_ok=True)
    (root/'portfolio-profit-engine-v22.json').write_text(json.dumps(out,indent=2,sort_keys=True),encoding='utf-8')
    with (root/'portfolio-profit-engine-v22-trades.jsonl').open('w',encoding='utf-8') as fh:
        for r in records:fh.write(json.dumps(r,sort_keys=True)+'\n')
    print(json.dumps(out,indent=2,sort_keys=True))

if __name__=='__main__':main()
