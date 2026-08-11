from __future__ import annotations
import argparse,json,math,os
from pathlib import Path
import research_active4_v119 as q

HOUR=q.HOUR; NORMAL_BPS=q.NORMAL_BPS; STRESS_BPS=q.STRESS_BPS; p=q.p; ret=q.ret
CANDS={
 'btc_vol_release':('BTC',.60,6.4,624),
 'btc_failed_auction':('BTC',.56,5.8,456),
 'eth_leadership_transition':('ETH',.55,6.6,528),
 'bnb_regime_accel':('BNB',.48,6.0,432),
 'avax_breadth_burst':('AVAX',.43,7.6,384),
}
q.CANDS.update(CANDS)

def state(cid,candles,idx,ts):
 x=q.feat(cid,candles,idx,ts); z={'bias':0,'prewave':0,'onset':0,'continue':0,'reentry':0,'reverse':0,'exhaust':0,'strength':0.0}
 if not x:return z
 r=x['r']; v=x['v']; px=x['px']
 if cid=='btc_vol_release':
  slow_score=(1 if r[336]>0 else -1)+(1 if x['sl168']>0 else -1)+(1 if x['rp336']>.5 else -1)
  z['bias']=1 if slow_score>=1 else -1 if slow_score<=-1 else 0
  compression=v[48]<.78*v[168] and v[24]<.90*v[96] and x['e72']<.28
  if compression:z['prewave']=z['bias'] or (1 if r[168]>=0 else -1)
  vol_release=v[12]>1.05*v[48] and x['shock']>1.05
  if vol_release and r[6]>0 and r[24]>0 and x['z6']>.10 and x['rp72']>.62:z['onset']=1
  elif vol_release and r[6]<0 and r[24]<0 and x['z6']<-.10 and x['rp72']<.38:z['onset']=-1
  if r[72]>0 and x['e72']>.24 and x['sl48']>0 and x['rp168']>.55:z['continue']=1
  elif r[72]<0 and x['e72']>.24 and x['sl48']<0 and x['rp168']<.45:z['continue']=-1
  if z['bias']==1 and r[72]>0 and r[12]<0 and r[3]>0 and x['rp72']>.38:z['reentry']=1
  elif z['bias']==-1 and r[72]<0 and r[12]>0 and r[3]<0 and x['rp72']<.62:z['reentry']=-1
  if r[72]*r[24]<0 and abs(x['z24'])>.12 and ((r[24]<0 and x['sl48']<0) or (r[24]>0 and x['sl48']>0)):z['reverse']=1 if r[24]>0 else -1
  if x['shock']>2.25 and x['e24']<.07:z['exhaust']=1 if r[24]>0 else -1
  z['strength']=abs(x['z72'])+.65*x['e72']+.20*abs(x['z168'])
 elif cid=='btc_failed_auction':
  z['bias']=1 if r[168]>0 and x['rp336']>.45 else -1 if r[168]<0 and x['rp336']<.55 else 0
  near_hi=x['rp168']>.88; near_lo=x['rp168']<.12
  if near_hi or near_lo:z['prewave']=-1 if near_hi else 1
  failed_high=near_hi and r[12]<0 and r[3]<0 and px<x['hi120']
  failed_low=near_lo and r[12]>0 and r[3]>0 and px>x['lo120']
  if failed_low:z['onset']=1
  elif failed_high:z['onset']=-1
  if r[48]>0 and r[12]>0 and x['rp72']>.55 and x['e24']>.16:z['continue']=1
  elif r[48]<0 and r[12]<0 and x['rp72']<.45 and x['e24']>.16:z['continue']=-1
  if z['continue']==1 and r[12]<0 and r[3]>0 and x['rp72']>.35:z['reentry']=1
  elif z['continue']==-1 and r[12]>0 and r[3]<0 and x['rp72']<.65:z['reentry']=-1
  if px>x['hi120'] and r[12]>0 and x['e24']>.22:z['reverse']=1
  elif px<x['lo120'] and r[12]<0 and x['e24']>.22:z['reverse']=-1
  if x['shock']>2.1 and x['e24']<.08:z['exhaust']=1 if r[24]>0 else -1
  z['strength']=abs(x['z24'])+.55*x['e24']+.15*abs(x['z72'])
 elif cid=='eth_leadership_transition':
  bi=idx['BTC'].get(ts)
  if bi is None or bi<336:return z
  btc=candles['BTC']; rb={n:(ret(btc,bi,n) or 0.0) for n in (6,12,24,72,168,336)}; rel={n:r[n]-rb[n] for n in rb}
  z['bias']=1 if rel[168]>0 and rel[72]>-.03 else -1 if rel[168]<0 and rel[72]<.03 else 0
  transition_up=rel[168]<=.08 and rel[72]>.06 and rel[24]>.04 and rel[6]>0
  transition_dn=rel[168]>=-.08 and rel[72]<-.06 and rel[24]<-.04 and rel[6]<0
  if abs(rel[168])<.18 and v[48]<1.05*v[168]:z['prewave']=1 if rel[72]>=0 else -1
  if transition_up and r[12]>0 and x['e24']>.12:z['onset']=1
  elif transition_dn and r[12]<0 and x['e24']>.12:z['onset']=-1
  if rel[72]>.07 and rel[24]>0 and r[72]>0 and x['sl48']>0:z['continue']=1
  elif rel[72]<-.07 and rel[24]<0 and r[72]<0 and x['sl48']<0:z['continue']=-1
  if z['continue']==1 and r[12]<0 and rel[6]>0:z['reentry']=1
  elif z['continue']==-1 and r[12]>0 and rel[6]<0:z['reentry']=-1
  if rel[24]<-.10 and rel[6]<0 and x['sl48']<0:z['reverse']=-1
  elif rel[24]>.10 and rel[6]>0 and x['sl48']>0:z['reverse']=1
  if x['shock']>2.0 and rel[6]*rel[72]<0:z['exhaust']=1 if rel[72]>0 else -1
  z['strength']=abs(rel[72])/(v[168]*math.sqrt(72)+1e-9)+.5*x['e72']+.2*abs(rel[24])/(v[168]*math.sqrt(24)+1e-9)
 elif cid=='bnb_regime_accel':
  m168=p.medmove(candles,idx,ts,168); m72=p.medmove(candles,idx,ts,72); rel168=r[168]-m168; rel72=r[72]-m72
  trend_state=x['e168']>.18 and v[24]<2.0*v[168]
  if trend_state and rel168>.04 and x['rp336']>.48:z['bias']=1
  elif trend_state and rel168<-.04 and x['rp336']<.52:z['bias']=-1
  if z['bias'] and v[48]<.95*v[168] and x['e72']<.30:z['prewave']=z['bias']
  accel=x['z12']-.45*x['z48']
  if z['bias']==1 and accel>.11 and rel72>0 and r[6]>0 and x['volumeRatio']>.75:z['onset']=1
  elif z['bias']==-1 and accel<-.11 and rel72<0 and r[6]<0 and x['volumeRatio']>.75:z['onset']=-1
  if z['bias']==1 and rel72>.04 and r[48]>0 and x['e72']>.20:z['continue']=1
  elif z['bias']==-1 and rel72<-.04 and r[48]<0 and x['e72']>.20:z['continue']=-1
  if z['continue']==1 and r[12]<0 and r[3]>0:z['reentry']=1
  elif z['continue']==-1 and r[12]>0 and r[3]<0:z['reentry']=-1
  if rel72<-.08 and x['sl48']<0:z['reverse']=-1
  elif rel72>.08 and x['sl48']>0:z['reverse']=1
  if not trend_state and x['shock']>1.8:z['exhaust']=1 if r[24]>0 else -1
  z['strength']=abs(rel72)/(v[168]*math.sqrt(72)+1e-9)+.55*x['e168']
 else:
  br=x['br']; rel24=r[24]-p.medmove(candles,idx,ts,24); rel72=r[72]-p.medmove(candles,idx,ts,72)
  z['bias']=1 if rel72>.04 and br>=.50 else -1 if rel72<-.04 and br<=.50 else 0
  if v[48]<.92*v[168] and x['e72']<.30:z['prewave']=z['bias'] or (1 if rel72>=0 else -1)
  sync_up=br>=.67 and rel24>.04 and x['z6']>.08 and v[12]>.75*v[168]
  sync_dn=br<=.33 and rel24<-.04 and x['z6']<-.08 and v[12]>.75*v[168]
  if sync_up:z['onset']=1
  elif sync_dn:z['onset']=-1
  if rel72>.04 and br>=.58 and x['z48']>0 and x['e72']>.18:z['continue']=1
  elif rel72<-.04 and br<=.42 and x['z48']<0 and x['e72']>.18:z['continue']=-1
  if z['continue']==1 and r[12]<0 and r[3]>0 and br>=.50:z['reentry']=1
  elif z['continue']==-1 and r[12]>0 and r[3]<0 and br<=.50:z['reentry']=-1
  if br<=.33 and rel24<-.08:z['reverse']=-1
  elif br>=.67 and rel24>.08:z['reverse']=1
  if x['shock']>2.2 and x['e24']<.08:z['exhaust']=1 if r[24]>0 else -1
  z['strength']=abs(rel72)/(v[168]*math.sqrt(72)+1e-9)+.5*x['e72']+.25*abs(br-.5)
 return z

q.state=state

def run(cid):
 candles,idx,_=q.b.p.v109.b.base.load(); ps=q.b.p.v109.b.base.periods(candles)
 dm=q.evalm(cid,candles,idx,ps['development'],NORMAL_BPS,0); vm=q.evalm(cid,candles,idx,ps['validation'],NORMAL_BPS,0); vs=q.evalm(cid,candles,idx,ps['validation'],STRESS_BPS,1)
 dw=q.wave_diag(cid,candles,idx,ps['development']); vw=q.wave_diag(cid,candles,idx,ps['validation']); df=q.folds(cid,candles,idx,ps['development']); vf=q.folds(cid,candles,idx,ps['validation'])
 result={'strategyId':'V120_'+cid.upper(),'pair':CANDS[cid][0],'periods':ps,'development':dm,'validation':vm,'validationStress':vs,'waveDiagnostics':{'development':dw,'validation':vw},'walkForward':{'development':df,'validation':vf},'productionChanged':False,'realTradingEnabled':False}
 promote=(dm.get('pf') or 0)>=1.20 and dm.get('returnPct',0)>0 and (vm.get('pf') or 0)>=1.20 and vm.get('returnPct',0)>0 and (vs.get('pf') or 0)>1 and vm.get('maxDDPct',-999)>-20 and vw['captureRatePct']>=20 and vf['positivePfFolds']>=2
 if not promote:result.update(status='FAIL',reason='DEV_VALIDATION_WAVE')
 else:
  cm=q.evalm(cid,candles,idx,ps['confirmation'],NORMAL_BPS,0); cs=q.evalm(cid,candles,idx,ps['confirmation'],STRESS_BPS,1); result.update(confirmation=cm,confirmationStress=cs)
  if (cm.get('pf') or 0)<1.2 or cm.get('returnPct',0)<=0 or (cs.get('pf') or 0)<=1:result.update(status='FAIL',reason='CONFIRMATION')
  else:
   hm=q.evalm(cid,candles,idx,ps['holdout'],NORMAL_BPS,0); hs=q.evalm(cid,candles,idx,ps['holdout'],STRESS_BPS,1); ym=q.evalm(cid,candles,idx,(ps['development'][0],ps['holdout'][1]),NORMAL_BPS,0); ys=q.evalm(cid,candles,idx,(ps['development'][0],ps['holdout'][1]),STRESS_BPS,1)
   ok=(hm.get('pf') or 0)>1 and hm.get('returnPct',0)>0 and (hs.get('pf') or 0)>1 and (ym.get('pf') or 0)>=1.2 and ym.get('returnPct',0)>0 and (ys.get('pf') or 0)>1
   result.update(holdout=hm,holdoutStress=hs,year=ym,yearStress=ys,status='PASS' if ok else 'FAIL',reason='PASS' if ok else 'FINAL')
 out=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state'));out.mkdir(parents=True,exist_ok=True);stem='active4-v120-'+cid;txt=json.dumps(result,indent=2);(out/f'{stem}.json').write_text(txt);(out/f'{stem}.md').write_text('# '+result['strategyId']+'\n\n```json\n'+txt+'\n```\n');print(txt)

if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('--candidate',choices=sorted(CANDS),required=True);run(ap.parse_args().candidate)
