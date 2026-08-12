from __future__ import annotations
import argparse,json,math,os
from pathlib import Path
import research_active4_v115 as engine
import research_lab_pair_specific_v109 as v109

HOUR=engine.HOUR; NORMAL_BPS=engine.NORMAL_BPS; STRESS_BPS=engine.STRESS_BPS; p=engine.p; ret=engine.ret
CANDS={
 'btc_macro_pullback':('BTC',.58,6.2,720),
 'btc_capitulation_reclaim':('BTC',.52,6.8,360),
 'eth_beta_reaccel':('ETH',.54,6.5,528),
 'bnb_breakout_acceptance':('BNB',.47,6.1,456),
 'avax_residual_recovery':('AVAX',.42,7.2,384),
}
engine.CANDS.update(CANDS)

def state(cid,candles,idx,ts):
 x=engine.feat(cid,candles,idx,ts); z={'bias':0,'prewave':0,'onset':0,'continue':0,'reentry':0,'reverse':0,'exhaust':0,'strength':0.0}
 if not x:return z
 r=x['r']; v=x['v']; px=x['px']
 if cid=='btc_macro_pullback':
  macro_up=r[336]>0 and x['sl168']>0 and x['rp336']>.55
  macro_dn=r[336]<0 and x['sl168']<0 and x['rp336']<.45
  z['bias']=1 if macro_up else -1 if macro_dn else 0
  if z['bias'] and x['e168']>.20 and v[24]<1.35*v[168]:z['prewave']=z['bias']
  if z['bias']==1 and r[72]>0 and r[24]<0 and r[6]>0 and x['rp72']>.35 and x['z6']>.06:z['onset']=1
  elif z['bias']==-1 and r[72]<0 and r[24]>0 and r[6]<0 and x['rp72']<.65 and x['z6']<-.06:z['onset']=-1
  sl72=p.slope(x['c'],x['i'],72)
  if z['bias']==1 and r[168]>0 and r[72]>0 and sl72>0 and x['e168']>.22:z['continue']=1
  elif z['bias']==-1 and r[168]<0 and r[72]<0 and sl72<0 and x['e168']>.22:z['continue']=-1
  if z['continue']==1 and r[24]<0 and r[3]>0 and x['rp168']>.45:z['reentry']=1
  elif z['continue']==-1 and r[24]>0 and r[3]<0 and x['rp168']<.55:z['reentry']=-1
  if z['bias']==1 and r[72]<0 and sl72<0:z['reverse']=-1
  elif z['bias']==-1 and r[72]>0 and sl72>0:z['reverse']=1
  if x['shock']>2.4 and x['e24']<.08:z['exhaust']=1 if r[24]>0 else -1
  z['strength']=abs(x['z168'])+.65*x['e168']+.25*abs(x['z72'])
 elif cid=='btc_capitulation_reclaim':
  draw=r[72]; shock=x['shock']; rp=x['rp168']
  z['bias']=1 if r[336]>0 else -1 if r[336]<0 else 0
  if shock>1.45 and ((draw<0 and rp<.18) or (draw>0 and rp>.82)):z['prewave']=-1 if draw>0 else 1
  if draw<0 and shock>1.55 and r[12]<0 and r[3]>0 and x['e24']<.20:z['onset']=1
  elif draw>0 and shock>1.55 and r[12]>0 and r[3]<0 and x['e24']<.20:z['onset']=-1
  if r[24]>0 and r[6]>0 and x['rp72']>.52 and shock<1.65:z['continue']=1
  elif r[24]<0 and r[6]<0 and x['rp72']<.48 and shock<1.65:z['continue']=-1
  if z['continue']==1 and r[6]<0 and r[3]>0:z['reentry']=1
  elif z['continue']==-1 and r[6]>0 and r[3]<0:z['reentry']=-1
  if r[24]*r[6]<0 and abs(x['z6'])>.10:z['reverse']=1 if r[6]>0 else -1
  if shock<.75 and x['e24']<.05:z['exhaust']=1 if r[24]>0 else -1
  z['strength']=shock+.55*abs(x['z24'])+.25*(1-x['e24'])
 elif cid=='eth_beta_reaccel':
  bi=idx['BTC'].get(ts)
  if bi is None or bi<336:return z
  btc=candles['BTC']; rb={n:(ret(btc,bi,n) or 0.0) for n in (6,12,24,72,168,336)}
  beta72=(r[72]/(rb[72] if abs(rb[72])>.02 else (.02 if rb[72]>=0 else -.02)))
  rel24=r[24]-1.15*rb[24]; rel72=r[72]-1.15*rb[72]; rel168=r[168]-1.05*rb[168]
  z['bias']=1 if rel168>0 and r[168]>0 else -1 if rel168<0 and r[168]<0 else 0
  if abs(rel72)<.10 and v[24]<1.05*v[168]:z['prewave']=z['bias'] or (1 if rel168>=0 else -1)
  if rel72>0 and rel24>.04 and r[6]>0 and x['z6']>.08 and beta72>.8:z['onset']=1
  elif rel72<0 and rel24<-.04 and r[6]<0 and x['z6']<-.08 and beta72>.8:z['onset']=-1
  if rel72>.06 and rel24>0 and r[72]>0 and x['e72']>.20:z['continue']=1
  elif rel72<-.06 and rel24<0 and r[72]<0 and x['e72']>.20:z['continue']=-1
  if z['continue']==1 and r[12]<0 and rel24>0 and r[3]>0:z['reentry']=1
  elif z['continue']==-1 and r[12]>0 and rel24<0 and r[3]<0:z['reentry']=-1
  if rel24<-.10 and r[6]<0:z['reverse']=-1
  elif rel24>.10 and r[6]>0:z['reverse']=1
  if x['shock']>2.2 and rel24*r[6]<0:z['exhaust']=1 if rel24>0 else -1
  z['strength']=abs(rel72)/(v[168]*math.sqrt(72)+1e-9)+.55*x['e72']+.20*abs(rel24)/(v[168]*math.sqrt(24)+1e-9)
 elif cid=='bnb_breakout_acceptance':
  m72=p.medmove(candles,idx,ts,72); rel72=r[72]-m72
  z['bias']=1 if rel72>0 and x['rp336']>.50 else -1 if rel72<0 and x['rp336']<.50 else 0
  compressed=v[48]<.90*v[168] and x['e72']<.24
  if compressed:z['prewave']=z['bias'] or (1 if r[72]>=0 else -1)
  accept_up=px>x['hi120'] and r[12]>0 and r[24]>0 and x['e24']>.20
  accept_dn=px<x['lo120'] and r[12]<0 and r[24]<0 and x['e24']>.20
  if accept_up:z['onset']=1
  elif accept_dn:z['onset']=-1
  if r[72]>0 and x['rp72']>.65 and x['sl48']>0 and rel72>.02:z['continue']=1
  elif r[72]<0 and x['rp72']<.35 and x['sl48']<0 and rel72<-.02:z['continue']=-1
  if z['continue']==1 and r[12]<0 and px>x['lo120'] and r[3]>0:z['reentry']=1
  elif z['continue']==-1 and r[12]>0 and px<x['hi120'] and r[3]<0:z['reentry']=-1
  if px<x['lo120'] and r[12]<0:z['reverse']=-1
  elif px>x['hi120'] and r[12]>0:z['reverse']=1
  if compressed and abs(r[24])<.02:z['exhaust']=1 if r[72]>0 else -1
  z['strength']=abs(rel72)/(v[168]*math.sqrt(72)+1e-9)+.60*x['e72']+.15*abs(x['z24'])
 else:
  m24=p.medmove(candles,idx,ts,24); m72=p.medmove(candles,idx,ts,72); rel24=r[24]-m24; rel72=r[72]-m72
  panic=x['br']<=.33 and m24<0 and x['shock']>1.35
  eup=x['br']>=.67 and m24>0 and x['shock']>1.15
  z['bias']=1 if rel168_pos(rel72,r[168]) else -1 if rel72<-.05 and r[168]<0 else 0
  if panic or eup:z['prewave']=1 if panic and rel24>m24 else -1 if eup and rel24<m24 else z['bias']
  if panic and rel24>.03 and r[6]>0 and x['z6']>.08:z['onset']=1
  elif eup and rel24<-.03 and r[6]<0 and x['z6']<-.08:z['onset']=-1
  if rel72>.06 and r[24]>0 and x['e72']>.18:z['continue']=1
  elif rel72<-.06 and r[24]<0 and x['e72']>.18:z['continue']=-1
  if z['continue']==1 and r[12]<0 and r[3]>0 and rel24>-.03:z['reentry']=1
  elif z['continue']==-1 and r[12]>0 and r[3]<0 and rel24<.03:z['reentry']=-1
  if rel24<-.10 and x['br']<.42:z['reverse']=-1
  elif rel24>.10 and x['br']>.58:z['reverse']=1
  if x['shock']>2.4 and x['e24']<.07:z['exhaust']=1 if r[24]>0 else -1
  z['strength']=abs(rel72)/(v[168]*math.sqrt(72)+1e-9)+.45*x['e72']+.30*abs(x['br']-.5)
 return z

def rel168_pos(rel72,r168): return rel72>.05 and r168>0

engine.state=state

def run(cid):
 candles,idx,_=v109.b.base.load(); ps=v109.b.base.periods(candles)
 dm=engine.evalm(cid,candles,idx,ps['development'],NORMAL_BPS,0); vm=engine.evalm(cid,candles,idx,ps['validation'],NORMAL_BPS,0); vs=engine.evalm(cid,candles,idx,ps['validation'],STRESS_BPS,1)
 dw=engine.wave_diag(cid,candles,idx,ps['development']); vw=engine.wave_diag(cid,candles,idx,ps['validation']); df=engine.folds(cid,candles,idx,ps['development']); vf=engine.folds(cid,candles,idx,ps['validation'])
 result={'strategyId':'V121_'+cid.upper(),'pair':CANDS[cid][0],'periods':ps,'development':dm,'validation':vm,'validationStress':vs,'waveDiagnostics':{'development':dw,'validation':vw},'walkForward':{'development':df,'validation':vf},'productionChanged':False,'realTradingEnabled':False}
 promote=(dm.get('pf') or 0)>=1.20 and dm.get('returnPct',0)>0 and (vm.get('pf') or 0)>=1.20 and vm.get('returnPct',0)>0 and (vs.get('pf') or 0)>1 and vm.get('maxDDPct',-999)>-20 and vw['captureRatePct']>=20 and vf['positivePfFolds']>=2
 if not promote:result.update(status='FAIL',reason='DEV_VALIDATION_WAVE')
 else:
  cm=engine.evalm(cid,candles,idx,ps['confirmation'],NORMAL_BPS,0); cs=engine.evalm(cid,candles,idx,ps['confirmation'],STRESS_BPS,1); result.update(confirmation=cm,confirmationStress=cs)
  if (cm.get('pf') or 0)<1.2 or cm.get('returnPct',0)<=0 or (cs.get('pf') or 0)<=1:result.update(status='FAIL',reason='CONFIRMATION')
  else:
   hm=engine.evalm(cid,candles,idx,ps['holdout'],NORMAL_BPS,0); hs=engine.evalm(cid,candles,idx,ps['holdout'],STRESS_BPS,1); ym=engine.evalm(cid,candles,idx,(ps['development'][0],ps['holdout'][1]),NORMAL_BPS,0); ys=engine.evalm(cid,candles,idx,(ps['development'][0],ps['holdout'][1]),STRESS_BPS,1)
   ok=(hm.get('pf') or 0)>1 and hm.get('returnPct',0)>0 and (hs.get('pf') or 0)>1 and (ym.get('pf') or 0)>=1.2 and ym.get('returnPct',0)>0 and (ys.get('pf') or 0)>1
   result.update(holdout=hm,holdoutStress=hs,year=ym,yearStress=ys,status='PASS' if ok else 'FAIL',reason='PASS' if ok else 'FINAL')
 out=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state'));out.mkdir(parents=True,exist_ok=True);stem='active4-v121-'+cid;txt=json.dumps(result,indent=2);(out/f'{stem}.json').write_text(txt);(out/f'{stem}.md').write_text('# '+result['strategyId']+'\n\n```json\n'+txt+'\n```\n');print(txt)

if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('--candidate',choices=sorted(CANDS),required=True);run(ap.parse_args().candidate)
