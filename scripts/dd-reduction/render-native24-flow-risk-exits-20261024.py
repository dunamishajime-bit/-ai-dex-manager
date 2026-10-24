#!/usr/bin/env python3
"""Frozen 24 native-selected RENDER trades: as-of 2/3/4-hour flow exits.
Static attribution only, NOT full8 resimulation or live calibration.
"""
from pathlib import Path
import bisect,collections,json,statistics
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
OUT=ROOT/'docs/research/results/render-orderflow-20261024'
BASE=ROOT/'docs/research/results/idle-entry-three-20261024'
from importlib import util
def load(n,path):
 s=util.spec_from_file_location(n,path);a=util.module_from_spec(s);s.loader.exec_module(a);return a
m=load('flow_src',HERE/'render-orderflow-composite-20261024.py')
POLS={
 '2H_BUYERS_AFTER_RED':(2,.75,'buyer'),
 '2H_OI_CONTRACTION_RED':(2,1.0,'oi'),
 '2H_BOTH_BUYER_OI_RED':(2,.75,'both'),
 '3H_BOTH_BUYER_OI_RED':(3,.75,'both'),
 '4H_BOTH_BUYER_OI_RED':(4,.50,'both'),
 '2H_BUYER_OR_OI_AFTER1P0':(2,1.0,'either'),
}
def apply(trades,bars,metrics,mtimes,frates,ftimes,ftvalues,pol):
 hours,min_adverse,mode=pol
 timeind={x[0]:i for i,x in enumerate(bars)}
 cums=m.history_features(bars)
 out=[]
 for row in trades:
  t=int(row['entryTs'])
  exit_ts=int(row['exitTs'])
  entry=float(row['entryPrice'])
  original=100*(entry-float(row['exitPrice']))/entry-.3
  # stale fills or rounding compared to native reporting cause explicit failure
  signal_time=t+hours*3600000
  result={'candidateId':row['candidateId'],'original30':round(original,5),
    'originalWin':original>0,'triggered':False,'new30':round(original,5)}
  if signal_time+5*60000>=exit_ts or signal_time not in timeind:
   out.append(result);continue
  idx=timeind[signal_time]-1
  f=m.metrics_for_event({'index':idx,'t':signal_time},metrics,mtimes,ftimes,ftvalues,bars,cums)
  assert f is not None,('MISSING_CAUSAL_FEATURES',row['candidateId'])
  current=float(bars[idx][4])
  adverse=100*(current/entry-1)
  buyer=f['seller1']<0
  oi_contract=f['oi1Pct']<0
  extra={'buyer':buyer,'oi':oi_contract,'both':buyer and oi_contract,'either':buyer or oi_contract}[mode]
  # SHORT adverse price is positive: only allow early-loss-risk cut.
  if adverse>=min_adverse and extra:
   fillidx=timeind[signal_time]+1
   fill=float(bars[fillidx][1])
   new30=100*(entry-fill)/entry-.3
   result.update({'triggered':True,'signalTime':signal_time,'fillTime':bars[fillidx][0],
    'earlyAdversePct':round(adverse,4),'seller1':round(f['seller1'],4),
    'oi1Pct':round(f['oi1Pct'],4),'new30':round(new30,5),
    'savedPct':round(new30-original,5)})
  out.append(result)
 return out
def summary(rows):
 changed=[r for r in rows if r['triggered']]
 return {'n':len(rows),'triggered':len(changed),'triggeredWasWinner':sum(r['originalWin'] for r in changed),
   'triggeredWasLoser':sum(not r['originalWin'] for r in changed),
   'baselineNetPctSum':round(sum(r['original30'] for r in rows),3),
   'alternativeNetPctSum':round(sum(r['new30'] for r in rows),3),
   'deltaPctSum':round(sum(r['new30']-r['original30'] for r in rows),3),
   'baselineWins':sum(r['original30']>0 for r in rows),
   'alternativeWins':sum(r['new30']>0 for r in rows),
   'worstBaselinePct':round(min(r['original30'] for r in rows),3),
   'worstAlternativePct':round(min(r['new30'] for r in rows),3),
   'trades':changed}
def main():
 manifest=json.loads((OUT/'RENDER_ORDERFLOW_SOURCE_MANIFEST_20261024.json').read_text('utf8'))
 data=manifest['files']
 met,quality=m.read_metrics(data);mtimes=[s[0] for s in met]
 fund=m.read_funding(data);ftimes=[s[0] for s in fund];rates=[s[1] for s in fund]
 bars=m.read_render_bars(data,False)
 earlier=json.loads((BASE/'IDLE_RENDER_DOT_JUP_INITIAL_ADVERSE_ENTRY_PATH_20261024.json').read_text('utf8'))
 rows=earlier['costs']['30']['symbols']['RENDERUSDT']['allTradeFeatures']
 assert len(rows)==24
 latest=json.loads((OUT/'RENDER_NATIVE_SELECTED24_OI_FLOW_ATTRIBUTION_20261024.json').read_text('utf8'))['selectedTrades']
 paths1={r['entryTs'] for r in rows};paths2={r['ts'] for r in latest}
 by_t={r['ts']:r for r in latest}
 compare=[(r,by_t[r['entryTs']]) for r in rows if r['entryTs'] in by_t]
 max_err=max(abs((100*(r['entryPrice']-r['exitPrice'])/r['entryPrice']-.30)-z['return30']) for r,z in compare)
 same_exit=sum(r['exitReason']==z['exitReason'] for r,z in compare)
 same_id=sum(r['candidateId']==z['candidateId'] for r,z in compare)
 cohort={'source':'IDLE_RENDER_DOT_JUP_INITIAL_ADVERSE_ENTRY_PATH_20261024.json',
         'matchedEntryTimestamps':len(paths1&paths2),
         'sourceEntries':len(rows),'otherNativeScreenEntries':len(latest),
         'exactCohortParity':paths1==paths2,
         'matchingExitReasons':same_exit,
         'matchingCandidateIds':same_id,
         'maxAbsReturn30DifferencePct':max_err,
         'exactEconomicCohortParity':paths1==paths2 and same_exit==24 and max_err<1e-10}
 assert cohort['exactEconomicCohortParity'],cohort
 result={'status':'DIAGNOSTIC_FROZEN24_SAME_ECONOMIC_COHORT_NOT_NATIVE_REALLOCATOR_BT',
    'sourceCohortComparison':cohort,
    'caveats':['Hindsight 24 trades; original 8-strategy availability and dynamic account wallet not replayed',
    'Changes exit timestamp, so actual portfolio impact unknown until common-wallet re-selection',
    'Original cost modeled 30bps, no venue slippage or funding.'],
    'cases':{}}
 for k,pol in POLS.items():
  z=apply(rows,bars,met,mtimes,fund,ftimes,rates,pol)
  result['cases'][k]=summary(z)
  x=result['cases'][k]
  print('RISKCASE',k,'CHANGED',x['triggered'],
   'WINS_DROPPED',x['triggeredWasWinner'],'LOSSES_CUT',x['triggeredWasLoser'],
   'DELTA30_PCTSUM',x['deltaPctSum'],'ALT_WINS',x['alternativeWins'],flush=True)
 f=OUT/'RENDER_NATIVE24_FLOW_EXIT_RISK_DIAGNOSTIC_20261024.json'
 f.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
 print('DIAGNOSTIC_SAVED',f,flush=True)
if __name__=='__main__':main()
