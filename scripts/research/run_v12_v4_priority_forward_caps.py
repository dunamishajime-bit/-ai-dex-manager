"""Research-only caps sensitivity using train-only priority score, no retuning of route ranks."""
import contextlib,io,json
from pathlib import Path
with contextlib.redirect_stdout(io.StringIO()):
    import run_v12_v4_priority_gross_v2_sweep as v2
ROOT=v2.ROOT
OUT=ROOT/'docs/research/results/v12-v4-priority-forward-caps-20261009'
RANK=ROOT/'docs/research/results/v12-v4-priority-forward-split-20261009/training-only-priority.json'
SCORES=json.loads(RANK.read_text(encoding='utf-8'))
CASES={
 'FW_CAP125_V200_C300_T425':{'family':1.25,'v12':2.0,'crypto':3.0,'total':4.25,'mult':1.5,'d':.05,'core':'native'},
 'FW_CAP150_V250_C325_T450':{'family':1.50,'v12':2.5,'crypto':3.25,'total':4.50,'mult':1.5,'d':.05,'core':'native'},
 'FW_CAP200_V275_C350_T475':{'family':2.00,'v12':2.75,'crypto':3.5,'total':4.75,'mult':1.5,'d':.05,'core':'native'}
}
MID=1778457600000

def rows(path):return [json.loads(x) for x in path.read_text(encoding='utf-8').splitlines() if x.strip()]
def main():
 OUT.mkdir(parents=True,exist_ok=True)
 (OUT/'protocol.json').write_text(json.dumps({
  'research_only':True,'order_enabled':False,'training_priority_source':str(RANK.relative_to(ROOT)),
  'prior_candidate_tuning_on_same_development_window':True,'cases':CASES,'costs_bps':[10,20,30]
 },indent=2),encoding='utf-8')
 v2.SCORES=SCORES;v2.SCORE={r['route']:r for r in SCORES};v2.OUT=OUT
 s=v2.s;s.w.OUT=OUT;s.w.setup()
 v2.v4.install_virtual_leg_study_adapter();v2.final.install_final_routes()
 v2.v3.stage3_transform=v2.final.stage3_candidate_all
 v2.v3.FAILED=v2.ml.failed_candidates();v2.v3.v2.FAILED=v2.v3.FAILED
 s.w.base.source_batch=v2.ind.custom_source_batch;s.w.base.read_table=v2.v3.v2.read_table
 original_patch=s.w.base.patch_admission
 results=[]
 for name,cfg in CASES.items():
  v2.CAP={k:cfg[k] for k in ['family','v12','crypto','total']}
  v2.v3.CASE[name]={'family_cap':cfg['family'],'gross':.10,'slots':16}
  v2.ind.ACTIVE_RECOVERY_CAP=cfg['family'];v2.mlift.MAX_LIFT_GROSS=.30;v2.ind.ORIG_PATCH=original_patch
  s.w.base.patch_admission=v2.patch;s.w.base._study_filter=v2.make_filter(name,cfg)
  print('START',name,flush=True)
  z=s.w.base.run_study(name,'10,20,30');z['cfg']=cfg
  for sc in z['scenarios']:
   t=rows(OUT/'cases'/name/'runs'/sc['scenario_id']/'portfolio-trades.jsonl')
   vv=[x for x in t if x.get('strategy_id')=='V12']
   validate=[x for x in vv if x['entry_ts_ms']>=MID]
   sc['v12_details']={'all':s.w.stats(vv),'validation_post_cutoff':s.w.stats(validate),
     'utilization':v2.util(vv)}
  results.append(z)
  (OUT/'comparison-summary.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
  print('DONE',name,flush=True)
if __name__=='__main__':main()
