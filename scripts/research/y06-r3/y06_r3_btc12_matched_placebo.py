import pathlib,json,importlib.util,hashlib,numpy as np,statistics,collections
R=pathlib.Path(r'C:\tmp\disdex-d126-crossrunner-research-20261126')
src=R/'y06_r3_bear_retest_research_v2.py'
s=importlib.util.spec_from_file_location('r3_btc_matching',src)
r3=importlib.util.module_from_spec(s);s.loader.exec_module(r3)
bt=r3.bt;H=bt.H;M=bt.M
result=R/'Y06_R3_POSTHOC_BTC12_REGIME_MATCHED_PLACEBO_20261126.json'
assert not result.exists()
btch,_=bt.data('BTC','1h')
original=json.loads((R/'Y06_R3_BEAR_RETEST_REAL_M5_BT_V2_20261126.json').read_text(encoding='utf8'))
base=[x for x in original['raw_candidate_intentions'] if x['policy']=='RETEST_H1']
m5={};h1={};cache=[]
def btc12(t):
 j=(t//(12*H)*12*H-bt.HS)//H
 if j<13 or j>=len(btch):return False
 return btch[j-1,3]<btch[j-13,3] and np.isfinite(btch[j-1,3]*btch[j-13,3])
for sym in sorted(set(x['symbol'] for x in base)):
 m5[sym]=bt.data(sym,'5m')[0];h1[sym]=bt.data(sym,'1h')[0]
def regime_valid(sym,t):
 i=(t-bt.HS)//H
 return (i>220 and r3.is_bear(h1[sym],i) and btc12(t))
def quality(m,t):
 k=(t-bt.MS)//M
 if k<576:return False
 a=m[k-576:k]
 return a.shape[0]==576 and np.isfinite(a).all() and np.count_nonzero(a[:,4]>0)>=432
def shortreturn(m,t,hours=24):
 k=(t-bt.MS)//M;end=k+hours*12
 if k<0 or end>=len(m) or not np.isfinite(m[k:end+1,:4]).all():return None
 ep=m[k,0];stop=ep*1.08
 for j in range(k,end):
  if m[j,1]>=stop:return 1-max(m[j,0],stop)/ep
 return 1-m[end,0]/ep

filtered=[x for x in base if btc12(x['entryTs'])]
trades=[z for z in (r3.calc_trade(x,m5[x['symbol']],'STOP8_TIME24') for x in filtered) if z]
offsets=(-12,-9,-6,-3,-1,1,3,6,9,12)
rng=np.random.default_rng(2026112602);ans={}
for period,(start,end) in bt.PERIODS.items():
 items=[x for x in trades if x['period']==period]
 accepted=bt.wallet(items,period,30,m5)['accepted']
 matched=[];skipped=collections.Counter()
 for x in accepted:
  t=x['entryTs'];sym=x['symbol'];m=m5[sym]
  a=shortreturn(m,t)
  if a is None or abs(a-x['rawReturn'])>1e-8:raise RuntimeError('SOURCE_PRICE_MISMATCH')
  choices=[]
  for off in offsets:
   u=t+off*H
   if not(start<=u and u+24*H<end):continue
   if not regime_valid(sym,u) or not quality(m,u):continue
   z=shortreturn(m,u)
   if z is not None:choices.append(z-.003)
  if len(choices)<2:skipped['insufficient_matched_alternative_entry_times']+=1;continue
  matched.append((a-.003,np.array(choices,dtype=float)))
 if matched:
  avg=statistics.mean(z for z,_ in matched)
  draws=np.array([statistics.mean(z[rng.integers(len(z))] for _,z in matched) for _ in range(4000)])
  nul=float(draws.mean())
  pv=float(np.mean(draws<avg))
 else:avg=nul=pv=None
 ans[period]={'actual_fills':len(accepted),'regime_matched_n':len(matched),'excluded':dict(skipped),
 'mean_actual_net30_pct':100*avg if avg is not None else None,
 'mean_regime_matched_placebo_net30_pct':100*nul if nul is not None else None,
 'alpha_vs_placebo_pct_points':100*(avg-nul) if avg is not None else None,
 'placebo_percentile':pv,'n_resamples':4000}
 print('REGIME_MATCHED_PLACEBO',period,ans[period],flush=True)
payload={'meta':{'status':'POSTHOC_DIAGNOSTIC_NO_FORMAL_ADOPTION',
 'source_SHA256':hashlib.sha256(src.read_bytes()).hexdigest(),
 'method':'Original BTC12-neg R3 retest H1 admitted fills, same symbol alternative ±1/3/6/9/12h, require alt D126 bearish and BTC12 bearish at placebo entry, prior48h M5 positive volume>=75%, M5 STOP8+24h, 30bps. Fixed 4000 draws. No executable two-slot placebo occupancy.',
 'limitation':'Small sample, highly autocorrelated near-time controls, all 3 periods already researched and after-the-fact guard; not untouched OOS, no funding, fees only 30bps.'},'results':ans}
result.write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print('SAVED',result,'SHA256',hashlib.sha256(result.read_bytes()).hexdigest())
