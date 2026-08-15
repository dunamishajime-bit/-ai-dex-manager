"""Post-freeze evaluation for the Loss-Only Entry Firewall.

This file is committed before any winner collateral result is inspected. It cannot run
unless a repository-frozen firewall JSON declares frozen=true. It performs two tasks:
1) collateral evaluation on normalized historical trade records; and
2) a one-shot sanity backtest of a generic, predeclared opportunity trigger protected
   by the frozen loser-derived blockers.

The generic trigger is intentionally not learned from historical winners:
- observe every 6h;
- require 3h and 24h return to have the same non-zero sign;
- |24h return| normalized by 168h hourly volatility >= 0.50;
- 72h path efficiency >= 0.15;
- direction = sign(24h return);
- apply the frozen Loss Firewall; ANY blocker => no entry;
- choose at most two candidates by absolute normalized 24h move;
- fixed 0.625 gross per slot, total max gross 1.25;
- 24h fixed hold, no rank replacement while active;
- Normal 10bps per completed trade; Stress 30bps plus 1h entry delay;
- no leverage/gross increase, no threshold grid, no pair-specific parameters.

Historical 2023-07..2026-07 results are SANITY ONLY and cannot qualify LIVE. No Fresh
OOS, VPS, LIVE, orders, deployment, or production mutation.
"""
from __future__ import annotations

import json
import math
import os
import statistics
from collections import defaultdict
from pathlib import Path

import research_lab_pair_specific_v101 as b
import research_loss_only_firewall_discovery as d
import research_priority_router_v6_historical_robustness as hist

HOUR=b.HOUR
DAY=24*HOUR
SYMS=tuple(b.SYMS)
OBS_HOURS=6
HOLD_HOURS=24
MAX_POSITIONS=2
SLOT_GROSS=.625
TOTAL_GROSS=1.25
NORMAL_BPS=10.0
STRESS_BPS=30.0
STRESS_DELAY=1
TRIGGER_Z24=.50
TRIGGER_EFF72=.15

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


def load_firewall(path):
    x=json.loads(Path(path).read_text())
    if x.get('frozen') is not True:raise RuntimeError('FIREWALL_NOT_FROZEN')
    if x.get('derivedFromLosersOnly') is not True:raise RuntimeError('FIREWALL_NOT_LOSER_ONLY')
    bs=x.get('acceptedBlockers') or []
    return x,[(q['feature'],q['value'],q['patternId']) for q in bs]

def blocked(features,blockers):
    hits=[pid for f,v,pid in blockers if features.get(f)==v]
    return bool(hits),hits

def load_records(paths):
    uniq={}
    for path in paths:
        if not path or not Path(path).is_file():continue
        with open(path,encoding='utf-8') as f:
            for line in f:
                if not line.strip():continue
                r=json.loads(line)
                if r.get('symbol') not in SYMS or r.get('side') not in ('LONG','SHORT'):continue
                key=(r.get('sourceFamily'),r['symbol'],r['side'],r.get('entryTs'),r.get('exitTs'),round(float(r.get('returnPct') or 0),8),r.get('mode'))
                uniq[key]=r
    return list(uniq.values())
def ratio(a,b):return 100*a/b if b else 0.0

def collateral(records,candles,idx,blockers):
    usable=[]
    for r in records:
        f=d.causal_features(r,candles,idx)
        if f is None:continue
        q=dict(r);q['features']=f;q['blocked'],q['blockerHits']=blocked(f,blockers);usable.append(q)
    losers=[r for r in usable if float(r['returnPct'])<0];winners=[r for r in usable if float(r['returnPct'])>0];flat=[r for r in usable if float(r['returnPct'])==0]
    bl=[r for r in losers if r['blocked']];bw=[r for r in winners if r['blocked']]
    severity=sum(abs(float(r['returnPct'])) for r in losers);caught=sum(abs(float(r['returnPct'])) for r in bl)
    def pf(rs):
        g=sum(max(0,float(r['returnPct'])) for r in rs);l=sum(max(0,-float(r['returnPct'])) for r in rs)
        return g/l if l>1e-12 else (999.0 if g>0 else None)
    kept=[r for r in usable if not r['blocked']]
    by_symbol={}
    for s in SYMS:
        xs=[r for r in usable if r['symbol']==s];ls=[r for r in xs if float(r['returnPct'])<0];ws=[r for r in xs if float(r['returnPct'])>0]
        by_symbol[s]={'records':len(xs),'losers':len(ls),'winners':len(ws),'losersBlockedPct':ratio(sum(r['blocked'] for r in ls),len(ls)),'winnersBlockedPct':ratio(sum(r['blocked'] for r in ws),len(ws))}
    return {
      'usableRecords':len(usable),'losers':len(losers),'winners':len(winners),'flat':len(flat),
      'losersBlocked':len(bl),'losersBlockedPct':ratio(len(bl),len(losers)),
      'lossSeverityCapturedPct':ratio(caught,severity),'winnersBlocked':len(bw),'winnersBlockedPct':ratio(len(bw),len(winners)),
      'pfBefore':pf(usable),'pfAfter':pf(kept),'sumReturnPctPointsBefore':sum(float(r['returnPct']) for r in usable),'sumReturnPctPointsAfter':sum(float(r['returnPct']) for r in kept),
      'keptRecords':len(kept),'bySymbol':by_symbol,
      'interpretationWarning':'heterogeneous historical strategy trades; not portfolio CAGR',
    }

def generic_signal(s,candles,idx,ts):
    i=idx[s].get(ts)
    if i is None or i<336:return None
    c=candles[s];v=b.vol(c,i,168)
    if v<=1e-12:return None
    r3=b.ret(c,i,3);r24=b.ret(c,i,24)
    if r3 is None or r24 is None or r3==0 or r24==0 or r3*r24<=0:return None
    z24=r24/(v*math.sqrt(24)+1e-12)
    if abs(z24)<TRIGGER_Z24:return None
    if b.efficiency(c,i,72)<TRIGGER_EFF72:return None
    return (1 if r24>0 else -1,abs(z24))
def synthetic_record(s,side,ts):return {'symbol':s,'side':'LONG' if side>0 else 'SHORT','entryTs':ts}
def metric(rs,start,end):
    if not rs:return {'intervals':0,'returnPct':0.0,'cagrPct':0.0,'pf':None,'pfWithoutBest':None,'maxDDPct':0.0,'winRatePct':0.0}
    eq=peak=1.0;dd=0.0;g=l=0.0
    for r in rs:
        eq*=max(.001,1+r/100);peak=max(peak,eq);dd=min(dd,(eq/peak-1)*100);g+=max(0,r);l+=max(0,-r)
    years=max((end-start)/(365.25*DAY),1e-9);total=(eq-1)*100;cagr=(eq**(1/years)-1)*100 if eq>0 else -100
    pf=g/l if l>1e-12 else (999.0 if g>0 else None);bi=max(range(len(rs)),key=rs.__getitem__);wo=rs[:bi]+rs[bi+1:];wg=sum(x for x in wo if x>0);wl=abs(sum(x for x in wo if x<0));pfwo=wg/wl if wl>1e-12 else (999.0 if wg>0 else None)
    return {'intervals':len(rs),'returnPct':total,'cagrPct':cagr,'pf':pf,'pfWithoutBest':pfwo,'maxDDPct':dd,'winRatePct':100*sum(x>0 for x in rs)/len(rs),'bestIntervalPct':max(rs)}
def simulate(candles,idx,start,end,costbps,delay,blockers):
    times=[int(r['ts']) for r in candles['BTC'] if start<=int(r['ts'])<end][::OBS_HOURS]
    active={};returns=[];blocked_count=trigger_count=entries=0;contrib={s:0.0 for s in SYMS}
    for ts in times:
        interval=0.0
        # Realize slots whose fixed hold ends at this observation.
        for s in list(active):
            a=active[s]
            if ts>=a['exitTs']:
                i=idx[s].get(ts)
                if i is not None:
                    xi=min(i+delay,len(candles[s])-1);xp=float(candles[s][xi]['open']);p=a['side']*(xp/a['entryPx']-1)*100*SLOT_GROSS-costbps/100*SLOT_GROSS;interval+=p;contrib[s]+=p
                active.pop(s,None)
        vacancies=MAX_POSITIONS-len(active)
        if vacancies>0:
            candidates=[]
            for s in SYMS:
                if s in active:continue
                sg=generic_signal(s,candles,idx,ts)
                if not sg:continue
                trigger_count+=1;side,strength=sg;f=d.causal_features(synthetic_record(s,side,ts),candles,idx)
                if f is None:continue
                is_blocked,_=blocked(f,blockers)
                if is_blocked:blocked_count+=1;continue
                candidates.append((strength,s,side))
            candidates.sort(reverse=True)
            for _,s,side in candidates[:vacancies]:
                i=idx[s].get(ts);ei=i+1+delay
                if ei>=len(candles[s]):continue
                active[s]={'side':side,'entryPx':float(candles[s][ei]['open']),'exitTs':ts+HOLD_HOURS*HOUR};entries+=1
        returns.append(interval)
    # close remaining at end boundary using last available close, applying trade cost once.
    for s,a in list(active.items()):
        rows=[r for r in candles[s] if start<=int(r['ts'])<end]
        if rows:
            xp=float(rows[-1]['close']);p=a['side']*(xp/a['entryPx']-1)*100*SLOT_GROSS-costbps/100*SLOT_GROSS;returns.append(p);contrib[s]+=p
    m=metric(returns,start,end);m.update({'genericTriggers':trigger_count,'blockedTriggers':blocked_count,'blockedTriggerPct':ratio(blocked_count,trigger_count),'entries':entries,'contributionPctPoints':contrib,'maxGross':TOTAL_GROSS})
    return m
def classify(normal,stress):
    labels=('year1_2023_24','year2_2024_25','year3_2025_26');annual=[normal[x]['returnPct'] for x in labels];sa=[stress[x]['returnPct'] for x in labels];c=normal['combined3Y'];cs=stress['combined3Y'];med=statistics.median(annual);mn=min(annual)
    robust=(float(c.get('pf') or 0)>=1.40 and float(c.get('pfWithoutBest') or 0)>=1.25 and c['maxDDPct']>=-40 and float(cs.get('pf') or 0)>=1.08 and float(cs.get('pfWithoutBest') or 0)>=1.0 and cs['maxDDPct']>=-50 and sum(x>0 for x in sa)>=2 and min(sa)>-25)
    primary=mn>=80 and med>=100 and c['cagrPct']>=100 and robust;strong=min(annual)>=100 and c['cagrPct']>=120 and robust
    return {'annualReturnPct':dict(zip(labels,annual)),'annualStressReturnPct':dict(zip(labels,sa)),'minimumAnnualReturnPct':mn,'medianAnnualReturnPct':med,'combined3YCagrPct':c['cagrPct'],'robustnessPass':robust,'primaryCandidatePass':primary,'strongCandidatePass':strong,'status':'100PCT_CLASS_CANDIDATE' if primary else 'HISTORICAL_SANITY_FAIL'}
def main():
    fw,blockers=load_firewall(os.environ.get('FIREWALL_PATH','docs/research/LOSS_ONLY_FIREWALL_FROZEN_20260816.json'));candles,idx,_=b.base.load()
    paths=[p for p in os.environ.get('NORMALIZED_TRADE_PATHS','').split(':') if p]
    col=collateral(load_records(paths),candles,idx,blockers) if paths else None
    normal={};stress={}
    for k,(a,z) in PERIODS.items():normal[k]=simulate(candles,idx,a,z,NORMAL_BPS,0,blockers);stress[k]=simulate(candles,idx,a,z,STRESS_BPS,STRESS_DELAY,blockers)
    cl=classify(normal,stress)
    out={'researchLine':'LOSS_FIREWALL_POSTFREEZE_EVAL','researchOnly':True,'firewallFrozenBeforeWinnerEvaluation':True,'firewallSourceDigest':fw.get('discoveryArtifactDigest'),'productionChanged':False,'vpsChanged':False,'liveChanged':False,'realTradingEnabled':False,'freshOosRead':False,'post20260701DataUsed':False,'genericTriggerPredeclared':{'observationHours':OBS_HOURS,'sameSignReturnHours':[3,24],'minAbsZ24':TRIGGER_Z24,'minEfficiency72':TRIGGER_EFF72,'holdHours':HOLD_HOURS,'maxPositions':MAX_POSITIONS,'slotGross':SLOT_GROSS,'totalGross':TOTAL_GROSS,'pairSpecificParameters':False,'parameterGrid':False},'acceptedBlockers':[x[2] for x in blockers],'collateral':col,'normal':normal,'stress':stress,'classification':cl,'status':cl['status'],'nextAction':'NO_SAME_EVIDENCE_TUNING'}
    root=Path(os.environ.get('RESEARCH_STATE_DIR','.research-state'));root.mkdir(parents=True,exist_ok=True);(root/'loss-firewall-postfreeze-eval.json').write_text(json.dumps(out,indent=2,sort_keys=True),encoding='utf-8');print(json.dumps(out,indent=2,sort_keys=True))
if __name__=='__main__':main()
