from __future__ import annotations

import json, math, os, statistics
from pathlib import Path

import research_lab_parallel_event_regime_v53 as base

HOUR=base.HOUR; DAY=24*HOUR; YEAR=365*DAY
SYMS=["BTC","ETH","BNB","SOL","LINK","AVAX"]
NORMAL_BPS=10.0; STRESS_BPS=30.0
ret=base.ret; metric=base.metric; future_trade=base.future_trade


def periods(candles):
    import datetime as dt
    end_jst=int(dt.datetime(2026,8,10,0,0,tzinfo=dt.timezone(dt.timedelta(hours=9))).timestamp()*1000)
    common_first=max(int(candles[s][0]['ts']) for s in SYMS)
    common_last=min(int(candles[s][-2]['ts']) for s in SYMS)
    end=min(end_jst,common_last); start=max(common_first,end-YEAR); span=end-start
    if span<330*DAY: raise RuntimeError(f'INSUFFICIENT_COMMON_HISTORY:{span/DAY:.1f}d')
    a=start+int(span*.50); b=start+int(span*.70); c=start+int(span*.85)
    return {'development':(start,a),'validation':(a,b),'confirmation':(b,c),'holdout':(c,end)}


def sma(c,i,n):
    if i<n:return None
    return statistics.fmean(float(c[j]['close']) for j in range(i-n+1,i+1))

def vol(c,i,n):
    if i<n:return None
    rs=[ret(c,j,1) or 0.0 for j in range(i-n+1,i+1)]
    return statistics.pstdev(rs)

def efficiency(c,i,n):
    if i<n:return None
    xs=[float(c[j]['close']) for j in range(i-n,i+1)]
    path=sum(abs(xs[j]-xs[j-1]) for j in range(1,len(xs)))
    return abs(xs[-1]-xs[0])/path if path>1e-12 else 0.0

def downside_ratio(c,i,n):
    if i<n:return None
    rs=[ret(c,j,1) or 0.0 for j in range(i-n+1,i+1)]
    up=sum(x*x for x in rs if x>0); dn=sum(x*x for x in rs if x<0)
    return math.sqrt(dn/max(1,sum(x<0 for x in rs)))/max(1e-9,math.sqrt(up/max(1,sum(x>0 for x in rs))))

def zscore(vals):
    if len(vals)<8:return 0.0
    m=statistics.fmean(vals); sd=statistics.pstdev(vals)
    return (vals[-1]-m)/sd if sd>1e-9 else 0.0

def signal(kind,c,i):
    if i<800:return None
    p=float(c[i]['close'])
    r3=ret(c,i,3); r6=ret(c,i,6); r12=ret(c,i,12); r24=ret(c,i,24); r72=ret(c,i,72); r168=ret(c,i,168)
    v12=vol(c,i,12); v48=vol(c,i,48); v168=vol(c,i,168); e24=efficiency(c,i,24); e72=efficiency(c,i,72); e168=efficiency(c,i,168)
    s24=sma(c,i,24); s72=sma(c,i,72); s168=sma(c,i,168); dr=downside_ratio(c,i,96)
    if None in (r3,r6,r12,r24,r72,r168,v12,v48,v168,e24,e72,e168,s24,s72,s168,dr):return None

    if kind=='adaptive_breakout':
        # low-noise trend transition with volatility-scaled confirmation
        if v168>0 and e168<.28 and e24>.45 and abs(r24)>max(1.0,1.4*v48) and p>s72 and r6>0:return (1,18)
        if v168>0 and e168<.28 and e24>.45 and abs(r24)>max(1.0,1.4*v48) and p<s72 and r6<0:return (-1,18)
    elif kind=='panic_recovery':
        if dr>1.25 and r72<-5 and r6>0.8 and e24<.35:return (1,24)
        if dr<.80 and r72>5 and r6<-0.8 and e24<.35:return (-1,24)
    elif kind=='volatility_switch':
        if v168>0 and v12>1.8*v168 and e24>.40 and r12>2 and p>s24:return (1,12)
        if v168>0 and v12>1.8*v168 and e24>.40 and r12<-2 and p<s24:return (-1,12)
        if v168>0 and v12<.55*v168 and e72<.20 and r24>1.5 and p>s72:return (1,24)
        if v168>0 and v12<.55*v168 and e72<.20 and r24<-1.5 and p<s72:return (-1,24)
    elif kind=='trend_pullback':
        if r168>6 and p>s168 and r24<0 and r6>0.5 and e72>.30:return (1,18)
        if r168<-6 and p<s168 and r24>0 and r6<-0.5 and e72>.30:return (-1,18)
    elif kind=='impulse_decay':
        if abs(r72)>5 and e72>.45 and e24<.18 and r3*r72<0:return (-1 if r72>0 else 1,12)
    elif kind=='semivol_transition':
        old=downside_ratio(c,i-48,96)
        if old is None:return None
        if old>1.3 and dr<.85 and r6>0 and p>s24:return (1,18)
        if old<.75 and dr>1.25 and r6<0 and p<s24:return (-1,18)
    elif kind=='multi_horizon_alignment':
        if r168>4 and r72>2 and r24>1 and r6>0 and p>s168 and e72>.32:return (1,24)
        if r168<-4 and r72<-2 and r24<-1 and r6<0 and p<s168 and e72>.32:return (-1,24)
    elif kind=='failed_move_reversal':
        if r24>3 and r6<-.8 and p<s24 and e24<.25:return (-1,12)
        if r24<-3 and r6>.8 and p>s24 and e24<.25:return (1,12)
    return None

KINDS=['adaptive_breakout','panic_recovery','volatility_switch','trend_pullback','impulse_decay','semivol_transition','multi_horizon_alignment','failed_move_reversal']


def run_pair(kind,s,candles,idx,start,end,cost,delay):
    c=candles[s]; ix=idx[s]; out=[]; last_exit=-1
    for row in c:
        ts=int(row['ts'])
        if ts<start or ts>=end or ts<=last_exit:continue
        i=ix.get(ts)
        if i is None:continue
        sig=signal(kind,c,i)
        if not sig:continue
        side,hold=sig
        v=future_trade(c,ix,ts,side,hold,delay,cost)
        if v is not None:
            out.append(v); last_exit=ts+hold*HOUR
    return out

def choose(s,candles,idx,dev):
    ranked=[]
    for k in KINDS:
        xs=run_pair(k,s,candles,idx,*dev,NORMAL_BPS,0); m=metric(xs)
        if m['trades']<8: score=-999
        else:
            pf=min(4.0,m['pf'] or 0); conc=max(0,m['bestSharePct']-40)
            score=m['returnPct']+4*(pf-1)+.25*m['maxDDPct']-.15*conc
        ranked.append((score,k,m))
    ranked.sort(reverse=True,key=lambda x:x[0])
    return ranked[0][1],ranked

def portfolio(sel,candles,idx,period,cost,delay):
    pair={}; allx=[]
    for s,k in sel.items():
        xs=run_pair(k,s,candles,idx,*period,cost,delay); pair[s]=metric(xs); allx.extend([x/len(SYMS) for x in xs])
    return metric(allx),pair

def ok(m,mintr,pf):
    return m['trades']>=mintr and (m['pf'] or 0)>=pf and m['returnPct']>0 and m['maxDDPct']>-20 and m['bestSharePct']<50

def main():
    candles,idx,_=base.load(); ps=periods(candles)
    sel={}; detail={}
    for s in SYMS:
        k,r=choose(s,candles,idx,ps['development']); sel[s]=k; detail[s]={'selected':k,'ranking':[{'kind':x[1],'metrics':x[2]} for x in r]}
    result={'strategyId':'PAIR_ROUTER_V101','periods':ps,'selectedEngines':sel,'developmentSelection':detail,'productionChanged':False,'realTradingEnabled':False}
    dm,dp=portfolio(sel,candles,idx,ps['development'],NORMAL_BPS,0);result['development']=dm;result['developmentPairs']=dp
    vm,vp=portfolio(sel,candles,idx,ps['validation'],NORMAL_BPS,0);result['validation']=vm;result['validationPairs']=vp
    if not ok(vm,20,1.05): result.update(status='NO_ROBUST_IMPROVEMENT',reason='VALIDATION_FAIL',robust=False)
    else:
        cm,cp=portfolio(sel,candles,idx,ps['confirmation'],NORMAL_BPS,0); cs,_=portfolio(sel,candles,idx,ps['confirmation'],STRESS_BPS,1)
        result['confirmation']=cm;result['confirmationPairs']=cp;result['stressConfirmation']=cs
        if not (ok(cm,15,1.15) and (cs['pf'] or 0)>1 and cs['returnPct']>0):result.update(status='NO_ROBUST_IMPROVEMENT',reason='CONFIRMATION_FAIL',robust=False)
        else:
            hm,hp=portfolio(sel,candles,idx,ps['holdout'],NORMAL_BPS,0);hs,_=portfolio(sel,candles,idx,ps['holdout'],STRESS_BPS,1)
            result['holdout']=hm;result['holdoutPairs']=hp;result['stressHoldout']=hs
            robust=ok(hm,15,1.0) and (hs['pf'] or 0)>1 and hs['returnPct']>0
            result.update(status='ROBUST_PASS' if robust else 'NO_ROBUST_IMPROVEMENT',reason='PASS' if robust else 'HOLDOUT_FAIL',robust=robust)
    out=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state'));out.mkdir(parents=True,exist_ok=True)
    (out/'pair-router-v101.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps(result,indent=2))
if __name__=='__main__':main()
