from __future__ import annotations
import argparse,json,math,os
from pathlib import Path
import research_active4_v115 as q

HOUR=q.HOUR; NORMAL_BPS=q.NORMAL_BPS; STRESS_BPS=q.STRESS_BPS; metric=q.metric; ret=q.ret; p=q.p
CANDS={
 'btc_trend_hysteresis':('BTC',.64,6.2,600),
 'btc_impulse_channel':('BTC',.62,5.8,480),
 'eth_leadership_persistence':('ETH',.60,6.5,480),
 'bnb_prebreak_thrust':('BNB',.54,6.0,408),
 'avax_fast_burst_hold':('AVAX',.46,7.8,360),
}
q.CANDS.update(CANDS)

def sign(v,th=0): return 1 if v>th else -1 if v<-th else 0

def rel(candles,idx,s,ts,n,bench='BTC'):
    i=idx[s].get(ts); j=idx[bench].get(ts)
    if i is None or j is None:return 0.0
    return (ret(candles[s],i,n) or 0)-(ret(candles[bench],j,n) or 0)

def state(cid,candles,idx,ts):
    x=q.feat(cid,candles,idx,ts); z={'bias':0,'prewave':0,'onset':0,'continue':0,'reentry':0,'reverse':0,'exhaust':0,'strength':0.0}
    if not x:return z
    r=x['r']; c=x['c']; i=x['i']
    if cid=='btc_trend_hysteresis':
        slow_score=(1 if r[240]>0 else -1)+(1 if x['sl168']>0 else -1)+(1 if x['rp336']>.5 else -1)
        z['bias']=1 if slow_score>=1 else -1 if slow_score<=-1 else 0
        if x['v'][48]<.92*x['v'][168] and x['e72']<.24:z['prewave']=z['bias'] or 1
        medium=sign(r[48])+sign(x['sl48'])+sign(x['rp168']-.5)
        fast=sign(r[6])+sign(r[12])+sign(x['z3'])
        if fast>=2 and medium>=1 and x['e24']>.11:z['onset']=1
        elif fast<=-2 and medium<=-1 and x['e24']>.11:z['onset']=-1
        if medium>=2 and r[72]>0:z['continue']=1
        elif medium<=-2 and r[72]<0:z['continue']=-1
        if z['bias']==1 and medium>=1 and r[12]<0 and r[3]>0:z['reentry']=1
        elif z['bias']==-1 and medium<=-1 and r[12]>0 and r[3]<0:z['reentry']=-1
        if slow_score<=-2 and medium<=-2:z['reverse']=-1
        elif slow_score>=2 and medium>=2:z['reverse']=1
        z['strength']=abs(medium)/3+.35*x['e72']
        if x['shock']>2.0 and x['e24']<.08:z['exhaust']=sign(r[24])
    elif cid=='btc_impulse_channel':
        mid=(x['hi240']+x['lo240'])/2; channel=(x['hi240']-x['lo240'])/max(mid,1e-9)
        z['bias']=1 if x['px']>mid and r[168]>0 else -1 if x['px']<mid and r[168]<0 else 0
        if x['v'][24]<.85*x['v'][168]:z['prewave']=z['bias'] or 1
        impulse=x['z6']+.55*x['z12']-.25*x['z48']
        if impulse>.24 and x['vr']>.62 and x['rp72']>.48:z['onset']=1
        elif impulse<-.24 and x['vr']>.62 and x['rp72']<.52:z['onset']=-1
        if r[48]>0 and x['rp168']>.55 and x['e72']>.14:z['continue']=1
        elif r[48]<0 and x['rp168']<.45 and x['e72']>.14:z['continue']=-1
        if z['continue']==1 and r[12]<0 and r[3]>0:z['reentry']=1
        elif z['continue']==-1 and r[12]>0 and r[3]<0:z['reentry']=-1
        if x['px']<mid and r[48]<0:z['reverse']=-1
        elif x['px']>mid and r[48]>0:z['reverse']=1
        z['strength']=abs(impulse)+.25*x['e72']+.1*channel
    elif cid=='eth_leadership_persistence':
        rr={n:rel(candles,idx,'ETH',ts,n) for n in (6,24,72,168)}
        score=sum(1 if rr[n]>0 else -1 if rr[n]<0 else 0 for n in (24,72,168))
        z['bias']=1 if score>=2 and r[72]>0 else -1 if score<=-2 and r[72]<0 else 0
        if x['v'][48]<.9*x['v'][168] and abs(rr[72])<.28:z['prewave']=z['bias'] or 1
        accel=rr[6]+.45*rr[24]
        if accel>.18 and score>=1 and r[6]>0 and x['e24']>.12:z['onset']=1
        elif accel<-.18 and score<=-1 and r[6]<0 and x['e24']>.12:z['onset']=-1
        if score>=2 and rr[72]>.08 and x['sl48']>0:z['continue']=1
        elif score<=-2 and rr[72]<-.08 and x['sl48']<0:z['continue']=-1
        if z['bias']==1 and rr[72]>0 and r[12]<0 and rr[6]>0:z['reentry']=1
        elif z['bias']==-1 and rr[72]<0 and r[12]>0 and rr[6]<0:z['reentry']=-1
        if score<=-2 and rr[24]<0:z['reverse']=-1
        elif score>=2 and rr[24]>0:z['reverse']=1
        z['strength']=abs(score)/3+abs(rr[72])/(x['v'][168]*math.sqrt(72)+1e-9)
        if x['shock']>1.8 and abs(rr[6])<.03:z['exhaust']=sign(rr[72])
    elif cid=='bnb_prebreak_thrust':
        market=p.medmove(candles,idx,ts,72); rr72=r[72]-market
        z['bias']=1 if rr72>.04 and r[168]>0 else -1 if rr72<-.04 and r[168]<0 else 0
        comp=x['v'][48]<.86*x['v'][168] and x['e72']<.28
        if comp:z['prewave']=z['bias'] or 1
        dist_hi=100*(x['hi120']/x['px']-1); dist_lo=100*(x['px']/x['lo120']-1)
        if z['bias']>=0 and dist_hi<1.3 and r[12]>0 and x['z6']>.10 and x['e24']>.10:z['onset']=1
        elif z['bias']<=0 and dist_lo<1.3 and r[12]<0 and x['z6']<-.10 and x['e24']>.10:z['onset']=-1
        if rr72>.06 and r[48]>0 and x['rp168']>.53:z['continue']=1
        elif rr72<-.06 and r[48]<0 and x['rp168']<.47:z['continue']=-1
        if z['continue']==1 and r[12]<0 and r[3]>0:z['reentry']=1
        elif z['continue']==-1 and r[12]>0 and r[3]<0:z['reentry']=-1
        if rr72<-.08 and r[24]<0:z['reverse']=-1
        elif rr72>.08 and r[24]>0:z['reverse']=1
        z['strength']=abs(rr72)/(x['v'][168]*math.sqrt(72)+1e-9)+.3*x['e72']
    else:
        m24=p.medmove(candles,idx,ts,24); m72=p.medmove(candles,idx,ts,72); rr24=r[24]-m24; rr72=r[72]-m72
        z['bias']=1 if rr72>.05 and r[72]>0 else -1 if rr72<-.05 and r[72]<0 else 0
        if x['v'][24]<.9*x['v'][168]:z['prewave']=z['bias'] or 1
        fast=x['z3']+.65*x['z6']
        if fast>.18 and rr24>.04 and x['e24']>.09:z['onset']=1
        elif fast<-.18 and rr24<-.04 and x['e24']>.09:z['onset']=-1
        if rr72>.05 and r[48]>0 and x['sl48']>0:z['continue']=1
        elif rr72<-.05 and r[48]<0 and x['sl48']<0:z['continue']=-1
        if z['continue']==1 and r[6]<0 and r[3]>0:z['reentry']=1
        elif z['continue']==-1 and r[6]>0 and r[3]<0:z['reentry']=-1
        if rr72<-.08 and x['sl48']<0:z['reverse']=-1
        elif rr72>.08 and x['sl48']>0:z['reverse']=1
        z['strength']=abs(rr72)/(x['v'][168]*math.sqrt(72)+1e-9)+.3*abs(fast)+.25*x['e72']
        if x['shock']>2.1 and x['e24']<.08:z['exhaust']=sign(r[24])
    return z

q.state=state

def run(cid):
    candles,idx,_=q.b.p.v109.b.base.load(); ps=q.b.p.v109.b.base.periods(candles)
    dm=q.evalm(cid,candles,idx,ps['development'],NORMAL_BPS,0); vm=q.evalm(cid,candles,idx,ps['validation'],NORMAL_BPS,0); vs=q.evalm(cid,candles,idx,ps['validation'],STRESS_BPS,1)
    dw=q.wave_diag(cid,candles,idx,ps['development']); vw=q.wave_diag(cid,candles,idx,ps['validation']); df=q.folds(cid,candles,idx,ps['development']); vf=q.folds(cid,candles,idx,ps['validation'])
    result={'strategyId':'V116_'+cid.upper(),'pair':CANDS[cid][0],'periods':ps,'development':dm,'validation':vm,'validationStress':vs,'waveDiagnostics':{'development':dw,'validation':vw},'walkForward':{'development':df,'validation':vf},'productionChanged':False,'realTradingEnabled':False}
    promote=(dm.get('pf') or 0)>=1.20 and dm.get('returnPct',0)>0 and (vm.get('pf') or 0)>=1.20 and vm.get('returnPct',0)>0 and (vs.get('pf') or 0)>1 and vm.get('maxDDPct',-999)>-20 and vw['captureRatePct']>=20 and vf['positivePfFolds']>=2
    if not promote:result.update(status='FAIL',reason='DEV_VALIDATION_WAVE')
    else:
        cm=q.evalm(cid,candles,idx,ps['confirmation'],NORMAL_BPS,0); cs=q.evalm(cid,candles,idx,ps['confirmation'],STRESS_BPS,1); result.update(confirmation=cm,confirmationStress=cs)
        if (cm.get('pf') or 0)<1.2 or cm.get('returnPct',0)<=0 or (cs.get('pf') or 0)<=1:result.update(status='FAIL',reason='CONFIRMATION')
        else:
            hm=q.evalm(cid,candles,idx,ps['holdout'],NORMAL_BPS,0); hs=q.evalm(cid,candles,idx,ps['holdout'],STRESS_BPS,1); ym=q.evalm(cid,candles,idx,(ps['development'][0],ps['holdout'][1]),NORMAL_BPS,0); ys=q.evalm(cid,candles,idx,(ps['development'][0],ps['holdout'][1]),STRESS_BPS,1)
            ok=(hm.get('pf') or 0)>1 and hm.get('returnPct',0)>0 and (hs.get('pf') or 0)>1 and (ym.get('pf') or 0)>=1.2 and ym.get('returnPct',0)>0 and (ys.get('pf') or 0)>1
            result.update(holdout=hm,holdoutStress=hs,year=ym,yearStress=ys,status='PASS' if ok else 'FAIL',reason='PASS' if ok else 'FINAL')
    out=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state'));out.mkdir(parents=True,exist_ok=True);stem='active4-v116-'+cid;txt=json.dumps(result,indent=2)
    (out/f'{stem}.json').write_text(txt,encoding='utf-8');(out/f'{stem}.md').write_text('# '+result['strategyId']+'\n\n```json\n'+txt+'\n```\n',encoding='utf-8');print(txt)

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--candidate',choices=sorted(CANDS),required=True);run(ap.parse_args().candidate)
