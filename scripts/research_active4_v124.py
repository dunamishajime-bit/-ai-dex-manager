from __future__ import annotations
import argparse,json,math,os
from pathlib import Path
import research_active4_v115 as engine
import research_lab_pair_specific_v109 as v109

HOUR=engine.HOUR; NORMAL_BPS=engine.NORMAL_BPS; STRESS_BPS=engine.STRESS_BPS; p=engine.p; ret=engine.ret
CANDS={
 'btc_structural_reacceleration':('BTC',.56,6.4,840),
 'btc_asymmetric_trend_recovery':('BTC',.54,6.3,792),
 'eth_leadership_hold_extension':('ETH',.50,6.2,720),
 'bnb_dual_state_router':('BNB',.44,6.1,624),
 'avax_volatility_ladder':('AVAX',.40,6.5,528),
}
engine.CANDS.update(CANDS)

def mrel(candles,idx,s,ts,n):
 i=idx[s].get(ts)
 return 0.0 if i is None else (ret(candles[s],i,n) or 0.0)-p.medmove(candles,idx,ts,n)

def st(cid,candles,idx,ts):
 x=engine.feat(cid,candles,idx,ts); z={'bias':0,'prewave':0,'onset':0,'continue':0,'reentry':0,'reverse':0,'exhaust':0,'strength':0.0}
 if not x:return z
 r=x['r'];v=x['v'];s=CANDS[cid][0]; sl72=p.slope(x['c'],x['i'],72); sl168=x['sl168']; rel24=mrel(candles,idx,s,ts,24); rel72=mrel(candles,idx,s,ts,72); rel168=mrel(candles,idx,s,ts,168)
 if cid=='btc_structural_reacceleration':
  z['bias']=1 if r[336]>0 and sl168>0 and x['rp336']>.54 else -1 if r[336]<0 and sl168<0 and x['rp336']<.46 else 0
  if z['bias'] and abs(r[72])<.06 and v[48]<v[168] and x['e72']<.28:z['prewave']=z['bias']
  if z['bias']==1 and r[72]>0 and r[24]>0 and r[6]>0 and sl72>0 and x['z6']>.04:z['onset']=1
  elif z['bias']==-1 and r[72]<0 and r[24]<0 and r[6]<0 and sl72<0 and x['z6']<-.04:z['onset']=-1
  if z['bias']==1 and r[168]>0 and r[72]>0 and x['e168']>.18:z['continue']=1
  elif z['bias']==-1 and r[168]<0 and r[72]<0 and x['e168']>.18:z['continue']=-1
  if z['continue']==1 and r[24]<0 and r[6]>0 and sl168>0:z['reentry']=1
  elif z['continue']==-1 and r[24]>0 and r[6]<0 and sl168<0:z['reentry']=-1
  if sl168<0 and r[72]<0:z['reverse']=-1
  elif sl168>0 and r[72]>0:z['reverse']=1
  if x['e168']<.10 and v[24]<.72*v[168]:z['exhaust']=1 if r[168]>0 else -1
  z['strength']=abs(x['z168'])+.6*x['e168']+.3*x['e72']
 elif cid=='btc_asymmetric_trend_recovery':
  z['bias']=1 if r[168]>0 and x['rp336']>.45 else -1 if r[168]<0 and x['rp336']<.55 else 0
  if x['shock']>1.55 and abs(r[24])>.025:z['prewave']=-1 if r[24]>0 else 1
  if r[24]<-.03 and r[6]>0 and r[3]>0 and x['z3']>.05:z['onset']=1
  elif r[24]>.035 and r[6]<0 and r[3]<0 and x['z3']<-.05:z['onset']=-1
  if r[72]>0 and sl72>0 and x['e72']>.22:z['continue']=1
  elif r[72]<0 and sl72<0 and x['e72']>.22:z['continue']=-1
  if z['continue']==1 and r[12]<0 and r[3]>0:z['reentry']=1
  elif z['continue']==-1 and r[12]>0 and r[3]<0:z['reentry']=-1
  if r[24]<-.045 and sl72<0:z['reverse']=-1
  elif r[24]>.045 and sl72>0:z['reverse']=1
  if x['shock']<.75 and x['e72']<.08:z['exhaust']=1 if r[72]>0 else -1
  z['strength']=abs(r[72])/(v[168]*math.sqrt(72)+1e-9)+.45*x['e72']+.25*x['shock']
 elif cid=='eth_leadership_hold_extension':
  bi=idx['BTC'].get(ts)
  if bi is None:return z
  btc=candles['BTC']; q={n:r[n]-(ret(btc,bi,n) or 0.0) for n in (3,6,12,24,72,168)}
  z['bias']=1 if q[168]>.015 and q[72]>-.005 else -1 if q[168]<-.015 and q[72]<.005 else 0
  if z['bias'] and q[24]*z['bias']<0 and x['e72']<.30:z['prewave']=z['bias']
  if z['bias']==1 and q[6]>0 and q[24]>-.01 and r[6]>0 and sl72>=0:z['onset']=1
  elif z['bias']==-1 and q[6]<0 and q[24]<.01 and r[6]<0 and sl72<=0:z['onset']=-1
  if q[168]>.02 and q[72]>0 and r[72]>0:z['continue']=1
  elif q[168]<-.02 and q[72]<0 and r[72]<0:z['continue']=-1
  if z['continue']==1 and q[12]<0 and q[3]>0:z['reentry']=1
  elif z['continue']==-1 and q[12]>0 and q[3]<0:z['reentry']=-1
  if q[72]<-.025 and q[24]<0:z['reverse']=-1
  elif q[72]>.025 and q[24]>0:z['reverse']=1
  if abs(q[72])<.006 and x['e72']<.08:z['exhaust']=1 if q[168]>0 else -1
  z['strength']=abs(q[168])/(v[168]*math.sqrt(168)+1e-9)+.55*abs(q[72])/(v[168]*math.sqrt(72)+1e-9)+.3*x['e72']
 elif cid=='bnb_dual_state_router':
  trending=x['e168']>.26 and abs(rel168)>.018; ranging=x['e168']<.16 and abs(rel168)<.025
  z['bias']=1 if rel168>0 else -1 if rel168<0 else 0
  if ranging and v[48]<.9*v[168]:z['prewave']=z['bias'] or (1 if r[24]>=0 else -1)
  if trending and rel24>.018 and r[6]>0 and sl72>0:z['onset']=1
  elif trending and rel24<-.018 and r[6]<0 and sl72<0:z['onset']=-1
  elif ranging and x['rp168']<.18 and r[3]>0:z['onset']=1
  elif ranging and x['rp168']>.82 and r[3]<0:z['onset']=-1
  if trending and rel72>.025 and r[72]>0:z['continue']=1
  elif trending and rel72<-.025 and r[72]<0:z['continue']=-1
  if z['continue']==1 and r[12]<0 and r[3]>0:z['reentry']=1
  elif z['continue']==-1 and r[12]>0 and r[3]<0:z['reentry']=-1
  if rel72<-.035 and sl72<0:z['reverse']=-1
  elif rel72>.035 and sl72>0:z['reverse']=1
  if not trending and not ranging:z['exhaust']=1 if r[72]>0 else -1
  z['strength']=.55*abs(rel72)/(v[168]*math.sqrt(72)+1e-9)+.45*abs(x['rp168']-.5)+.25*x['e168']
 else:
  breadth=x['br']; z['bias']=1 if rel168>.015 and breadth>.43 else -1 if rel168<-.015 and breadth<.57 else 0
  if z['bias'] and v[48]<1.0*v[168]:z['prewave']=z['bias']
  impulse=abs(r[6])/(v[168]*math.sqrt(6)+1e-9)
  if breadth>.55 and rel24>.02 and r[6]>0 and impulse>.7:z['onset']=1
  elif breadth<.45 and rel24<-.02 and r[6]<0 and impulse>.7:z['onset']=-1
  if rel72>.03 and r[72]>0 and breadth>.50:z['continue']=1
  elif rel72<-.03 and r[72]<0 and breadth<.50:z['continue']=-1
  if z['continue']==1 and r[12]<0 and r[3]>0 and v[24]<1.7*v[168]:z['reentry']=1
  elif z['continue']==-1 and r[12]>0 and r[3]<0 and v[24]<1.7*v[168]:z['reentry']=-1
  if breadth<.38 and rel24<-.04:z['reverse']=-1
  elif breadth>.62 and rel24>.04:z['reverse']=1
  if x['shock']>2.4 or (x['e72']<.08 and v[24]<.75*v[168]):z['exhaust']=1 if r[24]>0 else -1
  z['strength']=abs(rel72)/(v[168]*math.sqrt(72)+1e-9)+.5*abs(breadth-.5)+.35*impulse
 return z

engine.state=st

def run(cid):
 candles,idx,_=v109.b.base.load(); ps=v109.b.base.periods(candles)
 dm=engine.evalm(cid,candles,idx,ps['development'],NORMAL_BPS,0); vm=engine.evalm(cid,candles,idx,ps['validation'],NORMAL_BPS,0); vs=engine.evalm(cid,candles,idx,ps['validation'],STRESS_BPS,1)
 dw=engine.wave_diag(cid,candles,idx,ps['development']); vw=engine.wave_diag(cid,candles,idx,ps['validation']); df=engine.folds(cid,candles,idx,ps['development']); vf=engine.folds(cid,candles,idx,ps['validation'])
 result={'strategyId':'V124_'+cid.upper(),'pair':CANDS[cid][0],'periods':ps,'development':dm,'validation':vm,'validationStress':vs,'waveDiagnostics':{'development':dw,'validation':vw},'walkForward':{'development':df,'validation':vf},'productionChanged':False,'realTradingEnabled':False}
 promote=(dm.get('pf') or 0)>=1.20 and dm.get('returnPct',0)>0 and (vm.get('pf') or 0)>=1.20 and vm.get('returnPct',0)>0 and (vs.get('pf') or 0)>1 and vm.get('maxDDPct',-999)>-20 and vw['captureRatePct']>=20 and vf['positivePfFolds']>=2
 if not promote:result.update(status='FAIL',reason='DEV_VALIDATION_WAVE')
 else:
  cm=engine.evalm(cid,candles,idx,ps['confirmation'],NORMAL_BPS,0); cs=engine.evalm(cid,candles,idx,ps['confirmation'],STRESS_BPS,1); result.update(confirmation=cm,confirmationStress=cs)
  if (cm.get('pf') or 0)<1.2 or cm.get('returnPct',0)<=0 or (cs.get('pf') or 0)<=1:result.update(status='FAIL',reason='CONFIRMATION')
  else:
   hm=engine.evalm(cid,candles,idx,ps['holdout'],NORMAL_BPS,0); hs=engine.evalm(cid,candles,idx,ps['holdout'],STRESS_BPS,1); ym=engine.evalm(cid,candles,idx,(ps['development'][0],ps['holdout'][1]),NORMAL_BPS,0); ys=engine.evalm(cid,candles,idx,(ps['development'][0],ps['holdout'][1]),STRESS_BPS,1)
   ok=(hm.get('pf') or 0)>1 and hm.get('returnPct',0)>0 and (hs.get('pf') or 0)>1 and (ym.get('pf') or 0)>=1.2 and ym.get('returnPct',0)>0 and (ys.get('pf') or 0)>1
   result.update(holdout=hm,holdoutStress=hs,year=ym,yearStress=ys,status='PASS' if ok else 'FAIL',reason='PASS' if ok else 'FINAL')
 out=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state'));out.mkdir(parents=True,exist_ok=True);stem='active4-v124-'+cid;txt=json.dumps(result,indent=2);(out/f'{stem}.json').write_text(txt);(out/f'{stem}.md').write_text('# '+result['strategyId']+'\n\n```json\n'+txt+'\n```\n');print(txt)

if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('--candidate',choices=sorted(CANDS),required=True);run(ap.parse_args().candidate)
