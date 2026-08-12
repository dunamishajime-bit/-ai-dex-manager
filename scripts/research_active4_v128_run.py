from __future__ import annotations
import argparse,json,math,os
from pathlib import Path
import research_active4_v127_run as prev

engine=prev.engine; p=engine.p; ret=engine.ret; HOUR=engine.HOUR
NORMAL_BPS=engine.NORMAL_BPS; STRESS_BPS=engine.STRESS_BPS; v109=prev.v109
CANDS={
 'btc_expansion_acceptance_lock':('BTC',.48,14.0,1344),
 'btc_asymmetric_wave_router':('BTC',.46,12.0,1008),
 'eth_leadership_confirm_own':('ETH',.44,12.0,1176),
 'bnb_strict_cash_acceptance':('BNB',.38,11.0,1344),
 'avax_burst_acceptance_lockout':('AVAX',.33,15.0,1008),
}
engine.CANDS.update(CANDS)

def rel(candles,idx,s,ts,n):
 i=idx[s].get(ts)
 return 0.0 if i is None else (ret(candles[s],i,n) or 0.0)-p.medmove(candles,idx,ts,n)

def state(cid,candles,idx,ts):
 x=engine.feat(cid,candles,idx,ts); z={'bias':0,'prewave':0,'onset':0,'continue':0,'reentry':0,'reverse':0,'exhaust':0,'strength':0.0}
 if not x:return z
 r=x['r'];v=x['v'];c=x['c'];i=x['i'];s=CANDS[cid][0];br=x['br'];shock=x['shock'];sl72=p.slope(c,i,72);sl168=x['sl168'];rr24=rel(candles,idx,s,ts,24);rr72=rel(candles,idx,s,ts,72);rr168=rel(candles,idx,s,ts,168)
 if cid=='btc_expansion_acceptance_lock':
  slow=1 if r[336]>0 and sl168>0 and x['rp336']>.50 else -1 if r[336]<0 and sl168<0 and x['rp336']<.50 else 0
  z['bias']=slow
  if slow and v[48]<v[168] and x['e72']<.24:z['prewave']=slow
  # Core does not open on first breakout. It opens only after 72h direction + 24h acceptance agree with slow regime.
  if slow==1 and r[72]>0 and r[24]>0 and sl72>0 and x['rp168']>.56 and x['e72']>.16:z['onset']=1
  elif slow==-1 and r[72]<0 and r[24]<0 and sl72<0 and x['rp168']<.44 and x['e72']>.16:z['onset']=-1
  if slow==1 and r[168]>0 and r[72]>0 and sl168>0:z['continue']=1
  elif slow==-1 and r[168]<0 and r[72]<0 and sl168<0:z['continue']=-1
  # Tactical re-entry requires a completed medium pullback and renewed 12/24h direction, never a 3h twitch.
  if z['continue']==1 and r[24]<0 and r[12]>0 and x['rp168']>.52:z['reentry']=1
  elif z['continue']==-1 and r[24]>0 and r[12]<0 and x['rp168']<.48:z['reentry']=-1
  if slow==1 and r[168]<0 and sl168<0 and x['rp336']<.46:z['reverse']=-1
  elif slow==-1 and r[168]>0 and sl168>0 and x['rp336']>.54:z['reverse']=1
  if x['e168']<.055 and v[48]<.72*v[168]:z['exhaust']=1 if r[168]>0 else -1
  z['strength']=.8*abs(x['z168'])+.9*x['e168']+.2*abs(x['z72'])
 elif cid=='btc_asymmetric_wave_router':
  # Crypto drift is treated asymmetrically: longs are ownership trades; shorts require a stricter bearish regime and exit faster on reclaim.
  longreg=r[336]>0 and sl168>0 and x['rp336']>.52
  shortreg=r[336]<0 and sl168<0 and x['rp336']<.40 and br<.46
  z['bias']=1 if longreg else -1 if shortreg else 0
  if z['bias'] and v[48]<.95*v[168]:z['prewave']=z['bias']
  if longreg and r[72]>0 and r[24]>0 and sl72>0 and x['e72']>.15:z['onset']=1
  elif shortreg and r[24]<0 and r[12]<0 and shock>1.05 and br<.44:z['onset']=-1
  if longreg and r[168]>0 and sl72>0:z['continue']=1
  elif shortreg and r[72]<0 and sl72<0 and br<.48:z['continue']=-1
  if z['continue']==1 and r[24]<0 and r[12]>0:z['reentry']=1
  elif z['continue']==-1 and r[12]>0 and r[6]<0 and br<.48:z['reentry']=-1
  if longreg and r[168]<0 and sl168<0:z['reverse']=-1
  elif shortreg and (r[24]>0 and r[12]>0 or br>.55):z['reverse']=1
  if (z['bias']==1 and x['e168']<.055) or (z['bias']==-1 and shock<.78):z['exhaust']=z['bias']
  z['strength']=abs(x['z168'])+.55*x['e168']+.35*abs(br-.5)
 elif cid=='eth_leadership_confirm_own':
  bi=idx['BTC'].get(ts)
  if bi is None or bi<336:return z
  btc=candles['BTC'];q={n:r[n]-(ret(btc,bi,n) or 0.0) for n in (12,24,72,168,336)}
  slow=1 if q[336]>0 and q[168]>0 else -1 if q[336]<0 and q[168]<0 else 0
  med=1 if q[168]>0 and q[72]>0 else -1 if q[168]<0 and q[72]<0 else 0
  z['bias']=slow if slow==med else 0
  if z['bias'] and v[48]<.96*v[168]:z['prewave']=z['bias']
  # Leadership is owned only after relative direction persists from 168h into 72/24h and ETH absolute direction agrees.
  if z['bias']==1 and q[72]>0 and q[24]>0 and r[72]>0 and sl72>0:z['onset']=1
  elif z['bias']==-1 and q[72]<0 and q[24]<0 and r[72]<0 and sl72<0:z['onset']=-1
  if z['bias']==1 and q[168]>0 and q[72]>0 and r[168]>0:z['continue']=1
  elif z['bias']==-1 and q[168]<0 and q[72]<0 and r[168]<0:z['continue']=-1
  if z['continue']==1 and q[24]<0 and q[12]>0 and r[12]>0:z['reentry']=1
  elif z['continue']==-1 and q[24]>0 and q[12]<0 and r[12]<0:z['reentry']=-1
  if slow==1 and q[168]<0 and q[72]<0:z['reverse']=-1
  elif slow==-1 and q[168]>0 and q[72]>0:z['reverse']=1
  if abs(q[168])<.006 and x['e168']<.065:z['exhaust']=1 if q[336]>0 else -1
  z['strength']=abs(q[168])/(v[168]*math.sqrt(168)+1e-9)+.7*abs(q[72])/(v[168]*math.sqrt(72)+1e-9)+.35*x['e168']
 elif cid=='bnb_strict_cash_acceptance':
  # Dominant state is CASH. No range-reversal branch; activation needs compression reset + relative release + medium acceptance.
  directional=1 if rr168>0 and x['rp336']>.54 else -1 if rr168<0 and x['rp336']<.46 else 0
  compression=v[48]<.82*v[168] and x['e72']<.18
  z['bias']=directional if compression or x['e168']>.20 else 0
  if compression and directional:z['prewave']=directional
  if z['bias']==1 and rr72>0 and rr24>0 and r[72]>0 and sl72>0 and x['e72']>.17:z['onset']=1
  elif z['bias']==-1 and rr72<0 and rr24<0 and r[72]<0 and sl72<0 and x['e72']>.17:z['onset']=-1
  if z['bias']==1 and rr168>0 and rr72>0 and x['rp168']>.58:z['continue']=1
  elif z['bias']==-1 and rr168<0 and rr72<0 and x['rp168']<.42:z['continue']=-1
  if z['continue']==1 and r[24]<0 and rr24>0 and r[12]>0:z['reentry']=1
  elif z['continue']==-1 and r[24]>0 and rr24<0 and r[12]<0:z['reentry']=-1
  if rr168<0 and rr72<0 and x['rp168']<.40:z['reverse']=-1
  elif rr168>0 and rr72>0 and x['rp168']>.60:z['reverse']=1
  if not compression and x['e168']<.08 and abs(rr72)<.004:z['exhaust']=1 if rr168>0 else -1
  z['strength']=abs(rr168)/(v[168]*math.sqrt(168)+1e-9)+.6*x['e168']+.25*abs(x['rp168']-.5)
 else:
  # AVAX burst needs market breadth + residual persistence; after a failed burst, state falls to CASH until a fresh compression/expansion lifecycle appears.
  directional=1 if rr168>0 and br>.50 else -1 if rr168<0 and br<.50 else 0
  reset=v[48]<.86*v[168] or shock<.90
  z['bias']=directional if reset or (abs(rr72)>0 and x['e72']>.20) else 0
  if reset and directional:z['prewave']=directional
  if z['bias']==1 and rr72>0 and rr24>0 and r[24]>0 and br>.54 and shock>1.0:z['onset']=1
  elif z['bias']==-1 and rr72<0 and rr24<0 and r[24]<0 and br<.46 and shock>1.0:z['onset']=-1
  if z['bias']==1 and rr168>0 and rr72>0 and r[72]>0 and br>.50:z['continue']=1
  elif z['bias']==-1 and rr168<0 and rr72<0 and r[72]<0 and br<.50:z['continue']=-1
  if z['continue']==1 and r[24]<0 and r[12]>0 and br>.50:z['reentry']=1
  elif z['continue']==-1 and r[24]>0 and r[12]<0 and br<.50:z['reentry']=-1
  if rr168<0 and rr72<0 and br<.40:z['reverse']=-1
  elif rr168>0 and rr72>0 and br>.60:z['reverse']=1
  if shock<.72 and x['e72']<.07:z['exhaust']=1 if rr168>0 else -1
  z['strength']=abs(rr168)/(v[168]*math.sqrt(168)+1e-9)+.7*abs(rr72)/(v[168]*math.sqrt(72)+1e-9)+.55*abs(br-.5)
 return z

engine.state=state

def run(cid):
 candles,idx,_=v109.b.base.load();ps=v109.b.base.periods(candles)
 dm=engine.evalm(cid,candles,idx,ps['development'],NORMAL_BPS,0);vm=engine.evalm(cid,candles,idx,ps['validation'],NORMAL_BPS,0);vs=engine.evalm(cid,candles,idx,ps['validation'],STRESS_BPS,1)
 dw=engine.wave_diag(cid,candles,idx,ps['development']);vw=engine.wave_diag(cid,candles,idx,ps['validation']);df=engine.folds(cid,candles,idx,ps['development']);vf=engine.folds(cid,candles,idx,ps['validation'])
 result={'strategyId':'V128_'+cid.upper(),'pair':CANDS[cid][0],'periods':ps,'development':dm,'validation':vm,'validationStress':vs,'waveDiagnostics':{'development':dw,'validation':vw},'walkForward':{'development':df,'validation':vf},'productionChanged':False,'realTradingEnabled':False,'architecture':'ACCEPTANCE_LOCK_CASH_FIRST'}
 promote=(dm.get('pf') or 0)>=1.20 and dm.get('returnPct',0)>0 and (vm.get('pf') or 0)>=1.20 and vm.get('returnPct',0)>0 and (vs.get('pf') or 0)>1 and vm.get('maxDDPct',-999)>-20 and vw['medianWaveMfeCapturedPct'] is not None and vw['medianWaveMfeCapturedPct']>=25 and vw['falseStartRatePct']<=40 and vf['positivePfFolds']>=2
 if not promote:result.update(status='FAIL',reason='DEV_VALIDATION_MONETIZATION')
 else:
  cm=engine.evalm(cid,candles,idx,ps['confirmation'],NORMAL_BPS,0);cs=engine.evalm(cid,candles,idx,ps['confirmation'],STRESS_BPS,1);result.update(confirmation=cm,confirmationStress=cs)
  if (cm.get('pf') or 0)<1.2 or cm.get('returnPct',0)<=0 or (cs.get('pf') or 0)<=1:result.update(status='FAIL',reason='CONFIRMATION')
  else:
   hm=engine.evalm(cid,candles,idx,ps['holdout'],NORMAL_BPS,0);hs=engine.evalm(cid,candles,idx,ps['holdout'],STRESS_BPS,1);ok=(hm.get('pf') or 0)>1 and hm.get('returnPct',0)>0 and (hs.get('pf') or 0)>1
   result.update(holdout=hm,holdoutStress=hs,status='PASS' if ok else 'FAIL',reason='PASS' if ok else 'FINAL')
 out=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state'));out.mkdir(parents=True,exist_ok=True);stem='active4-v128-'+cid;txt=json.dumps(result,indent=2);(out/f'{stem}.json').write_text(txt);(out/f'{stem}.md').write_text('# '+result['strategyId']+'\n\n```json\n'+txt+'\n```\n');print(txt)

if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('--candidate',choices=sorted(CANDS),required=True);run(ap.parse_args().candidate)
