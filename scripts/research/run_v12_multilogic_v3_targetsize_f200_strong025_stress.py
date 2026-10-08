"""Research-only V12 V3 targeted venue-minimum recovery.

Base: stack+flip F1.25 / stage3 0.075.
Only routes that are already profitable after integrated admission receive a 0.15x
requested gross so observed venue minimum quantity/notional rejects can be reduced.
Weak/negative routes are NOT upsized.

No LIVE/Production changes.
"""
import contextlib,io,json,sys
from pathlib import Path
with contextlib.redirect_stdout(io.StringIO()):
 import run_v12_multilogic_v3_stackflip as sf
 import run_v12_multilogic_v3 as v3
 import run_v12_independent_sleeves as ind
 import run_v12_multilogic_recovery as ml
s=v3.s;ROOT=s.ROOT;OUT=ROOT/'docs/research/results/v12-multilogic-v3-targetsize-f200-strong025-stress-20261009';MID=s.MID
NAME='V3_STACKFLIP_TARGETSIZE_F200_STRONG025_STRESS'
CFG={'family_cap':2.00,'gross':.075,'slots':16}
STRONG_UPSIZE={
 'REC_Y06_REV_D0_T72':.25,
 'REC_X10_TIME_48H':.25,
 'REC_Y03_REV_D0_T36':.15,
 'REC_Y08_REV_D0_T6':.15,
 'REC_X11_TIME_48H':.15,
 'REC_X02_TIME_36H':.15,
 'REC_X06_TIME_12H':.15,
 'REC_X04_TIME_24H':.15,
 'REC_X05_TIME_36H':.15,
 'REC_G1_MID_REL_LOWVOL':.15,
 'REC_X03_TIME_12H':.15,
 'REC_X12_TIME_12H':.15,
 'REC_Y04_REV_D2_T36':.15,
 'REC_Y07_REV_D0_T72':.15,
}

def filt(candidates,name):
 v3.CASE[name]=CFG
 out=v3.filt(candidates,name)
 for d in out:
  if d.get('strategy_id')=='V12' and d.get('route') in STRONG_UPSIZE:
   d['requested_gross']=STRONG_UPSIZE[d['route']]
   d['targeted_min_venue_recovery']=True
 return out

def detail(a):
 d=s.w.stats(a);d['gross_hours']=sum(t.get('accepted_gross',0)*(t['exit_ts_ms']-t['entry_ts_ms'])/3600000 for t in a);return d

def main():
 OUT.mkdir(parents=True,exist_ok=True)
 (OUT/'protocol.json').write_text(json.dumps({
  'research_only':True,'live_changes':False,'production_changes':False,
  'base':'V3 stackflip F1.25 / stage3 0.075',
  'targeted_route_gross':STRONG_UPSIZE,
  'selection_rule':'only routes profitable after integrated admission; weak/negative routes not upsized',
  'shared_caps_unchanged':{'V12':2.0,'crypto':3.0,'total':4.25,'recovery_family':2.00},
  'costs_bps':[10,20,30]
 },indent=2),encoding='utf-8')
 s.w.OUT=OUT;s.w.setup()

 # Same-side V12 virtual-lot ownership audit semantics.
 support=ROOT/'docs/research/results/gate-fixes-bt-20261008/support/engine'
 if str(support) not in sys.path:sys.path.insert(0,str(support))
 from scripts.research import formal_core_ownership_audit as audit
 orig_conf=audit.find_ownership_conflicts
 def virtual_conflicts(trades):
  return [c for c in orig_conf(trades) if not (
   not c['opposite_sides'] and not c['cross_strategy']
   and c['earlier_owner'].get('strategy_id')=='V12'
   and c['later_owner'].get('strategy_id')=='V12')]
 audit.find_ownership_conflicts=virtual_conflicts

 v3.FAILED=ml.failed_candidates();v3.v2.FAILED=v3.FAILED
 s.w.base.read_table=v3.v2.read_table;s.w.base._study_filter=filt
 ind.ORIG_PATCH=s.w.base.patch_admission;ind.ACTIVE_RECOVERY_CAP=CFG['family_cap']
 s.w.base.patch_admission=sf.patch_factory(CFG['slots']);s.w.base.source_batch=ind.custom_source_batch
 print('START',NAME,flush=True)
 r=s.w.base.run_study(NAME,'10,20,30');r['research_only']=True;r['case_config']=CFG
 for sc in r['scenarios']:
  ts=s.rows(OUT/'cases'/NAME/'runs'/sc['scenario_id']/'portfolio-trades.jsonl');vv=[x for x in ts if x['strategy_id']=='V12']
  sc['v12_details']={'all':detail(vv),'first':detail([x for x in vv if x['exit_ts_ms']<MID]),'second':detail([x for x in vv if x['entry_ts_ms']>=MID]),'routes':{rt:detail([x for x in vv if x.get('route')==rt]) for rt in sorted({x.get('route') for x in vv if x.get('route')})}}
 (OUT/'result.json').write_text(json.dumps(r,indent=2),encoding='utf-8')
 print('DONE',NAME,flush=True)
if __name__=='__main__':main()
