from __future__ import annotations
import argparse,json,os,math
from pathlib import Path
import research_lab_pair_specific_v101 as b

SYMS=b.SYMS; HOUR=b.HOUR; NORMAL_BPS=b.NORMAL_BPS; STRESS_BPS=b.STRESS_BPS
metric=b.metric

# Predeclared once, no parameter selection. Pair-specific lifecycle timing/risk only.
CFG={
'BTC':dict(fast=6,mid=24,slow=96,hold=168,risk=.76,breakz=.62,pull=.38,trail=4.2),
'ETH':dict(fast=4,mid=18,slow=72,hold=144,risk=.72,breakz=.58,pull=.42,trail=5.0),
'BNB':dict(fast=6,mid=24,slow=96,hold=120,risk=.62,breakz=.66,pull=.35,trail=4.6),
'SOL':dict(fast=3,mid=12,slow=60,hold=96,risk=.64,breakz=.55,pull=.44,trail=6.2),
'LINK':dict(fast=4,mid=18,slow=72,hold=120,risk=.60,breakz=.60,pull=.40,trail=5.6),
'AVAX':dict(fast=3,mid=12,slow=60,hold=96,risk=.58,breakz=.58,pull=.46,trail=6.4),
}

def zret(c,i,n,v):
    r=b.ret(c,i,n)
    return (r or 0)/(v*math.sqrt(n)+1e-9)

def state_features(s,candles,idx,ts):
    c=candles[s]; i=idx[s].get(ts); q=CFG[s]
    if i is None or i<900:return None
    v168=b.vol(c,i,168); v24=b.vol(c,i,24); v96=b.vol(c,i,96)
    if min(v168,v96)<=1e-9:return None
    fast=zret(c,i,q['fast'],v168); mid=zret(c,i,q['mid'],v168); slow=zret(c,i,q['slow'],v168)
    eff=b.efficiency(c,i,q['slow']); rp=b.range_position(c,i,q['slow']); br=b.breadth(candles,idx,ts,24)
    vr=v24/v96
    return i,fast,mid,slow,eff,rp,br,vr

def decision(kind,s,candles,idx,ts,pos):
    x=state_features(s,candles,idx,ts)
    if x is None:return 0
    _,fast,mid,slow,eff,rp,br,vr=x; q=CFG[s]
    # Full lifecycle engines: initiation + continuation/pullback + failed-wave reversal.
    init_long = mid>q['breakz'] and slow>.18 and eff>.22 and rp>.70 and br>=.50 and vr<2.6
    init_short= mid<-q['breakz'] and slow<-.18 and eff>.22 and rp<.30 and br<=.50 and vr<2.6
    cont_long = slow>.34 and mid>.08 and fast>-q['pull'] and eff>.20 and br>=.42
    cont_short= slow<-.34 and mid<-.08 and fast<q['pull'] and eff>.20 and br<=.58
    rev_long  = slow<-.28 and fast>q['pull'] and mid>-0.10 and eff<.32 and rp<.38
    rev_short = slow>.28 and fast<-q['pull'] and mid<0.10 and eff<.32 and rp>.62
    if kind=='early_phase':
        L=init_long or (cont_long and fast>-.18) or rev_long
        S=init_short or (cont_short and fast<.18) or rev_short
    elif kind=='persistence_phase':
        L=(init_long and slow>.30) or cont_long or (rev_long and br>.50)
        S=(init_short and slow<-.30) or cont_short or (rev_short and br<.50)
    else: # adaptive_phase: require phase agreement, but reversal may flip immediately
        L=(init_long and vr>0.75) or (cont_long and rp>.52) or rev_long
        S=(init_short and vr>0.75) or (cont_short and rp<.48) or rev_short
    if L and not S:return 1
    if S and not L:return -1
    return 0

def pair_trades(kind,s,candles,idx,start,end,cost,delay):
    c=candles[s]; q=CFG[s]; pos=0; entry=peak=trough=None; ets=None; vals=[]; recs=[]
    for row in c:
        ts=int(row['ts'])
        if not(start<=ts<end):continue
        i=idx[s].get(ts)
        if i is None or i<900:continue
        sig=decision(kind,s,candles,idx,ts,pos); px=float(c[i]['close'])
        if pos:
            peak=max(peak,px); trough=min(trough,px); held=(ts-ets)//HOUR
            adverse=(px/peak-1)*100 if pos>0 else (trough/px-1)*100
            opposite=(sig==-pos)
            fade=(sig==0 and held>=q['mid'])
            if opposite or fade or adverse<=-q['trail'] or held>=q['hold']:
                xi=min(i+1+delay,len(c)-1); xp=float(c[xi]['open'])
                pnl=(pos*((xp/entry)-1)*100-cost/100)*q['risk']; vals.append(pnl); recs.append((ets,ts,pos,pnl)); pos=0
        if pos==0 and sig:
            ei=i+1+delay
            if ei<len(c):
                pos=sig; entry=float(c[ei]['open']); peak=trough=entry; ets=ts
    return vals,recs

def portfolio(kind,candles,idx,start,end,cost,delay):
    vals=[]; pair={}; contrib={}
    for s in SYMS:
        x,_=pair_trades(kind,s,candles,idx,start,end,cost,delay); pair[s]=metric(x); contrib[s]=sum(x); vals.extend(x)
    return metric(vals),pair,contrib

def diag(kind,s,candles,idx,start,end):
    _,recs=pair_trades(kind,s,candles,idx,start,end,NORMAL_BPS,0); c=candles[s]; waves=[]; last=-1
    for row in c:
        ts=int(row['ts']); i=idx[s].get(ts)
        if not(start<=ts<end) or ts<=last or i is None or i<336 or i+48>=len(c):continue
        v=b.vol(c,i,168); mv=100*(float(c[i+48]['close'])/float(c[i]['close'])-1); th=max(3,2*v*math.sqrt(48))
        if abs(mv)<th:continue
        side=1 if mv>0 else -1; hit=next((r for r in recs if ts<=r[0]<=ts+18*HOUR and r[2]==side),None)
        waves.append(None if hit is None else (hit[0]-ts)/HOUR); last=ts+48*HOUR
    d=[x for x in waves if x is not None]
    return {'majorWaves':len(waves),'captured':len(d),'captureRatePct':100*len(d)/len(waves) if waves else 0,'missedWaves':len(waves)-len(d),'medianEntryDelayHours':sorted(d)[len(d)//2] if d else None}

def run(kind):
    candles,idx,_=b.base.load(); ps=b.base.periods(candles)
    dm,dp,dc=portfolio(kind,candles,idx,*ps['development'],NORMAL_BPS,0)
    vm,vp,vc=portfolio(kind,candles,idx,*ps['validation'],NORMAL_BPS,0)
    vs,_,_=portfolio(kind,candles,idx,*ps['validation'],STRESS_BPS,1)
    r={'strategyId':f'PAIR_SPECIFIC_V115_{kind.upper()}','periods':ps,'predeclaredPairConfig':CFG,'development':dm,'developmentPair':dp,'developmentContribution':dc,'validation':vm,'validationPair':vp,'validationContribution':vc,'validationStress':vs,'moveCaptureDiagnostics':{'development':{s:diag(kind,s,candles,idx,*ps['development']) for s in ('BTC','ETH')},'validation':{s:diag(kind,s,candles,idx,*ps['validation']) for s in ('BTC','ETH')}},'productionChanged':False,'realTradingEnabled':False}
    if (dm.get('pf') or 0)<1.05 or dm.get('returnPct',0)<=0 or (vm.get('pf') or 0)<1.05 or vm.get('returnPct',0)<=0:
        r.update(status='FAIL',reason='FAST_FUNNEL')
    else:
        cm,cp,cc=portfolio(kind,candles,idx,*ps['confirmation'],NORMAL_BPS,0); cs,_,_=portfolio(kind,candles,idx,*ps['confirmation'],STRESS_BPS,1)
        r.update(confirmation=cm,confirmationPair=cp,confirmationContribution=cc,confirmationStress=cs)
        if not b.gate(cm,cs):r.update(status='FAIL',reason='CONFIRMATION')
        else:
            hm,hp,hc=portfolio(kind,candles,idx,*ps['holdout'],NORMAL_BPS,0); hs,_,_=portfolio(kind,candles,idx,*ps['holdout'],STRESS_BPS,1)
            ym,yp,yc=portfolio(kind,candles,idx,ps['development'][0],ps['holdout'][1],NORMAL_BPS,0); ys,_,_=portfolio(kind,candles,idx,ps['development'][0],ps['holdout'][1],STRESS_BPS,1)
            pos=sum((yp[s].get('returnPct') or 0)>0 for s in SYMS); sh=[abs(v) for v in yc.values()]; conc=max(sh)/sum(sh) if sum(sh)>1e-9 else 1
            ok=b.gate(ym,ys) and (hm.get('pf') or 0)>1 and hm.get('returnPct',0)>0 and (hs.get('pf') or 0)>1 and ym.get('returnPct',0)>=60 and pos>=4 and conc<.45
            r.update(holdout=hm,holdoutPair=hp,holdoutContribution=hc,holdoutStress=hs,year=ym,yearPair=yp,yearContribution=yc,yearStress=ys,pairConcentration=conc,status='PASS' if ok else 'FAIL',reason='PASS' if ok else 'FINAL_TARGET')
    out=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state'));out.mkdir(parents=True,exist_ok=True);stem=f'pair-specific-v115-{kind}';txt=json.dumps(r,indent=2);(out/f'{stem}.json').write_text(txt);(out/f'{stem}.md').write_text(f'# {r["strategyId"]}\n\n```json\n{txt}\n```\n');print(txt)

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--kind',choices=['early_phase','persistence_phase','adaptive_phase'],required=True);run(ap.parse_args().kind)
