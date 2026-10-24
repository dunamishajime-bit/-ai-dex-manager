#!/usr/bin/env python3
"""Six SHORT-entry route search, price/OI causal entry signals and 7 exits.
Recompute ownership/cooldown per contract and yearly/2025H2 cohort. Research
only; all 2024-2026 Aug returns were seen historically in previous studies.
"""
from __future__ import annotations
import collections,itertools,json,math
from pathlib import Path
from importlib import util
HERE=Path(__file__).resolve().parent
OUT=HERE.parents[1]/'docs/research/results/render-three-regime-20261024'
BANK=OUT/'RENDER_ALL_SIX_SHORT_CAUSAL_ENTRY_BANK_2024_2026AUG_20261024.json'
def load(n,p):
 sp=util.spec_from_file_location(n,p);z=util.module_from_spec(sp);sp.loader.exec_module(z);return z
ab=load('r6abprev',HERE/'render-2024-AB-dual-exit-winrate-49-research-20261024.py')
a=ab.A;b=ab.B
policies=list(ab.orig.EXITS)
t25h2=ab.subperiods['25_AUG_DEC']
OTHER=['SHORT_RALLY_TOP_BUYER_EXHAUST','SHORT_WEAK_BEAR_BREAK_OI_EXPAND',
 'SHORT_BTC_RALLY_RENDER_DIVERGENCE','SHORT_DEEP_DROP_FAILED_RETEST']
def make_scenarios():
 cases=[]
 for x in OTHER:
  for p in policies:
   for bp in ('TRAIL_MFE25_FLOOR10_H24','TAKE40_STOP30_H24'):
    for priority in ((b,x),(x,b)):
     cases.append((priority,{x:p,b:bp},'REPLACE_A'))
  for p in policies:
   for ap in ('TRAIL_MFE15_FLOOR05_H18','TRAIL_MFE25_FLOOR10_H24'):
    for bp in ('TRAIL_MFE25_FLOOR10_H24','TAKE40_STOP30_H24'):
     for priority in ((b,a,x),(b,x,a),(x,b,a),(a,b,x)):
      cases.append((priority,{x:p,a:ap,b:bp},'SUPPLEMENT_A'))
 for x,y in itertools.combinations(OTHER,2):
  for p,q in itertools.product(('TAKE15_STOP20_H6','TAKE40_STOP30_H24','TRAIL_MFE15_FLOOR05_H18'),repeat=2):
   for priority in ((b,x,y),(x,b,y),(b,y,x)):
    cases.append((priority,{x:p,y:q,b:'TRAIL_MFE25_FLOOR10_H24'},'REPLACE_A_TWO_EXPERTS'))
 return cases
def select(bank,priority,exit_map):
 chosen=[]
 for contract in ('RNDRUSDT','RENDERUSDT'):
  free=0
  for ev in bank:
   if ev['symbol']!=contract or ev['t']<free:continue
   route=None
   for route_candidate in priority:
    if route_candidate not in ev['shortSignals']:continue
    if route_candidate==b and ev['causalFeatures']['oi3Pct']>-.2:continue
    route=route_candidate;break
   if route is None:continue
   policy=exit_map[route]
   ex=ev['exitModels'][policy]
   chosen.append({'t':ev['t'],'symbol':contract,'entry':route,'exitName':policy,
    'return30':float(ex['net30']),'exitTs':int(ex['exitTs'])})
   free=int(ex['exitTs'])+12*ab.orig.HOUR
 chosen.sort(key=lambda z:z['t'])
 return chosen
def stats(events,cost):
 pnls=[v['return30']+(.3-cost/100) for v in events]
 wins=[z for z in pnls if z>0]
 losses=[z for z in pnls if z<=0]
 eq=peak=1;dd=0
 for x in pnls:
  eq*=1+x/100
  peak=max(eq,peak)
  dd=min(dd,100*(eq/peak-1))
 return {'n':len(pnls),'wins':len(wins),
  'wr':round(100*len(wins)/len(pnls),3) if pnls else None,
  'pf':round(sum(wins)/-sum(losses),4) if losses else None,
  'pnlPctSum':round(sum(pnls),3),'compoundPct':round(100*(eq-1),3),
  'closeDdPct':round(dd,3),'maxLossPct':round(min(pnls),3) if pnls else None,
  'byEntry':dict(collections.Counter(v['entry'] for v in events))}
def main():
 data=json.loads(BANK.read_text('utf8'))
 assert data['status']=='CAUSAL_RESEARCH_ONLY_ALL_SHORT_MARKET5M_FULL_EPISODES'
 bank=data['events']
 print('INPUT_EVENTS',len(bank),'BY_SHORT',data['counts'],flush=True)
 outputs=[]
 baselines=[('NO_CHANGE',(a,b),{a:'TAKE40_STOP30_H24',b:'TAKE40_STOP30_H24'}),
   ('HIGH_WR_A_B',(a,b),{a:'TRAIL_MFE15_FLOOR05_H18',b:'TRAIL_MFE25_FLOOR10_H24'})]
 scenarios=[(p,m,k) for p,m,k in make_scenarios()]
 for mode,priority,policy in baselines:
  choice=select(bank,priority,policy)
  print('BASE',mode,[(year,stats([x for x in choice if ab.start[year]<=x['t']<ab.end[year]],30))
    for year in ('2024','2025','2026')],flush=True)
 for ind,(priority,policy,mode) in enumerate(scenarios):
  choose=select(bank,priority,policy)
  year={year:stats([x for x in choose if ab.start[year]<=x['t']<ab.end[year]],30)
    for year in ('2024','2025','2026')}
  h2=stats([x for x in choose if t25h2[0]<=x['t']<t25h2[1]],30)
  hy={n:stats([x for x in choose if st<=x['t']<ed],30)
    for n,(st,ed) in ab.subperiods.items()}
  enough=(year['2024']['n']>=62 and year['2025']['n']>=57 and year['2026']['n']>=36)
  qualified=(enough and all((year[y]['pf'] or 0)>1.1
    and (year[y]['wr'] or 0)>=65 for y in year)
    and (h2['pf'] or 0)>1 and all((hy[z]['pf'] or 0)>1
      for z in ('25_JAN_MAR','25_APR_JUL','25_AUG_DEC')))
  key={'i':ind,'priority':list(priority),'exits':policy,
     'mode':mode,'qualified':qualified,'year':year,'2025H2':h2,
     'subperiod':hy}
  outputs.append(key)
  if (ind+1)%150==0:print('COMPLETE',ind+1,'OF',len(scenarios),flush=True)
 passing=[x for x in outputs if x['qualified']]
 def score(z):
  years=z['year'];dd=max(-years[y]['closeDdPct'] for y in years)
  return ((not z['qualified']),-min((years[y]['pf'] or 0) for y in years),
   -min((years[y]['wr'] or 0) for y in years),dd)
 outputs.sort(key=score)
 print('TESTED',len(outputs),'QUALIFIED',len(passing),flush=True)
 for x in outputs[:20]:
  print('TOP',x['qualified'],x['mode'],x['priority'],x['exits'],
    'YEAR',[(y,v['n'],v['wr'],v['pf'],v['closeDdPct']) for y,v in x['year'].items()],
    '2025H2',x['2025H2']['pf'],x['2025H2']['pnlPctSum'],flush=True)
 dest=OUT/'RENDER_SIX_SHORT_ENTRY_REPLACE_PRIORITY_EXIT_COHORT_GRID_20261024.json'
 report={'status':'RESEARCH_ONLY_SIX_SHORT_ENTRY_COHORT_REDESIGN_NEEDS_INDEPENDENT_VALIDATION',
   'entryBank':BANK.name,'tested':len(outputs),'qualifying':len(passing),
   'training':'2024-01-01..2026-08-09 all previously previewed market datasets',
   'criteria':'all annual n 62/57/36+, annual WR65% and PF>1.1, 2025Q1/Q2/H2 30bps PF>1',
   'warnings':['No external untouched OOS and NO LIVE authorization','Separate RNDR/RENDER contract',
      'Trade-close drawdown NOT native8 intratrade MTM',
      'Not a native shared-wallet portfolio backtest',
      'Source signal/OI latency and funding expense assumptions require venue verification'],
   'top':outputs[:120],'passing':passing}
 dest.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n','utf8')
 print('WRITTEN',dest,flush=True)
if __name__=='__main__':main()
