"""Sensitivity test for reliability-adjusted priority. Training-only samples, no future data."""
from pathlib import Path
import contextlib,io,json,math
with contextlib.redirect_stdout(io.StringIO()):
 import run_v12_v4_priority_gross_v2_sweep as v2

ROOT=v2.ROOT
OUT=ROOT/'docs/research/results/v12-v4-priority-sample-guard-20261009'
SRC=ROOT/'docs/research/results/v12-v4-priority-forward-split-20261009/training-only-priority.json'
MID=1778457600000
CAP={'family':1.5,'v12':2.5,'crypto':3.25,'total':4.5}
CASE_RULES={
 'TRAIN_GUARD_N20_40':{'small_limit':20,'medium_limit':40,'score_penalty':15},
 'TRAIN_GUARD_N30_60':{'small_limit':30,'medium_limit':60,'score_penalty':15}
}

def rows(p):return [json.loads(x) for x in p.read_text(encoding='utf-8').splitlines() if x.strip()]
def guarded(rule):
 a=json.loads(SRC.read_text(encoding="utf-8"));res=[]
 for x in a:
  x=dict(x);n=x['n_train'];q=x['score']-rule['score_penalty']*min(1.0,20.0/max(n,1))
  ceiling='.40'
  cap=.12 if n<rule['small_limit'] else (.20 if n<rule['medium_limit'] else .40)
  x['raw_training_score']=x['score'];x['score']=q
  x['raw_training_gross']=x['gross'];x['gross']=min(x['gross'],cap)
  x['confidence_max_gross']=cap
  res.append(x)
 res.sort(key=lambda x:(-x['score'],-x['n_train'],x['route']))
 for i,x in enumerate(res,1):
  x['priority_order']=i
  x['priority_rank']=None if x['route']==v2.CORE else i+3
 return res

def main():
 OUT.mkdir(parents=True,exist_ok=True)
 (OUT/'protocol.json').write_text(json.dumps({'research_only':True,'live_changes':False,'ranking_source':str(SRC.relative_to(ROOT)),
  'confidence_rules':CASE_RULES,'caps':CAP,'costs_bps':[10,20,30],
  'caution':'Route repair rules were mined during development; this is not untouched out of sample.'},indent=2),encoding='utf-8')
 s=v2.s;s.w.OUT=OUT;s.w.setup()
 v2.v4.install_virtual_leg_study_adapter();v2.final.install_final_routes()
 v2.v3.stage3_transform=v2.final.stage3_candidate_all
 v2.v3.FAILED=v2.ml.failed_candidates();v2.v3.v2.FAILED=v2.v3.FAILED
 s.w.base.source_batch=v2.ind.custom_source_batch
 s.w.base.read_table=v2.v3.v2.read_table
 orig=s.w.base.patch_admission
 results=[]
 for name,rule in CASE_RULES.items():
  v2.SCORES=guarded(rule)
  v2.SCORE={x['route']:x for x in v2.SCORES}
  (OUT/(name+'-ranks.json')).write_text(json.dumps(v2.SCORES,indent=2),encoding='utf-8')
  v2.CAP=CAP.copy()
  cfg={'mult':1.5,'d':.05,'core':'native'}
  v2.v3.CASE[name]={'family_cap':CAP['family'],'gross':.10,'slots':16}
  v2.ind.ACTIVE_RECOVERY_CAP=CAP['family']
  v2.mlift.MAX_LIFT_GROSS=.30
  v2.ind.ORIG_PATCH=orig
  s.w.base.patch_admission=v2.patch
  s.w.base._study_filter=v2.make_filter(name,cfg)
  print('START',name,flush=True)
  z=s.w.base.run_study(name,'10,20,30');z['cfg']={**CAP,**cfg,**rule}
  for sc in z['scenarios']:
   tt=rows(OUT/'cases'/name/'runs'/sc['scenario_id']/'portfolio-trades.jsonl')
   vv=[x for x in tt if x.get('strategy_id')=='V12']
   val=[x for x in vv if x['entry_ts_ms']>=MID]
   sc['v12_details']={'all':s.w.stats(vv),'validation_post_cutoff':s.w.stats(val),
      'utilization':v2.util(vv)}
  results.append(z);(OUT/'comparison-summary.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
  print('DONE',name,flush=True)
if __name__=='__main__':main()
