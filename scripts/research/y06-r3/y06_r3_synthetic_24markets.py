from __future__ import annotations
import pathlib,ast,importlib.util,json,hashlib,math,statistics,time
import numpy as np
ROOT=pathlib.Path(r'C:\tmp\disdex-d126-crossrunner-research-20261126')
REAL=ROOT/'Y06_R3_BEAR_RETEST_REAL_M5_BT_20261126.json'
SOURCES=(ROOT/'y06_r3_bear_retest_research_v2.py',ROOT/'y06_r2_synthetic_24markets.py')
OUT=ROOT/'Y06_R3_BEAR_RETEST_SYNTHETIC_24PATHS_20261126.json'
assert REAL.exists() and not OUT.exists()
s=importlib.util.spec_from_file_location('r3_source',SOURCES[0])
r3=importlib.util.module_from_spec(s);s.loader.exec_module(r3)
bt=r3.bt
bt.HS=bt.T('2025-03-01T00:00:00Z');bt.MS=bt.T('2025-03-22T00:00:00Z')
bt.ME=bt.T('2025-09-30T00:00:00Z')
bt.N_M=(bt.ME-bt.MS)//bt.M;bt.N_H=(bt.ME-bt.HS)//bt.H
bt.PERIODS={'PRE':(bt.T('2025-04-15T00:00:00Z'),bt.T('2025-09-30T00:00:00Z'))}
r3.PERIODS=bt.PERIODS

# Exactly reuse the market generator used for Y06-R2's 24 synthetic experiments.
tree=ast.parse(SOURCES[1].read_text(encoding='utf8'))
node=next(x for x in tree.body if isinstance(x,ast.FunctionDef) and x.name=='market')
exec(compile(ast.Module(body=[node],type_ignores=[]),str(SOURCES[1]),'exec'),
     globals()|{'N':bt.N_M,'H0':(bt.MS-bt.HS)//bt.H,'SYMS':bt.SYMS,'bt':bt},holder:={})
market=holder['market']
SCENARIOS={
 'BULL_STEADY':dict(drift=.006,vol=.035,cycle=.0,jump=0.,reversal=False),
 'BULL_PULLBACK':dict(drift=.004,vol=.055,cycle=.00013,jump=0.,reversal=False),
 'BULL_SQUEEZE':dict(drift=.007,vol=.055,cycle=.0001,jump=.05,reversal=False),
 'BULL_REVERSAL':dict(drift=.007,vol=.045,cycle=.00008,jump=.02,reversal=True),
 'RANGE':dict(drift=0.,vol=.050,cycle=.00011,jump=0.,reversal=False),
 'BEAR':dict(drift=-.005,vol=.045,cycle=.00007,jump=-.015,reversal=False)}
SEEDS=[2026112601,2026112602,2026112603,2026112604]
results=[]
start=time.monotonic()
for name,config in SCENARIOS.items():
 for seed in SEEDS:
  hfiles,mfiles=market(seed,name,config)
  allcand=[]
  for sym in bt.SYMS[1:]:
   z,_,_=r3.generate(sym,hfiles[sym],mfiles[sym],hfiles['BTC'])
   allcand.extend(z)
  arms={}
  for policy in r3.POLICIES:
   base=[x for x in allcand if x['policy']==policy]
   for mode in r3.EXITS:
    fills=[x for x in (r3.calc_trade(y,mfiles[y['symbol']],mode) for y in base) if x]
    t=r3.evaluate(fills,mfiles,policy+'/'+mode)['PRE']
    ports={}
    for fee in (10,30):
     q=t[str(fee)]['portfolio']
     q.pop('accepted',None)
     ports[str(fee)]=q
    stress=t['30_stress_stop_slip05']
    stress.pop('accepted',None)
    arms[policy+'/'+mode]={'candidates':len(base),'valid_fills':len(fills),'ports':ports,'stress30':stress}
  results.append({'scenario':name,'seed':seed,'btc_return_pct':float(100*(mfiles['BTC'][-1,3]/mfiles['BTC'][0,0]-1)),
                  'arms':arms})
  print('PATH',name,seed,'DIRECT24',round(arms['DIRECT_CONTROL/STOP8_TIME24']['ports']['30']['terminal_jpy']),
        'RETEST24',round(arms['RETEST_H1/STOP8_TIME24']['ports']['30']['terminal_jpy']),flush=True)
summary={}
for arm in results[0]['arms']:
 v=[p['arms'][arm]['ports']['30'] for p in results]
 st=[p['arms'][arm]['stress30'] for p in results]
 summary[arm]={'n_synthetic_markets':len(v),'mean_terminal30_jpy':float(statistics.mean(x['terminal_jpy'] for x in v)),
               'mean_max_dd30_pct':float(statistics.mean(x['max_dd_pct'] for x in v)),
               'profitable_count':sum(x['terminal_jpy']>10000 for x in v),
               'profit_and_dd30_count':sum(x['terminal_jpy']>10000 and x['max_dd_pct']<=30 for x in v),
               'mean_terminal_stress30_jpy':float(statistics.mean(x['terminal_jpy'] for x in st)),
               'mean_admitted_trade_count':float(statistics.mean(x['n'] for x in v))}
 print('SUMMARY',arm,'WIN_MARKETS',summary[arm]['profitable_count'],'AVG',round(summary[arm]['mean_terminal30_jpy']),
       'AVG_DD',round(summary[arm]['mean_max_dd30_pct'],2),flush=True)
byregime={}
for scenario in SCENARIOS:
 v=[x for x in results if x['scenario']==scenario]
 byregime[scenario]={arm:{'mean30_terminal':float(statistics.mean(x['arms'][arm]['ports']['30']['terminal_jpy'] for x in v)),
                            'mean30_dd':float(statistics.mean(x['arms'][arm]['ports']['30']['max_dd_pct'] for x in v)),
                            'n_profit':sum(x['arms'][arm]['ports']['30']['terminal_jpy']>10000 for x in v)}
                       for arm in results[0]['arms']}
payload={'meta':{
 'status':'RESEARCH_ONLY_SYNTHETIC_NOT_OWNED_BY_VENUE',
 'r3_source_sha256':hashlib.sha256(SOURCES[0].read_bytes()).hexdigest(),
 'synthetic_source_sha256':hashlib.sha256(SOURCES[1].read_bytes()).hexdigest(),
 'real_bt_sha256':hashlib.sha256(REAL.read_bytes()).hexdigest(),
 'experiment':'Previously fixed 6 regimes x 4 seeds, each BTC+13alt continuous OHLC5 with H1 exact aggregation, same deterministic R2 synthetic market generator; short-only R3 entry/exit unchanged; all 9 variants included. Initial JPY10000, 10/30bps no funding or other runners.',
 'warning':'Artificial market profits can be a function of chosen drift/vol process and do not establish real market predictive edge'
 },'aggregate':summary,'by_regime':byregime,'trials':results}
OUT.write_text(json.dumps(payload,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf8')
print('RESULT_SHA256',hashlib.sha256(OUT.read_bytes()).hexdigest(),
      'FILE',OUT,'SECONDS',round(time.monotonic()-start,1),flush=True)
