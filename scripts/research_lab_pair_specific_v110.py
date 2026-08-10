from __future__ import annotations
import argparse,json,math,os,statistics
from pathlib import Path
import research_lab_pair_specific_v101 as b

SYMS=b.SYMS; HOUR=b.HOUR; NORMAL_BPS=b.NORMAL_BPS; STRESS_BPS=b.STRESS_BPS
metric=b.metric; ret=b.ret
# Frozen pair-specific lifecycle/risk settings chosen from prior Development/Validation diagnostics only.
P={
'BTC':dict(risk=.82,comp=.82,expand=1.10,fast=.42,mid=.50,slow=.25,pull=.80,trail=4.2,maxh=192),
'ETH':dict(risk=.76,comp=.88,expand=1.06,fast=.34,mid=.42,slow=.18,pull=1.05,trail=5.4,maxh=168),
'BNB':dict(risk=.70,comp=.78,expand=1.16,fast=.40,mid=.46,slow=.20,pull=.75,trail=4.8,maxh=168),
'SOL':dict(risk=.64,comp=.92,expand=1.05,fast=.30,mid=.38,slow=.14,pull=1.25,trail=6.8,maxh=144),
'LINK':dict(risk=.64,comp=.90,expand=1.08,fast=.30,mid=.40,slow=.16,pull=1.10,trail=6.2,maxh=144),
'AVAX':dict(risk=.60,comp=.94,expand=1.04,fast=.28,mid=.36,slow=.12,pull=1.35,trail=7.2,maxh=132)}

def zmove(c,i,n):
    v=b.vol(c,i,168)
    r=ret(c,i,n)
    return (r or 0)/(v*math.sqrt(n)+1e-9) if v>1e-9 else 0

def phase(kind,s,candles,idx,ts):
    c=candles[s];i=idx[s].get(ts);q=P[s]
    if i is None or i<900:return 0,{}
    v24=b.vol(c,i,24);v96=b.vol(c,i,96);v336=b.vol(c,i,336)
    if min(v96,v336)<=1e-9:return 0,{}
    f=zmove(c,i,6);m=zmove(c,i,24);sl=zmove(c,i,96);eff=b.efficiency(c,i,72)
    rp=b.range_position(c,i,72);bread=b.breadth(candles,idx,ts,24)-.5
    rel=((ret(c,i,24) or 0)-b.median_move(candles,idx,ts,24))/(v96*math.sqrt(24)+1e-9)
    volr=v24/v96
    # BTC leadership and ETH beta transitions are intentionally treated differently.
    leader = f if s=='BTC' else rel if s=='ETH' else .6*rel+.4*bread
    d=0
    if kind=='phase_breakout':
        compressed=(v96/v336)<q['comp']
        up=volr>=q['expand'] and f>=q['fast'] and m>=q['mid'] and sl>=q['slow'] and rp>.58 and eff>.22
        dn=volr>=q['expand'] and f<=-q['fast'] and m<=-q['mid'] and sl<=-q['slow'] and rp<.42 and eff>.22
        # transition can fire immediately after compression has ended; do not require current compression.
        prevcomp=(b.vol(c,max(i-12,0),96)/max(b.vol(c,max(i-12,0),336),1e-9))<q['comp']
        if (compressed or prevcomp) and up:d=1
        elif (compressed or prevcomp) and dn:d=-1
    elif kind=='leadership_pullback':
        trend=1 if m>q['mid'] and sl>q['slow'] else -1 if m<-q['mid'] and sl<-q['slow'] else 0
        reclaim=(zmove(c,i,3)>0 and rp>.45) if trend>0 else (zmove(c,i,3)<0 and rp<.55)
        pb=abs(f)<=q['pull'] and eff>.18
        leadok=(leader>.05 if trend>0 else leader<-.05)
        if trend and pb and reclaim and leadok:d=trend
    else: # reversal_reclaim: failed extension + fast reclaim against exhausted prior wave
        extup=sl>.55 and rp<.58 and f<-.22
        extdn=sl<-.55 and rp>.42 and f>.22
        if extup and m<.12 and leader<.20:d=-1
        elif extdn and m>-.12 and leader>-.20:d=1
    return d,dict(f=f,m=m,sl=sl,eff=eff,rp=rp,volr=volr,leader=leader)

def pair_trades(kind,s,candles,idx,start,end,cost,delay):
    c=candles[s];q=P[s];state=0;entry=peak=trough=None;ets=None;vals=[];recs=[]
    cooldown=0
    for row in c:
        ts=int(row['ts'])
        if not(start<=ts<end):continue
        i=idx[s].get(ts)
        if i is None or i<900:continue
        d,x=phase(kind,s,candles,idx,ts);px=float(c[i]['close'])
        if state:
            peak=max(peak,px);trough=min(trough,px);held=(ts-ets)//HOUR
            give=(px/peak-1)*100 if state>0 else (trough/px-1)*100
            m=x.get('m',0);f=x.get('f',0)
            broken=(state>0 and m<-.10 and f<-.18) or (state<0 and m>.10 and f>.18)
            if give<=-q['trail'] or broken or held>=q['maxh']:
                xi=min(i+1+delay,len(c)-1);xp=float(c[xi]['open']);pnl=(state*(xp/entry-1)*100-cost/100)*q['risk'];vals.append(pnl);recs.append({'entryTs':ets,'exitTs':ts,'side':state,'pnl':pnl});state=0;cooldown=6
        if cooldown>0:cooldown-=1
        if state==0 and cooldown==0 and d:
            ei=i+1+delay
            if ei<len(c):state=d;entry=float(c[ei]['open']);peak=entry;trough=entry;ets=ts
    if state and ets is not None:
        i=max((idx[s].get(int(r['ts'])) for r in c if start<=int(r['ts'])<end),default=None)
        if i is not None:
            xp=float(c[i]['close']);pnl=(state*(xp/entry-1)*100-cost/100)*q['risk'];vals.append(pnl);recs.append({'entryTs':ets,'exitTs':int(c[i]['ts']),'side':state,'pnl':pnl})
    return vals,recs

def portfolio(kind,candles,idx,start,end,cost,delay):
    vals=[];pair={};contrib={}
    for s in SYMS:
        x,_=pair_trades(kind,s,candles,idx,start,end,cost,delay);pair[s]=metric(x);contrib[s]=sum(x);vals+=x
    return metric(vals),pair,contrib

def wave_diag(kind,s,candles,idx,start,end):
    _,recs=pair_trades(kind,s,candles,idx,start,end,NORMAL_BPS,0);c=candles[s];waves=[];last=-1
    for row in c:
        ts=int(row['ts']);i=idx[s].get(ts)
        if not(start<=ts<end) or ts<=last or i is None or i<336 or i+48>=len(c):continue
        v=b.vol(c,i,168);mv=100*(float(c[i+48]['close'])/float(c[i]['close'])-1);th=max(3,2*v*math.sqrt(48))
        if abs(mv)<th:continue
        side=1 if mv>0 else -1;hit=next((r for r in recs if ts<=r['entryTs']<=ts+18*HOUR and r['side']==side),None);waves.append(None if hit is None else (hit['entryTs']-ts)/HOUR);last=ts+48*HOUR
    d=[x for x in waves if x is not None];return {'majorWaves':len(waves),'captured':len(d),'captureRatePct':100*len(d)/len(waves) if waves else 0,'medianEntryDelayHours':statistics.median(d) if d else None,'missedWaves':len(waves)-len(d)}

def run(kind):
    candles,idx,_=b.base.load();ps=b.base.periods(candles)
    dm,dp,dc=portfolio(kind,candles,idx,*ps['development'],NORMAL_BPS,0);vm,vp,vc=portfolio(kind,candles,idx,*ps['validation'],NORMAL_BPS,0);vs,_,_=portfolio(kind,candles,idx,*ps['validation'],STRESS_BPS,1)
    res={'strategyId':f'PAIR_SPECIFIC_V110_{kind.upper()}','periods':ps,'development':dm,'developmentPair':dp,'developmentContribution':dc,'validation':vm,'validationPair':vp,'validationContribution':vc,'validationStress':vs,'moveCaptureDiagnostics':{'development':{s:wave_diag(kind,s,candles,idx,*ps['development']) for s in ('BTC','ETH')},'validation':{s:wave_diag(kind,s,candles,idx,*ps['validation']) for s in ('BTC','ETH')}},'productionChanged':False,'realTradingEnabled':False}
    if (dm.get('pf') or 0)<1.05 or dm.get('returnPct',0)<=0 or (vm.get('pf') or 0)<1.05 or vm.get('returnPct',0)<=0:res.update(status='FAIL',reason='FAST_FUNNEL')
    else:
        cm,cp,cc=portfolio(kind,candles,idx,*ps['confirmation'],NORMAL_BPS,0);cs,_,_=portfolio(kind,candles,idx,*ps['confirmation'],STRESS_BPS,1);res.update(confirmation=cm,confirmationPair=cp,confirmationContribution=cc,confirmationStress=cs)
        if not b.gate(cm,cs):res.update(status='FAIL',reason='CONFIRMATION')
        else:
            hm,hp,hc=portfolio(kind,candles,idx,*ps['holdout'],NORMAL_BPS,0);hs,_,_=portfolio(kind,candles,idx,*ps['holdout'],STRESS_BPS,1);ym,yp,yc=portfolio(kind,candles,idx,ps['development'][0],ps['holdout'][1],NORMAL_BPS,0);ys,_,_=portfolio(kind,candles,idx,ps['development'][0],ps['holdout'][1],STRESS_BPS,1);pos=sum((yp[s].get('returnPct') or 0)>0 for s in SYMS);sh=[abs(x) for x in yc.values()];conc=max(sh)/sum(sh) if sum(sh)>1e-9 else 1;ok=b.gate(ym,ys) and (hm.get('pf') or 0)>1 and hm.get('returnPct',0)>0 and (hs.get('pf') or 0)>1 and ym.get('returnPct',0)>=60 and pos>=4 and conc<.45;res.update(holdout=hm,holdoutPair=hp,holdoutContribution=hc,holdoutStress=hs,year=ym,yearPair=yp,yearContribution=yc,yearStress=ys,pairConcentration=conc,status='PASS' if ok else 'FAIL',reason='PASS' if ok else 'FINAL_TARGET')
    out=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state'));out.mkdir(parents=True,exist_ok=True);stem=f'pair-specific-v110-{kind}';txt=json.dumps(res,indent=2);(out/f'{stem}.json').write_text(txt);(out/f'{stem}.md').write_text(f'# {res["strategyId"]}\n\n```json\n{txt}\n```\n');print(txt)
if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--kind',choices=['phase_breakout','leadership_pullback','reversal_reclaim'],required=True);run(ap.parse_args().kind)
