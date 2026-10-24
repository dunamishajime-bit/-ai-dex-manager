#!/usr/bin/env python3
"""RESEARCH ONLY: Native 8-strategy shared-wallet admission of two concurrent
RENDER regime heads. Regime B exactly preserves canonical RENDER entry and
profit-floor. Regime A is tested when causal deep-selloff conditions are met.
No source or LIVE modification. Cases evaluated with 10/30bps native replay.
"""
from __future__ import annotations
import argparse,bisect,collections,importlib.util,json,math,statistics,sys
from pathlib import Path
HERE=Path(__file__).resolve().parent
R=HERE.parents[1]
def load(n,p):
 spec=importlib.util.spec_from_file_location(n,p)
 m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
previous=load('regime_previous_native_full8',HERE/'run-idle-three-entry-native-full8-20261024.py')
flow=load('regime_flow_importer',HERE/'render-orderflow-composite-20261024.py')
kernel=previous.native.m.m
base=previous.base
core_native_filter=previous.causal_entry_filter
manifest=json.loads((R/'docs/research/results/render-orderflow-20261024/RENDER_ORDERFLOW_SOURCE_MANIFEST_20261024.json').read_text('utf8'))
metrics,metricQuality=flow.read_metrics(manifest['files'])
mtimes=[x[0] for x in metrics]
funding=flow.read_funding(manifest['files'])
ftimes=[x[0] for x in funding];frates=[x[1] for x in funding]
SOURCE_CASE='RENDER_PROFIT_F035_JUP_M1P5'
PREFIX='RENDER_TWO_REGIME_'
CASE_RULES={
 PREFIX+'PARITY_BASELINE':None,
 PREFIX+'A_WEAK_MIN_SELLER':{'minSeller':0.00,'OI':None,'mode':'deep'},
 PREFIX+'A_WEAK_SELLER_0P05':{'minSeller':.05,'OI':None,'mode':'deep'},
 PREFIX+'A_WEAK_SELLER_0P05_OI_UP':{'minSeller':.05,'OI':0.,'mode':'deep'},
 PREFIX+'A_WEAK_SELLER_0P08_OR_RECOVERY':{'minSeller':.08,'OI':None,'mode':'recovery'},
 PREFIX+'A_VERY_DEEP_SELLER_OI':{'minSeller':.05,'OI':0.,'mode':'verydeep'}
}
for name in CASE_RULES:
 previous.CASE_RULES[name]={k:list(v) for k,v in previous.CASE_RULES[SOURCE_CASE].items()}
 previous.PROFIT_FLOOR[name]=.0035
STATE={'case':None,'audit':collections.defaultdict(list),'cache':{},'failures':collections.Counter()}
def symbol_market_features(source,ts):
 """Availability: close 5m strictly before signal. Metrics +10m."""
 if ts in STATE['cache']:return STATE['cache'][ts]
 bars,times=source.getdata('RENDERUSDT')
 btc,btct=source.getdata('BTCUSDT')
 i=bisect.bisect_left(times,ts)-1
 j=bisect.bisect_left(btct,ts)-1
 if i<2017 or j<2017 or i+1>=len(bars) or int(times[i])+flow.MIN5!=ts or int(btct[j])+flow.MIN5!=ts:
  raise RuntimeError(('CAUSAL_TWO_REGIME_M5_NOT_AVAILABLE',ts,i,j))
 if int(times[i-2016])!=int(times[i])-2016*flow.MIN5 or int(btct[j-2016])!=int(btct[j])-2016*flow.MIN5:
  raise RuntimeError(('7D_CONTINUITY_NOT_PROVEN',ts))
 R7=100*(float(bars[i][4])/float(bars[i-2016][4])-1)
 B7=100*(float(btc[j][4])/float(btc[j-2016][4])-1)
 # H1 rolling volume-weighted flow, identical to verified Binance provenance.
 volume=sum(float(bars[k][5]) for k in range(i-11,i+1))
 buy=None
 # native OHLCV has only six fields, so validate public archived M5 in cache
 if not hasattr(symbol_market_features,'arch'):
  arch={}
  for item in manifest['files']:
   if item['kind']!='klines5m':continue
   rows=flow.csv_from_archive(item)
   for r in rows:
    if r and r[0].isdigit():
     arch[int(r[0])]=(float(r[5]),float(r[9]))
  symbol_market_features.arch=arch
 arch=symbol_market_features.arch
 s=sum(2*arch[int(times[k])][1]-arch[int(times[k])][0] for k in range(i-11,i+1))
 volume_check=sum(arch[int(times[k])][0] for k in range(i-11,i+1))
 if abs(volume-volume_check)>max(1.,volume)*1e-7:
  raise RuntimeError(('VENUE_M5_VOLUME_PARITY_FAIL',ts,volume,volume_check))
 seller1=-s/volume_check
 # Regime fit uses earlier 7d volatility (preentry 5m log return)
 import numpy as np
 closes=np.array([float(bars[k][4]) for k in range(i-2016,i+1)],dtype=float)
 vol7=float(np.std(np.diff(np.log(closes)))*math.sqrt(288)*100)
 latest=bisect.bisect_right(mtimes,ts)-1
 prior=bisect.bisect_right(mtimes,ts-3600000)-1
 if min(latest,prior)<0 or ts-mtimes[latest]>20*60000 or ts-3600000-mtimes[prior]>20*60000:
  raise RuntimeError(('METRICS_TIME_NOT_AVAILABLE',ts))
 oi1=100*math.log(metrics[latest][1]/metrics[prior][1])
 # No future return. Score reflects only market environment.
 score=int(R7<=-8)*40+int(B7<=-3)*30+int(vol7>=5)*30
 x={'render7Pct':R7,'btc7Pct':B7,'vol7DailyPct':vol7,
   'seller1':seller1,'oi1Pct':oi1,'macroScore':score}
 STATE['cache'][ts]=x
 return x
def dual_filter(rows,overlays,source,cost_bps,obs,baseline_lookup=None):
 result=core_native_filter(rows,overlays,source,cost_bps,obs,baseline_lookup)
 case=STATE['case'];rule=CASE_RULES[case]
 if rule is None:return result
 out=[]
 for row in result:
  if row.get('strategy_id')!='IDLE' or row.get('symbol')!='RENDERUSDT' or row.get('side')!='SHORT':
   out.append(row);continue
  ts=int(row['entry_ts_ms'])
  f=symbol_market_features(source,ts)
  weak=(f['macroScore']>=70) if rule['mode']=='deep' else (f['macroScore']>=100)
  if not weak:
   # Regime B: preserve historical entry untouched.
   out.append(row)
   STATE['audit'][(case,cost_bps)].append({'ts':ts,'expert':'B',
    'decision':'KEEP','render7Pct':round(f['render7Pct'],4),
    'btc7Pct':round(f['btc7Pct'],4),'macroScore':f['macroScore']})
   continue
  # Regime A: require actual selling pressure, optionally expanding OI.
  # Recovery clause allows rebound then confirmed weakness as an alternative.
  confirmed=(f['seller1']>=rule['minSeller'] and
              (rule['OI'] is None or f['oi1Pct']>=rule['OI']))
  if rule['mode']=='recovery' and not confirmed:
   entryfeat=previous.screen.feat.get_feat(source,'RENDERUSDT',ts)
   confirmed=(entryfeat is not None and
      entryfeat['ret1h']>=.15 and f['seller1']>.02 and f['oi1Pct']>-.25)
  STATE['audit'][(case,cost_bps)].append({'ts':ts,'expert':'A',
   'decision':'KEEP' if confirmed else 'VETO',
   'render7Pct':round(f['render7Pct'],4),'btc7Pct':round(f['btc7Pct'],4),
   'vol7DailyPct':round(f['vol7DailyPct'],4),'macroScore':f['macroScore'],
   'seller1':round(f['seller1'],5),'oi1Pct':round(f['oi1Pct'],4)})
  if confirmed:out.append(row)
  else:
   obs['regimeACandidateReject']=obs.get('regimeACandidateReject',0)+1
   obs.setdefault('regimeACandidateRejectEvidence',[]).append({'ts':ts,'case':case,
    'macroScore':f['macroScore'],'flowSell1':f['seller1'],'oi1':f['oi1Pct']})
 return out
kernel.entry_filter=dual_filter
def main():
 pa=argparse.ArgumentParser()
 pa.add_argument('--output',type=Path,required=True)
 pa.add_argument('--cases',nargs='+',default=list(CASE_RULES))
 args=pa.parse_args()
 assert set(args.cases)<=set(CASE_RULES)
 assert R not in (args.output.resolve(),*args.output.resolve().parents)
 args.output.mkdir(exist_ok=True,parents=True)
 rows={}
 for case in args.cases:
  STATE['case']=case
  STATE['cache'].clear()
  before=list(sys.argv)
  try:
   sys.argv=[str(HERE/'run-idle-three-entry-native-full8-20261024.py'),
             '--output',str(args.output/case),'--case',case]
   previous.main()
  finally:sys.argv=before
  entries={str(cost):STATE['audit'][(case,cost)] for cost in (10,30)}
  audit={'status':'RESEARCH_ONLY_NATIVE_FULL8_DYNAMIC_10_30BPS',
         'case':case,'rule':CASE_RULES[case],
         'featureContract':{'deep':'>=70 score, RENDER7<-8:40 BTC7<-3:30 RENDER RV7>5:30','verydeep':'score 100',
          'seller1':'Binance signed taker buyer/seller 1H','OI1':'OI publish time delayed 10m'},
         'logs':entries,
         'summary':{str(c):dict(collections.Counter(z['decision']+'_'+z['expert'] for z in entries[str(c)]))
          for c in (10,30)}}
  (args.output/(case+'_regime_evidence.json')).write_text(json.dumps(audit,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
  print('REGIME8_FINISHED',case,'SUMMARY',audit['summary'],flush=True)
if __name__=='__main__':main()
