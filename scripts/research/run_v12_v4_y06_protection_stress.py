"""Stress-check predeclared Y06 protection policy; no LIVE or Production writes."""
from pathlib import Path
import contextlib,io,json
with contextlib.redirect_stdout(io.StringIO()):
 import run_v12_v4_y06_protection_sweep as study
v2=study.v2
ROOT=study.ROOT
OUT=ROOT/'docs/research/results/v12-v4-y06-protection-stress-20261009'
CASES={k:study.CASES[k] for k in ['Y06_FRONT_LOWER_030','Y06_FRONT_LOWER_050','Y06_FRONT_NATIVE_060']}
def rows(p):return [json.loads(x) for x in p.read_text(encoding='utf-8').splitlines() if x.strip()]
def main():
 OUT.mkdir(parents=True,exist_ok=True)
 (OUT/'protocol.json').write_text(json.dumps({'research_only':True,'source':'run_v12_v4_y06_protection_sweep.py',
 'cases':CASES,'costs_bps':[20,30],'fixed_caps':study.CAP,
 'validation_note':'Historical development sample; not independent OOS of mined Entry/Exit route policies.'},indent=2),encoding='utf-8')
 s=v2.s;s.w.OUT=OUT;s.w.setup();v2.v4.install_virtual_leg_study_adapter()
 v2.final.install_final_routes();v2.v3.stage3_transform=v2.final.stage3_candidate_all
 v2.v3.FAILED=v2.ml.failed_candidates();v2.v3.v2.FAILED=v2.v3.FAILED
 s.w.base.source_batch=v2.ind.custom_source_batch;s.w.base.read_table=v2.v3.v2.read_table
 orig=s.w.base.patch_admission
 v2.CAP=study.CAP
 result=[]
 for name,cfg in CASES.items():
  v2.v3.CASE[name]={'family_cap':study.CAP['family'],'gross':.10,'slots':16}
  v2.ind.ACTIVE_RECOVERY_CAP=study.CAP['family'];v2.mlift.MAX_LIFT_GROSS=.30
  v2.ind.ORIG_PATCH=orig;s.w.base.patch_admission=v2.patch
  s.w.base._study_filter=study.make_filter(cfg)
  print('START',name,flush=True)
  z=s.w.base.run_study(name,'20,30');z['cfg']={**cfg,**study.CAP}
  for sc in z['scenarios']:
   ts=rows(OUT/'cases'/name/'runs'/sc['scenario_id']/'portfolio-trades.jsonl')
   sc['v12_coverage']=study.summary(ts,sc)
  result.append(z);(OUT/'comparison-summary.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
  print('DONE',name,flush=True)
if __name__=='__main__':main()
