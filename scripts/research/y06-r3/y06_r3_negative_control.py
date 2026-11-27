from __future__ import annotations
import pathlib,json,importlib.util,collections,hashlib,math,statistics,datetime
import numpy as np

ROOT=pathlib.Path(r'C:\tmp\disdex-d126-crossrunner-research-20261126')
P=ROOT/'Y06_R3_BEAR_RETEST_REAL_M5_BT_20261126.json'
source=json.loads(P.read_text(encoding='utf8'))
BASE=ROOT/'y06_r2_bt_engine_v2.py'
ss=importlib.util.spec_from_file_location('y06r2_market_loader',BASE)
bt=importlib.util.module_from_spec(ss);ss.loader.exec_module(bt)
OUT=ROOT/'Y06_R3_SAME_SYMBOL_NEAR_TIME_PLACEBO_20261126.json'
assert not OUT.exists()
m5={s:bt.data(s,'5m')[0] for s in bt.SYMS[1:]}
H=bt.H;M=bt.M
OFFSET_HOURS=(-12,-9,-6,-3,-1,1,3,6,9,12)
rng=np.random.default_rng(20261126)
def valid_quality(m,t):
 i=(t-bt.MS)//M
 if i<576 or i>=len(m):return False
 x=m[i-576:i]
 return len(x)==576 and np.isfinite(x).all() and np.count_nonzero(x[:,4]>0)>=432
def ret_short(m,t,hours):
 i=(t-bt.MS)//M;end=i+hours*12
 if i<0 or end>=len(m) or not np.isfinite(m[i:end+1,:4]).all():return None
 ep=m[i,0];stop=ep*1.08
 for k in range(i,end):
  if m[k,1]>=stop:return 1-max(m[k,0],stop)/ep
 return 1-m[end,0]/ep

analysis={}
for name in ['DIRECT_CONTROL/STOP8_TIME24','RETEST_H1/STOP8_TIME24','RETEST_H1/STOP8_TIME48','RETEST_M15/STOP8_TIME24']:
 h=48 if name.endswith('TIME48') else 24
 analysis[name]={}
 for period,(start,end) in bt.PERIODS.items():
  # Standard portfolio admitted signals, not raw overlapping candidates.
  a=source['strategies'][name]['period'][period]['30']['portfolio']['accepted']
  matched=[];omitted=collections.Counter()
  for item in a:
   t=item['entryTs'];s=item['symbol'];m=m5[s]
   options=[]
   for off in OFFSET_HOURS:
    u=t+off*H
    if not start<=u or u+(h*H)>=end:continue
    if not valid_quality(m,u):continue
    r=ret_short(m,u,h)
    if r is not None:options.append(r-.003)
   if len(options)<2:omitted['no_two_matched_offsets']+=1;continue
   actual=ret_short(m,t,h)
   if actual is None or abs(actual-item['rawReturn'])>1e-8:
    raise RuntimeError('PLACEBO_BASELINE_MISMATCH:'+name+':'+period+':'+s+':'+str(actual)+':'+str(item['rawReturn']))
   matched.append((actual-.003,np.asarray(options,dtype=float),s,t))
  if matched:
   actual_mean=statistics.mean(v for v,_,_,_ in matched)
   resamples=np.empty(4000)
   for i in range(4000):
    resamples[i]=statistics.mean(options[rng.integers(len(options))] for _,options,_,_ in matched)
   percentile=float(np.mean(resamples<actual_mean))
   delta=float(actual_mean-np.mean(resamples))
   q=[float(x) for x in np.quantile(resamples,[.025,.5,.975])]
  else:percentile=delta=None;q=[]
  analysis[name][period]={
   'total_original_portfolio_fills':len(a),'matched_for_placebo_n':len(matched),
   'excluded':dict(omitted),
   'actual_mean_net_pct':float(100*actual_mean) if matched else None,
   'placebo_mean_net_pct':float(100*np.mean(resamples)) if matched else None,
   'actual_minus_placebo_pct_points':float(100*delta) if delta is not None else None,
   'placebo_95pct_range_pct':[100*x for x in q],
   'actual_above_placebo_fraction':percentile,
   'placebo_count':4000,'mean_available_offsets':float(np.mean([len(c) for _,c,_,_ in matched])) if matched else None
  }
  r=analysis[name][period]
  print('PLACEBO',name,period,'N',len(matched),
       'ACTUAL',round(r['actual_mean_net_pct'],3) if matched else None,
       'NULL',round(r['placebo_mean_net_pct'],3) if matched else None,
       'DELTA',round(r['actual_minus_placebo_pct_points'],3) if matched else None,
       'PERCENTILE',round(100*r['actual_above_placebo_fraction'],1) if matched else None,
       flush=True)

meta={'status':'POSTHOC_NEGATIVE_CONTROL_RESEARCH_ONLY',
 'tested_source_sha256':hashlib.sha256(P.read_bytes()).hexdigest(),
 'method':'For original 30bps admitted SHORTs from each strategy, same symbol, ±1/3/6/9/12h shifted candidate entry, strict prior48h >=75% positive volume, stop8 and original 24h/48h time limit. 4000 independent resamples of offsets. No capital opportunity or position-slot simulation in null.',
 'limitations':['PRE/TARGET/FORWARD already inspected, placebo analysis done after strategy results, cannot prove OOS',
  'Matched placebos may land in a different D126 regime or have different cooldown/slot occupancy; this is only a conservative directional falsification test',
  'No funding, spread or net price guarantee; not production adoption or trading authority']}
OUT.write_text(json.dumps({'meta':meta,'results':analysis},ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print('OUTPUT',OUT,'SHA256',hashlib.sha256(OUT.read_bytes()).hexdigest())
