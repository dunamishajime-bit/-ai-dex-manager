from __future__ import annotations
import argparse,json,math,os
from pathlib import Path
import research_active4_v115 as engine
import research_lab_pair_specific_v109 as v109

HOUR=engine.HOUR; NORMAL_BPS=engine.NORMAL_BPS; STRESS_BPS=engine.STRESS_BPS; p=engine.p; ret=engine.ret
CANDS={
 'btc_regime_breakout_hold':('BTC',.55,7.0,912),
 'btc_exhaustion_recovery':('BTC',.52,6.0,624),
 'eth_dual_beta_leadership':('ETH',.49,6.6,744),
 'bnb_range_trend_switch':('BNB',.43,5.8,600),
 'avax_shock_persistence_router':('AVAX',.39,6.8,552),
}
engine.CANDS.update(CANDS)

def rel(candles,idx,s,ts,n):
 i=idx[s].get(ts)
 return 0.0 if i is None else (ret(candles[s],i,n) or 0.0)-p.medmove(candles,idx,ts,n)

def state(cid,candles,idx,ts):
 x=engine.feat(cid,candles,idx,ts); z={'bias':0,'prewave':0,'onset':0,'continue':0,'reentry':0,'reverse':0,'exhaust':0,'strength':0.0}
 if not x:return z
 r=x['r']; v=x['v']; c=x['c']; i=x['i']; s=CANDS[cid][0]; sl72=p.slope(c,i,72); sl168=x['sl168']; rr24=rel(candles,idx,s,ts,24); rr72=rel(candles,idx,s,ts,72); rr168=rel(candles,idx,s,ts,168)
 if cid=='btc_regime_breakout_hold':
  z['bias']=1 if r[336]>0 and sl168>0 and x['rp336']>.52 else -1 if r[336]<0 and sl168<0 and x['rp336']<.48 else 0
  compressed=v[48]<.82*v[168] and x['e72']<.24
  if compressed and z['bias']:z['prewave']=z['bias']
  up=x['px']>x['hi120'] and r[6]>0 and x['volumeRatio']>.85 and x['z6']>.08
  dn=x['px']<x['lo120'] and r[6]<0 and x['volumeRatio']>.85 and x['z6']<-.08
  if z['bias']==1 and up:z['onset']=1
  elif z['bias']==-1 and dn:z['onset']=-1
  if z['bias']==1 and r[168]>0 and r[72]>0 and sl72>0 and x['e168']>.20:z['continue']=1
  elif z['bias']==-1 and r[168]<0 and r[72]<0 and sl72<0 and x['e168']>.20:z['continue']=-1
  if z['continue']==1 and r[24]<0 and r[3]>0 and x['rp72']>.35:z['reentry']=1
  elif z['continue']==-1 and r[24]>0 and r[3]<0 and x['rp72']<.65:z['reentry']=-1
  if r[72]<0 and sl168<0:z['reverse']=-1
  elif r[72]>0 and sl168>0:z['reverse']=1
  if x['e168']<.09 and v[24]<.70*v[168]:z['exhaust']=1 if r[168]>0 else -1
  z['strength']=abs(x['z168'])+.7*x['e168']+.25*abs(x['z72'])
 elif cid=='btc_exhaustion_recovery':
  breadth=x['br']; shock=x['shock']; z['bias']=1 if x['rp336']>.42 else -1 if x['rp336']<.58 else 0
  panic=shock>1.45 and x['rp168']<.18 and r[24]<-.025
  euph=shock>1.45 and x['rp168']>.82 and r[24]>.025
  if panic:z['prewave']=1
  elif euph:z['prewave']=-1
  if panic and r[3]>0 and r[6]>0 and breadth>.32:z['onset']=1
  elif euph and r[3]<0 and r[6]<0 and breadth<.68:z['onset']=-1
  if r[72]>0 and sl72>0 and x['rp168']>.35 and breadth>.42:z['continue']=1
  elif r[72]<0 and sl72<0 and x['rp168']<.65 and breadth<.58:z['continue']=-1
  if z['continue']==1 and r[12]<0 and r[3]>0 and shock<1.5:z['reentry']=1
  elif z['continue']==-1 and r[12]>0 and r[3]<0 and shock<1.5:z['reentry']=-1
  if r[24]<-.035 and sl72<0:z['reverse']=-1
  elif r[24]>.035 and sl72>0:z['reverse']=1
  if shock<.72 and x['e72']<.08:z['exhaust']=1 if r[72]>0 else -1
  z['strength']=.55*abs(x['z72'])+.45*abs(breadth-.5)+.35*shock
 elif cid=='eth_dual_beta_leadership':
  bi=idx['BTC'].get(ts)
  if bi is None:return z
  btc=candles['BTC']; q={n:r[n]-(ret(btc,bi,n) or 0.0) for n in (3,6,12,24,72,168)}; breadth=x['br']
  z['bias']=1 if q[168]>.012 and breadth>.42 else -1 if q[168]<-.012 and breadth<.58 else 0
  if z['bias'] and abs(q[24])<.02 and v[48]<.95*v[168]:z['prewave']=z['bias']
  accel=q[6]-.35*q[24]
  if z['bias']==1 and accel>.008 and r[6]>0 and breadth>.48:z['onset']=1
  elif z['bias']==-1 and accel<-.008 and r[6]<0 and breadth<.52:z['onset']=-1
  if q[72]>.02 and q[168]>0 and r[72]>0:z['continue']=1
  elif q[72]<-.02 and q[168]<0 and r[72]<0:z['continue']=-1
  if z['continue']==1 and q[12]<0 and q[3]>0:z['reentry']=1
  elif z['continue']==-1 and q[12]>0 and q[3]<0:z['reentry']=-1
  if q[72]<-.02 and q[24]<0:z['reverse']=-1
  elif q[72]>.02 and q[24]>0:z['reverse']=1
  if abs(q[72])<.005 and x['e72']<.07:z['exhaust']=1 if q[168]>0 else -1
  z['strength']=abs(q[168])/(v[168]*math.sqrt(168)+1e-9)+.65*abs(q[72])/(v[168]*math.sqrt(72)+1e-9)+.3*abs(breadth-.5)
 elif cid=='bnb_range_trend_switch':
  trend=x['e168']>.24 and abs(rr168)>.015; rang=x['e168']<.14 and v[48]<.9*v[168]
  z['bias']=1 if rr168>.0 else -1 if rr168<0 else 0
  if rang:z['prewave']=z['bias'] or (1 if r[24]>=0 else -1)
  if trend and rr24>.015 and r[6]>0 and sl72>0:z['onset']=1
  elif trend and rr24<-.015 and r[6]<0 and sl72<0:z['onset']=-1
  elif rang and x['rp168']<.15 and r[3]>0:z['onset']=1
  elif rang and x['rp168']>.85 and r[3]<0:z['onset']=-1
  if trend and rr72>.02 and r[72]>0:z['continue']=1
  elif trend and rr72<-.02 and r[72]<0:z['continue']=-1
  if z['continue']==1 and r[12]<0 and r[3]>0:z['reentry']=1
  elif z['continue']==-1 and r[12]>0 and r[3]<0:z['reentry']=-1
  if rr72<-.03 and sl72<0:z['reverse']=-1
  elif rr72>.03 and sl72>0:z['reverse']=1
  if not trend and not rang:z['exhaust']=1 if r[72]>0 else -1
  z['strength']=.6*abs(rr72)/(v[168]*math.sqrt(72)+1e-9)+.35*x['e168']+.25*abs(x['rp168']-.5)
 else:
  breadth=x['br']; shock=x['shock']; z['bias']=1 if rr168>.012 and breadth>.40 else -1 if rr168<-.012 and breadth<.60 else 0
  if shock<.9 and z['bias']:z['prewave']=z['bias']
  impulse=abs(r[6])/(v[168]*math.sqrt(6)+1e-9)
  if shock>1.15 and rr24>.018 and r[6]>0 and breadth>.52:z['onset']=1
  elif shock>1.15 and rr24<-.018 and r[6]<0 and breadth<.48:z['onset']=-1
  if rr72>.025 and r[72]>0 and breadth>.48 and x['e72']>.15:z['continue']=1
  elif rr72<-.025 and r[72]<0 and breadth<.52 and x['e72']>.15:z['continue']=-1
  if z['continue']==1 and r[12]<0 and r[3]>0 and shock<1.8:z['reentry']=1
  elif z['continue']==-1 and r[12]>0 and r[3]<0 and shock<1.8:z['reentry']=-1
  if breadth<.35 and rr24<-.035:z['reverse']=-1
  elif breadth>.65 and rr24>.035:z['reverse']=1
  if shock>2.3 or (x['e72']<.07 and v[24]<.72*v[168]):z['exhaust']=1 if r[24]>0 else -1
  z['strength']=abs(rr72)/(v[168]*math.sqrt(72)+1e-9)+.55*abs(breadth-.5)+.3*impulse
 return z

engine.state=state

def run(cid):
 candles,idx,_=v109.b.base.load(); ps=v109.b.base.periods(candles)
 dm=engine.evalm(cid,candles,idx,ps['development'],NORMAL_BPS,0); vm=engine.evalm(cid,candles,idx,ps['validation'],NORMAL_BPS,0); vs=engine.evalm(cid,candles,idx,ps['validation'],STRESS_BPS,1)
 dw=engine.wave_diag(cid,candles,idx,ps['development']); vw=engine.wave_diag(cid,candles,idx,ps['validation']); df=engine.folds(cid,candles,idx,ps['development']); vf=engine.folds(cid,candles,idx,ps['validation'])
 result={'strategyId':'V125_'+cid.upper(),'pair':CANDS[cid][0],'periods':ps,'development':dm,'validation':vm,'validationStress':vs,'waveDiagnostics':{'development':dw,'validation':vw},'walkForward':{'development':df,'validation':vf},'productionChanged':False,'realTradingEnabled':False}
 promote=(dm.get('pf') or 0)>=1.20 and dm.get('returnPct',0)>0 and (vm.get('pf') or 0)>=1.20 and vm.get('returnPct',0)>0 and (vs.get('pf') or 0)>1 and vm.get('maxDDPct',-999)>-20 and vw['captureRatePct']>=20 and vf['positivePfFolds']>=2
 if not promote:result.update(status='FAIL',reason='DEV_VALIDATION_WAVE')
 else:
  cm=engine.evalm(cid,candles,idx,ps['confirmation'],NORMAL_BPS,0); cs=engine.evalm(cid,candles,idx,ps['confirmation'],STRESS_BPS,1); result.update(confirmation=cm,confirmationStress=cs)
  if (cm.get('pf') or 0)<1.2 or cm.get('returnPct',0)<=0 or (cs.get('pf') or 0)<=1:result.update(status='FAIL',reason='CONFIRMATION')
  else:
   hm=engine.evalm(cid,candles,idx,ps['holdout'],NORMAL_BPS,0); hs=engine.evalm(cid,candles,idx,ps['holdout'],STRESS_BPS,1); ym=engine.evalm(cid,candles,idx,(ps['development'][0],ps['holdout'][1]),NORMAL_BPS,0); ys=engine.evalm(cid,candles,idx,(ps['development'][0],ps['holdout'][1]),STRESS_BPS,1)
   ok=(hm.get('pf') or 0)>1 and hm.get('returnPct',0)>0 and (hs.get('pf') or 0)>1 and (ym.get('pf') or 0)>=1.2 and ym.get('returnPct',0)>0 and (ys.get('pf') or 0)>1
   result.update(holdout=hm,holdoutStress=hs,year=ym,yearStress=ys,status='PASS' if ok else 'FAIL',reason='PASS' if ok else 'FINAL')
 out=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state'));out.mkdir(parents=True,exist_ok=True);stem='active4-v125-'+cid;txt=json.dumps(result,indent=2);(out/f'{stem}.json').write_text(txt);(out/f'{stem}.md').write_text('# '+result['strategyId']+'\n\n```json\n'+txt+'\n```\n');print(txt)

if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('--candidate',choices=sorted(CANDS),required=True);run(ap.parse_args().candidate)
