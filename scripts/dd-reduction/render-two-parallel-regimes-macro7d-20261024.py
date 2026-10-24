#!/usr/bin/env python3
"""Seven-day regime routing A/B; train cutoffs frozen on 2024-2025.
Extends base dual model with previously closed 3d/7d market state.
"""
import json
from pathlib import Path
from importlib import util
import numpy as np
HERE=Path(__file__).resolve().parent
sp=util.spec_from_file_location('short_flow_dualbase',HERE/'render-two-parallel-regimes-20261024.py')
d=util.module_from_spec(sp);sp.loader.exec_module(d)
ROOT=d.REPO
d.OUT=ROOT/'docs/research/results/render-two-regime-20261024/macro7d'
d.OUT.mkdir(exist_ok=True,parents=True)
base_attach=d.attach_features
K=['seller1','oi3Pct','oi1Pct','seller3','volumeSpike1h',
  'BTC_7d','RENDER_7d','BTC_3d','RENDER_3d','RENDER_volatility_7d']
d.REGIME_KEYS=K
def macro_attach(bars,btc,items):
 base_attach(bars,btc,items)
 close=np.asarray([float(r[4]) for r in bars],dtype=float)
 bclose=np.asarray([float(r[4]) for r in btc],dtype=float)
 assert np.all(close>0) and np.all(bclose>0)
 logr=np.r_[0,np.diff(np.log(close))]
 cum=np.r_[0,np.cumsum(logr**2)]
 for r in items:
  i=int(r['index'])
  assert i>=2016
  b=r['base']
  for name,n in (('3d',864),('7d',2016)):
   b['BTC_'+name]=100*(bclose[i]/bclose[i-n]-1)
   b['RENDER_'+name]=100*(close[i]/close[i-n]-1)
  variance=max(0,float((cum[i+1]-cum[i+1-2016])/2016))
  b['RENDER_volatility_7d']=100*(variance**.5)*(288**.5)
def macro_raw(items):
 return np.asarray([[r['flow'][k] for k in K[:5]]+
                      [r['base'][k] for k in K[5:]] for r in items],dtype=float)
d.attach_features=macro_attach
d.regime_raw=macro_raw
if __name__=='__main__':
 d.main()
 file=d.OUT/'RENDER_CAUSAL_PARALLEL_TWO_REGIME_SCREEN_20261024.json'
 j=json.loads(file.read_text('utf8'))
 j['dataset']['regimeKeys']=K
 j['dataset']['macroAsOf']='3d and 7d price returns and 7d volatility computed entirely before entry'
 j['modelsReference']='The two-regime 1h-only basis run is saved in parent directory; this is an independent macro7d adaptation.'
 file.write_text(json.dumps(j,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
 print('MACRO_RESULT',file)
