#!/usr/bin/env python3
"""Diagnose whether extreme downtrend RENDER A entry confirmations survive
in a *different* 2024-2025 research bank. Candidate pool is 4 new independent
H1 routes, NOT original native RENDER entry family or shared-wallet replay.
No threshold chosen from post-hoc 2026 native candidate outcomes is adopted.
"""
from __future__ import annotations
import bisect,collections,datetime as dt,hashlib,json,math
from pathlib import Path
import numpy as np
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
OUT=ROOT/'docs/research/results/render-two-regime-20261024'
from importlib import util
def load(n,path):
 sp=util.spec_from_file_location(n,path)
 mod=util.module_from_spec(sp);sp.loader.exec_module(mod);return mod
m=load('extreme_prior_flow',HERE/'render-orderflow-composite-20261024.py')
p=m.e
defs={
 'A_extreme_7d_minus20_seller3_OIup':(-20,.03,0.,None),
 'A_deep_7d_minus12_seller3_OIup':(-12,.03,0.,None),
 'A_deep_7d_minus12_seller0_OIup':(-12,0.,0.,None),
 'A_extreme_minus20_seller3_rv5':(-20,.03,0.,5.),
}
def macro(r,bars,btc,oi,oti,ft,fr,cum):
 i=int(r['index']);ts=int(r['t'])
 if i<2016:return None
 R7=100*(bars[i][4]/bars[i-2016][4]-1)
 B7=100*(btc[i][4]/btc[i-2016][4]-1)
 retbtc3=100*(btc[i][4]/btc[i-36][4]-1)
 flows=m.metrics_for_event(r,oi,oti,ft,[z[1] for z in fr],bars,cum)
 if flows is None:return None
 changes=np.diff(np.log(np.array([x[4] for x in bars[i-2016:i+1]],dtype=float)))
 rv=100*float(np.std(changes))*math.sqrt(288)
 return {'BTC3':retbtc3,'RENDER7':R7,'BTC7':B7,'RV7':rv,
         'SELL1':flows['seller1'],'OI1':flows['oi1Pct'],
         'OI3':flows['oi3Pct']}
def select(rows,criteria):
 out=[];allowed=-1
 for r in rows:
  f=r['extra']
  if r['t']<allowed:continue
  minr,seller,oi,minrv=criteria
  if not (f['BTC3']<=-1.5 and f['RENDER7']<=minr and
      f['SELL1']>=seller and f['OI1']>=oi and
      (minrv is None or f['RV7']>=minrv)):
   continue
  item=dict(r);item['policy']='normal'
  out.append(item)
  allowed=int(item['exits']['normal']['exitTs'])+12*p.screen.HOUR
 return out
def summ(rows):
 return {str(cost):p.summarize(rows,cost) for cost in (10,30)}
def main():
 source=json.loads((ROOT/'docs/research/results/render-orderflow-20261024/RENDER_ORDERFLOW_SOURCE_MANIFEST_20261024.json').read_text('utf8'))
 assert all(x['expected']==x['valid'] for x in source['summary'].values())
 snapshots,quality=m.read_metrics(source['files']);oti=[z[0] for z in snapshots]
 funding=m.read_funding(source['files']); ft=[z[0] for z in funding]
 ob=m.read_render_bars(source['files'],True);nb=m.read_render_bars(source['files'],False)
 oldmani=json.loads((ROOT/'docs/research/results/idle-entry-three-20261024/IDLE_RENDER_OLDER_BINANCE_PUBLIC_M5_SOURCE_MANIFEST_20261024.json').read_text('utf8'))
 oldbtc,_=p.old_mod.parse_months(oldmani,'BTCUSDT')
 native=p.imp('extreme_retro_native',HERE/'research-residual-avax-composite-entry-veto-full8-20261023.py')
 provider,_=native.native.m.m.core.task8.legacy.bootstrap()
 newbtc,_=provider.getdata('BTCUSDT')
 old=p.prepare(ob,oldbtc,p.OLD_BEGIN,p.CAL_END,'older_extreme')
 recent=p.prepare(nb,newbtc,p.NEW_BEGIN,p.NEW_END,'newer_extreme')
 for rows,bars,btc in ((old,ob,oldbtc),(recent,nb,newbtc)):
  cum=m.history_features(bars)
  for r in rows:
   extra=macro(r,bars,btc,snapshots,oti,ft,funding,cum)
   if extra is not None:r['extra']=extra
 old_missing=sum('extra' not in z for z in old)
 recent_missing=sum('extra' not in z for z in recent)
 old=[r for r in old if 'extra' in r];recent=[r for r in recent if 'extra' in r]
 print('PREPARED',len(old),len(recent),'MISSING',old_missing,recent_missing,flush=True)
 out={'status':'DIAGNOSTIC_ONLY_DISTINCT_H1_FAMILY_NOT_NATIVE8',
   'warning':['Previously explored later period not pristine OOS','A route is not original IDLE_RENDER_RELATIVE_SHORT; no direct live/adoption inference',
    '5 native hypothetical candidates used to motivate this historical check, so thresholds are post-hoc, not validated',
    'Fee model 10bps/30bps, 5m next-bar and stop-first; excludes Aster venue life cycle, funding PnL and shared Gross'],
   'observations':{'olderCandidates':len(old),'recentCandidates':len(recent),
     'olderMissingFeatures':old_missing,'recentMissingFeatures':recent_missing},
   'methods':defs,'groups':{}}
 for name,settings in defs.items():
  oldsel=select(old,settings);newsel=select(recent,settings)
  splits={
    'oldTrain':summ([r for r in oldsel if r['t']<p.TRAIN_END]),
    'oldCal':summ([r for r in oldsel if r['t']>=p.TRAIN_END]),
    'recent':summ(newsel),
    'janMar26':summ([r for r in newsel if p.ms('2026-01-01')<=r['t']<p.ms('2026-04-01')]),
    'aprAug26':summ([r for r in newsel if p.ms('2026-04-01')<=r['t']<p.ms('2026-08-10')])}
  out['groups'][name]=splits
  print('EXTREME',name,'OLDTRAIN',splits['oldTrain']['30']['n'],splits['oldTrain']['30']['pf'],
    'OLDCAL',splits['oldCal']['30']['n'],splits['oldCal']['30']['pf'],
    'RECENT',splits['recent']['30']['n'],splits['recent']['30']['wrPct'],
    splits['recent']['30']['pf'],'JANMAR',splits['janMar26']['30']['n'],
    splits['janMar26']['30']['pf'],flush=True)
 output=OUT/'RENDER_EXTREME_TWO_REGIME_OLDER_YEAR_CAUSAL_DIAGNOSTIC_20261024.json'
 output.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
 print('OUT',output)
if __name__=='__main__':main()
