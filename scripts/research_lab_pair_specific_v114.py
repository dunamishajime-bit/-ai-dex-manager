from __future__ import annotations
import argparse,json,math,os
from pathlib import Path
import research_lab_pair_specific_v109 as v109

b=v109.b; SYMS=v109.SYMS; HOUR=v109.HOUR; NORMAL_BPS=v109.NORMAL_BPS; STRESS_BPS=v109.STRESS_BPS
STRONG={'LINK','SOL'}
RISK={'BTC':.72,'ETH':.72,'BNB':.60,'AVAX':.58}
TRAIL={'BTC':5.5,'ETH':6.0,'BNB':6.0,'AVAX':7.0}

def ret(c,i,n): return v109.ret(c,i,n)
def slope(c,i,n): return v109.slope(c,i,n)
def rp(c,i,n): return b.range_position(c,i,n)
def eff(c,i,n): return b.efficiency(c,i,n)

def weak_signal(kind,s,candles,idx,ts):
    c=candles[s]; i=idx[s].get(ts)
    if i is None or i<900:return 0
    v168=b.vol(c,i,168); v24=b.vol(c,i,24)
    if v168<=1e-9 or v24>3.0*v168:return 0
    r6=ret(c,i,6) or 0; r24=ret(c,i,24) or 0; r72=ret(c,i,72) or 0
    s12=slope(c,i,12); s48=slope(c,i,48); s168=slope(c,i,168)
    p48=rp(c,i,48); p168=rp(c,i,168); e72=eff(c,i,72); br=b.breadth(candles,idx,ts,24)
    z=lambda x,n:x/(v168*math.sqrt(n)+1e-9)
    if kind=='change_point':
        accel=z(r24,24)-z(r72,72)
        if s168>0 and s48>0 and accel>.42 and r6>0 and p168>.55 and br>=.50:return 1
        if s168<0 and s48<0 and accel<-.42 and r6<0 and p168<.45 and br<=.50:return -1
    elif kind=='asymmetric_trend':
        if s168>.015 and s48>.025 and z(r24,24)>.35 and p168>.62 and e72>.22 and br>=.50:return 1
        if s168<-.010 and s48<-.030 and z(r24,24)<-.50 and p168<.38 and e72>.18 and br<=.50:return -1
    else: # persistence_recovery: continuation after a causal shallow reset, not threshold optimized
        r12=ret(c,i,12) or 0; prior=ret(c,i-12,48) if i>=60 else 0
        prior=prior or 0
        if s168>.012 and prior>0 and r12>0 and r6>0 and .40<p48<.85 and p168>.55 and br>=.50:return 1
        if s168<-.012 and prior<0 and r12<0 and r6<0 and .15<p48<.60 and p168<.45 and br<=.50:return -1
    return 0

def weak_trades(kind,s,candles,idx,start,end,cost,delay):
    c=candles[s]; state=0; entry=peak=trough=None; ets=None; vals=[]
    for row in c:
        ts=int(row['ts'])
        if not(start<=ts<end):continue
        i=idx[s].get(ts)
        if i is None or i<900:continue
        px=float(c[i]['close']); sig=weak_signal(kind,s,candles,idx,ts)
        if state:
            peak=max(peak,px);trough=min(trough,px);held=(ts-ets)//HOUR
            adverse=(px/peak-1)*100 if state>0 else (trough/px-1)*100
            exitnow=(sig==-state) or adverse<=-TRAIL[s] or held>=168
            if exitnow:
                xi=min(i+1+delay,len(c)-1);xp=float(c[xi]['open']);vals.append((state*((xp/entry-1)*100)-cost/100)*RISK[s]);state=0
        if state==0 and sig:
            ei=i+1+delay
            if ei<len(c):state=sig;entry=float(c[ei]['open']);peak=entry;trough=entry;ets=ts
    if state and ets is not None:
        rows=[r for r in c if start<=int(r['ts'])<end]
        if rows:
            i=idx[s][int(rows[-1]['ts'])];xp=float(c[i]['close']);vals.append((state*((xp/entry-1)*100)-cost/100)*RISK[s])
    return vals

def eval_pair(kind,s,strong_models,candles,idx,start,end,cost,delay):
    if s in STRONG:return v109.pair_trades('regime_wave',s,candles,idx,start,end,cost,delay,strong_models[s])[0]
    return weak_trades(kind,s,candles,idx,start,end,cost,delay)

def portfolio(kind,strong_models,candles,idx,start,end,cost,delay):
    vals=[];pair={};contrib={}
    for s in SYMS:
        x=eval_pair(kind,s,strong_models,candles,idx,start,end,cost,delay);pair[s]=v109.metric(x);contrib[s]=sum(x);vals.extend(x)
    return v109.metric(vals),pair,contrib

def gate(m,stress):return (m.get('pf') or 0)>=1.20 and m.get('returnPct',0)>0 and m.get('maxDDPct',-999)>-20 and (stress.get('pf') or 0)>1.0

def run(kind):
    candles,idx,_=b.base.load();ps=b.base.periods(candles)
    # LINK/SOL exact V109 REGIME_WAVE architecture, fitted/calibrated only inside Development and frozen thereafter.
    strong={s:v109.train('regime_wave',s,candles,idx,*ps['development']) for s in STRONG}
    dm,dp,dc=portfolio(kind,strong,candles,idx,*ps['development'],NORMAL_BPS,0)
    vm,vp,vc=portfolio(kind,strong,candles,idx,*ps['validation'],NORMAL_BPS,0);vs,_,_=portfolio(kind,strong,candles,idx,*ps['validation'],STRESS_BPS,1)
    res={'strategyId':f'PAIR_SPECIFIC_V114_{kind.upper()}','periods':ps,'frozenStrong':['LINK','SOL'],'development':dm,'developmentPair':dp,'developmentContribution':dc,'validation':vm,'validationPair':vp,'validationContribution':vc,'validationStress':vs,'productionChanged':False,'realTradingEnabled':False}
    if (dm.get('pf') or 0)<1.05 or dm.get('returnPct',0)<=0 or (vm.get('pf') or 0)<1.05 or vm.get('returnPct',0)<=0:res.update(status='FAIL',reason='FAST_FUNNEL')
    else:
        cm,cp,cc=portfolio(kind,strong,candles,idx,*ps['confirmation'],NORMAL_BPS,0);cs,_,_=portfolio(kind,strong,candles,idx,*ps['confirmation'],STRESS_BPS,1);res.update(confirmation=cm,confirmationPair=cp,confirmationContribution=cc,confirmationStress=cs)
        if not gate(cm,cs):res.update(status='FAIL',reason='CONFIRMATION')
        else:
            hm,hp,hc=portfolio(kind,strong,candles,idx,*ps['holdout'],NORMAL_BPS,0);hs,_,_=portfolio(kind,strong,candles,idx,*ps['holdout'],STRESS_BPS,1);ym,yp,yc=portfolio(kind,strong,candles,idx,ps['development'][0],ps['holdout'][1],NORMAL_BPS,0);ys,_,_=portfolio(kind,strong,candles,idx,ps['development'][0],ps['holdout'][1],STRESS_BPS,1)
            pos=sum((yp[s].get('returnPct') or 0)>0 for s in SYMS);shares=[abs(x) for x in yc.values()];conc=max(shares)/sum(shares) if sum(shares)>1e-9 else 1
            ok=gate(ym,ys) and (hm.get('pf') or 0)>1 and hm.get('returnPct',0)>0 and (hs.get('pf') or 0)>1 and ym.get('returnPct',0)>=60 and pos>=4 and conc<.45
            res.update(holdout=hm,holdoutPair=hp,holdoutContribution=hc,holdoutStress=hs,year=ym,yearPair=yp,yearContribution=yc,yearStress=ys,pairConcentration=conc,status='PASS' if ok else 'FAIL',reason='PASS' if ok else 'FINAL_TARGET')
    out=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state'));out.mkdir(parents=True,exist_ok=True);stem=f'pair-specific-v114-{kind}';txt=json.dumps(res,indent=2);(out/f'{stem}.json').write_text(txt);(out/f'{stem}.md').write_text(f'# {res["strategyId"]}\n\n```json\n{txt}\n```\n');print(txt)

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--kind',choices=['change_point','asymmetric_trend','persistence_recovery'],required=True);run(ap.parse_args().kind)
