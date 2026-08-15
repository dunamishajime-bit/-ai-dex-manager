"""Portfolio Profit Engine V9 — Scout -> Provisional -> Owned lifecycle.

V9 is a structural response to the V8 *Development* exit taxonomy: profitable
trades were monetized by PROFIT_RELEASE / STRONGER_WAVE_ROTATION, while the
large loss pool came from entering the first detected wave before ownership had
been demonstrated. V9 therefore does not change V8 opportunity thresholds or
score weights. It freezes them and rebuilds the lifecycle around a zero-capital
Scout period and a provisional proof state.

No Validation/Evaluation statistic selects a V9 constant. No Fresh OOS is read.
Gross exposure remains <=100%, one position maximum, leverage 1.0x.
"""
from __future__ import annotations

import json
import math
import os
from pathlib import Path
from typing import Any

import research_pairwise_clean_sheet_3y as base
import research_portfolio_profit_engine_v8 as v8

HOUR = base.HOUR
SCOUT_CONFIRM_HOURS = 6
SCOUT_TOP_N = 2
PROVISIONAL_MIN_HOURS = 2
PROVISIONAL_GRADUATE_HOURS = 6
PROVISIONAL_MAX_HOURS = 12
PROVISIONAL_MISS_LIMIT = 2
COOLDOWN_HOURS = 3


def simulate(candles, index, features, start: int, end: int, cost_bps: float, delay_bars: int):
    timeline=[int(r['ts']) for r in candles[v8.REFERENCE_SYMBOL] if start <= int(r['ts']) < end]
    equity=1.0; equity_peak=1.0; max_dd=0.0
    position=None; pending_entry=None; pending_exit=None; scout=None
    cooldown_until=start; records=[]

    def current_close(symbol: str, ts: int) -> float | None:
        i=index[symbol].get(ts)
        return float(candles[symbol][i]['close']) if i is not None else None

    def update_mtm(ts: int) -> None:
        nonlocal equity_peak,max_dd
        if position is None:
            equity_peak=max(equity_peak,equity)
            max_dd=min(max_dd,(equity/equity_peak-1.0)*100.0)
            return
        symbol=str(position['symbol']); i=index[symbol].get(ts)
        if i is None:return
        row=candles[symbol][i]; side=int(position['sideSign']); entry=float(position['entryPrice'])
        pct=side*(float(row['close'])/entry-1.0)*100.0
        mtm=float(position['entryEquity'])*max(0.000001,1.0+pct/100.0)
        equity_peak=max(equity_peak,mtm); max_dd=min(max_dd,(mtm/equity_peak-1.0)*100.0)
        if side>0: position['bestPrice']=max(float(position['bestPrice']),float(row['high']))
        else: position['bestPrice']=min(float(position['bestPrice']),float(row['low']))

    def start_scout(top: dict[str,Any], ts: int) -> dict[str,Any] | None:
        px=current_close(str(top['symbol']),ts)
        if px is None:return None
        return {'symbol':str(top['symbol']),'sideSign':int(top['sideSign']),'firstTs':ts,'firstClose':px,'firstScore':float(top['score'])}

    for ts in timeline:
        if pending_exit is not None and position is not None and ts >= int(pending_exit['executeTs']):
            symbol=str(position['symbol']); ex_ts=int(pending_exit['executeTs']); i=index[symbol].get(ex_ts)
            if i is None: raise RuntimeError(f'V9_EXIT_INDEX_MISSING:{symbol}:{ex_ts}')
            price=float(candles[symbol][i]['open']); side=int(position['sideSign']); entry=float(position['entryPrice'])
            gross=side*(price/entry-1.0)*100.0; net=gross-cost_bps/100.0
            before=float(position['entryEquity']); equity=before*max(0.000001,1.0+net/100.0)
            records.append({
                'symbol':symbol,'side':'LONG' if side>0 else 'SHORT','sideSign':side,
                'signalTs':int(position['signalTs']),'scoutFirstTs':int(position['scoutFirstTs']),
                'entryTs':int(position['entryTs']),'exitSignalTs':int(pending_exit['signalTs']),'exitTs':ex_ts,
                'entryPrice':entry,'exitPrice':price,'grossReturnPct':gross,'netReturnPct':net,
                'entryScore':float(position['entryScore']),'exitReason':str(pending_exit['reason']),
                'holdingHours':int((ex_ts-int(position['entryTs']))//HOUR),'ownershipStageAtExit':str(position['stage']),
                'equityBefore':before,'equityAfter':equity,
            })
            position=None; pending_exit=None; scout=None; cooldown_until=ts+COOLDOWN_HOURS*HOUR
            update_mtm(ts); continue

        if pending_entry is not None and position is None and ts >= int(pending_entry['executeTs']):
            symbol=str(pending_entry['symbol']); ex_ts=int(pending_entry['executeTs']); i=index[symbol].get(ex_ts)
            if i is not None and ex_ts<end:
                price=float(candles[symbol][i]['open'])
                position={
                    'symbol':symbol,'sideSign':int(pending_entry['sideSign']),'signalTs':int(pending_entry['signalTs']),
                    'scoutFirstTs':int(pending_entry['scoutFirstTs']),'entryTs':ex_ts,'entryPrice':price,
                    'bestPrice':price,'entryScore':float(pending_entry['score']),'entryEquity':equity,
                    'stage':'PROVISIONAL','missCount':0,
                }
            pending_entry=None; scout=None

        update_mtm(ts)

        if position is not None:
            if pending_exit is not None: continue
            symbol=str(position['symbol']); side=int(position['sideSign']); i=index[symbol].get(ts); x=features[symbol].get(ts)
            if i is None or x is None: continue
            row=candles[symbol][i]; entry=float(position['entryPrice'])
            current_pct=side*(float(row['close'])/entry-1.0)*100.0
            if side>0: mfe=(float(position['bestPrice'])/entry-1.0)*100.0
            else: mfe=(entry-float(position['bestPrice']))/entry*100.0
            held=int((ts-int(position['entryTs']))//HOUR)
            expected24=float(x['sd168PctHourly'])*math.sqrt(24.0)
            stop_pct=max(2.5,min(8.0,1.8*expected24)); trail_trigger=max(2.5,1.2*expected24)
            ranked=v8._opportunities(ts,features)
            current_opp=next((r for r in ranked if r['symbol']==symbol and int(r['sideSign'])==side),None)
            reason=None

            if current_pct <= -stop_pct:
                reason='VOL_ADAPTIVE_STOP'
            elif position['stage']=='PROVISIONAL':
                position['missCount'] = 0 if current_opp is not None else int(position['missCount'])+1
                if held >= PROVISIONAL_MIN_HOURS and int(position['missCount']) >= PROVISIONAL_MISS_LIMIT:
                    reason='ENTRY_PROOF_FAILED'
                elif held >= PROVISIONAL_GRADUATE_HOURS and current_opp is not None and current_pct > 0:
                    position['stage']='OWNED'
                elif held >= PROVISIONAL_MAX_HOURS:
                    reason='ENTRY_PROOF_TIMEOUT'
            else:
                if held >= v8.MIN_HOLD_HOURS and side*float(x['z24']) < v8.OWNERSHIP_Z24_FAIL and side*float(x['z72']) < v8.OWNERSHIP_Z72_FLOOR:
                    reason='OWNERSHIP_LOST'
                elif held >= v8.MIN_HOLD_HOURS and mfe >= trail_trigger and (current_pct/max(mfe,1e-9)) < v8.TRAIL_CAPTURE_FLOOR:
                    reason='PROFIT_RELEASE'
                elif held >= v8.MAX_HOLD_HOURS:
                    reason='MAX_HOLD'
                else:
                    top=ranked[0] if ranked else None
                    current_score=float(current_opp['score']) if current_opp else -999.0
                    if (top is not None and top['symbol']!=symbol and float(top['score']) >= max(v8.MIN_OPPORTUNITY_SCORE,current_score+v8.ROTATION_ADVANTAGE)
                        and (current_opp is None or side*float(x['z24'])<0.15)):
                        reason='STRONGER_WAVE_ROTATION'
            if reason is not None:
                ei=i+1+delay_bars
                if ei<len(candles[symbol]) and int(candles[symbol][ei]['ts'])<end:
                    pending_exit={'reason':reason,'signalTs':ts,'executeTs':int(candles[symbol][ei]['ts'])}
            continue

        if pending_entry is not None or ts<cooldown_until: continue
        ranked=v8._opportunities(ts,features)
        if not ranked:
            scout=None; continue
        top=ranked[0]
        if scout is None:
            scout=start_scout(top,ts); continue
        eligible=next((r for r in ranked[:SCOUT_TOP_N] if r['symbol']==scout['symbol'] and int(r['sideSign'])==int(scout['sideSign'])),None)
        if eligible is None:
            scout=start_scout(top,ts); continue
        elapsed=int((ts-int(scout['firstTs']))//HOUR)
        px=current_close(str(scout['symbol']),ts)
        if px is None: continue
        follow=int(scout['sideSign'])*(px/float(scout['firstClose'])-1.0)*100.0
        if elapsed < SCOUT_CONFIRM_HOURS or follow <= 0: continue
        symbol=str(scout['symbol']); i=index[symbol].get(ts)
        if i is None: continue
        ei=i+1+delay_bars
        if ei>=len(candles[symbol]): continue
        execute_ts=int(candles[symbol][ei]['ts'])
        if execute_ts>=end: continue
        pending_entry={
            'symbol':symbol,'sideSign':int(scout['sideSign']),'score':float(eligible['score']),
            'signalTs':ts,'scoutFirstTs':int(scout['firstTs']),'executeTs':execute_ts,
        }

    pending_entry=None; scout=None
    if position is not None:
        symbol=str(position['symbol']); side=int(position['sideSign'])
        final_ts=max(int(r['ts']) for r in candles[symbol] if start<=int(r['ts'])<end); i=index[symbol][final_ts]
        price=float(candles[symbol][i]['close']); entry=float(position['entryPrice'])
        gross=side*(price/entry-1.0)*100.0; net=gross-cost_bps/100.0
        before=float(position['entryEquity']); equity=before*max(0.000001,1.0+net/100.0)
        records.append({
            'symbol':symbol,'side':'LONG' if side>0 else 'SHORT','sideSign':side,'signalTs':int(position['signalTs']),
            'scoutFirstTs':int(position['scoutFirstTs']),'entryTs':int(position['entryTs']),'exitSignalTs':final_ts,'exitTs':final_ts,
            'entryPrice':entry,'exitPrice':price,'grossReturnPct':gross,'netReturnPct':net,'entryScore':float(position['entryScore']),
            'exitReason':'PERIOD_END','holdingHours':int((final_ts-int(position['entryTs']))//HOUR),'ownershipStageAtExit':str(position['stage']),
            'equityBefore':before,'equityAfter':equity,
        })
        equity_peak=max(equity_peak,equity); max_dd=min(max_dd,(equity/equity_peak-1.0)*100.0)
    return v8._metric(records,start,end,max_dd),records


def main() -> None:
    candles,index,_=base.v109.b.base.load(); features=v8.build_features(candles)
    annual={}; annual_stress={}
    for label in ('development','validation','evaluation'):
        start,end=base.PERIODS[label]
        annual[label],_=simulate(candles,index,features,start,end,v8.NORMAL_BPS,0)
        annual_stress[label],_=simulate(candles,index,features,start,end,v8.STRESS_BPS,v8.STRESS_DELAY)
    start,end=base.PERIODS['combined']
    combined,records=simulate(candles,index,features,start,end,v8.NORMAL_BPS,0)
    stress,_=simulate(candles,index,features,start,end,v8.STRESS_BPS,v8.STRESS_DELAY)
    gate=v8._historical_gate(combined,stress,annual)
    out={
        'researchLine':'PORTFOLIO_PROFIT_ENGINE_V9_SCOUT_OWNERSHIP',
        'researchOnly':True,'productionChanged':False,'vpsChanged':False,'liveChanged':False,'realTradingEnabled':False,'liveEligible':False,
        'freshOosRead':False,'freshOosConsumed':False,'freshOosPermission':bool(gate['historicalCandidatePass']),
        'target':{'main3YCagrPct':v8.TARGET_CAGR_PCT,'progressFloorCagrPct':v8.PROGRESS_CAGR_PCT,'grossExposureCapPct':100.0,'leverageMultiplier':1.0},
        'architecture':'Regime -> Opportunity -> Zero-capital Scout -> Provisional proof -> Owned -> Exit/Rotation',
        'diagnosisBasis':{
            'source':'V8 Development exit taxonomy only',
            'finding':'profit release and stronger-wave rotation monetize winners; first-recognition false positives create the dominant loss pool',
            'validationUsedToChooseV9Constants':False,'evaluationUsedToChooseV9Constants':False,
        },
        'antiOverfit':{
            'v8OpportunityThresholdsChanged':False,'v8ScoreWeightsChanged':False,'parameterGrid':False,'perSymbolParameters':False,
            'sameRunRetuning':False,'freshOosUsedForTuning':False,'leverageUsedToReachTarget':False,'onePositionMaximum':True,
        },
        'lifecycle':{
            'scoutConfirmHours':SCOUT_CONFIRM_HOURS,'scoutMustRemainTopN':SCOUT_TOP_N,
            'provisionalGraduateHours':PROVISIONAL_GRADUATE_HOURS,'provisionalMaxHours':PROVISIONAL_MAX_HOURS,'provisionalMissLimit':PROVISIONAL_MISS_LIMIT,
        },
        'costs':{'normalTotalBpsPerRoundTrip':v8.NORMAL_BPS,'stressTotalBpsPerRoundTrip':v8.STRESS_BPS,'stressExtraDelayBars':v8.STRESS_DELAY},
        'periods':base.PERIODS,'annual':annual,'annualStress':annual_stress,'combined3Y':combined,'combined3YStress':stress,'historicalGate':gate,
    }
    root=Path(os.environ.get('RESEARCH_STATE_DIR','.research-state')); root.mkdir(parents=True,exist_ok=True)
    (root/'portfolio-profit-engine-v9.json').write_text(json.dumps(out,indent=2,sort_keys=True),encoding='utf-8')
    with (root/'portfolio-profit-engine-v9-trades.jsonl').open('w',encoding='utf-8') as fh:
        for r in records: fh.write(json.dumps(r,sort_keys=True)+'\n')
    print(json.dumps(out,indent=2,sort_keys=True))


if __name__=='__main__':
    main()
