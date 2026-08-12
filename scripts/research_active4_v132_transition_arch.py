from __future__ import annotations
import argparse,json,math,os
from pathlib import Path
import research_active4_v131_lifecycle_v2 as v131
import research_active4_v130_run as v130

engine=v131.engine;p=engine.p;ret=engine.ret;v109=v131.v109
CANDS={
 'btc_breadth_decay_owner':('BTC','btc_breadth_sponsored_core',.38),
 'btc_dual_consensus_owner':('BTC','btc_acceptance_rearm',.38),
 'eth_transition_owner':('ETH','eth_leadership_probe_handoff',.36),
 'bnb_neutral_compression_release':('BNB','bnb_selective_release_rearm',.32),
 'avax_burst_scout_handoff':('AVAX','avax_breadth_burst_rearm',.22),
}
v131.CANDS.update(CANDS)

def rel(candles,idx,s,ts,n):
 i=idx[s].get(ts);return 0.0 if i is None else (ret(candles[s],i,n) or 0.0)-p.medmove(candles,idx,ts,n)

def blank():return {'bias':0,'prewave':0,'onset':0,'continue':0,'reentry':0,'reverse':0,'exhaust':0,'strength':0.0}

def signal(cid,candles,idx,ts):
 z=blank();pair,old,_=CANDS[cid];x=engine.feat(old,candles,idx,ts)
 if not x:return z
 r=x['r'];v=x['v'];br=x['br'];c=x['c'];i=x['i'];sl72=p.slope(c,i,72);sl168=x['sl168'];shock=x['shock']
 rr12=rel(candles,idx,pair,ts,12);rr24=rel(candles,idx,pair,ts,24);rr72=rel(candles,idx,pair,ts,72);rr168=rel(candles,idx,pair,ts,168)
 if cid=='btc_breadth_decay_owner':
  slow=1 if r[336]>0 and sl168>0 else -1 if r[336]<0 and sl168<0 else 0;sponsor=1 if br>.54 else -1 if br<.46 else 0
  z['bias']=slow if sponsor in (0,slow) else 0
  if slow and v[48]<v[168] and abs(br-.5)<.08:z['prewave']=slow
  if slow==1 and r[24]>0 and r[6]>0 and br>.50:z['onset']=1
  elif slow==-1 and r[24]<0 and r[6]<0 and br<.50:z['onset']=-1
  if slow==1 and r[168]>0 and r[72]>0 and br>.54:z['continue']=1
  elif slow==-1 and r[168]<0 and r[72]<0 and br<.46:z['continue']=-1
  if slow==1 and r[24]<0 and r[12]>0 and br>.54:z['reentry']=1
  elif slow==-1 and r[24]>0 and r[12]<0 and br<.46:z['reentry']=-1
  if slow==1 and (sl168<0 or br<.44):z['reverse']=-1
  elif slow==-1 and (sl168>0 or br>.56):z['reverse']=1
  # Structural sponsor decay closes ownership before full reversal; no price threshold sweep.
  if slow and abs(br-.5)<.018 and x['e72']<.09:z['exhaust']=slow
  z['strength']=abs(x['z168'])+x['e168']+abs(br-.5)
 elif cid=='btc_dual_consensus_owner':
  slow=1 if r[336]>0 and sl168>0 else -1 if r[336]<0 and sl168<0 else 0;med=1 if r[72]>0 and sl72>0 else -1 if r[72]<0 and sl72<0 else 0;sponsor=1 if br>.53 else -1 if br<.47 else 0
  z['bias']=slow if slow==med else 0
  if slow and v[48]<.9*v[168] and med!=slow:z['prewave']=slow
  if slow==1 and med>=0 and r[24]>0 and sponsor>=0:z['onset']=1
  elif slow==-1 and med<=0 and r[24]<0 and sponsor<=0:z['onset']=-1
  if slow==med==sponsor and r[168]*slow>0:z['continue']=slow
  if slow==1 and med==1 and r[24]<0 and r[12]>0 and sponsor==1:z['reentry']=1
  elif slow==-1 and med==-1 and r[24]>0 and r[12]<0 and sponsor==-1:z['reentry']=-1
  if slow and med==-slow:z['reverse']=-slow
  if slow and sponsor==-slow:z['exhaust']=slow
  z['strength']=abs(x['z168'])+x['e168']+x['e72']
 elif cid=='eth_transition_owner':
  bi=idx['BTC'].get(ts)
  if bi is None or bi<336:return z
  btc=candles['BTC'];q={n:r[n]-(ret(btc,bi,n) or 0.0) for n in (12,24,72,168)}
  lead=1 if q[168]>0 else -1 if q[168]<0 else 0;absdir=1 if r[168]>0 and sl168>0 else -1 if r[168]<0 and sl168<0 else 0
  z['bias']=lead
  # Setup may form from relative compression even before absolute trend agrees.
  if lead and (q[24]*lead<0 or v[48]<.85*v[168]):z['prewave']=lead
  if lead==1 and q[24]>0 and q[12]>0 and r[24]>0:z['onset']=1
  elif lead==-1 and q[24]<0 and q[12]<0 and r[24]<0:z['onset']=-1
  if lead==absdir and q[72]*lead>0 and r[72]*lead>0:z['continue']=lead
  if lead==1 and q[24]<0 and q[12]>0:z['reentry']=1
  elif lead==-1 and q[24]>0 and q[12]<0:z['reentry']=-1
  if lead and (q[168]*lead<0 or absdir==-lead):z['reverse']=-lead
  if lead and abs(q[72])<.0015 and x['e72']<.07:z['exhaust']=lead
  z['strength']=abs(q[168])/(v[168]*math.sqrt(168)+1e-9)+x['e168']
 elif cid=='bnb_neutral_compression_release':
  # Direction is discovered at release; setup no longer requires an already-mature 168h relative regime.
  compression=v[48]<.82*v[168] and x['e72']<.20;seed=1 if rr24>=0 else -1
  z['bias']=1 if rr168>0 else -1 if rr168<0 else seed
  if compression:z['prewave']=seed
  if seed==1 and compression and rr12>0 and r[12]>0:z['onset']=1
  elif seed==-1 and compression and rr12<0 and r[12]<0:z['onset']=-1
  mature=1 if rr72>0 and rr168>0 else -1 if rr72<0 and rr168<0 else 0
  if mature==1 and r[72]>0 and x['e72']>.08:z['continue']=1
  elif mature==-1 and r[72]<0 and x['e72']>.08:z['continue']=-1
  if mature==1 and rr24<0 and rr12>0:z['reentry']=1
  elif mature==-1 and rr24>0 and rr12<0:z['reentry']=-1
  if mature and rr168*mature<0:z['reverse']=-mature
  if mature and abs(rr72)<.002 and x['e72']<.06:z['exhaust']=mature
  z['strength']=abs(rr72)/(v[168]*math.sqrt(72)+1e-9)+x['e72']
 else:
  slow=1 if rr168>0 else -1 if rr168<0 else (1 if rr72>=0 else -1);sponsor=1 if br>.55 else -1 if br<.45 else 0
  z['bias']=slow if sponsor in (0,slow) else 0
  if slow and (v[48]<.88*v[168] or shock>1.10):z['prewave']=slow
  if slow==1 and rr12>0 and r[12]>0 and shock>1.0:z['onset']=1
  elif slow==-1 and rr12<0 and r[12]<0 and shock>1.0:z['onset']=-1
  if slow==sponsor and rr72*slow>0 and r[72]*slow>0:z['continue']=slow
  if slow==1 and r[24]<0 and rr12>0 and sponsor==1:z['reentry']=1
  elif slow==-1 and r[24]>0 and rr12<0 and sponsor==-1:z['reentry']=-1
  if slow and (rr168*slow<0 or sponsor==-slow):z['reverse']=-slow
  if slow and shock<.72 and x['e72']<.06:z['exhaust']=slow
  z['strength']=abs(rr72)/(v[168]*math.sqrt(72)+1e-9)+abs(br-.5)+shock
 return z

v131.sig=signal

def run(cid):
 candles,idx,_=v109.b.base.load();ps=v109.b.base.periods(candles)
 dm,_=v131.metr(cid,candles,idx,ps['development'],v131.NORMAL_BPS,0);vm,_=v131.metr(cid,candles,idx,ps['validation'],v131.NORMAL_BPS,0);vs,_=v131.metr(cid,candles,idx,ps['validation'],v131.STRESS_BPS,1)
 dw=v131.wave_diag(cid,candles,idx,ps['development']);vw=v131.wave_diag(cid,candles,idx,ps['validation']);df=v131.folds(cid,candles,idx,ps['development']);vf=v131.folds(cid,candles,idx,ps['validation'])
 adequate=dm.get('trades',0)>=8 and vm.get('trades',0)>=4;stable=df['positivePfFolds']>=2 and vf['positivePfFolds']>=2;broad=vw['captureRatePct']>=20 and (vw['medianWaveMfeCapturedPct'] or 0)>=20 and vw['falseStartRatePct']<=40
 promote=adequate and stable and broad and (dm.get('pf') or 0)>=1.2 and dm.get('returnPct',0)>0 and (vm.get('pf') or 0)>=1.2 and vm.get('returnPct',0)>0 and (vs.get('pf') or 0)>1 and vm.get('maxDDPct',-999)>-20
 res={'strategyId':'V132_'+cid.upper(),'pair':CANDS[cid][0],'periods':{'development':ps['development'],'validation':ps['validation'],'confirmation':'UNTOUCHED','holdout':'UNTOUCHED'},'development':dm,'validation':vm,'validationStress':vs,'waveDiagnostics':{'development':dw,'validation':vw},'walkForward':{'development':df,'validation':vf},'status':'FROZEN_SURVIVOR' if promote else 'FAIL','reason':'DEV_VALIDATION_GATE','architecture':'PAIR_TRANSITION_ARCH_V2','productionChanged':False,'realTradingEnabled':False}
 out=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state'));out.mkdir(parents=True,exist_ok=True);stem='active4-v132-'+cid;txt=json.dumps(res,indent=2);(out/f'{stem}.json').write_text(txt);(out/f'{stem}.md').write_text('# '+res['strategyId']+'\n\n```json\n'+txt+'\n```\n');print(txt)
if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('--candidate',choices=sorted(CANDS),required=True);run(ap.parse_args().candidate)
