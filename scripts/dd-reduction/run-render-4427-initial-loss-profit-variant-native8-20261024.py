#!/usr/bin/env python3
"""Native 8-strategy shared-wallet true replay for RENDER 4427 early-loss and
profit trailing variants (not just sleeve algebra). No LIVE deployment.
Usage --variant 28|53|561 --output C:/tmp/...
"""
from __future__ import annotations
import argparse,importlib.util,json,sys
from pathlib import Path
HERE=Path(__file__).resolve().parent
R=HERE.parents[1]
OUT=R/'docs/research/results/render-three-regime-20261024'
def module(n,p):
 s=importlib.util.spec_from_file_location(n,p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
def main():
 p=argparse.ArgumentParser()
 p.add_argument('--variant',type=int,choices=[28,53,561],required=True)
 p.add_argument('--output',type=Path,required=True)
 z=p.parse_args()
 assert z.output.resolve().as_posix().lower().startswith('c:/tmp/')
 # Original eight-wallet engine remains identical. Replace ONLY research new
 # candidate M5 exits and chosen as-of entry rows, not engine ownership/risk.
 current=module('render4427_overlay_variant_'+str(z.variant),
       HERE/'run-render-4427-native8-shared-wallet-20261024.py')
 raw=json.loads((OUT/'RENDER_4427_INITIAL_NEGATIVE_AND_PROFIT_PROTECTION_M5_MODEL_BANK_20261024.json').read_text('utf8'))
 all_grid=json.loads((OUT/'RENDER_4427_INITIAL_NEGATIVE_PROFIT_JOINT_2024_2026_GRID_20261024.json').read_text('utf8'))
 case=next(x for x in all_grid['allModelSummaries'] if x['i']==z.variant)
 current.candidate['exits'][current.engine.ab.A]=case['A']
 current.candidate['exits'][current.engine.ab.B]=case['B']
 current.bank=raw
 current.REC=sorted([v for v in raw['events'] if
   v['symbol']=='RENDERUSDT' and current.STAMP<=v['t']<current.END],key=lambda x:x['t'])
 assert len(current.REC)>=50
 old_case=current.new_case
 new_case='RENDER_4427_EARLY_PROFIT_V'+str(z.variant)+'_NATIVE8'
 basecase=current.native.BASE_CASE
 current.previous.CASE_RULES[new_case]={k:list(v) for k,v in current.previous.CASE_RULES[basecase].items()}
 current.previous.PROFIT_FLOOR[new_case]=.0035
 current.native.NEW_CASES[new_case]={'oi3':-.2,'trap':True,'bear':True,
  'variantNumber':z.variant,'prev4427Baseline':old_case}
 current.new_case=new_case
 evidence={'variantNumber':z.variant,'A':case['A'],'B':case['B'],
  'standalone2024_2026_30':case['30']['year'],
  '2025H2_30':case['30']['h2'],
  'status':'RESEARCH_ONLY_NATIVE8_NEW_4427_EXITS',
  'warnings':['2026-01-to-Aug native H1 mark only; no 2025 new RENDER fills',
    'Historical optimization, no pristine OOS',
    'Venue real signed stops/partial fills/funding not certified']}
 oldargv=sys.argv
 try:
  sys.argv=[str(HERE/'run-render-4427-native8-shared-wallet-20261024.py'),
           '--output',str(z.output)]
  print('START_4427_M5_EXIT_VARIANT',z.variant,'OLD',old_case,
    'NEW',new_case,'A',case['A'],'B',case['B'],flush=True)
  current.main()
 finally:sys.argv=oldargv
 z.output.mkdir(parents=True,exist_ok=True)
 (z.output/(new_case+'_selected_exit_evidence.json')).write_text(
   json.dumps(evidence,ensure_ascii=False,indent=2)+'\n','utf8')
 print('COMPLETE_4427_M5_EXIT_VARIANT',z.variant,new_case,flush=True)
if __name__=='__main__':main()
