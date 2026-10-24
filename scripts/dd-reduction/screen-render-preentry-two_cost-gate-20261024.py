#!/usr/bin/env python3
"""Research only pre-entry feature family screen, explicit multiple-testing warning.
Observe selected 10/30bps RENDER trades from exact native dynamic baseline.
No endpoint or label leakage in gate conditions; full8 reallocation is not evaluated.
"""
from __future__ import annotations
import collections,json,math
from pathlib import Path
R=Path(__file__).resolve().parents[2]
D=R/'docs/research/results/idle-entry-three-20261024'
raw=json.loads((D/'IDLE_RENDER_REBOUND_FADE_PREALLOCATION_SCREEN_20261024.json').read_text('utf8'))
FEAT_GRIDS={
 'ret1h':[-2,-1.5,-1,-.5,0,.5,1,2],
 'ret3h':[-3,-2,-1.5,-1,-.5,0,.5,1,2],
 'last15':[-.8,-.6,-.4,-.2,0,.2,.4,.6],
 'last30':[-1.5,-1,-.75,-.5,-.25,0,.25,.5],
 'rebound2to1':[.3,.5,.75,1,1.5,2,3],
 'fadefrom1hhigh':[.15,.3,.5,.75,1,1.5,2],
 'fadefrom3hhigh':[.5,1,1.5,2,3,4],
 'rangepos3h':[.1,.2,.3,.4,.5,.6,.75],
 'first45':[-2,-1,-.5,0,.5,1,2]
}
def stats(data):
 n=len(data);wins=sum(z['win'] for z in data)
 return {'n':n,'wins':wins,'wr':round(100*wins/n,2) if n else None,
 'netReturnSumPct':round(sum(z['ret'] for z in data),3)}
def main():
 costs={c:raw['costs'][c]['candidateDetail'] for c in ('10','30')}
 selected={c:[z for z in costs[c] if z['selected']] for c in costs}
 rules=[]
 for feat,grid in FEAT_GRIDS.items():
  for op in ('>=','<='):
   for t in grid:
    name=f'{feat}{op}{t}'
    d={}
    for c in ('10','30'):
     kept=[z for z in selected[c] if (z['features'][feat]>=t if op=='>=' else z['features'][feat]<=t)]
     bad=[z for z in selected[c] if z not in kept]
     allcand=[z for z in costs[c] if (z['features'][feat]>=t if op=='>=' else z['features'][feat]<=t)]
     d[c]={'kept':stats(kept),'removed':stats(bad),'candidateN':len(allcand),
       'early':stats([z for z in kept if z['ts']<1775001600000]),
       'late':stats([z for z in kept if z['ts']>=1775001600000])}
    if d['10']['kept']['n']>=21 and d['30']['kept']['n']>=21:
     denom=d['30']['kept']['n']
     reward=(d['30']['kept']['wr']-50)*.25 + (d['10']['kept']['wr']-66.667)*.15 + .01*d['30']['kept']['netReturnSumPct']        + .35*(d['30']['kept']['n']-21) -.2*d['30']['removed']['wins']
     rules.append({'rule':name,'field':feat,'op':op,'threshold':t,'score':round(reward,4),
      'cases':d})
 ranked=sorted(rules,key=lambda z:(-z['score'],-z['cases']['30']['kept']['n']))
 result={'status':'HISTORICAL_MULTI_THRESHOLD_COHORT_SCREEN_NOT_FULL8_NOT_OOS',
  'rulesTested':len(rules),'predeclaredGrids':FEAT_GRIDS,
  'baseline':{c:stats(selected[c]) for c in selected},
  'top':ranked[:45]}
 p=D/'IDLE_RENDER_SINGLE_FEATURE_BROAD_GATE_10_30_STATIC_20261024.json'
 p.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf8',newline='\n')
 print('CONDITIONS',len(rules),'BASE',result['baseline'])
 for x in ranked[:25]:
  print('SCAN',x['rule'],'SCORE',x['score'],'10',x['cases']['10']['kept'],
   '30',x['cases']['30']['kept'],'DROPPED30',x['cases']['30']['removed'],flush=True)
 print('OUTPUT',p,p.stat().st_size)
if __name__=='__main__':main()
