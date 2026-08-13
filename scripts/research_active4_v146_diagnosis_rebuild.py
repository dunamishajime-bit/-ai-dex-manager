from __future__ import annotations
import argparse,json,math,os
from pathlib import Path
import research_active4_v133_engine_v21 as v133

# V146: diagnosis-driven rebuild from V145 Development/Validation evidence only.
# No V136-V145 signal() is imported/wrapped. Confirmation/Holdout remain untouched.
engine=v133.engine; p=engine.p; ret=engine.ret; v109=v133.v109; HOUR=engine.HOUR
NORMAL_BPS=v133.NORMAL_BPS; STRESS_BPS=v133.STRESS_BPS

CANDS={
 'btc_expansion_decay_owner_cs_v16':('BTC','btc_breadth_decay_owner',.32,'MAJOR_WAVE_OWNERSHIP'),
 'btc_pullback_probation_owner_cs_v16':('BTC','btc_dual_consensus_owner',.30,'MAJOR_WAVE_OWNERSHIP'),
 'eth_relative_velocity_handoff_cs_v16':('ETH','eth_transition_owner',.28,'RELATIVE_LEADERSHIP_ACCELERATION'),
 'bnb_impulse_probation_extension_cs_v16':('BNB','bnb_neutral_compression_release',.24,'RELATIVE_IMPULSE_SCOUT'),
 'avax_event_direction_handoff_cs_v16':('AVAX','avax_burst_scout_handoff',.16,'VOLATILITY_EVENT'),
}

def blank(): return {'bias':0,'prewave':0,'onset':0,'continue':0,'reentry':0,'reverse':0,'exhaust':0,'strength':0.0}

def rel(candles,idx,s,ts,n):
 i=idx[s].get(ts)
 return 0.0 if i is None else (ret(candles[s],i,n) or 0.0)-p.medmove(candles,idx,ts,n)

def rawfeat(cid,candles,idx,ts):
 feature_id=CANDS[cid][1]; raw_id=v133.v132.CANDS[feature_id][1]
 return engine.feat(raw_id,candles,idx,ts)

def side3(x): return 1 if x>0 else -1 if x<0 else 0

def signal(cid,candles,idx,ts):
 z=blank(); pair=CANDS[cid][0]; x=rawfeat(cid,candles,idx,ts)
 if not x:return z
 r=x['r'];v=x['v'];br=x['br'];c=x['c'];i=x['i'];shock=x['shock'];sl72=p.slope(c,i,72);sl168=x['sl168']
 sponsor=side3(br-.5)
 rr6=rel(candles,idx,pair,ts,6);rr12=rel(candles,idx,pair,ts,12);rr24=rel(candles,idx,pair,ts,24);rr72=rel(candles,idx,pair,ts,72)

 if cid=='btc_expansion_decay_owner_cs_v16':
  # V145 diagnosis: Dev was strong but Val lost ownership (MFE capture 11.9%, giveback 3.50%).
  # Enter early as before, but Core ownership is terminated by medium expansion decay instead of waiting for full reversal.
  slow=side3(r[336]) if r[336]*sl168>0 else 0; med=side3(r[72]) if r[72]*sl72>0 else 0; fast=side3(r[6]+r[12])
  z['bias']=slow if slow and med in (0,slow) else 0
  if slow and v[48]<v[168] and med!=-slow:z['prewave']=slow
  if slow and fast==slow and sponsor!=-slow:z['onset']=slow
  if slow and med==slow and r[24]*slow>0 and sponsor!=-slow:z['continue']=slow
  # Only one pullback/reclaim route; no repeated late-wave recycling.
  if slow and med==slow and r[24]*slow<0 and r[12]*slow>0 and sponsor==slow:z['reentry']=slow
  # Economic exit: loss of 24h expansion while fast also stops supporting, before slow trend reverses.
  if slow and r[24]*slow<=0 and fast!=slow:z['exhaust']=slow
  if slow and med==-slow and fast==-slow:z['reverse']=-slow
  z['strength']=abs(x['z168'])+x['e72']+abs(r[24])/(v[168]*math.sqrt(24)+1e-9)

 elif cid=='btc_pullback_probation_owner_cs_v16':
  # V145 pullback route had Val PF 3.60 but 88.9% false starts / one Core trade.
  # Scout the pullback, then require immediate re-acceleration to earn ownership; failed scouts expire quickly.
  slow=side3(r[336]) if r[336]*sl168>0 else 0; fast=side3(r[6]+r[12]); med=side3(r[72])
  z['bias']=slow
  pullback=bool(slow and r[24]*slow<0 and sponsor!=-slow)
  if pullback:z['prewave']=slow
  if pullback and fast==slow:z['onset']=slow
  if slow and fast==slow and med==slow and r[24]*slow>0:z['continue']=slow
  z['reentry']=0
  if slow and (fast==-slow or (r[12]*slow<=0 and sponsor==-slow)):z['exhaust']=slow
  if slow and med==-slow and fast==-slow:z['reverse']=-slow
  z['strength']=abs(x['z168'])+abs(r[12])/(v[168]*math.sqrt(12)+1e-9)

 elif cid=='eth_relative_velocity_handoff_cs_v16':
  # V145 acceleration sign alone failed all Val folds. Trade a causal handoff: relative fast velocity must overtake
  # medium velocity while absolute ETH price confirms; exit when the velocity handoff collapses.
  bi=idx['BTC'].get(ts)
  if bi is None or bi<336:return z
  btc=candles['BTC'];q={n:r[n]-(ret(btc,bi,n) or 0.0) for n in (6,12,24,72)}
  fv=(q[6]+q[12])/2; mv=q[72]; delta=fv-mv
  side=side3(delta); absfast=side3(r[6]+r[12]); relfast=side3(fv)
  z['bias']=side if side==absfast else 0
  if side and relfast==side and absfast==side:z['prewave']=side
  if side and q[12]*side>0 and r[12]*side>0:z['onset']=side
  if side and q[24]*side>0 and r[24]*side>0 and fv*side>0:z['continue']=side
  z['reentry']=0
  if side and (fv*side<=0 or r[12]*side<=0):z['exhaust']=side
  if side and delta*side<0 and absfast==-side:z['reverse']=-side
  z['strength']=abs(delta)/(v[168]+1e-9)+abs(q[12])/(v[168]*math.sqrt(12)+1e-9)

 elif cid=='bnb_impulse_probation_extension_cs_v16':
  # V145 fixed starvation but Val false-start rose to 53.3%. Keep broad scout access, shorten failed scouts.
  impulse=rr6+rr12; side=side3(impulse); fast=side3(rr6+r[6]);
  z['bias']=side
  if side:z['prewave']=side
  if side and fast==side:z['onset']=side
  votes=(1 if rr24*side>0 else 0)+(1 if r[24]*side>0 else 0)+(1 if sponsor==side else 0) if side else 0
  # Consensus remains continuation evidence only, never an entry prerequisite.
  if side and votes>=2 and rr12*side>0:z['continue']=side
  z['reentry']=0
  # Probation failure: if the impulse does not persist into 12/24h path, exit rather than holding ~28h.
  if side and (rr12*side<=0 or (fast!=side and votes<2)):z['exhaust']=side
  if side and rr24*side<0 and r[24]*side<0:z['reverse']=-side
  z['strength']=abs(impulse)/(v[168]*math.sqrt(12)+1e-9)+abs(rr24)/(v[168]*math.sqrt(24)+1e-9)

 else:
  # V145 AVAX captured ~38% of events but PF<0.6: event presence was not the problem, direction ownership was.
  # Separate shock detection from direction handoff; only directionally synchronized event expansion can own Core.
  event=(v[24]>v[168]) or shock>1.0
  fast=side3(rr6+r[6]); med=side3(rr24+r[24]); side=fast if event else 0
  z['bias']=side
  if event and side:z['prewave']=side
  if event and side and rr12*side>0 and r[12]*side>0:z['onset']=side
  if event and side and med==side and sponsor!=-side:z['continue']=side
  z['reentry']=0
  # Event expiry and directional de-synchronization are immediate Cash triggers.
  if side and (not event or med==-side or sponsor==-side):z['exhaust']=side
  if side and rr12*side<0 and r[12]*side<0:z['reverse']=-side
  z['strength']=shock+abs(rr12)/(v[168]*math.sqrt(12)+1e-9)+abs(rr24)/(v[168]*math.sqrt(24)+1e-9)
 return z

def dyn_size(cid,candles,idx,ts):
 x=rawfeat(cid,candles,idx,ts);base=CANDS[cid][2]
 if not x:return base*.5
 realized=max(x['v'][168]*math.sqrt(24),1e-9);scale=max(.55,min(1.20,3.0/realized))
 return max(.08,min(.55,base*scale))

v133.CANDS.clear();v133.CANDS.update({k:(v[0],v[1],v[2]) for k,v in CANDS.items()});v133.sig=signal;v133.dyn_size=dyn_size

def role_diag(cid,candles,idx,period,trades):
 start,end=period;pair=CANDS[cid][0];events=[];last=0
 for row in candles[pair]:
  ts=int(row['ts'])
  if not(start<=ts<end) or ts-last<12*HOUR:continue
  z=signal(cid,candles,idx,ts);side=int(z['onset'] or 0)
  if not side:continue
  hit=next((t for t in trades if t['side']==side and ts<=t['entryTs']<=ts+12*HOUR),None)
  events.append(hit is not None);last=ts
 return {'role':CANDS[cid][3],'events':len(events),'captured':sum(events),'eventCaptureRatePct':100*sum(events)/len(events) if events else 0,'tradeStarvation':len(trades)<4}

def dominant(dm,vm,vs,vw,vr):
 if vm.get('trades',0)<4:return 'TRADE_STARVATION'
 if dm.get('returnPct',0)>0 and vm.get('returnPct',0)<0:return 'DEV_TO_VAL_REGIME_BREAK'
 if vm.get('falseStartRatePct',0)>50:return 'FALSE_START_DOMINANT'
 if vm.get('wrongCoreOwnership',0)>0:return 'WRONG_CORE_OWNERSHIP'
 if (vm.get('pfWithoutBest') or 0)<1:return 'BROAD_EDGE_WEAK'
 if (vs.get('pf') or 0)<1:return 'STRESS_EDGE_WEAK'
 if CANDS[next(k for k,v in CANDS.items() if v[0]==CANDS[next(iter(CANDS))][0])][3]=='MAJOR_WAVE_OWNERSHIP' and (vw.get('medianWaveMfeCapturedPct') or 0)<20:return 'MFE_CAPTURE_WEAK'
 return 'FOLD_OR_EXPECTANCY_WEAK'

def run(cid):
 candles,idx,_=v109.b.base.load();ps=v109.b.base.periods(candles)
 dm,dtr=v133.metr(cid,candles,idx,ps['development'],NORMAL_BPS,0);vm,vtr=v133.metr(cid,candles,idx,ps['validation'],NORMAL_BPS,0);vs,_=v133.metr(cid,candles,idx,ps['validation'],STRESS_BPS,1)
 dw=v133.wave_diag(cid,candles,idx,ps['development']);vw=v133.wave_diag(cid,candles,idx,ps['validation']);df=v133.folds(cid,candles,idx,ps['development']);vf=v133.folds(cid,candles,idx,ps['validation']);dr=role_diag(cid,candles,idx,ps['development'],dtr);vr=role_diag(cid,candles,idx,ps['validation'],vtr)
 adequate=dm.get('trades',0)>=8 and vm.get('trades',0)>=4;stable=df['positivePfFolds']>=2 and vf['positivePfFolds']>=2
 common=adequate and stable and (dm.get('pf') or 0)>=1.2 and dm.get('returnPct',0)>0 and (vm.get('pf') or 0)>=1.2 and vm.get('returnPct',0)>0 and (vs.get('pf') or 0)>1 and vm.get('maxDDPct',-999)>-20 and (vm.get('pfWithoutBest') or 0)>=1
 role=CANDS[cid][3];role_ok=(vw['captureRatePct']>=20 and (vw['medianWaveMfeCapturedPct'] or 0)>=20) if role=='MAJOR_WAVE_OWNERSHIP' else (vr['events']>=4 and vr['eventCaptureRatePct']>0)
 res={'strategyId':'V146_'+cid.upper(),'pair':CANDS[cid][0],'role':role,'periods':{'development':ps['development'],'validation':ps['validation'],'confirmation':'UNTOUCHED','holdout':'UNTOUCHED'},'development':dm,'validation':vm,'validationStress':vs,'waveDiagnostics':{'development':dw,'validation':vw},'roleDiagnostics':{'development':dr,'validation':vr},'walkForward':{'development':df,'validation':vf},'diagnosis':dominant(dm,vm,vs,vw,vr),'researchMultiplicity':{'family':'DIAGNOSIS_DRIVEN_CLEAN_SHEET','generation':146,'candidatesThisBatch':5},'status':'FROZEN_SURVIVOR' if common and role_ok else 'FAIL','reason':'DEV_VALIDATION_ROLE_GATE','architecture':'CLEAN_SHEET_RAW_CAUSAL_V16','inheritsPriorSignals':False,'productionChanged':False,'realTradingEnabled':False}
 out=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state'));out.mkdir(parents=True,exist_ok=True);stem='active4-v146-'+cid;txt=json.dumps(res,indent=2);(out/f'{stem}.json').write_text(txt);(out/f'{stem}.md').write_text('# '+res['strategyId']+'\n\n```json\n'+txt+'\n```\n');print(txt)

if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('--candidate',choices=sorted(CANDS),required=True);run(ap.parse_args().candidate)
