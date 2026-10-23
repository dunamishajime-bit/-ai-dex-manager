#!/usr/bin/env python3
"""RESEARCH ONLY: assess accepted RENDER/DOT/JUP short loss lifecycle on completed M5.
Future highs/lows used for outcome decomposition ONLY, NEVER for entrance eligibility.
Uses the completed COMBO_KEEP90 native full8 dynamic allocator ledger.
"""
from __future__ import annotations
import bisect,collections,hashlib,importlib.util,json,math,statistics
from pathlib import Path
HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
ROOT=Path('C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/2026-10-22_hype_entry_plus_exit_full8')
HERE_REPORT=REPO/'docs/research/results/idle-entry-three-20261024'
CASE='COMBO_KEEP90'
def load(name,p):
 spec=importlib.util.spec_from_file_location(name,p)
 m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
native=load('idle_loss_source_ref',HERE/'research-residual-avax-composite-entry-veto-full8-20261023.py')
features=load('idle_loss_entry_features',HERE/'screen-idle-five-symbol-entry-caused-20261022.py')
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1<<20),b''):h.update(b)
 return h.hexdigest()
def ledger(cost):
 root=ROOT/'rv24IdleEntryComboKeep90'
 j=json.loads((root/'PENGU_TIMED_NEGATIVE_NATIVE_FULL8_20261023.json').read_text('utf8'))
 wanted=j['cases'][CASE]['costs'][str(cost)]['ledgerSha256']
 for p in (root/'engine').rglob('portfolio-trades.jsonl'):
  if sha(p)==wanted:return p
 raise RuntimeError(('LEDGER_INVALID',wanted))
def median(z):
 return round(statistics.median(z),4) if z else None
def profile(records):
 return {'n':len(records),'wins':sum(x['win'] for x in records),
   'medBTC3h':median([x['features']['btc3h'] for x in records]),
   'medSym3h':median([x['features']['ret3h'] for x in records]),
   'medRel3h':median([x['features']['rel3h'] for x in records]),
   'medATR3h':median([x['features']['atr3h'] for x in records]),
   'medVolumeRatio':median([x['features']['volratio'] for x in records]),
   'medMFE':median([x['mfePct'] for x in records]),
   'medMAE':median([x['maePct'] for x in records])}
def main():
 source,_=native.native.m.m.core.task8.legacy.bootstrap()
 report={'status':'RESEARCH_ONLY_COMPLETED_M5_OUTCOME_DECOMPOSITION','period':'2025-08-10..2026-08-10',
  'note':'MFE/MAE and exit reasons are EX-POST outcomes; cannot be used as entry-time predictor.',
  'costs':{}}
 for cost in (10,30):
  p=ledger(cost)
  trades=[json.loads(x) for x in p.read_text('utf8').splitlines() if x.strip()]
  report['costs'][str(cost)]={'ledgerSha256':sha(p),'symbols':{}}
  for sym in ('RENDERUSDT','DOTUSDT','JUPUSDT'):
   arr=[x for x in trades if x['strategy_id']=='IDLE' and x['side']=='SHORT' and x['symbol']==sym]
   bars,times=source.getdata(sym);rows=[]
   for rec in arr:
    ts=int(rec['entry_ts_ms']);et=int(rec['exit_ts_ms'])
    i=bisect.bisect_left(times,ts);end=bisect.bisect_left(times,et)
    assert i<end and end<=len(bars),(sym,ts,et)
    entry=float(rec['entry_price'])
    anchor=float(bars[i][1])
    assert entry>0 and anchor>0
    # Native price may include venue basis: scale raw bars to native modeled entry, as current overlay does.
    scale=entry/anchor
    mfe=max(100*(entry-float(bars[k][3])*scale)/entry for k in range(i,end))
    mae=max(100*(float(bars[k][2])*scale-entry)/entry for k in range(i,end))
    first1=min(end,i+12);first2=min(end,i+24)
    adverse1=max(100*(float(bars[k][2])*scale-entry)/entry for k in range(i,first1))
    adverse2=max(100*(float(bars[k][2])*scale-entry)/entry for k in range(i,first2))
    good1=max(100*(entry-float(bars[k][3])*scale)/entry for k in range(i,first1))
    observed=features.get_feat(source,sym,ts)
    assert observed is not None
    win=float(rec['total_pnl_jpy'])>0
    row={'candidateId':rec['candidate_id'],'entryTs':ts,'exitTs':et,
       'holdHours':round((et-ts)/3600000,4),'win':win,'entryPrice':entry,
       'exitPrice':float(rec['exit_price']),
       'modeledPnlJpy':float(rec['modeled_realized_pnl_jpy_at_exit_fx']),
       'pnlFromPricePct':round(100*(entry-float(rec['exit_price']))/entry,4),
       'mfePct':round(mfe,4),'maePct':round(mae,4),
       'maeFirst1hPct':round(adverse1,4),'maeFirst2hPct':round(adverse2,4),
       'mfeFirst1hPct':round(good1,4),'exitReason':rec.get('exit_reason_actual'),
       'features':{k:round(observed[k],5) if observed[k] is not None else None for k in (
       'ret1h','ret3h','ret6h','btc1h','btc3h','btc6h','rel3h','rel6h','atr3h','volratio','rangepos3h')}}
    rows.append(row)
   wins=[x for x in rows if x['win']];losers=[x for x in rows if not x['win']]
   byReason={reason:{'count':len([x for x in rows if x['exitReason']==reason]),
      'losers':len([x for x in losers if x['exitReason']==reason])}
      for reason in sorted(set(x['exitReason'] for x in rows))}
   report['costs'][str(cost)]['symbols'][sym]={
    'all':profile(rows),'winners':profile(wins),'losers':profile(losers),
    'immediateBad1hCount':sum(x['maeFirst1hPct']>=2 for x in losers),
    'immediateBad2hCount':sum(x['maeFirst2hPct']>=3 for x in losers),
    'initialNeverMfe1Count':sum(x['mfePct']<1 for x in losers),
    'profitableMfe3ThenLostCount':sum(x['mfePct']>=3 for x in losers),
    'reasonBreakdown':byReason,
    'ret3hThresholdScreen':{str(threshold):{'n':len(keep),'wins':sum(x['win'] for x in keep),
      'losses':sum(not x['win'] for x in keep),'retainedPercent':round(100*len(keep)/len(rows),3) if rows else 0,
      'cutWins':sum(x['win'] for x in rows if x not in keep),'cutLosses':sum(not x['win'] for x in rows if x not in keep)}
      for threshold in (-2,-1.5,-1,-.5,0,.5,1)
      for keep in [[x for x in rows if x['features']['ret3h']>=threshold]]},
    'allTradeFeatures':rows,
    'lossSamples':sorted(losers,key=lambda x:x['pnlFromPricePct'])[:20]}
   print('COST',cost,'SYMBOL',sym,'ALL',len(rows),'WINS',len(wins),'LOSSES',len(losers),
     'INIT_MFE_LT1',sum(x['mfePct']<1 for x in losers),'LOSS_HAD_MFE3',sum(x['mfePct']>=3 for x in losers),
     '1H_MAE2',sum(x['maeFirst1hPct']>=2 for x in losers),'PREP',profile(losers),flush=True)
 out=HERE_REPORT/'IDLE_RENDER_DOT_JUP_INITIAL_ADVERSE_ENTRY_PATH_20261024.json'
 out.write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n',encoding='utf8',newline='\n')
 print('AUDIT_FILE',out,out.stat().st_size,flush=True)
if __name__=='__main__':main()
