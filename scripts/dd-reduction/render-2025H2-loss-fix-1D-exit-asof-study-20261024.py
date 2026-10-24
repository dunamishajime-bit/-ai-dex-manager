#!/usr/bin/env python3
"""Research-only: loss decomposition and pre-entry feature gated EXIT adaptation.
Search 1D as-of feature gates among predeclared 7 published exits;
never apply a hindsight-specific trade label/date. Re-run dynamic symbol
cooldown and simultaneous account-compatible entries after every candidate.
No change to native8 or LIVE. 2025-H2 is IN SAMPLE during search.
"""
from __future__ import annotations
import importlib.util,json,math,statistics,collections
from pathlib import Path
HERE=Path(__file__).resolve().parent
OUT=HERE.parents[1]/'docs/research/results/render-three-regime-20261024'
def load(n,p):
 s=importlib.util.spec_from_file_location(n,p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
r=load('render_ab_exits_research',HERE/'render-2024-AB-dual-exit-winrate-49-research-20261024.py')
A=r.A;B=r.B;POLICIES=list(r.orig.EXITS)
baseA='TRAIL_MFE15_FLOOR05_H18';baseB='TRAIL_MFE25_FLOOR10_H24'
rows=r.make_bank()
all_features=list(rows[0]['f'])
def pick_case(feature,threshold,direction,expert,alternative,oi=-.2):
 sel=[]
 for sym in ('RNDRUSDT','RENDERUSDT'):
  free=0
  for e in rows:
   if e['symbol']!=sym or e['t']<free:continue
   if A in e['signals']:route='A';chosen=baseA
   elif B in e['signals'] and e['f']['oi3Pct']<=oi:route='B';chosen=baseB
   else:continue
   if feature is not None and route==expert:
    v=float(e['f'][feature])
    gate=v<=threshold if direction=='LE' else v>=threshold
    if gate:chosen=alternative
   trade={'t':e['t'],'symbol':sym,'route':route,'exit':e['outcomes'][chosen],'f':e['f'],
     'exitPolicy':chosen}
   sel.append(trade)
   free=int(trade['exit']['exitTs'])+12*r.orig.HOUR
 sel.sort(key=lambda x:x['t'])
 return sel
def block(trades,scope,cost):
 if scope in r.start:lo,hi=r.start[scope],r.end[scope]
 else:lo,hi=r.subperiods[scope]
 group=[x for x in trades if lo<=x['t']<hi]
 return r.stat(group,cost)
def score(trades):
 yearly={yr:block(trades,yr,30) for yr in ('2024','2025','2026')}
 segments={yr:block(trades,yr,30) for yr in r.subperiods}
 stable2025=[segments[v] for v in ('25_JAN_MAR','25_APR_JUL','25_AUG_DEC')]
 cond=(yearly['2024']['n']>=66 and yearly['2025']['n']>=60 and yearly['2026']['n']>=38
  and yearly['2024']['wr']>=65 and yearly['2026']['wr']>=68
  and all(s['pf'] is not None and s['pf']>1 for s in stable2025)
  and all(yearly[yr]['pf'] is not None and yearly[yr]['pf']>1.05 for yr in yearly))
 val=min((s['pf'] or 0) for s in stable2025)
 return cond,val,yearly,segments
baseline=pick_case(None,0,None,None,None)
_,_,by,part=score(baseline)
print('BASE',[(k,v['n'],v['wr'],v['pf'],v['sumNetPct']) for k,v in by.items()])
print('BASE_H2',part['25_AUG_DEC'])
losses=[]
for x in baseline:
 if r.subperiods['25_AUG_DEC'][0]<=x['t']<r.subperiods['25_AUG_DEC'][1]:
  losses.append(x)
print('H2_CANDIDATES')
for x in losses:
 print('H2',x['route'],x['t'],round(x['exit']['net30'],3),x['exit']['reason'],
  'FEATURES',json.dumps({k:round(float(x['f'][k]),3) for k in
      ('ret1','ret6','ret24','btc1','btc6','btc24','rel6','last15','hourWick','volumeRatio','seller1','sellerAcceleration','oi1Pct','oi3Pct','fundingBps','render7','btc7','renderRV7')}),
   flush=True)
scores=[]
for expert in ('A','B'):
 for alternative in POLICIES:
  if alternative==(baseA if expert=='A' else baseB):continue
  for feature in all_features:
   candidates=[float(e['f'][feature]) for e in rows if
     (A in e['signals'] if expert=='A' else B in e['signals'] and e['f']['oi3Pct']<=-.2)]
   vals=sorted(set(candidates))
   if len(vals)<15:continue
   quantiles=[vals[round((len(vals)-1)*q)] for q in (.1,.2,.3,.4,.5,.6,.7,.8,.9)]
   for threshold in sorted(set(quantiles)):
    for direction in ('LE','GE'):
     selected=pick_case(feature,threshold,direction,expert,alternative)
     ok,min2025,yrs,segs=score(selected)
     scores.append({'expert':expert,'feature':feature,'threshold':threshold,
       'direction':direction,'alternative':alternative,'accepted':ok,
       'weak2025PF':round(min2025,3),
       'year':yrs,
       'h2':segs['25_AUG_DEC'],
       'subperiodPF':{y:segs[y]['pf'] for y in r.subperiods},
       'meanAnnual30SumPct':round(sum(yrs[y]['sumNetPct'] for y in yrs),3)})
print('GRID_TOTAL',len(scores),'ACCEPTED',sum(s['accepted'] for s in scores))
scores.sort(key=lambda q:(
    not q['accepted'],
    -q['weak2025PF'],
    -q['h2']['sumNetPct'],
    -q['meanAnnual30SumPct']))
for z in scores[:20]:
 print('TOP',z['accepted'],z['expert'],z['feature'],z['direction'],round(z['threshold'],3),
   z['alternative'],'H2',z['h2'],'YEARS',
   [(y,t['n'],t['wr'],t['pf']) for y,t in z['year'].items()],
   flush=True)
dest=OUT/'RENDER_2025H2_CAUSAL_ASOF_EXIT_GATE_1D_RESEARCH_20261024.json'
final={'status':'RESEARCH_ONLY_IN_SAMPLE_H2_CAUSAL_GATE_SEARCH_NOT_LIVE',
 'features':all_features,'tested':len(scores),
 'acceptedNoFrequencyReductionAll2025QuartersPF1':sum(x['accepted'] for x in scores),
 'baseline':{'years':by,'segments':part},'leadingCases':scores[:80],
 'warnings':['2025-H2 was used for search so IS NOT independent out-of-sample',
 'No 8-logic wallet/native ownership parity for these exit variants',
 'Full M5 2024-26 available until Aug10 2026, new dates are not included',
 'No production/LIVE/no real orders changed']}
dest.write_text(json.dumps(final,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print('RESEARCH_SAVED',dest,flush=True)
