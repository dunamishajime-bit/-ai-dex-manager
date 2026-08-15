"""Counter-Factor Ownership Episode V16.

Clean-sheet structure derived from the frozen V15 factor-alignment diagnosis.
This is not an annual-regime selector and not a pair-specific threshold patch.

Frozen causal observation before the first V16 result:
FACTOR_COUNTER__HOLD was positive in Normal AND Stress in each of the three
non-overlapping years, while FACTOR_ALIGNED__HOLD collapsed in 2024-25.

Core structure:
1. Build the same causal 168h common median market factor from BTC + five alts.
2. A tradable pair can own a direction only when:
   - its residual 12h and 48h returns versus the common factor agree in sign;
   - its own absolute 24h and 72h returns agree with that sign;
   - the common factor's trailing 24h AND 72h returns have the opposite sign.
   This state is COUNTER_FACTOR_OWNERSHIP, not a generic V15 signal plus a calendar
   filter. Both LONG and SHORT are possible.
3. Entry needs the same pair+side counter-factor state on two consecutive 6h
   observations. Two fixed slots, 0.625 gross each; no periodic resizing.
4. Rank by residual strength only when a slot is vacant. Rank never replaces an
   active owner.
5. An active episode remains owned while medium residual + absolute direction and
   counter-factor relationship survive. Exit requires two consecutive observations
   of structural loss, reducing one-bar churn.
6. No phase router, no annual selector, no pair-specific parameters, no threshold
   grid, and no gross/leverage increase from V13-V15.

Normal=10bps/delay0; Stress=30bps/delay1. Historical evidence ends 2026-07-01 and
is already inspected DESIGN evidence only. No Fresh OOS, VPS, LIVE, orders,
deployment, or production mutation.
"""
from __future__ import annotations

import json
import math
import os
import statistics
from pathlib import Path

import research_residual_market_ownership_v15 as v15
import research_lab_pair_specific_v109 as v109
import research_priority_router_v6_historical_robustness as hist

HOUR=v109.HOUR
DAY=24*HOUR
TRADE=v15.TRADE
OBS_HOURS=6
MAX_POSITIONS=2
TOTAL_GROSS=1.25
SLOT_GROSS=TOTAL_GROSS/MAX_POSITIONS
ENTRY_CONFIRMATIONS=2
LOSS_CONFIRMATIONS=2
NORMAL_BPS=10.0
STRESS_BPS=30.0
STRESS_DELAY=1
LOOKBACK=168

START_2023=hist.jst08(2023,7,1)
START_2024=hist.jst08(2024,7,1)
START_2025=hist.jst08(2025,7,1)
END_2026=hist.jst08(2026,7,1)
PERIODS={
 'year1_2023_24':(START_2023,START_2024),
 'year2_2024_25':(START_2024,START_2025),
 'year3_2025_26':(START_2025,END_2026),
 'combined3Y':(START_2023,END_2026),
}

def sgn(x): return 1 if x>0 else -1 if x<0 else 0

def states(candles,idx,ts):
    market,series=v15.factor_and_series(candles,idx,ts)
    if market is None:return {}
    mm=statistics.fmean(market);mdev=[x-mm for x in market];mvar=sum(x*x for x in mdev)
    if mvar<=1e-12:return {}
    f24=sgn(sum(market[-24:]));f72=sgn(sum(market[-72:]))
    out={}
    for s in TRADE:
        xs=series[s];xm=statistics.fmean(xs);xdev=[x-xm for x in xs]
        beta=sum(a*b for a,b in zip(xdev,mdev))/mvar
        residual=[x-beta*m for x,m in zip(xs,market)]
        rsd=statistics.pstdev(residual) if len(residual)>1 else 0.0
        if rsd<=1e-12:continue
        rr12=sum(residual[-12:])/(rsd*math.sqrt(12)+1e-12)
        rr48=sum(residual[-48:])/(rsd*math.sqrt(48)+1e-12)
        rr168=sum(residual)/(rsd*math.sqrt(168)+1e-12)
        i=idx[s].get(ts)
        r24=v109.b.ret(candles[s],i,24);r72=v109.b.ret(candles[s],i,72)
        if r24 is None or r72 is None:continue
        resid_side=1 if rr12>0 and rr48>0 else -1 if rr12<0 and rr48<0 else 0
        abs_side=1 if r24>0 and r72>0 else -1 if r24<0 and r72<0 else 0
        counter_side=resid_side if resid_side!=0 and resid_side==abs_side and f24==-resid_side and f72==-resid_side else 0
        hold_long=rr48>0 and r72>0 and f24<0 and f72<0
        hold_short=rr48<0 and r72<0 and f24>0 and f72>0
        strength=statistics.median((abs(rr12),abs(rr48),abs(rr168)))
        out[s]={
            'side':int(counter_side),
            'eligible':bool(counter_side),
            'holdLong':bool(hold_long),
            'holdShort':bool(hold_short),
            'strength':float(strength),
            'factor24Side':int(f24),
            'factor72Side':int(f72),
            'beta':float(beta),
        }
    return out

def metric(rs,start,end):
    if not rs:return {'intervals':0,'returnPct':0.0,'cagrPct':0.0,'pf':None,'pfWithoutBest':None,'maxDDPct':0.0,'winRatePct':0.0}
    equity=peak=1.0;dd=0.0;g=l=0.0
    for r in rs:
        equity*=max(.001,1+r/100);peak=max(peak,equity);dd=min(dd,(equity/peak-1)*100);g+=max(0,r);l+=max(0,-r)
    years=max((end-start)/(365.25*DAY),1e-9);total=(equity-1)*100;cagr=(equity**(1/years)-1)*100 if equity>0 else -100
    pf=g/l if l>1e-12 else (999.0 if g>0 else None)
    bi=max(range(len(rs)),key=rs.__getitem__);wo=rs[:bi]+rs[bi+1:];wg=sum(x for x in wo if x>0);wl=abs(sum(x for x in wo if x<0));pfwo=wg/wl if wl>1e-12 else (999.0 if wg>0 else None)
    return {'intervals':len(rs),'returnPct':total,'cagrPct':cagr,'pf':pf,'pfWithoutBest':pfwo,'maxDDPct':dd,'winRatePct':100*sum(x>0 for x in rs)/len(rs),'bestIntervalPct':max(rs)}

def simulate(candles,idx,start,end,costbps,delay):
    times=[int(r['ts']) for r in candles['BTC'] if start<=int(r['ts'])<end][::OBS_HOURS]
    prev={};active={};loss={};returns=[];turn=0.0;contrib={s:0.0 for s in TRADE};entries=exits=0;active_intervals=0;side_intervals={'LONG':0,'SHORT':0,'MIXED':0}
    for ts in times:
        cur=states(candles,idx,ts);target=dict(active)
        for s,side in list(active.items()):
            st=cur.get(s);alive=bool(st and (st['holdLong'] if side>0 else st['holdShort']))
            loss[s]=0 if alive else loss.get(s,0)+1
            if loss[s]>=LOSS_CONFIRMATIONS:target.pop(s,None);loss.pop(s,None);exits+=1
        vacancies=MAX_POSITIONS-len(target)
        if vacancies>0:
            cs=[]
            for s,st in cur.items():
                if s in target or not st['eligible'] or st['side']==0:continue
                pr=prev.get(s)
                if not pr or not pr.get('eligible') or pr.get('side')!=st['side']:continue
                cs.append((st['strength'],s,int(st['side'])))
            cs.sort(reverse=True)
            for _,s,side in cs[:vacancies]:target[s]=side;loss[s]=0;entries+=1
        tw={s:side*SLOT_GROSS for s,side in target.items()};aw={s:side*SLOT_GROSS for s,side in active.items()};interval=0.0;valid=True
        for s,w in tw.items():
            i=idx[s].get(ts)
            if i is None:valid=False;break
            ei=i+1+delay;xi=ei+OBS_HOURS
            if xi>=len(candles[s]) or int(candles[s][xi]['ts'])>=end:valid=False;break
            ep=float(candles[s][ei]['open']);xp=float(candles[s][xi]['open'])
            if ep<=0:valid=False;break
            pnl=w*(xp/ep-1)*100;interval+=pnl;contrib[s]+=pnl
        if not valid:prev=cur;continue
        universe=set(tw)|set(aw);tu=sum(abs(tw.get(s,0)-aw.get(s,0)) for s in universe);interval-=tu*costbps/100;turn+=tu
        if tw:
            active_intervals+=1;signs={1 if w>0 else -1 for w in tw.values()};side_intervals['MIXED' if len(signs)>1 else 'LONG' if 1 in signs else 'SHORT']+=1
        returns.append(interval);active=target;prev=cur
    m=metric(returns,start,end);m.update({'activeIntervals':active_intervals,'cashIntervalPct':100*(len(returns)-active_intervals)/len(returns) if returns else 100.0,'turnoverGrossUnits':turn,'contributionPctPoints':contrib,'entries':entries,'exits':exits,'sideIntervals':side_intervals});return m

def classify(normal,stress):
    labels=('year1_2023_24','year2_2024_25','year3_2025_26');annual=[float(normal[x]['returnPct']) for x in labels];stress_annual=[float(stress[x]['returnPct']) for x in labels];c=normal['combined3Y'];cs=stress['combined3Y'];med=statistics.median(annual);mn=min(annual);cagr=float(c['cagrPct'])
    robust=(float(c.get('pf') or 0)>=1.40 and float(c.get('pfWithoutBest') or 0)>=1.25 and float(c['maxDDPct'])>=-40 and int(c['activeIntervals'])>=100 and float(cs['cagrPct'])>=45 and float(cs.get('pf') or 0)>=1.08 and float(cs.get('pfWithoutBest') or 0)>=1.0 and float(cs['maxDDPct'])>=-50 and sum(x>0 for x in stress_annual)>=2 and min(stress_annual)>-25)
    floor=mn>=80;primary=floor and med>=100 and cagr>=100 and robust;strong=min(annual)>=100 and cagr>=120 and robust
    status='ANNUAL_80_FLOOR_FAIL' if not floor else 'BELOW_PENGU_CLASS_RETURN_STANDARD' if not(med>=100 and cagr>=100) else 'RETURN_PASS_ROBUSTNESS_FAIL' if not robust else 'STRONG_100PCT_PLUS_ANNUAL_CANDIDATE' if strong else '100PCT_CLASS_CANDIDATE'
    return {'annualReturnPct':dict(zip(labels,annual)),'annualStressReturnPct':dict(zip(labels,stress_annual)),'minimumAnnualReturnPct':mn,'medianAnnualReturnPct':med,'combined3YCagrPct':cagr,'robustnessPass':bool(robust),'primaryCandidatePass':bool(primary),'strongCandidatePass':bool(strong),'status':status}

def main():
    candles,idx,_=v109.b.base.load()
    if END_2026>hist.DATA_END:raise RuntimeError('HISTORICAL_BOUNDARY_EXCEEDS_FROZEN_DATA')
    normal={};stress={}
    for label,(a,b) in PERIODS.items():normal[label]=simulate(candles,idx,a,b,NORMAL_BPS,0);stress[label]=simulate(candles,idx,a,b,STRESS_BPS,STRESS_DELAY)
    cl=classify(normal,stress)
    out={'researchLine':'COUNTER_FACTOR_OWNERSHIP_V16','researchOnly':True,'productionChanged':False,'vpsChanged':False,'liveChanged':False,'realTradingEnabled':False,'freshOosRead':False,'post20260701DataUsed':False,'historicalEvidenceStatus':'DESIGN_SANITY_ONLY_ALREADY_INSPECTED','architecture':{'counterFactorCoreState':True,'factorHorizonsHours':[24,72],'residualLookbackHours':LOOKBACK,'bothLongShortAllowed':True,'pairSpecificParameters':False,'parameterGrid':False,'maxPositions':MAX_POSITIONS,'totalGrossResearchOnly':TOTAL_GROSS,'slotGrossResearchOnly':SLOT_GROSS,'entryConfirmations':ENTRY_CONFIRMATIONS,'lossConfirmations':LOSS_CONFIRMATIONS,'fixedSlots':True,'rankCanReplaceActiveOwner':False,'periodicResize':False,'phaseRouter':False,'annualSelector':False,'leverageRaised':False},'returnStandard':{'minimumEveryYearPct':80.0,'primaryMedianAnnualPct':100.0,'primary3YCagrPct':100.0,'strongMinimumEveryYearPct':100.0,'strong3YCagrPct':120.0,'eightyPctIsTarget':False,'guaranteed':False},'periods':PERIODS,'normal':normal,'stress':stress,'classification':cl,'status':cl['status'],'nextAction':'FREEZE_AND_ONE_FRESH_OOS_TEST' if cl['primaryCandidatePass'] else 'STRUCTURAL_DIAGNOSIS_NO_THRESHOLD_RETUNE'}
    root=Path(os.environ.get('RESEARCH_STATE_DIR','.research-state'));root.mkdir(parents=True,exist_ok=True);(root/'counter-factor-ownership-v16.json').write_text(json.dumps(out,indent=2,sort_keys=True),encoding='utf-8');print(json.dumps(out,indent=2,sort_keys=True))
if __name__=='__main__':main()
