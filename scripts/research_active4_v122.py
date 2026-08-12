from __future__ import annotations
import argparse,json,math,os
from pathlib import Path
import research_active4_v115 as engine
import research_lab_pair_specific_v109 as v109

HOUR=engine.HOUR; NORMAL_BPS=engine.NORMAL_BPS; STRESS_BPS=engine.STRESS_BPS; p=engine.p; ret=engine.ret
CANDS={
 'btc_leadership_impulse':('BTC',.57,6.0,720),
 'btc_persistence_hysteresis':('BTC',.55,6.4,840),
 'eth_breadth_leadership_cycle':('ETH',.53,6.3,600),
 'bnb_regime_release':('BNB',.46,6.2,504),
 'avax_panic_trend_recovery':('AVAX',.41,7.0,432),
}
engine.CANDS.update(CANDS)

def market_rel(candles,idx,s,ts,n):
 i=idx[s].get(ts)
 if i is None:return 0.0
 r=ret(candles[s],i,n) or 0.0
 return r-p.medmove(candles,idx,ts,n)

def state(cid,candles,idx,ts):
 x=engine.feat(cid,candles,idx,ts); z={'bias':0,'prewave':0,'onset':0,'continue':0,'reentry':0,'reverse':0,'exhaust':0,'strength':0.0}
 if not x:return z
 r=x['r']; v=x['v']; px=x['px']; s=CANDS[cid][0]
 rel24=market_rel(candles,idx,s,ts,24); rel72=market_rel(candles,idx,s,ts,72); rel168=market_rel(candles,idx,s,ts,168)
 if cid=='btc_leadership_impulse':
  leadership=rel168; fastlead=rel24
  z['bias']=1 if leadership>.03 and r[168]>0 else -1 if leadership<-.03 and r[168]<0 else 0
  compression=v[24]<.86*v[168] and x['e72']<.22
  if compression and abs(leadership)>.015:z['prewave']=1 if leadership>0 else -1
  if leadership>.02 and fastlead>.025 and r[6]>0 and x['z6']>.07 and v[24]>v[72]*.92:z['onset']=1
  elif leadership<-.02 and fastlead<-.025 and r[6]<0 and x['z6']<-.07 and v[24]>v[72]*.92:z['onset']=-1
  if rel72>.035 and r[72]>0 and x['e72']>.24:z['continue']=1
  elif rel72<-.035 and r[72]<0 and x['e72']>.24:z['continue']=-1
  if z['continue']==1 and r[12]<0 and r[3]>0 and rel24>-.015:z['reentry']=1
  elif z['continue']==-1 and r[12]>0 and r[3]<0 and rel24<.015:z['reentry']=-1
  if rel24<-.06 and r[12]<0:z['reverse']=-1
  elif rel24>.06 and r[12]>0:z['reverse']=1
  if x['shock']>2.2 and x['e24']<.08:z['exhaust']=1 if r[24]>0 else -1
  z['strength']=abs(rel168)/(v[168]*math.sqrt(168)+1e-9)+.55*x['e72']+.35*abs(rel24)/(v[168]*math.sqrt(24)+1e-9)
 elif cid=='btc_persistence_hysteresis':
  sl72=p.slope(x['c'],x['i'],72); sl168=x['sl168']
  up=r[336]>0 and sl168>0 and x['rp336']>.56; dn=r[336]<0 and sl168<0 and x['rp336']<.44
  z['bias']=1 if up else -1 if dn else 0
  if z['bias'] and v[24]<1.05*v[168] and x['e72']>.14:z['prewave']=z['bias']
  if z['bias']==1 and sl72>0 and r[24]>0 and r[6]>0 and x['rp72']>.62:z['onset']=1
  elif z['bias']==-1 and sl72<0 and r[24]<0 and r[6]<0 and x['rp72']<.38:z['onset']=-1
  if sl168>0 and sl72>0 and r[168]>0 and x['rp168']>.57:z['continue']=1
  elif sl168<0 and sl72<0 and r[168]<0 and x['rp168']<.43:z['continue']=-1
  if z['continue']==1 and r[24]<0 and r[6]>0 and sl168>0:z['reentry']=1
  elif z['continue']==-1 and r[24]>0 and r[6]<0 and sl168<0:z['reentry']=-1
  if sl168<0 and r[72]<0 and x['rp168']<.42:z['reverse']=-1
  elif sl168>0 and r[72]>0 and x['rp168']>.58:z['reverse']=1
  if abs(r[24])<.015 and x['e72']<.10 and v[24]<.72*v[168]:z['exhaust']=1 if r[168]>0 else -1
  z['strength']=abs(x['z168'])+.75*x['e168']+.35*x['e72']
 elif cid=='eth_breadth_leadership_cycle':
  bi=idx['BTC'].get(ts)
  if bi is None or bi<336:return z
  btc=candles['BTC']; rb={n:(ret(btc,bi,n) or 0.0) for n in (6,24,72,168)}
  q24=r[24]-rb[24]; q72=r[72]-rb[72]; q168=r[168]-rb[168]
  z['bias']=1 if q168>.025 and x['br']>.45 else -1 if q168<-.025 and x['br']<.55 else 0
  if abs(q72)<.05 and v[24]<.95*v[168] and z['bias']:z['prewave']=z['bias']
  if q24>.035 and q72>0 and r[6]>0 and x['br']>=.50:z['onset']=1
  elif q24<-.035 and q72<0 and r[6]<0 and x['br']<=.50:z['onset']=-1
  if q72>.045 and q168>0 and r[72]>0 and x['e72']>.20:z['continue']=1
  elif q72<-.045 and q168<0 and r[72]<0 and x['e72']>.20:z['continue']=-1
  if z['continue']==1 and q24>0 and r[12]<0 and r[3]>0:z['reentry']=1
  elif z['continue']==-1 and q24<0 and r[12]>0 and r[3]<0:z['reentry']=-1
  if q24<-.07 and x['br']<.45:z['reverse']=-1
  elif q24>.07 and x['br']>.55:z['reverse']=1
  if x['shock']>2.1 and q24*r[6]<0:z['exhaust']=1 if q24>0 else -1
  z['strength']=abs(q168)/(v[168]*math.sqrt(168)+1e-9)+.5*x['e72']+.4*abs(x['br']-.5)
 elif cid=='bnb_regime_release':
  trend=1 if rel168>.025 and x['rp336']>.53 else -1 if rel168<-.025 and x['rp336']<.47 else 0
  compressed=v[48]<.82*v[168] and x['e72']<.20
  z['bias']=trend
  if compressed and trend:z['prewave']=trend
  if compressed and rel24>.025 and r[6]>0 and x['rp72']>.58:z['onset']=1
  elif compressed and rel24<-.025 and r[6]<0 and x['rp72']<.42:z['onset']=-1
  if rel72>.04 and r[72]>0 and p.slope(x['c'],x['i'],48)>0:z['continue']=1
  elif rel72<-.04 and r[72]<0 and p.slope(x['c'],x['i'],48)<0:z['continue']=-1
  if z['continue']==1 and r[12]<0 and r[3]>0 and rel72>.02:z['reentry']=1
  elif z['continue']==-1 and r[12]>0 and r[3]<0 and rel72<-.02:z['reentry']=-1
  if rel72<-.045 and r[24]<0:z['reverse']=-1
  elif rel72>.045 and r[24]>0:z['reverse']=1
  if abs(rel72)<.01 and x['e72']<.10:z['exhaust']=1 if r[168]>0 else -1
  z['strength']=abs(rel168)/(v[168]*math.sqrt(168)+1e-9)+.6*x['e72']+.25*abs(rel24)/(v[168]*math.sqrt(24)+1e-9)
 else:
  panic=x['br']<=.30 and p.medmove(candles,idx,ts,24)<0 and x['shock']>1.35
  recovery=x['br']>=.50 and rel24>.025 and r[6]>0
  overheat=x['br']>=.72 and p.medmove(candles,idx,ts,24)>0 and x['shock']>1.45
  z['bias']=1 if rel168>.03 else -1 if rel168<-.03 else 0
  if panic:z['prewave']=1
  elif overheat:z['prewave']=-1
  if panic and recovery and x['z6']>.07:z['onset']=1
  elif overheat and rel24<-.025 and r[6]<0 and x['z6']<-.07:z['onset']=-1
  if rel72>.05 and r[72]>0 and x['br']>.48 and x['e72']>.19:z['continue']=1
  elif rel72<-.05 and r[72]<0 and x['br']<.52 and x['e72']>.19:z['continue']=-1
  if z['continue']==1 and r[12]<0 and r[3]>0 and rel24>-.02:z['reentry']=1
  elif z['continue']==-1 and r[12]>0 and r[3]<0 and rel24<.02:z['reentry']=-1
  if rel24<-.09 and x['br']<.42:z['reverse']=-1
  elif rel24>.09 and x['br']>.58:z['reverse']=1
  if x['shock']>2.5 and x['e24']<.08:z['exhaust']=1 if r[24]>0 else -1
  z['strength']=abs(rel72)/(v[168]*math.sqrt(72)+1e-9)+.55*x['e72']+.35*abs(x['br']-.5)
 return z

engine.state=state

def run(cid):
 candles,idx,_=v109.b.base.load(); ps=v109.b.base.periods(candles)
 dm=engine.evalm(cid,candles,idx,ps['development'],NORMAL_BPS,0); vm=engine.evalm(cid,candles,idx,ps['validation'],NORMAL_BPS,0); vs=engine.evalm(cid,candles,idx,ps['validation'],STRESS_BPS,1)
 dw=engine.wave_diag(cid,candles,idx,ps['development']); vw=engine.wave_diag(cid,candles,idx,ps['validation']); df=engine.folds(cid,candles,idx,ps['development']); vf=engine.folds(cid,candles,idx,ps['validation'])
 result={'strategyId':'V122_'+cid.upper(),'pair':CANDS[cid][0],'periods':ps,'development':dm,'validation':vm,'validationStress':vs,'waveDiagnostics':{'development':dw,'validation':vw},'walkForward':{'development':df,'validation':vf},'productionChanged':False,'realTradingEnabled':False}
 promote=(dm.get('pf') or 0)>=1.20 and dm.get('returnPct',0)>0 and (vm.get('pf') or 0)>=1.20 and vm.get('returnPct',0)>0 and (vs.get('pf') or 0)>1 and vm.get('maxDDPct',-999)>-20 and vw['captureRatePct']>=20 and vf['positivePfFolds']>=2
 if not promote:result.update(status='FAIL',reason='DEV_VALIDATION_WAVE')
 else:
  cm=engine.evalm(cid,candles,idx,ps['confirmation'],NORMAL_BPS,0); cs=engine.evalm(cid,candles,idx,ps['confirmation'],STRESS_BPS,1); result.update(confirmation=cm,confirmationStress=cs)
  if (cm.get('pf') or 0)<1.2 or cm.get('returnPct',0)<=0 or (cs.get('pf') or 0)<=1:result.update(status='FAIL',reason='CONFIRMATION')
  else:
   hm=engine.evalm(cid,candles,idx,ps['holdout'],NORMAL_BPS,0); hs=engine.evalm(cid,candles,idx,ps['holdout'],STRESS_BPS,1); ym=engine.evalm(cid,candles,idx,(ps['development'][0],ps['holdout'][1]),NORMAL_BPS,0); ys=engine.evalm(cid,candles,idx,(ps['development'][0],ps['holdout'][1]),STRESS_BPS,1)
   ok=(hm.get('pf') or 0)>1 and hm.get('returnPct',0)>0 and (hs.get('pf') or 0)>1 and (ym.get('pf') or 0)>=1.2 and ym.get('returnPct',0)>0 and (ys.get('pf') or 0)>1
   result.update(holdout=hm,holdoutStress=hs,year=ym,yearStress=ys,status='PASS' if ok else 'FAIL',reason='PASS' if ok else 'FINAL')
 out=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state'));out.mkdir(parents=True,exist_ok=True);stem='active4-v122-'+cid;txt=json.dumps(result,indent=2);(out/f'{stem}.json').write_text(txt);(out/f'{stem}.md').write_text('# '+result['strategyId']+'\n\n```json\n'+txt+'\n```\n');print(txt)

if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('--candidate',choices=sorted(CANDS),required=True);run(ap.parse_args().candidate)
