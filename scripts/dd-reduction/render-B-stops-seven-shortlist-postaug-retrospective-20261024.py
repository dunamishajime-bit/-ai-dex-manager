#!/usr/bin/env python3
"""Preselected B initial stops / RENDER six SHORT 2026 Aug-Oct retrospective.
No hyperparameter search on after Aug. Previously inspected window, so
results are neither pristine OOS nor LIVE fills.
"""
from pathlib import Path
import json
from importlib import util
HERE=Path(__file__).resolve().parent
OUT=HERE.parents[1]/'docs/research/results/render-three-regime-20261024'
def load(n,p):
 sp=util.spec_from_file_location(n,p);z=util.module_from_spec(sp);sp.loader.exec_module(z);return z
e=load('shortportfolio2026hold',HERE/'render-six-short-entry-portfolio-priority-grid-20261024.py')
ab=e.ab
SOURCE='RENDER_ALL_SIX_SHORT_POSTAUG2026_RETROSPECTIVE_HOLDOUT_BANK_20261024.json'
REFERENCE='RENDER_B_30_INITIAL_STOP_AND_ENTRY_PORTFOLIO_COHORT_GRID_20261024.json'
ids=[4427,4429,3319,3320,4390,2311,415]
def run():
 h=json.loads((OUT/SOURCE).read_text('utf8'))
 assert h['status']=='RESEARCH_ONLY_RETROSPECTIVE_2026AUG22_OCT22_6SHORT_M5_BANK'
 bank=h['events']
 src=json.loads((OUT/REFERENCE).read_text('utf8'))
 rows={x['index']:x for x in src['allCasesSummary']}
 results={}
 for idx in ids:
  candidate=rows[idx]
  select=e.select(bank,candidate['priority'],candidate['exits'])
  seg=[x for x in select if x['t']>=ab.orig.e.ms('2026-09-01')]
  results[str(idx)]={'config':candidate,
   'all':{str(bps):e.stats(select,bps) for bps in (10,30)},
   'afterSep1':{str(bps):e.stats(seg,bps) for bps in (10,30)},
   'events':select}
  print('POSTAUG_CASE',idx,'AFTER3YR',candidate['year30'],
   'H2',candidate['h230'],
   'RETRO',results[str(idx)]['all']['30'],flush=True)
 baseline=[]
 for kind,pr,ex in (
  ('OLD_A_B_TAKE',(ab.A,ab.B),{ab.A:'TAKE40_STOP30_H24',ab.B:'TAKE40_STOP30_H24'}),
  ('HIGH_WR_A_B',(ab.A,ab.B),{ab.A:'TRAIL_MFE15_FLOOR05_H18',ab.B:'TRAIL_MFE25_FLOOR10_H24'}),
  ('HIGH_WR_ADD_DIVERGENCE',(ab.A,ab.B,'SHORT_BTC_RALLY_RENDER_DIVERGENCE'),{
      ab.A:'TRAIL_MFE15_FLOOR05_H18',ab.B:'TRAIL_MFE25_FLOOR10_H24',
      'SHORT_BTC_RALLY_RENDER_DIVERGENCE':'TAKE15_STOP20_H6'})):
  tr=e.select(bank,pr,ex)
  baseline.append({'name':kind,'all':{str(cost):e.stats(tr,cost) for cost in (10,30)}})
 print('BASELINES',baseline,flush=True)
 report={'status':'RESEARCH_ONLY_RETROSPECTIVE_SECOND_LOOK_NO_NATIVE8',
 'period':'2026-08-10 through 2026-10-22 (previously investigated period)',
 'costs':[10,30],'preselectedIndices':ids,
 'candidates':results,'baselines':baseline,
 'warnings':['Retrospective second look, NOT independent OOS',
    'B 1.5%-3.5% stop contract differs from venue stop/native wallet',
    'No rigorous live venue fill/funding/slippage lifecycle',
    'No adoption / no order allowed']}
 dst=OUT/'RENDER_2026AUG_OCT_7_CANDIDATE_B_STOP_RECHECK_20261024.json'
 dst.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n','utf8')
 print('SAVED',dst,flush=True)
if __name__=='__main__':run()
