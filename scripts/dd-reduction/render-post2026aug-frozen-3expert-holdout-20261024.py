#!/usr/bin/env python3
"""FIRST post-2026-08-10 heldout diagnostic of frozen RENDER 2024 expert +
OI3 rebound expert. Fixed entry 2024 BTC rally failure or OI3<=-0.6
bear rebound, stop3% / TP4% / H24 M5 stop-first, 12h cooldown.
Source official ZIP checksums and Binance public FAPI funding; *no LIVE*.

Critical: Do not tune/review thresholds using this cohort before writing
the raw result. If it fails, mark candidate FAIL and preserve raw artifacts.
"""
from __future__ import annotations
import datetime as dt,json
from pathlib import Path
from importlib import util
ROOT=Path(__file__).resolve().parents[2]
HERE=Path(__file__).resolve().parent
OUT=ROOT/'docs/research/results/render-three-regime-20261024'
def load(n,p):
 s=util.spec_from_file_location(n,p);m=util.module_from_spec(s);s.loader.exec_module(m);return m
orig=load('heldout2026_directional',HERE/'render-2024-directional-long-short-search-20261024.py')
base=orig.b;m=orig.m;e=orig.e
scorer=load('heldout2026_scoring',HERE/'render-three-regime-preallocation-short-experts-20261024.py')
START=e.ms('2026-08-10')
MAX_DATA_END=e.ms('2026-10-23')
FIRST_AFTER=e.ms('2026-09-01')
def main():
 j=json.loads((OUT/'RENDER_POST_2026AUG_HELDOUT_PUBLIC_SOURCE_MANIFEST_20261024.json').read_text('utf8'))
 assert j['status']=='HOLDOUT_INPUTS_READY'
 assert j['staticPublisherChecksumVerified']==j['staticRequested']==99
 assert all(x['publisherChecksumMatch'] and x['zipCRC'] for x in j['files'])
 assert j['fundingOctoberPublicApi']['count']>=130
 old=json.loads((ROOT/'docs/research/results/render-orderflow-20261024/RENDER_ORDERFLOW_SOURCE_MANIFEST_20261024.json').read_text('utf8'))
 prices=m.read_render_bars(old['files'],False)
 provider=m.e.imp('heldout2026_native_prices',HERE/'research-residual-avax-composite-entry-veto-full8-20261023.py')
 source,_=provider.native.m.m.core.task8.legacy.bootstrap()
 btcOld,_=source.getdata('BTCUSDT')
 extraRender=base.bars(j['files'],'RENDERUSDT')
 extraBtc=base.bars(j['files'],'BTCUSDT')
 assert extraRender and extraBtc
 completeRender=prices+extraRender
 completeBtc=btcOld+extraBtc
 assert base.continuous(completeRender) and base.continuous(completeBtc)
 assert extraRender[0][0]==e.ms('2026-09-01')
 assert extraRender[-1][0]==e.ms('2026-10-22')+287*orig.M5
 assert extraBtc[0][0]==e.ms('2026-09-01')
 prev_metrics,prev_quality=m.read_metrics(old['files'])
 newmetrics,bad=load('heldout2026_orig_2024',HERE/'render-2024-fullyear-three-experts-20261024.py').metrics_small([x for x in j['files'] if x['kind']=='metrics'])
 metrics=sorted(prev_metrics+newmetrics)
 prevFunding=m.read_funding(old['files'])
 extraFund=load('heldout2026_reuse_funding',HERE/'render-2024-fullyear-three-experts-20261024.py').funding_small([x for x in j['files'] if x['kind']=='fundingRate'])
 apiFund=[(int(ts)+300000,float(rate)) for ts,rate in j['fundingOctoberPublicApi']['rows']]
 funding=sorted(prevFunding+extraFund+apiFund)
 assert len(newmetrics)>=10000 and len(apiFund)>=130
 print('HOLDOUT_SOURCES',len(completeRender),len(metrics),len(funding),
  'NEW_METRICS_BAD',bad,flush=True)
 print('FROZEN_RESEARCH_RULES','2024 TRAP, OI3<=-0.6, TP4-SL3-H24-12h, 10bps/30bps',flush=True)
 available,counts=orig.collect(completeRender,completeBtc,metrics,funding,
  'RENDERUSDT',MAX_DATA_END)
 targets=[]
 for q in available:
  sigs=[k for k in (scorer.TRAP,scorer.FADE) if k in q['signals']]
  if not sigs or q['time']<START:continue
  ex=orig.simulate(completeRender,q['i'],'SHORT',orig.EXITS['TAKE40_STOP30_H24'])
  targets.append({'t':q['time'],'symbol':'RENDERUSDT','signals':sigs,
    'causalFeatures':q['mfeSignals'],'exitModel30':ex})
 assert len(targets)>4,('HOLDOUT_SIGNALS_TOO_FEW',len(targets))
 targets.sort(key=lambda e:e['t'])
 report={'status':'FIRST_UNSEEN_2026_AUG_OCT_HISTORICAL_RECHECK_NOT_LIVE',
  'sources':{'manifest':j['status'],'freshZipCount':99,
   'OctoberFundingSource':'Binance official public FAPI; response SHA stored',
   'freshMetrics':len(newmetrics),'freshFunding':len(apiFund)},
  'period':{'start':START,'latestCompleteM5':extraRender[-1][0],
   'endExcluded':MAX_DATA_END,
   'lastEligibleH1EntryBefore':MAX_DATA_END-24*orig.HOUR},
  'frozenCutoffs':{
   '2024_BTC_RALLY_FAILURE':'btc1>=.28 ret3>=.7 wick>=.4 last15<=-.12 position<=.65 sell1>=.03',
   'OI3_FADE_GATE':'oi3Pct <= -0.6%',
   'exit':'SHORT TP4% SL3% max24h 12h same symbol cooldown',
   'cost':'10bps/30bps'},
  'warnings':['Validation period from 2026-08-10; inputs were not in earlier selection, but retrospective, not prospective forward shadow',
   'Study candidate-specific tick/PnL research only, not 8 strategy shared wallet or signed venue fills',
   'Market-model selection and thresholds repeatedly optimized on prior historical periods; this holdout is frozen first-look',
   'Only Binance futures proxy trades; funding settlement PnL and L2 / order fill latency excluded'],
  'candidateN':len(targets),'variants':{}}
 for case in ('A_2024_BTC_TRAP_ONLY','B_BEARFADE_OI3_LE_M0P2_ONLY',
   'B_BEARFADE_OI3_LE_M0P6_ONLY','AB_TRAP_PLUS_FADE_OI3_LE_M0P2',
   'AB_TRAP_PLUS_FADE_OI3_LE_M0P6'):
  sel=scorer.choose(targets,scorer.CONFIGS[case])
  output={
   'entireWindow':{str(c):scorer.summary(sel,c) for c in (10,30)},
   'afterSep1':{str(c):scorer.summary([z for z in sel if z['t']>=FIRST_AFTER],c) for c in (10,30)},
   'modelSelected':len(sel),
   'details':[{'t':v['t'],'symbol':v['symbol'],'expert':v['expertRoute'],
     'return30bps':round(float(v['exitModel30']['net30']),5),
     'exitTs':int(v['exitModel30']['exitTs']),
     'exitReason':v['exitModel30']['reason']} for v in sel]
  }
  report['variants'][case]=output
  print('FROZEN_HOLDOUT',case,'FULL30',output['entireWindow']['30'],
    'SEP_OCT30',output['afterSep1']['30'],flush=True)
 key='AB_TRAP_PLUS_FADE_OI3_LE_M0P6'
 d=report['variants'][key]['entireWindow']['30']
 report['frozenPrimaryStatus']='PASS_HISTORICAL_RECHECK_NOT_NATIVE8' if d['n']>=8 and (d['pf'] or 0)>1 else 'FAIL_FROZEN_FIRST_HOLDOUT_OR_TOO_FEW_TRADES'
 dst=OUT/'RENDER_POST_2026AUG_FROZEN_TRIPLE_ENTRY_HOLDOUT_FIRST_LOOK_20261024.json'
 dst.write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n',encoding='utf8')
 print('FINAL_FIRST_LOOK',report['frozenPrimaryStatus'],'FILE',dst)
if __name__=='__main__':main()
