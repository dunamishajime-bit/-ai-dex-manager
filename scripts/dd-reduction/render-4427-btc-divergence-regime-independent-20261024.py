#!/usr/bin/env python3
"""Independent BTC-vs-RENDER divergence gate regime checks.
Refit past shadow scores using ONLY as-of qualified events for each hypothesis.
EX POST exploratory; 2026 Feb / Oct have already been viewed.
"""
from pathlib import Path
import importlib.util,json,sys,collections
ROOT=Path('C:/tmp/render-mtf-study-20261024')
spec=importlib.util.spec_from_file_location('render_indep_rolling_regime_exp',ROOT/'render_4427_independent_rolling_profit_gate_20261024.py')
m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m)
BTC='BTC_RENDER_DIVERGE';OTHER='SELL_IMBALANCE'
RULES={
 BTC:{'exit':'S6','policy':'dual_90_180'},
 OTHER:{'exit':'S12','policy':'ninety_mid'},
 'TREND_BREAK':{'exit':'S6','policy':'recent30_180'},
 'REBOUND_FAIL':{'exit':'S12','policy':'recent30_180'},
}
REGIMES={
 'ALL_D1':lambda f:True,
 'D1_UP':lambda f:f['d1']>=0,
 'D1_DOWN':lambda f:f['d1']<0,
 'D1_UP_H4_DOWN':lambda f:f['d1']>=0 and f['h4']<0,
 'NOT_EXTENDED_H1':lambda f:f['h1']>=-.8,
 'SELLER_STRONGER':lambda f:f['sellPct']>=.55,
 'HIGHER_VOLUME':lambda f:f['volRatio']>=1,
 'IN_UPPER_HALF_H1':lambda f:f['position']>=.5,
 'H4_STRONG_DOWN':lambda f:f['h4']<=-2,
}
BASE=m.replay(m.BASE_CONF)
configs=[
 [BTC,OTHER],
 [BTC,'TREND_BREAK',OTHER],
 [BTC,'REBOUND_FAIL',OTHER],
 [BTC,'TREND_BREAK','REBOUND_FAIL',OTHER],
]
results=[]
for name,pred in REGIMES.items():
 filt=[]
 removed=collections.Counter()
 for e in m.DATA:
  fx=e['features'];flag=pred(fx)
  cuts=[c for c in e['candidates'] if c['family']!=BTC or flag]
  removed['removed_'+BTC]+=len(e['candidates'])-len(cuts)
  if cuts:filt.append({**e,'candidates':cuts})
 for fams in configs:
  cfg={'families':fams,'exit':'S6','policy':'ninety_mid','routeRules':{k:RULES[k] for k in fams},
    'oldBonus':8,'upgradeMargin':8,'structure':'any','newCooldownHours':12}
  x=m.replay(cfg,events=filt,save=True)
  robust=all(x['periods'][y]['30']['compoundPct']>=BASE['periods'][y]['30']['compoundPct']
    and x['periods'][y]['30']['closedDdPct']>=BASE['periods'][y]['30']['closedDdPct']
    and x['periods'][y]['30']['n']>=BASE['periods'][y]['30']['n']
    and x['periods'][y]['10']['compoundPct']>=BASE['periods'][y]['10']['compoundPct']
     for y in m.PERIODS)
  byPeriod={p:dict(collections.Counter(z['family'] for z in x['trades'] if z['kind']=='INDEPENDENT'
       and a<=z['t']<b)) for p,(a,b) in m.PERIODS.items()}
  out={'btcRegime':name,'config':cfg,'robust5':robust,
       'extraCount':x['addedIndependents'],'selectedOriginal':x['byFamily'],
       'passedNewByPeriod':byPeriod,'periods':x['periods'],
       'btcCandidateRegimeSource':'Only f known at H1 signal. Histories rebuilt on eligible gates.'}
  results.append(out)
  print('REGIME',name,'FAMILIES',fams,'ROBUST',robust,'NEW',x['addedIndependents'],
   '24',x['periods']['2024']['30']['compoundPct'],
   '25H2',x['periods']['2025H2']['30']['compoundPct'],
   '26JAN',x['periods']['2026JanAug']['30']['compoundPct'],
   '26LATE',x['periods']['2026AugOct']['30']['compoundPct'],'EXTRA_BY_PERIOD',byPeriod,flush=True)
 p=ROOT/'RENDER_4427_BTC_DIVERGENCE_INDEPENDENT_REGIME_CAUSAL_20261024.json'
 p.write_text(json.dumps({'status':'RESEARCH_ONLY_NOT_PRISTINE_PAST_EX_POST_HYPOTHESIS',
    'source':'Official BTC complete 2025Aug-2026Aug checksum verified, Binance RENDER M5',
    'original188':BASE['periods'],'cases':results,'nCases':len(results),'btcnames':list(REGIMES),
    'caveats':['Regimes including D1 trend were explored after seeing 2026 February losing and October winning events',
      'No independent unused OOS remains for this regime selection',
      'No native8 / LIVE changes, no Aster signed M5 fills'],
    'currentStatus':'NO_LIVE_ADOPTION'},ensure_ascii=False,indent=2)+'\n','utf8')
 print('SAVED',p,len(results),flush=True)
