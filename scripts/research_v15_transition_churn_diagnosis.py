"""Instrumentation-only transition/churn diagnosis for frozen Residual Market Ownership V15.
No strategy rule changes, no Fresh OOS, no production paths.
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
    b["count"]+=1;b["grossDelay0PctPoints"]+=g0;b["grossDelay1PctPoints"]+=g1;b["turnoverGrossUnits"]+=tu;b["net10bpsDelay0PctPoints"]+=g0-tu*.1;b["net30bpsDelay1PctPoints"]+=g1-tu*.3

def trace(candles,idx,start,end):
    times=[int(r['ts']) for r in candles['BTC'] if start<=int(r['ts'])<end][::v15.OBS_HOURS]
    prev={};active={};loss={};tr=defaultdict(bucket);mode=defaultdict(bucket);pair_side=defaultdict(bucket)
    for ts in times:
        cur=v15.ownership_states(candles,idx,ts);target=dict(active);removed=[];added=[]
        for s,side in list(active.items()):
            st=cur.get(s);alive=bool(st and (st['holdLong'] if side>0 else st['holdShort']))
            loss[s]=0 if alive else loss.get(s,0)+1
            if loss[s]>=v15.LOSS_CONFIRMATIONS:
                target.pop(s,None);loss.pop(s,None);removed.append(s)
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
        g0=sum(leg0.values());g1=sum(leg1.values());universe=set(tw)|set(aw);legturn={s:abs(tw.get(s,0)-aw.get(s,0)) for s in universe};tu=sum(legturn.values())
        if removed and added:kind='REPLACE'
        elif removed:kind='EXIT_LEG'
        elif added:kind='ADD_LEG'
        elif tw:kind='HOLD'
        else:kind='CASH'
        signs={1 if w>0 else -1 for w in tw.values()};md='CASH' if not signs else 'MIXED' if len(signs)>1 else 'LONG' if 1 in signs else 'SHORT'
        add(tr[kind],g0,g1,tu);add(mode[md],g0,g1,tu)
        for s,w in tw.items():
            side='LONG' if w>0 else 'SHORT';add(pair_side[f'{s}_{side}'],leg0[s],leg1[s],legturn.get(s,0.0))
        active=target;prev=cur
    return {'transition':dict(sorted(tr.items())),'sideMode':dict(sorted(mode.items())),'pairSide':dict(sorted(pair_side.items()))}

def main():
    candles,idx,_=v109.b.base.load()
    if v15.END_2026>hist.DATA_END:raise RuntimeError('HISTORICAL_BOUNDARY_EXCEEDS_FROZEN_DATA')
    periods={k:trace(candles,idx,a,b) for k,(a,b) in v15.PERIODS.items()}
    out={'researchLine':'V15_TRANSITION_CHURN_DIAGNOSIS','researchOnly':True,'instrumentationOnly':True,'v15Changed':False,'productionChanged':False,'vpsChanged':False,'liveChanged':False,'realTradingEnabled':False,'freshOosRead':False,'post20260701DataUsed':False,'periods':periods,'nextAction':'REDESIGN_LIFECYCLE_NOT_THRESHOLDS'}
    root=Path(os.environ.get('RESEARCH_STATE_DIR','.research-state'));root.mkdir(parents=True,exist_ok=True);(root/'v15-transition-churn-diagnosis.json').write_text(json.dumps(out,indent=2,sort_keys=True),encoding='utf-8');print(json.dumps(out,indent=2,sort_keys=True))
if __name__=='__main__':main()
