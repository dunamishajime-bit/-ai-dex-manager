"""Final stress of V12 V4 second-pass priority/gross finalists."""
import contextlib,io,json
with contextlib.redirect_stdout(io.StringIO()):
 import run_v12_v4_priority_gross_v2_sweep as v2
 import run_v12_multilogic_v4_final1000 as final
 import run_v12_multilogic_v4_stacking as v4
 import run_v12_multilogic_v3 as v3
 import run_v12_independent_sleeves as ind
 import run_v12_multilogic_v4_minlift as mlift
 import run_v12_multilogic_recovery as ml
s=v4.s;ROOT=s.ROOT;OUT=ROOT/'docs/research/results/v12-v4-priority-gross-v2-stress-20261009'
SELECT={k:v2.CASES[k] for k in ['V2_M150_D05_CORE_NATIVE','V2_M150_D0_CORE_NATIVE','V2_M150_D05_CORE_TIER']}
def main():
 OUT.mkdir(parents=True,exist_ok=True);s.w.OUT=OUT;s.w.setup();v4.install_virtual_leg_study_adapter();final.install_final_routes();v3.stage3_transform=final.stage3_candidate_all
 v3.FAILED=ml.failed_candidates();v3.v2.FAILED=v3.FAILED;s.w.base.source_batch=ind.custom_source_batch;s.w.base.read_table=v3.v2.read_table;basepatch=s.w.base.patch_admission;res=[]
 for name,cfg in SELECT.items():
  v3.CASE[name]={'family_cap':v2.CAP['family'],'gross':.10,'slots':16};ind.ACTIVE_RECOVERY_CAP=v2.CAP['family'];mlift.MAX_LIFT_GROSS=.30;ind.ORIG_PATCH=basepatch;s.w.base.patch_admission=v2.patch;s.w.base._study_filter=v2.make_filter(name,cfg)
  print('START',name,flush=True);r=s.w.base.run_study(name,'20,30');r['cfg']={**v2.CAP,**cfg}
  for sc in r['scenarios']:
   ts=s.rows(OUT/'cases'/name/'runs'/sc['scenario_id']/'portfolio-trades.jsonl');vv=[x for x in ts if x['strategy_id']=='V12'];sc['v12_details']={'all':v2.detail(vv),'utilization':v2.util(vv),'routes':{rt:v2.detail([x for x in vv if x.get('route')==rt]) for rt in sorted({x.get('route') for x in vv if x.get('route')})}}
  res.append(r);(OUT/'comparison-summary.json').write_text(json.dumps(res,indent=2),encoding='utf-8');print('DONE',name,flush=True)
if __name__=='__main__':main()
