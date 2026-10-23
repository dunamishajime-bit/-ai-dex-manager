#!/usr/bin/env python3
"""Selected ledger PENGU Recovery V8 initial adverse-stop screen, separate from NORMAL LONG."""
from __future__ import annotations
import hashlib,json
from pathlib import Path
HERE=Path(__file__).resolve().parent
from importlib.util import spec_from_file_location,module_from_spec
def load(name,p):
 sp=spec_from_file_location(name,p);mod=module_from_spec(sp);sp.loader.exec_module(mod);return mod
long=load('pinit_longpath',HERE/'research-pengu-long-firstpass-20261024.py')
screen=load('pinit_screen',HERE/'research-pengu-initial-negative-screen-20261024.py')
ROOT=screen.ROOT;REPO=screen.REPO
def main():
 summary=json.loads((REPO/'docs/research/results/pengu-long-20261024/PENGU_LONG_CUMULATIVE_NATIVE_FULL8_AUDIT_20261024.json').read_text('utf8'))
 ref=load('pengu_recovery_reference',HERE/'research-residual-avax-composite-entry-veto-full8-20261023.py')
 ref.native.m.acquire_verified_h1()
 feed,_=ref.native.m.m.core.task8.legacy.bootstrap()
 bars,times=feed.getdata('PENGUUSDT')
 out={'status':'SCREEN_ONLY_NOT_FULL8','route':'RECOVERY_V8','cases':screen.POLICIES,'costs':{}}
 for cost in ('10','30'):
  sha=summary['cases']['LONG_PEAK2_FLOOR_MINUS5'][cost]['ledgerSha256']
  ledger=screen.disk_match(sha)
  items=[json.loads(z) for z in ledger.read_text('utf8').splitlines()]
  recovery=[r for r in items if r['strategy_id']=='PENGU' and r['entry_version']=='RECOVERY_V8']
  assert len(recovery)==37
  paths={int(r['entry_ts_ms']):long.make_path(r,bars,times) for r in recovery}
  cases=screen.evaluate(paths,recovery)
  valid=[(name,met) for name,met in cases.items() if met['previousWinnersCut']==0 and met['oldHardStopsSaved']>0]
  print('COST',cost,'RECOVERY',len(recovery),'WIN',sum(float(r['total_pnl_jpy'])>0 for r in recovery),
        'NO_OLD_WIN_KILLS_PROTECT_HARD',len(valid),flush=True)
  for name,met in sorted(valid,key=lambda kv:-kv[1]['modeledDirectDiffJpy'])[:30]:
   print('TOP',name,'TRIG',met['stopN'],'HARD',met['oldHardStopsSaved'],
        'DIRECT',round(met['modeledDirectDiffJpy'],2),flush=True)
  out['costs'][cost]={'recoveryTrades':len(recovery),'oldWins':sum(float(r['total_pnl_jpy'])>0 for r in recovery),'results':cases}
 target=REPO/'docs/research/results/pengu-initial-negative-20261024/PENGU_RECOVERY_V8_NEGATIVE_SELECTED_SCREEN_20261024.json'
 target.parent.mkdir(parents=True,exist_ok=True)
 target.write_text(json.dumps(out,indent=2,ensure_ascii=False)+'\n',encoding='utf8',newline='\n')
 print('SAVED',target,target.stat().st_size,flush=True)
if __name__=='__main__':main()
