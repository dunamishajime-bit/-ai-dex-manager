from __future__ import annotations

import json, math, os, statistics
from pathlib import Path

import research_lab_parallel_event_regime_v53 as base

HOUR=base.HOUR; DAY=24*HOUR; YEAR=365*DAY
SYMS=["BTC","ETH","BNB","SOL","LINK","AVAX"]
NORMAL_BPS=10.0; STRESS_BPS=30.0
ret=base.ret; metric=base.metric


def load():
    candles,idx,fby=base.load()
    for s in SYMS:
        if s not in candles: raise RuntimeError(f"MISSING_SYMBOL:{s}")
    return candles,idx,fby


def fixed_periods(candles):
    start=1754761200000  # 2025-08-10 00:00 JST
    end=1786297200000    # 2026-08-10 00:00 JST exclusive
    common_first=max(int(candles[s][0]["ts"]) for s in SYMS)
    common_last=min(int(candles[s][-1]["ts"]) for s in SYMS)+HOUR
    start=max(start,common_first); end=min(end,common_last)
    if end-start<330*DAY: raise RuntimeError(f"INSUFFICIENT_FIXED_HISTORY:{(end-start)/DAY:.1f}d")
    span=end-start
    a=start+int(span*.50); b=start+int(span*.70); c=start+int(span*.85)
    return {"development":(start,a),"validation":(a,b),"confirmation":(b,c),"holdout":(c,end)}


def mean(xs): return statistics.fmean(xs) if xs else 0.0

def stdev(xs): return statistics.pstdev(xs) if len(xs)>1 else 0.0

def series(c,i,n): return [ret(c,j,1) or 0.0 for j in range(i-n+1,i+1)]

def zscore(x,xs):
    sd=stdev(xs)
    return 0.0 if sd<1e-12 else (x-mean(xs))/sd

def efficiency(c,i,n):
    if i<n:return 0.0
    closes=[float(c[j]["close"]) for j in range(i-n,i+1)]
    path=sum(abs(closes[j]-closes[j-1]) for j in range(1,len(closes)))
    return abs(closes[-1]-closes[0])/path if path>1e-12 else 0.0

def breadth(candles,idx,ts,h=24):
    vals=[]
    for s in SYMS:
        i=idx[s].get(ts)
        if i is not None:
            r=ret(candles[s],i,h)
            if r is not None: vals.append(r)
    return sum(x>0 for x in vals)/len(vals) if vals else .5

def market_move(candles,idx,ts,h=12):
    vals=[]
    for s in SYMS:
        i=idx[s].get(ts)
        if i is not None:
            r=ret(candles[s],i,h)
            if r is not None: vals.append(r)
    return statistics.median(vals) if vals else 0.0


def signal_for(s,candles,idx,ts):
    c=candles[s]; i=idx[s].get(ts)
    if i is None or i<800:return None
    r6=ret(c,i,6) or 0.0; r12=ret(c,i,12) or 0.0; r24=ret(c,i,24) or 0.0; r72=ret(c,i,72) or 0.0; r168=ret(c,i,168) or 0.0
    rv24=stdev(series(c,i,24)); rv168=stdev(series(c,i,168)); eff48=efficiency(c,i,48)
    br=breadth(candles,idx,ts,24); mm=market_move(candles,idx,ts,12)
    side=0; score=0.0; max_hold=0; stop=0.0; take=0.0; trail=0.0

    if s=="BTC":
        # Persistence state: broad confirmation + efficient directional path after relative vol normalization.
        trend=(r72+r168*.5)
        state=rv24 < max(rv168*1.35,1e-9) and eff48>.28
        if state and br>=.50 and trend>3 and r12>0: side=1; score=abs(trend)*(0.5+eff48); max_hold=48
        elif state and br<=.50 and trend<-3 and r12<0: side=-1; score=abs(trend)*(0.5+eff48); max_hold=36
        stop=3.0; take=8.0; trail=2.2

    elif s=="ETH":
        # Relative leadership state versus BTC with market-breadth confirmation.
        bi=idx['BTC'].get(ts)
        if bi is None:return None
        rel24=r24-(ret(candles['BTC'],bi,24) or 0.0); rel72=r72-(ret(candles['BTC'],bi,72) or 0.0)
        relhist=[]
        for k in range(96):
            t=int(c[i-k]["ts"]); bj=idx['BTC'].get(t)
            if bj is not None:
                er=ret(c,i-k,24); brt=ret(candles['BTC'],bj,24)
                if er is not None and brt is not None: relhist.append(er-brt)
        rz=zscore(rel24,relhist)
        if rel72>2 and rz>.7 and r12>0 and br>=.5: side=1; score=rel72+max(rz,0); max_hold=36
        elif rel72<-2 and rz<-.7 and r12<0 and br<=.5: side=-1; score=abs(rel72)+max(-rz,0); max_hold=30
        stop=3.8; take=9.0; trail=2.8

    elif s=="BNB":
        # Shock absorber/reversion state: fade idiosyncratic overshoot only when broad market shock is stabilizing.
        resid12=r12-mm
        hist=[]
        for k in range(120):
            t=int(c[i-k]["ts"]); hist.append((ret(c,i-k,12) or 0.0)-market_move(candles,idx,t,12))
        rz=zscore(resid12,hist)
        stabilizing=abs(mm)<3.5 and rv24<rv168*1.5
        if stabilizing and rz<-1.5 and r6>-.5 and r168>-12: side=1; score=abs(rz)+max(-resid12,0); max_hold=24
        elif stabilizing and rz>1.7 and r6<.5 and r168<15: side=-1; score=abs(rz)+max(resid12,0); max_hold=20
        stop=2.8; take=5.5; trail=2.0

    elif s=="SOL":
        # Expansion state: compression-to-impulse continuation with broad risk-on/risk-off confirmation.
        compression=rv24 < rv168*.72
        prior_eff=efficiency(c,i-12,72)
        if compression and prior_eff<.30 and r6>1.2 and r24>2.2 and br>=.67: side=1; score=r24+(rv168/max(rv24,1e-9)); max_hold=30
        elif compression and prior_eff<.30 and r6<-1.2 and r24<-2.2 and br<=.33: side=-1; score=abs(r24)+(rv168/max(rv24,1e-9)); max_hold=24
        stop=4.5; take=11.0; trail=3.2

    elif s=="LINK":
        # Residual momentum versus fixed BTC/ETH factor with persistence confirmation.
        bi=idx['BTC'].get(ts); ei=idx['ETH'].get(ts)
        if bi is None or ei is None:return None
        f24=((ret(candles['BTC'],bi,24) or 0.0)+(ret(candles['ETH'],ei,24) or 0.0))/2
        f72=((ret(candles['BTC'],bi,72) or 0.0)+(ret(candles['ETH'],ei,72) or 0.0))/2
        q24=r24-f24; q72=r72-f72
        if q24>1.2 and q72>2.5 and r6>0 and eff48>.25: side=1; score=q24+q72*.5; max_hold=30
        elif q24<-1.2 and q72<-2.5 and r6<0 and eff48>.25: side=-1; score=abs(q24)+abs(q72)*.5; max_hold=24
        stop=4.0; take=8.0; trail=2.8

    elif s=="AVAX":
        # Capitulation/rebound asymmetry: long stabilization after broad selloff; short failed rebound in weak breadth.
        draw=ret(c,i,48) or 0.0; prev6=ret(c,i-6,6) or 0.0
        if draw<-8 and mm<0 and prev6<-1.5 and r6>0.8 and br>=.33: side=1; score=abs(draw)+r6*2; max_hold=36
        elif r72>8 and prev6>1.5 and r6<-.8 and br<=.5 and rv24>rv168*.9: side=-1; score=r72+abs(r6)*2; max_hold=24
        stop=5.0; take=12.0; trail=3.5

    if side==0:return None
    # Risk score rewards signal quality but caps pair aggressiveness.
    risk=min(1.0,max(.35,score/8.0))
    return {"symbol":s,"side":side,"score":score,"risk":risk,"max_hold":max_hold,"stop":stop,"take":take,"trail":trail}


def path_trade(c,idx,ts,sig,costbps,delay=0):
    i=idx.get(ts)
    if i is None:return None,None
    ent=i+1+delay
    if ent>=len(c):return None,None
    ep=float(c[ent]["open"] if "open" in c[ent] else c[ent]["close"])
    side=sig['side']; best=0.0; exit_i=None
    for j in range(ent,min(len(c),ent+sig['max_hold']+1)):
        px=float(c[j]["close"]); pnl=side*(px/ep-1)*100
        best=max(best,pnl)
        if pnl<=-sig['stop'] or pnl>=sig['take'] or (best>=sig['trail']*1.5 and best-pnl>=sig['trail']):
            exit_i=j; break
    if exit_i is None: exit_i=min(len(c)-1,ent+sig['max_hold'])
    xp=float(c[exit_i]["close"])
    gross=side*(xp/ep-1)*100
    net=gross-2*costbps/100
    return net,int(c[exit_i]["ts"])


def run_pair(s,candles,idx,start,end,costbps,delay=0):
    out=[]; last_exit=-1
    for row in candles[s]:
        ts=int(row['ts'])
        if ts<start or ts>=end or ts<=last_exit:continue
        sig=signal_for(s,candles,idx,ts)
        if not sig:continue
        p,xt=path_trade(candles[s],idx[s],ts,sig,costbps,delay)
        if p is not None:
            out.append(p*sig['risk']); last_exit=xt or ts
    return out


def run_portfolio(candles,idx,start,end,costbps,delay=0):
    out=[]; contrib={s:[] for s in SYMS}; last_exit=-1
    times=[int(r['ts']) for r in candles['BTC'] if start<=int(r['ts'])<end]
    for ts in times:
        if ts<=last_exit:continue
        sigs=[]
        for s in SYMS:
            sg=signal_for(s,candles,idx,ts)
            if sg:sigs.append(sg)
        if not sigs:continue
        # Correlation/conflict resolver: max two simultaneous ideas, prefer strongest scores; opposing market bets are allowed only if distinct residual signal wins strongly.
        sigs.sort(key=lambda x:x['score']*x['risk'],reverse=True)
        chosen=sigs[:2]
        vals=[]; exits=[]
        weights=[]
        total=sum(x['risk'] for x in chosen)
        for sg in chosen:
            w=sg['risk']/total if total>0 else 1/len(chosen)
            p,xt=path_trade(candles[sg['symbol']],idx[sg['symbol']],ts,sg,costbps,delay)
            if p is not None:
                vals.append((sg['symbol'],p,w)); exits.append(xt or ts); weights.append(w)
        if vals:
            pr=sum(p*w for _,p,w in vals)
            out.append(pr)
            for s,p,w in vals:contrib[s].append(p*w)
            last_exit=max(exits)
    return out,contrib


def ok(m,stage):
    mins={"development":18,"validation":10,"confirmation":8,"holdout":8}
    pfmin={"development":1.05,"validation":1.05,"confirmation":1.20,"holdout":1.00}
    return m['trades']>=mins[stage] and (m['pf'] or 0)>=pfmin[stage] and m['returnPct']>0 and m['maxDDPct']>-20 and m['bestSharePct']<45


def main():
    candles,idx,_=load(); ps=fixed_periods(candles)
    result={"strategyId":"PAIR_SPECIFIC_STATE_MACHINE_V99","universe":[s+"/USDT" for s in SYMS],"periods":ps,"normalBps":NORMAL_BPS,"stressBps":STRESS_BPS,"productionChanged":False,"realTradingEnabled":False}
    result['pairStandaloneDevelopment']={s:metric(run_pair(s,candles,idx,*ps['development'],NORMAL_BPS,0)) for s in SYMS}
    dev,_=run_portfolio(candles,idx,*ps['development'],NORMAL_BPS,0); dm=metric(dev); result['development']=dm
    if not ok(dm,'development'):
        result.update(status='NO_ROBUST_IMPROVEMENT',robust=False,reason='DEVELOPMENT_FAIL')
    else:
        val,_=run_portfolio(candles,idx,*ps['validation'],NORMAL_BPS,0); vm=metric(val); result['validation']=vm
        result['pairStandaloneValidation']={s:metric(run_pair(s,candles,idx,*ps['validation'],NORMAL_BPS,0)) for s in SYMS}
        if not ok(vm,'validation'):
            result.update(status='NO_ROBUST_IMPROVEMENT',robust=False,reason='VALIDATION_FAIL')
        else:
            conf,cc=run_portfolio(candles,idx,*ps['confirmation'],NORMAL_BPS,0); cm=metric(conf)
            cs,_=run_portfolio(candles,idx,*ps['confirmation'],STRESS_BPS,1); csm=metric(cs)
            result['confirmation']=cm; result['stressConfirmation']=csm
            if not (ok(cm,'confirmation') and (cm['pfWithoutBest'] or 0)>1 and (csm['pf'] or 0)>1 and csm['returnPct']>0):
                result.update(status='NO_ROBUST_IMPROVEMENT',robust=False,reason='CONFIRMATION_FAIL')
            else:
                hold,hc=run_portfolio(candles,idx,*ps['holdout'],NORMAL_BPS,0); hm=metric(hold)
                hs,_=run_portfolio(candles,idx,*ps['holdout'],STRESS_BPS,1); hsm=metric(hs)
                result['holdout']=hm; result['stressHoldout']=hsm
                result['pairStandaloneHoldout']={s:metric(run_pair(s,candles,idx,*ps['holdout'],NORMAL_BPS,0)) for s in SYMS}
                result['holdoutPairContributionPct']={s:sum(hc[s]) for s in SYMS}
                robust=ok(hm,'holdout') and (hm['pfWithoutBest'] or 0)>1 and (hsm['pf'] or 0)>1 and hsm['returnPct']>0
                result.update(status='ROBUST_PASS' if robust else 'NO_ROBUST_IMPROVEMENT',robust=robust,reason='PASS' if robust else 'HOLDOUT_FAIL')
    out=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state')); out.mkdir(parents=True,exist_ok=True)
    stem='pair-specific-state-machine-v99'
    (out/f'{stem}.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    (out/f'{stem}.md').write_text('# Pair Specific State Machine V99\n\n```json\n'+json.dumps(result,indent=2)+'\n```\n',encoding='utf-8')
    print(json.dumps(result,indent=2))

if __name__=='__main__':main()
