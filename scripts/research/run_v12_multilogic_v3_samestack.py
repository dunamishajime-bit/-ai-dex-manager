"""Research-only V12 V3 same-side virtual stacking.

Allows multiple V12 subpositions on the same symbol only when they have the same side.
Opposite-side coexistence remains prohibited. Exchange implementation would aggregate
same-side quantity while internal route accounting tracks virtual subpositions.

No LIVE/Production changes.
"""
import contextlib,io,json
from pathlib import Path
with contextlib.redirect_stdout(io.StringIO()):
 import run_v12_multilogic_v3 as v3
 import run_v12_independent_sleeves as ind
 import run_v12_multilogic_recovery as ml
s=v3.s;ROOT=s.ROOT;OUT=ROOT/'docs/research/results/v12-multilogic-v3-samestack-20261009';MID=s.MID

CASES={
 'V3_STACK_F075_G0075':{'family_cap':.75,'gross':.075,'slots':4},
 'V3_STACK_F100_G0050':{'family_cap':1.00,'gross':.05,'slots':8},
 'V3_STACK_F125_G0050':{'family_cap':1.25,'gross':.05,'slots':8},
}

def stack_patch(limit):
 def patch(source,strict):
  q=ind.independent_patch(source,strict)
  old='if any(p["symbol"] == candidate["symbol"] for p in active_same_strategy):'
  new='if any(p["symbol"] == candidate["symbol"] and p["side"] != candidate["side"] for p in active_same_strategy):'
  assert q.count(old)==1
  q=q.replace(old,new,1)
  old2='if active_same_route:'
  assert q.count(old2)==1
  q=q.replace(old2,f'if len(active_same_route) >= {int(limit)}:',1)
  return q
 return patch

def filt(candidates,name):
 cfg=CASES[name]
 v3.CASE[name]=cfg
 # v3 filt uses v2 gross .10 and stage3 gross cfg['gross']; preserve that for first pass.
 return v3.filt(candidates,name)

def detail(a):
 d=s.w.stats(a)
 d['gross_hours']=sum(t.get('accepted_gross',0)*(t['exit_ts_ms']-t['entry_ts_ms'])/3600000 for t in a)
 return d

def main():
 OUT.mkdir(parents=True,exist_ok=True)
 (OUT/'protocol.json').write_text(json.dumps({
  'research_only':True,'live_changes':False,'production_changes':False,
  'change':'allow same-symbol V12 virtual subpositions only when side matches; opposite side still rejected',
  'execution_model':'same-side quantities would be aggregated at venue and tracked as virtual route lots internally',
  'shared_caps_unchanged':{'V12':2.0,'crypto':3.0,'total':4.25},
  'cases':CASES,'cost_bps':[10],
  'warning':'Development-period research only.'
 },indent=2),encoding='utf-8')
 s.w.OUT=OUT;s.w.setup()
 # Research-only audit semantics: same-side V12 overlaps represent virtual lots of one venue position.
 import sys
 _support_engine=ROOT/'docs/research/results/gate-fixes-bt-20261008/support/engine'
 if str(_support_engine) not in sys.path: sys.path.insert(0,str(_support_engine))
 from scripts.research import formal_core_ownership_audit as ownership_audit
 _orig_conflicts=ownership_audit.find_ownership_conflicts
 def _virtual_stack_conflicts(trades):
  conflicts=_orig_conflicts(trades)
  return [c for c in conflicts if not (
   not c['opposite_sides'] and not c['cross_strategy']
   and c['earlier_owner'].get('strategy_id')=='V12'
   and c['later_owner'].get('strategy_id')=='V12'
  )]
 ownership_audit.find_ownership_conflicts=_virtual_stack_conflicts
 v3.FAILED=ml.failed_candidates();v3.v2.FAILED=v3.FAILED
 s.w.base.read_table=v3.v2.read_table;s.w.base._study_filter=filt
 original=s.w.base.patch_admission
 res=[]
 for name,cfg in CASES.items():
  ind.ORIG_PATCH=original;ind.ACTIVE_RECOVERY_CAP=cfg['family_cap']
  s.w.base.patch_admission=stack_patch(cfg['slots']);s.w.base.source_batch=ind.custom_source_batch
  print('START',name,flush=True)
  r=s.w.base.run_study(name,'10');r['research_only']=True;r['case_config']=cfg
  for sc in r['scenarios']:
   ts=s.rows(OUT/'cases'/name/'runs'/sc['scenario_id']/'portfolio-trades.jsonl');vv=[x for x in ts if x['strategy_id']=='V12']
   sc['v12_details']={'all':detail(vv),'first':detail([x for x in vv if x['exit_ts_ms']<MID]),'second':detail([x for x in vv if x['entry_ts_ms']>=MID]),'routes':{rt:detail([x for x in vv if x.get('route')==rt]) for rt in sorted({x.get('route') for x in vv if x.get('route')})}}
  (OUT/'cases'/name/'result.json').write_text(json.dumps(r,indent=2),encoding='utf-8');res.append(r);(OUT/'comparison-summary.json').write_text(json.dumps(res,indent=2),encoding='utf-8')
  print('DONE',name,flush=True)
if __name__=='__main__':main()
