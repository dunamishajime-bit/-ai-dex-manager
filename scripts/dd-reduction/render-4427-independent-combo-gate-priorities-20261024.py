#!/usr/bin/env python3
"""Portfolio-aware source-only 2024+ combo using per-family predetermined risk
rules and rolling shadow evidence. Never use 2026 result as a calendar gate.
"""
from pathlib import Path
import importlib.util,collections,gzip,json,sys
ROOT=Path('C:/tmp/render-mtf-study-20261024')
p=ROOT/'render_4427_independent_rolling_profit_gate_20261024.py'
s=importlib.util.spec_from_file_location('render4427_rolling_gate_combo',p)
m=importlib.util.module_from_spec(s);sys.modules[s.name]=m;s.loader.exec_module(m)
base=m.replay(m.BASE_CONF)
assert base['selectedTrades']==188
RULES={
 'BTC_RENDER_DIVERGE':{'exit':'S6','policy':'dual_90_180'},
 'SELL_IMBALANCE':{'exit':'S12','policy':'ninety_mid'},
 'TREND_BREAK':{'exit':'S6','policy':'recent30_180'},
 'REBOUND_FAIL':{'exit':'S12','policy':'recent30_180'},
}
packages=[
 ['BTC_RENDER_DIVERGE','SELL_IMBALANCE'],
 ['TREND_BREAK','SELL_IMBALANCE'],
 ['REBOUND_FAIL','SELL_IMBALANCE'],
 ['BTC_RENDER_DIVERGE','TREND_BREAK','SELL_IMBALANCE'],
 ['BTC_RENDER_DIVERGE','REBOUND_FAIL','SELL_IMBALANCE'],
 ['TREND_BREAK','REBOUND_FAIL','SELL_IMBALANCE'],
 ['BTC_RENDER_DIVERGE','TREND_BREAK','REBOUND_FAIL','SELL_IMBALANCE'],
]
runs=[]
for families in packages:
 for margin in [8,12,16]:
  config={'families':families,'exit':'S6','policy':'ninety_mid',
   'routeRules':{key:RULES[key] for key in families},
   'oldBonus':8,'upgradeMargin':margin,'structure':'any','newCooldownHours':12}
  ret=m.replay(config,save=True)
  countByPeriod={p:dict(collections.Counter(z['family'] for z in ret['trades']
     if a<=z['t']<b and z['kind']=='INDEPENDENT')) for p,(a,b) in m.PERIODS.items()}
  robust=all(ret['periods'][y]['30']['compoundPct']>=base['periods'][y]['30']['compoundPct']
   and ret['periods'][y]['30']['closedDdPct']>=base['periods'][y]['30']['closedDdPct']
   and ret['periods'][y]['30']['n']>=base['periods'][y]['30']['n']
   and ret['periods'][y]['10']['compoundPct']>=base['periods'][y]['10']['compoundPct']
   for y in m.PERIODS)
  newTrace=[z for z in ret['trades'] if z['kind']=='INDEPENDENT']
  simple={k:v for k,v in ret.items() if k!='trades'}
  simple.update({'config':config,'robustAll5':robust,'newFamilyByPeriod':countByPeriod,
   'newTradeUTCAndNet30':[{'utc':m.dt.datetime.fromtimestamp(z['t']/1000,m.dt.timezone.utc).isoformat(),
      'family':z['family'],'exit':z['exit'],'net30':round(z['net30'],4),
      'matchedOriginalGate':bool(z['gateCompetitors'])} for z in newTrace]})
  runs.append(simple)
  print('MIXED',families,'MARGIN',margin,'ROBUST',robust,'ADDED',ret['addedIndependents'],
    'ORIGINAL_PROTECTED',ret['selectionReasons'].get('protect_original_overlap',0),
    '2024',ret['periods']['2024']['30'],
    '2025H2',ret['periods']['2025H2']['30'],
    '2026JAN',ret['periods']['2026JanAug']['30'],
    'LATE',ret['periods']['2026AugOct']['30'],flush=True)
report={
 'status':'RESEARCH_ONLY_COMBINED_INDEPENDENT_GATES_ASOF_PRIORITY',
 'independentFamilies':'BTC_RENDER_DIVERGE S6; SELL_IMBALANCE S12; TREND_BREAK S6; REBOUND_FAIL S12',
 'ranking':'past CLOSED 30/90/180d shadow only, conservative old gate bonus and upgrade margin, no duplicate orders',
 'baseline':{k:v for k,v in base.items() if k!='trades'},
 'totalCases':len(runs),'passedCases':sum(z['robustAll5'] for z in runs),
 'cases':runs,'limitations':[
    'BTC 5m unavailable Aug2025-Aug2026 in research source, so BTC divergence results are not comprehensive',
    '2025 RENDER Aster H1 mark unavailable for Native8, so cannot certify 2025H2 common wallet results',
    '2026AugOct already seen in research; not pristine untouched holdout',
    'Binance 5m modeled fills, no Aster signed venue exits',
    'No actual orders or LIVE changes'
 ]}
p=ROOT/'RENDER_4427_INDEPENDENT_COMBINED_FAMILY_SCORE_COMPETITION_20261024.json'
p.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n','utf8')
print('SAVE',p,p.stat().st_size,'PASS',report['passedCases'])
