from __future__ import annotations
import argparse,json,math,os,statistics
from pathlib import Path
import research_lab_pair_specific_v101 as b

SYMS=b.SYMS; HOUR=b.HOUR; NORMAL_BPS=b.NORMAL_BPS; STRESS_BPS=b.STRESS_BPS
ret=b.ret; metric=b.metric

PAIR={
 'BTC':{'cusum':3.2,'drift':.62,'trail':4.2,'risk':.78},
 'ETH':{'cusum':3.0,'drift':.58,'trail':5.2,'risk':.74},
 'BNB':{'cusum':3.1,'drift':.60,'trail':4.6,'risk':.72},
 'SOL':{'cusum':3.4,'drift':.66,'trail':6.5,'risk':.68},
 'LINK':{'cusum':3.2,'drift':.63,'trail':6.0,'risk':.68},
 'AVAX':{'cusum':3.5,'drift':.68,'trail':7.0,'risk':.64},
}

def rs(c,i,n): return b.rseries(c,i,n)
def sd(x): return statistics.pstdev(x) if len(x)>1 else 0.0

def slope(c,i,n):
    if i<n:return 0.0
    y=[math.log(float(c[j]['close'])) for j in range(i-n+1,i+1)]
    m=(n-1)/2; ym=statistics.fmean(y); den=sum((k-m)**2 for k in range(n))
    return 100*sum((k-m)*(v-ym) for k,v in enumerate(y))/den if den>0 else 0.0

def innovations(s,candles,idx,ts,n=240):
    i=idx[s].get(ts); bi=idx['BTC'].get(ts); ei=idx['ETH'].get(ts)
    if i is None or i<n:return []
    sr=rs(candles[s],i,n)
    if s=='BTC': return sr
    if bi is None or bi<n:return []
    br=rs(candles['BTC'],bi,n)
    if s=='ETH':
        vb=sum(x*x for x in br); beta=sum(x*y for x,y in zip(br,sr))/vb if vb>1e-12 else 1
        return [y-beta*x for x,y in zip(br,sr)]
    if ei is None or ei<n:return []
    er=rs(candles['ETH'],ei,n)
    return [x-.55*y-.45*z for x,y,z in zip(sr,br,er)]

def direction(style,s,candles,idx,ts):
    c=candles[s]; i=idx[s].get(ts)
    if i is None or i<900:return 0,0.0
    inv=innovations(s,candles,idx,ts,240)
    if len(inv)<220:return 0,0.0
    hist=inv[:-24]; sig=sd(hist)
    if sig<=1e-9:return 0,0.0
    v24=b.vol(c,i,24); v336=b.vol(c,i,336)
    if v336<=1e-9 or v24>3.4*v336:return 0,0.0
    r6=ret(c,i,6) or 0; r24=ret(c,i,24) or 0; sl72=slope(c,i,72)
    p=PAIR[s]
    if style=='cusum_state':
        z=[x/sig for x in inv[-18:]]; k=.18
        up=sum(max(0,x-k) for x in z); dn=sum(max(0,-x-k) for x in z)
        score=up-dn
        if score>p['cusum'] and r6>0 and sl72>-0.015:return 1,score
        if score<-p['cusum'] and r6<0 and sl72<0.015:return -1,score
        return 0,score
    if style=='drift_hysteresis':
        fast=statistics.fmean(inv[-8:]); mid=statistics.fmean(inv[-32:]); slow=statistics.fmean(inv[-120:])
        score=(fast-.35*mid-.15*slow)/(sig/math.sqrt(8)+1e-9)
        if score>p['drift'] and r6>0 and r24>-2.5:return 1,score
        if score<-p['drift'] and r6<0 and r24<2.5:return -1,score
        return 0,score
    # adaptive_trailing initiation: change in drift plus path efficiency, state itself is held by simulator
    old=statistics.fmean(inv[-32:-16]); new=statistics.fmean(inv[-16:]); score=(new-old)/(sig/math.sqrt(16)+1e-9)
    eff=b.efficiency(c,i,36)
    if score>p['drift']*.82 and r6>0 and eff>.20:return 1,score
    if score<-p['drift']*.82 and r6<0 and eff>.20:return -1,score
    return 0,score

def pair_trades(style,s,candles,idx,start,end,costbps,delay):
    c=candles[s]; p=PAIR[s]; state=0; entry=None; peak=None; trough=None; entry_ts=None; out=[]; records=[]
    times=[int(x['ts']) for x in c if start<=int(x['ts'])<end]
    for ts in times:
        i=idx[s].get(ts)
        if i is None or i<900:continue
        d,score=direction(style,s,candles,idx,ts)
        px=float(c[i]['close'])
        if state:
            peak=max(peak,px); trough=min(trough,px)
            adverse=(px/peak-1)*100 if state>0 else (trough/px-1)*100
            held=(ts-entry_ts)//HOUR
            sl24=slope(c,i,24); sl96=slope(c,i,96)
            structural_break=(state>0 and sl24<0 and sl96<0) or (state<0 and sl24>0 and sl96>0)
            opposite=d==-state and abs(score)>.35*PAIR[s]['drift']
            trail=adverse<=-p['trail']
            maxhold=held>=240
            if opposite or trail or structural_break or maxhold:
                xi=min(i+1+delay,len(c)-1); exitpx=float(c[xi]['open'])
                pnl=state*((exitpx/entry-1)*100)-costbps/100
                val=pnl*p['risk']; out.append((ts,val)); records.append({'entryTs':entry_ts,'exitTs':ts,'side':state,'pnl':val})
                state=0; entry=None; peak=None; trough=None; entry_ts=None
        if state==0 and d:
            ei=i+1+delay
            if ei>=len(c):continue
            state=d; entry=float(c[ei]['open']); peak=entry; trough=entry; entry_ts=ts
    if state and entry is not None:
        i=idx[s].get(times[-1]); exitpx=float(c[i]['close']); pnl=state*((exitpx/entry-1)*100)-costbps/100
        val=pnl*p['risk']; out.append((times[-1],val)); records.append({'entryTs':entry_ts,'exitTs':times[-1],'side':state,'pnl':val})
    return out,records

def portfolio(style,candles,idx,start,end,cost,delay):
    allx=[]; pair={}; contrib={}
    for s in SYMS:
        ev,_=pair_trades(style,s,candles,idx,start,end,cost,delay); vals=[v for _,v in ev]; pair[s]=metric(vals); contrib[s]=sum(vals); allx.extend((ts,s,v) for ts,v in ev)
    allx.sort(); vals=[]
    by={}
    for ts,s,v in allx:by.setdefault(ts,[]).append((s,v))
    for ts in sorted(by):
        xs=sorted(by[ts],key=lambda q:abs(q[1]),reverse=True)[:3]; scale=min(1.0,1.65/len(xs)); vals.append(sum(v*scale for _,v in xs))
    return metric(vals),pair,contrib

def wave_diag(style,s,candles,idx,start,end):
    _,recs=pair_trades(style,s,candles,idx,start,end,NORMAL_BPS,0); c=candles[s]; waves=[]; last=-1
    for row in c:
        ts=int(row['ts']); i=idx[s].get(ts)
        if not(start<=ts<end) or ts<=last or i is None or i<336 or i+48>=len(c):continue
        v=b.vol(c,i,168); p0=float(c[i]['close']); p1=float(c[i+48]['close']); mv=100*(p1/p0-1); th=max(3.0,2*v*math.sqrt(48))
        if abs(mv)<th:continue
        side=1 if mv>0 else -1; hit=next((r for r in recs if ts<=r['entryTs']<=ts+18*HOUR and r['side']==side),None)
        waves.append(None if hit is None else (hit['entryTs']-ts)/HOUR); last=ts+48*HOUR
    delays=[x for x in waves if x is not None]
    return {'majorWaves':len(waves),'captured':len(delays),'captureRatePct':100*len(delays)/len(waves) if waves else 0,'medianEntryDelayHours':statistics.median(delays) if delays else None,'missedWaves':len(waves)-len(delays)}

def run(style):
    candles,idx,_=b.base.load(); ps=b.base.periods(candles)
    dm,dp,dc=portfolio(style,candles,idx,*ps['development'],NORMAL_BPS,0); vm,vp,vc=portfolio(style,candles,idx,*ps['validation'],NORMAL_BPS,0); vs,_,_=portfolio(style,candles,idx,*ps['validation'],STRESS_BPS,1)
    res={'strategyId':f'PAIR_SPECIFIC_V108_{style.upper()}','periods':ps,'development':dm,'developmentPair':dp,'developmentContribution':dc,'validation':vm,'validationPair':vp,'validationContribution':vc,'validationStress':vs,'moveCaptureDiagnostics':{'development':{s:wave_diag(style,s,candles,idx,*ps['development']) for s in ('BTC','ETH')},'validation':{s:wave_diag(style,s,candles,idx,*ps['validation']) for s in ('BTC','ETH')}},'productionChanged':False,'realTradingEnabled':False}
    if (dm.get('pf') or 0)<1.05 or dm.get('returnPct',0)<=0 or (vm.get('pf') or 0)<1.05 or vm.get('returnPct',0)<=0:res.update(status='FAIL',reason='FAST_FUNNEL')
    else:
        cm,cp,cc=portfolio(style,candles,idx,*ps['confirmation'],NORMAL_BPS,0); cs,_,_=portfolio(style,candles,idx,*ps['confirmation'],STRESS_BPS,1); res.update(confirmation=cm,confirmationPair=cp,confirmationContribution=cc,confirmationStress=cs)
        if not b.gate(cm,cs):res.update(status='FAIL',reason='CONFIRMATION')
        else:
            hm,hp,hc=portfolio(style,candles,idx,*ps['holdout'],NORMAL_BPS,0); hs,_,_=portfolio(style,candles,idx,*ps['holdout'],STRESS_BPS,1); ym,yp,yc=portfolio(style,candles,idx,ps['development'][0],ps['holdout'][1],NORMAL_BPS,0); ys,_,_=portfolio(style,candles,idx,ps['development'][0],ps['holdout'][1],STRESS_BPS,1)
            pos=sum((yp[s].get('returnPct') or 0)>0 for s in SYMS); sh=[abs(x) for x in yc.values()]; conc=max(sh)/sum(sh) if sum(sh)>1e-9 else 1
            ok=b.gate(ym,ys) and (hm.get('pf') or 0)>1 and hm.get('returnPct',0)>0 and (hs.get('pf') or 0)>1 and ym.get('returnPct',0)>=60 and pos>=4 and conc<.45
            res.update(holdout=hm,holdoutPair=hp,holdoutContribution=hc,holdoutStress=hs,year=ym,yearPair=yp,yearContribution=yc,yearStress=ys,pairConcentration=conc,status='PASS' if ok else 'FAIL',reason='PASS' if ok else 'FINAL_TARGET')
    out=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state'));out.mkdir(parents=True,exist_ok=True);stem=f'pair-specific-v108-{style}';txt=json.dumps(res,indent=2);(out/f'{stem}.json').write_text(txt,encoding='utf-8');(out/f'{stem}.md').write_text(f'# {res["strategyId"]}\n\n```json\n{txt}\n```\n',encoding='utf-8');print(txt)
if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--style',choices=['cusum_state','drift_hysteresis','adaptive_trailing'],required=True);run(ap.parse_args().style)
