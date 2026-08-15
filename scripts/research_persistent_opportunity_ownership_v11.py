"""Persistent Opportunity Ownership V11.

Clean-sheet redesign from V10 failure diagnosis, not a threshold patch.

Causal diagnosis used:
- V10 initial CASH->ACTIVE intervals were structurally poor.
- Persistent same-book intervals were the only strongly positive transition class.
- Frequent cash exits and pair rotations destroyed edge through both timing and cost.
- 2025-26 also showed that generic market ownership alone can select the wrong alts.

V11 therefore changes the architecture:
1. Require market direction persistence across two 6h observations (12h).
2. Require cross-sectional leadership persistence: candidate must remain in the
   directional top-2 on consecutive observations before entry.
3. Hold fixed weights; do not resize every 6h.
4. Exit/handoff only after two consecutive observations confirm loss of market
   direction or loss of top-2 leadership. No one-tick churn.
5. Selection is cross-sectional first; no pair-specific thresholds/grid.
6. BTC is reference-only. Trade ETH/BNB/SOL/LINK/AVAX.

Return qualification remains PENGU-class: every annual period >=80% to survive,
median annual >=100% and 3Y CAGR >=100% for a primary candidate; strong requires
every annual >=100% and 3Y CAGR >=120%, plus PF/DD/Stress robustness.

Historical data through 2026-07-01 is already-inspected DESIGN evidence. Fresh
OOS is sealed. Research only; no VPS/LIVE/order/deployment path.
"""
from __future__ import annotations

import json
import math
import os
import statistics
from pathlib import Path
from typing import Any

import research_lab_pair_specific_v109 as v109
import research_priority_router_v6_historical_robustness as hist

HOUR = v109.HOUR
DAY = 24 * HOUR
TRADE = ("ETH", "BNB", "SOL", "LINK", "AVAX")
ALL = ("BTC",) + TRADE
NORMAL_BPS = 10.0
STRESS_BPS = 30.0
STRESS_DELAY = 1
OBS_HOURS = 6
BASE_GROSS = 1.00
STRONG_GROSS = 1.50

START_2023 = hist.jst08(2023, 7, 1)
START_2024 = hist.jst08(2024, 7, 1)
START_2025 = hist.jst08(2025, 7, 1)
END_2026 = hist.jst08(2026, 7, 1)
PERIODS = {
    "year1_2023_24": (START_2023, START_2024),
    "year2_2024_25": (START_2024, START_2025),
    "year3_2025_26": (START_2025, END_2026),
    "combined3Y": (START_2023, END_2026),
}


def sd(xs): return statistics.pstdev(xs) if len(xs) > 1 else 0.0

def ret(c, i, n): return v109.b.ret(c, i, n)

def vol(c, i, n): return v109.b.vol(c, i, n)

def efficiency(c, i, n): return v109.b.efficiency(c, i, n)


def scaled(r: float | None, vh: float, bars: int) -> float:
    if r is None or vh <= 1e-12: return 0.0
    return float(r) / (vh * math.sqrt(float(bars)) + 1e-12)


def breadth(candles, idx, ts: int, n: int) -> float:
    vals=[]
    for s in ALL:
        i=idx[s].get(ts)
        if i is None: continue
        x=ret(candles[s],i,n)
        if x is not None: vals.append(float(x))
    return sum(x>0 for x in vals)/len(vals) if vals else .5


def median_move(candles, idx, ts: int, n: int) -> float:
    vals=[]
    for s in TRADE:
        i=idx[s].get(ts)
        if i is None: continue
        x=ret(candles[s],i,n)
        if x is not None: vals.append(float(x))
    return statistics.median(vals) if vals else 0.0


def market_direction(candles, idx, ts: int) -> tuple[int,float] | None:
    bi=idx['BTC'].get(ts)
    if bi is None or bi<900: return None
    c=candles['BTC']; vh=vol(c,bi,168)
    if vh<=1e-12: return None
    z24=scaled(ret(c,bi,24),vh,24); z72=scaled(ret(c,bi,72),vh,72); z336=scaled(ret(c,bi,336),vh,336)
    br24=breadth(candles,idx,ts,24); br72=breadth(candles,idx,ts,72); eff=efficiency(c,bi,72)
    score=.46*z72+.24*z336+.18*((br72-.5)*4)+.12*z24
    side=1 if score>=.55 else -1 if score<=-.55 else 0
    if side and eff<.16 and abs(z24)<.85: side=0
    return side,abs(score)


def relative_rank(candles, idx, ts: int, side: int) -> list[tuple[float,str]]:
    med24=median_move(candles,idx,ts,24); med72=median_move(candles,idx,ts,72)
    rows=[]
    for s in TRADE:
        i=idx[s].get(ts)
        if i is None or i<900: continue
        c=candles[s]; vh=vol(c,i,168)
        if vh<=1e-12: continue
        r24=ret(c,i,24); r72=ret(c,i,72); r168=ret(c,i,168)
        rel24=scaled((r24 or 0)-med24,vh,24); rel72=scaled((r72 or 0)-med72,vh,72)
        z24=scaled(r24,vh,24); z72=scaled(r72,vh,72); z168=scaled(r168,vh,168)
        eff=efficiency(c,i,72)
        # Cross-sectional ownership score: persistent relative strength first.
        score=side*(.32*rel24+.34*rel72+.16*z24+.12*z72+.06*z168)+.25*max(0.0,eff-.20)
        rows.append((score,s))
    rows.sort(reverse=True)
    return rows


def desired_book(candles,idx,ts:int) -> dict[str,Any]:
    md=market_direction(candles,idx,ts)
    if md is None or md[0]==0: return {'side':0,'strength':0.0,'leaders':[]}
    side,strength=md; ranks=relative_rank(candles,idx,ts,side)
    leaders=[s for score,s in ranks[:2] if score>0]
    return {'side':side,'strength':strength,'leaders':leaders,'ranked':ranks}


def metric(returns:list[float],start:int,end:int)->dict[str,Any]:
    if not returns:return {'intervals':0,'returnPct':0.0,'cagrPct':0.0,'pf':None,'pfWithoutBest':None,'maxDDPct':0.0,'winRatePct':0.0}
    e=p=1.0; mdd=0.0; g=l=0.0
    for r in returns:
        e*=max(.001,1+r/100); p=max(p,e); mdd=min(mdd,(e/p-1)*100)
        if r>0:g+=r
        elif r<0:l+=-r
    years=max((end-start)/(365.25*DAY),1e-9); total=(e-1)*100; cagr=(e**(1/years)-1)*100 if e>0 else -100
    pf=g/l if l>1e-12 else (999.0 if g>0 else None)
    bi=max(range(len(returns)),key=returns.__getitem__); wo=returns[:bi]+returns[bi+1:]
    wg=sum(x for x in wo if x>0); wl=abs(sum(x for x in wo if x<0)); pfwo=wg/wl if wl>1e-12 else (999.0 if wg>0 else None)
    return {'intervals':len(returns),'returnPct':total,'cagrPct':cagr,'pf':pf,'pfWithoutBest':pfwo,'maxDDPct':mdd,'winRatePct':100*sum(x>0 for x in returns)/len(returns),'bestIntervalPct':max(returns)}


def simulate(candles,idx,start:int,end:int,costbps:float,delay:int)->dict[str,Any]:
    times=[int(r['ts']) for r in candles['BTC'] if start<=int(r['ts'])<end][::OBS_HOURS]
    prev_desired=None; active:dict[str,float]={}; loss_confirm=0; candidate_confirm=0; candidate_key=None
    returns=[]; contribution={s:0.0 for s in TRADE}; records=[]; turnover_total=0.0; entries=exits=handoffs=0; active_intervals=0
    for ts in times:
        d=desired_book(candles,idx,ts); key=(d['side'],tuple(d['leaders']))
        # Candidate persistence: same direction and at least one same top-2 leader across two observations.
        stable=False
        if prev_desired is not None and d['side']!=0 and d['side']==prev_desired['side']:
            stable=bool(set(d['leaders']) & set(prev_desired['leaders']))
        if stable:
            if key==candidate_key:candidate_confirm+=1
            else:candidate_key=key;candidate_confirm=1
        else:
            candidate_key=None;candidate_confirm=0

        target=dict(active)
        if not active:
            if stable and candidate_confirm>=1 and d['leaders']:
                gross=STRONG_GROSS if d['strength']>=1.20 else BASE_GROSS
                # Use persistent common leader first; second only if also persisted.
                common=[s for s in d['leaders'] if s in prev_desired['leaders']]
                use=common[:2]
                if use:
                    if len(use)==1: target={use[0]:d['side']*gross}
                    else: target={use[0]:d['side']*gross*.65,use[1]:d['side']*gross*.35}
                    entries+=1; loss_confirm=0
        else:
            side=1 if next(iter(active.values()))>0 else -1
            active_syms=set(active)
            still_owned=(d['side']==side and bool(active_syms & set(d['leaders'])))
            if still_owned:
                loss_confirm=0
            else:
                loss_confirm+=1
            if loss_confirm>=2:
                # Handoff only if the replacement itself has persisted; otherwise exit to cash.
                if stable and d['leaders'] and d['side']!=0:
                    gross=STRONG_GROSS if d['strength']>=1.20 else BASE_GROSS
                    common=[s for s in d['leaders'] if s in prev_desired['leaders']]
                    if common:
                        use=common[:2]
                        target={use[0]:d['side']*gross} if len(use)==1 else {use[0]:d['side']*gross*.65,use[1]:d['side']*gross*.35}
                        handoffs+=1
                    else:
                        target={}; exits+=1
                else:
                    target={}; exits+=1
                loss_confirm=0

        # Fixed-book lifecycle: no resize while ownership remains valid.
        if active and target and set(active)==set(target) and all((active[s]>0)==(target[s]>0) for s in active):
            target=dict(active)

        interval=0.0; legs=[]; valid=True
        # Returns are earned by the book held during the next observation window.
        for s,w in target.items():
            i=idx[s].get(ts)
            if i is None:valid=False;break
            ei=i+1+delay; xi=ei+OBS_HOURS
            if xi>=len(candles[s]) or int(candles[s][xi]['ts'])>=end:valid=False;break
            ep=float(candles[s][ei]['open']); xp=float(candles[s][xi]['open'])
            if ep<=0:valid=False;break
            ar=(xp/ep-1)*100; pnl=w*ar; interval+=pnl; contribution[s]+=pnl; legs.append({'symbol':s,'weight':w,'assetReturnPct':ar,'pnlPct':pnl})
        if not valid: prev_desired=d; continue
        universe=set(active)|set(target); turnover=sum(abs(target.get(s,0)-active.get(s,0)) for s in universe); cost=turnover*costbps/100; interval-=cost; turnover_total+=turnover
        if target:active_intervals+=1
        returns.append(interval); records.append({'ts':ts,'desired':d,'weights':target,'turnover':turnover,'costPct':cost,'returnPct':interval,'legs':legs})
        active=target; prev_desired=d
    m=metric(returns,start,end); m.update({'activeIntervals':active_intervals,'turnoverGrossUnits':turnover_total,'contributionPctPoints':contribution,'entries':entries,'exits':exits,'handoffs':handoffs,'cashIntervalPct':100*(len(returns)-active_intervals)/len(returns) if returns else 100.0})
    return {'metrics':m,'records':records}


def classify(normal,stress):
    labels=('year1_2023_24','year2_2024_25','year3_2025_26'); annual=[float(normal[x]['returnPct']) for x in labels]; astress=[float(stress[x]['returnPct']) for x in labels]
    c=normal['combined3Y']; cs=stress['combined3Y']; med=statistics.median(annual); mn=min(annual); cagr=float(c['cagrPct'])
    robust=(float(c.get('pf') or 0)>=1.40 and float(c.get('pfWithoutBest') or 0)>=1.25 and float(c['maxDDPct'])>=-40 and int(c['activeIntervals'])>=60 and float(cs['cagrPct'])>=45 and float(cs.get('pf') or 0)>=1.08 and float(cs.get('pfWithoutBest') or 0)>=1.0 and float(cs['maxDDPct'])>=-50 and sum(x>0 for x in astress)>=2 and min(astress)>-25)
    floor=mn>=80; primary=floor and med>=100 and cagr>=100 and robust; strong=min(annual)>=100 and cagr>=120 and robust
    status='ANNUAL_80_FLOOR_FAIL' if not floor else 'BELOW_PENGU_CLASS_RETURN_STANDARD' if not (med>=100 and cagr>=100) else 'RETURN_PASS_ROBUSTNESS_FAIL' if not robust else 'STRONG_100PCT_PLUS_ANNUAL_CANDIDATE' if strong else '100PCT_CLASS_CANDIDATE'
    return {'annualReturnPct':dict(zip(labels,annual)),'annualStressReturnPct':dict(zip(labels,astress)),'minimumAnnualReturnPct':mn,'medianAnnualReturnPct':med,'combined3YCagrPct':cagr,'robustnessPass':robust,'primaryCandidatePass':primary,'strongCandidatePass':strong,'status':status}


def main():
    candles,idx,_=v109.b.base.load()
    if END_2026>hist.DATA_END:raise RuntimeError('HISTORICAL_BOUNDARY_EXCEEDS_FROZEN_DATA')
    normal={};stress={}
    for label,(a,b) in PERIODS.items():
        normal[label]=simulate(candles,idx,a,b,NORMAL_BPS,0)['metrics']; stress[label]=simulate(candles,idx,a,b,STRESS_BPS,STRESS_DELAY)['metrics']
    classification=classify(normal,stress)
    out={'researchLine':'PERSISTENT_OPPORTUNITY_OWNERSHIP_V11','researchOnly':True,'productionChanged':False,'vpsChanged':False,'liveChanged':False,'realTradingEnabled':False,'freshOosRead':False,'post20260701DataUsed':False,'historicalEvidenceStatus':'DESIGN_SANITY_ONLY_ALREADY_INSPECTED','architecture':{'observationHours':OBS_HOURS,'confirmationObservations':2,'lossConfirmationObservations':2,'fixedWeightsWhileOwned':True,'pairSpecificParameters':False,'parameterGrid':False,'maxPositions':2,'baseGrossResearchOnly':BASE_GROSS,'strongGrossResearchOnly':STRONG_GROSS},'returnStandard':{'minimumEveryYearPct':80.0,'primaryMedianAnnualPct':100.0,'primary3YCagrPct':100.0,'strongMinimumEveryYearPct':100.0,'strong3YCagrPct':120.0,'eightyPctIsTarget':False,'guaranteed':False},'periods':PERIODS,'normal':normal,'stress':stress,'classification':classification,'status':classification['status'],'nextAction':'FREEZE_AND_ONE_FRESH_OOS_TEST' if classification['primaryCandidatePass'] else 'STRUCTURAL_DIAGNOSIS_NO_THRESHOLD_RETUNE'}
    root=Path(os.environ.get('RESEARCH_STATE_DIR','.research-state'));root.mkdir(parents=True,exist_ok=True);p=root/'persistent-opportunity-ownership-v11.json';p.write_text(json.dumps(out,indent=2,sort_keys=True),encoding='utf-8');print(json.dumps(out,indent=2,sort_keys=True))
if __name__=='__main__':main()
