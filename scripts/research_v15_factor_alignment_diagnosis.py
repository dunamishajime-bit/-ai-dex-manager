"""Instrumentation-only market-factor alignment diagnosis for frozen V15.

At each timestamp, use only the current 168h common median market-factor history
already defined by V15. For each active residual-ownership leg, compare its side
with the sign of the factor's trailing 24h and 72h cumulative returns:
- FACTOR_ALIGNED: both factor horizons have the same sign as the active leg.
- FACTOR_COUNTER: both have the opposite sign.
- FACTOR_MIXED: factor horizons disagree or include zero.
The exact frozen V15 target path is replayed and PnL is attributed by alignment and
action. No V15 changes, no thresholds, no Fresh OOS, VPS, LIVE, orders, deployment,
or production mutation.
"""
from __future__ import annotations
import json, os
from collections import defaultdict
from pathlib import Path
import research_residual_market_ownership_v15 as v15
import research_lab_pair_specific_v109 as v109
import research_priority_router_v6_historical_robustness as hist


def bucket():
    return {"count":0,"grossDelay0PctPoints":0.0,"grossDelay1PctPoints":0.0,"turnoverGrossUnits":0.0,"net10bpsDelay0PctPoints":0.0,"net30bpsDelay1PctPoints":0.0}

def add(b,g0,g1,tu):
    b['count']+=1;b['grossDelay0PctPoints']+=g0;b['grossDelay1PctPoints']+=g1;b['turnoverGrossUnits']+=tu;b['net10bpsDelay0PctPoints']+=g0-tu*.1;b['net30bpsDelay1PctPoints']+=g1-tu*.3

def factor_signs(candles,idx,ts):
    market,_=v15.factor_and_series(candles,idx,ts)
    if market is None:return 0,0
    f24=sum(market[-24:]);f72=sum(market[-72:])
    s24=1 if f24>0 else -1 if f24<0 else 0
    s72=1 if f72>0 else -1 if f72<0 else 0
    return s24,s72

def alignment(side,s24,s72):
    if s24==side and s72==side:return 'FACTOR_ALIGNED'
    if s24==-side and s72==-side:return 'FACTOR_COUNTER'
    return 'FACTOR_MIXED'

def trace(candles,idx,start,end):
    times=[int(r['ts']) for r in candles['BTC'] if start<=int(r['ts'])<end][::v15.OBS_HOURS]
    prev={};active={};loss={};by=defaultdict(bucket);by_action=defaultdict(bucket);by_pair=defaultdict(bucket)
    for ts in times:
        cur=v15.ownership_states(candles,idx,ts);target=dict(active);removed=[];added=[]
        for s,side in list(active.items()):
            st=cur.get(s);alive=bool(st and (st['holdLong'] if side>0 else st['holdShort']))
            loss[s]=0 if alive else loss.get(s,0)+1
            if loss[s]>=v15.LOSS_CONFIRMATIONS:target.pop(s,None);loss.pop(s,None);removed.append(s)
        vacancies=v15.MAX_POSITIONS-len(target)
        if vacancies>0:
            cs=[]
            for s,st in cur.items():
                if s in target or not st['eligible'] or st['side']==0:continue
                pr=prev.get(s)
                if not pr or not pr.get('eligible') or pr.get('side')!=st['side']:continue
                cs.append((st['strength'],s,int(st['side'])))
            cs.sort(reverse=True)
            for _,s,side in cs[:vacancies]:target[s]=side;loss[s]=0;added.append(s)
        tw={s:side*v15.SLOT_GROSS for s,side in target.items()};aw={s:side*v15.SLOT_GROSS for s,side in active.items()}
        leg0={};leg1={};valid=True
        for s,w in tw.items():
            i=idx[s].get(ts)
            if i is None:valid=False;break
            for delay,dest in ((0,leg0),(1,leg1)):
                ei=i+1+delay;xi=ei+v15.OBS_HOURS
                if xi>=len(candles[s]) or int(candles[s][xi]['ts'])>=end:valid=False;break
                ep=float(candles[s][ei]['open']);xp=float(candles[s][xi]['open'])
                if ep<=0:valid=False;break
                dest[s]=w*(xp/ep-1)*100
            if not valid:break
        if not valid:prev=cur;continue
        if removed and added:action='REPLACE'
        elif removed:action='EXIT_LEG'
        elif added:action='ADD_LEG'
        elif tw:action='HOLD'
        else:action='CASH'
        s24,s72=factor_signs(candles,idx,ts);universe=set(tw)|set(aw)
        for s,w in tw.items():
            side=1 if w>0 else -1;al=alignment(side,s24,s72);tu=abs(tw.get(s,0)-aw.get(s,0));g0=leg0[s];g1=leg1[s]
            add(by[al],g0,g1,tu);add(by_action[f'{al}__{action}'],g0,g1,tu);add(by_pair[f'{al}__{s}_{"LONG" if side>0 else "SHORT"}'],g0,g1,tu)
        # charge turnover for legs closed this interval to their prior alignment using current causal factor state
        for s in universe-set(tw):
            w=aw[s];side=1 if w>0 else -1;al=alignment(side,s24,s72);tu=abs(w);add(by[al],0.0,0.0,tu);add(by_action[f'{al}__{action}'],0.0,0.0,tu)
        active=target;prev=cur
    return {'factorAlignment':dict(sorted(by.items())),'alignmentAction':dict(sorted(by_action.items())),'alignmentPairSide':dict(sorted(by_pair.items()))}

def main():
    candles,idx,_=v109.b.base.load()
    if v15.END_2026>hist.DATA_END:raise RuntimeError('HISTORICAL_BOUNDARY_EXCEEDS_FROZEN_DATA')
    periods={k:trace(candles,idx,a,b) for k,(a,b) in v15.PERIODS.items()}
    out={'researchLine':'V15_FACTOR_ALIGNMENT_DIAGNOSIS','researchOnly':True,'instrumentationOnly':True,'v15Changed':False,'causalFactorHorizonsHours':[24,72],'alignmentClasses':['FACTOR_ALIGNED','FACTOR_COUNTER','FACTOR_MIXED'],'productionChanged':False,'vpsChanged':False,'liveChanged':False,'realTradingEnabled':False,'freshOosRead':False,'post20260701DataUsed':False,'periods':periods,'nextAction':'USE_FACTOR_ALIGNMENT_ONLY_IF_MULTYEAR_PATTERN_REPRODUCES'}
    root=Path(os.environ.get('RESEARCH_STATE_DIR','.research-state'));root.mkdir(parents=True,exist_ok=True);(root/'v15-factor-alignment-diagnosis.json').write_text(json.dumps(out,indent=2,sort_keys=True),encoding='utf-8');print(json.dumps(out,indent=2,sort_keys=True))
if __name__=='__main__':main()
