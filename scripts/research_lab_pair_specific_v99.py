from __future__ import annotations
import json, math, os, statistics
from pathlib import Path
import research_lab_parallel_event_regime_v53 as base

HOUR=base.HOUR; DAY=24*HOUR; YEAR=365*DAY
SYMS=['BTC','ETH','BNB','SOL','LINK','AVAX']
NORMAL_BPS=10.0; STRESS_BPS=30.0
ret=base.ret; metric=base.metric; future_trade=base.future_trade

# Pair-specific candidate architectures. Selection is Development-only, then frozen.
POOLS={
 'BTC':['trend_pullback','vol_breakout','shock_reversal'],
 'ETH':['trend_pullback','residual_momentum','vol_breakout'],
 'BNB':['range_reclaim','shock_reversal','residual_momentum'],
 'SOL':['vol_breakout','shock_reversal','trend_pullback'],
 'LINK':['residual_momentum','range_reclaim','vol_breakout'],
 'AVAX':['shock_reversal','range_reclaim','residual_momentum'],
}
PARAM={
 'BTC':dict(trend=120,fast=24,hold=24,z=1.2), 'ETH':dict(trend=96,fast=18,hold=24,z=1.1),
 'BNB':dict(trend=144,fast=24,hold=18,z=1.0), 'SOL':dict(trend=72,fast=12,hold=18,z=1.35),
 'LINK':dict(trend=120,fast=18,hold=18,z=1.2), 'AVAX':dict(trend=96,fast=12,hold=12,z=1.3),
}

def load():
    candles,idx,fby=base.load()
    for s in SYMS:
        if s not in candles: raise RuntimeError('MISSING_SYMBOL:'+s)
    return candles,idx,fby

def periods(candles):
    # Fixed end: 2026-08-10 00:00 JST == 2026-08-09 15:00 UTC.
    fixed_end=1786287600000
    first=max(int(candles[s][0]['ts']) for s in SYMS)
    available=min(int(candles[s][-2]['ts']) for s in SYMS)
    end=min(fixed_end,available)
    start=max(first,end-YEAR)
    span=end-start
    if span<330*DAY: raise RuntimeError(f'INSUFFICIENT_COMMON_HISTORY:{span/DAY:.1f}d')
    a=start+int(span*.50); b=start+int(span*.70); c=start+int(span*.85)
    return {'development':(start,a),'validation':(a,b),'confirmation':(b,c),'holdout':(c,end)}

def mean(xs): return statistics.fmean(xs) if xs else 0.0

def stdev(xs): return statistics.pstdev(xs) if len(xs)>1 else 0.0

def rseries(c,i,n): return [ret(c,j,1) or 0.0 for j in range(i-n+1,i+1)]

def signal(arch,s,candles,idx,ts):
    i=idx[s].get(ts); p=PARAM[s]
    if i is None or i<500:return None
    c=candles[s]; btc=candles['BTC']; bi=idx['BTC'].get(ts)
    if bi is None or bi<500:return None
    r6=ret(c,i,6); r12=ret(c,i,12); r24=ret(c,i,24); r72=ret(c,i,72)
    b24=ret(btc,bi,24); b72=ret(btc,bi,72)
    if None in (r6,r12,r24,r72,b24,b72):return None
    rs=rseries(c,i,p['trend']); vol=stdev(rs)
    if vol<=1e-9:return None
    fast=rseries(c,i,p['fast']); z=(sum(fast)/math.sqrt(len(fast)))/max(vol,1e-9)
    hold=p['hold']
    # Explicit no-trade state is the default return None.
    if arch=='trend_pullback':
        regime=(r72>1.0 and b72>0) or (r72<-1.0 and b72<0)
        if not regime:return None
        if r72>1.0 and r6<0 and r24>0 and z>-0.8:return (1,hold)
        if r72<-1.0 and r6>0 and r24<0 and z<0.8:return (-1,hold)
    elif arch=='vol_breakout':
        old=stdev(rseries(c,i-24,96)); new=stdev(rseries(c,i,24))
        breadth=sum((ret(candles[x],idx[x].get(ts),24) or 0)>0 for x in SYMS if idx[x].get(ts) is not None)
        if old>0 and new>old*1.25 and abs(r12)>max(1.0,0.9*vol*math.sqrt(12)):
            if r12>0 and breadth>=4:return (1,hold)
            if r12<0 and breadth<=2:return (-1,hold)
    elif arch=='shock_reversal':
        if abs(r6)>=max(2.0,1.8*vol*math.sqrt(6)):
            confirm=ret(c,i,2) or 0.0
            if r6<0 and confirm>0:return (1,hold)
            if r6>0 and confirm<0:return (-1,hold)
    elif arch=='range_reclaim':
        closes=[float(c[j]['close']) for j in range(i-72,i+1)]
        ma=mean(closes[:-1]); sd=stdev(closes[:-1]); px=closes[-1]
        if sd<=1e-9:return None
        dev=(px-ma)/sd
        prev=float(c[i-3]['close']); prevdev=(prev-ma)/sd
        if prevdev<-1.6 and dev>-1.0 and r6>0:return (1,hold)
        if prevdev>1.6 and dev<1.0 and r6<0:return (-1,hold)
    elif arch=='residual_momentum':
        eth=candles['ETH']; ei=idx['ETH'].get(ts)
        if ei is None:return None
        factor=((ret(btc,bi,24) or 0)+(ret(eth,ei,24) or 0))/2
        resid=r24-factor
        if abs(resid)>max(1.0,p['z']*vol*math.sqrt(24)) and abs(r72)>1.0:
            return (1 if resid>0 else -1,hold)
    return None

def gen_pair(arch,s,candles,idx,start,end,costbps,delay):
    out=[]; last_exit=-1
    for row in candles[s]:
        ts=int(row['ts'])
        if ts<start or ts>=end or ts<=last_exit:continue
        sig=signal(arch,s,candles,idx,ts)
        if not sig:continue
        side,hold=sig
        v=future_trade(candles[s],idx[s],ts,side,hold,delay,costbps)
        if v is None:continue
        out.append((ts,v)); last_exit=ts+hold*HOUR
    return out

def m(events): return metric([x[1] for x in events])

def score(mm):
    pf=mm.get('pf') or 0; dd=mm.get('maxDDPct') or -100; n=mm.get('trades') or 0; rr=mm.get('returnPct') or -100
    if n<10:return -1e9
    return rr + 8*(pf-1) + 0.25*dd - max(0,20-n)*0.2

def combine(stage_events):
    # Six equal capital sleeves; overlapping trades remain independent and are scaled 1/6.
    ev=[]; contrib={s:0.0 for s in SYMS}
    for s,arr in stage_events.items():
        for ts,v in arr:
            ev.append((ts,v/6.0)); contrib[s]+=v/6.0
    ev.sort(key=lambda x:x[0])
    return ev,contrib

def main():
    candles,idx,_=load(); ps=periods(candles)
    chosen={}; dev_detail={}
    for s in SYMS:
        best=None
        for arch in POOLS[s]:
            e=gen_pair(arch,s,candles,idx,*ps['development'],NORMAL_BPS,0); mm=m(e)
            dev_detail.setdefault(s,{})[arch]=mm
            sc=score(mm)
            if best is None or sc>best[0]:best=(sc,arch,mm)
        chosen[s]=best[1]
    result={'strategyId':'PAIR_SPECIFIC_V99','periods':ps,'chosenFrozenAfterDevelopment':chosen,'developmentCandidates':dev_detail,'normalBps':NORMAL_BPS,'stressBps':STRESS_BPS,'productionChanged':False,'realTradingEnabled':False}
    stages={}
    for stage in ['development','validation','confirmation','holdout']:
        pe={s:gen_pair(chosen[s],s,candles,idx,*ps[stage],NORMAL_BPS,0) for s in SYMS}
        se={s:gen_pair(chosen[s],s,candles,idx,*ps[stage],STRESS_BPS,1) for s in SYMS}
        port,con=combine(pe); sport,_=combine(se)
        stages[stage]={'portfolio':m(port),'stressPortfolio':m(sport),'pairs':{s:m(pe[s]) for s in SYMS},'contributionPct':con}
    result['stages']=stages
    h=stages['holdout']; c=stages['confirmation']; full_events={s:gen_pair(chosen[s],s,candles,idx,ps['development'][0],ps['holdout'][1],NORMAL_BPS,0) for s in SYMS}; full,fc=combine(full_events); fm=m(full)
    result['oneYearPortfolio']=fm; result['oneYearContributionPct']=fc
    pairs_positive=sum((stages['validation']['pairs'][s]['pf'] or 0)>1 and stages['validation']['pairs'][s]['returnPct']>0 for s in SYMS)
    robust=(fm['returnPct']>=60 and (fm['pf'] or 0)>=1.2 and fm['maxDDPct']>-20 and (h['portfolio']['pf'] or 0)>1 and h['portfolio']['returnPct']>0 and (h['stressPortfolio']['pf'] or 0)>1 and h['stressPortfolio']['returnPct']>0 and (c['portfolio']['pf'] or 0)>=1.2 and pairs_positive>=4)
    result['robust']=robust; result['status']='ROBUST_PASS' if robust else 'NO_ROBUST_IMPROVEMENT'; result['pairsPositiveValidation']=pairs_positive
    out=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state')); out.mkdir(parents=True,exist_ok=True)
    (out/'pair-specific-v99.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps(result,indent=2))
if __name__=='__main__':main()
