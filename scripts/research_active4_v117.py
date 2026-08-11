from __future__ import annotations
import argparse,json,math,os
from pathlib import Path
import research_active4_v115 as q
import research_lab_pair_specific_v109 as v109
HOUR=q.HOUR; NORMAL_BPS=q.NORMAL_BPS; STRESS_BPS=q.STRESS_BPS; p=q.p; ret=q.ret
CANDS={'btc_score_wave_runner':('BTC',.60,6.2,600),'btc_regime_router':('BTC',.58,5.8,504),'eth_score_wave_runner':('ETH',.58,6.5,504),'bnb_score_regime':('BNB',.52,6.0,408),'avax_score_wave_runner':('AVAX',.46,7.8,384)}
q.CANDS.update(CANDS); MODELS={}
def sg(x,th=0): return 1 if x>th else -1 if x<-th else 0
def rel(candles,idx,s,ts,n,bench='BTC'):
    i=idx[s].get(ts);j=idx[bench].get(ts)
    if i is None or j is None:return 0.0
    return (ret(candles[s],i,n) or 0)-(ret(candles[bench],j,n) or 0)
def score(cid,candles,idx,ts):
    m=MODELS[cid]; s=CANDS[cid][0]; return v109.predict('regime_wave',s,candles,idx,ts,m),m['threshold']
def state(cid,candles,idx,ts):
    x=q.feat(cid,candles,idx,ts);z={'bias':0,'prewave':0,'onset':0,'continue':0,'reentry':0,'reverse':0,'exhaust':0,'strength':0.0}
    if not x:return z
    r=x['r']; pr,th=score(cid,candles,idx,ts); d=sg(pr,th); weak=sg(pr,.18*th)
    if cid=='btc_score_wave_runner':
        slow=sg(r[168])+sg(x['sl168'])+sg(x['rp336']-.5); z['bias']=1 if slow>=1 else -1 if slow<=-1 else 0
        if x['v'][48]<.9*x['v'][168] and x['e72']<.26:z['prewave']=z['bias'] or 1
        if d and z['bias'] in (0,d) and x['e24']>.10:z['onset']=d
        if weak==1 and r[48]>0 and x['sl48']>0:z['continue']=1
        elif weak==-1 and r[48]<0 and x['sl48']<0:z['continue']=-1
        if z['continue']==1 and r[12]<0 and r[3]>0 and pr>0:z['reentry']=1
        elif z['continue']==-1 and r[12]>0 and r[3]<0 and pr<0:z['reentry']=-1
        if weak==-1 and r[72]<0 and x['rp168']<.42:z['reverse']=-1
        elif weak==1 and r[72]>0 and x['rp168']>.58:z['reverse']=1
        z['strength']=abs(pr)/max(th,1e-9)+.35*x['e72']
        if x['shock']>2.0 and x['e24']<.08:z['exhaust']=sg(r[24])
    elif cid=='btc_regime_router':
        trend=x['e168']>.22 and x['v'][24]<1.8*x['v'][168]
        if trend:
            z['bias']=sg(r[168]); impulse=sg(r[12]) if abs(x['z12'])>.12 else 0
            if impulse and z['bias'] in (0,impulse) and x['e24']>.12:z['onset']=impulse
            if sg(r[72])==z['bias'] and x['e72']>.18:z['continue']=z['bias']
            if z['continue']==1 and r[12]<0 and r[3]>0:z['reentry']=1
            elif z['continue']==-1 and r[12]>0 and r[3]<0:z['reentry']=-1
            if sg(r[72])==-z['bias'] and x['e72']>.22:z['reverse']=-z['bias']
        else:
            if x['rp168']>.92 and r[6]<0 and pr<0:z['onset']=-1;z['bias']=-1
            elif x['rp168']<.08 and r[6]>0 and pr>0:z['onset']=1;z['bias']=1
            if x['rp168']<.55 and pr<0:z['continue']=-1
            elif x['rp168']>.45 and pr>0:z['continue']=1
        z['strength']=abs(pr)/max(th,1e-9)+.4*x['e168']
    elif cid=='eth_score_wave_runner':
        rr72=rel(candles,idx,'ETH',ts,72);rr168=rel(candles,idx,'ETH',ts,168)
        z['bias']=1 if rr168>0 and r[168]>0 else -1 if rr168<0 and r[168]<0 else sg(pr,.35*th)
        if x['v'][48]<.92*x['v'][168] and abs(rr72)<.35:z['prewave']=z['bias'] or 1
        if d and z['bias'] in (0,d) and sg(rr72) in (0,d):z['onset']=d
        if weak==1 and rr72>0 and r[48]>0:z['continue']=1
        elif weak==-1 and rr72<0 and r[48]<0:z['continue']=-1
        if z['continue']==1 and r[12]<0 and rel(candles,idx,'ETH',ts,6)>0:z['reentry']=1
        elif z['continue']==-1 and r[12]>0 and rel(candles,idx,'ETH',ts,6)<0:z['reentry']=-1
        if weak==-1 and rr72<0:z['reverse']=-1
        elif weak==1 and rr72>0:z['reverse']=1
        z['strength']=abs(pr)/max(th,1e-9)+abs(rr72)/(x['v'][168]*math.sqrt(72)+1e-9)
        if x['shock']>1.9 and abs(rel(candles,idx,'ETH',ts,6))<.03:z['exhaust']=sg(rr72)
    elif cid=='bnb_score_regime':
        rr72=r[72]-p.medmove(candles,idx,ts,72); active=x['e168']>.14 and abs(rr72)>.04 and x['v'][24]<1.9*x['v'][168]
        if not active:return z
        z['bias']=sg(rr72)
        if x['v'][48]<.9*x['v'][168]:z['prewave']=z['bias']
        if d and d==z['bias'] and x['e24']>.10:z['onset']=d
        if weak==z['bias'] and sg(r[48])==z['bias']:z['continue']=z['bias']
        if z['continue']==1 and r[12]<0 and r[3]>0:z['reentry']=1
        elif z['continue']==-1 and r[12]>0 and r[3]<0:z['reentry']=-1
        z['strength']=abs(pr)/max(th,1e-9)+abs(rr72)/(x['v'][168]*math.sqrt(72)+1e-9)
    else:
        rr24=r[24]-p.medmove(candles,idx,ts,24);rr72=r[72]-p.medmove(candles,idx,ts,72); z['bias']=sg(rr72) if abs(rr72)>.03 else sg(pr,.35*th)
        if x['v'][24]<.92*x['v'][168]:z['prewave']=z['bias'] or 1
        fast=sg(r[3])+sg(r[6])+sg(rr24)
        if d and ((d>0 and fast>=1) or (d<0 and fast<=-1)):z['onset']=d
        if weak==1 and rr72>0 and r[48]>0:z['continue']=1
        elif weak==-1 and rr72<0 and r[48]<0:z['continue']=-1
        if z['continue']==1 and r[6]<0 and r[3]>0 and pr>0:z['reentry']=1
        elif z['continue']==-1 and r[6]>0 and r[3]<0 and pr<0:z['reentry']=-1
        if weak==-1 and rr72<0:z['reverse']=-1
        elif weak==1 and rr72>0:z['reverse']=1
        z['strength']=abs(pr)/max(th,1e-9)+.3*abs(rr72)/(x['v'][168]*math.sqrt(72)+1e-9)
    return z
q.state=state
def run(cid):
    candles,idx,_=q.b.p.v109.b.base.load();ps=q.b.p.v109.b.base.periods(candles);s=CANDS[cid][0];MODELS[cid]=v109.train('regime_wave',s,candles,idx,*ps['development'])
    dm=q.evalm(cid,candles,idx,ps['development'],NORMAL_BPS,0);vm=q.evalm(cid,candles,idx,ps['validation'],NORMAL_BPS,0);vs=q.evalm(cid,candles,idx,ps['validation'],STRESS_BPS,1);dw=q.wave_diag(cid,candles,idx,ps['development']);vw=q.wave_diag(cid,candles,idx,ps['validation']);vf=q.folds(cid,candles,idx,ps['validation'])
    result={'strategyId':'V117_'+cid.upper(),'pair':s,'periods':ps,'modelThreshold':MODELS[cid]['threshold'],'development':dm,'validation':vm,'validationStress':vs,'waveDiagnostics':{'development':dw,'validation':vw},'validationFolds':vf,'productionChanged':False,'realTradingEnabled':False}
    promote=(dm.get('pf') or 0)>=1.20 and dm.get('returnPct',0)>0 and (vm.get('pf') or 0)>=1.20 and vm.get('returnPct',0)>0 and (vs.get('pf') or 0)>1 and vm.get('maxDDPct',-999)>-20 and vw['captureRatePct']>=20 and vf['positivePfFolds']>=2
    if not promote:result.update(status='FAIL',reason='DEV_VALIDATION_WAVE')
    else:
        cm=q.evalm(cid,candles,idx,ps['confirmation'],NORMAL_BPS,0);cs=q.evalm(cid,candles,idx,ps['confirmation'],STRESS_BPS,1);result.update(confirmation=cm,confirmationStress=cs)
        if (cm.get('pf') or 0)<1.2 or cm.get('returnPct',0)<=0 or (cs.get('pf') or 0)<=1:result.update(status='FAIL',reason='CONFIRMATION')
        else:
            hm=q.evalm(cid,candles,idx,ps['holdout'],NORMAL_BPS,0);hs=q.evalm(cid,candles,idx,ps['holdout'],STRESS_BPS,1);ym=q.evalm(cid,candles,idx,(ps['development'][0],ps['holdout'][1]),NORMAL_BPS,0);ys=q.evalm(cid,candles,idx,(ps['development'][0],ps['holdout'][1]),STRESS_BPS,1);ok=(hm.get('pf') or 0)>1 and hm.get('returnPct',0)>0 and (hs.get('pf') or 0)>1 and (ym.get('pf') or 0)>=1.2 and ym.get('returnPct',0)>0 and (ys.get('pf') or 0)>1;result.update(holdout=hm,holdoutStress=hs,year=ym,yearStress=ys,status='PASS' if ok else 'FAIL',reason='PASS' if ok else 'FINAL')
    out=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state'));out.mkdir(parents=True,exist_ok=True);stem='active4-v117-'+cid;txt=json.dumps(result,indent=2);(out/f'{stem}.json').write_text(txt);(out/f'{stem}.md').write_text('# '+result['strategyId']+'\n\n```json\n'+txt+'\n```\n');print(txt)
if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--candidate',choices=sorted(CANDS),required=True);run(ap.parse_args().candidate)
