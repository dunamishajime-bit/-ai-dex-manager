#!/usr/bin/env python3
"""Ablation research only; remove D routes from frozen eight-sleeve native model."""
import sys,json,contextlib,io,time,hashlib,collections,os
from pathlib import Path
SRC=Path(os.environ.get("V12_V4_RESEARCH_SOURCE_ROOT",r"C:\Users\dis\DisDex-five-improvements-20261008"))
sys.path.insert(0,str(SRC/"scripts/research"))
with contextlib.redirect_stdout(io.StringIO()):
 import run_v12_v4_priority_gross_v2_sweep as sweep
 import run_v12_multilogic_v4_final1000 as final
 import run_v12_multilogic_v4_stacking as v4
 import run_v12_multilogic_v3 as v3
 import run_v12_independent_sleeves as ind
 import run_v12_multilogic_v4_minlift as mlift
 import run_v12_multilogic_recovery as ml
s=sweep.s
ROOT=Path(os.environ.get('V12_V4_D_ABLATION_OUTPUT_ROOT','C:/tmp/v4-d-ablation-20261026'))
ROOT.mkdir(exist_ok=True)
RANKS=json.loads((Path(os.environ.get('V12_V4_GROSS_POLICY_REPO',str(Path.home()/'render-live-prep-20261025')))/'docs/implementation/v12-v4-v2-full-year-priority.json').read_text('utf8'))
D_ROUTES={r['route'] for r in RANKS if r['tier']=='D'}
C_ROUTES={r['route'] for r in RANKS if r['tier']=='C' and r['route']!='FAILED_BREAK_REV_SHORT_6H'}
assert len(D_ROUTES)==7 and len(C_ROUTES)==9
CAP=sweep.CAP
CASE=sweep.CASES['V2_M150_D05_CORE_NATIVE']
BASE_FILTER=sweep.make_filter("V2_M150_D05_CORE_NATIVE",CASE)
def make_filter(blocked, cnt):
 def f(candidates,case):
  out=BASE_FILTER(candidates,case)
  processed=[]
  for x in out:
   if x.get('strategy_id')=='V12':
    r=x.get('route')
    if r in C_ROUTES:
     assert abs(float(x['requested_gross'])-.18)<1e-10
     x['requested_gross']=.25
     cnt['c_gross025']+=1
    if r in blocked:
     cnt['removed_'+r]+=1
     continue
   processed.append(x)
  return processed
 return f
def main():
 s.w.OUT=ROOT;s.w.setup()
 v4.install_virtual_leg_study_adapter();final.install_final_routes()
 v3.stage3_transform=final.stage3_candidate_all
 v3.FAILED=ml.failed_candidates();v3.v2.FAILED=v3.FAILED
 s.w.base.source_batch=ind.custom_source_batch;s.w.base.read_table=v3.v2.read_table
 original=s.w.base.patch_admission
 cases=[('ABLATE_ALL_D',D_ROUTES)]+[('ABLATE_'+r,{r}) for r in sorted(D_ROUTES)]
 for name,blocked in cases:
  v3.CASE[name]={'family_cap':CAP['family'],'gross':.10,'slots':16}
  ind.ACTIVE_RECOVERY_CAP=CAP['family'];mlift.MAX_LIFT_GROSS=.30
  ind.ORIG_PATCH=original;s.w.base.patch_admission=sweep.patch
  cnt=collections.Counter();s.w.base._study_filter=make_filter(blocked,cnt)
  now=time.monotonic()
  print('RUN_START',name,flush=True)
  results=s.w.base.run_study(name,'10,30')
  summaries={'name':name,'excluded':sorted(blocked),'counts':dict(cnt),'seconds':round(time.monotonic()-now,2),'status':'RESEARCH_ONLY_NOT_LIVE'}
  for sc in results['scenarios']:
   k='10bps' if sc['scenario_id']=='PRICE_MODEL_10BPS' else '30bps'
   trace=ROOT/'cases'/name/'runs'/sc['scenario_id']/'portfolio-trades.jsonl'
   with trace.open(encoding='utf8') as f:ledger=[json.loads(x) for x in f if x.strip()]
   summaries[k]={'finalEquityJpy':sc['final_equity_jpy'],'maxDdPct':sc['maximum_mtm_drawdown']*100,
     'trades':sc['closed_trades'],'WR':sc['win_rate'],'PF':sc['profit_factor'],
     'ledger_sha256':hashlib.sha256(trace.read_bytes()).hexdigest(),
     'v12_trades':sum(x['strategy_id']=='V12' for x in ledger),
     'D_trades':sum(x['strategy_id']=='V12' and x['route'] in D_ROUTES for x in ledger),
     'accounting':sc['accounting_reconciliation']['status']}
   assert summaries[k]['accounting']=='PASS'
  (ROOT/(name+'.json')).write_text(json.dumps(summaries,indent=2,ensure_ascii=False)+'\n',encoding='utf8')
  print('RUN_DONE',name,[(k,round(summaries[k]['finalEquityJpy']),round(summaries[k]['maxDdPct'],4),summaries[k]['trades']) for k in ['10bps','30bps']],flush=True)
if __name__=='__main__':main()
