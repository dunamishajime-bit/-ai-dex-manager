from __future__ import annotations
import argparse,json,math,os
from pathlib import Path
import research_active4_v133_engine_v21 as v133

# V147: effective clean-sheet rebuild from V146 Development/Validation diagnosis only.
# No prior candidate signal() is imported or wrapped. Confirmation/Holdout remain untouched.
engine=v133.engine; p=engine.p; ret=engine.ret; v109=v133.v109; HOUR=engine.HOUR
NORMAL_BPS=v133.NORMAL_BPS; STRESS_BPS=v133.STRESS_BPS

CANDS={
 'btc_wave_energy_owner_ecs_v17':('BTC','btc_breadth_decay_owner',.30,'MAJOR_WAVE_OWNERSHIP'),
 'btc_failed_wave_reversal_owner_ecs_v17':('BTC','btc_dual_consensus_owner',.28,'MAJOR_WAVE_OWNERSHIP'),
 'eth_follower_leader_inflection_ecs_v17':('ETH','eth_transition_owner',.26,'RELATIVE_LEADERSHIP_INFLECTION'),
 'bnb_relative_dislocation_reversion_ecs_v17':('BNB','bnb_neutral_compression_release',.22,'RELATIVE_DISLOCATION_REVERSION'),
 'avax_postshock_reset_reversal_ecs_v17':('AVAX','avax_burst_scout_handoff',.16,'POST_SHOCK_RESET_REVERSAL'),
}

def blank(): return {'bias':0,'prewave':0,'onset':0,'continue':0,'reentry':0,'reverse':0,'exhaust':0,'strength':0.0}
def side3(x): return 1 if x>0 else -1 if x<0 else 0

def rel(candles,idx,s,ts,n):
 i=idx[s].get(ts)
 return 0.0 if i is None else (ret(candles[s],i,n) or 0.0)-p.medmove(candles,idx,ts,n)

def rawfeat(cid,candles,idx,ts):
 feature_id=CANDS[cid][1]; raw_id=v133.v132.CANDS[feature_id][1]
 return engine.feat(raw_id,candles,idx,ts)

def signal(cid,candles,idx,ts):
 z=blank();pair=CANDS[cid][0];x=rawfeat(cid,candles,idx,ts)
 if not x:return z
 r=x['r'];v=x['v'];br=x['br'];c=x['c'];i=x['i'];shock=x['shock'];sl72=p.slope(c,i,72);sl168=x['sl168'];sponsor=side3(br-.5)
 rr6=rel(candles,idx,pair,ts,6);rr12=rel(candles,idx,pair,ts,12);rr24=rel(candles,idx,pair,ts,24);rr72=rel(candles,idx,pair,ts,72)
 vol=max(v[168],1e-9)

 if cid=='btc_wave_energy_owner_ecs_v17':
  # V146 expansion-decay owner failed every Val fold despite acceptable false-start rate.
  # Redesign OWNERSHIP: hold only while multi-horizon directional energy remains positive;
  # ownership is no longer a fixed 24h expansion/decay rule.
  slow=side3(r[336]) if r[336]*sl168>0 else 0
  fast=side3(r[6]+r[12]); med=side3(r[72]) if r[72]*sl72>0 else 0
  energy=((r[12]+r[24])*slow)/(vol*math.sqrt(24)+1e-9) if slow else 0.0
  medium_energy=(r[72]*slow)/(vol*math.sqrt(72)+1e-9) if slow else 0.0
  z['bias']=slow if slow else 0
  if slow and v[48]<v[168] and fast in (0,slow):z['prewave']=slow
  if slow and fast==slow and energy>0:z['onset']=slow
  if slow and med==slow and energy>0 and medium_energy>0:z['continue']=slow
  if slow and med==slow and energy<=0 and fast==slow:z['reentry']=slow
  if slow and (energy<0 and medium_energy<=0):z['exhaust']=slow
  if slow and fast==-slow and med==-slow:z['reverse']=-slow
  z['strength']=abs(energy)+abs(medium_energy)+abs(br-.5)

 elif cid=='btc_failed_wave_reversal_owner_ecs_v17':
  # V146 pullback probation still produced 87.5% false starts. Instead of filtering them harder,
  # treat a failed pullback continuation as a causal REVERSAL opportunity and own the opposite wave.
  slow=side3(r[336]) if r[336]*sl168>0 else 0; fast=side3(r[6]+r[12]); med=side3(r[72])
  failed=bool(slow and r[24]*slow<0 and fast==-slow)
  side=-slow if failed else 0
  z['bias']=side
  if failed:z['prewave']=side
  if failed and sponsor in (0,side):z['onset']=side
  if side and r[24]*side>0 and med==side:z['continue']=side
  if side and r[12]*side<0 and fast==side:z['reentry']=side
  if side and fast==-side:z['exhaust']=side
  if side and med==-side and sponsor==-side:z['reverse']=-side
  z['strength']=abs(r[24])/(vol*math.sqrt(24)+1e-9)+abs(r[72])/(vol*math.sqrt(72)+1e-9)

 elif cid=='eth_follower_leader_inflection_ecs_v17':
  # V146 fast-vs-medium velocity handoff was negative in all Dev folds and 2/3 Val folds.
  # New ENTRY thesis: trade the actual follower->leader inflection, not a velocity-level crossover.
  bi=idx['BTC'].get(ts)
  if bi is None or bi<336:return z
  btc=candles['BTC'];q={n:r[n]-(ret(btc,bi,n) or 0.0) for n in (6,12,24,72)}
  medium=side3(q[72]); fast=side3(q[6]+q[12]); absfast=side3(r[6]+r[12])
  side=fast if medium and fast==-medium and absfast==fast else 0
  z['bias']=side
  if side:z['prewave']=side
  if side and q[6]*side>0 and r[6]*side>0:z['onset']=side
  if side and q[24]*side>0 and r[24]*side>0:z['continue']=side
  z['reentry']=0
  if side and (q[12]*side<=0 or r[12]*side<=0):z['exhaust']=side
  if side and q[24]*side<0 and absfast==-side:z['reverse']=-side
  z['strength']=abs(q[6]+q[12])/(vol*math.sqrt(12)+1e-9)+abs(q[72])/(vol*math.sqrt(72)+1e-9)

 elif cid=='bnb_relative_dislocation_reversion_ecs_v17':
  # Two generations of relative-impulse continuation had high false starts and all Val folds <1.
  # Change economic role: test causal REVERSION after a relative dislocation begins to reverse.
  stretch=side3(rr24); turn=side3(rr6); abs_turn=side3(r[6]); side=-stretch if stretch and turn==-stretch and abs_turn in (0,-stretch) else 0
  z['bias']=side
  if stretch:z['prewave']=-stretch
  if side:z['onset']=side
  if side and rr12*side>0 and r[12]*side>0:z['continue']=side
  z['reentry']=0
  if side and (rr6*side<=0 or r[6]*side<=0):z['exhaust']=side
  if side and rr24*side<0 and rr6*side<0:z['reverse']=-side
  z['strength']=abs(rr24)/(vol*math.sqrt(24)+1e-9)+abs(rr6)/(vol*math.sqrt(6)+1e-9)

 else:
  # V146 shock-continuation direction handoff had wrongCoreOwnership on 9/12 Val cores.
  # Change thesis from continuation to POST-SHOCK RESET/REVERSAL after energy decays.
  prev=rawfeat(cid,candles,idx,ts-6*HOUR)
  prevshock=prev['shock'] if prev else shock
  stretch=side3(rr24+r[24]); counter=side3(rr6+r[6]); reset=bool(prevshock>1.0 and shock<prevshock)
  side=-stretch if reset and stretch and counter==-stretch else 0
  z['bias']=side
  if prevshock>1.0 and stretch:z['prewave']=-stretch
  if side:z['onset']=side
  if side and rr12*side>0 and r[12]*side>0 and shock<=prevshock:z['continue']=side
  z['reentry']=0
  if side and (shock>prevshock or counter==-side):z['exhaust']=side
  if side and rr12*side<0 and r[12]*side<0:z['reverse']=-side
  z['strength']=prevshock-shock+abs(rr24)/(vol*math.sqrt(24)+1e-9)+abs(rr6)/(vol*math.sqrt(6)+1e-9)
 return z

def dyn_size(cid,candles,idx,ts):
 x=rawfeat(cid,candles,idx,ts);base=CANDS[cid][2]
 if not x:return base*.5
 realized=max(x['v'][168]*math.sqrt(24),1e-9);scale=max(.55,min(1.20,3.0/realized))
 return max(.08,min(.50,base*scale))

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

def dominant(cid,dm,vm,vs,vw,vr):
 if vm.get('trades',0)<4:return 'TRADE_STARVATION'
 if dm.get('returnPct',0)>0 and vm.get('returnPct',0)<0:return 'DEV_TO_VAL_REGIME_BREAK'
 ft=vm.get('failureTaxonomy') or {}
 if ft.get('wrongCoreOwnership',0)>max(2,vm.get('trades',0)*.25):return 'WRONG_CORE_OWNERSHIP'
 if vm.get('falseStartRatePct',0)>50:return 'FALSE_START_DOMINANT'
 if CANDS[cid][3]=='MAJOR_WAVE_OWNERSHIP' and (vw.get('medianWaveMfeCapturedPct') or 0)<20:return 'MFE_CAPTURE_WEAK'
 if (vm.get('pfWithoutBest') or 0)<1:return 'BROAD_EDGE_WEAK'
 if (vs.get('pf') or 0)<1:return 'STRESS_EDGE_WEAK'
 if vr.get('eventCaptureRatePct',0)<20:return 'ROLE_EVENT_CAPTURE_WEAK'
 return 'FOLD_OR_EXPECTANCY_WEAK'

def run(cid):
 candles,idx,_=v109.b.base.load();ps=v109.b.base.periods(candles)
 dm,dtr=v133.metr(cid,candles,idx,ps['development'],NORMAL_BPS,0);vm,vtr=v133.metr(cid,candles,idx,ps['validation'],NORMAL_BPS,0);vs,_=v133.metr(cid,candles,idx,ps['validation'],STRESS_BPS,1)
 dw=v133.wave_diag(cid,candles,idx,ps['development']);vw=v133.wave_diag(cid,candles,idx,ps['validation']);df=v133.folds(cid,candles,idx,ps['development']);vf=v133.folds(cid,candles,idx,ps['validation']);dr=role_diag(cid,candles,idx,ps['development'],dtr);vr=role_diag(cid,candles,idx,ps['validation'],vtr)
 adequate=dm.get('trades',0)>=8 and vm.get('trades',0)>=4;stable=df['positivePfFolds']>=2 and vf['positivePfFolds']>=2
 common=adequate and stable and (dm.get('pf') or 0)>=1.2 and dm.get('returnPct',0)>0 and (vm.get('pf') or 0)>=1.2 and vm.get('returnPct',0)>0 and (vs.get('pf') or 0)>1 and vm.get('maxDDPct',-999)>-20 and (vm.get('pfWithoutBest') or 0)>=1
 role=CANDS[cid][3];role_ok=(vw['captureRatePct']>=20 and (vw['medianWaveMfeCapturedPct'] or 0)>=20) if role=='MAJOR_WAVE_OWNERSHIP' else (vr['events']>=4 and vr['eventCaptureRatePct']>0)
 res={'strategyId':'V147_'+cid.upper(),'pair':CANDS[cid][0],'role':role,'periods':{'development':ps['development'],'validation':ps['validation'],'confirmation':'UNTOUCHED','holdout':'UNTOUCHED'},'development':dm,'validation':vm,'validationStress':vs,'waveDiagnostics':{'development':dw,'validation':vw},'roleDiagnostics':{'development':dr,'validation':vr},'walkForward':{'development':df,'validation':vf},'diagnosis':dominant(cid,dm,vm,vs,vw,vr),'effectiveCleanSheet':True,'effectiveCleanSheetBasis':'material causal Entry/Ownership/Exit redesign from V146 D/V diagnosis','researchMultiplicity':{'family':'EFFECTIVE_CLEAN_SHEET','generation':147,'candidatesThisBatch':5},'status':'FROZEN_SURVIVOR' if common and role_ok else 'FAIL','reason':'DEV_VALIDATION_ROLE_GATE','architecture':'EFFECTIVE_CLEAN_SHEET_RAW_CAUSAL_V17','inheritsPriorSignals':False,'productionChanged':False,'realTradingEnabled':False}
 out=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state'));out.mkdir(parents=True,exist_ok=True);stem='active4-v147-'+cid;txt=json.dumps(res,indent=2);(out/f'{stem}.json').write_text(txt);(out/f'{stem}.md').write_text('# '+res['strategyId']+'\n\n```json\n'+txt+'\n```\n');print(txt)

if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('--candidate',choices=sorted(CANDS),required=True);run(ap.parse_args().candidate)
