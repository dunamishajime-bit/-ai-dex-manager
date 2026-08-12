from __future__ import annotations
import argparse,json,math,os
from pathlib import Path
import research_active4_v125 as prev
import research_lab_pair_specific_v109 as v109

engine=prev.engine; p=engine.p; ret=engine.ret; HOUR=engine.HOUR
NORMAL_BPS=engine.NORMAL_BPS; STRESS_BPS=engine.STRESS_BPS
CANDS={
 'btc_wave_memory':('BTC',.54,7.2,960),
 'btc_breadth_reclaim':('BTC',.50,6.4,672),
 'eth_relative_expansion_memory':('ETH',.47,6.8,816),
 'bnb_compression_acceptance_retest':('BNB',.41,6.0,696),
 'avax_panic_leadership_flip':('AVAX',.37,7.0,624),
}
engine.CANDS.update(CANDS)

def rel(candles,idx,s,ts,n):
 i=idx[s].get(ts)
 return 0.0 if i is None else (ret(candles[s],i,n) or 0.0)-p.medmove(candles,idx,ts,n)

def state(cid,candles,idx,ts):
 x=engine.feat(cid,candles,idx,ts); z={'bias':0,'prewave':0,'onset':0,'continue':0,'reentry':0,'reverse':0,'exhaust':0,'strength':0.0}
 if not x:return z
 r=x['r'];v=x['v'];c=x['c'];i=x['i'];s=CANDS[cid][0];br=x['br'];shock=x['shock'];sl72=p.slope(c,i,72);sl168=x['sl168'];rr24=rel(candles,idx,s,ts,24);rr72=rel(candles,idx,s,ts,72);rr168=rel(candles,idx,s,ts,168)
 if cid=='btc_wave_memory':
  slow=1 if r[336]>0 and sl168>0 else -1 if r[336]<0 and sl168<0 else 0
  medium=1 if r[168]>0 and r[72]>0 else -1 if r[168]<0 and r[72]<0 else 0
  z['bias']=slow if slow==medium else 0
  if z['bias'] and v[48]<.9*v[168] and x['e72']<.22:z['prewave']=z['bias']
  if z['bias']==1 and r[6]>0 and r[24]>0 and x['z6']>.15:z['onset']=1
  elif z['bias']==-1 and r[6]<0 and r[24]<0 and x['z6']<-.15:z['onset']=-1
  if medium==1 and r[168]>0 and x['e168']>.18:z['continue']=1
  elif medium==-1 and r[168]<0 and x['e168']>.18:z['continue']=-1
  if z['continue']==1 and r[24]<0 and r[6]>0 and sl72>0:z['reentry']=1
  elif z['continue']==-1 and r[24]>0 and r[6]<0 and sl72<0:z['reentry']=-1
  if slow==1 and medium==-1:z['reverse']=-1
  elif slow==-1 and medium==1:z['reverse']=1
  if x['e168']<.08 or (v[24]<.65*v[168] and abs(r[72])<.01):z['exhaust']=1 if r[168]>0 else -1
  z['strength']=abs(x['z168'])+.6*x['e168']+.35*abs(x['z72'])
 elif cid=='btc_breadth_reclaim':
  z['bias']=1 if br<.35 and x['rp168']<.30 else -1 if br>.65 and x['rp168']>.70 else 0
  if z['bias']:z['prewave']=z['bias']
  if z['bias']==1 and br>.42 and r[3]>0 and r[6]>0:z['onset']=1
  elif z['bias']==-1 and br<.58 and r[3]<0 and r[6]<0:z['onset']=-1
  if r[72]>0 and br>.50 and sl72>0:z['continue']=1
  elif r[72]<0 and br<.50 and sl72<0:z['continue']=-1
  if z['continue']==1 and r[12]<0 and r[3]>0 and br>.45:z['reentry']=1
  elif z['continue']==-1 and r[12]>0 and r[3]<0 and br<.55:z['reentry']=-1
  if br<.30 and r[24]<0:z['reverse']=-1
  elif br>.70 and r[24]>0:z['reverse']=1
  if shock<.7 and x['e72']<.08:z['exhaust']=1 if r[72]>0 else -1
  z['strength']=1.2*abs(br-.5)+.45*abs(x['z72'])+.25*shock
 elif cid=='eth_relative_expansion_memory':
  bi=idx['BTC'].get(ts)
  if bi is None:return z
  btc=candles['BTC'];q={n:r[n]-(ret(btc,bi,n) or 0.0) for n in (3,6,12,24,72,168)}
  slow=1 if q[168]>.01 else -1 if q[168]<-.01 else 0; medium=1 if q[72]>.008 else -1 if q[72]<-.008 else 0
  z['bias']=slow if slow==medium else 0
  if z['bias'] and v[48]<.92*v[168]:z['prewave']=z['bias']
  if z['bias']==1 and q[6]>.006 and q[24]>0 and r[6]>0:z['onset']=1
  elif z['bias']==-1 and q[6]<-.006 and q[24]<0 and r[6]<0:z['onset']=-1
  if medium==1 and q[168]>0 and r[72]>0:z['continue']=1
  elif medium==-1 and q[168]<0 and r[72]<0:z['continue']=-1
  if z['continue']==1 and q[12]<0 and q[3]>0:z['reentry']=1
  elif z['continue']==-1 and q[12]>0 and q[3]<0:z['reentry']=-1
  if slow==1 and medium==-1:z['reverse']=-1
  elif slow==-1 and medium==1:z['reverse']=1
  if abs(q[72])<.004 and x['e72']<.08:z['exhaust']=1 if q[168]>0 else -1
  z['strength']=abs(q[168])/(v[168]*math.sqrt(168)+1e-9)+.7*abs(q[72])/(v[168]*math.sqrt(72)+1e-9)+.25*abs(br-.5)
 elif cid=='bnb_compression_acceptance_retest':
  z['bias']=1 if rr168>.008 else -1 if rr168<-.008 else 0
  comp=v[48]<.78*v[168] and x['e72']<.16
  if comp and z['bias']:z['prewave']=z['bias']
  if z['bias']==1 and x['px']>x['hi120'] and rr24>.01 and r[6]>0:z['onset']=1
  elif z['bias']==-1 and x['px']<x['lo120'] and rr24<-.01 and r[6]<0:z['onset']=-1
  if rr72>.015 and x['rp168']>.60 and sl72>0:z['continue']=1
  elif rr72<-.015 and x['rp168']<.40 and sl72<0:z['continue']=-1
  if z['continue']==1 and x['rp72']>.48 and r[12]<0 and r[3]>0:z['reentry']=1
  elif z['continue']==-1 and x['rp72']<.52 and r[12]>0 and r[3]<0:z['reentry']=-1
  if rr72<-.02 and x['rp168']<.45:z['reverse']=-1
  elif rr72>.02 and x['rp168']>.55:z['reverse']=1
  if abs(rr72)<.004 and x['e72']<.08:z['exhaust']=1 if rr168>0 else -1
  z['strength']=.8*abs(rr72)/(v[168]*math.sqrt(72)+1e-9)+.45*x['e168']+.2*abs(x['rp168']-.5)
 else:
  z['bias']=1 if br<.38 and rr168<0 else -1 if br>.62 and rr168>0 else 0
  if shock>1.35 and z['bias']:z['prewave']=z['bias']
  if z['bias']==1 and br>.46 and rr24>.0 and r[6]>0:z['onset']=1
  elif z['bias']==-1 and br<.54 and rr24<0 and r[6]<0:z['onset']=-1
  if rr72>.02 and br>.5 and r[72]>0:z['continue']=1
  elif rr72<-.02 and br<.5 and r[72]<0:z['continue']=-1
  if z['continue']==1 and r[12]<0 and r[3]>0 and shock<1.7:z['reentry']=1
  elif z['continue']==-1 and r[12]>0 and r[3]<0 and shock<1.7:z['reentry']=-1
  if br<.32 and rr24<-.025:z['reverse']=-1
  elif br>.68 and rr24>.025:z['reverse']=1
  if shock<.72 and x['e72']<.08:z['exhaust']=1 if rr72>0 else -1
  z['strength']=abs(rr72)/(v[168]*math.sqrt(72)+1e-9)+.7*abs(br-.5)+.25*shock
 return z

engine.state=state

def run(cid):
 candles,idx,_=v109.b.base.load();ps=v109.b.base.periods(candles)
 dm=engine.evalm(cid,candles,idx,ps['development'],NORMAL_BPS,0);vm=engine.evalm(cid,candles,idx,ps['validation'],NORMAL_BPS,0);vs=engine.evalm(cid,candles,idx,ps['validation'],STRESS_BPS,1)
 dw=engine.wave_diag(cid,candles,idx,ps['development']);vw=engine.wave_diag(cid,candles,idx,ps['validation']);df=engine.folds(cid,candles,idx,ps['development']);vf=engine.folds(cid,candles,idx,ps['validation'])
 result={'strategyId':'V126_'+cid.upper(),'pair':CANDS[cid][0],'periods':ps,'development':dm,'validation':vm,'validationStress':vs,'waveDiagnostics':{'development':dw,'validation':vw},'walkForward':{'development':df,'validation':vf},'productionChanged':False,'realTradingEnabled':False}
 promote=(dm.get('pf') or 0)>=1.20 and dm.get('returnPct',0)>0 and (vm.get('pf') or 0)>=1.20 and vm.get('returnPct',0)>0 and (vs.get('pf') or 0)>1 and vm.get('maxDDPct',-999)>-20 and vw['captureRatePct']>=20 and vf['positivePfFolds']>=2
 if not promote:result.update(status='FAIL',reason='DEV_VALIDATION_WAVE')
 else:
  cm=engine.evalm(cid,candles,idx,ps['confirmation'],NORMAL_BPS,0);cs=engine.evalm(cid,candles,idx,ps['confirmation'],STRESS_BPS,1);result.update(confirmation=cm,confirmationStress=cs)
  if (cm.get('pf') or 0)<1.2 or cm.get('returnPct',0)<=0 or (cs.get('pf') or 0)<=1:result.update(status='FAIL',reason='CONFIRMATION')
  else:
   hm=engine.evalm(cid,candles,idx,ps['holdout'],NORMAL_BPS,0);hs=engine.evalm(cid,candles,idx,ps['holdout'],STRESS_BPS,1);ym=engine.evalm(cid,candles,idx,(ps['development'][0],ps['holdout'][1]),NORMAL_BPS,0);ys=engine.evalm(cid,candles,idx,(ps['development'][0],ps['holdout'][1]),STRESS_BPS,1)
   ok=(hm.get('pf') or 0)>1 and hm.get('returnPct',0)>0 and (hs.get('pf') or 0)>1 and (ym.get('pf') or 0)>=1.2 and ym.get('returnPct',0)>0 and (ys.get('pf') or 0)>1
   result.update(holdout=hm,holdoutStress=hs,year=ym,yearStress=ys,status='PASS' if ok else 'FAIL',reason='PASS' if ok else 'FINAL')
 out=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state'));out.mkdir(parents=True,exist_ok=True);stem='active4-v126-'+cid;txt=json.dumps(result,indent=2);(out/f'{stem}.json').write_text(txt);(out/f'{stem}.md').write_text('# '+result['strategyId']+'\n\n```json\n'+txt+'\n```\n');print(txt)

if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('--candidate',choices=sorted(CANDS),required=True);run(ap.parse_args().candidate)
