"""Research-only Y06 opportunity restoration and gross priority sensitivity.
Priority evidence from pre-2026-05-11 CLOSED trades only; all route rules remain
unchanged second-pass repaired, venue min-size and portfolio caps enforced.
No Production/LIVE writes.
"""
import contextlib,io,json
from pathlib import Path
with contextlib.redirect_stdout(io.StringIO()):
 import run_v12_v4_priority_gross_v2_sweep as v2

ROOT=v2.ROOT
OUT=ROOT/'docs/research/results/v12-v4-y06-opportunity-protection-20261009'
SRC=ROOT/'docs/research/results/v12-v4-priority-forward-split-20261009/training-only-priority.json'
TRAIN=json.loads(SRC.read_text(encoding='utf-8'))
MID=1778457600000
Y='REC_Y06_REV_D0_T72'
CAP={'family':1.5,'v12':2.5,'crypto':3.25,'total':4.5}
# Intentionally small, predeclared non-exhaustive comparisons; never optimize on validation.
CASES={
 'Y06_FRONT_NATIVE_060':{'y_gross':.60,'move_front':True,'small_sample_cap':False},
 'Y06_FRONT_LOWER_030':{'y_gross':.30,'move_front':True,'small_sample_cap':False},
 'Y06_FRONT_LOWER_040':{'y_gross':.40,'move_front':True,'small_sample_cap':False},
 'Y06_FRONT_LOWER_050':{'y_gross':.50,'move_front':True,'small_sample_cap':False},
 'Y06_NATIVE_RANK_LOWER_040':{'y_gross':.40,'move_front':False,'small_sample_cap':False},
 'Y06_FRONT_040_SMALLCAP':{'y_gross':.40,'move_front':True,'small_sample_cap':True},
}
def rows(p):return [json.loads(x) for x in p.read_text(encoding='utf-8').splitlines() if x.strip()]

def score_order(promote):
 ranks=[dict(x) for x in TRAIN]
 if promote:
  one=next(x for x in ranks if x['route']==Y)
  ranks.remove(one);ranks.insert(0,one)
 for i,x in enumerate(ranks):
  x['priority_order']=i+1
  x['priority_rank']=None if x['route']==v2.CORE else i+4
 return ranks

def make_filter(cfg):
 # The full-score run's base applies unchanged Entry/Exit repairs.
 base=v2.r2.make_filter(True)
 ranks=score_order(cfg['move_front'])
 mp={x['route']:x for x in ranks}
 def f(candidates,case):
  out=base(candidates,case);ans=[]
  for c in out:
   d=dict(c)
   if d.get('strategy_id')=='V12':
    sc=mp.get(d.get('route'))
    if sc:
     rt=d['route']
     d['rank']=1 if rt==v2.CORE else sc['priority_rank']
     if rt!=v2.CORE:
      if sc['tier']=='D':g=.05
      else:g=min(1.0,float(sc['gross'])*1.5)
      if cfg['small_sample_cap'] and sc['n_train']<20:g=min(g,.20)
      if rt==Y:g=cfg['y_gross']
      d['requested_gross']=g
   ans.append(d)
  return ans
 return f

def summary(trades,sc):
 vv=[x for x in trades if x.get('strategy_id')=='V12']
 val=[x for x in vv if x['entry_ts_ms']>=MID]
 yf=[x for x in vv if x.get('route')==Y]
 return {'v12_count':len(vv),'v12_validation':v2.s.w.stats(val),'y06_count':len(yf),
  'y06_validation_count':sum(x['entry_ts_ms']>=MID for x in yf),
  'v12_utilization':v2.util(vv)}
def main():
 OUT.mkdir(parents=True,exist_ok=True)
 (OUT/'protocol.json').write_text(json.dumps({'research_only':True,'order_enabled':False,
 'training_only_rank_source':str(SRC.relative_to(ROOT)),'fixed_caps':CAP,'cases':CASES,
 'costs_bps':[10],
 'caution':'Route-repair conditions already selected using entire development year. Relative rankings are train-derived; prioritizing Y06 is motivated by development-ledger missed-trade diagnosis.'},indent=2),encoding='utf-8')
 s=v2.s;s.w.OUT=OUT;s.w.setup();v2.v4.install_virtual_leg_study_adapter()
 v2.final.install_final_routes()
 v2.v3.stage3_transform=v2.final.stage3_candidate_all
 v2.v3.FAILED=v2.ml.failed_candidates();v2.v3.v2.FAILED=v2.v3.FAILED
 s.w.base.source_batch=v2.ind.custom_source_batch;s.w.base.read_table=v2.v3.v2.read_table
 original_patch=s.w.base.patch_admission
 v2.CAP=CAP
 results=[]
 for name,cfg in CASES.items():
  v2.v3.CASE[name]={'family_cap':CAP['family'],'gross':.10,'slots':16}
  v2.ind.ACTIVE_RECOVERY_CAP=CAP['family'];v2.mlift.MAX_LIFT_GROSS=.30;v2.ind.ORIG_PATCH=original_patch
  s.w.base.patch_admission=v2.patch
  s.w.base._study_filter=make_filter(cfg)
  print('START',name,flush=True)
  z=s.w.base.run_study(name,'10');z['cfg']={**cfg,**CAP}
  for sc in z['scenarios']:
   ts=rows(OUT/'cases'/name/'runs'/sc['scenario_id']/'portfolio-trades.jsonl')
   sc['v12_coverage']=summary(ts,sc)
  results.append(z)
  (OUT/'comparison-summary.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
  print('DONE',name, 'JPY',round(z['scenarios'][0]['final_equity_jpy']),'DD',round(100*z['scenarios'][0]['maximum_mtm_drawdown'],2),
  'Y06',z['scenarios'][0]['v12_coverage']['y06_count'],flush=True)
if __name__=='__main__':main()
