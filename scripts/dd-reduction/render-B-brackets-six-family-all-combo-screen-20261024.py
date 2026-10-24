#!/usr/bin/env python3
"""Grid against 30 causal B stop-TP-trail brackets and other A/X entries.
All train years historical/in-sample. Do not accept until separately
rechecked post-Aug2026, then native8 shared-wallet DD + gross.
"""
from __future__ import annotations
import itertools,json,collections
from pathlib import Path
from importlib import util
ROOT=Path(__file__).resolve().parents[2]
HERE=Path(__file__).resolve().parent
OUT=ROOT/'docs/research/results/render-three-regime-20261024'
def load(n,p):
 s=util.spec_from_file_location(n,p);m=util.module_from_spec(s);s.loader.exec_module(m);return m
runner=load('new_B_stop_router',HERE/'render-six-short-entry-portfolio-priority-grid-20261024.py')
ab=runner.ab
base=json.loads((OUT/'RENDER_2024_2026_ALL_SIX_WITH_B_30_BRACKETS_M5_LEDGER_20261024.json').read_text('utf8'))
bank=base['events']
b=ab.B;a=ab.A
MODES=['TAKE15_STOP20_H6','TRAIL_MFE15_FLOOR05_H18','TRAIL_MFE25_FLOOR10_H24']
stop=list(base['BVariants'])
h2lo,h2hi=ab.subperiods['25_AUG_DEC']
OUTPUT=[]
picks=[]
for br in stop:
 for ae in ('TRAIL_MFE15_FLOOR05_H18','TRAIL_MFE25_FLOOR10_H24'):
  for pri in ((a,b),(b,a)):
   picks.append((list(pri),{a:ae,b:br},'DUAL_B_NEW_STOP'))
for x in runner.OTHER:
 for br in stop:
  for xp in MODES:
   for pri in ((b,x),(x,b)):
    picks.append((list(pri),{x:xp,b:br},'REPLACED_A_B_STOP'))
  for ae in ('TRAIL_MFE15_FLOOR05_H18','TRAIL_MFE25_FLOOR10_H24'):
   for xp in MODES:
    for pri in ((a,b,x),(b,a,x),(a,x,b),(b,x,a),(x,b,a)):
     picks.append((list(pri),{x:xp,a:ae,b:br},'TRIPLE_B_NEW_STOP'))
def one(v):
 filtered=runner.select(bank,v[0],v[1])
 year={y:runner.stats([x for x in filtered if ab.start[y]<=x['t']<ab.end[y]],30)
    for y in ('2024','2025','2026')}
 sub={k:runner.stats([x for x in filtered if s<=x['t']<e],30)
    for k,(s,e) in ab.subperiods.items()}
 return year,sub
for i,p in enumerate(picks):
 year,sub=one(p)
 q=(all(year[y]['n']>=cnt for y,cnt in [('2024',65),('2025',60),('2026',38)])
   and all((year[y]['wr'] or 0)>=67 and (year[y]['pf'] or 0)>1.15
      and year[y]['compoundPct']>0 for y in year)
   and all((sub[s]['pf'] or 0)>1 for s in ('25_JAN_MAR','25_APR_JUL','25_AUG_DEC'))
   and sub['25_AUG_DEC']['n']>=17
   and all(year[y]['closeDdPct']>=-20 for y in year))
 OUTPUT.append({'caseIndex':i,'priority':p[0],'exits':p[1],'mode':p[2],
  'strict':q,'years':year,'period':sub})
 if (i+1)%500==0:print('SCREEN',i+1,'/',len(picks),'PASS',
   sum(x['strict'] for x in OUTPUT),flush=True)
passed=[c for c in OUTPUT if c['strict']]
def sortkey(x):
 year=x['years']
 ann_pf=min((year[y]['pf'] or 0) for y in year)
 ann_w=min((year[y]['wr'] or 0) for y in year)
 h2pf=(x['period']['25_AUG_DEC']['pf'] or 0)
 return (not x['strict'],-h2pf,-ann_pf,-ann_w)
OUTPUT.sort(key=sortkey)
print('SCORE_TOTAL',len(OUTPUT),'STRICT_PASS',len(passed))
for x in OUTPUT[:23]:
 print('TOP',x['strict'],x['mode'],x['priority'],x['exits'],
  'YEAR',[(y,r['n'],r['wr'],r['pf'],r['closeDdPct']) for y,r in x['years'].items()],
  'H2',x['period']['25_AUG_DEC']['pf'],x['period']['25_AUG_DEC']['pnlPctSum'],flush=True)
save=OUT/'RENDER_B_30_INITIAL_STOP_AND_ENTRY_PORTFOLIO_COHORT_GRID_20261024.json'
report={'status':'RESEARCH_ONLY_REGENERATED_M5_B_30_STOP_TAKE_TRAIL_AND_SIX_SHORTS',
 'tested':len(OUTPUT),'strictPass':len(passed),
 'strict':'2024>=65 2025>=60 2026>=38, annual WR>=67, PF>1.15, compound>0, DD>-20; 2025 3 segments PF>1',
 'allCasesTop80':OUTPUT[:80],
 'passingCandidates':passed,
 'allCasesSummary':[
  {'index':x['caseIndex'],'priority':x['priority'],'exits':x['exits'],'mode':x['mode'],
    'strict':x['strict'],
    'year30':{y:{k:x['years'][y][k] for k in ('n','wr','pf','closeDdPct')} for y in x['years']},
    'h230':{k:x['period']['25_AUG_DEC'][k] for k in ('n','wr','pf','pnlPctSum')}}
  for x in OUTPUT],
 'warnings':['All time windows in optimization historical and previously accessed',
  '2026 Aug-Oct extra check mandatory; no native8 shared-wallet deployment',
  'Model M5 10/30bps, not actual venue fills']}
save.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n','utf8')
print('SAVED',save)
