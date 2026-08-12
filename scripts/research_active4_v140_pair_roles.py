from __future__ import annotations
import argparse,json,math,os
from pathlib import Path
import research_active4_v136_lifecycle_repair as v136

# V140: materially distinct pair-specific role systems derived ONLY from V138/V139 Development/Validation diagnostics.
# Confirmation/Holdout are untouched. No dense sweep, no threshold/risk/trail retuning.
engine=v136.engine; v133=v136.v133; v109=v136.v109
H=v109.HOUR

CANDS={
 'btc_wave_sponsorship_handoff_v10':('BTC','btc_breadth_decay_owner',.32),
 'btc_reacceleration_owner_v10':('BTC','btc_breadth_decay_owner',.32),
 'eth_relative_regime_handoff_v10':('ETH','eth_transition_owner',.30),
 'bnb_twoofthree_transition_cash_v10':('BNB','bnb_neutral_compression_release',.28),
 'avax_shock_reacceleration_event_v10':('AVAX','avax_burst_scout_handoff',.18),
}
v136.CANDS.clear();v136.CANDS.update(CANDS)
v133.CANDS.clear();v133.CANDS.update(CANDS)

def blank(): return {'bias':0,'prewave':0,'onset':0,'continue':0,'reentry':0,'reverse':0,'exhaust':0,'strength':0.0}

def rel(candles,idx,s,ts,n):
 i=idx[s].get(ts)
 return 0.0 if i is None else (engine.ret(candles[s],i,n) or 0.0)-engine.p.medmove(candles,idx,ts,n)

def signal(cid,candles,idx,ts):
 z=blank(); pair,old,_=CANDS[cid]
 base=__import__('research_active4_v132_transition_arch').CANDS[old][1]
 x=engine.feat(base,candles,idx,ts)
 if not x:return z
 r=x['r'];v=x['v'];br=x['br'];c=x['c'];i=x['i'];shock=x['shock'];sl72=engine.p.slope(c,i,72);sl168=x['sl168']
 rr12=rel(candles,idx,pair,ts,12);rr24=rel(candles,idx,pair,ts,24);rr72=rel(candles,idx,pair,ts,72);rr168=rel(candles,idx,pair,ts,168)
 fast=1 if r[12]>0 and r[24]>0 else -1 if r[12]<0 and r[24]<0 else 0
 med=1 if r[72]>0 and sl72>0 else -1 if r[72]<0 and sl72<0 else 0
 slow=1 if r[336]>0 and sl168>0 else -1 if r[336]<0 and sl168<0 else 0
 sponsor=1 if br>.53 else -1 if br<.47 else 0

 if cid=='btc_wave_sponsorship_handoff_v10':
  # BTC role: large-wave owner. Compression with absent sponsor -> sponsor handoff -> durable expansion.
  z['bias']=slow if slow and med in (0,slow) else 0
  if slow and med in (0,-slow) and sponsor!=slow and v[48]<v[168]:z['prewave']=slow
  if slow and fast==slow and sponsor==slow and med in (0,slow):z['onset']=slow
  if slow==med==sponsor and r[24]*slow>0 and x['e72']>.06:z['continue']=slow
  if slow==med==sponsor and r[24]*slow<0 and r[12]*slow>0:z['reentry']=slow
  if slow and (med==-slow or (sponsor==-slow and fast==-slow)):z['reverse']=-slow
  if slow and sponsor!=slow and fast!=slow and x['e72']<.05:z['exhaust']=slow
  z['strength']=abs(x['z168'])+x['e72']+abs(br-.5)
 elif cid=='btc_reacceleration_owner_v10':
  # Distinct BTC mechanism: slow trend survives a medium pullback, then fast re-acceleration reclaims ownership.
  z['bias']=slow if slow else 0
  pull=slow and r[24]*slow<0 and med in (0,-slow)
  if pull and v[24]<=v[168]:z['prewave']=slow
  if slow and fast==slow and r[12]*slow>abs(r[24])*.35 and sponsor in (0,slow):z['onset']=slow
  if slow==med and sponsor in (0,slow) and r[72]*slow>0:z['continue']=slow
  if slow==med and r[24]*slow<0 and r[12]*slow>0 and sponsor in (0,slow):z['reentry']=slow
  if slow and fast==-slow and med==-slow:z['reverse']=-slow
  if slow and med==0 and fast!=slow and sponsor!=slow:z['exhaust']=slow
  z['strength']=abs(x['z168'])+abs(r[12])/(v[168]*math.sqrt(12)+1e-9)+abs(br-.5)
 elif cid=='eth_relative_regime_handoff_v10':
  # ETH role: selective relative-leadership regime, not 4-5h pulses. Needs absolute+relative medium agreement.
  bi=idx['BTC'].get(ts)
  if bi is None or bi<336:return z
  btc=candles['BTC'];q={n:r[n]-(engine.ret(btc,bi,n) or 0.0) for n in (12,24,72,168)}
  anchor=1 if r[168]>0 and sl168>0 else -1 if r[168]<0 and sl168<0 else 0
  lead=1 if q[168]>0 and q[72]>0 else -1 if q[168]<0 and q[72]<0 else 0
  z['bias']=lead if lead and anchor in (0,lead) and sponsor in (0,lead) else 0
  if anchor and q[72]*anchor<=0 and q[24]*anchor>q[72]*anchor and v[48]<v[168]:z['prewave']=anchor
  if anchor==lead and q[12]*lead>0 and r[12]*lead>0 and sponsor in (0,lead):z['onset']=lead
  if anchor==lead and sponsor in (0,lead) and q[72]*lead>0 and r[72]*lead>0:z['continue']=lead
  if anchor==lead and q[24]*lead<0 and q[12]*lead>0 and r[12]*lead>0:z['reentry']=lead
  if lead and (anchor==-lead or q[72]*lead<0 or sponsor==-lead):z['reverse']=-lead
  if lead and q[24]*lead<=0 and r[24]*lead<=0:z['exhaust']=lead
  z['strength']=abs(q[72])/(v[168]*math.sqrt(72)+1e-9)+x['e168']+abs(br-.5)
 elif cid=='bnb_twoofthree_transition_cash_v10':
  # BNB role: regime-selective tactical owner. Arm on 2-of-3 transition; full consensus only for continuation.
  absdir=1 if r[168]>0 and sl168>0 else -1 if r[168]<0 and sl168<0 else 0
  reldir=1 if rr168>0 and rr72>0 else -1 if rr168<0 and rr72<0 else 0
  votes=[absdir,reldir,sponsor]
  pos=votes.count(1);neg=votes.count(-1);twodir=1 if pos>=2 else -1 if neg>=2 else 0
  z['bias']=twodir
  if twodir and sponsor==0 and v[48]<v[168]:z['prewave']=twodir
  if twodir and fast==twodir and rr12*twodir>0:z['onset']=twodir
  if absdir==reldir==sponsor and absdir and rr24*absdir>0 and r[24]*absdir>0:z['continue']=absdir
  if absdir==reldir and absdir and rr24*absdir<0 and rr12*absdir>0 and sponsor in (0,absdir):z['reentry']=absdir
  if twodir and ((absdir==-twodir and reldir==-twodir) or sponsor==-twodir):z['reverse']=-twodir
  if twodir and votes.count(twodir)<2:z['exhaust']=twodir
  z['strength']=abs(rr72)/(v[168]*math.sqrt(72)+1e-9)+abs(br-.5)+x['e168']
 else:
  # AVAX role: high-beta volatility event. Shock creates setup; reset and re-acceleration trigger fast ownership.
  trend=1 if rr168>0 and r[168]>0 else -1 if rr168<0 and r[168]<0 else 0
  rfast=1 if rr12>0 and r[12]>0 else -1 if rr12<0 and r[12]<0 else 0
  z['bias']=trend if trend and sponsor in (0,trend) else 0
  if trend and shock>1.05 and sponsor in (0,trend):z['prewave']=trend
  reset=trend and (r[24]*trend<0 or rr24*trend<0)
  if reset and rfast==trend and sponsor in (0,trend):z['onset']=trend
  if trend and rfast==trend and rr72*trend>0 and sponsor in (0,trend) and shock>=.80:z['continue']=trend
  if trend and rr24*trend<0 and rr12*trend>0 and rfast==trend:z['reentry']=trend
  if trend and (rr72*trend<0 and sponsor==-trend):z['reverse']=-trend
  if trend and shock<.72 and rr24*trend<=0:z['exhaust']=trend
  z['strength']=abs(rr72)/(v[168]*math.sqrt(72)+1e-9)+shock+abs(br-.5)
 return z

v136.signal=signal;v133.sig=signal

def run(cid):
 candles,idx,_=v109.b.base.load();ps=v109.b.base.periods(candles)
 dm,_=v133.metr(cid,candles,idx,ps['development'],v133.NORMAL_BPS,0);vm,_=v133.metr(cid,candles,idx,ps['validation'],v133.NORMAL_BPS,0);vs,_=v133.metr(cid,candles,idx,ps['validation'],v133.STRESS_BPS,1)
 dw=v133.wave_diag(cid,candles,idx,ps['development']);vw=v133.wave_diag(cid,candles,idx,ps['validation']);df=v133.folds(cid,candles,idx,ps['development']);vf=v133.folds(cid,candles,idx,ps['validation'])
 adequate=dm.get('trades',0)>=8 and vm.get('trades',0)>=4;stable=df['positivePfFolds']>=2 and vf['positivePfFolds']>=2;broad=vw['captureRatePct']>=20 and (vw['medianWaveMfeCapturedPct'] or 0)>=20 and vw['falseStartRatePct']<=40
 promote=adequate and stable and broad and (dm.get('pf') or 0)>=1.2 and dm.get('returnPct',0)>0 and (vm.get('pf') or 0)>=1.2 and vm.get('returnPct',0)>0 and (vs.get('pf') or 0)>1 and vm.get('maxDDPct',-999)>-20
 res={'strategyId':'V140_'+cid.upper(),'pair':CANDS[cid][0],'periods':{'development':ps['development'],'validation':ps['validation'],'confirmation':'UNTOUCHED','holdout':'UNTOUCHED'},'development':dm,'validation':vm,'validationStress':vs,'waveDiagnostics':{'development':dw,'validation':vw},'walkForward':{'development':df,'validation':vf},'researchMultiplicity':{'family':'PAIR_SPECIFIC_ROLE_SYSTEMS','generation':140,'candidatesThisBatch':5},'status':'FROZEN_SURVIVOR' if promote else 'FAIL','reason':'DEV_VALIDATION_GATE','architecture':'PAIR_SPECIFIC_LARGE_WAVE_ROLE_V10','productionChanged':False,'realTradingEnabled':False}
 out=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state'));out.mkdir(parents=True,exist_ok=True);stem='active4-v140-'+cid;txt=json.dumps(res,indent=2);(out/f'{stem}.json').write_text(txt);(out/f'{stem}.md').write_text('# '+res['strategyId']+'\n\n```json\n'+txt+'\n```\n');print(txt)
if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('--candidate',choices=sorted(CANDS),required=True);run(ap.parse_args().candidate)
