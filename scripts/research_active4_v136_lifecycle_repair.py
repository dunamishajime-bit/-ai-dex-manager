from __future__ import annotations
import argparse,json,math,os
from pathlib import Path
import research_active4_v133_engine_v21 as v133

engine=v133.engine; v109=v133.v109
# Structural-only successors from V135 Development/Validation diagnostics. No dense sweeps.
CANDS={
 'btc_sponsor_durable_core_v6':('BTC','btc_breadth_decay_owner',.32),
 'btc_compression_acceptance_v6':('BTC','btc_breadth_decay_owner',.34),
 'eth_relative_anchor_handoff_v6':('ETH','eth_transition_owner',.30),
 'bnb_consensus_cash_rearm_v6':('BNB','bnb_neutral_compression_release',.28),
 'avax_burst_acceptance_rearm_v6':('AVAX','avax_burst_scout_handoff',.18),
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
 if cid=='btc_sponsor_durable_core_v6':
  slow=1 if r[336]>0 and sl168>0 else -1 if r[336]<0 and sl168<0 else 0
  med=1 if r[168]>0 and r[72]>0 and sl72>0 else -1 if r[168]<0 and r[72]<0 and sl72<0 else 0
  sponsor=1 if br>.53 else -1 if br<.47 else 0
  fast=1 if r[12]>0 and r[24]>0 else -1 if r[12]<0 and r[24]<0 else 0
  z['bias']=slow if slow and med in (0,slow) else 0
  # Sponsor handoff must start from compression while sponsorship is absent, then become aligned.
  if slow and sponsor!=slow and v[48]<v[168] and fast!=slow:z['prewave']=slow
  if slow==fast==sponsor:z['onset']=slow
  # Core requires durable medium+slow alignment and active sponsor, not onset alone.
  if slow==med==sponsor and r[24]*slow>0 and x['e72']>.06:z['continue']=slow
  if slow==med==sponsor and r[24]*slow<0 and r[12]*slow>0:z['reentry']=slow
  if slow and ((med==-slow and sponsor!=slow) or (sponsor==-slow and fast==-slow)):z['reverse']=-slow
  if slow and sponsor!=slow and fast!=slow and x['e72']<.05:z['exhaust']=slow
  z['strength']=abs(x['z168'])+x['e72']+abs(br-.5)
 elif cid=='btc_compression_acceptance_v6':
  slow=1 if r[336]>0 and sl168>0 else -1 if r[336]<0 and sl168<0 else 0
  med=1 if r[72]>0 and sl72>0 else -1 if r[72]<0 and sl72<0 else 0
  sponsor=1 if br>.53 else -1 if br<.47 else 0
  fast=1 if r[12]>0 and r[24]>0 else -1 if r[12]<0 and r[24]<0 else 0
  z['bias']=slow if slow and sponsor in (0,slow) else 0
  # Reduce V135 false starts: setup requires real compression and medium counter/neutral state.
  if slow and v[24]<v[168] and med in (0,-slow) and sponsor in (0,slow):z['prewave']=slow
  if slow==fast and sponsor in (0,slow):z['onset']=slow
  if slow==med==sponsor and r[168]*slow>0 and x['e72']>.08:z['continue']=slow
  if slow==med==sponsor and r[24]*slow<0 and r[12]*slow>0:z['reentry']=slow
  if slow and (sponsor==-slow or (med==-slow and fast==-slow)):z['reverse']=-slow
  if slow and med==0 and fast!=slow and x['e72']<.05:z['exhaust']=slow
  z['strength']=abs(x['z168'])+x['e168']+abs(br-.5)
 elif cid=='eth_relative_anchor_handoff_v6':
  bi=idx['BTC'].get(ts)
  if bi is None or bi<336:return z
  btc=candles['BTC'];q={n:r[n]-(engine.ret(btc,bi,n) or 0.0) for n in (12,24,72,168)}
  anchor=1 if r[168]>0 and sl168>0 else -1 if r[168]<0 and sl168<0 else 0
  lead=1 if q[168]>0 and q[72]>0 else -1 if q[168]<0 and q[72]<0 else 0
  sponsor=1 if br>.53 else -1 if br<.47 else 0
  z['bias']=anchor if anchor==lead and sponsor in (0,anchor) else 0
  # Selective setup: absolute anchor survives while relative leadership compresses.
  if anchor and abs(q[24])<abs(q[72]) and v[48]<v[168] and sponsor in (0,anchor):z['prewave']=anchor
  if anchor==lead and q[12]*lead>0 and r[12]*lead>0 and sponsor in (0,lead):z['onset']=lead
  # Major-wave participation only after relative + absolute medium ownership agree.
  if anchor==lead==sponsor and q[24]*lead>0 and r[72]*lead>0 and q[72]*lead>0:z['continue']=lead
  if anchor==lead==sponsor and q[24]*lead<0 and q[12]*lead>0 and r[12]*lead>0:z['reentry']=lead
  if lead and (anchor==-lead or q[72]*lead<0 or sponsor==-lead):z['reverse']=-lead
  if lead and q[24]*lead<=0 and r[24]*lead<=0 and x['e72']<.06:z['exhaust']=lead
  z['strength']=abs(q[72])/(v[168]*math.sqrt(72)+1e-9)+x['e168']+abs(br-.5)
 elif cid=='bnb_consensus_cash_rearm_v6':
  absdir=1 if r[168]>0 and sl168>0 else -1 if r[168]<0 and sl168<0 else 0
  reldir=1 if rr168>0 and rr72>0 else -1 if rr168<0 and rr72<0 else 0
  sponsor=1 if br>.53 else -1 if br<.47 else 0
  fast=1 if rr12>0 and r[12]>0 else -1 if rr12<0 and r[12]<0 else 0
  z['bias']=absdir if absdir==reldir==sponsor else 0
  # Cash default. Lifecycle only arms from compressed neutral sponsorship.
  if absdir==reldir and absdir and sponsor==0 and v[48]<v[168] and fast!=absdir:z['prewave']=absdir
  if absdir==reldir==fast and sponsor in (0,absdir):z['onset']=absdir
  # Prevent V135 wrong-core ownership: core requires all three regime votes aligned.
  if absdir==reldir==sponsor and rr24*absdir>0 and r[72]*absdir>0:z['continue']=absdir
  if absdir==reldir==sponsor and rr24*absdir<0 and rr12*absdir>0:z['reentry']=absdir
  if absdir and (reldir==-absdir or sponsor==-absdir):z['reverse']=-absdir
  if absdir and sponsor==0 and (rr72*absdir<=0 or r[72]*absdir<=0):z['exhaust']=absdir
  z['strength']=abs(rr72)/(v[168]*math.sqrt(72)+1e-9)+abs(br-.5)+x['e168']
 else:
  slow=1 if rr168>0 and r[168]>0 else -1 if rr168<0 and r[168]<0 else 0
  sponsor=1 if br>.55 else -1 if br<.45 else 0
  fast=1 if rr12>0 and r[12]>0 else -1 if rr12<0 and r[12]<0 else 0
  z['bias']=slow if slow and sponsor in (0,slow) else 0
  # High-beta burst: shock identifies PRE_WAVE, but no entry until reset/reacceleration with sponsor support.
  if slow and shock>1.05 and fast==slow and sponsor in (0,slow):z['prewave']=slow
  reset=(r[24]*slow<0 or rr24*slow<0)
  if slow and reset and fast==slow and sponsor in (0,slow):z['onset']=slow
  if slow==sponsor and rr72*slow>0 and r[72]*slow>0 and shock>=.80:z['continue']=slow
  if slow==sponsor and rr24*slow<0 and fast==slow:z['reentry']=slow
  if slow and (rr168*slow<0 or (sponsor==-slow and rr72*slow<0)):z['reverse']=-slow
  if slow and shock<.72 and rr24*slow<=0:z['exhaust']=slow
  z['strength']=abs(rr72)/(v[168]*math.sqrt(72)+1e-9)+shock+abs(br-.5)
 return z

v133.sig=signal

def run(cid):
 candles,idx,_=v109.b.base.load();ps=v109.b.base.periods(candles)
 dm,_=v133.metr(cid,candles,idx,ps['development'],v133.NORMAL_BPS,0);vm,_=v133.metr(cid,candles,idx,ps['validation'],v133.NORMAL_BPS,0);vs,_=v133.metr(cid,candles,idx,ps['validation'],v133.STRESS_BPS,1)
 dw=v133.wave_diag(cid,candles,idx,ps['development']);vw=v133.wave_diag(cid,candles,idx,ps['validation']);df=v133.folds(cid,candles,idx,ps['development']);vf=v133.folds(cid,candles,idx,ps['validation'])
 adequate=dm.get('trades',0)>=8 and vm.get('trades',0)>=4;stable=df['positivePfFolds']>=2 and vf['positivePfFolds']>=2;broad=vw['captureRatePct']>=20 and (vw['medianWaveMfeCapturedPct'] or 0)>=20 and vw['falseStartRatePct']<=40
 promote=adequate and stable and broad and (dm.get('pf') or 0)>=1.2 and dm.get('returnPct',0)>0 and (vm.get('pf') or 0)>=1.2 and vm.get('returnPct',0)>0 and (vs.get('pf') or 0)>1 and vm.get('maxDDPct',-999)>-20
 res={'strategyId':'V136_'+cid.upper(),'pair':CANDS[cid][0],'periods':{'development':ps['development'],'validation':ps['validation'],'confirmation':'UNTOUCHED','holdout':'UNTOUCHED'},'development':dm,'validation':vm,'validationStress':vs,'waveDiagnostics':{'development':dw,'validation':vw},'walkForward':{'development':df,'validation':vf},'researchMultiplicity':{'family':'STRUCTURAL_LIFECYCLE_REPAIR','generation':136,'candidatesThisBatch':5},'status':'FROZEN_SURVIVOR' if promote else 'FAIL','reason':'DEV_VALIDATION_GATE','architecture':'PERSISTENT_LIFECYCLE_V22_REPAIR','productionChanged':False,'realTradingEnabled':False}
 out=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state'));out.mkdir(parents=True,exist_ok=True);stem='active4-v136-'+cid;txt=json.dumps(res,indent=2);(out/f'{stem}.json').write_text(txt);(out/f'{stem}.md').write_text('# '+res['strategyId']+'\n\n```json\n'+txt+'\n```\n');print(txt)
if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('--candidate',choices=sorted(CANDS),required=True);run(ap.parse_args().candidate)
