#!/usr/bin/env python3
"""RESEARCH ONLY: frozen-route seller-threshold sensitivity and temporal stability.
This checks as-of completed shadow histories, not untouched forward OOS or Aster fills.
No deployment, VPS, LIVE, orders, global guards, or original source mutation.
"""
from __future__ import annotations
import collections,datetime as dt,gzip,hashlib,importlib.util,json,math,sys
from pathlib import Path
ROOT=Path('C:/tmp/render-mtf-study-20261024')
OUT=Path('C:/tmp/render4427-independent-gates-audit-20261024/docs/research/results/render4427-scoped-priority-native8-20261024')
SOURCE=ROOT/'render_4427_independent_rolling_profit_gate_20261024.py'
BANK=ROOT/'RENDER_4427_INDEPENDENT_ALL_GATE_SHADOW_ENTRY_BANK_20261024.json.gz'
SPEC=importlib.util.spec_from_file_location('render_4427_rolling_fixed_threshold_sensitivity',SOURCE)
brain=importlib.util.module_from_spec(SPEC);sys.modules[SPEC.name]=brain;SPEC.loader.exec_module(brain)
ROUTE='BTC_RENDER_DIVERGE'
RULES={
 'BTC_RENDER_DIVERGE':{'exit':'S6','policy':'dual_90_180'},
 'SELL_IMBALANCE':{'exit':'S12','policy':'ninety_mid'},
 'TREND_BREAK':{'exit':'S6','policy':'recent30_180'},
 'REBOUND_FAIL':{'exit':'S12','policy':'recent30_180'}
}
CONFIG={'families':list(RULES),'exit':'S6','policy':'ninety_mid','routeRules':RULES,
        'oldBonus':8,'upgradeMargin':8,'structure':'any','newCooldownHours':12}
THRESHOLDS=(.53,.54,.545,.55,.555,.56,.565,.57,.58,.60)
def sha(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  for c in iter(lambda:f.read(1<<20),b''):h.update(c)
 return h.hexdigest()
BASE=brain.replay(brain.BASE_CONF,save=True)
assert BASE['selectedTrades']==188
data=[]
for threshold in THRESHOLDS:
 filtered=[];gate_signals=0
 for e in brain.DATA:
  candidates=[c for c in e['candidates'] if c['family']!=ROUTE or e['features']['sellPct']>=threshold]
  if any(c['family']==ROUTE for c in candidates):gate_signals+=1
  if candidates:filtered.append({**e,'candidates':candidates})
 ret=brain.replay(CONFIG,events=filtered,save=True)
 byperiod={name:collections.Counter(r['family'] for r in ret['trades'] if lo<=r['t']<hi and r['kind']=='INDEPENDENT') for name,(lo,hi) in brain.PERIODS.items()}
 year_stats={}
 for period,v in ret['periods'].items():
  year_stats[period]={}
  for cost in ('10','30'):
   current=v[cost];old=BASE['periods'][period][cost]
   year_stats[period][cost]={'n':current['n'],'deltaN':current['n']-old['n'],
       'wrPct':current['wrPct'],'pf':current['pf'],'compoundPct':current['compoundPct'],
       'deltaCompoundPp':round(current['compoundPct']-old['compoundPct'],5),
       'closedDdPct':current['closedDdPct'],
       'deltaDdPp':round(current['closedDdPct']-old['closedDdPct'],5)}
 new_native=[x for x in ret['trades'] if x['kind']=='INDEPENDENT' and x['sym']=='RENDERUSDT'
             and 1754784000000<=x['t']<1786320000000]
 allpositive=all(year_stats[p][cost]['deltaCompoundPp']>=-1e-5
           and year_stats[p][cost]['deltaDdPp']>=-1e-5
           and year_stats[p][cost]['deltaN']>=0 for p in brain.PERIODS for cost in ('10','30'))
 data.append({'sellPctMinimum':threshold,'qualifiedRawBtcDivergenceSignals':gate_signals,
    'selectedTotal':ret['selectedTrades'],'addedIndependents':ret['addedIndependents'],
    'selectedIndependentFamilies':{p:dict(x) for p,x in byperiod.items()},
    'periods':year_stats,'nondegradationAllFiveBothCosts':allpositive,
    'nativeWindowIndependentCount':len(new_native),
    'nativeWindowIndependentTrades':[{'t':x['t'],'utc':dt.datetime.fromtimestamp(x['t']/1000,dt.timezone.utc).isoformat(),
      'family':x['family'],'net30':round(x['net30'],6)} for x in new_native]})
allrows=brain.DATA
# Verify that any available BTC 5min coverage is contiguous for the official downloaded interval.
# This is a source-integrity diagnostic, not an independent venue or execution certification.
btc_dir=Path('C:/tmp/render-btc-complete-20261024')
verified_source_files=sorted(btc_dir.rglob('BTCUSDT-5m-*.zip')) if btc_dir.exists() else []
manifest={'root':str(btc_dir),'btc5mMonthlyArchiveCount':len(verified_source_files),
         'archivedMonths':sorted({p.name.removeprefix('BTCUSDT-5m-').removesuffix('.zip') for p in verified_source_files})}
result={'status':'RESEARCH_ONLY_RETROSPECTIVE_SELL_PRESSURE_SENSITIVITY',
   'runDateJST':'2026-10-24','baseline':BASE['periods'],'baselineSelected':BASE['selectedTrades'],
   'config':CONFIG,'testedThresholds':list(THRESHOLDS),'cases':data,
   'bankSha256':sha(BANK),'sourceScriptSha256':sha(SOURCE),
   'sourceAvailability':manifest,
   'limitations':['Historical data already examined; not a pristine OOS evaluation',
      'Includes paper shadow outcomes of simultaneously unfilled proposals; not actual independent fills',
      'Global Native8 economic improvement applies only to previously admitted 2 signals at sell55',
      'BTC official M5 archive presence does not prove Aster mark/venue equity/funding parity',
      'Potential data source-note staleness must be separately verified',
      'Winner selection cannot be generalized from two net-positive trades']}
OUT.mkdir(parents=True,exist_ok=True)
dst=OUT/'RENDER_4427_SELLER_THRESHOLD_TEMPORAL_SENSITIVITY_20261024.json'
dst.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print('BASELINE_BY_PERIOD',{p:BASE['periods'][p]['30'] for p in brain.PERIODS},flush=True)
for s in data:
 h2=s['periods']['2025H2']['30'];yr=s['periods']['2024']['30']
 jan=s['periods']['2026JanAug']['30'];late=s['periods']['2026AugOct']['30']
 print('SENSITIVITY',s['sellPctMinimum'],'SIGNALS',s['qualifiedRawBtcDivergenceSignals'],
       'INDEP',s['addedIndependents'],'2024',yr['deltaCompoundPp'],'2025H2',h2['deltaCompoundPp'],
       '2026JanAug',jan['deltaCompoundPp'],'2026Late',late['deltaCompoundPp'],
       'nativeCount',s['nativeWindowIndependentCount'],'passes',s['nondegradationAllFiveBothCosts'],flush=True)
print('SENSITIVITY_RESULT_SAVED',dst,flush=True)
