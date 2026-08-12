from __future__ import annotations
import argparse,json,math,os
from pathlib import Path
import research_active4_v115 as engine
import research_lab_pair_specific_v109 as v109

HOUR=engine.HOUR; NORMAL_BPS=engine.NORMAL_BPS; STRESS_BPS=engine.STRESS_BPS; p=engine.p; ret=engine.ret
CANDS={
 'btc_market_lead_rotation':('BTC',.55,6.2,720),
 'btc_volatility_reclaim':('BTC',.54,6.6,768),
 'eth_relative_reclaim':('ETH',.51,6.0,600),
 'bnb_regime_acceptance':('BNB',.45,6.0,576),
 'avax_breadth_confirmed_burst':('AVAX',.39,6.8,456),
}
engine.CANDS.update(CANDS)

def market_rel(candles,idx,s,ts,n):
 i=idx[s].get(ts)
 if i is None:return 0.0
 return (ret(candles[s],i,n) or 0.0)-p.medmove(candles,idx,ts,n)

def state(cid,candles,idx,ts):
 x=engine.feat(cid,candles,idx,ts); z={'bias':0,'prewave':0,'onset':0,'continue':0,'reentry':0,'reverse':0,'exhaust':0,'strength':0.0}
 if not x:return z
 r=x['r']; v=x['v']; s=CANDS[cid][0]
 rel24=market_rel(candles,idx,s,ts,24); rel72=market_rel(candles,idx,s,ts,72); rel168=market_rel(candles,idx,s,ts,168)
 sl72=p.slope(x['c'],x['i'],72)
 if cid=='btc_market_lead_rotation':
  z['bias']=1 if rel168>.02 and r[168]>0 and x['rp336']>.50 else -1 if rel168<-.02 and r[168]<0 and x['rp336']<.50 else 0
  if z['bias'] and v[48]<.9*v[168] and x['e72']<.24:z['prewave']=z['bias']
  if rel24>.018 and rel72>0 and r[6]>0 and x['z6']>.05 and sl72>=0:z['onset']=1
  elif rel24<-.018 and rel72<0 and r[6]<0 and x['z6']<-.05 and sl72<=0:z['onset']=-1
  if rel72>.028 and r[72]>0 and sl72>0 and x['e72']>.20:z['continue']=1
  elif rel72<-.028 and r[72]<0 and sl72<0 and x['e72']>.20:z['continue']=-1
  if z['continue']==1 and r[12]<0 and r[3]>0 and rel24>-0.01:z['reentry']=1
  elif z['continue']==-1 and r[12]>0 and r[3]<0 and rel24<0.01:z['reentry']=-1
  if rel72<-.035 and sl72<0:z['reverse']=-1
  elif rel72>.035 and sl72>0:z['reverse']=1
  if x['shock']>2.0 and x['e24']<.09:z['exhaust']=1 if r[24]>0 else -1
  z['strength']=abs(rel72)/(v[168]*math.sqrt(72)+1e-9)+.5*x['e72']+.25*abs(rel168)/(v[168]*math.sqrt(168)+1e-9)
 elif cid=='btc_volatility_reclaim':
  z['bias']=1 if r[336]>0 and x['sl168']>0 and x['rp336']>.52 else -1 if r[336]<0 and x['sl168']<0 and x['rp336']<.48 else 0
  pullback=(z['bias']==1 and r[24]<0) or (z['bias']==-1 and r[24]>0)
  if z['bias'] and pullback and v[24]>=.85*v[168] and x['shock']>1.05:z['prewave']=z['bias']
  if z['bias']==1 and r[24]<0 and r[6]>0 and x['z3']>.06 and sl72>0:z['onset']=1
  elif z['bias']==-1 and r[24]>0 and r[6]<0 and x['z3']<-.06 and sl72<0:z['onset']=-1
  if z['bias']==1 and r[72]>0 and x['sl168']>0 and x['e72']>.18:z['continue']=1
  elif z['bias']==-1 and r[72]<0 and x['sl168']<0 and x['e72']>.18:z['continue']=-1
  if z['continue']==1 and r[12]<0 and r[3]>0 and x['rp168']>.48:z['reentry']=1
  elif z['continue']==-1 and r[12]>0 and r[3]<0 and x['rp168']<.52:z['reentry']=-1
  if x['sl168']<0 and r[72]<0 and x['rp168']<.44:z['reverse']=-1
  elif x['sl168']>0 and r[72]>0 and x['rp168']>.56:z['reverse']=1
  if abs(r[24])<.01 and x['e72']<.09 and v[24]<.75*v[168]:z['exhaust']=1 if r[168]>0 else -1
  z['strength']=abs(x['z168'])+.45*x['e168']+.35*x['e72']
 elif cid=='eth_relative_reclaim':
  bi=idx['BTC'].get(ts)
  if bi is None or bi<336:return z
  btc=candles['BTC']; rb={n:(ret(btc,bi,n) or 0.0) for n in (3,6,12,24,72,168)}
  q={n:r[n]-rb[n] for n in (3,6,12,24,72,168)}
  z['bias']=1 if q[168]>.02 and q[72]>0 else -1 if q[168]<-.02 and q[72]<0 else 0
  if z['bias'] and q[24]*z['bias']<0 and v[24]<1.1*v[168]:z['prewave']=z['bias']
  if z['bias']==1 and q[24]<0 and q[6]>0 and q[3]>0 and r[6]>0:z['onset']=1
  elif z['bias']==-1 and q[24]>0 and q[6]<0 and q[3]<0 and r[6]<0:z['onset']=-1
  if q[72]>.035 and r[72]>0 and sl72>0 and x['e72']>.18:z['continue']=1
  elif q[72]<-.035 and r[72]<0 and sl72<0 and x['e72']>.18:z['continue']=-1
  if z['continue']==1 and q[12]<0 and q[3]>0:z['reentry']=1
  elif z['continue']==-1 and q[12]>0 and q[3]<0:z['reentry']=-1
  if q[24]<-.05 and q[72]<0:z['reverse']=-1
  elif q[24]>.05 and q[72]>0:z['reverse']=1
  if x['shock']>2.0 and q[6]*q[24]<0:z['exhaust']=1 if q[24]>0 else -1
  z['strength']=abs(q[72])/(v[168]*math.sqrt(72)+1e-9)+.5*x['e72']+.25*abs(q[168])/(v[168]*math.sqrt(168)+1e-9)
 elif cid=='bnb_regime_acceptance':
  trend=1 if rel168>.02 and x['rp336']>.52 else -1 if rel168<-.02 and x['rp336']<.48 else 0
  z['bias']=trend
  compression=v[48]<.86*v[168] and x['e72']<.23
  if compression and trend:z['prewave']=trend
  accepted_up=rel24>.02 and rel72>.02 and r[24]>0 and x['rp72']>.60 and sl72>0
  accepted_dn=rel24<-.02 and rel72<-.02 and r[24]<0 and x['rp72']<.40 and sl72<0
  if trend==1 and accepted_up and x['volumeRatio']>.75:z['onset']=1
  elif trend==-1 and accepted_dn and x['volumeRatio']>.75:z['onset']=-1
  if rel72>.035 and r[72]>0 and sl72>0 and x['rp168']>.55:z['continue']=1
  elif rel72<-.035 and r[72]<0 and sl72<0 and x['rp168']<.45:z['continue']=-1
  if z['continue']==1 and r[12]<0 and r[3]>0 and rel24>0:z['reentry']=1
  elif z['continue']==-1 and r[12]>0 and r[3]<0 and rel24<0:z['reentry']=-1
  if rel72<-.04 and r[24]<0 and sl72<0:z['reverse']=-1
  elif rel72>.04 and r[24]>0 and sl72>0:z['reverse']=1
  if abs(rel72)<.008 and x['e72']<.10 and v[24]<.8*v[168]:z['exhaust']=1 if r[168]>0 else -1
  z['strength']=abs(rel72)/(v[168]*math.sqrt(72)+1e-9)+.55*x['e72']+.25*abs(rel168)/(v[168]*math.sqrt(168)+1e-9)
 else:
  med24=p.medmove(candles,idx,ts,24); breadth=x['br']
  z['bias']=1 if rel168>.025 and breadth>.44 else -1 if rel168<-.025 and breadth<.56 else 0
  if z['bias'] and v[48]<.9*v[168] and x['e72']<.25:z['prewave']=z['bias']
  breadth_up=breadth>=.58 and med24>0; breadth_dn=breadth<=.42 and med24<0
  if z['bias']==1 and breadth_up and rel24>.03 and r[6]>0 and x['z6']>.06:z['onset']=1
  elif z['bias']==-1 and breadth_dn and rel24<-.03 and r[6]<0 and x['z6']<-.06:z['onset']=-1
  if rel72>.045 and r[72]>0 and breadth>.52 and sl72>0 and x['e72']>.19:z['continue']=1
  elif rel72<-.045 and r[72]<0 and breadth<.48 and sl72<0 and x['e72']>.19:z['continue']=-1
  if z['continue']==1 and r[12]<0 and r[3]>0 and breadth>.48:z['reentry']=1
  elif z['continue']==-1 and r[12]>0 and r[3]<0 and breadth<.52:z['reentry']=-1
  if rel24<-.06 and breadth<.40:z['reverse']=-1
  elif rel24>.06 and breadth>.60:z['reverse']=1
  if x['shock']>2.25 and x['e24']<.09:z['exhaust']=1 if r[24]>0 else -1
  z['strength']=abs(rel72)/(v[168]*math.sqrt(72)+1e-9)+.45*x['e72']+.35*abs(breadth-.5)
 return z

engine.state=state

def run(cid):
 candles,idx,_=v109.b.base.load(); ps=v109.b.base.periods(candles)
 dm=engine.evalm(cid,candles,idx,ps['development'],NORMAL_BPS,0); vm=engine.evalm(cid,candles,idx,ps['validation'],NORMAL_BPS,0); vs=engine.evalm(cid,candles,idx,ps['validation'],STRESS_BPS,1)
 dw=engine.wave_diag(cid,candles,idx,ps['development']); vw=engine.wave_diag(cid,candles,idx,ps['validation']); df=engine.folds(cid,candles,idx,ps['development']); vf=engine.folds(cid,candles,idx,ps['validation'])
 result={'strategyId':'V123_'+cid.upper(),'pair':CANDS[cid][0],'periods':ps,'development':dm,'validation':vm,'validationStress':vs,'waveDiagnostics':{'development':dw,'validation':vw},'walkForward':{'development':df,'validation':vf},'productionChanged':False,'realTradingEnabled':False}
 promote=(dm.get('pf') or 0)>=1.20 and dm.get('returnPct',0)>0 and (vm.get('pf') or 0)>=1.20 and vm.get('returnPct',0)>0 and (vs.get('pf') or 0)>1 and vm.get('maxDDPct',-999)>-20 and vw['captureRatePct']>=20 and vf['positivePfFolds']>=2
 if not promote:result.update(status='FAIL',reason='DEV_VALIDATION_WAVE')
 else:
  cm=engine.evalm(cid,candles,idx,ps['confirmation'],NORMAL_BPS,0); cs=engine.evalm(cid,candles,idx,ps['confirmation'],STRESS_BPS,1); result.update(confirmation=cm,confirmationStress=cs)
  if (cm.get('pf') or 0)<1.2 or cm.get('returnPct',0)<=0 or (cs.get('pf') or 0)<=1:result.update(status='FAIL',reason='CONFIRMATION')
  else:
   hm=engine.evalm(cid,candles,idx,ps['holdout'],NORMAL_BPS,0); hs=engine.evalm(cid,candles,idx,ps['holdout'],STRESS_BPS,1); ym=engine.evalm(cid,candles,idx,(ps['development'][0],ps['holdout'][1]),NORMAL_BPS,0); ys=engine.evalm(cid,candles,idx,(ps['development'][0],ps['holdout'][1]),STRESS_BPS,1)
   ok=(hm.get('pf') or 0)>1 and hm.get('returnPct',0)>0 and (hs.get('pf') or 0)>1 and (ym.get('pf') or 0)>=1.2 and ym.get('returnPct',0)>0 and (ys.get('pf') or 0)>1
   result.update(holdout=hm,holdoutStress=hs,year=ym,yearStress=ys,status='PASS' if ok else 'FAIL',reason='PASS' if ok else 'FINAL')
 out=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state'));out.mkdir(parents=True,exist_ok=True);stem='active4-v123-'+cid;txt=json.dumps(result,indent=2);(out/f'{stem}.json').write_text(txt);(out/f'{stem}.md').write_text('# '+result['strategyId']+'\n\n```json\n'+txt+'\n```\n');print(txt)

if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('--candidate',choices=sorted(CANDS),required=True);run(ap.parse_args().candidate)
