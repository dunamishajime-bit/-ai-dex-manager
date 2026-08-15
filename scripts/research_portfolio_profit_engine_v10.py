"""Portfolio Profit Engine V10 — slow regime/cross-pair momentum rotation.

V8/V9 showed that event-first entry timing creates a false-positive loss pool.
V10 removes that event architecture entirely. Capital decisions are made on a
fixed 84-hour schedule from persistent 30d/7d/3d ownership state, with BTC +
universe regime direction and cross-sectional pair selection.

One position maximum, 100% gross exposure cap, 1.0x leverage. No per-symbol
parameters, no grid, no Validation/Evaluation selection, no Fresh OOS access.
"""
from __future__ import annotations

import json
import os
import statistics
from pathlib import Path
from typing import Any

import research_pairwise_clean_sheet_3y as base
import research_portfolio_profit_engine_v8 as v8

HOUR=base.HOUR
REBALANCE_HOURS=84
REGIME_THRESHOLD=0.25
MIN_BREADTH_ALIGNMENT=0.40
MIN_OWN_Z720=0.25
MIN_OWN_Z168=0.10
MIN_OWN_Z72=-0.25
MIN_EFF=0.12
KEEP_RANK=2
EMERGENCY_STOP_PCT=10.0


def ranked_desired(ts:int,features,current:dict[str,Any]|None=None):
    btc=features[v8.REFERENCE_SYMBOL].get(ts)
    xs={s:features[s].get(ts) for s in v8.TRADE_SYMBOLS}
    if btc is None or any(x is None for x in xs.values()): return None,{'state':'NO_FEATURE'}
    med720=statistics.median(float(x['z720']) for x in xs.values())
    regime_strength=0.65*float(btc['z720'])+0.35*med720
    if regime_strength>=REGIME_THRESHOLD: side=1
    elif regime_strength<=-REGIME_THRESHOLD: side=-1
    else:return None,{'state':'CASH_MIXED','regimeStrength':regime_strength,'medianZ720':med720,'btcZ720':float(btc['z720'])}
    breadth=sum(side*float(x['z168'])>0 for x in xs.values())/len(xs)
    if breadth<MIN_BREADTH_ALIGNMENT:
        return None,{'state':'CASH_BREADTH','side':side,'breadth':breadth,'regimeStrength':regime_strength}
    ranked=[]
    for symbol,x in xs.items():
        if side*float(x['z720'])<MIN_OWN_Z720: continue
        if side*float(x['z168'])<MIN_OWN_Z168: continue
        if side*float(x['z72'])<MIN_OWN_Z72: continue
        if float(x['eff168'])<MIN_EFF: continue
        score=(0.45*side*float(x['z168'])+0.35*side*float(x['z720'])+0.15*side*float(x['z72'])+0.25*float(x['eff168']))
        ranked.append({'symbol':symbol,'sideSign':side,'score':score,'z720':float(x['z720']),'z168':float(x['z168']),'z72':float(x['z72']),'eff168':float(x['eff168'])})
    ranked.sort(key=lambda r:(-float(r['score']),r['symbol']))
    if not ranked:return None,{'state':'CASH_NO_OWNED_PAIR','side':side,'breadth':breadth,'regimeStrength':regime_strength}
    chosen=ranked[0]
    if current is not None and int(current['sideSign'])==side:
        for rank,row in enumerate(ranked[:KEEP_RANK],1):
            if row['symbol']==current['symbol']:
                chosen=row|{'retainedRank':rank};break
    return chosen,{'state':'INVESTED','side':side,'breadth':breadth,'regimeStrength':regime_strength,'ranked':ranked[:5]}


def simulate(candles,index,features,start:int,end:int,cost_bps:float,delay_bars:int):
    timeline=[int(r['ts']) for r in candles[v8.REFERENCE_SYMBOL] if start<=int(r['ts'])<end]
    equity=1.0;peak=1.0;dd=0.0;position=None;pending=None;records=[]

    def update_mtm(ts:int):
        nonlocal peak,dd
        if position is None:
            peak=max(peak,equity);dd=min(dd,(equity/peak-1)*100);return
        s=str(position['symbol']);i=index[s].get(ts)
        if i is None:return
        px=float(candles[s][i]['close']);side=int(position['sideSign']);entry=float(position['entryPrice'])
        pct=side*(px/entry-1)*100;mtm=float(position['entryEquity'])*max(0.000001,1+pct/100)
        peak=max(peak,mtm);dd=min(dd,(mtm/peak-1)*100)

    def execute(ts:int,desired,reason:str,decision_ts:int):
        nonlocal equity,position,peak,dd
        if position is not None:
            s=str(position['symbol']);i=index[s].get(ts)
            if i is None:raise RuntimeError(f'V10_EXIT_INDEX_MISSING:{s}:{ts}')
            price=float(candles[s][i]['open']);side=int(position['sideSign']);entry=float(position['entryPrice'])
            gross=side*(price/entry-1)*100;net=gross-cost_bps/100
            before=float(position['entryEquity']);equity=before*max(0.000001,1+net/100)
            records.append({'symbol':s,'side':'LONG' if side>0 else 'SHORT','sideSign':side,'entryTs':int(position['entryTs']),'exitTs':ts,
                'entryPrice':entry,'exitPrice':price,'grossReturnPct':gross,'netReturnPct':net,'entryScore':float(position['entryScore']),
                'exitReason':reason,'decisionTs':decision_ts,'holdingHours':int((ts-int(position['entryTs']))//HOUR),'equityBefore':before,'equityAfter':equity})
            position=None;peak=max(peak,equity);dd=min(dd,(equity/peak-1)*100)
        if desired is not None:
            s=str(desired['symbol']);i=index[s].get(ts)
            if i is None:raise RuntimeError(f'V10_ENTRY_INDEX_MISSING:{s}:{ts}')
            price=float(candles[s][i]['open'])
            position={'symbol':s,'sideSign':int(desired['sideSign']),'entryTs':ts,'entryPrice':price,'entryScore':float(desired['score']),'entryEquity':equity}

    for ts in timeline:
        if pending is not None and ts>=int(pending['executeTs']):
            execute(int(pending['executeTs']),pending['desired'],str(pending['reason']),int(pending['decisionTs']));pending=None
        update_mtm(ts)
        if pending is not None:continue
        if position is not None:
            s=str(position['symbol']);i=index[s].get(ts)
            if i is not None:
                px=float(candles[s][i]['close']);pct=int(position['sideSign'])*(px/float(position['entryPrice'])-1)*100
                if pct<=-EMERGENCY_STOP_PCT:
                    ei=i+1+delay_bars
                    if ei<len(candles[s]) and int(candles[s][ei]['ts'])<end:
                        pending={'executeTs':int(candles[s][ei]['ts']),'desired':None,'reason':'EMERGENCY_STOP','decisionTs':ts}
                        continue
        if (ts-base.START_2023)%(REBALANCE_HOURS*HOUR)!=0:continue
        desired,ctx=ranked_desired(ts,features,position)
        same=bool(position is not None and desired is not None and position['symbol']==desired['symbol'] and int(position['sideSign'])==int(desired['sideSign']))
        if same:continue
        if position is None and desired is None:continue
        ref_symbol=str(position['symbol']) if position is not None else str(desired['symbol'])
        i=index[ref_symbol].get(ts)
        if i is None:continue
        ei=i+1+delay_bars
        if ei>=len(candles[ref_symbol]):continue
        ex_ts=int(candles[ref_symbol][ei]['ts'])
        if ex_ts>=end:continue
        reason='REGIME_TO_CASH' if desired is None else 'SCHEDULED_ROTATION' if position is not None else 'SCHEDULED_ENTRY'
        pending={'executeTs':ex_ts,'desired':desired,'reason':reason,'decisionTs':ts}

    pending=None
    if position is not None:
        s=str(position['symbol']);final_ts=max(int(r['ts']) for r in candles[s] if start<=int(r['ts'])<end);i=index[s][final_ts]
        price=float(candles[s][i]['close']);side=int(position['sideSign']);entry=float(position['entryPrice'])
        gross=side*(price/entry-1)*100;net=gross-cost_bps/100;before=float(position['entryEquity']);equity=before*max(0.000001,1+net/100)
        records.append({'symbol':s,'side':'LONG' if side>0 else 'SHORT','sideSign':side,'entryTs':int(position['entryTs']),'exitTs':final_ts,
            'entryPrice':entry,'exitPrice':price,'grossReturnPct':gross,'netReturnPct':net,'entryScore':float(position['entryScore']),'exitReason':'PERIOD_END',
            'decisionTs':final_ts,'holdingHours':int((final_ts-int(position['entryTs']))//HOUR),'equityBefore':before,'equityAfter':equity})
        peak=max(peak,equity);dd=min(dd,(equity/peak-1)*100)
    return v8._metric(records,start,end,dd),records


def main():
    candles,index,_=base.v109.b.base.load();features=v8.build_features(candles)
    annual={};annual_stress={}
    for label in ('development','validation','evaluation'):
        a,b=base.PERIODS[label];annual[label],_=simulate(candles,index,features,a,b,v8.NORMAL_BPS,0);annual_stress[label],_=simulate(candles,index,features,a,b,v8.STRESS_BPS,v8.STRESS_DELAY)
    a,b=base.PERIODS['combined'];combined,records=simulate(candles,index,features,a,b,v8.NORMAL_BPS,0);stress,_=simulate(candles,index,features,a,b,v8.STRESS_BPS,v8.STRESS_DELAY)
    gate=v8._historical_gate(combined,stress,annual)
    out={'researchLine':'PORTFOLIO_PROFIT_ENGINE_V10_SLOW_REGIME_ROTATION','researchOnly':True,'productionChanged':False,'vpsChanged':False,'liveChanged':False,
        'realTradingEnabled':False,'liveEligible':False,'freshOosRead':False,'freshOosConsumed':False,'freshOosPermission':bool(gate['historicalCandidatePass']),
        'target':{'main3YCagrPct':100.0,'progressFloorCagrPct':80.0,'grossExposureCapPct':100.0,'leverageMultiplier':1.0},
        'architecture':'Persistent market regime -> fixed 84h rebalance -> cross-pair momentum ownership -> top-2 retention -> rotation/cash',
        'diagnosisBasis':{'source':'V8/V9 lifecycle failure','finding':'event recognition/confirmation is not a stable profit source; replace event entries with persistent carry/rotation','eventOpportunityImported':False},
        'antiOverfit':{'parameterGrid':False,'perSymbolParameters':False,'sameRunRetuning':False,'validationUsedForSelection':False,'evaluationUsedForSelection':False,'freshOosUsedForTuning':False,'leverageUsedToReachTarget':False,'onePositionMaximum':True},
        'schedule':{'rebalanceHours':REBALANCE_HOURS,'keepCurrentIfRankAtMost':KEEP_RANK,'emergencyStopPct':EMERGENCY_STOP_PCT},
        'costs':{'normalTotalBpsPerRoundTrip':v8.NORMAL_BPS,'stressTotalBpsPerRoundTrip':v8.STRESS_BPS,'stressExtraDelayBars':v8.STRESS_DELAY},
        'periods':base.PERIODS,'annual':annual,'annualStress':annual_stress,'combined3Y':combined,'combined3YStress':stress,'historicalGate':gate}
    root=Path(os.environ.get('RESEARCH_STATE_DIR','.research-state'));root.mkdir(parents=True,exist_ok=True)
    (root/'portfolio-profit-engine-v10.json').write_text(json.dumps(out,indent=2,sort_keys=True),encoding='utf-8')
    with (root/'portfolio-profit-engine-v10-trades.jsonl').open('w',encoding='utf-8') as fh:
        for r in records:fh.write(json.dumps(r,sort_keys=True)+'\n')
    print(json.dumps(out,indent=2,sort_keys=True))

if __name__=='__main__':main()
