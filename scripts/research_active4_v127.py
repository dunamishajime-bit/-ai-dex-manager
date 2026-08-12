from __future__ import annotations
import argparse, json, math, os, statistics
from pathlib import Path
import research_active4_v126 as q

HOUR=q.HOUR; NORMAL_BPS=q.NORMAL_BPS; STRESS_BPS=q.STRESS_BPS
metric=q.metric; ret=q.ret; p=q.p
CANDS={
 'btc_core_expansion_acceptance':('BTC',.55),
 'btc_false_start_lockout_wavecore':('BTC',.53),
 'eth_leadership_core_hold':('ETH',.50),
 'bnb_regime_core_acceptance':('BNB',.45),
 'avax_burst_core_router':('AVAX',.40),
}
q.CANDS.update({k:(v[0],v[1],8.0,840) for k,v in CANDS.items()})

def mean(xs): return statistics.fmean(xs) if xs else 0.0

def intent(cid,candles,idx,ts):
    x=q.feat(cid,candles,idx,ts)
    z={'bias':0,'prewave':0,'onset':0,'accept':0,'reentry':0,'reverse':0,'exhaust':0,'strength':0.0}
    if not x:return z
    r=x['r']
    if cid=='btc_core_expansion_acceptance':
        if x['z168']>.05 and x['sl168']>=0:z['bias']=1
        elif x['z168']<-.05 and x['sl168']<=0:z['bias']=-1
        comp=x['v'][48] < .9*x['v'][168] and x['e72']<.30
        if comp:z['prewave']=z['bias'] if z['bias'] else 1
        if r[6]>0 and x['z6']>.14 and x['z24']>-.05:z['onset']=1
        elif r[6]<0 and x['z6']<-.14 and x['z24']<.05:z['onset']=-1
        if r[24]>0 and r[72]>0 and x['sl48']>0 and x['e72']>.18:z['accept']=1
        elif r[24]<0 and r[72]<0 and x['sl48']<0 and x['e72']>.18:z['accept']=-1
        if z['accept']==1 and r[12]<0 and r[3]>0:z['reentry']=1
        elif z['accept']==-1 and r[12]>0 and r[3]<0:z['reentry']=-1
        if r[72]<0 and x['sl168']<0:z['reverse']=-1
        elif r[72]>0 and x['sl168']>0:z['reverse']=1
        if x['shock']>1.9 and x['e24']<.08:z['exhaust']=1 if r[24]>0 else -1
        z['strength']=abs(x['z72'])+.5*x['e168']
    elif cid=='btc_false_start_lockout_wavecore':
        if x['rp336']>.55 and x['sl168']>=0:z['bias']=1
        elif x['rp336']<.45 and x['sl168']<=0:z['bias']=-1
        if x['shock']>1.25 or x['v'][48]<.86*x['v'][168]:z['prewave']=z['bias'] if z['bias'] else 1
        if r[24]<0 and r[6]>0 and x['z3']>.08:z['onset']=1
        elif r[24]>0 and r[6]<0 and x['z3']<-.08:z['onset']=-1
        if r[48]>0 and x['sl48']>0 and x['rp168']>.56:z['accept']=1
        elif r[48]<0 and x['sl48']<0 and x['rp168']<.44:z['accept']=-1
        if z['accept']==1 and r[12]<0 and r[6]>0:z['reentry']=1
        elif z['accept']==-1 and r[12]>0 and r[6]<0:z['reentry']=-1
        if r[72]<0 and x['rp168']<.42:z['reverse']=-1
        elif r[72]>0 and x['rp168']>.58:z['reverse']=1
        if x['shock']>2.0 and x['e24']<.09:z['exhaust']=1 if r[24]>0 else -1
        z['strength']=abs(x['z48'])+.4*x['e72']
    elif cid=='eth_leadership_core_hold':
        bi=idx['BTC'].get(ts); btc=candles['BTC']
        if bi is None or bi<336:return z
        rb={n:(ret(btc,bi,n) or 0.0) for n in (6,24,72,168)}
        rel={n:r[n]-rb[n] for n in (6,24,72,168)}
        if rel[168]>.06:z['bias']=1
        elif rel[168]<-.06:z['bias']=-1
        if abs(rel[72])<.30 and x['v'][48]<.92*x['v'][168]:z['prewave']=z['bias'] if z['bias'] else 1
        if rel[6]>.08 and rel[24]>-.05 and r[6]>0:z['onset']=1
        elif rel[6]<-.08 and rel[24]<.05 and r[6]<0:z['onset']=-1
        if rel[72]>.08 and rel[24]>0 and r[72]>0 and x['sl48']>0:z['accept']=1
        elif rel[72]<-.08 and rel[24]<0 and r[72]<0 and x['sl48']<0:z['accept']=-1
        if z['accept']==1 and rel[12 if 12 in rel else 24]>=0 and r[12]<0 and r[3]>0:z['reentry']=1
        elif z['accept']==-1 and rel[24]<=0 and r[12]>0 and r[3]<0:z['reentry']=-1
        if rel[72]<-.08 and rel[24]<0:z['reverse']=-1
        elif rel[72]>.08 and rel[24]>0:z['reverse']=1
        if x['shock']>1.8 and x['e24']<.08:z['exhaust']=1 if r[24]>0 else -1
        z['strength']=abs(rel[72])/(x['v'][168]*math.sqrt(72)+1e-9)+.4*x['e72']
    elif cid=='bnb_regime_core_acceptance':
        market=p.medmove(candles,idx,ts,72); rel72=r[72]-market
        if rel72>.05 and x['rp336']>.52:z['bias']=1
        elif rel72<-.05 and x['rp336']<.48:z['bias']=-1
        if z['bias'] and x['v'][48]<.84*x['v'][168] and x['e72']<.28:z['prewave']=z['bias']
        if z['bias']==1 and r[6]>0 and x['z6']>.10 and x['volumeRatio']>.75:z['onset']=1
        elif z['bias']==-1 and r[6]<0 and x['z6']<-.10 and x['volumeRatio']>.75:z['onset']=-1
        if z['bias']==1 and rel72>0 and r[48]>0 and x['rp168']>.56 and x['e72']>.16:z['accept']=1
        elif z['bias']==-1 and rel72<0 and r[48]<0 and x['rp168']<.44 and x['e72']>.16:z['accept']=-1
        if z['accept']==1 and r[12]<0 and r[6]>0:z['reentry']=1
        elif z['accept']==-1 and r[12]>0 and r[6]<0:z['reentry']=-1
        if rel72<0 and x['rp168']<.42:z['reverse']=-1
        elif rel72>0 and x['rp168']>.58:z['reverse']=1
        z['strength']=abs(rel72)/(x['v'][168]*math.sqrt(72)+1e-9)+.45*x['e168']
    else:
        market24=p.medmove(candles,idx,ts,24); market72=p.medmove(candles,idx,ts,72)
        rel24=r[24]-market24; rel72=r[72]-market72
        if rel72>.08 and x['br']>0:z['bias']=1
        elif rel72<-.08 and x['br']<0:z['bias']=-1
        if x['v'][48]<.90*x['v'][168] or x['shock']>1.25:z['prewave']=z['bias'] if z['bias'] else 1
        if rel24>.08 and x['z6']>.12 and r[6]>0:z['onset']=1
        elif rel24<-.08 and x['z6']<-.12 and r[6]<0:z['onset']=-1
        if rel72>.08 and r[48]>0 and x['e72']>.16 and x['br']>=0:z['accept']=1
        elif rel72<-.08 and r[48]<0 and x['e72']>.16 and x['br']<=0:z['accept']=-1
        if z['accept']==1 and r[12]<0 and x['z3']>.05:z['reentry']=1
        elif z['accept']==-1 and r[12]>0 and x['z3']<-.05:z['reentry']=-1
        if rel72<-.08 and x['br']<0:z['reverse']=-1
        elif rel72>.08 and x['br']>0:z['reverse']=1
        if x['shock']>2.0 and x['e24']<.08:z['exhaust']=1 if r[24]>0 else -1
        z['strength']=abs(rel72)/(x['v'][168]*math.sqrt(72)+1e-9)+.35*x['e72']
    return z

def simulate(cid,candles,idx,start,end,cost,delay,records=False,risk_scale=1.0):
    s,base_risk=CANDS[cid]; risk=base_risk*risk_scale; c=candles[s]
    stage='CASH'; side=0; entry=None; ets=None; entry_i=None; peak=None; trough=None
    vals=[]; recs=[]; locked_side=0; armed=True
    def close_trade(i,ts,xp,reason,leg_risk):
        nonlocal stage,side,entry,ets,entry_i,peak,trough
        if entry is None:return
        pnl=(side*(xp/entry-1)*100-cost/100)*leg_risk
        seg=c[entry_i:i+1] if entry_i is not None else []
        mfe=max([side*(float(a['high'])/entry-1)*100 if side>0 else side*(float(a['low'])/entry-1)*100 for a in seg],default=0.0)
        realized=side*(xp/entry-1)*100
        vals.append(pnl); recs.append({'entryTs':ets,'exitTs':ts,'side':side,'pnl':pnl,'entry':entry,'exit':xp,'heldHours':(ts-ets)//HOUR,'mfePct':max(0,mfe),'givebackPct':max(0,max(0,mfe)-realized),'stage':stage,'exitReason':reason})
        stage='CASH'; side=0; entry=ets=entry_i=peak=trough=None
    for row in c:
        ts=int(row['ts'])
        if not(start<=ts<end):continue
        i=idx[s].get(ts)
        if i is None or i<900:continue
        st=intent(cid,candles,idx,ts); px=float(c[i]['close'])
        if locked_side and st['prewave'] and (st['bias'] in (0,locked_side)):
            armed=True; locked_side=0
        if stage!='CASH':
            peak=max(peak,px); trough=min(trough,px); held=(ts-ets)//HOUR
            give=(px/peak-1)*100 if side>0 else (trough/px-1)*100
            xi=min(i+1+delay,len(c)-1); xp=float(c[xi]['open'])
            if stage=='PROBE':
                accepted=st['accept']==side and st['bias'] in (0,side)
                failed=(st['reverse']==-side) or held>=24 or give<=-4.0
                if accepted:
                    close_trade(xi,ts,xp,'PROBE_ACCEPT',risk*.35)
                    stage='CORE'; side=st['accept']; entry=xp; ets=ts; entry_i=xi; peak=trough=xp
                elif failed:
                    old=side; close_trade(xi,ts,xp,'FALSE_START',risk*.35); locked_side=old; armed=False
            elif stage=='CORE':
                slow_reverse=st['reverse']==-side and st['bias']!=side
                exhausted=st['exhaust']==side and st['accept']!=side
                catastrophe=give<=(-16.0 if s=='AVAX' else -12.0)
                if slow_reverse or exhausted or catastrophe:
                    old=side; close_trade(xi,ts,xp,'STRUCTURAL_REVERSE' if slow_reverse else ('EXHAUSTION' if exhausted else 'CATASTROPHE'),risk)
                    locked_side=old if catastrophe else 0; armed=not catastrophe
        if stage=='CASH' and armed:
            d=0; kind=''
            if st['onset'] and st['bias'] in (0,st['onset']):d=st['onset']; kind='ONSET'
            elif st['reentry'] and st['bias']==st['reentry']:d=st['reentry']; kind='REENTRY'
            if d:
                ei=min(i+1+delay,len(c)-1); stage='PROBE'; side=d; entry=float(c[ei]['open']); ets=ts; entry_i=ei; peak=trough=entry
    if stage!='CASH' and entry is not None:
        valid=[idx[s][int(a['ts'])] for a in c if start<=int(a['ts'])<end]
        if valid:
            i=max(valid); close_trade(i,int(c[i]['ts']),float(c[i]['close']),'PERIOD_END',risk*(.35 if stage=='PROBE' else 1.0))
    return (vals,recs) if records else vals

def evalm(cid,candles,idx,per,cost,delay,risk_scale=1.0):return metric(simulate(cid,candles,idx,*per,cost,delay,False,risk_scale))

def wave_diag(cid,candles,idx,per):
    s=CANDS[cid][0]; c=candles[s]; start,end=per; _,recs=simulate(cid,candles,idx,start,end,NORMAL_BPS,0,True)
    waves=[]; last=-1
    for row in c:
        ts=int(row['ts']); i=idx[s].get(ts)
        if not(start<=ts<end) or ts<=last or i is None or i<336 or i+48>=len(c):continue
        v=p.vol(c,i,168); p0=float(c[i]['close']); fut=c[i+1:i+49]
        up=100*(max(float(a['high']) for a in fut)/p0-1); dn=100*(p0/min(float(a['low']) for a in fut)-1); th=max(3.0,2*v*math.sqrt(48))
        if max(up,dn)<th:continue
        sd=1 if up>=dn else -1; mfe=max(up,dn)
        hit=next((a for a in recs if a['stage']=='CORE' and ts<=a['entryTs']<=ts+24*HOUR and a['side']==sd),None)
        waves.append({'delay':(hit['entryTs']-ts)/HOUR if hit else None,'capture':100*max(0,sd*(hit['exit']/hit['entry']-1)*100)/max(mfe,1e-9) if hit else 0})
        last=ts+48*HOUR
    got=[a for a in waves if a['delay'] is not None]; false=[a for a in recs if a['exitReason']=='FALSE_START']
    core=[a for a in recs if a['stage']=='CORE']; top=sorted((a['pnl'] for a in recs),reverse=True)[:5]; total=sum(a['pnl'] for a in recs)
    longs=[a for a in recs if a['side']>0]; shorts=[a for a in recs if a['side']<0]
    return {'majorWaves':len(waves),'captured':len(got),'captureRatePct':100*len(got)/len(waves) if waves else 0,'medianEntryDelayHours':statistics.median([a['delay'] for a in got]) if got else None,'medianWaveMfeCapturedPct':statistics.median([a['capture'] for a in got]) if got else None,'missedWaves':len(waves)-len(got),'falseStartRatePct':100*len(false)/len(recs) if recs else 0,'avgHoldHours':mean([a['heldHours'] for a in core]),'avgExitGivebackPct':mean([a['givebackPct'] for a in core]),'top5TradeContributionPct':100*sum(top)/total if total>0 else None,'ledger':{'longTrades':len(longs),'longPnl':sum(a['pnl'] for a in longs),'shortTrades':len(shorts),'shortPnl':sum(a['pnl'] for a in shorts),'probeFalseStarts':len(false),'coreTrades':len(core),'exitReasons':{k:sum(1 for a in recs if a['exitReason']==k) for k in ('PROBE_ACCEPT','FALSE_START','STRUCTURAL_REVERSE','EXHAUSTION','CATASTROPHE','PERIOD_END')}}}

def folds(cid,candles,idx,per):
    a,z=per; step=(z-a)//3; ms=[]
    for k in range(3):ms.append(evalm(cid,candles,idx,(a+k*step,z if k==2 else a+(k+1)*step),NORMAL_BPS,0))
    return {'folds':ms,'positivePfFolds':sum((m.get('returnPct') or 0)>0 and (m.get('pf') or 0)>1 for m in ms)}

def run(cid):
    candles,idx,_=q.b.p.v109.b.base.load(); ps=q.b.p.v109.b.base.periods(candles)
    dm=evalm(cid,candles,idx,ps['development'],NORMAL_BPS,0); vm=evalm(cid,candles,idx,ps['validation'],NORMAL_BPS,0); vs=evalm(cid,candles,idx,ps['validation'],STRESS_BPS,1)
    dw=wave_diag(cid,candles,idx,ps['development']); vw=wave_diag(cid,candles,idx,ps['validation']); df=folds(cid,candles,idx,ps['development']); vf=folds(cid,candles,idx,ps['validation'])
    neigh=[evalm(cid,candles,idx,ps['validation'],NORMAL_BPS,0,r) for r in (.9,1.1)]
    result={'strategyId':'V127_'+cid.upper(),'pair':CANDS[cid][0],'periods':ps,'development':dm,'validation':vm,'validationStress':vs,'waveDiagnostics':{'development':dw,'validation':vw},'walkForward':{'development':df,'validation':vf},'neighborhood':neigh,'productionChanged':False,'realTradingEnabled':False,'architecture':'PROBE_ACCEPTED_CORE_LOCKOUT'}
    promote=(dm.get('pf') or 0)>=1.20 and dm.get('returnPct',0)>0 and (vm.get('pf') or 0)>=1.20 and vm.get('returnPct',0)>0 and (vs.get('pf') or 0)>1 and vm.get('maxDDPct',-999)>-20 and vw['medianWaveMfeCapturedPct'] is not None and vw['medianWaveMfeCapturedPct']>=25 and vw['falseStartRatePct']<=45 and vf['positivePfFolds']>=2 and all((m.get('pf') or 0)>=1.10 for m in neigh))
    if not promote:result.update(status='FAIL',reason='DEV_VALIDATION_MONETIZATION')
    else:
        cm=evalm(cid,candles,idx,ps['confirmation'],NORMAL_BPS,0); cs=evalm(cid,candles,idx,ps['confirmation'],STRESS_BPS,1); result.update(confirmation=cm,confirmationStress=cs)
        if (cm.get('pf') or 0)<1.2 or cm.get('returnPct',0)<=0 or (cs.get('pf') or 0)<=1:result.update(status='FAIL',reason='CONFIRMATION')
        else:
            hm=evalm(cid,candles,idx,ps['holdout'],NORMAL_BPS,0); hs=evalm(cid,candles,idx,ps['holdout'],STRESS_BPS,1); ok=(hm.get('pf') or 0)>1 and hm.get('returnPct',0)>0 and (hs.get('pf') or 0)>1
            result.update(holdout=hm,holdoutStress=hs,status='PASS' if ok else 'FAIL',reason='PASS' if ok else 'FINAL')
    out=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state')); out.mkdir(parents=True,exist_ok=True); stem='active4-v127-'+cid; txt=json.dumps(result,indent=2)
    (out/f'{stem}.json').write_text(txt,encoding='utf-8'); (out/f'{stem}.md').write_text('# '+result['strategyId']+'\n\n```json\n'+txt+'\n```\n',encoding='utf-8'); print(txt)

if __name__=='__main__':
    ap=argparse.ArgumentParser(); ap.add_argument('--candidate',choices=CANDS,required=True); a=ap.parse_args(); run(a.candidate)
