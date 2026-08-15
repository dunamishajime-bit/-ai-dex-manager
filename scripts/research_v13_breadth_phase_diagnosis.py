"""Instrumentation-only 24h/72h breadth-phase diagnosis for frozen V13.
No strategy changes, no Fresh OOS, no production paths.
"""
from __future__ import annotations
import json, os
from collections import defaultdict
from pathlib import Path
import research_independent_ownership_episodes_v13 as v13
import research_independent_relative_ownership_v12 as v12
import research_lab_pair_specific_v109 as v109
import research_priority_router_v6_historical_robustness as hist


def bucket(): return {"count":0,"grossPctPoints":0.0,"net10bpsPctPoints":0.0,"stress30bpsDelay1PctPoints":0.0,"turnoverGrossUnits":0.0}

def counts(candles,idx,ts,n):
    pos=neg=0
    for s in v13.TRADE:
        i=idx[s].get(ts)
        if i is None: continue
        r=v12.ret(candles[s],i,n)
        if r is None: continue
        pos+=r>0; neg+=r<0
    return int(pos),int(neg)

def phase(candles,idx,ts):
    p24,n24=counts(candles,idx,ts,24); p72,n72=counts(candles,idx,ts,72)
    if p72>=4:
        if p24>=4:return "UP_PERSIST"
        if n24>=3:return "UP_REVERSING"
        return "UP_WEAKENING"
    if n72>=4:
        if n24>=4:return "DOWN_PERSIST"
        if p24>=3:return "DOWN_REVERSING"
        return "DOWN_WEAKENING"
    return "DISPERSED"

def trace(candles,idx,start,end):
    times=[int(r['ts']) for r in candles['BTC'] if start<=int(r['ts'])<end][::v13.OBS_HOURS]
    prev={};active={};loss={};by=defaultdict(bucket);by_mode=defaultdict(bucket)
    for ts in times:
        cur=v13.states(candles,idx,ts);target=dict(active)
        for s,side in list(active.items()):
            st=cur.get(s);alive=bool(st and (st['holdAliveLong'] if side>0 else st['holdAliveShort']))
            loss[s]=0 if alive else loss.get(s,0)+1
            if loss[s]>=v13.LOSS_CONFIRMATIONS: target.pop(s,None);loss.pop(s,None)
        vacancies=v13.MAX_POSITIONS-len(target)
        if vacancies>0:
            cs=[]
            for s,st in cur.items():
                if s in target or not st['entryEligible'] or st['side']==0:continue
                pr=prev.get(s)
                if not pr or not pr.get('entryEligible') or pr.get('side')!=st['side']:continue
                cs.append((st['strength'],s,int(st['side'])))
            cs.sort(reverse=True)
            for _,s,side in cs[:vacancies]:target[s]=side;loss[s]=0
        tw={s:side*v13.SLOT_GROSS for s,side in target.items()};aw={s:side*v13.SLOT_GROSS for s,side in active.items()}
        g0=g1=0.0;valid=True
        for s,w in tw.items():
            i=idx[s].get(ts)
            if i is None:valid=False;break
            for delay in (0,1):
                ei=i+1+delay;xi=ei+v13.OBS_HOURS
                if xi>=len(candles[s]) or int(candles[s][xi]['ts'])>=end:valid=False;break
                ep=float(candles[s][ei]['open']);xp=float(candles[s][xi]['open'])
                if ep<=0:valid=False;break
                pnl=w*(xp/ep-1)*100
                if delay==0:g0+=pnl
                else:g1+=pnl
            if not valid:break
        if not valid:prev=cur;continue
        universe=set(tw)|set(aw);tu=sum(abs(tw.get(s,0)-aw.get(s,0)) for s in universe)
        ph=phase(candles,idx,ts);signs={1 if w>0 else -1 for w in tw.values()};mode='CASH' if not signs else 'MIXED' if len(signs)>1 else 'LONG' if 1 in signs else 'SHORT'
        for key,store in ((ph,by),(f'{ph}__{mode}',by_mode)):
            b=store[key];b['count']+=1;b['grossPctPoints']+=g0;b['turnoverGrossUnits']+=tu;b['net10bpsPctPoints']+=g0-tu*.1;b['stress30bpsDelay1PctPoints']+=g1-tu*.3
        active=target;prev=cur
    return {'phase':dict(sorted(by.items())),'phaseMode':dict(sorted(by_mode.items()))}

def main():
    candles,idx,_=v109.b.base.load()
    if v13.END_2026>hist.DATA_END:raise RuntimeError('HISTORICAL_BOUNDARY_EXCEEDS_FROZEN_DATA')
    periods={k:trace(candles,idx,a,b) for k,(a,b) in v13.PERIODS.items()}
    out={'researchLine':'V13_BREADTH_PHASE_DIAGNOSIS','researchOnly':True,'instrumentationOnly':True,'v13Changed':False,'productionChanged':False,'vpsChanged':False,'liveChanged':False,'realTradingEnabled':False,'freshOosRead':False,'post20260701DataUsed':False,'periods':periods,'nextAction':'STRUCTURAL_ROUTER_DIAGNOSIS_NO_THRESHOLD_RETUNE'}
    root=Path(os.environ.get('RESEARCH_STATE_DIR','.research-state'));root.mkdir(parents=True,exist_ok=True);(root/'v13-breadth-phase-diagnosis.json').write_text(json.dumps(out,indent=2,sort_keys=True),encoding='utf-8');print(json.dumps(out,indent=2,sort_keys=True))
if __name__=='__main__':main()
