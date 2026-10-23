#!/usr/bin/env python3
"""Research-only candidate wrapper: current 8-strategy PENGU/AVAX cumulative baseline plus RENDER SHORT initial soft exits.
Do not deploy. Every candidate is evaluated causally from completed M5 closes; model fills next M5 open.
"""
from __future__ import annotations
import argparse,importlib.util,sys,collections
from pathlib import Path
HERE=Path(__file__).resolve().parent
def load(name,p):
 sp=importlib.util.spec_from_file_location(name,p)
 x=importlib.util.module_from_spec(sp);sp.loader.exec_module(x);return x
screen=load('idle_next_risk_policy',HERE/'screen-idle-next-m5-after-pengu-20261024.py')
cumulative=load('idle_after_pengu_combined8',HERE/'research-pengu-combined-normal8-recovery24-full8-20261024.py')
base=cumulative.base
wrapper=base.native_wrapper
native=wrapper.native
orig_filter=native.m.m.entry_filter
CASES={
 'RENDER_SUSTAIN2_MIN180_MFE1':'SUSTAIN2_MIN180_MFE1',
 'RENDER_TOUCH1_WATCH2_MFE0P25':'TOUCH1_WATCH2_MFE0.25',
 'RENDER_AT4_LOSS1_MFE0P25':'AT4_LOSS1_MFE0.25',
}
assert set(CASES.values())<=set(screen.CASES)
ACTIVE={'case':None,'cache':{}}
def idle_filter(rows,overlays,source,cost_bps,obs,baseline_lookup=None):
 filtered=orig_filter(rows,overlays,source,cost_bps,obs,baseline_lookup)
 out=[]
 for row in filtered:
  if row.get('strategy_id')=='IDLE' and row.get('symbol')=='RENDERUSDT' and row.get('side')=='SHORT':
   t=row.get('entry_ts_ms')
   if t is None:raise AssertionError(('MISSING_IDLE_TIMESTAMP',row.get('candidate_id')))
   z=screen.path_short(row,source)
   trigger=screen.stop(z,screen.CASES[CASES[ACTIVE['case']]],int(t))
   if trigger is not None and int(t)<trigger['ts']<int(row['exit_ts_ms']):
    updated=dict(row,exit_ts_ms=int(trigger['ts']),
       exit_price=float(trigger['fillPrice']),
       unit_price_return=1-float(trigger['fillPrice'])/float(row['entry_price']),
       exit_reason='RESEARCH_IDLE_RENDER_INITIAL_'+ACTIVE['case'],
       research_idle_old_exit=int(row['exit_ts_ms']))
    obs['idleRenderInitialTriggers']=obs.get('idleRenderInitialTriggers',0)+1
    obs.setdefault('idleRenderInitialAudit',[]).append(
     {'candidateId':row.get('candidate_id'),'entryTsMs':t,'stopTsMs':trigger['ts'],
      'fillGainPct':trigger['gainFillNext'],'originalExitTsMs':row['exit_ts_ms']})
    out.append(updated);continue
  out.append(row)
 return out
def main():
 ap=argparse.ArgumentParser()
 ap.add_argument('--output',type=Path,required=True)
 ap.add_argument('--case',choices=list(CASES),required=True)
 args=ap.parse_args()
 assert base.REPO not in (args.output.resolve(),*args.output.resolve().parents)
 ACTIVE['case']=args.case
 native.m.m.entry_filter=idle_filter
 base.CASES={args.case:{'longRules':[],'longScope':'BOTH'}}
 original_argv=sys.argv
 try:
  sys.argv=[str(HERE/'research-pengu-combined-normal8-recovery24-full8-20261024.py'),
     '--output',str(args.output),'--cases',args.case]
  print('RUN_IDLE_RESEARCH',args.case,'REST_CUMULATIVE_PENGU_BASELINE_PRESERVED',flush=True)
  cumulative.main()
 finally:
  sys.argv=original_argv
if __name__=='__main__':main()
