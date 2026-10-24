#!/usr/bin/env python3
"""RESEARCH ONLY: causal expanding high-WR gate vs legacy 90/180 lookback.
New independent BTC divergence Wick gates only; original #4427 and risk locks
unchanged. Historical periods are already seen; NOT prospective validation.
"""
from __future__ import annotations
import collections,datetime as dt,hashlib,importlib.util,inspect,json,sys
from pathlib import Path
BASE=Path('C:/tmp/render-mtf-study-20261024')
REPO=Path('C:/tmp/render4427-independent-gates-audit-20261024')
OUT=REPO/'docs/research/results/render4427-scoped-priority-native8-20261024'
MODULE=BASE/'render_4427_independent_rolling_profit_gate_20261024.py'
spec=importlib.util.spec_from_file_location('render4427_lifetime_highwr_gate',MODULE)
m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m)
orig=m.replay
src=inspect.getsource(m.replay)
needle="   s90=hist_score(recent90);s180=hist_score(recent180);s30=hist_score(rec30);s365=hist_score(rec365)"
repl=needle+"\n   lifetime=hist_score([v for end,v in h if end<t])"
assert src.count(needle)==1
src=src.replace(needle,repl)
needle2="     'conservative_180':s180['n']>=20 and s180['pf']>=1.4 and s180['wr']>=.65,"
repl2=needle2+"""
     'expanding_balanced':lifetime['n']>=18 and lifetime['wr']>=.68 and lifetime['pf']>=1.30 and lifetime['mean']>=.10 and s365['n']>=3 and s365['wr']>=.58 and s365['mean']>=0,
     'expanding_conservative':lifetime['n']>=24 and lifetime['wr']>=.73 and lifetime['pf']>=1.40 and lifetime['mean']>=.15 and s365['n']>=5 and s365['wr']>=.62 and s365['mean']>=0,
     'expanding_highwr':lifetime['n']>=24 and lifetime['wr']>=.75 and lifetime['pf']>=1.35 and lifetime['mean']>=.10 and s365['n']>=3 and s365['wr']>=.60 and s365['mean']>=0,"""
assert src.count(needle2)==1
src=src.replace(needle2,repl2)
exec(compile(src,'<research_only_expanding_highwr_gate>', 'exec'),m.__dict__)
assert m.replay is not orig and m.replay(m.BASE_CONF)['periods']==orig(m.BASE_CONF)['periods']
gate_spec={
 'WICK_SHARP_S6':{'exit':'S6','predicate':lambda f:f['h1']<=-.5 and f['wickPct']>=.35},
 'WICK_VOL_T24':{'exit':'T24','predicate':lambda f:f['volRatio']>=1.1 and f['wickPct']>=.35},
}
policies=['expanding_balanced','expanding_conservative','expanding_highwr','ninety_loose']
def perf(trades,cost):
 r=[v['net30']+(.30-cost/100) for v in trades]
 g=sum(x for x in r if x>0);loss=-sum(x for x in r if x<0)
 return {'n':len(r),'wins':sum(x>0 for x in r),'wrPct':round(100*sum(x>0 for x in r)/len(r),3) if r else None,
   'pf':round(g/loss,5) if loss else None,'meanNetPct':round(sum(r)/len(r),5) if r else None}
def filter_bank(name):
 info=gate_spec[name];out=[]
 for row in m.DATA:
  originals=[x for x in row['candidates'] if x['kind']=='ORIGINAL']
  new=[x for x in row['candidates'] if x['kind']=='INDEPENDENT' and x['family']=='BTC_RENDER_DIVERGE' and x['exit']==info['exit'] and info['predicate'](row['features'])]
  if originals or new:out.append({**row,'candidates':originals+new})
 return out
baseline=orig(m.BASE_CONF,save=True)
output={'status':'RESEARCH_ONLY_HIGHWR_EXPANDING_CAUSAL_PRIORITY','dateJST':'2026-10-25',
    'moduleSourceSha256':hashlib.sha256(MODULE.read_bytes()).hexdigest(),
    'policies':policies,'cases':[],'baselineN':baseline['selectedTrades'],
    'noProductionMutation':True,'notPristineOOS':True,
    'warnings':['Original research scorer unchanged except additional quality admission rules',
      'Lifetime histories only include shadow trades EXITED before as-of H1 timestamp',
      'No new venue fills/mark sources; source is Binance M5 shadow prices',
      'No real Native8 result unless separately replayed and verified',
      'Selection among gate/policy options after seeing all dates would be overfitting']}
for name,meta in gate_spec.items():
 events=filter_bank(name)
 for pol in policies:
  config={'families':['BTC_RENDER_DIVERGE'],'exit':meta['exit'],'policy':pol,
          'routeRules':{'BTC_RENDER_DIVERGE':{'exit':meta['exit'],'policy':pol}},
          'oldBonus':8,'upgradeMargin':8,'structure':'any','newCooldownHours':12}
  result=m.replay(config,events=events,save=True)
  added=[r for r in result['trades'] if r['kind']=='INDEPENDENT']
  oldlock={(r['sym'],r['t']) for r in result['trades'] if r['kind']=='ORIGINAL'}
  original_displaced=[r for r in baseline['trades'] if (r['sym'],r['t']) not in oldlock]
  periods={}
  for period,(start,end) in m.PERIODS.items():
   sel=[r for r in added if start<=r['t']<end]
   periods[period]={'10':perf(sel,10),'30':perf(sel,30)}
  accepted2026=[r for r in added if r['sym']=='RENDERUSDT' and 1767657600000<=r['t']<1786320000000]
  case={'gate':name,'exit':meta['exit'],'policy':pol,'selectedIndependent':len(added),
    'independentPerf':{'10':perf(added,10),'30':perf(added,30)},
    'periods':periods,'incumbentDisplaced':len(original_displaced),
    'accepted2026':[{'t':r['t'],'utc':dt.datetime.fromtimestamp(r['t']/1000,dt.timezone.utc).isoformat(),
      'net30':r['net30'],'score':r['score'],'overlapCandidates':r['gateCompetitors']}
      for r in accepted2026],
    'selectedReasons':result['selectionReasons'],
    'perPeriodWalletLike':result['periods'],
    'shadowAddedTrades':added}
  output['cases'].append(case)
  print('EXPANDING',name,pol,'ADDED',len(added),'WR30',case['independentPerf']['30'],
   '2026_ACCEPTED',len(accepted2026),'2026_PERIOD',periods['2026JanAug']['30'],
   'INCUMBENT_DISPLACED',len(original_displaced),flush=True)
OUT.mkdir(parents=True,exist_ok=True)
dst=OUT/'RENDER_4427_HIGHWR_EXPANDING_CAUSAL_ASOF_OWNER_20261025.json'
dst.write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print('HIGHWR_EXPANDING_CAUSAL_COMPLETE',dst)
