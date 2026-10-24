#!/usr/bin/env python3
"""2026Aug-Oct *retrospective* recheck of 4427 early-negative and profit-stop exits.
The post-2026-08 window has already been inspected for previous RENDER studies:
NOT pristine OOS. No parameter selection using post period; preselected indices.
"""
from __future__ import annotations
import collections,json
from pathlib import Path
from importlib import util
ROOT=Path(__file__).resolve().parents[2]
HERE=Path(__file__).resolve().parent
OUT=ROOT/'docs/research/results/render-three-regime-20261024'
def load(n,p):
 s=util.spec_from_file_location(n,p);z=util.module_from_spec(s);s.loader.exec_module(z);return z
r=load('render4427_retrospective_router',HERE/'render-six-short-entry-portfolio-priority-grid-20261024.py')
A=r.ab.A;B=r.ab.B;X='SHORT_DEEP_DROP_FAILED_RETEST'
pri=[A,X,B]
INDEXES=[28,33,47,53,54,351,395,413,417,429,431,433,435,449,453,471,489,553,557,561,575,579]
DATAFILE='RENDER_4427_INITIAL_NEGATIVE_PROFIT_JOINT_2024_2026_GRID_20261024.json'
HOLDFILE='RENDER_ALL_SIX_SHORT_POSTAUG2026_RETROSPECTIVE_HOLDOUT_BANK_20261024.json'
def main():
 j=json.loads((OUT/DATAFILE).read_text('utf8'))
 one={x['i']:x for x in j['allModelSummaries']}
 bank=json.loads((OUT/HOLDFILE).read_text('utf8'))['events']
 assert bank and all('E_NONE__P_BASE' in x['exitModels']
   for x in bank if A in x['shortSignals'] or (B in x['shortSignals'] and x['causalFeatures']['oi3Pct']<=-.2))
 ref=r.select(bank,pri,{A:'E_NONE__P_BASE',B:'E_NONE__P_BASE',X:'TAKE15_STOP20_H6'})
 orig={str(cost):r.stats(ref,cost) for cost in (10,30)}
 print('RETRO_BASE',orig,flush=True)
 results=[]
 for i in INDEXES:
  c=one[i]
  events=r.select(bank,pri,{A:c['A'],B:c['B'],X:'TAKE15_STOP20_H6'})
  fields={str(cost):r.stats(events,cost) for cost in (10,30)}
  results.append({'i':i,'stage':c['stage'],'A':c['A'],'B':c['B'],
    'training2025H2_30':c['30']['h2'],'retro':fields,
    'retroDeltaPct30':round(fields['30']['pnlPctSum']-orig['30']['pnlPctSum'],3),
    'strictHist':c['gates']['strict']})
  print('RETRO',i,c['stage'],'DIFF30',results[-1]['retroDeltaPct30'],
    fields['30'],'TRAIN_H2_PF',c['30']['h2']['pf'],flush=True)
 dest=OUT/'RENDER_4427_INITIAL_LOSS_PROFIT_PRESERVATION_AUG_OCT_RETROSPECTIVE_20261024.json'
 report={'status':'RESEARCH_ONLY_NO_PRISTINE_OOS_4427_LOSS_PROFIT_COMBINATION_RECHECK',
  'period':'2026 Aug10-Oct22 previously reused, sample tiny',
  'preselectedModelIndices':INDEXES,'base':orig,'cases':results,
  'warnings':['Retrospective window had previous RENDER study and is not untouched OOS',
   'Multiple prior 2024-26 optimizations: improvements not proof of forward performance',
   'M5 model no signed Aster stop/protect order real executions',
   'Native8 must separately test 10/30bps and account DD before LIVE',
   'No Production/VPS/HP/live trades touched']}
 dest.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n','utf8')
 print('DONE',dest)
if __name__=='__main__':main()
