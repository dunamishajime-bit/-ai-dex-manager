#!/usr/bin/env python3
"""Generate 2026-Aug10-Oct22 six-short causal holdout ledger from verified
99 official Binance Vision ZIPs, separate from research prior 2026-08-10 bank.
This window was seen before, NOT pristine validation for optimized rules.
"""
from __future__ import annotations
from pathlib import Path
from importlib import util
import json,collections
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
OUT=ROOT/'docs/research/results/render-three-regime-20261024'
def load(n,p):
 s=util.spec_from_file_location(n,p);m=util.module_from_spec(s);s.loader.exec_module(m);return m
hold=load('hold6_secondary_market',HERE/'render-post2026aug-frozen-3expert-holdout-20261024.py')
orig=hold.orig;base=hold.base;m=hold.m;e=hold.e
def main():
 j=json.loads((OUT/'RENDER_POST_2026AUG_HELDOUT_PUBLIC_SOURCE_MANIFEST_20261024.json').read_text('utf8'))
 assert j['status']=='HOLDOUT_INPUTS_READY' and j['staticPublisherChecksumVerified']==99
 assert all(x['publisherChecksumMatch'] and x['zipCRC'] for x in j['files'])
 old=json.loads((ROOT/'docs/research/results/render-orderflow-20261024/RENDER_ORDERFLOW_SOURCE_MANIFEST_20261024.json').read_text('utf8'))
 prices=m.read_render_bars(old['files'],False)
 provider=m.e.imp('hold6_source',HERE/'research-residual-avax-composite-entry-veto-full8-20261023.py')
 source,_=provider.native.m.m.core.task8.legacy.bootstrap()
 btcold,_=source.getdata('BTCUSDT')
 newer=base.bars(j['files'],'RENDERUSDT')
 btcnew=base.bars(j['files'],'BTCUSDT')
 prices=prices+newer;btc=btcold+btcnew
 assert base.continuous(prices) and base.continuous(btc)
 older_metrics,_=m.read_metrics(old['files'])
 newmetrics,bad=load('sixhold_metric_reader',HERE/'render-2024-fullyear-three-experts-20261024.py').metrics_small([f for f in j['files'] if f['kind']=='metrics'])
 metrics=sorted(older_metrics+newmetrics)
 older_funding=m.read_funding(old['files'])
 extra_funding=load('sixhold_fund_reader',HERE/'render-2024-fullyear-three-experts-20261024.py').funding_small([f for f in j['files'] if f['kind']=='fundingRate'])
 api_funding=[(int(ts)+300000,float(rate)) for ts,rate in j['fundingOctoberPublicApi']['rows']]
 fund=sorted(older_funding+extra_funding+api_funding)
 available,counts=orig.collect(prices,btc,metrics,fund,'RENDERUSDT',hold.MAX_DATA_END)
 brackets=json.loads((OUT/'RENDER_2024_2026_ALL_SIX_WITH_B_30_BRACKETS_M5_LEDGER_20261024.json').read_text('utf8'))['BVariants']
 rows=[]
 for q in available:
  if q['time']<hold.START or q['time']>=hold.MAX_DATA_END-24*orig.HOUR:continue
  short=sorted(k for k in q['signals'] if k.startswith('SHORT_'))
  if not short:continue
  exits={name:orig.simulate(prices,q['i'],'SHORT',contract)
    for name,contract in orig.EXITS.items()}
  if 'SHORT_BEAR_REBOUND_2H_FADE' in short and q['mfeSignals']['oi3Pct']<=-.2:
   exits.update({name:orig.simulate(prices,q['i'],'SHORT',tuple(contract))
    for name,contract in brackets.items()})
  rows.append({'t':q['time'],'symbol':'RENDERUSDT','shortSignals':short,
   'causalFeatures':q['mfeSignals'],'exitModels':exits})
 rows.sort(key=lambda x:x['t'])
 assert len(rows)>10 and all(x['t']<=min(ex['exitTs'] for ex in x['exitModels'].values()) for x in rows)
 report={'status':'RESEARCH_ONLY_RETROSPECTIVE_2026AUG22_OCT22_6SHORT_M5_BANK',
  'historicalRetrospectiveNotPristine':True,
  'inputPublisherShaVerifiedZIPs':99,
  'source':'Binance Futures RNDR/RENDER history until 2026-10-22, provider-native BTC source',
  'freshMetricsBadRows':bad,'freshMetricsValidRows':len(newmetrics),
  'validStats':dict(counts),'policyContracts':orig.EXITS,
  'events':rows,'warnings':['Already explored this date range for other models; not unbiased OOS',
   'No exchange-certified funding/partial-fill/slippage/latency',
   'Native8 full-wallet metrics excluded']}
 dest=OUT/'RENDER_ALL_SIX_SHORT_POSTAUG2026_RETROSPECTIVE_HOLDOUT_BANK_20261024.json'
 dest.write_text(json.dumps(report,ensure_ascii=False,separators=(',',':'))+'\n','utf8')
 print('SAVED',dest,'N',len(rows),'COUNTS',
  dict(collections.Counter(k for x in rows for k in x['shortSignals'])),
  'BAD_METRIC_ROWS',bad,flush=True)
if __name__=='__main__':main()
