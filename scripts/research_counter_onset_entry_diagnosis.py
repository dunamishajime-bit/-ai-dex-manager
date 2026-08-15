"""Counter-Factor onset Entry-Edge diagnosis.

Research/instrumentation only. This explicitly separates Entry Edge from the already
observed Counter-Factor HOLD/Ownership Edge.

Four causal event classes are frozen before results:
1. COUNTER_FIRST_FROM_ALIGNED: first counter-factor observation after the same-side
   residual ownership was factor-aligned.
2. COUNTER_FIRST_FROM_MIXED: first counter-factor observation after the same-side
   residual ownership had mixed 24h/72h factor signs.
3. COUNTER_FIRST_FROM_ABSENT_OR_FLIP: first counter-factor observation after no
   eligible same-side residual ownership (including side flip).
4. COUNTER_CONFIRMED: second consecutive same-side counter-factor observation, only
   once at the start of an episode (the observation two steps back was not the same
   counter state).

At each event, evaluate only predeclared 6h/24h/48h forward ownership horizons.
Normal diagnostic return uses next-open entry and full 10bps/side round-trip cost
(20bps total). Stress uses one-hour delayed entry and 30bps/side round-trip cost
(60bps total). This is an event study, not a portfolio backtest and not a threshold
grid. No Fresh OOS, pair-specific params, VPS, LIVE, orders, deployment or production.
"""
from __future__ import annotations
import json, os, statistics
from collections import defaultdict
from pathlib import Path
import research_residual_market_ownership_v15 as v15
import research_lab_pair_specific_v109 as v109
import research_priority_router_v6_historical_robustness as hist

TRADE=v15.TRADE
OBS_HOURS=6
HORIZONS=(6,24,48)
EVENTS=(
 'COUNTER_FIRST_FROM_ALIGNED',
 'COUNTER_FIRST_FROM_MIXED',
 'COUNTER_FIRST_FROM_ABSENT_OR_FLIP',
 'COUNTER_CONFIRMED',
)
PERIODS=v15.PERIODS

def factor_alignment(candles,idx,ts,side):
    market,_=v15.factor_and_series(candles,idx,ts)
    if market is None:return 'ABSENT'
    f24=sum(market[-24:]);f72=sum(market[-72:]);s24=1 if f24>0 else -1 if f24<0 else 0;s72=1 if f72>0 else -1 if f72<0 else 0
    if s24==-side and s72==-side:return 'COUNTER'
    if s24==side and s72==side:return 'ALIGNED'
    return 'MIXED'

def signature(candles,idx,ts,s):
    st=v15.ownership_states(candles,idx,ts).get(s)
    if not st or not st.get('eligible') or not st.get('side'):return None
    side=int(st['side']);return (side,factor_alignment(candles,idx,ts,side))

def fwd(candles,idx,s,ts,side,horizon,delay):
    i=idx[s].get(ts)
    if i is None:return None
    ei=i+1+delay;xi=ei+horizon
    if xi>=len(candles[s]):return None
    ep=float(candles[s][ei]['open']);xp=float(candles[s][xi]['open'])
    if ep<=0:return None
    return side*(xp/ep-1)*100

def summary(xs):
    if not xs:return {'count':0,'meanPct':None,'medianPct':None,'pf':None,'winRatePct':None,'sumPctPoints':0.0}
    g=sum(max(0,x) for x in xs);l=sum(max(0,-x) for x in xs)
    return {'count':len(xs),'meanPct':statistics.fmean(xs),'medianPct':statistics.median(xs),'pf':g/l if l>1e-12 else (999.0 if g>0 else None),'winRatePct':100*sum(x>0 for x in xs)/len(xs),'sumPctPoints':sum(xs)}

def diagnose(candles,idx,start,end):
    times=[int(r['ts']) for r in candles['BTC'] if start<=int(r['ts'])<end][::OBS_HOURS]
    history={s:[] for s in TRADE};samples=defaultdict(lambda:{'gross':[],'normal':[],'stress':[]})
    for ts in times:
        for s in TRADE:
            cur=signature(candles,idx,ts,s);h=history[s];event=None
            if cur and cur[1]=='COUNTER':
                side=cur[0];prev=h[-1] if len(h)>=1 else None;prev2=h[-2] if len(h)>=2 else None
                if prev==(side,'COUNTER') and prev2!=(side,'COUNTER'):
                    event='COUNTER_CONFIRMED'
                elif prev==(side,'ALIGNED'):
                    event='COUNTER_FIRST_FROM_ALIGNED'
                elif prev==(side,'MIXED'):
                    event='COUNTER_FIRST_FROM_MIXED'
                elif prev!=(side,'COUNTER'):
                    event='COUNTER_FIRST_FROM_ABSENT_OR_FLIP'
                if event:
                    for horizon in HORIZONS:
                        g0=fwd(candles,idx,s,ts,side,horizon,0);g1=fwd(candles,idx,s,ts,side,horizon,1)
                        if g0 is None or g1 is None:continue
                        key=(event,horizon)
                        samples[key]['gross'].append(g0)
                        samples[key]['normal'].append(g0-0.20)
                        samples[key]['stress'].append(g1-0.60)
            h.append(cur)
            if len(h)>2:del h[:-2]
    out={}
    for (event,h),vals in sorted(samples.items()):
        out.setdefault(event,{})[f'{h}h']={'gross':summary(vals['gross']),'normalRoundTrip':summary(vals['normal']),'stressDelay1RoundTrip':summary(vals['stress'])}
    return out

def main():
    candles,idx,_=v109.b.base.load()
    if v15.END_2026>hist.DATA_END:raise RuntimeError('HISTORICAL_BOUNDARY_EXCEEDS_FROZEN_DATA')
    periods={k:diagnose(candles,idx,a,b) for k,(a,b) in PERIODS.items()}
    out={'researchLine':'COUNTER_ONSET_ENTRY_DIAGNOSIS','researchOnly':True,'instrumentationOnly':True,'strategyChanged':False,'eventClassesFrozenBeforeResults':list(EVENTS),'horizonsFrozenBeforeResultsHours':list(HORIZONS),'normalRoundTripCostPct':0.20,'stressRoundTripCostPct':0.60,'productionChanged':False,'vpsChanged':False,'liveChanged':False,'realTradingEnabled':False,'freshOosRead':False,'post20260701DataUsed':False,'periods':periods,'nextAction':'BUILD_ENTRY_ENGINE_ONLY_IF_ONE_CAUSAL_EVENT_REPRODUCES_ACROSS_YEARS'}
    root=Path(os.environ.get('RESEARCH_STATE_DIR','.research-state'));root.mkdir(parents=True,exist_ok=True);(root/'counter-onset-entry-diagnosis.json').write_text(json.dumps(out,indent=2,sort_keys=True),encoding='utf-8');print(json.dumps(out,indent=2,sort_keys=True))
if __name__=='__main__':main()
