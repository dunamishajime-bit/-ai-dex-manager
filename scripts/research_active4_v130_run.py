from __future__ import annotations
import argparse,json,math,os
from pathlib import Path
import research_active4_v129_run as prev

engine=prev.engine; p=engine.p; ret=engine.ret
NORMAL_BPS=engine.NORMAL_BPS; STRESS_BPS=engine.STRESS_BPS; v109=prev.v109
CANDS={
 'btc_acceptance_rearm':('BTC',.42,12.0,1176),
 'btc_breadth_sponsored_core':('BTC',.40,12.0,1176),
 'eth_leadership_probe_handoff':('ETH',.38,12.0,1176),
 'bnb_selective_release_rearm':('BNB',.34,11.0,1344),
 'avax_breadth_burst_rearm':('AVAX',.28,14.0,1008),
}
engine.CANDS.update(CANDS)

def rel(candles,idx,s,ts,n):
 i=idx[s].get(ts)
 return 0.0 if i is None else (ret(candles[s],i,n) or 0.0)-p.medmove(candles,idx,ts,n)

def state(cid,candles,idx,ts):
 x=engine.feat(cid,candles,idx,ts)
 z={'bias':0,'prewave':0,'onset':0,'continue':0,'reentry':0,'reverse':0,'exhaust':0,'strength':0.0}
 if not x:return z
 r=x['r'];v=x['v'];c=x['c'];i=x['i'];s=CANDS[cid][0]
 br=x['br'];shock=x['shock'];sl72=p.slope(c,i,72);sl168=x['sl168']
 rr12=rel(candles,idx,s,ts,12);rr24=rel(candles,idx,s,ts,24);rr72=rel(candles,idx,s,ts,72);rr168=rel(candles,idx,s,ts,168)

 if cid=='btc_acceptance_rearm':
  # Probe -> accepted core -> structural hold. Re-entry requires a new medium-horizon re-acceleration,
  # not every fast pullback. This addresses false cycling without simply tightening a threshold.
  slow=1 if r[336]>0 and sl168>0 else -1 if r[336]<0 and sl168<0 else 0
  med=1 if r[72]>0 and sl72>0 else -1 if r[72]<0 and sl72<0 else 0
  z['bias']=slow
  if slow and v[48]<v[168] and x['e72']<.24:z['prewave']=slow
  if slow==1 and r[24]>0 and r[6]>0 and med>=0:z['onset']=1
  elif slow==-1 and r[24]<0 and r[6]<0 and med<=0:z['onset']=-1
  if slow==1 and med==1 and r[168]>0 and x['e72']>.10:z['continue']=1
  elif slow==-1 and med==-1 and r[168]<0 and x['e72']>.10:z['continue']=-1
  # re-arm only after medium reset then 12/24h resumption
  if z['continue']==1 and r[72]>0 and r[24]<0 and r[12]>0 and rr12>=0:z['reentry']=1
  elif z['continue']==-1 and r[72]<0 and r[24]>0 and r[12]<0 and rr12<=0:z['reentry']=-1
  if slow==1 and med==-1 and r[168]<0:z['reverse']=-1
  elif slow==-1 and med==1 and r[168]>0:z['reverse']=1
  if slow and x['e168']<.05 and x['e72']<.06 and v[48]<.72*v[168]:z['exhaust']=slow
  z['strength']=.85*abs(x['z168'])+.75*x['e168']+.45*x['e72']

 elif cid=='btc_breadth_sponsored_core':
  # BTC owns a wave only when BTC direction and broad-market participation agree.
  # Cash on disagreement; breadth recovery is needed before re-entry.
  slow=1 if r[336]>0 and sl168>0 else -1 if r[336]<0 and sl168<0 else 0
  sponsor=1 if br>.54 else -1 if br<.46 else 0
  z['bias']=slow if slow==sponsor else 0
  if slow and sponsor==0 and v[48]<v[168]:z['prewave']=slow
  if z['bias']==1 and r[24]>0 and rr24>=0 and r[6]>0:z['onset']=1
  elif z['bias']==-1 and r[24]<0 and rr24<=0 and r[6]<0:z['onset']=-1
  if z['bias']==1 and r[168]>0 and r[72]>0 and br>.52:z['continue']=1
  elif z['bias']==-1 and r[168]<0 and r[72]<0 and br<.48:z['continue']=-1
  if z['continue']==1 and r[24]<0 and r[12]>0 and br>.54:z['reentry']=1
  elif z['continue']==-1 and r[24]>0 and r[12]<0 and br<.46:z['reentry']=-1
  if slow==1 and (sl168<0 or br<.42):z['reverse']=-1
  elif slow==-1 and (sl168>0 or br>.58):z['reverse']=1
  if z['bias'] and abs(br-.5)<.025 and x['e72']<.06:z['exhaust']=z['bias']
  z['strength']=.75*abs(x['z168'])+.7*abs(br-.5)+.55*x['e168']

 elif cid=='eth_leadership_probe_handoff':
  # Separate absolute trend from relative leadership. Small probe begins on transition;
  # core continuation requires both to persist, and leadership loss returns to cash.
  bi=idx['BTC'].get(ts)
  if bi is None or bi<336:return z
  btc=candles['BTC'];q={n:r[n]-(ret(btc,bi,n) or 0.0) for n in (12,24,72,168,336)}
  absdir=1 if r[168]>0 and sl168>0 else -1 if r[168]<0 and sl168<0 else 0
  lead=1 if q[168]>0 and q[72]>0 else -1 if q[168]<0 and q[72]<0 else 0
  z['bias']=lead if lead else 0
  if lead and q[24]*lead<0 and v[48]<v[168]:z['prewave']=lead
  if lead==1 and q[24]>0 and q[12]>0 and r[24]>0:z['onset']=1
  elif lead==-1 and q[24]<0 and q[12]<0 and r[24]<0:z['onset']=-1
  if lead==1 and absdir==1 and q[168]>0 and q[72]>0 and r[72]>0:z['continue']=1
  elif lead==-1 and absdir==-1 and q[168]<0 and q[72]<0 and r[72]<0:z['continue']=-1
  if z['continue']==1 and q[24]<0 and q[12]>0 and r[12]>0:z['reentry']=1
  elif z['continue']==-1 and q[24]>0 and q[12]<0 and r[12]<0:z['reentry']=-1
  if lead==1 and (q[168]<0 or absdir==-1):z['reverse']=-1
  elif lead==-1 and (q[168]>0 or absdir==1):z['reverse']=1
  if lead and abs(q[72])<.003 and x['e72']<.06:z['exhaust']=lead
  z['strength']=abs(q[168])/(v[168]*math.sqrt(168)+1e-9)+.7*abs(q[72])/(v[168]*math.sqrt(72)+1e-9)+.5*x['e168']

 elif cid=='bnb_selective_release_rearm':
  # Keep the V128 cash-first lesson, but do not extend holds blindly.
  # Each core requires compression/reset -> relative release -> acceptance; after failure a fresh reset is required.
  direction=1 if rr168>0 and sl168>0 else -1 if rr168<0 and sl168<0 else 0
  reset=v[48]<.82*v[168] and x['e72']<.18
  accepted=(direction==1 and rr72>0 and r[72]>0) or (direction==-1 and rr72<0 and r[72]<0)
  z['bias']=direction if (reset or accepted) else 0
  if reset and direction:z['prewave']=direction
  if direction==1 and reset and rr24>0 and r[12]>0:z['onset']=1
  elif direction==-1 and reset and rr24<0 and r[12]<0:z['onset']=-1
  if direction==1 and accepted and x['e72']>.08:z['continue']=1
  elif direction==-1 and accepted and x['e72']>.08:z['continue']=-1
  if z['continue']==1 and rr24<0 and rr12>0 and r[12]>0 and x['e72']>.10:z['reentry']=1
  elif z['continue']==-1 and rr24>0 and rr12<0 and r[12]<0 and x['e72']>.10:z['reentry']=-1
  if direction==1 and rr168<0:z['reverse']=-1
  elif direction==-1 and rr168>0:z['reverse']=1
  if direction and abs(rr72)<.0025 and x['e72']<.05:z['exhaust']=direction
  z['strength']=abs(rr168)/(v[168]*math.sqrt(168)+1e-9)+.7*x['e168']+.45*x['e72']

 else:
  # AVAX: burst initiation can probe, but core ownership requires breadth sponsorship and relative persistence.
  slow=1 if rr168>0 else -1 if rr168<0 else 0
  sponsor=1 if br>.54 else -1 if br<.46 else 0
  z['bias']=slow if sponsor in (0,slow) else 0
  if slow and (shock>1.12 or v[48]<.84*v[168]):z['prewave']=slow
  if slow==1 and rr24>0 and r[12]>0 and shock>1.0:z['onset']=1
  elif slow==-1 and rr24<0 and r[12]<0 and shock>1.0:z['onset']=-1
  if slow==1 and sponsor==1 and rr72>0 and r[72]>0 and sl72>0:z['continue']=1
  elif slow==-1 and sponsor==-1 and rr72<0 and r[72]<0 and sl72<0:z['continue']=-1
  # Failed burst must re-arm via renewed breadth sponsorship + relative 12h recovery.
  if z['continue']==1 and r[24]<0 and rr12>0 and br>.55:z['reentry']=1
  elif z['continue']==-1 and r[24]>0 and rr12<0 and br<.45:z['reentry']=-1
  if slow==1 and (rr168<0 or br<.42):z['reverse']=-1
  elif slow==-1 and (rr168>0 or br>.58):z['reverse']=1
  if slow and shock<.72 and x['e72']<.055:z['exhaust']=slow
  z['strength']=abs(rr168)/(v[168]*math.sqrt(168)+1e-9)+.7*abs(rr72)/(v[168]*math.sqrt(72)+1e-9)+.6*abs(br-.5)
 return z

engine.state=state

def run(cid):
 candles,idx,_=v109.b.base.load();ps=v109.b.base.periods(candles)
 dm=engine.evalm(cid,candles,idx,ps['development'],NORMAL_BPS,0)
 vm=engine.evalm(cid,candles,idx,ps['validation'],NORMAL_BPS,0)
 vs=engine.evalm(cid,candles,idx,ps['validation'],STRESS_BPS,1)
 dw=engine.wave_diag(cid,candles,idx,ps['development']);vw=engine.wave_diag(cid,candles,idx,ps['validation'])
 df=engine.folds(cid,candles,idx,ps['development']);vf=engine.folds(cid,candles,idx,ps['validation'])
 result={'strategyId':'V130_'+cid.upper(),'pair':CANDS[cid][0],'periods':ps,'development':dm,'validation':vm,'validationStress':vs,'waveDiagnostics':{'development':dw,'validation':vw},'walkForward':{'development':df,'validation':vf},'productionChanged':False,'realTradingEnabled':False,'architecture':'ACCEPTANCE_REARM_CASH_LIFECYCLE'}
 adequate=dm.get('trades',0)>=12 and vm.get('trades',0)>=6
 wave_ok=vw.get('captureRatePct',0)>=20 and (vw.get('medianWaveMfeCapturedPct') or 0)>=25
 stable=vf.get('positivePfFolds',0)>=2 and df.get('positivePfFolds',0)>=2
 promote=adequate and wave_ok and stable and (dm.get('pf') or 0)>=1.20 and dm.get('returnPct',0)>0 and (vm.get('pf') or 0)>=1.20 and vm.get('returnPct',0)>0 and (vs.get('pf') or 0)>1 and vm.get('maxDDPct',-999)>-20 and vw['falseStartRatePct']<=35
 if not promote:result.update(status='FAIL',reason='DEV_VALIDATION_REARM_GATE')
 else:
  cm=engine.evalm(cid,candles,idx,ps['confirmation'],NORMAL_BPS,0);cs=engine.evalm(cid,candles,idx,ps['confirmation'],STRESS_BPS,1)
  result.update(confirmation=cm,confirmationStress=cs)
  if (cm.get('pf') or 0)<1.2 or cm.get('returnPct',0)<=0 or (cs.get('pf') or 0)<=1:result.update(status='FAIL',reason='CONFIRMATION')
  else:
   hm=engine.evalm(cid,candles,idx,ps['holdout'],NORMAL_BPS,0);hs=engine.evalm(cid,candles,idx,ps['holdout'],STRESS_BPS,1)
   ok=(hm.get('pf') or 0)>1 and hm.get('returnPct',0)>0 and (hs.get('pf') or 0)>1
   result.update(holdout=hm,holdoutStress=hs,status='PASS' if ok else 'FAIL',reason='PASS' if ok else 'FINAL')
 out=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state'));out.mkdir(parents=True,exist_ok=True)
 stem='active4-v130-'+cid;txt=json.dumps(result,indent=2)
 (out/f'{stem}.json').write_text(txt);(out/f'{stem}.md').write_text('# '+result['strategyId']+'\n\n```json\n'+txt+'\n```\n')
 print(txt)

if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('--candidate',choices=sorted(CANDS),required=True);run(ap.parse_args().candidate)
