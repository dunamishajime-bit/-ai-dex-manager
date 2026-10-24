#!/usr/bin/env python3
"""RESEARCH ONLY: extra short-entry execution slippage stress atop 10/30bps.
Native8 shared portfolio, no production/VPS/LIVE/HP writes or API trading.
Modifies only modeling of the explicit new RENDER independent research route.
"""
from __future__ import annotations
import argparse,ast,importlib.util,sys,hashlib,json
from pathlib import Path
HERE=Path('C:/tmp/render-mtf-study-20261024')
RUNNER_SOURCE=HERE/'run_render_4427_independent_profit_sell55_native8_20261024.py'
PINNED=HERE/'render_4427_priority_native8_source_patch_v3_20261024.py'
DRIVER_NAME='render_4427_independent_slippage_stress_driver'
spec=importlib.util.spec_from_file_location(DRIVER_NAME,RUNNER_SOURCE)
runner=importlib.util.module_from_spec(spec);sys.modules[DRIVER_NAME]=runner;spec.loader.exec_module(runner)
tree=ast.parse(PINNED.read_text('utf8'))
INSERT=None
for statement in tree.body:
 if isinstance(statement,ast.Assign) and any(isinstance(x,ast.Name) and x.id=='INSERT' for x in statement.targets):
  INSERT=ast.literal_eval(statement.value)
assert INSERT and INSERT.count('RESEARCH_RENDER_SCOPED_OWNER_PROMOTED')==1
core=runner.native.study.previous.native.m.m.core
original_bootstrap=core.task8.legacy.bootstrap
native=runner.native
original_model=native.research_new_rows
ROUTE='IDLE_RENDER_IND_BTC_DIVERGENCE_SELL55_SHORT'
STRESS_LOG=[]
def scoped_bootstrap():
 source,helper=original_bootstrap()
 base=helper.base
 original_patch=base.BASE_ADMISSION_PATCH
 def patch(src,strict):
  modified=original_patch(src,strict)
  marker='            for candidate in rows:\n'
  assert modified.count(marker)==1
  assert '_prepare_overlay(rows, active' in modified
  return modified.replace(marker,INSERT+marker,1)
 base.BASE_ADMISSION_PATCH=patch
 return source,helper
def stressed_model(source,cost_bps):
 original=original_model(source,cost_bps)
 out=[]
 for row in original:
  if row.get('route')!=ROUTE:
   out.append(row);continue
  p=float(row['entry_price']);x=float(row['exit_price'])
  assert p>0 and x>0
  newexit=x+p*EXTRA_BPS/10000
  assert newexit>0
  updated=dict(row,exit_price=newexit,unit_price_return=1-newexit/p,
      research_extra_slippage_bps=EXTRA_BPS)
  out.append(updated)
  STRESS_LOG.append({'costBps':cost_bps,'ts':row['entry_ts_ms'],'route':ROUTE,
    'extraBps':EXTRA_BPS,'baseExit':x,'stressExit':newexit,
    'entry':p,'baseUnitReturn':row['unit_price_return'],'stressUnitReturn':updated['unit_price_return']})
 return out
def main():
 global EXTRA_BPS
 ap=argparse.ArgumentParser()
 ap.add_argument('--extra-bps',type=int,choices=[60,120],required=True)
 a=ap.parse_args()
 EXTRA_BPS=a.extra_bps
 out=Path('C:/tmp/r4427s'+str(EXTRA_BPS))
 assert out.as_posix().lower().startswith('c:/tmp/')
 out.mkdir(parents=True,exist_ok=True)
 core.task8.legacy.bootstrap=scoped_bootstrap
 native.research_new_rows=stressed_model
 prior_argv=list(sys.argv)
 try:
  sys.argv=[str(RUNNER_SOURCE),'--output',str(out)]
  runner.main()
 finally:
  native.research_new_rows=original_model
  core.task8.legacy.bootstrap=original_bootstrap
  sys.argv=prior_argv
 assert len(STRESS_LOG)>=2*3*2,('INSUFFICIENT_TRADE_STRESS_ROW_RECORD',len(STRESS_LOG))
 dest=out/f'RENDER_4427_EXTRA_{EXTRA_BPS}BPS_NATIVE8_MODEL_ROWS_AUDIT.json'
 dest.write_text(json.dumps({'status':'RESEARCH_ONLY_EXTRA_EXECUTION_SLIPPAGE_MODEL',
   'extraSlippageBps':EXTRA_BPS,'sourceDriver':str(RUNNER_SOURCE),'originalSourcePolicySha256':hashlib.sha256(PINNED.read_bytes()).hexdigest(),
   'stressRecords':STRESS_LOG,'limitations':['Modeled exit adverse slippage, not observed venue fills',
   'Three repeated native8 replays per 10/30bps; original research policy only; no LIVE changes']},
  ensure_ascii=False,indent=2)+'\n',encoding='utf8')
 print('EXTRA_SLIPPAGE_STRESS_NATIVE8_FINISHED',EXTRA_BPS,'ROWS',len(STRESS_LOG),'AUDIT',dest,flush=True)
if __name__=='__main__':main()
