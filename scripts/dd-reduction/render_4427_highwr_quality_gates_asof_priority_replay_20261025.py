#!/usr/bin/env python3
"""RESEARCH ONLY. Multi-condition RENDER SHORT causal priority replay.
Retains original #4427; evaluates high-WR independent candidate-only gates with
incumbent same-symbol candidate ranking and trailing CLOSED shadow PF/WR.
No order sending; no venue/production changes.
"""
from __future__ import annotations
import collections,datetime as dt,gzip,hashlib,importlib.util,json,sys
from pathlib import Path
ROOT=Path('C:/tmp/render-mtf-study-20261024')
REPO=Path('C:/tmp/render4427-independent-gates-audit-20261024')
DEST=REPO/'docs/research/results/render4427-scoped-priority-native8-20261024'
spec=importlib.util.spec_from_file_location('r4427_highwr_compete',ROOT/'render_4427_independent_rolling_profit_gate_20261024.py')
m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m)
def check(f,name):
 if name=='WICK_SHARP_S6':return f['h1']<=-.5 and f['wickPct']>=.35
 if name=='WICK_VOL_S6':return f['volRatio']>=1.10 and f['wickPct']>=.35
 if name=='WICK_VOL_T24':return f['volRatio']>=1.10 and f['wickPct']>=.35
 if name=='VOL_PREVH1_T24':return f['volRatio']>=1.10 and f['prevH1ret']<=-.25
 raise KeyError(name)
route={'WICK_SHARP_S6':'S6','WICK_VOL_S6':'S6','WICK_VOL_T24':'T24','VOL_PREVH1_T24':'T24'}
policies=['ninety_loose','ninety_mid','dual_90_180','long365_90','conservative_180']
old=m.replay(m.BASE_CONF,save=True)
assert old['selectedTrades']==188
def new_rows(name):
 out=[]
 for row in m.DATA:
  orig=[x for x in row['candidates'] if x['kind']=='ORIGINAL']
  independent=[x for x in row['candidates'] if x['kind']=='INDEPENDENT'
          and x['family']=='BTC_RENDER_DIVERGE' and x['exit']==route[name] and check(row['features'],name)]
  if orig or independent:out.append({**row,'candidates':orig+independent})
 return out
def perf(rs):
 out={}
 for cost in (10,30):
  x=[v['net30']+(.30-cost/100) for v in rs]
  g=sum(v for v in x if v>0);l=-sum(v for v in x if v<0)
  out[str(cost)]={'n':len(x),'wins':sum(v>0 for v in x),
   'wrPct':round(sum(v>0 for v in x)/len(x)*100,2) if x else None,
   'pf':round(g/l,5) if l else None,
   'meanNetPct':round(sum(x)/len(x),6) if x else None}
 return out
res=[]
for name in route:
 for policy in policies:
  config={'families':['BTC_RENDER_DIVERGE'],'exit':route[name],'policy':policy,
          'routeRules':{'BTC_RENDER_DIVERGE':{'exit':route[name],'policy':policy}},
          'oldBonus':8,'upgradeMargin':8,'structure':'any','newCooldownHours':12}
  filtered=new_rows(name)
  result=m.replay(config,events=filtered,save=True)
  added=[x for x in result['trades'] if x['kind']=='INDEPENDENT']
  byperiod={}
  for period,(lo,hi) in m.PERIODS.items():
   r=[z for z in added if lo<=z['t']<hi]
   byperiod[period]=perf(r)
  incumbent=[x for x in result['trades'] if x['kind']=='ORIGINAL']
  basekeys={(x['t'],x['sym']) for x in old['trades']}
  displaced=[x for x in old['trades'] if (x['t'],x['sym']) not in {(z['t'],z['sym']) for z in incumbent}]
  obj={'gate':name,'policy':policy,'totalSelected':result['selectedTrades'],'independentAccepted':len(added),
    'incumbentDisplacedCount':len(displaced),'selectedReasons':result['selectionReasons'],
    'perPeriod':byperiod,'incrementalIndependentPerf':perf(added),
    'nativeWindowAccepted':[{'utc':dt.datetime.fromtimestamp(t['t']/1000,dt.timezone.utc).isoformat(),
        't':t['t'],'sym':t['sym'],'family':t['family'],'exit':t['exit'],'net30':t['net30'],
        'score':t['score'],'gateCompetitors':t['gateCompetitors']}
      for t in added if t['sym']=='RENDERUSDT' and 1767657600000<=t['t']<1786320000000],
    'baselinePerPeriod':old['periods'],
    'perPeriodWalletLike':result['periods'],
    'trades':added}
  res.append(obj)
  print('CAUSAL',name,policy,'PLUS',len(added),'PERF',perf(added),'DISPLACED',len(displaced),
   '2026',byperiod['2026JanAug']['30'],'late',byperiod['2026AugOct']['30'],
   'NATIVE',len(obj['nativeWindowAccepted']),flush=True)
out={'status':'RESEARCH_ONLY_WIN_RATE_FIRST_ASOF_PRIORITY_GATE','dateJST':'2026-10-25',
    'frozenIncumbentTrades':old['selectedTrades'],'gates':route,'policies':policies,
    'cases':res,'noGenuineUntouchedOOS':True,
    'limitations':['Shadow-model results are not actual shared 8-strategy wallet acceptance',
      'Family-dependent PF history uses only past fully CLOSED shadow outcomes, not future labels',
      'Original cohort may be displaced by a different exit or earlier 12h cooldown; collisions must be separately controlled',
      'This is retrospective multiple-testing, not real forward evidence',
      'Existing research source and production unchanged']}
DEST.mkdir(parents=True,exist_ok=True)
p=DEST/'RENDER_4427_WIN_RATE_FIRST_ASOF_PRIORITY_4_GATES_5_POLICIES_20261025.json'
p.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print('ASOF_WIN_RATE_PRIORITY_DONE',p)
