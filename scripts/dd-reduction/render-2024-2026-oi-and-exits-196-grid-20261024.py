#!/usr/bin/env python3
"""Backtest combinations of A/B exits and a pre-established OI3 cutoff family.
Each candidate recomputes A/B chronological candidate reselection and 12h cooldown.
2025H2 already investigated and remains IN-SAMPLE; no new LIVE action.
"""
from __future__ import annotations
import json
from pathlib import Path
from importlib import util
HERE=Path(__file__).resolve().parent
OUT=HERE.parents[1]/'docs/research/results/render-three-regime-20261024'
def load(n,p):
 sp=util.spec_from_file_location(n,p);o=util.module_from_spec(sp);sp.loader.exec_module(o);return o
m=load('ab2024OI_exits20261024',HERE/'render-2024-AB-dual-exit-winrate-49-research-20261024.py')
data=m.make_bank()
cases=[]
for oi in (-.2,-.4,-.6,-.8):
 for a in m.orig.EXITS:
  for b in m.orig.EXITS:
   sel=m.pick(data,a,b,oi=oi)
   year={y:m.stat([x for x in sel if m.start[y]<=x['t']<m.end[y]],30)
    for y in ('2024','2025','2026')}
   segment={y:m.stat([x for x in sel if low<=x['t']<up],30)
    for y,(low,up) in m.subperiods.items()}
   qualify=(year['2024']['n']>=59 and year['2025']['n']>=55 and year['2026']['n']>=32
    and year['2024']['wr']>=65 and year['2025']['wr']>=62 and year['2026']['wr']>=68
    and all(year[y]['pf'] and year[y]['pf']>1.10 for y in year)
    and all(segment[y]['pf'] and segment[y]['pf']>1 for y in
    ('25_JAN_MAR','25_APR_JUL','25_AUG_DEC')))
   cases.append({'oi3Threshold':oi,'exitA':a,'exitB':b,'accepted':qualify,
     'year':year,'period':segment})
 print('OI_SCREEN_DONE',oi,'TOTAL',len([x for x in cases if x['oi3Threshold']==oi]),
 'ACCEPTED',sum(x['accepted'] for x in cases if x['oi3Threshold']==oi),flush=True)
winners=[x for x in cases if x['accepted']]
winners.sort(key=lambda q:(
 -min(q['period'][x]['pf'] for x in ('25_JAN_MAR','25_APR_JUL','25_AUG_DEC')),
 -q['year']['2024']['wr']))
for x in winners[:12]:
 print('ACCEPTED',x['oi3Threshold'],x['exitA'],x['exitB'],
 'YEARS',[(y,z['n'],z['wr'],z['pf'],z['sumNetPct']) for y,z in x['year'].items()],
 'H2',x['period']['25_AUG_DEC'],flush=True)
# Strict ceiling: do not call this independent OOS, avoid selecting by known window.
dest=OUT/'RENDER_2024_2026_OI2_4_6_8_AND_AB_EXIT_196_NATIVE_CANDIDATE_REPLAY_20261024.json'
out={'status':'RESEARCH_ONLY_OI_EXIT_GRID_IN_SAMPLE',
 'examined':len(cases),'qualifying':len(winners),'qualificationRule':
 '2024>=59 2025>=55 2026>=32 trades; WR 65/62/68; all annual PF>1.10; 2025 three-subperiod PF>1.00 at 30bps',
 'qualifyingCases':winners[:40],
 'allSummary':[{'oi':x['oi3Threshold'],'a':x['exitA'],'b':x['exitB'],
  'passes':x['accepted'],'y24':x['year']['2024'],'y25':x['year']['2025'],
  'y26':x['year']['2026'],'h2':x['period']['25_AUG_DEC']}
  for x in cases],
 'warnings':['All 196 are exploratory historical optimizations, not separate OOS.',
  'No 8-strategy wallet, signed venue fills, gross margin or live validation.',
  'No deployment of any exploratory candidate.']}
dest.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print('SAVED',dest,'QUALIFY',len(winners))
