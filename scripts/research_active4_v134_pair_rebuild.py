from __future__ import annotations
import argparse,json,math,os
from pathlib import Path
import research_active4_v133_engine_v21 as v133
import research_active4_v132_transition_arch as v132

engine=v133.engine;v109=v133.v109
CANDS={
 'btc_breadth_transition_v4':('BTC','btc_breadth_decay_owner',.38),
 'btc_breadth_reaccel_v4':('BTC','btc_breadth_decay_owner',.36),
 'eth_selective_leadership_v4':('ETH','eth_transition_owner',.34),
 'bnb_cash_release_quality_v4':('BNB','bnb_neutral_compression_release',.30),
 'avax_two_stage_burst_v4':('AVAX','avax_burst_scout_handoff',.20),
}
v133.CANDS.clear();v133.CANDS.update(CANDS)

def rel(candles,idx,s,ts,n):
 i=idx[s].get(ts);return 0.0 if i is None else (engine.ret(candles[s],i,n) or 0.0)-engine.p.medmove(candles,idx,ts,n)

def blank():return {'bias':0,'prewave':0,'onset':0,'continue':0,'reentry':0,'reverse':0,'exhaust':0,'strength':0.0}

def signal(cid,candles,idx,ts):
 z=blank();pair,old,_=CANDS[cid];oldbase=v132.CANDS[old][1];x=engine.feat(oldbase,candles,idx,ts)
 if not x:return z
 r=x['r'];v=x['v'];br=x['br'];c=x['c'];i=x['i'];sl72=engine.p.slope(c,i,72);sl168=x['sl168'];shock=x['shock']
 rr12=rel(candles,idx,pair,ts,12);rr24=rel(candles,idx,pair,ts,24);rr72=rel(candles,idx,pair,ts,72);rr168=rel(candles,idx,pair,ts,168)
 if cid.startswith('btc_'):
  slow=1 if r[336]>0 and sl168>0 else -1 if r[336]<0 and sl168<0 else 0
  med=1 if r[72]>0 and sl72>0 else -1 if r[72]<0 and sl72<0 else 0
  sponsor=1 if br>.53 else -1 if br<.47 else 0
  z['bias']=slow if slow and sponsor in (0,slow) else 0
  # PRE_WAVE is a real prerequisite; setup is compression/neutral breadth, not an entry condition.
  if slow and v[48]<v[168] and abs(br-.5)<.08:z['prewave']=slow
  if cid=='btc_breadth_transition_v4':
   if slow==1 and r[24]>0 and r[12]>0 and br>.50:z['onset']=1
   elif slow==-1 and r[24]<0 and r[12]<0 and br<.50:z['onset']=-1
   if slow==med==sponsor:z['continue']=slow
  else:
   # Distinct reacceleration architecture: fast scout first, medium+slow acceptance later.
   if slow==1 and r[12]>0 and br>.50:z['onset']=1
   elif slow==-1 and r[12]<0 and br<.50:z['onset']=-1
   if slow==med and sponsor in (0,slow) and r[24]*slow>0:z['continue']=slow
  if slow==1 and med==1 and r[24]<0 and r[12]>0 and sponsor>=0:z['reentry']=1
  elif slow==-1 and med==-1 and r[24]>0 and r[12]<0 and sponsor<=0:z['reentry']=-1
  if slow and (sl168*slow<0 or (sponsor==-slow and med==-slow)):z['reverse']=-slow
  if slow and sponsor==0 and med!=slow and x['e72']<.08:z['exhaust']=slow
  z['strength']=abs(x['z168'])+x['e168']+abs(br-.5)
 elif cid=='eth_selective_leadership_v4':
  bi=idx['BTC'].get(ts)
  if bi is None or bi<336:return z
  btc=candles['BTC'];q={n:r[n]-(engine.ret(btc,bi,n) or 0.0) for n in (12,24,72,168)}
  lead=1 if q[168]>0 else -1 if q[168]<0 else 0;absdir=1 if r[168]>0 and sl168>0 else -1 if r[168]<0 and sl168<0 else 0
  z['bias']=lead if lead==absdir else 0
  if lead and (q[24]*lead<0 or v[48]<v[168]):z['prewave']=lead
  # Preserve selectivity: absolute and relative direction must agree before initiation.
  if lead==absdir==1 and q[24]>0 and q[12]>0 and r[24]>0:z['onset']=1
  elif lead==absdir==-1 and q[24]<0 and q[12]<0 and r[24]<0:z['onset']=-1
  if lead==absdir and q[72]*lead>0 and r[72]*lead>0:z['continue']=lead
  if lead==absdir==1 and q[24]<0 and q[12]>0 and r[12]>0:z['reentry']=1
  elif lead==absdir==-1 and q[24]>0 and q[12]<0 and r[12]<0:z['reentry']=-1
  if lead and (absdir==-lead or q[168]*lead<0):z['reverse']=-lead
  if lead and abs(q[72])<abs(q[24]) and x['e72']<.07:z['exhaust']=lead
  z['strength']=abs(q[168])/(v[168]*math.sqrt(168)+1e-9)+x['e168']
 elif cid=='bnb_cash_release_quality_v4':
  # Cash-first: neutral compression forms setup; direction is not owned until relative+absolute release agrees.
  compression=v[48]<v[168] and x['e72']<.20;seed=1 if rr24>=0 else -1
  mature=1 if rr72>0 and rr168>0 else -1 if rr72<0 and rr168<0 else 0
  z['bias']=mature if mature and r[72]*mature>0 else 0
  if compression:z['prewave']=seed
  if seed==1 and compression and rr12>0 and r[12]>0 and br>=.5:z['onset']=1
  elif seed==-1 and compression and rr12<0 and r[12]<0 and br<=.5:z['onset']=-1
  if mature==1 and r[72]>0 and rr24>0:z['continue']=1
  elif mature==-1 and r[72]<0 and rr24<0:z['continue']=-1
  if mature==1 and rr24<0 and rr12>0 and r[12]>0:z['reentry']=1
  elif mature==-1 and rr24>0 and rr12<0 and r[12]<0:z['reentry']=-1
  if mature and (rr168*mature<0 or r[72]*mature<0):z['reverse']=-mature
  if mature and rr72*mature<=0:z['exhaust']=mature
  z['strength']=abs(rr72)/(v[168]*math.sqrt(72)+1e-9)+x['e72']
 else:
  slow=1 if rr168>0 else -1 if rr168<0 else (1 if rr72>=0 else -1);sponsor=1 if br>.55 else -1 if br<.45 else 0
  z['bias']=slow if sponsor in (0,slow) else 0
  if slow and (v[48]<v[168] or shock>1.10):z['prewave']=slow
  # Stage 1 scout uses fast relative burst; Stage 2 core requires breadth+medium persistence.
  if slow==1 and rr12>0 and r[12]>0 and shock>1.0:z['onset']=1
  elif slow==-1 and rr12<0 and r[12]<0 and shock>1.0:z['onset']=-1
  if slow==sponsor and rr72*slow>0 and r[72]*slow>0:z['continue']=slow
  if slow==1 and r[24]<0 and rr12>0 and sponsor==1:z['reentry']=1
  elif slow==-1 and r[24]>0 and rr12<0 and sponsor==-1:z['reentry']=-1
  if slow and (rr168*slow<0 or (sponsor==-slow and rr72*slow<0)):z['reverse']=-slow
  if slow and shock<.75 and x['e72']<.06:z['exhaust']=slow
  z['strength']=abs(rr72)/(v[168]*math.sqrt(72)+1e-9)+abs(br-.5)+shock
 return z

v133.sig=signal

def run(cid):
 candles,idx,_=v109.b.base.load();ps=v109.b.base.periods(candles)
 dm,_=v133.metr(cid,candles,idx,ps['development'],v133.NORMAL_BPS,0);vm,_=v133.metr(cid,candles,idx,ps['validation'],v133.NORMAL_BPS,0);vs,_=v133.metr(cid,candles,idx,ps['validation'],v133.STRESS_BPS,1)
 dw=v133.wave_diag(cid,candles,idx,ps['development']);vw=v133.wave_diag(cid,candles,idx,ps['validation']);df=v133.folds(cid,candles,idx,ps['development']);vf=v133.folds(cid,candles,idx,ps['validation'])
 adequate=dm.get('trades',0)>=8 and vm.get('trades',0)>=4;stable=df['positivePfFolds']>=2 and vf['positivePfFolds']>=2;broad=vw['captureRatePct']>=20 and (vw['medianWaveMfeCapturedPct'] or 0)>=20 and vw['falseStartRatePct']<=40
 promote=adequate and stable and broad and (dm.get('pf') or 0)>=1.2 and dm.get('returnPct',0)>0 and (vm.get('pf') or 0)>=1.2 and vm.get('returnPct',0)>0 and (vs.get('pf') or 0)>1 and vm.get('maxDDPct',-999)>-20
 res={'strategyId':'V134_'+cid.upper(),'pair':CANDS[cid][0],'periods':{'development':ps['development'],'validation':ps['validation'],'confirmation':'UNTOUCHED','holdout':'UNTOUCHED'},'development':dm,'validation':vm,'validationStress':vs,'waveDiagnostics':{'development':dw,'validation':vw},'walkForward':{'development':df,'validation':vf},'status':'FROZEN_SURVIVOR' if promote else 'FAIL','reason':'DEV_VALIDATION_GATE','architecture':'PAIR_REBUILD_FULL_LIFECYCLE_V4','productionChanged':False,'realTradingEnabled':False}
 out=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state'));out.mkdir(parents=True,exist_ok=True);stem='active4-v134-'+cid;txt=json.dumps(res,indent=2);(out/f'{stem}.json').write_text(txt);(out/f'{stem}.md').write_text('# '+res['strategyId']+'\n\n```json\n'+txt+'\n```\n');print(txt)
if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('--candidate',choices=sorted(CANDS),required=True);run(ap.parse_args().candidate)
