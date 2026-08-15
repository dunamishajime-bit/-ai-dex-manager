"""Independent Relative Ownership V12.

Clean-sheet response to V11 side diagnosis.

V11 showed that a single BTC-imposed direction is structurally wrong: within the
same year different pairs can have opposite profitable ownership (for example a
relative leader can remain long while another pair is independently short).
V12 therefore removes portfolio-wide direction forcing.

Architecture frozen before first V12 result:
- each of ETH/BNB/SOL/LINK/AVAX gets one COMMON signed ownership score from its
  own multi-horizon persistence + cross-sectional relative persistence;
- no pair-specific threshold or parameters;
- candidate sign and top-2 absolute rank must persist for two 6h observations;
- up to two positions may coexist with opposite directions;
- fixed book while ownership persists; two-observation loss confirmation before
  exit/handoff; no 6h resizing;
- BTC contributes only a market coherence / gross-risk context, never forces the
  sign of an alt position;
- Normal 10bps; Stress 30bps + one-bar delay.

PENGU-class qualification: every annual period >=80% to survive, median annual
>=100% and 3Y CAGR >=100% plus robustness for primary; strong requires every
annual >=100% and 3Y CAGR >=120%. 80% is never the objective.

Historical through 2026-07-01 is already-inspected DESIGN evidence. No Fresh OOS,
VPS, LIVE, orders, deployment, or production mutation.
"""
from __future__ import annotations

import json, math, os, statistics
from pathlib import Path
from typing import Any
import research_lab_pair_specific_v109 as v109
import research_priority_router_v6_historical_robustness as hist

HOUR=v109.HOUR; DAY=24*HOUR
TRADE=("ETH","BNB","SOL","LINK","AVAX"); ALL=("BTC",)+TRADE
NORMAL_BPS=10.0; STRESS_BPS=30.0; STRESS_DELAY=1; OBS_HOURS=6
BASE_GROSS=1.25; STRONG_GROSS=1.75; MAX_POSITIONS=2
START_2023=hist.jst08(2023,7,1); START_2024=hist.jst08(2024,7,1); START_2025=hist.jst08(2025,7,1); END_2026=hist.jst08(2026,7,1)
PERIODS={"year1_2023_24":(START_2023,START_2024),"year2_2024_25":(START_2024,START_2025),"year3_2025_26":(START_2025,END_2026),"combined3Y":(START_2023,END_2026)}

def ret(c,i,n):return v109.b.ret(c,i,n)
def vol(c,i,n):return v109.b.vol(c,i,n)
def eff(c,i,n):return v109.b.efficiency(c,i,n)
def scaled(r,vh,n):return 0.0 if r is None or vh<=1e-12 else float(r)/(vh*math.sqrt(n)+1e-12)

def median_move(candles,idx,ts,n):
    xs=[]
    for s in TRADE:
        i=idx[s].get(ts)
        if i is not None:
            x=ret(candles[s],i,n)
            if x is not None:xs.append(float(x))
    return statistics.median(xs) if xs else 0.0

def btc_context(candles,idx,ts):
    i=idx['BTC'].get(ts)
    if i is None or i<900:return {'coherence':0.0,'direction':0}
    c=candles['BTC'];vh=vol(c,i,168)
    if vh<=1e-12:return {'coherence':0.0,'direction':0}
    z72=scaled(ret(c,i,72),vh,72);z336=scaled(ret(c,i,336),vh,336);e=eff(c,i,72)
    raw=.62*z72+.38*z336
    return {'coherence':abs(raw)*(0.65+min(.35,max(0,e-.15))), 'direction':1 if raw>0 else -1 if raw<0 else 0}

def ownership_scores(candles,idx,ts):
    m24=median_move(candles,idx,ts,24);m72=median_move(candles,idx,ts,72);rows=[]
    for s in TRADE:
        i=idx[s].get(ts)
        if i is None or i<900:continue
        c=candles[s];vh=vol(c,i,168)
        if vh<=1e-12:continue
        z12=scaled(ret(c,i,12),vh,12);z24=scaled(ret(c,i,24),vh,24);z72=scaled(ret(c,i,72),vh,72);z168=scaled(ret(c,i,168),vh,168);z336=scaled(ret(c,i,336),vh,336)
        rel24=scaled((ret(c,i,24) or 0)-m24,vh,24);rel72=scaled((ret(c,i,72) or 0)-m72,vh,72);path=eff(c,i,72)
        # Sign comes from each pair itself. Relative terms allow leader/laggard handoff.
        score=.10*z12+.18*z24+.27*z72+.17*z168+.08*z336+.10*rel24+.10*rel72
        # Low-efficiency moves are less ownable, symmetrically for long and short.
        score*=0.70+min(.45,max(0.0,path-.15))
        rows.append((score,s))
    rows.sort(key=lambda x:abs(x[0]),reverse=True);return rows

def stable_candidates(prev_rows,cur_rows):
    pm={s:x for x,s in prev_rows[:3]};cm={s:x for x,s in cur_rows[:3]};out=[]
    for s,x in cm.items():
        p=pm.get(s)
        if p is None:continue
        if x==0 or p==0 or (x>0)!=(p>0):continue
        if min(abs(x),abs(p))<.62:continue
        out.append((min(abs(x),abs(p)),s,1 if x>0 else -1,x))
    out.sort(reverse=True);return out[:MAX_POSITIONS]

def target_from_candidates(cands,btc):
    if not cands:return {}
    avg=sum(x[0] for x in cands)/len(cands); coherence=float(btc['coherence'])
    gross=STRONG_GROSS if avg>=1.20 and coherence>=.55 else BASE_GROSS
    if len(cands)==1:return {cands[0][1]:cands[0][2]*gross}
    # If signs differ this becomes naturally beta-light; if same they share directional exposure.
    return {cands[0][1]:cands[0][2]*gross*.58,cands[1][1]:cands[1][2]*gross*.42}

def metric(rs,start,end):
    if not rs:return {'intervals':0,'returnPct':0.0,'cagrPct':0.0,'pf':None,'pfWithoutBest':None,'maxDDPct':0.0,'winRatePct':0.0}
    e=p=1.;dd=0.;g=l=0.
    for r in rs:
        e*=max(.001,1+r/100);p=max(p,e);dd=min(dd,(e/p-1)*100);g+=max(0,r);l+=max(0,-r)
    years=max((end-start)/(365.25*DAY),1e-9);total=(e-1)*100;cagr=(e**(1/years)-1)*100 if e>0 else -100;pf=g/l if l>1e-12 else (999. if g>0 else None)
    bi=max(range(len(rs)),key=rs.__getitem__);wo=rs[:bi]+rs[bi+1:];wg=sum(x for x in wo if x>0);wl=abs(sum(x for x in wo if x<0));pfwo=wg/wl if wl>1e-12 else (999. if wg>0 else None)
    return {'intervals':len(rs),'returnPct':total,'cagrPct':cagr,'pf':pf,'pfWithoutBest':pfwo,'maxDDPct':dd,'winRatePct':100*sum(x>0 for x in rs)/len(rs),'bestIntervalPct':max(rs)}

def simulate(candles,idx,start,end,costbps,delay):
    times=[int(r['ts']) for r in candles['BTC'] if start<=int(r['ts'])<end][::OBS_HOURS]
    prev_rows=[];active={};loss={};returns=[];turn=0.;contrib={s:0. for s in TRADE};entries=exits=handoffs=0;active_intervals=0;side_intervals={'LONG':0,'SHORT':0,'MIXED':0}
    for ts in times:
        rows=ownership_scores(candles,idx,ts);cands=stable_candidates(prev_rows,rows) if prev_rows else [];desired=target_from_candidates(cands,btc_context(candles,idx,ts))
        target=dict(active)
        if not active:
            if desired:target=desired;entries+=1
        else:
            curmap={s:1 if w>0 else -1 for s,w in active.items()};dmap={s:1 if w>0 else -1 for s,w in desired.items()}
            for s,side in curmap.items():
                alive=(s in dmap and dmap[s]==side)
                loss[s]=0 if alive else loss.get(s,0)+1
            must_change=any(loss.get(s,0)>=2 for s in curmap)
            if must_change:
                if desired:
                    target=desired;handoffs+=1
                else:
                    target={};exits+=1
                loss={}
            elif active:
                target=dict(active)
        interval=0.;legs=[];valid=True
        for s,w in target.items():
            i=idx[s].get(ts)
            if i is None:valid=False;break
            ei=i+1+delay;xi=ei+OBS_HOURS
            if xi>=len(candles[s]) or int(candles[s][xi]['ts'])>=end:valid=False;break
            ep=float(candles[s][ei]['open']);xp=float(candles[s][xi]['open'])
            if ep<=0:valid=False;break
            ar=(xp/ep-1)*100;pnl=w*ar;interval+=pnl;contrib[s]+=pnl;legs.append((s,w,pnl))
        if not valid:prev_rows=rows;continue
        universe=set(active)|set(target);tu=sum(abs(target.get(s,0)-active.get(s,0)) for s in universe);interval-=tu*costbps/100;turn+=tu
        if target:
            active_intervals+=1;signs={1 if w>0 else -1 for w in target.values()};side_intervals['MIXED' if len(signs)>1 else 'LONG' if 1 in signs else 'SHORT']+=1
        returns.append(interval);active=target;prev_rows=rows
    m=metric(returns,start,end);m.update({'activeIntervals':active_intervals,'cashIntervalPct':100*(len(returns)-active_intervals)/len(returns) if returns else 100.,'turnoverGrossUnits':turn,'contributionPctPoints':contrib,'entries':entries,'exits':exits,'handoffs':handoffs,'sideIntervals':side_intervals});return m

def classify(normal,stress):
    labels=('year1_2023_24','year2_2024_25','year3_2025_26');a=[float(normal[x]['returnPct']) for x in labels];sa=[float(stress[x]['returnPct']) for x in labels];c=normal['combined3Y'];cs=stress['combined3Y'];med=statistics.median(a);mn=min(a);cagr=float(c['cagrPct'])
    robust=float(c.get('pf') or 0)>=1.40 and float(c.get('pfWithoutBest') or 0)>=1.25 and float(c['maxDDPct'])>=-40 and int(c['activeIntervals'])>=100 and float(cs['cagrPct'])>=45 and float(cs.get('pf') or 0)>=1.08 and float(cs.get('pfWithoutBest') or 0)>=1.0 and float(cs['maxDDPct'])>=-50 and sum(x>0 for x in sa)>=2 and min(sa)>-25
    floor=mn>=80;primary=floor and med>=100 and cagr>=100 and robust;strong=min(a)>=100 and cagr>=120 and robust
    status='ANNUAL_80_FLOOR_FAIL' if not floor else 'BELOW_PENGU_CLASS_RETURN_STANDARD' if not (med>=100 and cagr>=100) else 'RETURN_PASS_ROBUSTNESS_FAIL' if not robust else 'STRONG_100PCT_PLUS_ANNUAL_CANDIDATE' if strong else '100PCT_CLASS_CANDIDATE'
    return {'annualReturnPct':dict(zip(labels,a)),'annualStressReturnPct':dict(zip(labels,sa)),'minimumAnnualReturnPct':mn,'medianAnnualReturnPct':med,'combined3YCagrPct':cagr,'robustnessPass':bool(robust),'primaryCandidatePass':bool(primary),'strongCandidatePass':bool(strong),'status':status}

def main():
    candles,idx,_=v109.b.base.load();normal={};stress={}
    if END_2026>hist.DATA_END:raise RuntimeError('HISTORICAL_BOUNDARY_EXCEEDS_FROZEN_DATA')
    for label,(a,b) in PERIODS.items():normal[label]=simulate(candles,idx,a,b,NORMAL_BPS,0);stress[label]=simulate(candles,idx,a,b,STRESS_BPS,STRESS_DELAY)
    cl=classify(normal,stress);out={'researchLine':'INDEPENDENT_RELATIVE_OWNERSHIP_V12','researchOnly':True,'productionChanged':False,'vpsChanged':False,'liveChanged':False,'realTradingEnabled':False,'freshOosRead':False,'post20260701DataUsed':False,'historicalEvidenceStatus':'DESIGN_SANITY_ONLY_ALREADY_INSPECTED','architecture':{'portfolioWideDirectionForced':False,'pairSpecificParameters':False,'parameterGrid':False,'confirmationObservations':2,'lossConfirmationObservations':2,'maxPositions':MAX_POSITIONS,'baseGrossResearchOnly':BASE_GROSS,'strongGrossResearchOnly':STRONG_GROSS,'oppositeDirectionsCanCoexist':True},'returnStandard':{'minimumEveryYearPct':80.0,'primaryMedianAnnualPct':100.0,'primary3YCagrPct':100.0,'strongMinimumEveryYearPct':100.0,'strong3YCagrPct':120.0,'eightyPctIsTarget':False,'guaranteed':False},'periods':PERIODS,'normal':normal,'stress':stress,'classification':cl,'status':cl['status'],'nextAction':'FREEZE_AND_ONE_FRESH_OOS_TEST' if cl['primaryCandidatePass'] else 'STRUCTURAL_DIAGNOSIS_NO_THRESHOLD_RETUNE'}
    root=Path(os.environ.get('RESEARCH_STATE_DIR','.research-state'));root.mkdir(parents=True,exist_ok=True);(root/'independent-relative-ownership-v12.json').write_text(json.dumps(out,indent=2,sort_keys=True),encoding='utf-8');print(json.dumps(out,indent=2,sort_keys=True))
if __name__=='__main__':main()
