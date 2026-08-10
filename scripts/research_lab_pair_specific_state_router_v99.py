from __future__ import annotations

import json, math, os, statistics
from datetime import datetime, timezone
from pathlib import Path

import research_lab_parallel_event_regime_v53 as base

HOUR=base.HOUR; DAY=24*HOUR; YEAR=365*DAY
SYMS=["BTC","ETH","BNB","SOL","LINK","AVAX"]
NORMAL_BPS=10.0; STRESS_BPS=30.0
FIXED_END=int(datetime(2026,8,9,15,0,0,tzinfo=timezone.utc).timestamp()*1000)
ret=base.ret; metric=base.metric


def load():
    candles,idx,fby=base.load()
    for s in SYMS:
        if s not in candles: raise RuntimeError(f"MISSING_SYMBOL:{s}")
    return candles,idx,fby


def periods(candles):
    first=max(int(candles[s][0]['ts']) for s in SYMS)
    last=min(min(int(candles[s][-2]['ts']) for s in SYMS),FIXED_END-HOUR)
    start=last-YEAR+HOUR
    if start<first: raise RuntimeError('INSUFFICIENT_FIXED_YEAR_HISTORY')
    span=last-start+HOUR
    a=start+int(span*.50); b=start+int(span*.70); c=start+int(span*.85)
    return {'development':(start,a),'validation':(a,b),'confirmation':(b,c),'holdout':(c,last+HOUR),'fixedWindowStart':start,'fixedWindowEndExclusive':last+HOUR}


def pstdev(xs): return statistics.pstdev(xs) if len(xs)>1 else 0.0

def vol(c,i,n):
    if i-n<0:return None
    xs=[]
    for j in range(i-n+1,i+1):
        a=float(c[j-1]['close']);b=float(c[j]['close'])
        if a>0 and b>0: xs.append(math.log(b/a))
    return pstdev(xs)*math.sqrt(24*365)*100 if len(xs)>1 else None

def zscore(hist,x):
    if len(hist)<20:return None
    sd=pstdev(hist)
    return (x-statistics.fmean(hist))/sd if sd>1e-12 else 0.0

def corr(a,b):
    if len(a)<24 or len(a)!=len(b):return 0.0
    ma=statistics.fmean(a);mb=statistics.fmean(b)
    va=sum((x-ma)**2 for x in a);vb=sum((x-mb)**2 for x in b)
    if va<=1e-12 or vb<=1e-12:return 0.0
    return sum((x-ma)*(y-mb) for x,y in zip(a,b))/math.sqrt(va*vb)


def trade(c,idx,ts,side,hold,delay,costbps,stop_pct,take_pct):
    i=idx.get(ts)
    if i is None:return None
    a=i+1+delay
    if a>=len(c):return None
    entry=float(c[a]['open'])
    if entry<=0:return None
    exit_px=None; exit_ts=None; reason='TIME'
    for j in range(a+1,min(a+hold+1,len(c))):
        hi=float(c[j]['high']);lo=float(c[j]['low'])
        if side>0:
            stop=entry*(1-stop_pct/100); take=entry*(1+take_pct/100)
            if lo<=stop: exit_px=stop;exit_ts=int(c[j]['ts']);reason='STOP';break
            if hi>=take: exit_px=take;exit_ts=int(c[j]['ts']);reason='TAKE';break
        else:
            stop=entry*(1+stop_pct/100); take=entry*(1-take_pct/100)
            if hi>=stop: exit_px=stop;exit_ts=int(c[j]['ts']);reason='STOP';break
            if lo<=take: exit_px=take;exit_ts=int(c[j]['ts']);reason='TAKE';break
    if exit_px is None:
        j=min(a+hold,len(c)-1); exit_px=float(c[j]['open']); exit_ts=int(c[j]['ts'])
    pnl=side*((exit_px/entry-1)*100)-costbps/100
    return {'entryTs':int(c[a]['ts']),'exitTs':exit_ts,'pnl':pnl,'reason':reason}

# Small predeclared mechanism menu. Pair chooses only from Development, then freezes.
CONFIGS={
 'trend_pullback':[
   {'trend':168,'imp':24,'pull':6,'hold':36,'stop':2.8,'take':6.5,'minimp':2.0},
   {'trend':240,'imp':36,'pull':8,'hold':48,'stop':3.2,'take':7.5,'minimp':2.8}],
 'shock_reversion':[
   {'look':168,'shock':6,'hold':18,'stop':2.4,'take':4.2,'z':1.8},
   {'look':240,'shock':8,'hold':24,'stop':2.8,'take':5.0,'z':2.1}],
 'residual_breakout':[
   {'look':168,'recent':12,'hold':30,'stop':2.6,'take':5.8,'z':1.7},
   {'look':240,'recent':18,'hold':42,'stop':3.0,'take':6.8,'z':1.9}],
 'compression_expansion':[
   {'slow':336,'fast':72,'imp':12,'hold':30,'stop':2.5,'take':5.5,'ratio':.72},
   {'slow':480,'fast':96,'imp':18,'hold':42,'stop':3.0,'take':6.5,'ratio':.68}],
}

def signal(mech,p,s,ts,candles,idx):
    c=candles[s]; i=idx[s].get(ts); bi=idx['BTC'].get(ts); ei=idx['ETH'].get(ts)
    if i is None or bi is None or ei is None or i<600 or bi<600 or ei<600:return None
    # shared market context is causal, but final rule is pair-specific through selected mechanism/config.
    btc24=ret(candles['BTC'],bi,24) or 0.0; breadth=0
    for q in SYMS:
        qi=idx[q].get(ts); qr=ret(candles[q],qi,24) if qi is not None else None
        breadth += 1 if qr is not None and qr>0 else 0
    if mech=='trend_pullback':
        tr=ret(c,i,p['trend']); imp=ret(c,i,p['imp']); pull=ret(c,i,p['pull']); vv=vol(c,i,72)
        if tr is None or imp is None or pull is None or vv is None or vv>180:return None
        if tr>4 and imp>p['minimp'] and pull<0 and pull>-2.5 and breadth>=3:return 1
        if tr<-4 and imp<-p['minimp'] and pull>0 and pull<2.5 and breadth<=3:return -1
    elif mech=='shock_reversion':
        rs=[]
        for j in range(i-p['look']+p['shock'],i):
            x=ret(c,j,p['shock'])
            if x is not None:rs.append(x)
        cur=ret(c,i,p['shock']); one=ret(c,i,1)
        z=zscore(rs,cur) if cur is not None else None
        if z is None or one is None:return None
        if z<=-p['z'] and one>0 and btc24>-6:return 1
        if z>=p['z'] and one<0 and btc24<6:return -1
    elif mech=='residual_breakout':
        n=p['look']; br=[];er=[];sr=[]
        for k in range(i-n+1,i+1):
            t=int(c[k]['ts']); bj=idx['BTC'].get(t);ej=idx['ETH'].get(t)
            if bj is None or ej is None:continue
            br.append(ret(candles['BTC'],bj,1) or 0);er.append(ret(candles['ETH'],ej,1) or 0);sr.append(ret(c,k,1) or 0)
        if len(sr)<n*.9:return None
        residual=[z-(x+y)/2 for x,y,z in zip(br,er,sr)]
        sd=pstdev(residual[:-p['recent']]); cur=sum(residual[-p['recent']:]); z=cur/(sd*math.sqrt(p['recent'])) if sd>1e-12 else 0
        marketcorr=corr(sr[-72:],[(x+y)/2 for x,y in zip(br[-72:],er[-72:])])
        if abs(z)>=p['z'] and marketcorr<.92:return 1 if z>0 else -1
    elif mech=='compression_expansion':
        vf=vol(c,i,p['fast']);vs=vol(c,i,p['slow']);imp=ret(c,i,p['imp'])
        if vf is None or vs is None or imp is None or vs<=0:return None
        prev=vol(c,i-p['imp'],p['fast'])
        if prev is None:return None
        # compressed state then causal expansion + directional impulse + breadth agreement
        if prev/vs<p['ratio'] and vf>prev*1.15:
            if imp>1.5 and breadth>=4:return 1
            if imp<-1.5 and breadth<=2:return -1
    return None


def generate_pair(mech,p,s,candles,idx,start,end,costbps,delay):
    out=[]; last_exit=-1
    for row in candles[s]:
        ts=int(row['ts'])
        if ts<start or ts>=end or ts<=last_exit:continue
        side=signal(mech,p,s,ts,candles,idx)
        if side is None:continue
        tr=trade(candles[s],idx[s],ts,side,p['hold'],delay,costbps,p['stop'],p['take'])
        if tr is not None:
            out.append(tr);last_exit=tr['exitTs']
    return out

def mtr(trades):return metric([x['pnl'] for x in trades])

def dev_score(m):
    if m['trades']<10 or m['maxDDPct']<=-25 or m['bestSharePct']>=55:return -999
    pf=m['pf'] or 0
    return (pf-1)*4 + m['returnPct']/20 + min(m['trades'],80)/80 + m['maxDDPct']/40

def choose_pair(s,candles,idx,ps):
    rows=[]
    for mech,plist in CONFIGS.items():
        for pi,p in enumerate(plist):
            tr=generate_pair(mech,p,s,candles,idx,*ps['development'],NORMAL_BPS,0);mm=mtr(tr)
            rows.append((dev_score(mm),mech,pi,p,mm))
    rows.sort(key=lambda x:x[0],reverse=True)
    return rows[0]

def stage_ok(m,mintr,pfmin):
    return m['trades']>=mintr and (m['pf'] or 0)>=pfmin and m['returnPct']>0 and m['maxDDPct']>-20 and m['bestSharePct']<50

def portfolio_metrics(pair_trades):
    # Equal risk sleeves; each closed trade contributes 1/3 notional, capping practical concurrent gross near 2x across six sleeves.
    xs=[]; contrib={s:0.0 for s in SYMS}
    for s in SYMS:
        for t in pair_trades.get(s,[]):
            x=t['pnl']/3.0; xs.append((t['exitTs'],x));contrib[s]+=x
    xs.sort()
    return metric([x for _,x in xs]),contrib

def main():
    candles,idx,_=load();ps=periods(candles)
    selected={};dev={}
    for s in SYMS:
        score,mech,pi,p,mm=choose_pair(s,candles,idx,ps)
        selected[s]={'mechanism':mech,'configIndex':pi,'params':p,'developmentScore':score};dev[s]=mm
    stages={};pair_stage={}
    robust_candidates=True
    for stage,mintr,pfmin in [('validation',6,1.02),('confirmation',5,1.08)]:
        pt={};pair_stage[stage]={}
        for s in SYMS:
            z=selected[s];tr=generate_pair(z['mechanism'],z['params'],s,candles,idx,*ps[stage],NORMAL_BPS,0);pt[s]=tr;pair_stage[stage][s]=mtr(tr)
        pm,con=portfolio_metrics(pt);stages[stage]={'portfolio':pm,'contribution':con}
        if not stage_ok(pm,20 if stage=='validation' else 15,pfmin):robust_candidates=False;break
    result={'strategyId':'PAIR_SPECIFIC_STATE_ROUTER_V99','periods':ps,'selectedFromDevelopmentOnly':selected,'developmentByPair':dev,'pairStages':pair_stage,'stages':stages,'productionChanged':False,'realTradingEnabled':False}
    if robust_candidates:
        conf_pt={}
        for s in SYMS:
            z=selected[s];conf_pt[s]=generate_pair(z['mechanism'],z['params'],s,candles,idx,*ps['confirmation'],STRESS_BPS,1)
        scm,scon=portfolio_metrics(conf_pt);result['stressConfirmation']={'portfolio':scm,'contribution':scon}
        if not ((scm['pf'] or 0)>1 and scm['returnPct']>0):robust_candidates=False
    if robust_candidates:
        hp={};hsp={};pair_stage['holdout']={};pair_stage['stressHoldout']={}
        for s in SYMS:
            z=selected[s]
            hp[s]=generate_pair(z['mechanism'],z['params'],s,candles,idx,*ps['holdout'],NORMAL_BPS,0)
            hsp[s]=generate_pair(z['mechanism'],z['params'],s,candles,idx,*ps['holdout'],STRESS_BPS,1)
            pair_stage['holdout'][s]=mtr(hp[s]);pair_stage['stressHoldout'][s]=mtr(hsp[s])
        hm,hcon=portfolio_metrics(hp);hsm,hscon=portfolio_metrics(hsp)
        result['holdout']={'portfolio':hm,'contribution':hcon};result['stressHoldout']={'portfolio':hsm,'contribution':hscon}
        robust=stage_ok(hm,12,1.0) and (hsm['pf'] or 0)>1 and hsm['returnPct']>0 and (hm['pfWithoutBest'] or 0)>1
    else: robust=False
    # Full fixed-year diagnostic using frozen Development selections only; never used for selection.
    full={}; full_start=ps['fixedWindowStart'];full_end=ps['fixedWindowEndExclusive']
    for s in SYMS:
        z=selected[s];full[s]=generate_pair(z['mechanism'],z['params'],s,candles,idx,full_start,full_end,NORMAL_BPS,0)
    fm,fcon=portfolio_metrics(full);result['fullYear']={'portfolio':fm,'contribution':fcon,'pair':{s:mtr(full[s]) for s in SYMS}}
    result['robust']=robust;result['returnObjectiveMet']=fm['returnPct']>=60;result['status']='ROBUST_PASS' if robust and result['returnObjectiveMet'] else 'NO_ROBUST_IMPROVEMENT'
    out=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state'));out.mkdir(parents=True,exist_ok=True)
    stem='pair-specific-state-router-v99';(out/f'{stem}.json').write_text(json.dumps(result,indent=2),encoding='utf-8');(out/f'{stem}.md').write_text('# Pair Specific State Router V99\n\n```json\n'+json.dumps(result,indent=2)+'\n```\n',encoding='utf-8')
    print(json.dumps(result,indent=2))
if __name__=='__main__':main()
