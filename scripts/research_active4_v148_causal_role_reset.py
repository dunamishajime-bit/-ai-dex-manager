from __future__ import annotations
import argparse,json,math,os
from pathlib import Path
import research_active4_v133_engine_v21 as v133

# V148: material causal role reset from V147 Development/Validation diagnosis only.
# No V147/prior signal is imported or wrapped. Confirmation/Holdout untouched.
engine=v133.engine; p=engine.p; ret=engine.ret; v109=v133.v109; HOUR=engine.HOUR
NORMAL_BPS=v133.NORMAL_BPS; STRESS_BPS=v133.STRESS_BPS
CANDS={
 'btc_breadth_diffusion_owner_ecs_v18':('BTC','btc_breadth_decay_owner',.30,'MAJOR_WAVE_OWNERSHIP'),
 'btc_panic_recovery_owner_ecs_v18':('BTC','btc_dual_consensus_owner',.26,'MAJOR_WAVE_OWNERSHIP'),
 'eth_residual_rotation_owner_ecs_v18':('ETH','eth_transition_owner',.24,'RELATIVE_RESIDUAL_ROTATION'),
 'bnb_compression_release_tactical_ecs_v18':('BNB','bnb_neutral_compression_release',.20,'COMPRESSION_RELEASE_TACTICAL'),
 'avax_shock_outcome_router_ecs_v18':('AVAX','avax_burst_scout_handoff',.16,'SHOCK_OUTCOME_ROUTER'),
}
def blank(): return {'bias':0,'prewave':0,'onset':0,'continue':0,'reentry':0,'reverse':0,'exhaust':0,'strength':0.0}
def side3(x): return 1 if x>0 else -1 if x<0 else 0
def rel(candles,idx,s,ts,n):
 i=idx[s].get(ts); return 0.0 if i is None else (ret(candles[s],i,n) or 0.0)-p.medmove(candles,idx,ts,n)
def rawfeat(cid,candles,idx,ts):
 feature_id=CANDS[cid][1]; raw_id=v133.v132.CANDS[feature_id][1]; return engine.feat(raw_id,candles,idx,ts)
def signal(cid,candles,idx,ts):
 z=blank();pair=CANDS[cid][0];x=rawfeat(cid,candles,idx,ts)
 if not x:return z
 r=x['r'];v=x['v'];br=x['br'];shock=x['shock'];c=x['c'];i=x['i'];sl168=x['sl168'];vol=max(v[168],1e-9)
 rr6=rel(candles,idx,pair,ts,6);rr12=rel(candles,idx,pair,ts,12);rr24=rel(candles,idx,pair,ts,24);rr72=rel(candles,idx,pair,ts,72)
 prev=rawfeat(cid,candles,idx,ts-6*HOUR); pbr=prev['br'] if prev else br; pshock=prev['shock'] if prev else shock
 if cid=='btc_breadth_diffusion_owner_ecs_v18':
  # V147 price-energy ownership broke Dev->Val and captured 0% MFE in Val.
  # New ownership thesis: own BTC only while market breadth is diffusing in BTC direction.
  slow=side3(r[336]) if r[336]*sl168>0 else 0; fast=side3(r[6]+r[12]); breadth_turn=side3(br-pbr)
  side=slow if slow and fast==slow and breadth_turn==slow else 0
  z['bias']=slow
  if slow and v[48]<v[168] and breadth_turn in (0,slow):z['prewave']=slow
  if side:z['onset']=side
  if side and side3(r[24])==side and side3(br-.5)==side:z['continue']=side
  if side and side3(br-pbr)!=side:z['exhaust']=side
  if slow and side3(br-.5)==-slow and fast==-slow:z['reverse']=-slow
  z['strength']=abs(br-pbr)+abs(r[24])/(vol*math.sqrt(24)+1e-9)
 elif cid=='btc_panic_recovery_owner_ecs_v18':
  # V147 failed-wave reversal was unstable and stale. Replace reversal-after-pullback with panic->recovery transition.
  draw=side3(r[72]); fast=side3(r[6]+r[12]); breadth_turn=side3(br-pbr)
  side=1 if draw<0 and fast>0 and breadth_turn>0 else -1 if draw>0 and fast<0 and breadth_turn<0 else 0
  z['bias']=side
  if draw:z['prewave']=-draw
  if side:z['onset']=side
  if side and side3(r[24])==side and side3(br-.5)==side:z['continue']=side
  z['reentry']=0
  if side and (fast==-side or breadth_turn==-side):z['exhaust']=side
  if side and side3(r[24])==-side and side3(br-.5)==-side:z['reverse']=-side
  z['strength']=abs(r[72])/(vol*math.sqrt(72)+1e-9)+abs(br-pbr)
 elif cid=='eth_residual_rotation_owner_ecs_v18':
  # V147 follower->leader inflection had strong Dev and negative Val. Replace inflection level with residual rotation vs market median.
  medium=side3(rr72); fast=side3(rr6+rr12); accel=side3((rr6+rr12)-rr24)
  side=fast if medium and fast==-medium and accel==fast else 0
  z['bias']=side
  if medium:z['prewave']=-medium
  if side:z['onset']=side
  if side and rr24*side>0 and r[24]*side>0:z['continue']=side
  z['reentry']=0
  if side and (rr12*side<=0 or r[12]*side<=0):z['exhaust']=side
  if side and rr24*side<0 and side3(r[12])==-side:z['reverse']=-side
  z['strength']=abs((rr6+rr12)-rr24)/(vol*math.sqrt(24)+1e-9)+abs(rr72)/(vol*math.sqrt(72)+1e-9)
 elif cid=='bnb_compression_release_tactical_ecs_v18':
  # BNB impulse continuation and dislocation reversion both failed. Abandon relative-direction thesis.
  # New role: short tactical ownership only after volatility compression releases with synchronized absolute+relative direction.
  compressed=v[24]<v[168]; released=bool(prev and prev['v'][24]<prev['v'][168] and v[24]>=v[168])
  fast=side3(r[6]+r[12]); rfast=side3(rr6+rr12); side=fast if released and fast and rfast==fast else 0
  z['bias']=side
  if compressed:z['prewave']=side3(r[24])
  if side:z['onset']=side
  if side and side3(r[24])==side and side3(rr24)==side:z['continue']=side
  z['reentry']=0
  if side and (fast==-side or rfast==-side or v[24]<v[168]):z['exhaust']=side
  if side and fast==-side and rfast==-side:z['reverse']=-side
  z['strength']=abs(v[24]-v[168])/(v[168]+1e-9)+abs(rr12)/(vol*math.sqrt(12)+1e-9)
 else:
  # V147 fixed post-shock reversal: Dev negative, Val strong. Direction is regime-dependent.
  # New thesis: route post-shock outcome causally: absorption->reversal, persistent energy->continuation.
  stretch=side3(rr24+r[24]); fast=side3(rr6+r[6]); decaying=pshock>shock; persistent=shock>=pshock
  side=(-stretch if decaying and stretch and fast==-stretch else stretch if persistent and stretch and fast==stretch else 0)
  z['bias']=side
  if pshock>1.0 and stretch:z['prewave']=stretch
  if side:z['onset']=side
  if side and side3(rr12+r[12])==side:z['continue']=side
  z['reentry']=0
  if side and side3(rr6+r[6])==-side:z['exhaust']=side
  if side and side3(rr12+r[12])==-side:z['reverse']=-side
  z['strength']=abs(pshock-shock)+abs(rr24+r[24])/(vol*math.sqrt(24)+1e-9)
 return z
def dyn_size(cid,candles,idx,ts):
 x=rawfeat(cid,candles,idx,ts);base=CANDS[cid][2]
 if not x:return base*.5
 realized=max(x['v'][168]*math.sqrt(24),1e-9);scale=max(.55,min(1.20,3.0/realized));return max(.08,min(.50,base*scale))
v133.CANDS.clear();v133.CANDS.update({k:(v[0],v[1],v[2]) for k,v in CANDS.items()});v133.sig=signal;v133.dyn_size=dyn_size
def role_diag(cid,candles,idx,period,trades):
 start,end=period;pair=CANDS[cid][0];events=[];last=0
 for row in candles[pair]:
  ts=int(row['ts'])
  if not(start<=ts<end) or ts-last<12*HOUR:continue
  side=int(signal(cid,candles,idx,ts)['onset'] or 0)
  if not side:continue
  events.append(any(t['side']==side and ts<=t['entryTs']<=ts+12*HOUR for t in trades));last=ts
 return {'role':CANDS[cid][3],'events':len(events),'captured':sum(events),'eventCaptureRatePct':100*sum(events)/len(events) if events else 0,'tradeStarvation':len(trades)<4}
def diagnosis(cid,dm,vm,vs,vw,vr):
 if vm.get('trades',0)<4:return 'TRADE_STARVATION'
 if dm.get('returnPct',0)*vm.get('returnPct',0)<0:return 'DEV_TO_VAL_SIGN_FLIP'
 ft=vm.get('failureTaxonomy') or {}
 if ft.get('wrongCoreOwnership',0)>max(2,vm.get('trades',0)*.25):return 'WRONG_CORE_OWNERSHIP'
 if ft.get('staleHold',0)>max(2,vm.get('trades',0)*.25):return 'STALE_HOLD'
 if vm.get('falseStartRatePct',0)>50:return 'FALSE_START_DOMINANT'
 if (vm.get('pfWithoutBest') or 0)<1:return 'BROAD_EDGE_WEAK'
 if (vs.get('pf') or 0)<1:return 'STRESS_EDGE_WEAK'
 return 'FOLD_OR_EXPECTANCY_WEAK'
def run(cid):
 candles,idx,_=v109.b.base.load();ps=v109.b.base.periods(candles)
 dm,dtr=v133.metr(cid,candles,idx,ps['development'],NORMAL_BPS,0);vm,vtr=v133.metr(cid,candles,idx,ps['validation'],NORMAL_BPS,0);vs,_=v133.metr(cid,candles,idx,ps['validation'],STRESS_BPS,1)
 dw=v133.wave_diag(cid,candles,idx,ps['development']);vw=v133.wave_diag(cid,candles,idx,ps['validation']);df=v133.folds(cid,candles,idx,ps['development']);vf=v133.folds(cid,candles,idx,ps['validation']);dr=role_diag(cid,candles,idx,ps['development'],dtr);vr=role_diag(cid,candles,idx,ps['validation'],vtr)
 adequate=dm.get('trades',0)>=8 and vm.get('trades',0)>=4;stable=df['positivePfFolds']>=2 and vf['positivePfFolds']>=2
 common=adequate and stable and (dm.get('pf') or 0)>=1.2 and dm.get('returnPct',0)>0 and (vm.get('pf') or 0)>=1.2 and vm.get('returnPct',0)>0 and (vs.get('pf') or 0)>1 and vm.get('maxDDPct',-999)>-20 and (vm.get('pfWithoutBest') or 0)>=1
 role=CANDS[cid][3];role_ok=(vw['captureRatePct']>=20 and (vw['medianWaveMfeCapturedPct'] or 0)>=20) if role=='MAJOR_WAVE_OWNERSHIP' else (vr['events']>=4 and vr['eventCaptureRatePct']>0)
 res={'strategyId':'V148_'+cid.upper(),'pair':CANDS[cid][0],'role':role,'periods':{'development':ps['development'],'validation':ps['validation'],'confirmation':'UNTOUCHED','holdout':'UNTOUCHED'},'development':dm,'validation':vm,'validationStress':vs,'waveDiagnostics':{'development':dw,'validation':vw},'roleDiagnostics':{'development':dr,'validation':vr},'walkForward':{'development':df,'validation':vf},'diagnosis':diagnosis(cid,dm,vm,vs,vw,vr),'effectiveCleanSheet':True,'effectiveCleanSheetBasis':'economic role/entry/ownership hypothesis materially replaced from V147 D/V diagnosis','researchMultiplicity':{'family':'CAUSAL_ROLE_RESET','generation':148,'candidatesThisBatch':5},'status':'FROZEN_SURVIVOR' if common and role_ok else 'FAIL','reason':'DEV_VALIDATION_ROLE_GATE','architecture':'CAUSAL_ROLE_RESET_RAW_V18','inheritsPriorSignals':False,'productionChanged':False,'realTradingEnabled':False}
 out=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state'));out.mkdir(parents=True,exist_ok=True);stem='active4-v148-'+cid;txt=json.dumps(res,indent=2);(out/f'{stem}.json').write_text(txt);(out/f'{stem}.md').write_text('# '+res['strategyId']+'\n\n```json\n'+txt+'\n```\n');print(txt)
if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('--candidate',choices=sorted(CANDS),required=True);run(ap.parse_args().candidate)
