from __future__ import annotations

import argparse, json, math, os, statistics
from datetime import datetime, timezone
from pathlib import Path

import research_lab_parallel_event_regime_v53 as base

HOUR=base.HOUR; DAY=24*HOUR
SYMS=["BTC","ETH","BNB","SOL","LINK","AVAX"]
NORMAL_BPS=10.0; STRESS_BPS=30.0
FIXED_END=int(datetime(2026,8,9,15,0,0,tzinfo=timezone.utc).timestamp()*1000)
FIXED_START=FIXED_END-365*DAY
ret=base.ret; metric=base.metric; future_trade=base.future_trade


def load():
    candles,idx,fby=base.load()
    for s in SYMS:
        if s not in candles: raise RuntimeError(f"MISSING_SYMBOL:{s}")
    first=max(int(candles[s][0]['ts']) for s in SYMS)
    last=min(int(candles[s][-2]['ts']) for s in SYMS)
    if first>FIXED_START or last<FIXED_END-2*HOUR:
        raise RuntimeError(f"INSUFFICIENT_FIXED_HISTORY:first={first},last={last}")
    return candles,idx,fby


def periods():
    span=FIXED_END-FIXED_START
    a=FIXED_START+int(span*.50); b=FIXED_START+int(span*.70); c=FIXED_START+int(span*.85)
    return {'development':(FIXED_START,a),'validation':(a,b),'confirmation':(b,c),'holdout':(c,FIXED_END)}


def sma(c,i,n):
    if i-n+1<0:return None
    return statistics.fmean(float(c[j]['close']) for j in range(i-n+1,i+1))

def vol(c,i,n):
    if i-n<0:return None
    xs=[ret(c,j,1) or 0.0 for j in range(i-n+1,i+1)]
    return statistics.pstdev(xs)

def efficiency(c,i,n):
    if i-n<0:return None
    xs=[float(c[j]['close']) for j in range(i-n,i+1)]
    path=sum(abs(xs[j]-xs[j-1]) for j in range(1,len(xs)))
    return abs(xs[-1]-xs[0])/path if path>1e-12 else 0.0

def zret(c,i,short,long):
    r=ret(c,i,short)
    if r is None or i-long<0:return None
    hist=[ret(c,j,short) for j in range(i-long+short,i+1,short)]
    hist=[x for x in hist if x is not None]
    if len(hist)<8:return None
    m=statistics.fmean(hist); sd=statistics.pstdev(hist)
    return (r-m)/sd if sd>1e-9 else 0.0


def recipe_signal(recipe,s,candles,idx,ts):
    i=idx[s].get(ts)
    if i is None or i<800:return None
    c=candles[s]; px=float(c[i]['close']); v24=vol(c,i,24); v168=vol(c,i,168)
    if v24 is None or v168 is None:return None
    r3=ret(c,i,3); r6=ret(c,i,6); r24=ret(c,i,24); r72=ret(c,i,72); r168=ret(c,i,168)
    if None in (r3,r6,r24,r72,r168):return None
    e48=efficiency(c,i,48); e168=efficiency(c,i,168)
    if e48 is None or e168 is None:return None
    s24=sma(c,i,24); s72=sma(c,i,72); s168=sma(c,i,168)
    if None in (s24,s72,s168):return None

    # BTC specialists
    if recipe=='btc_trend_pullback':
        if px>s168 and s24>s72 and r168>2 and -1.2<r6<0.2 and r3>0 and e168>.25:return (1,48,abs(r168)+e168*5)
        if px<s168 and s24<s72 and r168<-2 and -0.2<r6<1.2 and r3<0 and e168>.25:return (-1,48,abs(r168)+e168*5)
    if recipe=='btc_shock_rebound':
        z=zret(c,i,6,240)
        if z is not None and z<-2.1 and r3>0 and px>s168*.92:return (1,30,abs(z))
        if z is not None and z>2.4 and r3<0 and px<s168*1.08:return (-1,24,abs(z))
    if recipe=='btc_session_impulse':
        hour=datetime.fromtimestamp(ts/1000,tz=timezone.utc).hour
        if hour in (0,8,13) and abs(r6)>1.0 and e48>.35 and v24>=v168*.85:return (1 if r6>0 else -1,18,abs(r6)+e48)

    # ETH specialists
    if recipe=='eth_relative_btc':
        bi=idx['BTC'].get(ts)
        if bi is not None:
            br=ret(candles['BTC'],bi,24); br72=ret(candles['BTC'],bi,72)
            if br is not None and br72 is not None:
                res=r24-br; res72=r72-br72
                if res>1.0 and res72>1.5 and r3>0 and px>s72:return (1,30,res+res72/2)
                if res<-1.0 and res72<-1.5 and r3<0 and px<s72:return (-1,30,abs(res)+abs(res72)/2)
    if recipe=='eth_vol_squeeze':
        if v24<v168*.65 and e48<.25 and abs(r24)<1.5:
            hi=max(float(c[j]['high']) for j in range(i-24,i)); lo=min(float(c[j]['low']) for j in range(i-24,i))
            if px>hi and r3>0:return (1,30,2+e168)
            if px<lo and r3<0:return (-1,30,2+e168)
    if recipe=='eth_trend_accel':
        if px>s168 and r24>1.2 and r72>2.5 and r3>0 and v24<max(v168*1.8,1e-9):return (1,36,r24+r72/2)
        if px<s168 and r24<-1.2 and r72<-2.5 and r3<0 and v24<max(v168*1.8,1e-9):return (-1,30,abs(r24)+abs(r72)/2)

    # BNB specialists
    if recipe=='bnb_efficiency_break':
        if e168<.22 and e48>.40 and abs(r24)>1.0 and abs(r72)>1.2:return (1 if r24>0 else -1,30,abs(r24)+e48*3)
    if recipe=='bnb_absorption':
        bi=idx['BTC'].get(ts)
        if bi is not None:
            br=ret(candles['BTC'],bi,6)
            if br is not None and br<-2 and r6>br+1.5 and r3>0:return (1,24,r6-br)
            if br is not None and br>2 and r6<br-1.5 and r3<0:return (-1,18,br-r6)
    if recipe=='bnb_range_revert':
        z=zret(c,i,12,240)
        if z is not None and e168<.25 and z<-1.8 and r3>0:return (1,24,abs(z))
        if z is not None and e168<.25 and z>1.8 and r3<0:return (-1,24,abs(z))

    # SOL specialists
    if recipe=='sol_vol_break':
        if v24>v168*1.25 and e48>.38 and abs(r6)>1.8 and r3*(1 if r6>0 else -1)>0:return (1 if r6>0 else -1,24,abs(r6)+v24/v168)
    if recipe=='sol_exhaustion':
        z=zret(c,i,6,240)
        if z is not None and z<-2.5 and r3>0 and e48<.40:return (1,18,abs(z))
        if z is not None and z>2.7 and r3<0 and e48<.40:return (-1,18,abs(z))
    if recipe=='sol_trend':
        if px>s168 and r72>4 and r24>1 and r3>0 and e168>.28:return (1,36,r72/2+e168)
        if px<s168 and r72<-4 and r24<-1 and r3<0 and e168>.28:return (-1,30,abs(r72)/2+e168)

    # LINK specialists
    if recipe=='link_shock_revert':
        z=zret(c,i,12,240)
        if z is not None and z<-2.0 and r3>0 and v24>v168*.9:return (1,24,abs(z))
        if z is not None and z>2.2 and r3<0 and v24>v168*.9:return (-1,24,abs(z))
    if recipe=='link_residual':
        bi=idx['BTC'].get(ts); ei=idx['ETH'].get(ts)
        if bi is not None and ei is not None:
            br=ret(candles['BTC'],bi,24); er=ret(candles['ETH'],ei,24)
            if br is not None and er is not None:
                res=r24-(br+er)/2
                if res>1.5 and r3>0 and px>s72:return (1,30,res)
                if res<-1.5 and r3<0 and px<s72:return (-1,30,abs(res))
    if recipe=='link_squeeze':
        if v24<v168*.6 and e48<.22 and abs(r24)<1.2:
            if r6>1.0 and r3>0:return (1,24,r6)
            if r6<-1.0 and r3<0:return (-1,24,abs(r6))

    # AVAX specialists
    if recipe=='avax_crash_rebound':
        z=zret(c,i,6,240)
        if z is not None and z<-2.4 and r24<-4 and r3>0:return (1,30,abs(z)+abs(r24)/4)
        if z is not None and z>2.8 and r24>5 and r3<0:return (-1,18,abs(z)+r24/5)
    if recipe=='avax_dispersion':
        moves=[]
        for q in SYMS:
            qi=idx[q].get(ts)
            rr=ret(candles[q],qi,24) if qi is not None else None
            if rr is not None:moves.append(rr)
        if len(moves)==6:
            med=statistics.median(moves); gap=r24-med
            if gap<-2.5 and r3>0 and e48<.35:return (1,24,abs(gap))
            if gap>3.0 and r3<0 and e48<.35:return (-1,18,gap)
    if recipe=='avax_vol_break':
        if v24>v168*1.35 and e48>.42 and abs(r6)>2.2:return (1 if r6>0 else -1,18,abs(r6)+e48)
    return None

MODES={
 'specialist_a':{
  'BTC':['btc_trend_pullback','btc_shock_rebound'],
  'ETH':['eth_relative_btc','eth_vol_squeeze'],
  'BNB':['bnb_efficiency_break','bnb_absorption'],
  'SOL':['sol_vol_break','sol_exhaustion'],
  'LINK':['link_shock_revert','link_residual'],
  'AVAX':['avax_crash_rebound','avax_dispersion']},
 'specialist_b':{
  'BTC':['btc_session_impulse','btc_trend_pullback'],
  'ETH':['eth_trend_accel','eth_relative_btc'],
  'BNB':['bnb_range_revert','bnb_efficiency_break'],
  'SOL':['sol_trend','sol_exhaustion'],
  'LINK':['link_squeeze','link_shock_revert'],
  'AVAX':['avax_vol_break','avax_crash_rebound']},
 'specialist_c':{
  'BTC':['btc_shock_rebound','btc_session_impulse'],
  'ETH':['eth_vol_squeeze','eth_trend_accel'],
  'BNB':['bnb_absorption','bnb_range_revert'],
  'SOL':['sol_vol_break','sol_trend'],
  'LINK':['link_residual','link_squeeze'],
  'AVAX':['avax_dispersion','avax_vol_break']}}


def generate_pair(recipe,s,candles,idx,start,end,costbps,delay):
    vals=[]; events=[]; next_free=-1
    for row in candles[s]:
        ts=int(row['ts'])
        if ts<start or ts>=end or ts<next_free:continue
        sig=recipe_signal(recipe,s,candles,idx,ts)
        if not sig:continue
        side,hold,score=sig
        v=future_trade(candles[s],idx[s],ts,side,hold,delay,costbps)
        if v is None:continue
        vals.append(v); events.append((ts,v,score,hold)); next_free=ts+hold*HOUR
    return vals,events


def dev_choose(mode,candles,idx,ps):
    chosen={}; evidence={}
    for s,recipes in MODES[mode].items():
        scored=[]
        for recipe in recipes:
            vals,_=generate_pair(recipe,s,candles,idx,*ps['development'],NORMAL_BPS,0)
            m=metric(vals); evidence[recipe]=m
            pf=m.get('pf') or 0; n=m.get('trades',0); dd=m.get('maxDDPct',-100); rr=m.get('returnPct',-100)
            utility=(min(pf,2.5)-1)*20 + rr + max(dd,-40)*.15 + min(n,40)*.15
            if n<8 or rr<=0 or pf<=1.02:utility-=100
            scored.append((utility,recipe))
        scored.sort(reverse=True); chosen[s]=scored[0][1]
    return chosen,evidence


def evaluate_stage(chosen,candles,idx,start,end,costbps,delay):
    pair={}; events=[]
    for s,recipe in chosen.items():
        vals,ev=generate_pair(recipe,s,candles,idx,start,end,costbps,delay)
        pair[s]=metric(vals)
        for ts,v,score,hold in ev:events.append((ts,v/3.0,s))
    events.sort(key=lambda x:x[0])
    port=[x[1] for x in events]
    return metric(port),pair


def stage_ok(m,stage):
    mins={'development':30,'validation':12,'confirmation':8,'holdout':8}
    pfmin={'development':1.05,'validation':1.05,'confirmation':1.20,'holdout':1.00}
    return m['trades']>=mins[stage] and (m['pf'] or 0)>=pfmin[stage] and m['returnPct']>0 and m['maxDDPct']>-20 and m['bestSharePct']<50


def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--mode',required=True,choices=sorted(MODES)); a=ap.parse_args()
    candles,idx,_=load(); ps=periods(); chosen,devsel=dev_choose(a.mode,candles,idx,ps)
    result={'strategyId':'PAIR_SPECIALIST_V99','mode':a.mode,'periods':ps,'chosenPairEngines':chosen,'normalBps':NORMAL_BPS,'stressBps':STRESS_BPS,'productionChanged':False,'realTradingEnabled':False}
    dm,dp=evaluate_stage(chosen,candles,idx,*ps['development'],NORMAL_BPS,0); result['development']=dm; result['developmentPairs']=dp
    vm,vp=evaluate_stage(chosen,candles,idx,*ps['validation'],NORMAL_BPS,0); result['validation']=vm; result['validationPairs']=vp
    if not (stage_ok(dm,'development') and stage_ok(vm,'validation')):
        result.update(status='NO_ROBUST_IMPROVEMENT',robust=False,reason='DEV_OR_VALIDATION_FAIL')
    else:
        cm,cp=evaluate_stage(chosen,candles,idx,*ps['confirmation'],NORMAL_BPS,0); csm,_=evaluate_stage(chosen,candles,idx,*ps['confirmation'],STRESS_BPS,1)
        result['confirmation']=cm; result['confirmationPairs']=cp; result['stressConfirmation']=csm
        confok=stage_ok(cm,'confirmation') and (cm['pfWithoutBest'] or 0)>1 and (csm['pf'] or 0)>1 and csm['returnPct']>0
        if not confok:result.update(status='NO_ROBUST_IMPROVEMENT',robust=False,reason='CONFIRMATION_FAIL')
        else:
            hm,hp=evaluate_stage(chosen,candles,idx,*ps['holdout'],NORMAL_BPS,0); hsm,_=evaluate_stage(chosen,candles,idx,*ps['holdout'],STRESS_BPS,1)
            result['holdout']=hm; result['holdoutPairs']=hp; result['stressHoldout']=hsm
            robust=stage_ok(hm,'holdout') and (hm['pfWithoutBest'] or 0)>1 and (hsm['pf'] or 0)>1 and hsm['returnPct']>0
            result.update(status='ROBUST_PASS' if robust else 'NO_ROBUST_IMPROVEMENT',robust=robust,reason='PASS' if robust else 'HOLDOUT_FAIL')
    out=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state')); out.mkdir(parents=True,exist_ok=True)
    stem=f'pair-specialist-v99-{a.mode}'
    (out/f'{stem}.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    (out/f'{stem}.md').write_text('# Pair Specialist V99\n\n```json\n'+json.dumps(result,indent=2)+'\n```\n',encoding='utf-8')
    print(json.dumps(result,indent=2))

if __name__=='__main__':main()
