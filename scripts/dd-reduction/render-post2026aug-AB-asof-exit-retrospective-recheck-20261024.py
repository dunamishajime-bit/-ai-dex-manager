#!/usr/bin/env python3
"""Retrospective reuse diagnostic of 2026 Aug-Oct 99 ZIPs for predeclared
as-of market regime exit switch. This period was examined for earlier exits,
so is NOT untouched OOS for this new gate, nor a real forward trade.
Research only. Base A and B signals fixed; same causal M5 price model.
"""
from __future__ import annotations
from pathlib import Path
from importlib import util
import collections,json,math
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
OUT=ROOT/'docs/research/results/render-three-regime-20261024'
def load(name,path):
 s=util.spec_from_file_location(name,path);m=util.module_from_spec(s);s.loader.exec_module(m);return m
hold=load('postAug_old_data_loader',HERE/'render-post2026aug-frozen-3expert-holdout-20261024.py')
orig=hold.orig;m=hold.m;e=hold.e;base=hold.base;scorer=hold.scorer
THRESHOLDS=(.10,.133,.15,.20)
BASEA='TRAIL_MFE15_FLOOR05_H18'
BASEB='TRAIL_MFE25_FLOOR10_H24'
ALT='TAKE15_STOP20_H6'
def run():
 manifest=json.loads((OUT/'RENDER_POST_2026AUG_HELDOUT_PUBLIC_SOURCE_MANIFEST_20261024.json').read_text('utf8'))
 assert manifest['status']=='HOLDOUT_INPUTS_READY' and manifest['staticPublisherChecksumVerified']==99
 assert all(x['publisherChecksumMatch'] and x['zipCRC'] for x in manifest['files'])
 old=json.loads((ROOT/'docs/research/results/render-orderflow-20261024/RENDER_ORDERFLOW_SOURCE_MANIFEST_20261024.json').read_text('utf8'))
 prices=m.read_render_bars(old['files'],False)
 provider=m.e.imp('r2026h2_provider_venue_20261024',HERE/'research-residual-avax-composite-entry-veto-full8-20261023.py')
 source,_=provider.native.m.m.core.task8.legacy.bootstrap()
 btcold,_=source.getdata('BTCUSDT')
 extraRender=base.bars(manifest['files'],'RENDERUSDT')
 extraBTC=base.bars(manifest['files'],'BTCUSDT')
 prices=prices+extraRender;btc=btcold+extraBTC
 assert base.continuous(prices) and base.continuous(btc)
 older_metrics,_=m.read_metrics(old['files'])
 freshMetrics,bad=load('r2026h2_metrics_source',HERE/'render-2024-fullyear-three-experts-20261024.py').metrics_small(
  [x for x in manifest['files'] if x['kind']=='metrics'])
 metrics=sorted(older_metrics+freshMetrics)
 olderFunding=m.read_funding(old['files'])
 freshFunding=load('r2026h2_funding_source',HERE/'render-2024-fullyear-three-experts-20261024.py').funding_small(
  [x for x in manifest['files'] if x['kind']=='fundingRate'])
 apiFund=[(int(ts)+300000,float(rate)) for ts,rate in manifest['fundingOctoberPublicApi']['rows']]
 funding=sorted(olderFunding+freshFunding+apiFund)
 print('DATA_QC', 'metrics',len(metrics),'freshMetricsBad',bad,'funding',len(funding),flush=True)
 assert len(metrics)>10000 and len(funding)>500
 available,_=orig.collect(prices,btc,metrics,funding,'RENDERUSDT',hold.MAX_DATA_END)
 targets=[]
 for q in available:
  if q['time']<hold.START or q['time']>hold.MAX_DATA_END-24*orig.HOUR:continue
  if not any(v in q['signals'] for v in (scorer.TRAP,scorer.FADE)):continue
  exits={k:orig.simulate(prices,q['i'],'SHORT',orig.EXITS[k]) for k in
    (BASEA,BASEB,ALT,'TAKE40_STOP30_H24')}
  targets.append({'t':q['time'],'symbol':'RENDERUSDT',
   'signals':[s for s in (scorer.TRAP,scorer.FADE) if s in q['signals']],
   'f':q['mfeSignals'],'exits':exits})
 targets.sort(key=lambda x:x['t'])
 print('NEW_WINDOW_SIGNALS',len(targets),'WINDOW',hold.START,hold.MAX_DATA_END,flush=True)
 def trade_set(mode,threshold=None):
  out=[];free=0
  for q in targets:
   t=q['t'];f=q['f']
   if t<free:continue
   if scorer.TRAP in q['signals']:
    model='A';route=BASEA if mode!='LEGACY' else 'TAKE40_STOP30_H24'
   elif scorer.FADE in q['signals'] and f['oi3Pct']<=-.2:
    model='B'
    if mode=='LEGACY':route='TAKE40_STOP30_H24'
    elif mode=='ALWAYS_FLOOR':route=BASEB
    else:route=ALT if float(f['rangePos1'])>=threshold else BASEB
   else:continue
   ex=q['exits'][route]
   out.append({'t':t,'expert':model,'policy':route,'exit':ex,
    'entryRangePosition':f['rangePos1'],'oi3':f['oi3Pct']})
   free=int(ex['exitTs'])+12*orig.HOUR
  return out
 def stats(items,cost):
  p=[float(x['exit']['net30'])+(.3-cost/100) for x in items]
  w=[z for z in p if z>0];loss=[z for z in p if z<=0]
  return {'n':len(items),'wins':len(w),'wrPct':round(len(w)/len(p)*100,2) if p else None,
   'pf':round(sum(w)/-sum(loss),4) if loss else None,
   'sumPct':round(sum(p),4),'byExpert':dict(collections.Counter(x['expert'] for x in items))}
 reports={}
 for name,cutoff in [('LEGACY',None),('ALWAYS_FLOOR',None),*
   [('ASOF_RANGE_GE_'+str(x).replace('.','P'),x) for x in THRESHOLDS]]:
  trade=trade_set(name,cutoff)
  reports[name]={'cutoff':cutoff,
   'all':{str(cost):stats(trade,cost) for cost in (10,30)},
   'sepOct':{str(cost):stats([x for x in trade if x['t']>=hold.FIRST_AFTER],cost) for cost in (10,30)},
   'events':[{'t':x['t'],'expert':x['expert'],'policy':x['policy'],
     'exitTs':x['exit']['exitTs'],'net30Pct':x['exit']['net30'],
     'oi3':x['oi3'],'hourRangePosition':x['entryRangePosition']} for x in trade]}
  print('HOLDOUT_REUSE',name,'30BPS',reports[name]['all']['30'],flush=True)
 final={'status':'RESEARCH_ONLY_PREVIEWED_HOLDOUT_REUSE_IS_NOT_INDEPENDENT',
  'verification':'Publisher SHA verified 99 ZIPs, source continuity and no fill beyond complete M5 evidence',
  'period':{'from':'2026-08-10','until':'2026-10-22 complete'},
  'rules':'BTC TRAP A trailing15 flo05 18h; OI3 fade<=-0.2 B rangePos1 threshold then take15 stop20 6h else trailing25 flo10 H24; 12h cooldown',
  'results':reports,
  'warnings':['User period previously used for another model first-look; this is not a pristine holdout or forward trading.',
   '2025-H2 reused during hyperparameter discovery; multiple testing heavily biased.',
   'This is stand-alone SHORT sleeve only, not Native8 portfolio, not exchange certified',
   'LIVE/HP/Production/real trades not changed']}
 dst=OUT/'RENDER_2026AUG_OCT_ASOF_EXIT_REGIME_RETROSPECTIVE_RECHECK_20261024.json'
 dst.write_text(json.dumps(final,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
 print('FINISHED',dst,flush=True)
if __name__=='__main__':run()
