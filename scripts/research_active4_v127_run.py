from __future__ import annotations
import argparse,json,math,os
from pathlib import Path
import research_active4_v126 as prev

engine=prev.engine; p=engine.p; ret=engine.ret; HOUR=engine.HOUR
NORMAL_BPS=engine.NORMAL_BPS; STRESS_BPS=engine.STRESS_BPS; v109=prev.v109
CANDS={
 'btc_accepted_core_hold':('BTC',.52,11.0,1008),
 'btc_structural_ownership':('BTC',.50,12.0,1176),
 'eth_leadership_core_hold':('ETH',.47,11.5,1008),
 'bnb_regime_core_acceptance':('BNB',.42,10.0,1008),
 'avax_burst_core_hold':('AVAX',.36,14.0,840),
}
engine.CANDS.update(CANDS)

def rel(candles,idx,s,ts,n):
 i=idx[s].get(ts)
 return 0.0 if i is None else (ret(candles[s],i,n) or 0.0)-p.medmove(candles,idx,ts,n)

def state(cid,candles,idx,ts):
 x=engine.feat(cid,candles,idx,ts); z={'bias':0,'prewave':0,'onset':0,'continue':0,'reentry':0,'reverse':0,'exhaust':0,'strength':0.0}
 if not x:return z
 r=x['r'];v=x['v'];c=x['c'];i=x['i'];s=CANDS[cid][0];br=x['br'];shock=x['shock'];sl72=p.slope(c,i,72);sl168=x['sl168'];rr24=rel(candles,idx,s,ts,24);rr72=rel(candles,idx,s,ts,72);rr168=rel(candles,idx,s,ts,168)
 if cid=='btc_accepted_core_hold':
  slow=1 if r[336]>0 and sl168>0 else -1 if r[336]<0 and sl168<0 else 0
  z['bias']=slow
  if slow and v[48]<.92*v[168]:z['prewave']=slow
  # Entry only after medium expansion acceptance; fast impulse alone cannot open a core position.
  if slow==1 and r[24]>0 and r[72]>0 and sl72>0 and x['e72']>.18:z['onset']=1
  elif slow==-1 and r[24]<0 and r[72]<0 and sl72<0 and x['e72']>.18:z['onset']=-1
  if slow==1 and r[168]>0 and sl72>0:z['continue']=1
  elif slow==-1 and r[168]<0 and sl72<0:z['continue']=-1
  if z['continue']==1 and r[24]<0 and r[6]>0:z['reentry']=1
  elif z['continue']==-1 and r[24]>0 and r[6]<0:z['reentry']=-1
  # Core exit requires both medium and slow structural deterioration.
  if r[72]<0 and sl168<0 and x['rp168']<.42:z['reverse']=-1
  elif r[72]>0 and sl168>0 and x['rp168']>.58:z['reverse']=1
  if shock>2.1 and x['e72']<.07:z['exhaust']=1 if r[168]>0 else -1
  z['strength']=abs(x['z168'])+.7*x['e168']+.3*abs(x['z72'])
 elif cid=='btc_structural_ownership':
  slow=1 if r[336]>0 and x['rp336']>.52 else -1 if r[336]<0 and x['rp336']<.48 else 0
  medium=1 if r[168]>0 and sl168>0 else -1 if r[168]<0 and sl168<0 else 0
  z['bias']=slow if slow==medium else 0
  if z['bias'] and x['e168']<.22:z['prewave']=z['bias']
  # Ownership starts on a slow/medium agreement plus 48h acceptance, not on a 3-6h spike.
  if z['bias']==1 and r[48]>0 and x['rp168']>.55:z['onset']=1
  elif z['bias']==-1 and r[48]<0 and x['rp168']<.45:z['onset']=-1
  if medium==1 and r[72]>0:z['continue']=1
  elif medium==-1 and r[72]<0:z['continue']=-1
  if z['continue']==1 and r[24]<0 and r[6]>0 and sl72>0:z['reentry']=1
  elif z['continue']==-1 and r[24]>0 and r[6]<0 and sl72<0:z['reentry']=-1
  if slow==1 and medium==-1 and r[72]<0:z['reverse']=-1
  elif slow==-1 and medium==1 and r[72]>0:z['reverse']=1
  if x['e168']<.06 and v[24]<.65*v[168]:z['exhaust']=1 if r[168]>0 else -1
  z['strength']=.8*abs(x['z168'])+.8*x['e168']+.25*abs(x['z72'])
 elif cid=='eth_leadership_core_hold':
  bi=idx['BTC'].get(ts)
  if bi is None or bi<336:return z
  btc=candles['BTC'];er={n:r[n]-(ret(btc,bi,n) or 0.0) for n in (6,24,72,168)}
  slow=1 if er[168]>.01 else -1 if er[168]<-.01 else 0; medium=1 if er[72]>.008 else -1 if er[72]<-.008 else 0
  z['bias']=slow if slow==medium else 0
  if z['bias'] and v[48]<.94*v[168]:z['prewave']=z['bias']
  # Leadership must survive into 24h/72h before a core entry.
  if z['bias']==1 and er[24]>0 and er[72]>0 and r[24]>0:z['onset']=1
  elif z['bias']==-1 and er[24]<0 and er[72]<0 and r[24]<0:z['onset']=-1
  if medium==1 and er[168]>0 and r[72]>0:z['continue']=1
  elif medium==-1 and er[168]<0 and r[72]<0:z['continue']=-1
  if z['continue']==1 and er[24]<0 and er[6]>0:z['reentry']=1
  elif z['continue']==-1 and er[24]>0 and er[6]<0:z['reentry']=-1
  if slow==1 and medium==-1 and er[24]<0:z['reverse']=-1
  elif slow==-1 and medium==1 and er[24]>0:z['reverse']=1
  if abs(er[72])<.004 and x['e72']<.07:z['exhaust']=1 if er[168]>0 else -1
  z['strength']=abs(er[168])/(v[168]*math.sqrt(168)+1e-9)+.8*abs(er[72])/(v[168]*math.sqrt(72)+1e-9)+.3*x['e168']
 elif cid=='bnb_regime_core_acceptance':
  # Cash is top-level state: no relative regime, no position.
  z['bias']=1 if rr168>.008 and x['rp336']>.52 else -1 if rr168<-.008 and x['rp336']<.48 else 0
  if z['bias'] and v[48]<.82*v[168] and x['e72']<.20:z['prewave']=z['bias']
  # Require release plus 72h relative acceptance to suppress false starts.
  if z['bias']==1 and rr24>0 and rr72>.012 and r[24]>0 and sl72>0:z['onset']=1
  elif z['bias']==-1 and rr24<0 and rr72<-.012 and r[24]<0 and sl72<0:z['onset']=-1
  if z['bias']==1 and rr72>0 and x['rp168']>.57 and sl72>0:z['continue']=1
  elif z['bias']==-1 and rr72<0 and x['rp168']<.43 and sl72<0:z['continue']=-1
  if z['continue']==1 and r[24]<0 and r[6]>0:z['reentry']=1
  elif z['continue']==-1 and r[24]>0 and r[6]<0:z['reentry']=-1
  if rr168<0 and rr72<0 and x['rp168']<.42:z['reverse']=-1
  elif rr168>0 and rr72>0 and x['rp168']>.58:z['reverse']=1
  if abs(rr72)<.003 and x['e168']<.07:z['exhaust']=1 if rr168>0 else -1
  z['strength']=abs(rr168)/(v[168]*math.sqrt(168)+1e-9)+.55*x['e168']
 else:
  # AVAX: burst is only a trigger; core requires breadth + relative persistence.
  z['bias']=1 if rr168>.012 and br>.48 else -1 if rr168<-.012 and br<.52 else 0
  if z['bias'] and (shock>1.25 or v[48]<.90*v[168]):z['prewave']=z['bias']
  if z['bias']==1 and rr24>.012 and rr72>.018 and r[24]>0 and br>.50:z['onset']=1
  elif z['bias']==-1 and rr24<-.012 and rr72<-.018 and r[24]<0 and br<.50:z['onset']=-1
  if z['bias']==1 and rr72>0 and r[72]>0 and sl72>0:z['continue']=1
  elif z['bias']==-1 and rr72<0 and r[72]<0 and sl72<0:z['continue']=-1
  if z['continue']==1 and r[24]<0 and r[6]>0 and br>.45:z['reentry']=1
  elif z['continue']==-1 and r[24]>0 and r[6]<0 and br<.55:z['reentry']=-1
  if rr168<0 and rr72<0 and br<.40:z['reverse']=-1
  elif rr168>0 and rr72>0 and br>.60:z['reverse']=1
  if shock<.68 and x['e72']<.07:z['exhaust']=1 if rr168>0 else -1
  z['strength']=abs(rr168)/(v[168]*math.sqrt(168)+1e-9)+.55*abs(rr72)/(v[168]*math.sqrt(72)+1e-9)+.4*abs(br-.5)
 return z

engine.state=state

def run(cid):
 candles,idx,_=v109.b.base.load();ps=v109.b.base.periods(candles)
 dm=engine.evalm(cid,candles,idx,ps['development'],NORMAL_BPS,0);vm=engine.evalm(cid,candles,idx,ps['validation'],NORMAL_BPS,0);vs=engine.evalm(cid,candles,idx,ps['validation'],STRESS_BPS,1)
 dw=engine.wave_diag(cid,candles,idx,ps['development']);vw=engine.wave_diag(cid,candles,idx,ps['validation']);df=engine.folds(cid,candles,idx,ps['development']);vf=engine.folds(cid,candles,idx,ps['validation'])
 # Neighborhood is risk-only and predeclared; no threshold search.
 neigh=[engine.metric(engine.simulate(cid,candles,idx,*ps['validation'],NORMAL_BPS,0,False))]
 result={'strategyId':'V127_'+cid.upper(),'pair':CANDS[cid][0],'periods':ps,'development':dm,'validation':vm,'validationStress':vs,'waveDiagnostics':{'development':dw,'validation':vw},'walkForward':{'development':df,'validation':vf},'productionChanged':False,'realTradingEnabled':False,'architecture':'ACCEPTED_CORE_HOLD'}
 promote=(dm.get('pf') or 0)>=1.20 and dm.get('returnPct',0)>0 and (vm.get('pf') or 0)>=1.20 and vm.get('returnPct',0)>0 and (vs.get('pf') or 0)>1 and vm.get('maxDDPct',-999)>-20 and vw['medianWaveMfeCapturedPct'] is not None and vw['medianWaveMfeCapturedPct']>=25 and vw['falseStartRatePct']<=45 and vf['positivePfFolds']>=2
 if not promote:result.update(status='FAIL',reason='DEV_VALIDATION_MONETIZATION')
 else:
  cm=engine.evalm(cid,candles,idx,ps['confirmation'],NORMAL_BPS,0);cs=engine.evalm(cid,candles,idx,ps['confirmation'],STRESS_BPS,1);result.update(confirmation=cm,confirmationStress=cs)
  if (cm.get('pf') or 0)<1.2 or cm.get('returnPct',0)<=0 or (cs.get('pf') or 0)<=1:result.update(status='FAIL',reason='CONFIRMATION')
  else:
   hm=engine.evalm(cid,candles,idx,ps['holdout'],NORMAL_BPS,0);hs=engine.evalm(cid,candles,idx,ps['holdout'],STRESS_BPS,1);ok=(hm.get('pf') or 0)>1 and hm.get('returnPct',0)>0 and (hs.get('pf') or 0)>1
   result.update(holdout=hm,holdoutStress=hs,status='PASS' if ok else 'FAIL',reason='PASS' if ok else 'FINAL')
 out=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state'));out.mkdir(parents=True,exist_ok=True);stem='active4-v127-'+cid;txt=json.dumps(result,indent=2);(out/f'{stem}.json').write_text(txt);(out/f'{stem}.md').write_text('# '+result['strategyId']+'\n\n```json\n'+txt+'\n```\n');print(txt)

if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('--candidate',choices=sorted(CANDS),required=True);run(ap.parse_args().candidate)
