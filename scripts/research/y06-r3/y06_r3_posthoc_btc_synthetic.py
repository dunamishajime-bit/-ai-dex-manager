from __future__ import annotations
import pathlib,importlib.util,ast,math,numpy as np,json,hashlib,statistics,time
ROOT=pathlib.Path(r'C:\tmp\disdex-d126-crossrunner-research-20261126')
R3=ROOT/'y06_r3_bear_retest_research_v2.py'
BASE=ROOT/'y06_r2_synthetic_24markets.py'
OUT=ROOT/'Y06_R3_POSTHOC_BTC_BEAR_GATES_SYNTH_24MARKETS_20261126.json'
assert not OUT.exists()
sp=importlib.util.spec_from_file_location('r3_btc_guard_research_synth',R3)
r3=importlib.util.module_from_spec(sp);sp.loader.exec_module(r3)
bt=r3.bt;bt.HS=bt.T('2025-03-01T00:00:00Z')
bt.MS=bt.T('2025-03-22T00:00:00Z')
bt.ME=bt.T('2025-09-30T00:00:00Z')
bt.N_M=(bt.ME-bt.MS)//bt.M;bt.N_H=(bt.ME-bt.HS)//bt.H
bt.PERIODS={'PRE':(bt.T('2025-04-15T00:00:00Z'),bt.T('2025-09-30T00:00:00Z'))}
r3.PERIODS=bt.PERIODS
tree=ast.parse(BASE.read_text(encoding='utf8'))
func=next(x for x in tree.body if isinstance(x,ast.FunctionDef) and x.name=='market')
g=globals()|{'N':bt.N_M,'H0':(bt.MS-bt.HS)//bt.H,'SYMS':bt.SYMS,'bt':bt}
holder={};exec(compile(ast.Module(body=[func],type_ignores=[]),str(BASE),'exec'),g,holder)
market=holder['market']
def ret(h,t,n):
 boundary=t//(n*bt.H)*n*bt.H;j=(boundary-bt.HS)//bt.H
 if j-n-1<0 or j>=len(h):return None
 v,w=h[j-1,3],h[j-n-1,3]
 return float(v/w-1) if np.isfinite(v*w) and w>0 else None
def guard(c,h,gate):
 if gate=='BASE':return True
 q=ret(h,c['entryTs'],12)
 if q is None:return False
 if gate=='BTC12_NEG':return q<0
 d=ret(h,c['entryTs'],24)
 return d is not None and d<0 and q<0
REGIMES={
 'BULL_STEADY':dict(drift=.006,vol=.035,cycle=.0,jump=0.,reversal=False),
 'BULL_PULLBACK':dict(drift=.004,vol=.055,cycle=.00013,jump=0.,reversal=False),
 'BULL_SQUEEZE':dict(drift=.007,vol=.055,cycle=.0001,jump=.05,reversal=False),
 'BULL_REVERSAL':dict(drift=.007,vol=.045,cycle=.00008,jump=.02,reversal=True),
 'RANGE':dict(drift=0.,vol=.050,cycle=.00011,jump=0.,reversal=False),
 'BEAR':dict(drift=-.005,vol=.045,cycle=.00007,jump=-.015,reversal=False)}
SEEDS=[2026112601,2026112602,2026112603,2026112604]
trials=[];start=time.monotonic()
for name,config in REGIMES.items():
 for seed in SEEDS:
  hfiles,mfiles=market(seed,name,config)
  raw=[]
  for sym in bt.SYMS[1:]:
   z,_,_=r3.generate(sym,hfiles[sym],mfiles[sym],hfiles['BTC'])
   raw+=z
  arms={}
  for policy in ('DIRECT_CONTROL','RETEST_H1'):
   z=[x for x in raw if x['policy']==policy]
   for gate in ('BASE','BTC12_NEG','BTC_D24_AND12_NEG'):
    selected=[x for x in z if guard(x,hfiles['BTC'],gate)]
    fills=[q for q in (r3.calc_trade(x,mfiles[x['symbol']],'STOP8_TIME24') for x in selected) if q]
    port=bt.wallet(fills,'PRE',30,mfiles)
    port.pop('accepted',None)
    arms[policy+'/'+gate]={'signals':len(selected),'port30':port}
  trials.append({'regime':name,'seed':seed,'arms':arms})
  print('PATH',name,seed,'ORIGINAL',round(arms['RETEST_H1/BASE']['port30']['terminal_jpy']),
        'BTC12',round(arms['RETEST_H1/BTC12_NEG']['port30']['terminal_jpy']),flush=True)
summary={}
for arm in trials[0]['arms']:
 z=[x['arms'][arm]['port30'] for x in trials]
 summary[arm]={
  'mean_terminal_jpy':float(statistics.mean(x['terminal_jpy'] for x in z)),
  'mean_mdd_pct':float(statistics.mean(x['max_dd_pct'] for x in z)),
  'profitable_paths':sum(x['terminal_jpy']>10000 for x in z),
  'profit_and_dd30_paths':sum(x['terminal_jpy']>10000 and x['max_dd_pct']<=30 for x in z),
  'mean_trades':float(statistics.mean(x['n'] for x in z))}
 print('ALL',arm,summary[arm],flush=True)
byregime={}
for regime in REGIMES:
 byregime[regime]={}
 z=[x for x in trials if x['regime']==regime]
 for arm in summary:
  v=[q['arms'][arm]['port30'] for q in z]
  byregime[regime][arm]={
   'mean_terminal_jpy':float(statistics.mean(x['terminal_jpy'] for x in v)),
   'mean_mdd_pct':float(statistics.mean(x['max_dd_pct'] for x in v)),
   'profitable_n':sum(x['terminal_jpy']>10000 for x in v)}
OUT.write_text(json.dumps({'meta':{
 'status':'POSTHOC_EXPLORATORY_NOT_ADOPTED',
 'r3_engine_sha256':hashlib.sha256(R3.read_bytes()).hexdigest(),
 'original_synthetic_engine_sha256':hashlib.sha256(BASE.read_bytes()).hexdigest(),
 'fixed_gate_protocol_sha256':'fb2840efeace7b1b3f1bb795f9f9a6ca4ab2d7ffe26e2a3c2e1213c68cac9fb0',
 'description':'Same 24 originally seeded synthetic markets, after-result market-wide BTC 12h / D+12h negative entry gates; only original R3 entry/STOP8/TIME24, no model retuning',
 'caveat':'Already inspected synthetic markets, so posthoc comparison cannot establish robust edge or OOS. No funding or cross-runner risk.'},
 'summary':summary,'by_regime':byregime,'trials':trials},ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print('DONE',OUT,'SHA256',hashlib.sha256(OUT.read_bytes()).hexdigest(),
      'SECONDS',round(time.monotonic()-start,1),flush=True)
