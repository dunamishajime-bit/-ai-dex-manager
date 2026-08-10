from __future__ import annotations

import json, math, os, statistics
from pathlib import Path

import research_lab_parallel_event_regime_v53 as base

HOUR=base.HOUR; DAY=24*HOUR; YEAR=365*DAY
SYMS=["BTC","ETH","BNB","SOL","LINK","AVAX"]
NORMAL_BPS=10.0; STRESS_BPS=30.0
ret=base.ret; metric=base.metric; future_trade=base.future_trade


def periods(candles):
    end_jst_ms=int(__import__('datetime').datetime(2026,8,10,0,0,tzinfo=__import__('datetime').timezone(__import__('datetime').timedelta(hours=9))).timestamp()*1000)
    common_first=max(int(candles[s][0]['ts']) for s in SYMS)
    common_last=min(int(candles[s][-2]['ts']) for s in SYMS)
    end=min(end_jst_ms,common_last)
    start=max(common_first,end-YEAR)
    span=end-start
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

def signal(kind,c,i):
    if i<500:return None
    p=float(c[i]['close']); r6=ret(c,i,6); r24=ret(c,i,24); r72=ret(c,i,72)
    v24=vol(c,i,24); v168=vol(c,i,168); e48=efficiency(c,i,48); e168=efficiency(c,i,168)
    s48=sma(c,i,48); s168=sma(c,i,168)
    if None in (r6,r24,r72,v24,v168,e48,e168,s48,s168):return None
    # Complete component systems: regime + entry + explicit no-trade + distinct hold horizon.
    if kind=='trend_state':
        if p>s168 and r72>3 and e48>.30 and r6>0.5:return (1,24)
        if p<s168 and r72<-3 and e48>.30 and r6<-0.5:return (-1,24)
    elif kind=='shock_reversion':
        if v168>0 and v24>1.5*v168 and r6<-2.0 and e48<.28:return (1,12)
        if v168>0 and v24>1.5*v168 and r6>2.0 and e48<.28:return (-1,12)
    elif kind=='compression_release':
        if v168>0 and v24<.65*v168 and e168<.22 and r24>1.2 and p>s48:return (1,18)
        if v168>0 and v24<.65*v168 and e168<.22 and r24<-1.2 and p<s48:return (-1,18)
    elif kind=='path_transition':
        if e168<.20 and e48>.42 and abs(r24)>1.5:return (1 if r24>0 else -1,18)
    elif kind=='exhaustion_fade':
        if e168>.45 and e48<.18 and abs(r72)>4 and r6*r72<0:return (-1 if r72>0 else 1,12)
    return None

KINDS=['trend_state','shock_reversion','compression_release','path_transition','exhaustion_fade']

def run_pair(kind,s,candles,idx,start,end,cost,delay):
    c=candles[s]; ix=idx[s]; out=[]; last_exit=-1
    for row in c:
        ts=int(row['ts'])
        if ts<start or ts>=end or ts<=last_exit: continue
        i=ix.get(ts)
        if i is None:continue
        sig=signal(kind,c,i)
        if not sig:continue
        side,hold=sig
        v=future_trade(c,ix,ts,side,hold,delay,cost)
        if v is not None:
            out.append(v); last_exit=ts+hold*HOUR
    return out

def choose_pair_engine(s,candles,idx,dev):
    ranked=[]
    for k in KINDS:
        xs=run_pair(k,s,candles,idx,*dev,NORMAL_BPS,0); m=metric(xs)
        score=(m['returnPct'] if m['trades']>=8 else -999) + 3*((m['pf'] or 0)-1) + .2*m['maxDDPct']
        ranked.append((score,k,m))
    ranked.sort(reverse=True,key=lambda x:x[0])
    return ranked[0][1],ranked

def portfolio(selected,candles,idx,period,cost,delay):
    pair={}; all_trades=[]
    for s,k in selected.items():
        xs=run_pair(k,s,candles,idx,*period,cost,delay); pair[s]=metric(xs); all_trades.extend([x/len(SYMS) for x in xs])
    return metric(all_trades),pair

def ok(m,mintr=20,pf=1.0):
    return m['trades']>=mintr and (m['pf'] or 0)>=pf and m['returnPct']>0 and m['maxDDPct']>-20 and m['bestSharePct']<50

def main():
    candles,idx,_=base.load(); ps=periods(candles)
    selected={}; devdetail={}
    for s in SYMS:
        k,r=choose_pair_engine(s,candles,idx,ps['development']); selected[s]=k; devdetail[s]={'selected':k,'ranking':[{'kind':x[1],'metrics':x[2]} for x in r]}
    result={'strategyId':'PAIR_ROUTER_V100','periods':ps,'selectedEngines':selected,'developmentSelection':devdetail,'productionChanged':False,'realTradingEnabled':False}
    dm,dp=portfolio(selected,candles,idx,ps['development'],NORMAL_BPS,0); result['development']=dm;result['developmentPairs']=dp
    vm,vp=portfolio(selected,candles,idx,ps['validation'],NORMAL_BPS,0);result['validation']=vm;result['validationPairs']=vp
    if not ok(vm,20,1.05): result.update(status='NO_ROBUST_IMPROVEMENT',reason='VALIDATION_FAIL',robust=False)
    else:
        cm,cp=portfolio(selected,candles,idx,ps['confirmation'],NORMAL_BPS,0);cs,_=portfolio(selected,candles,idx,ps['confirmation'],STRESS_BPS,1)
        result['confirmation']=cm;result['confirmationPairs']=cp;result['stressConfirmation']=cs
        if not (ok(cm,15,1.15) and (cs['pf'] or 0)>1 and cs['returnPct']>0): result.update(status='NO_ROBUST_IMPROVEMENT',reason='CONFIRMATION_FAIL',robust=False)
        else:
            hm,hp=portfolio(selected,candles,idx,ps['holdout'],NORMAL_BPS,0);hs,_=portfolio(selected,candles,idx,ps['holdout'],STRESS_BPS,1)
            result['holdout']=hm;result['holdoutPairs']=hp;result['stressHoldout']=hs
            robust=ok(hm,15,1.0) and (hs['pf'] or 0)>1 and hs['returnPct']>0
            result.update(status='ROBUST_PASS' if robust else 'NO_ROBUST_IMPROVEMENT',reason='PASS' if robust else 'HOLDOUT_FAIL',robust=robust)
    out=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state'));out.mkdir(parents=True,exist_ok=True)
    (out/'pair-router-v100.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps(result,indent=2))
if __name__=='__main__':main()
