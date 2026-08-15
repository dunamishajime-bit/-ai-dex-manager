"""Instrumentation-only ownership-stability diagnosis for frozen V15.

Uses only information available at each timestamp. The strongest currently eligible
Residual Ownership candidate is represented as (symbol, side), or CASH. Over the
current + previous four 6h observations (24h causal history), count signature changes:
- STABLE: 0 changes
- TRANSITION: 1 change
- CHURN: 2+ changes
No strategy rule is changed. The frozen V15 target path is then attributed by
stability regime and transition class to test whether lifecycle should route between
persistent ownership and handoff behavior. No Fresh OOS or production paths.
"""
from __future__ import annotations
import json, os
from collections import defaultdict, deque
from pathlib import Path
import research_residual_market_ownership_v15 as v15
import research_lab_pair_specific_v109 as v109
import research_priority_router_v6_historical_robustness as hist


def bucket():
    return {"count":0,"grossDelay0PctPoints":0.0,"grossDelay1PctPoints":0.0,"turnoverGrossUnits":0.0,"net10bpsDelay0PctPoints":0.0,"net30bpsDelay1PctPoints":0.0}

def add(b,g0,g1,tu):
    b['count']+=1;b['grossDelay0PctPoints']+=g0;b['grossDelay1PctPoints']+=g1;b['turnoverGrossUnits']+=tu;b['net10bpsDelay0PctPoints']+=g0-tu*.1;b['net30bpsDelay1PctPoints']+=g1-tu*.3

def leader_signature(cur):
    cs=[(st['strength'],s,int(st['side'])) for s,st in cur.items() if st.get('eligible') and st.get('side')]
    if not cs:return 'CASH'
    cs.sort(reverse=True)
    _,s,side=cs[0]
    return f"{s}_{'LONG' if side>0 else 'SHORT'}"

def stability(history,current):
    seq=list(history)+[current]
    if len(seq)<5:return 'WARMUP'
    changes=sum(a!=b for a,b in zip(seq,seq[1:]))
    return 'STABLE' if changes==0 else 'TRANSITION' if changes==1 else 'CHURN'

def trace(candles,idx,start,end):
    times=[int(r['ts']) for r in candles['BTC'] if start<=int(r['ts'])<end][::v15.OBS_HOURS]
    prev={};active={};loss={};histq=deque(maxlen=4);by_reg=defaultdict(bucket);by_reg_action=defaultdict(bucket);by_sig=defaultdict(bucket)
    for ts in times:
        cur=v15.ownership_states(candles,idx,ts);sig=leader_signature(cur);reg=stability(histq,sig);target=dict(active);removed=[];added=[]
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
        tw={s:side*v15.SLOT_GROSS for s,side in target.items()};aw={s:side*v15.SLOT_GROSS for s,side in active.items()};g0=g1=0.0;valid=True
        for s,w in tw.items():
            i=idx[s].get(ts)
            if i is None:valid=False;break
            for delay in (0,1):
                ei=i+1+delay;xi=ei+v15.OBS_HOURS
                if xi>=len(candles[s]) or int(candles[s][xi]['ts'])>=end:valid=False;break
                ep=float(candles[s][ei]['open']);xp=float(candles[s][xi]['open'])
                if ep<=0:valid=False;break
                pnl=w*(xp/ep-1)*100
                if delay==0:g0+=pnl
                else:g1+=pnl
            if not valid:break
        if not valid:prev=cur;histq.append(sig);continue
        universe=set(tw)|set(aw);tu=sum(abs(tw.get(s,0)-aw.get(s,0)) for s in universe)
        if removed and added:action='REPLACE'
        elif removed:action='EXIT_LEG'
        elif added:action='ADD_LEG'
        elif tw:action='HOLD'
        else:action='CASH'
        add(by_reg[reg],g0,g1,tu);add(by_reg_action[f'{reg}__{action}'],g0,g1,tu);add(by_sig[sig],g0,g1,tu)
        active=target;prev=cur;histq.append(sig)
    return {'stabilityRegime':dict(sorted(by_reg.items())),'stabilityAction':dict(sorted(by_reg_action.items())),'leaderSignature':dict(sorted(by_sig.items()))}

def main():
    candles,idx,_=v109.b.base.load()
    if v15.END_2026>hist.DATA_END:raise RuntimeError('HISTORICAL_BOUNDARY_EXCEEDS_FROZEN_DATA')
    periods={k:trace(candles,idx,a,b) for k,(a,b) in v15.PERIODS.items()}
    out={'researchLine':'V15_OWNERSHIP_STABILITY_DIAGNOSIS','researchOnly':True,'instrumentationOnly':True,'v15Changed':False,'causalWindowHours':24,'stabilityDefinition':{'STABLE':0,'TRANSITION':1,'CHURN':'2+'},'productionChanged':False,'vpsChanged':False,'liveChanged':False,'realTradingEnabled':False,'freshOosRead':False,'post20260701DataUsed':False,'periods':periods,'nextAction':'ROUTE_LIFECYCLE_ONLY_IF_MULTYEAR_CAUSAL_STABILITY_PATTERN_REPRODUCES'}
    root=Path(os.environ.get('RESEARCH_STATE_DIR','.research-state'));root.mkdir(parents=True,exist_ok=True);(root/'v15-ownership-stability-diagnosis.json').write_text(json.dumps(out,indent=2,sort_keys=True),encoding='utf-8');print(json.dumps(out,indent=2,sort_keys=True))
if __name__=='__main__':main()
