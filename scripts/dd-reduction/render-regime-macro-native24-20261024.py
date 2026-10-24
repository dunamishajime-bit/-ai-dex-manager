#!/usr/bin/env python3
"""Non-leaky market-state calendar comparison on frozen native RENDER fills.
For every feature: only bars timestamped strictly before the H1 entry.
Comparison is descriptive, never a backfit training label.
"""
from pathlib import Path
import bisect,collections,datetime as dt,hashlib,json,math,statistics
import numpy as np
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
OUT=ROOT/'docs/research/results/render-two-regime-20261024'
OUT.mkdir(exist_ok=True,parents=True)
SRC=ROOT/'docs/research/results/render-orderflow-20261024'
from importlib import util
spec=util.spec_from_file_location('flow_src',HERE/'render-orderflow-composite-20261024.py')
m=util.module_from_spec(spec);spec.loader.exec_module(m)
def summary(rows,keys):
 s={'n':len(rows),'wins':sum(r['win'] for r in rows),'wrPct':round(100*sum(r['win'] for r in rows)/len(rows),2)}
 for k in keys:
  v=[r[k] for r in rows]
  s[k]={'median':round(statistics.median(v),3),'p25':round(float(np.quantile(v,.25)),3),
         'p75':round(float(np.quantile(v,.75)),3),
         'min':round(min(v),3),'max':round(max(v),3)}
 return s
def main():
 manifest=json.loads((SRC/'RENDER_ORDERFLOW_SOURCE_MANIFEST_20261024.json').read_text('utf8'))
 bars=m.read_render_bars(manifest['files'],False)
 n=m.e.imp('native_macro_boot',HERE/'research-residual-avax-composite-entry-veto-full8-20261023.py')
 prov,_=n.native.m.m.core.task8.legacy.bootstrap()
 btc,_=prov.getdata('BTCUSDT')
 assert len(btc)==len(bars) and all(a[0]==b[0] for a,b in zip(bars,btc))
 native=json.loads((SRC/'RENDER_NATIVE_SELECTED24_OI_FLOW_ATTRIBUTION_20261024.json').read_text('utf8'))
 ts=[b[0] for b in bars]
 oi,qual=m.read_metrics(manifest['files']);oti=[a[0] for a in oi]
 def oi_past(t,milliseconds):
  j=bisect.bisect_right(oti,t-milliseconds)-1
  if j<0 or t-milliseconds-oti[j]>20*60000:return None
  return oi[j][1]
 def feat_at(row):
  t=int(row['ts']);j=bisect.bisect_left(ts,t)-1
  assert j>=8641 and ts[j]+m.MIN5==t
  f={}
  for name,lookback in [('1d',288),('3d',864),('7d',2016),('14d',4032),('30d',8640)]:
   f['BTC_'+name]=100*(btc[j][4]/btc[j-lookback][4]-1)
   f['RENDER_'+name]=100*(bars[j][4]/bars[j-lookback][4]-1)
  price=np.array([b[4] for b in bars[j-2016:j+1]],dtype=float)
  bprice=np.array([b[4] for b in btc[j-2016:j+1]],dtype=float)
  changes=np.diff(np.log(price))
  cbtc=np.diff(np.log(bprice))
  f['RENDER_rv7d']=100*float(np.std(changes))*math.sqrt(288)
  f['BTC_rv7d']=100*float(np.std(cbtc))*math.sqrt(288)
  f['RS_7d']=f['RENDER_7d']-f['BTC_7d']
  cur_o=oi_past(t,0)
  past_o=oi_past(t,7*24*3600000)
  if cur_o is not None and past_o is not None:
   f['RENDER_OI_7d']=100*math.log(cur_o/past_o)
  return dict(row,**f,win=bool(row['win30']))
 rows=[feat_at(z) for z in native['selectedTrades']]
 assert len(rows)==24 and all('RENDER_OI_7d' in r for r in rows)
 keys=[k for k in rows[0] if k.startswith(('BTC_','RENDER_','RS_')) and isinstance(rows[0][k],(float,int))]
 a=[r for r in rows if m.e.ms('2026-01-01')<=r['ts']<m.e.ms('2026-04-01')]
 b=[r for r in rows if m.e.ms('2026-04-01')<=r['ts']<m.e.ms('2026-08-10')]
 assert len(a)==len(b)==12
 report={'status':'DESCRIPTIVE_ASOF_REGIME_A_B_NATIVE24_NOT_PREDICTIVE',
 'warning':['24 selected trades are an in-sample retrospective period; no thresholds should be fit to this table',
            'Market-state features use only completed M5 before entry',
            'No account-shared reallocation and no forward unused validation'],
 'periods':{'weakJanMar':summary(a,keys),'strongAprAug':summary(b,keys)},
 'winsVsLosses':{'wins':summary([r for r in rows if r['win']],keys),'losses':summary([r for r in rows if not r['win']],keys)},
 'records':[{'t':r['ts'],'win':r['win'],**{k:round(r[k],4) for k in keys}} for r in rows]}
 output=OUT/'RENDER_NATIVE24_MACRO_REGIME_CONTRAST_20261024.json'
 output.write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n',encoding='utf8')
 for k in keys:
  print('REGIME_MACRO',k,'JANMAR',report['periods']['weakJanMar'][k]['median'],
  'APR_AUG',report['periods']['strongAprAug'][k]['median'],
  'WINS',report['winsVsLosses']['wins'][k]['median'],
  'LOSSES',report['winsVsLosses']['losses'][k]['median'],flush=True)
 print('SAVED',output)
if __name__=='__main__':main()
