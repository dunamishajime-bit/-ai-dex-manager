from __future__ import annotations
import argparse,json,math,os
from pathlib import Path
import research_active4_v115 as q

HOUR=q.HOUR; NORMAL_BPS=q.NORMAL_BPS; STRESS_BPS=q.STRESS_BPS; p=q.p; ret=q.ret
CANDS={
 'btc_breakout_retest':('BTC',.62,6.6,672),
 'btc_trend_impulse':('BTC',.60,6.2,624),
 'eth_leadership_pullback':('ETH',.56,6.8,528),
 'bnb_range_release':('BNB',.50,6.2,432),
 'avax_impulse_carry':('AVAX',.44,8.0,384),
}
q.CANDS.update(CANDS)

def state(cid,candles,idx,ts):
 x=q.feat(cid,candles,idx,ts); z={'bias':0,'prewave':0,'onset':0,'continue':0,'reentry':0,'reverse':0,'exhaust':0,'strength':0.0}
 if not x:return z
 r=x['r']; c=x['c']; i=x['i']; v=x['v']; px=x['px']
 if cid=='btc_breakout_retest':
  slow_up=r[240]>0 and x['sl168']>0 and x['rp336']>.52; slow_dn=r[240]<0 and x['sl168']<0 and x['rp336']<.48
  z['bias']=1 if slow_up else -1 if slow_dn else 0
  compression=v[48]<.90*v[168] and x['e72']<.30
  if compression:z['prewave']=z['bias'] or (1 if r[168]>=0 else -1)
  upbreak=px>x['hi120'] and r[6]>0 and x['z6']>.12 and x['e24']>.12
  dnbreak=px<x['lo120'] and r[6]<0 and x['z6']<-.12 and x['e24']>.12
  if upbreak and z['bias'] in (0,1):z['onset']=1
  elif dnbreak and z['bias'] in (0,-1):z['onset']=-1
  if r[72]>0 and x['sl48']>0 and x['rp168']>.55 and x['e72']>.18:z['continue']=1
  elif r[72]<0 and x['sl48']<0 and x['rp168']<.45 and x['e72']>.18:z['continue']=-1
  if z['bias']==1 and r[72]>0 and r[12]<0 and r[3]>0 and x['rp72']>.32:z['reentry']=1
  elif z['bias']==-1 and r[72]<0 and r[12]>0 and r[3]<0 and x['rp72']<.68:z['reentry']=-1
  if r[72]<0 and x['sl48']<0 and x['rp168']<.38:z['reverse']=-1
  elif r[72]>0 and x['sl48']>0 and x['rp168']>.62:z['reverse']=1
  z['strength']=abs(x['z72'])+.55*x['e72']+.2*abs(x['z168'])
  if x['shock']>2.15 and x['e24']<.08:z['exhaust']=1 if r[24]>0 else -1
 elif cid=='btc_trend_impulse':
  slow=(1 if r[336]>0 else -1)+(1 if r[168]>0 else -1)+(1 if x['sl168']>0 else -1)
  z['bias']=1 if slow>=1 else -1 if slow<=-1 else 0
  if v[24]<.85*v[168] and x['e72']<.24:z['prewave']=z['bias'] or 1
  impulse=x['z6']-.30*x['z24']
  if impulse>.18 and r[12]>0 and x['e24']>.15:z['onset']=1
  elif impulse<-.18 and r[12]<0 and x['e24']>.15:z['onset']=-1
  if z['bias']==1 and r[48]>0 and r[12]>0 and x['sl48']>0:z['continue']=1
  elif z['bias']==-1 and r[48]<0 and r[12]<0 and x['sl48']<0:z['continue']=-1
  if z['continue']==1 and r[12]<0 and r[3]>0:z['reentry']=1
  elif z['continue']==-1 and r[12]>0 and r[3]<0:z['reentry']=-1
  if z['bias']==1 and r[48]<0 and x['sl48']<0 and x['rp168']<.42:z['reverse']=-1
  elif z['bias']==-1 and r[48]>0 and x['sl48']>0 and x['rp168']>.58:z['reverse']=1
  z['strength']=abs(x['z48'])+.5*x['e72']+.25*abs(x['z240'])
  if x['shock']>2.0 and x['e24']<.09:z['exhaust']=1 if r[24]>0 else -1
 elif cid=='eth_leadership_pullback':
  bi=idx['BTC'].get(ts)
  if bi is None or bi<336:return z
  btc=candles['BTC']; rel={n:r[n]-(ret(btc,bi,n) or 0.0) for n in (6,24,72,168,240)}
  z['bias']=1 if rel[168]>.05 and r[168]>0 else -1 if rel[168]<-.05 and r[168]<0 else 0
  if v[48]<.92*v[168] and abs(rel[72])<.30:z['prewave']=z['bias'] or (1 if rel[168]>=0 else -1)
  accel=rel[6]-.35*rel[24]
  if accel>.14 and r[6]>0 and x['e24']>.12 and z['bias'] in (0,1):z['onset']=1
  elif accel<-.14 and r[6]<0 and x['e24']>.12 and z['bias'] in (0,-1):z['onset']=-1
  if rel[72]>.08 and r[72]>0 and x['sl48']>0:z['continue']=1
  elif rel[72]<-.08 and r[72]<0 and x['sl48']<0:z['continue']=-1
  if z['bias']==1 and rel[72]>0 and r[24]>0 and r[12]<0 and rel[6]>0:z['reentry']=1
  elif z['bias']==-1 and rel[72]<0 and r[24]<0 and r[12]>0 and rel[6]<0:z['reentry']=-1
  if rel[24]<-.15 and r[48]<0 and x['sl48']<0:z['reverse']=-1
  elif rel[24]>.15 and r[48]>0 and x['sl48']>0:z['reverse']=1
  z['strength']=abs(rel[72])/(v[168]*math.sqrt(72)+1e-9)+.5*x['e72']
  if x['shock']>1.9 and abs(rel[6])<.04 and abs(rel[72])>.25:z['exhaust']=1 if rel[72]>0 else -1
 elif cid=='bnb_range_release':
  m72=p.medmove(candles,idx,ts,72); rel72=r[72]-m72
  z['bias']=1 if rel72>.05 and x['rp336']>.50 else -1 if rel72<-.05 and x['rp336']<.50 else 0
  comp=v[48]<.84*v[168] and x['e72']<.25
  if comp:z['prewave']=z['bias'] or (1 if rel72>=0 else -1)
  broke_up=px>x['hi120'] and r[12]>0 and x['volumeRatio']>.85 and x['e24']>.12
  broke_dn=px<x['lo120'] and r[12]<0 and x['volumeRatio']>.85 and x['e24']>.12
  if broke_up and z['bias'] in (0,1):z['onset']=1
  elif broke_dn and z['bias'] in (0,-1):z['onset']=-1
  if r[72]>0 and x['rp168']>.58 and x['e72']>.18:z['continue']=1
  elif r[72]<0 and x['rp168']<.42 and x['e72']>.18:z['continue']=-1
  if z['continue']==1 and x['rp72']<.60 and r[6]>0:z['reentry']=1
  elif z['continue']==-1 and x['rp72']>.40 and r[6]<0:z['reentry']=-1
  if r[48]<0 and x['rp168']<.40 and px<x['hi120']:z['reverse']=-1
  elif r[48]>0 and x['rp168']>.60 and px>x['lo120']:z['reverse']=1
  z['strength']=abs(rel72)/(v[168]*math.sqrt(72)+1e-9)+.5*x['e72']
  if x['shock']>2.0 and x['e24']<.08:z['exhaust']=1 if r[24]>0 else -1
 else:
  rel24=r[24]-p.medmove(candles,idx,ts,24); rel72=r[72]-p.medmove(candles,idx,ts,72); rel168=r[168]-p.medmove(candles,idx,ts,168)
  z['bias']=1 if rel168>.06 and r[168]>0 else -1 if rel168<-.06 and r[168]<0 else 0
  if v[48]<.88*v[168] and x['e72']<.26:z['prewave']=z['bias'] or (1 if rel72>=0 else -1)
  burst=v[12]/max(v[168],1e-9)
  if rel24>.08 and x['z6']>.12 and burst>.70 and x['e24']>.12:z['onset']=1
  elif rel24<-.08 and x['z6']<-.12 and burst>.70 and x['e24']>.12:z['onset']=-1
  if rel72>.06 and x['z48']>.04 and x['e72']>.16:z['continue']=1
  elif rel72<-.06 and x['z48']<-.04 and x['e72']>.16:z['continue']=-1
  if z['bias']==1 and r[48]>0 and r[12]<0 and x['z3']>.05:z['reentry']=1
  elif z['bias']==-1 and r[48]<0 and r[12]>0 and x['z3']<-.05:z['reentry']=-1
  if rel24<-.14 and r[24]<0 and x['sl48']<0:z['reverse']=-1
  elif rel24>.14 and r[24]>0 and x['sl48']>0:z['reverse']=1
  z['strength']=abs(rel72)/(v[168]*math.sqrt(72)+1e-9)+.4*x['e72']+.15*abs(rel168)/(v[168]*math.sqrt(168)+1e-9)
  if x['shock']>2.1 and x['e24']<.08:z['exhaust']=1 if r[24]>0 else -1
 return z

q.state=state

def run(cid):
 candles,idx,_=q.b.p.v109.b.base.load(); ps=q.b.p.v109.b.base.periods(candles)
 dm=q.evalm(cid,candles,idx,ps['development'],NORMAL_BPS,0); vm=q.evalm(cid,candles,idx,ps['validation'],NORMAL_BPS,0); vs=q.evalm(cid,candles,idx,ps['validation'],STRESS_BPS,1)
 dw=q.wave_diag(cid,candles,idx,ps['development']); vw=q.wave_diag(cid,candles,idx,ps['validation']); df=q.folds(cid,candles,idx,ps['development']); vf=q.folds(cid,candles,idx,ps['validation'])
 result={'strategyId':'V119_'+cid.upper(),'pair':CANDS[cid][0],'periods':ps,'development':dm,'validation':vm,'validationStress':vs,'waveDiagnostics':{'development':dw,'validation':vw},'walkForward':{'development':df,'validation':vf},'productionChanged':False,'realTradingEnabled':False}
 promote=(dm.get('pf') or 0)>=1.20 and dm.get('returnPct',0)>0 and (vm.get('pf') or 0)>=1.20 and vm.get('returnPct',0)>0 and (vs.get('pf') or 0)>1 and vm.get('maxDDPct',-999)>-20 and vw['captureRatePct']>=20 and vf['positivePfFolds']>=2
 if not promote:result.update(status='FAIL',reason='DEV_VALIDATION_WAVE')
 else:
  cm=q.evalm(cid,candles,idx,ps['confirmation'],NORMAL_BPS,0); cs=q.evalm(cid,candles,idx,ps['confirmation'],STRESS_BPS,1);result.update(confirmation=cm,confirmationStress=cs)
  if (cm.get('pf') or 0)<1.2 or cm.get('returnPct',0)<=0 or (cs.get('pf') or 0)<=1:result.update(status='FAIL',reason='CONFIRMATION')
  else:
   hm=q.evalm(cid,candles,idx,ps['holdout'],NORMAL_BPS,0); hs=q.evalm(cid,candles,idx,ps['holdout'],STRESS_BPS,1); ym=q.evalm(cid,candles,idx,(ps['development'][0],ps['holdout'][1]),NORMAL_BPS,0); ys=q.evalm(cid,candles,idx,(ps['development'][0],ps['holdout'][1]),STRESS_BPS,1)
   ok=(hm.get('pf') or 0)>1 and hm.get('returnPct',0)>0 and (hs.get('pf') or 0)>1 and (ym.get('pf') or 0)>=1.2 and ym.get('returnPct',0)>0 and (ys.get('pf') or 0)>1
   result.update(holdout=hm,holdoutStress=hs,year=ym,yearStress=ys,status='PASS' if ok else 'FAIL',reason='PASS' if ok else 'FINAL')
 out=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state'));out.mkdir(parents=True,exist_ok=True);stem='active4-v119-'+cid;txt=json.dumps(result,indent=2);(out/f'{stem}.json').write_text(txt);(out/f'{stem}.md').write_text('# '+result['strategyId']+'\n\n```json\n'+txt+'\n```\n');print(txt)

if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('--candidate',choices=sorted(CANDS),required=True);run(ap.parse_args().candidate)
