from __future__ import annotations
import argparse,json,math,os
from pathlib import Path
import research_active4_v128_run as prev

engine=prev.engine; p=engine.p; ret=engine.ret
NORMAL_BPS=engine.NORMAL_BPS; STRESS_BPS=engine.STRESS_BPS; v109=prev.v109
CANDS={
 'btc_probe_core_handoff':('BTC',.44,12.0,1176),
 'btc_long_ownership_cash':('BTC',.42,12.0,1344),
 'eth_abs_rel_consensus':('ETH',.40,12.0,1176),
 'bnb_cash_hold_extension':('BNB',.36,11.0,1512),
 'avax_dual_phase_burst':('AVAX',.30,14.0,1008),
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
 rr24=rel(candles,idx,s,ts,24);rr72=rel(candles,idx,s,ts,72);rr168=rel(candles,idx,s,ts,168)

 if cid=='btc_probe_core_handoff':
  slow=1 if r[336]>0 and sl168>0 else -1 if r[336]<0 and sl168<0 else 0
  z['bias']=slow
  if slow and v[48]<v[168]:z['prewave']=slow
  if slow==1 and r[24]>0 and r[6]>0 and sl72>=0:z['onset']=1
  elif slow==-1 and r[24]<0 and r[6]<0 and sl72<=0:z['onset']=-1
  if slow==1 and r[168]>0 and r[72]>0 and sl72>0:z['continue']=1
  elif slow==-1 and r[168]<0 and r[72]<0 and sl72<0:z['continue']=-1
  if z['continue']==1 and r[24]<0 and r[12]>0 and sl72>0:z['reentry']=1
  elif z['continue']==-1 and r[24]>0 and r[12]<0 and sl72<0:z['reentry']=-1
  if slow==1 and r[168]<0 and sl168<0:z['reverse']=-1
  elif slow==-1 and r[168]>0 and sl168>0:z['reverse']=1
  if x['e168']<.06 and v[48]<.70*v[168]:z['exhaust']=slow
  z['strength']=.9*abs(x['z168'])+.6*x['e168']+.25*abs(x['z72'])

 elif cid=='btc_long_ownership_cash':
  longreg=r[336]>0 and sl168>0 and x['rp336']>.50
  z['bias']=1 if longreg else 0
  if longreg and v[48]<v[168]:z['prewave']=1
  if longreg and r[72]>0 and r[24]>0 and sl72>0:z['onset']=1
  if longreg and r[168]>0 and r[72]>0:z['continue']=1
  if z['continue']==1 and r[24]<0 and r[12]>0:z['reentry']=1
  if longreg and r[168]<0 and sl168<0:z['reverse']=-1
  if longreg and x['e168']<.05 and v[48]<.68*v[168]:z['exhaust']=1
  z['strength']=abs(x['z168'])+.7*x['e168']+.2*br

 elif cid=='eth_abs_rel_consensus':
  bi=idx['BTC'].get(ts)
  if bi is None or bi<336:return z
  btc=candles['BTC']
  q={n:r[n]-(ret(btc,bi,n) or 0.0) for n in (12,24,72,168,336)}
  absdir=1 if r[168]>0 and sl168>0 else -1 if r[168]<0 and sl168<0 else 0
  reldir=1 if q[168]>0 and q[72]>0 else -1 if q[168]<0 and q[72]<0 else 0
  z['bias']=absdir if absdir==reldir else 0
  if z['bias'] and v[48]<v[168]:z['prewave']=z['bias']
  if z['bias']==1 and q[24]>0 and r[24]>0 and r[12]>0:z['onset']=1
  elif z['bias']==-1 and q[24]<0 and r[24]<0 and r[12]<0:z['onset']=-1
  if z['bias']==1 and q[168]>0 and r[168]>0 and q[72]>0:z['continue']=1
  elif z['bias']==-1 and q[168]<0 and r[168]<0 and q[72]<0:z['continue']=-1
  if z['continue']==1 and q[24]<0 and q[12]>0 and r[12]>0:z['reentry']=1
  elif z['continue']==-1 and q[24]>0 and q[12]<0 and r[12]<0:z['reentry']=-1
  if absdir==1 and reldir==-1:z['reverse']=-1
  elif absdir==-1 and reldir==1:z['reverse']=1
  if abs(q[168])<.004 and x['e168']<.06:z['exhaust']=z['bias']
  z['strength']=abs(q[168])/(v[168]*math.sqrt(168)+1e-9)+.6*x['e168']+.4*abs(x['z168'])

 elif cid=='bnb_cash_hold_extension':
  direction=1 if rr168>0 and x['rp336']>.52 else -1 if rr168<0 and x['rp336']<.48 else 0
  compression=v[48]<.85*v[168] and x['e72']<.20
  z['bias']=direction if compression or x['e168']>.18 else 0
  if compression and direction:z['prewave']=direction
  if z['bias']==1 and rr72>0 and r[72]>0 and sl72>0:z['onset']=1
  elif z['bias']==-1 and rr72<0 and r[72]<0 and sl72<0:z['onset']=-1
  if z['bias']==1 and rr168>0 and rr72>0 and sl168>0:z['continue']=1
  elif z['bias']==-1 and rr168<0 and rr72<0 and sl168<0:z['continue']=-1
  if z['continue']==1 and r[24]<0 and rr24>0 and r[12]>0:z['reentry']=1
  elif z['continue']==-1 and r[24]>0 and rr24<0 and r[12]<0:z['reentry']=-1
  if direction==1 and rr168<0 and sl168<0:z['reverse']=-1
  elif direction==-1 and rr168>0 and sl168>0:z['reverse']=1
  if x['e168']<.055 and abs(rr72)<.003:z['exhaust']=direction
  z['strength']=abs(rr168)/(v[168]*math.sqrt(168)+1e-9)+.75*x['e168']+.2*abs(x['rp168']-.5)

 else:
  slow=1 if rr168>0 and br>.50 else -1 if rr168<0 and br<.50 else 0
  z['bias']=slow
  if slow and (shock>1.15 or v[48]<.88*v[168]):z['prewave']=slow
  if slow==1 and rr24>0 and r[12]>0 and shock>1.0:z['onset']=1
  elif slow==-1 and rr24<0 and r[12]<0 and shock>1.0:z['onset']=-1
  if slow==1 and rr72>0 and r[72]>0 and br>.52 and sl72>0:z['continue']=1
  elif slow==-1 and rr72<0 and r[72]<0 and br<.48 and sl72<0:z['continue']=-1
  if z['continue']==1 and r[24]<0 and r[12]>0 and br>.50:z['reentry']=1
  elif z['continue']==-1 and r[24]>0 and r[12]<0 and br<.50:z['reentry']=-1
  if slow==1 and rr168<0 and br<.44:z['reverse']=-1
  elif slow==-1 and rr168>0 and br>.56:z['reverse']=1
  if shock<.70 and x['e72']<.06:z['exhaust']=slow
  z['strength']=abs(rr168)/(v[168]*math.sqrt(168)+1e-9)+.75*abs(rr72)/(v[168]*math.sqrt(72)+1e-9)+.45*abs(br-.5)
 return z

engine.state=state

def run(cid):
 candles,idx,_=v109.b.base.load();ps=v109.b.base.periods(candles)
 dm=engine.evalm(cid,candles,idx,ps['development'],NORMAL_BPS,0)
 vm=engine.evalm(cid,candles,idx,ps['validation'],NORMAL_BPS,0)
 vs=engine.evalm(cid,candles,idx,ps['validation'],STRESS_BPS,1)
 dw=engine.wave_diag(cid,candles,idx,ps['development']);vw=engine.wave_diag(cid,candles,idx,ps['validation'])
 df=engine.folds(cid,candles,idx,ps['development']);vf=engine.folds(cid,candles,idx,ps['validation'])
 result={'strategyId':'V129_'+cid.upper(),'pair':CANDS[cid][0],'periods':ps,'development':dm,'validation':vm,'validationStress':vs,'waveDiagnostics':{'development':dw,'validation':vw},'walkForward':{'development':df,'validation':vf},'productionChanged':False,'realTradingEnabled':False,'architecture':'PROBE_CORE_CASH_MONETIZATION'}
 promote=(dm.get('pf') or 0)>=1.20 and dm.get('returnPct',0)>0 and (vm.get('pf') or 0)>=1.20 and vm.get('returnPct',0)>0 and (vs.get('pf') or 0)>1 and vm.get('maxDDPct',-999)>-20 and vw['falseStartRatePct']<=35 and vf['positivePfFolds']>=2
 if not promote:result.update(status='FAIL',reason='DEV_VALIDATION_MONETIZATION')
 else:
  cm=engine.evalm(cid,candles,idx,ps['confirmation'],NORMAL_BPS,0);cs=engine.evalm(cid,candles,idx,ps['confirmation'],STRESS_BPS,1)
  result.update(confirmation=cm,confirmationStress=cs)
  if (cm.get('pf') or 0)<1.2 or cm.get('returnPct',0)<=0 or (cs.get('pf') or 0)<=1:result.update(status='FAIL',reason='CONFIRMATION')
  else:
   hm=engine.evalm(cid,candles,idx,ps['holdout'],NORMAL_BPS,0);hs=engine.evalm(cid,candles,idx,ps['holdout'],STRESS_BPS,1)
   ok=(hm.get('pf') or 0)>1 and hm.get('returnPct',0)>0 and (hs.get('pf') or 0)>1
   result.update(holdout=hm,holdoutStress=hs,status='PASS' if ok else 'FAIL',reason='PASS' if ok else 'FINAL')
 out=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state'));out.mkdir(parents=True,exist_ok=True)
 stem='active4-v129-'+cid;txt=json.dumps(result,indent=2)
 (out/f'{stem}.json').write_text(txt);(out/f'{stem}.md').write_text('# '+result['strategyId']+'\n\n```json\n'+txt+'\n```\n')
 print(txt)

if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('--candidate',choices=sorted(CANDS),required=True);run(ap.parse_args().candidate)
