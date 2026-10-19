#!/usr/bin/env python3
"""Synchronous research runner: wait for isolated robust full8, replay combined exits, seal report, research push. NEVER LIVE."""
from pathlib import Path
import os,json,sys,subprocess,time,traceback,runpy,hashlib
root=Path(__file__).resolve().parents[1]
reports=root/'docs/research/results/long-loss-research-20261019'
primary=reports/'SEQUENTIAL_ROBUST_BASELINE_9SIDES_20261019.json'
combo=reports/'SEQUENTIAL_COMBINED_ROBUST_TWO_AXIS_AND_HV_20261019.json'
def status(p):
 try:return json.loads(p.read_text('utf8'))['status']
 except (FileNotFoundError,ValueError,KeyError):return 'NOT_READY'
def sh(*args,timeout=120):
 z=subprocess.run(args,cwd=root,capture_output=True,text=True,errors='replace',timeout=timeout)
 print('CMD', ' '.join(args[:3]),'RC',z.returncode,'OUT',z.stdout[-3500:],'ERR',z.stderr[-1200:],flush=True)
 if z.returncode:raise RuntimeError('GIT_COMMAND_FAILED '+repr(args[:3]))
 return z.stdout
def go():
 print('STEP_WAIT_FOR_ROBUST_EXACT_CUMULATIVE',flush=True)
 start=time.monotonic();last=None
 while True:
  s=status(primary)
  if s!=last:print('ROBUST_STATUS',s,flush=True);last=s
  if s=='COMPLETED_EIGHT_SCOPES_RESEARCH_ONLY':break
  if s.startswith('ERROR') or s.startswith('BLOCKED'):raise RuntimeError('ROBUST_RUN_FAILED '+s)
  if time.monotonic()-start>1800:raise TimeoutError('ROBUST_30MIN_STILL_INCOMPLETE')
  time.sleep(3)
 assert all(x['status'] in ('NO_CANDIDATE_ADOPTED','NO_ACCEPTED_TRADES_IN_THIS_SIDE',
 'PROVISIONAL_CARRY_RESEARCH_ONLY','BLOCKED_HISTORICAL_STOCK_5M_COVERAGE') for x in json.loads(primary.read_text('utf8'))['stages'])
 print('STEP_COMBINED_FULL8_CAUSAL_STOPS_BEGIN',flush=True)
 runpy.run_path(str(root/'research/sequential_combined_robust_baseline_20261019.py'),run_name='__main__')
 assert status(combo)=='COMPLETED_COMBINED_EXPERIMENTS_WITH_MARKET_DATA_GAPS'
 print('STEP_FINAL_PROVENANCE_AND_REPORT_BEGIN',flush=True)
 runpy.run_path(str(root/'research/build_sequential_final_verdict_20261019.py'),run_name='__main__')
 final=reports/'SEQUENTIAL_FINAL_HANDOFF_20261019.json'
 result=json.loads(final.read_text('utf8'))
 assert result['status']=='COMPLETED_RESEARCH_WITH_V52_STOCK_M5_CERTIFICATION_GAP'
 assert not result['production_changed']
 print('STEP_VERIFY_FINAL_EVIDENCE',json.dumps(result['final_portfolio'],ensure_ascii=False),flush=True)
 # Source and evidence only, never research_runs raw price data or credentials.
 files=[
 'research/sequential_remaining_8_sides_20261019.py',
 'research/sequential_hype_stop_slippage_20261019.py',
 'research/sequential_robust_oct17_baseline_sweep_20261019.py',
 'research/sequential_combined_and_highvol_20261019.py',
 'research/sequential_combined_robust_baseline_20261019.py',
 'research/build_sequential_final_verdict_20261019.py',
 'research/execute_full_exit_campaign_20261019.py',
 'docs/research/results/long-loss-research-20261019/SEQUENTIAL_STEP05_TO_12_CUMULATIVE_20261019.json',
 'docs/research/results/long-loss-research-20261019/SEQUENTIAL_ROBUST_BASELINE_9SIDES_20261019.json',
 'docs/research/results/long-loss-research-20261019/SEQUENTIAL_HYPE_LONG_1P5_STOP_SLIPPAGE_20261019.json',
 'docs/research/results/long-loss-research-20261019/SEQUENTIAL_COMBINED_ROBUST_TWO_AXIS_AND_HV_20261019.json',
 'docs/research/results/long-loss-research-20261019/SEQUENTIAL_FINAL_HANDOFF_20261019.json',
 'docs/research/results/long-loss-research-20261019/SEQUENTIAL_FINAL_INTEGRATED_VERDICT_20261019.md']
 for fn in files:assert (root/fn).is_file(),fn
 before=sh('git','branch','--show-current').strip()
 assert before=='research/long-loss-h1-causal-study-20261019'
 target='research/full8-side-exit-robust-study-20261019'
 # Use new branch to avoid clobbering other researchers' branch.
 sh('git','switch','-c',target)
 sh('git','add','--',*files)
 selected=sh('git','diff','--cached','--name-only')
 assert 'SEQUENTIAL_FINAL_INTEGRATED_VERDICT' in selected
 sh('git','commit','-m','research: full8 sequential exits with stop slippage robust validation',timeout=180)
 sha=sh('git','rev-parse','HEAD').strip()
 try:
  sh('git','push','-u','origin',target,timeout=180)
  pushed=True
 except Exception as exc:
  pushed=False
  print('PUSH_FAILED',str(exc),flush=True)
 print('RESULT_STATUS',result['status'],'PUSHED',pushed,'BRANCH',target,'SHA',sha,
  'ADOPTED',[x['id'] for x in result['post_combination_specs']],flush=True)
 if not pushed:raise RuntimeError('COMPLETED_RESEARCH_BUT_PUSH_UNCONFIRMED')
if __name__=='__main__':
 try:go()
 except Exception:
  traceback.print_exc();raise
