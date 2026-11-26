from __future__ import annotations
import importlib.util,pathlib,json,hashlib,math,collections,statistics,time,sys
import numpy as np

WORK=pathlib.Path(r'C:\tmp\disdex-d126-crossrunner-research-20261126')
CODE=WORK/'y06_r2_bt_engine_v2.py'
spec=importlib.util.spec_from_file_location('research_y06r2_bt_engine_v2',CODE)
bt=importlib.util.module_from_spec(spec);spec.loader.exec_module(bt)
OUT=WORK/'Y06_R2_24_SYNTHETIC_MARKETS_20261126.json'
assert not OUT.exists()
assert hashlib.sha256(bt.PR.read_bytes()).hexdigest()=='e10cc8b66b2b934c0d20fc4572e0362f7f56ed9b02b78bef87f5c27f2f547309'
bt.HS=bt.T('2025-03-01T00:00:00Z')
bt.MS=bt.T('2025-03-22T00:00:00Z')
bt.ME=bt.T('2025-09-30T00:00:00Z')
bt.N_M=(bt.ME-bt.MS)//bt.M
bt.N_H=(bt.ME-bt.HS)//bt.H
bt.PERIODS={'PRE':(bt.T('2025-04-15T00:00:00Z'),bt.T('2025-09-30T00:00:00Z'))}
N=bt.N_M;H0=(bt.MS-bt.HS)//bt.H
SYMS=bt.SYMS
SCENARIOS={
 'BULL_STEADY':dict(drift=.006,vol=.035,cycle=.0,jump=0.,reversal=False),
 'BULL_PULLBACK':dict(drift=.004,vol=.055,cycle=.00013,jump=0.,reversal=False),
 'BULL_SQUEEZE':dict(drift=.007,vol=.055,cycle=.0001,jump=.05,reversal=False),
 'BULL_REVERSAL':dict(drift=.007,vol=.045,cycle=.00008,jump=.02,reversal=True),
 'RANGE':dict(drift=0.,vol=.050,cycle=.00011,jump=0.,reversal=False),
 'BEAR':dict(drift=-.005,vol=.045,cycle=.00007,jump=-.015,reversal=False)
}
SEEDS=[2026112601,2026112602,2026112603,2026112604]

def market(seed,name,params):
 rng=np.random.default_rng(seed)
 btc_innov=rng.standard_normal(N)
 evo=np.arange(N)
 dr=np.full(N,params['drift']/288)
 if params['reversal']:dr[evo>=80*288]=-abs(params['drift'])*1.6/288
 dr+=params['cycle']*np.sin(2*np.pi*evo/(16*288))
 jump=np.zeros(N)
 if params['jump']:
  events=rng.random(N)<1/(12*288)
  jump[events]=abs(params['jump'])*rng.choice([-1,1],size=np.count_nonzero(events),p=[.24,.76] if params['drift']>0 else [.76,.24])
 hfiles={};mfiles={}
 for j,sym in enumerate(SYMS):
  sigma=params['vol']*(1+.07*j)
  beta=1.0+.075*j
  innovation=btc_innov if j==0 else .60*btc_innov+.80*rng.standard_normal(N)
  returns=dr*(1+.05*j)+sigma*innovation/math.sqrt(288)+jump*beta
  px0=100.+7.*j
  log=np.cumsum(np.clip(returns,-.3,.3))
  c=px0*np.exp(np.clip(log,-10,10))
  o=np.r_[px0,c[:-1]]
  wiggle=np.maximum(.00008,.14*np.abs(returns))
  high=np.maximum(o,c)*(1+wiggle)
  low=np.minimum(o,c)*(1-wiggle)
  volume=1000*np.exp(.25*rng.standard_normal(N))*(1+50*np.abs(returns))
  m=np.column_stack((o,high,low,c,volume))
  h=np.full((bt.N_H,5),np.nan)
  resh=m.reshape(-1,12,5)
  h[H0:H0+len(resh),0]=resh[:,0,0]
  h[H0:H0+len(resh),1]=resh[:,:,1].max(axis=1)
  h[H0:H0+len(resh),2]=resh[:,:,2].min(axis=1)
  h[H0:H0+len(resh),3]=resh[:,-1,3]
  h[H0:H0+len(resh),4]=resh[:,:,4].sum(axis=1)
  hfiles[sym]=h;mfiles[sym]=m
 return hfiles,mfiles

def scenario_eval(seed,name,params):
 hfiles,mfiles=market(seed,name,params)
 results={'regime':name,'seed':seed,
          'btc_net_return_pct':float(100*(mfiles['BTC'][-1,3]/mfiles['BTC'][0,0]-1)),
          'strategy':{}}
 bt_btc=hfiles['BTC']
 sigs=[]
 for sym in SYMS[1:]:
  for mode in ('A','B'):
   a,counts=bt.generate(hfiles[sym],mfiles[sym],bt_btc,mode,sym,{})
   sigs.extend(a)
 for mode in ('A','B'):
  for hours in (24,48):
   candidates=[x for x in sigs if x['strategy']=='Y06_R2_'+mode]
   trades=[]
   for x in candidates:
    ex=bt.exit_trade(x,mfiles[x['symbol']],hours)
    if ex is not None:trades.append(ex)
   perf10=bt.wallet(trades,'PRE',10,mfiles)
   perf30=bt.wallet(trades,'PRE',30,mfiles)
   perf30_stress=[]
   for e in trades:
    if e['exitReason'] not in ('HARD_STOP8','STRUCTURAL_STOP'):
     perf30_stress.append(e)
    else:
     z=dict(e);side=1 if z['direction']=='LONG' else -1
     z['exitPrice']=z['exitPrice']-side*.005*z['entry']
     z['rawReturn']=side*(z['exitPrice']/z['entry']-1)
     perf30_stress.append(z)
   stress=bt.wallet(perf30_stress,'PRE',30,mfiles)
   for p in (perf10,perf30,stress):p.pop('accepted',None)
   results['strategy'][f'Y06_R2_{mode}_E{hours}']={
    'raw_candidate_count':len(candidates),'exit_count':len(trades),
    '10':perf10,'30':perf30,'30_stress':stress}
 return results

start=time.monotonic();records=[]
for name,config in SCENARIOS.items():
 for seed in SEEDS:
  a=scenario_eval(seed,name,config);records.append(a)
  print('SYNTH',name,seed,'BTC',round(a['btc_net_return_pct'],1),
   'A24_30',round(a['strategy']['Y06_R2_A_E24']['30']['terminal_jpy']),
   'A24_DD',round(a['strategy']['Y06_R2_A_E24']['30']['max_dd_pct'],2),
   'B48_30',round(a['strategy']['Y06_R2_B_E48']['30']['terminal_jpy']),flush=True)

summary={}
for name in SCENARIOS:
 summary[name]={}
 z=[x for x in records if x['regime']==name]
 for k in z[0]['strategy']:
  s=[x['strategy'][k]['30'] for x in z]
  v=[x['strategy'][k]['10'] for x in z]
  summary[name][k]={
   'n_scenarios':len(s),
   'mean_final_30bps_jpy':float(statistics.mean(x['terminal_jpy'] for x in s)),
   'mean_mdd_30bps_pct':float(statistics.mean(x['max_dd_pct'] for x in s)),
   'profitable_30bps_count':sum(x['terminal_jpy']>10000 for x in s),
   'profit_and_mdd30_30bps_count':sum(x['terminal_jpy']>10000 and x['max_dd_pct']<=30 for x in s),
   'mean_trade_win_30bps_pct':float(statistics.mean(x['win_pct'] for x in s if x['win_pct'] is not None)) if any(x['win_pct'] is not None for x in s) else None,
   'mean_final_10bps_jpy':float(statistics.mean(x['terminal_jpy'] for x in v)),
   'mean_realized_trades':float(statistics.mean(x['n'] for x in s))}
  print('SUMMARY',name,k,'FINAL30',round(summary[name][k]['mean_final_30bps_jpy']),
   'DD30',round(summary[name][k]['mean_mdd_30bps_pct'],2),
   'PROFITN',summary[name][k]['profitable_30bps_count'],flush=True)
payload={'meta':{'protocol_sha256':hashlib.sha256(bt.PR.read_bytes()).hexdigest(),
 'strategy_engine_sha256':hashlib.sha256(CODE.read_bytes()).hexdigest(),
 'status':'RESEARCH_ONLY_SYNTHETIC_NOT_LIVE_NOT_REAL_MARKET',
 'design':'24 preselected synthetic BTC+13alt scenarios, 191d price paths including warmup, 167d entries 2025 Apr15–Sep30, 5min OHLC consistency, six market regimes x four seeds',
 'regimes':SCENARIOS,'seeds':SEEDS,'note':'No real financing/funding, no peer-runner SharedRisk/Gross. Price processes illustrative and cannot prove actual ASTER forecasting.'},
 'summary':summary,'records':records}
OUT.write_text(json.dumps(payload,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf8')
print('SYNTHETIC_COMPLETE',OUT,'SHA256',hashlib.sha256(OUT.read_bytes()).hexdigest(),
 'SECONDS',round(time.monotonic()-start,1))
