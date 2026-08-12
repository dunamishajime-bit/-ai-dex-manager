from __future__ import annotations
import argparse,json,math,os,statistics
from pathlib import Path
import research_active4_v133_engine_v21 as v133

# V145 CLEAN SHEET. Built from V119-V144 Development/Validation diagnosis only.
# IMPORTANT: no V136-V144 signal() is imported or wrapped. We reuse only the corrected
# persistent lifecycle executor/metrics and raw causal feature primitives.
engine=v133.engine; p=engine.p; ret=engine.ret; v109=v133.v109; HOUR=engine.HOUR
NORMAL_BPS=v133.NORMAL_BPS; STRESS_BPS=v133.STRESS_BPS

CANDS={
 'btc_major_wave_scout_cs_v15':('BTC','btc_breadth_decay_owner',.32,'MAJOR_WAVE_OWNERSHIP'),
 'btc_pullback_wave_scout_cs_v15':('BTC','btc_dual_consensus_owner',.32,'MAJOR_WAVE_OWNERSHIP'),
 'eth_leadership_acceleration_cs_v15':('ETH','eth_transition_owner',.30,'RELATIVE_LEADERSHIP_ACCELERATION'),
 'bnb_relative_impulse_scout_cs_v15':('BNB','bnb_neutral_compression_release',.28,'RELATIVE_IMPULSE_SCOUT'),
 'avax_volatility_event_cs_v15':('AVAX','avax_burst_scout_handoff',.18,'VOLATILITY_EVENT'),
}

def blank():
 return {'bias':0,'prewave':0,'onset':0,'continue':0,'reentry':0,'reverse':0,'exhaust':0,'strength':0.0}

def rel(candles,idx,s,ts,n):
 i=idx[s].get(ts)
 return 0.0 if i is None else (ret(candles[s],i,n) or 0.0)-p.medmove(candles,idx,ts,n)

def rawfeat(cid,candles,idx,ts):
 # v132 identifiers are used only as raw-feature adapters; their signal functions are never called.
 feature_id=CANDS[cid][1]; raw_id=v133.v132.CANDS[feature_id][1]
 return engine.feat(raw_id,candles,idx,ts)

def signal(cid,candles,idx,ts):
 z=blank(); pair=CANDS[cid][0]; x=rawfeat(cid,candles,idx,ts)
 if not x:return z
 r=x['r'];v=x['v'];br=x['br'];c=x['c'];i=x['i'];shock=x['shock'];sl72=p.slope(c,i,72);sl168=x['sl168']
 sponsor=1 if br>.5 else -1 if br<.5 else 0
 rr6=rel(candles,idx,pair,ts,6);rr12=rel(candles,idx,pair,ts,12);rr24=rel(candles,idx,pair,ts,24);rr72=rel(candles,idx,pair,ts,72);rr168=rel(candles,idx,pair,ts,168)

 if cid=='btc_major_wave_scout_cs_v15':
  # Diagnosis response: stop adding confirmations. Scout compression early, then let expansion earn Core size.
  slow=1 if r[336]>0 and sl168>0 else -1 if r[336]<0 and sl168<0 else 0
  med=1 if r[72]>0 and sl72>0 else -1 if r[72]<0 and sl72<0 else 0
  fast=1 if r[6]>0 and r[12]>0 else -1 if r[6]<0 and r[12]<0 else 0
  z['bias']=slow if slow and med in (0,slow) else 0
  if slow and v[48]<v[168] and med!=-slow:z['prewave']=slow
  if slow and fast==slow and sponsor!=-slow:z['onset']=slow
  if slow and med==slow and sponsor!=-slow and r[24]*slow>0:z['continue']=slow
  if slow and med==slow and r[24]*slow<0 and r[12]*slow>0 and sponsor!=-slow:z['reentry']=slow
  if slow and med==-slow and sponsor==-slow:z['reverse']=-slow
  if slow and fast==-slow and med==0:z['exhaust']=slow
  z['strength']=abs(x['z168'])+x['e168']+x['e72']

 elif cid=='btc_pullback_wave_scout_cs_v15':
  # Distinct BTC route: enter the re-acceleration of an existing slow wave after a medium pullback.
  slow=1 if r[336]>0 and sl168>0 else -1 if r[336]<0 and sl168<0 else 0
  med=1 if r[72]>0 and sl72>0 else -1 if r[72]<0 and sl72<0 else 0
  fast=1 if r[6]>0 and r[12]>0 else -1 if r[6]<0 and r[12]<0 else 0
  z['bias']=slow
  if slow and r[24]*slow<0 and sponsor!=-slow:z['prewave']=slow
  if slow and fast==slow and r[24]*slow<=0:z['onset']=slow
  if slow and med==slow and r[24]*slow>0 and sponsor!=-slow:z['continue']=slow
  if slow and med==slow and r[24]*slow<0 and fast==slow:z['reentry']=slow
  if slow and med==-slow and fast==-slow:z['reverse']=-slow
  if slow and sponsor==-slow and fast!=slow:z['exhaust']=slow
  z['strength']=abs(x['z168'])+x['e72']+abs(br-.5)

 elif cid=='eth_leadership_acceleration_cs_v15':
  # Diagnosis response: trade CHANGE in ETH-vs-BTC leadership, not a static high leadership level.
  bi=idx['BTC'].get(ts)
  if bi is None or bi<336:return z
  btc=candles['BTC'];q={n:r[n]-(ret(btc,bi,n) or 0.0) for n in (12,24,72,168)}
  fast_vel=q[12]/math.sqrt(12); med_vel=q[72]/math.sqrt(72); slow_vel=q[168]/math.sqrt(168)
  accel=fast_vel-med_vel; side=1 if accel>0 else -1 if accel<0 else 0
  z['bias']=side if side and r[168]*side>=0 else 0
  if side and fast_vel*side>0 and (med_vel-slow_vel)*side>=0:z['prewave']=side
  if side and q[12]*side>0 and r[12]*side>0:z['onset']=side
  if side and q[24]*side>0 and q[72]*side>0 and r[72]*side>0:z['continue']=side
  if side and q[24]*side<0 and q[12]*side>0 and r[12]*side>0:z['reentry']=side
  if side and q[24]*side<0 and accel*side<0:z['reverse']=-side
  if side and fast_vel*side<=0 and med_vel*side<=0:z['exhaust']=side
  z['strength']=abs(accel)/(v[168]+1e-9)+abs(q[24])/(v[168]*math.sqrt(24)+1e-9)

 elif cid=='bnb_relative_impulse_scout_cs_v15':
  # Diagnosis response: consensus is NOT an entry prerequisite. Relative impulse scouts first;
  # absolute/breadth votes decide only whether the scout earns a short tactical extension.
  side=1 if rr12>0 and r[6]>0 else -1 if rr12<0 and r[6]<0 else 0
  fast=1 if rr6>0 and r[12]>0 else -1 if rr6<0 and r[12]<0 else 0
  votes=(1 if rr24*side>0 else 0)+(1 if r[24]*side>0 else 0)+(1 if sponsor==side else 0) if side else 0
  z['bias']=side
  if side:z['prewave']=side
  if side and fast==side:z['onset']=side
  if side and votes>=2:z['continue']=side
  z['reentry']=0  # tactical role: no late re-entry
  if side and rr24*side<0 and r[24]*side<0:z['reverse']=-side
  if side and fast!=side and votes<2:z['exhaust']=side
  z['strength']=abs(rr12)/(v[168]*math.sqrt(12)+1e-9)+abs(rr24)/(v[168]*math.sqrt(24)+1e-9)

 else:
  # Diagnosis response: AVAX is an event trader, not a multi-day core owner.
  event=(v[24]>v[168]) or (shock>1.0)
  side=1 if rr6>0 and r[6]>0 else -1 if rr6<0 and r[6]<0 else 0
  z['bias']=side if event else 0
  if event and side and sponsor!=-side:z['prewave']=side
  if event and side and rr12*side>0 and r[12]*side>0:z['onset']=side
  if event and side and rr24*side>0 and r[24]*side>0 and sponsor!=-side:z['continue']=side
  z['reentry']=0
  if side and rr12*side<0 and r[12]*side<0:z['reverse']=-side
  if side and (not event or sponsor==-side):z['exhaust']=side
  z['strength']=shock+abs(rr12)/(v[168]*math.sqrt(12)+1e-9)+abs(br-.5)
 return z

def dyn_size(cid,candles,idx,ts):
 x=rawfeat(cid,candles,idx,ts);base=CANDS[cid][2]
 if not x:return base*.5
 realized=max(x['v'][168]*math.sqrt(24),1e-9)
 scale=max(.55,min(1.25,3.0/realized))
 return max(.10,min(.62,base*scale))

# Use corrected persistent lifecycle engine, but replace its candidate registry/signal/sizing only.
v133.CANDS.clear();v133.CANDS.update({k:(v[0],v[1],v[2]) for k,v in CANDS.items()})
v133.sig=signal;v133.dyn_size=dyn_size

def role_diag(cid,candles,idx,period,trades):
 start,end=period;pair=CANDS[cid][0];events=[];last=0
 for row in candles[pair]:
  ts=int(row['ts'])
  if not(start<=ts<end) or ts-last<12*HOUR:continue
  z=signal(cid,candles,idx,ts);side=int(z['onset'] or 0)
  if not side:continue
  hit=next((t for t in trades if t['side']==side and ts<=t['entryTs']<=ts+12*HOUR),None)
  events.append({'ts':ts,'side':side,'captured':hit is not None});last=ts
 return {'role':CANDS[cid][3],'events':len(events),'captured':sum(e['captured'] for e in events),
  'eventCaptureRatePct':100*sum(e['captured'] for e in events)/len(events) if events else 0,
  'tradeStarvation':len(trades)<4}

def diagnosis(vm,vw,rd):
 if vm.get('trades',0)<4:return 'TRADE_STARVATION'
 if (vm.get('pfWithoutBest') or 0)<1:return 'BEST_TRADE_CONCENTRATION'
 if vm.get('falseStartRatePct',0)>50:return 'FALSE_START_DOMINANT'
 if (vm.get('pf') or 0)<1:return 'NEGATIVE_EXPECTANCY'
 if rd['eventCaptureRatePct']<20:return 'ROLE_EVENT_CAPTURE_WEAK'
 if (vw.get('medianWaveMfeCapturedPct') or 0)<20 and rd['role']=='MAJOR_WAVE_OWNERSHIP':return 'WAVE_OWNERSHIP_WEAK'
 return 'STRESS_OR_FOLD_STABILITY'

def run(cid):
 candles,idx,_=v109.b.base.load();ps=v109.b.base.periods(candles)
 dm,dtr=v133.metr(cid,candles,idx,ps['development'],NORMAL_BPS,0);vm,vtr=v133.metr(cid,candles,idx,ps['validation'],NORMAL_BPS,0);vs,_=v133.metr(cid,candles,idx,ps['validation'],STRESS_BPS,1)
 dw=v133.wave_diag(cid,candles,idx,ps['development']);vw=v133.wave_diag(cid,candles,idx,ps['validation']);df=v133.folds(cid,candles,idx,ps['development']);vf=v133.folds(cid,candles,idx,ps['validation'])
 dr=role_diag(cid,candles,idx,ps['development'],dtr);vr=role_diag(cid,candles,idx,ps['validation'],vtr)
 adequate=dm.get('trades',0)>=8 and vm.get('trades',0)>=4;stable=df['positivePfFolds']>=2 and vf['positivePfFolds']>=2
 common=adequate and stable and (dm.get('pf') or 0)>=1.2 and dm.get('returnPct',0)>0 and (vm.get('pf') or 0)>=1.2 and vm.get('returnPct',0)>0 and (vs.get('pf') or 0)>1 and vm.get('maxDDPct',-999)>-20 and (vm.get('pfWithoutBest') or 0)>=1
 role=CANDS[cid][3]
 role_ok=(vw['captureRatePct']>=20 and (vw['medianWaveMfeCapturedPct'] or 0)>=20) if role=='MAJOR_WAVE_OWNERSHIP' else (vr['events']>=4 and vr['eventCaptureRatePct']>0)
 promote=common and role_ok
 res={'strategyId':'V145_'+cid.upper(),'pair':CANDS[cid][0],'role':role,'periods':{'development':ps['development'],'validation':ps['validation'],'confirmation':'UNTOUCHED','holdout':'UNTOUCHED'},
  'development':dm,'validation':vm,'validationStress':vs,'waveDiagnostics':{'development':dw,'validation':vw},'roleDiagnostics':{'development':dr,'validation':vr},
  'walkForward':{'development':df,'validation':vf},'diagnosis':diagnosis(vm,vw,vr),'researchMultiplicity':{'family':'CLEAN_SHEET_PAIR_ROLES','generation':145,'candidatesThisBatch':5},
  'status':'FROZEN_SURVIVOR' if promote else 'FAIL','reason':'DEV_VALIDATION_ROLE_GATE','architecture':'CLEAN_SHEET_RAW_CAUSAL_V15','inheritsV136toV144Signals':False,'productionChanged':False,'realTradingEnabled':False}
 out=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state'));out.mkdir(parents=True,exist_ok=True);stem='active4-v145-'+cid;txt=json.dumps(res,indent=2)
 (out/f'{stem}.json').write_text(txt);(out/f'{stem}.md').write_text('# '+res['strategyId']+'\n\n```json\n'+txt+'\n```\n');print(txt)

if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('--candidate',choices=sorted(CANDS),required=True);run(ap.parse_args().candidate)
