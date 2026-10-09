"""Stress exploratory isolation of external-holdout failing reversal routes.
WARNING: disabled routes derived after seeing external holdout; post-selection sensitivity only.
NEVER interpret this as untouched holdout.
"""
import contextlib,io,json
from pathlib import Path
with contextlib.redirect_stdout(io.StringIO()):
 import run_v12_v4_priority_gross_v2_sweep as v2
ROOT=v2.ROOT
OUT=ROOT/'docs/research/results/v12-v4-external-caution-sensitivity-20261009'
SRC=ROOT/'docs/research/results/v12-v4-priority-forward-split-20261009/training-only-priority.json'
TRAIN=json.loads(SRC.read_text(encoding='utf-8'))
MID=1778457600000
CAP={'family':1.5,'v12':2.5,'crypto':3.25,'total':4.5}
Y06='REC_Y06_REV_D0_T72'
WEAK={'REC_Y06_REV_D0_T72','REC_Y01_REV_D0_T72','REC_Y03_REV_D0_T36','REC_Y07_REV_D0_T72','REC_Y09_REV_D2_T24'}
CASES={'Y06_PAUSED':{'pause':[Y06],'low_y06':None},
       'Y06_SIZE_010':{'pause':[],'low_y06':.10},
       'REVERSE_WEAK5_PAUSED':{'pause':sorted(WEAK),'low_y06':None}}

def rows(p):return [json.loads(x) for x in p.read_text(encoding='utf-8').splitlines() if x.strip()]
def filt(cfg):
 base=v2.make_filter('BASE',{'mult':1.5,'d':.05,'core':'native'})
 def go(candidates,case):
  data=base(candidates,case)
  z=[]
  for d in data:
   if d.get('strategy_id')=='V12':
    if d.get('route') in cfg['pause']:continue
    if d.get('route')==Y06 and cfg['low_y06'] is not None:
     d=dict(d);d['requested_gross']=cfg['low_y06']
   z.append(d)
  return z
 return go
def main():
 OUT.mkdir(parents=True,exist_ok=True)
 (OUT/'protocol.json').write_text(json.dumps({'research_only':True,
  'live_activation_approved':False,'candidate_modification_motivated_by_post_selection_external_55day_result':True,
  'training_only_score_source':str(SRC.relative_to(ROOT)),'cases':CASES,'caps':CAP,'costs_bps':[10,20,30],
  'warning':'This is NOT external holdout validation; route exclusions were motivated by examined future outcome. Need new forward evidence.'},indent=2),encoding='utf-8')
 v2.SCORES=TRAIN;v2.SCORE={x['route']:x for x in TRAIN};v2.CAP=CAP
 s=v2.s;s.w.OUT=OUT;s.w.setup();v2.v4.install_virtual_leg_study_adapter();v2.final.install_final_routes()
 v2.v3.stage3_transform=v2.final.stage3_candidate_all
 v2.v3.FAILED=v2.ml.failed_candidates();v2.v3.v2.FAILED=v2.v3.FAILED
 s.w.base.source_batch=v2.ind.custom_source_batch
 s.w.base.read_table=v2.v3.v2.read_table
 orig=s.w.base.patch_admission
 results=[]
 for name,cfg in CASES.items():
  v2.v3.CASE[name]={'family_cap':CAP['family'],'gross':.10,'slots':16}
  v2.ind.ACTIVE_RECOVERY_CAP=CAP['family'];v2.mlift.MAX_LIFT_GROSS=.30;v2.ind.ORIG_PATCH=orig
  s.w.base.patch_admission=v2.patch
  s.w.base._study_filter=filt(cfg)
  print('START',name,flush=True)
  z=s.w.base.run_study(name,'10,20,30');z['cfg']=cfg
  for sc in z['scenarios']:
   tt=rows(OUT/'cases'/name/'runs'/sc['scenario_id']/'portfolio-trades.jsonl')
   vv=[x for x in tt if x.get('strategy_id')=='V12']
   val=[x for x in vv if x['entry_ts_ms']>=MID]
   sc['v12_details']={'all':s.w.stats(vv),'validation':s.w.stats(val),'utilization':v2.util(vv)}
  results.append(z);(OUT/'comparison-summary.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
  print('DONE',name,flush=True)
if __name__=='__main__':main()
