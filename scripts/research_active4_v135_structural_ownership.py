from __future__ import annotations
import argparse,json,math,os
from pathlib import Path
import research_active4_v133_engine_v21 as v133

engine=v133.engine; v109=v133.v109
CANDS={
 'btc_acceptance_persistence_v5':('BTC','btc_breadth_decay_owner',.34),
 'btc_sponsor_handoff_v5':('BTC','btc_breadth_decay_owner',.32),
 'eth_anchor_ignition_v5':('ETH','eth_transition_owner',.30),
 'bnb_dual_consensus_cash_v5':('BNB','bnb_neutral_compression_release',.28),
 'avax_burst_reset_reaccel_v5':('AVAX','avax_burst_scout_handoff',.18),
}
v133.CANDS.clear();v133.CANDS.update(CANDS)

def rel(candles,idx,s,ts,n):
 i=idx[s].get(ts)
 return 0.0 if i is None else (engine.ret(candles[s],i,n) or 0.0)-engine.p.medmove(candles,idx,ts,n)

def blank():return {'bias':0,'prewave':0,'onset':0,'continue':0,'reentry':0,'reverse':0,'exhaust':0,'strength':0.0}

def signal(cid,candles,idx,ts):
 z=blank();pair,old,_=CANDS[cid];oldbase=__import__('research_active4_v132_transition_arch').CANDS[old][1];x=engine.feat(oldbase,candles,idx,ts)
 if not x:return z
 r=x['r'];v=x['v'];br=x['br'];c=x['c'];i=x['i'];sl72=engine.p.slope(c,i,72);sl168=x['sl168'];shock=x['shock']
 rr12=rel(candles,idx,pair,ts,12);rr24=rel(candles,idx,pair,ts,24);rr72=rel(candles,idx,pair,ts,72);rr168=rel(candles,idx,pair,ts,168)
 if cid=='btc_acceptance_persistence_v5':
  slow=1 if r[336]>0 and sl168>0 else -1 if r[336]<0 and sl168<0 else 0
  med=1 if r[72]>0 and sl72>0 else -1 if r[72]<0 and sl72<0 else 0
  sponsor=1 if br>.53 else -1 if br<.47 else 0
  z['bias']=slow if slow and sponsor in (0,slow) else 0
  if slow and v[48]<v[168] and med in (0,-slow):z['prewave']=slow
  if slow==1 and r[12]>0 and r[24]>0 and br>.50:z['onset']=1
  elif slow==-1 and r[12]<0 and r[24]<0 and br<.50:z['onset']=-1
  # Core acceptance requires medium alignment plus breadth sponsorship; no neutral sponsor handoff.
  if slow==med==sponsor and r[24]*slow>0:z['continue']=slow
  if slow==med==sponsor==1 and r[24]<0 and r[12]>0:z['reentry']=1
  elif slow==med==sponsor==-1 and r[24]>0 and r[12]<0:z['reentry']=-1
  if slow and (med==-slow or sponsor==-slow or sl168*slow<0):z['reverse']=-slow
  if slow and med==0 and sponsor==0 and x['e72']<.08:z['exhaust']=slow
  z['strength']=abs(x['z168'])+x['e168']+abs(br-.5)
 elif cid=='btc_sponsor_handoff_v5':
  slow=1 if r[336]>0 and sl168>0 else -1 if r[336]<0 and sl168<0 else 0
  sponsor=1 if br>.53 else -1 if br<.47 else 0
  fast=1 if r[12]>0 and r[24]>0 else -1 if r[12]<0 and r[24]<0 else 0
  med=1 if r[72]>0 and sl72>0 else -1 if r[72]<0 and sl72<0 else 0
  z['bias']=slow if slow else 0
  # Setup is slow trend with sponsorship absent/opposed; initiation is breadth handoff into slow direction.
  if slow and sponsor!=slow and v[48]<=v[168]:z['prewave']=slow
  if slow==fast and sponsor==slow:z['onset']=slow
  if slow==med==sponsor and x['e72']>.05:z['continue']=slow
  if slow==med and sponsor==slow and r[24]*slow<0 and r[12]*slow>0:z['reentry']=slow
  if slow and (sponsor==-slow and med==-slow):z['reverse']=-slow
  if slow and sponsor!=slow and fast!=slow and x['e72']<.06:z['exhaust']=slow
  z['strength']=abs(x['z168'])+abs(br-.5)+x['e72']
 elif cid=='eth_anchor_ignition_v5':
  bi=idx['BTC'].get(ts)
  if bi is None or bi<336:return z
  btc=candles['BTC'];q={n:r[n]-(engine.ret(btc,bi,n) or 0.0) for n in (12,24,72,168)}
  anchor=1 if r[168]>0 and sl168>0 else -1 if r[168]<0 and sl168<0 else 0
  lead=1 if q[168]>0 and q[72]>0 else -1 if q[168]<0 and q[72]<0 else 0
  z['bias']=anchor if anchor==lead else 0
  # Relative compression while absolute anchor persists, then joint fast ignition.
  if anchor and abs(q[24])<abs(q[72]) and v[48]<v[168]:z['prewave']=anchor
  if anchor==lead==1 and q[12]>0 and r[12]>0:z['onset']=1
  elif anchor==lead==-1 and q[12]<0 and r[12]<0:z['onset']=-1
  if anchor==lead and q[24]*lead>0 and r[72]*lead>0:z['continue']=lead
  if anchor==lead==1 and q[24]<0 and q[12]>0 and r[12]>0:z['reentry']=1
  elif anchor==lead==-1 and q[24]>0 and q[12]<0 and r[12]<0:z['reentry']=-1
  if lead and (anchor==-lead or q[72]*lead<0):z['reverse']=-lead
  if lead and abs(q[24])<abs(q[72]) and r[24]*lead<=0:z['exhaust']=lead
  z['strength']=abs(q[72])/(v[168]*math.sqrt(72)+1e-9)+x['e168']
 elif cid=='bnb_dual_consensus_cash_v5':
  absdir=1 if r[168]>0 and sl168>0 else -1 if r[168]<0 and sl168<0 else 0
  reldir=1 if rr168>0 and rr72>0 else -1 if rr168<0 and rr72<0 else 0
  sponsor=1 if br>.53 else -1 if br<.47 else 0
  z['bias']=absdir if absdir==reldir and sponsor in (0,absdir) else 0
  # Cash is default; a new lifecycle needs compression plus neutral sponsorship before dual release.
  if v[48]<v[168] and sponsor==0 and absdir in (1,-1):z['prewave']=absdir
  if absdir==reldir==1 and rr12>0 and r[12]>0 and sponsor>=0:z['onset']=1
  elif absdir==reldir==-1 and rr12<0 and r[12]<0 and sponsor<=0:z['onset']=-1
  if absdir==reldir==sponsor and rr24*absdir>0:z['continue']=absdir
  if absdir==reldir==1 and rr24<0 and rr12>0 and sponsor==1:z['reentry']=1
  elif absdir==reldir==-1 and rr24>0 and rr12<0 and sponsor==-1:z['reentry']=-1
  if absdir and (reldir==-absdir or sponsor==-absdir):z['reverse']=-absdir
  if absdir and sponsor==0 and rr72*absdir<=0:z['exhaust']=absdir
  z['strength']=abs(rr72)/(v[168]*math.sqrt(72)+1e-9)+abs(br-.5)
 else:
  slow=1 if rr168>0 and r[168]>0 else -1 if rr168<0 and r[168]<0 else 0
  sponsor=1 if br>.55 else -1 if br<.45 else 0
  z['bias']=slow if slow and sponsor in (0,slow) else 0
  # Distinct burst lifecycle: pre-wave is shock/fast burst, entry waits for a reset then reacceleration.
  if slow and shock>1.05 and rr12*slow>0:z['prewave']=slow
  reset=(r[24]*slow<0 or rr24*slow<0)
  if slow and reset and rr12*slow>0 and r[12]*slow>0:z['onset']=slow
  if slow==sponsor and rr72*slow>0 and r[72]*slow>0:z['continue']=slow
  if slow==sponsor and rr24*slow<0 and rr12*slow>0:z['reentry']=slow
  if slow and (rr168*slow<0 or (sponsor==-slow and rr72*slow<0)):z['reverse']=-slow
  if slow and shock<.75 and rr24*slow<=0:z['exhaust']=slow
  z['strength']=abs(rr72)/(v[168]*math.sqrt(72)+1e-9)+shock+abs(br-.5)
 return z

v133.sig=signal

def run(cid):
 candles,idx,_=v109.b.base.load();ps=v109.b.base.periods(candles)
 dm,_=v133.metr(cid,candles,idx,ps['development'],v133.NORMAL_BPS,0);vm,_=v133.metr(cid,candles,idx,ps['validation'],v133.NORMAL_BPS,0);vs,_=v133.metr(cid,candles,idx,ps['validation'],v133.STRESS_BPS,1)
 dw=v133.wave_diag(cid,candles,idx,ps['development']);vw=v133.wave_diag(cid,candles,idx,ps['validation']);df=v133.folds(cid,candles,idx,ps['development']);vf=v133.folds(cid,candles,idx,ps['validation'])
 adequate=dm.get('trades',0)>=8 and vm.get('trades',0)>=4;stable=df['positivePfFolds']>=2 and vf['positivePfFolds']>=2;broad=vw['captureRatePct']>=20 and (vw['medianWaveMfeCapturedPct'] or 0)>=20 and vw['falseStartRatePct']<=40
 promote=adequate and stable and broad and (dm.get('pf') or 0)>=1.2 and dm.get('returnPct',0)>0 and (vm.get('pf') or 0)>=1.2 and vm.get('returnPct',0)>0 and (vs.get('pf') or 0)>1 and vm.get('maxDDPct',-999)>-20
 res={'strategyId':'V135_'+cid.upper(),'pair':CANDS[cid][0],'periods':{'development':ps['development'],'validation':ps['validation'],'confirmation':'UNTOUCHED','holdout':'UNTOUCHED'},'development':dm,'validation':vm,'validationStress':vs,'waveDiagnostics':{'development':dw,'validation':vw},'walkForward':{'development':df,'validation':vf},'status':'FROZEN_SURVIVOR' if promote else 'FAIL','reason':'DEV_VALIDATION_GATE','architecture':'STRUCTURAL_OWNERSHIP_V5','productionChanged':False,'realTradingEnabled':False}
 out=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state'));out.mkdir(parents=True,exist_ok=True);stem='active4-v135-'+cid;txt=json.dumps(res,indent=2);(out/f'{stem}.json').write_text(txt);(out/f'{stem}.md').write_text('# '+res['strategyId']+'\n\n```json\n'+txt+'\n```\n');print(txt)
if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('--candidate',choices=sorted(CANDS),required=True);run(ap.parse_args().candidate)
