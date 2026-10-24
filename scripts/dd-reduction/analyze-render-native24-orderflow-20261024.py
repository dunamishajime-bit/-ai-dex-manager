#!/usr/bin/env python3
"""Attribute already-selected RENDER native full8 H1 trades to AS-OF market
microstructure. Diagnostic only: DO NOT select filters based on these outcomes.
"""
import bisect,collections,datetime as dt,json,math,statistics
from pathlib import Path
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
OUT=ROOT/'docs/research/results/render-orderflow-20261024'
SRC=ROOT/'docs/research/results/idle-entry-three-20261024'
from importlib import util
sp=util.spec_from_file_location('source_orderflow',HERE/'render-orderflow-composite-20261024.py')
m=util.module_from_spec(sp);sp.loader.exec_module(m)
def median(vals):
 return round(statistics.median(vals),3) if vals else None
def summ(rows):
 vals=[x['return30'] for x in rows]
 return {'n':len(vals),'wins':sum(z>0 for z in vals),
   'wrPct':round(100*sum(z>0 for z in vals)/len(vals),2) if vals else None,
   'sumReturnPct':round(sum(vals),3),
   'medianOI1Pct':median([r['flow']['oi1Pct'] for r in rows]),
   'medianOI3Pct':median([r['flow']['oi3Pct'] for r in rows]),
   'medianSeller1':median([r['flow']['seller1'] for r in rows]),
   'medianSeller3':median([r['flow']['seller3'] for r in rows]),
   'medianFundingBps':median([r['flow']['fundingBps'] for r in rows]),
   'lossTimeExit':sum(r['exitReason']=='TIME_EXIT' and r['return30']<=0 for r in rows),
   'medianLossPct':median([r['return30'] for r in rows if r['return30']<=0])}
def main():
 mani=json.loads((OUT/'RENDER_ORDERFLOW_SOURCE_MANIFEST_20261024.json').read_text('utf8'))
 met,quality=m.read_metrics(mani['files'])
 mt=[x[0] for x in met]
 fr=m.read_funding(mani['files']); ft=[x[0] for x in fr];rates=[x[1] for x in fr]
 bars=m.read_render_bars(mani['files'],False);times=[x[0] for x in bars]
 cumul=m.history_features(bars)
 base=json.loads((SRC/'IDLE_RENDER_REBOUND_FADE_PREALLOCATION_SCREEN_20261024.json').read_text('utf8'))
 selected=[z for z in base['costs']['30']['candidateDetail'] if z['selected']]
 rows=[]
 for z in selected:
  j=bisect.bisect_left(times,int(z['ts']))-1
  assert j>=72 and times[j]+m.MIN5==z['ts'],('SELECTED_ENTRY_MISSING_M5',z['id'],z['ts'])
  f=m.metrics_for_event({'index':j,'t':z['ts']},met,mt,ft,rates,bars,cumul)
  assert f is not None,('MISSING_CAUSAL_METRIC',z['id'])
  rows.append({'candidateId':z['id'],'ts':z['ts'],
    'date':dt.datetime.fromtimestamp(z['ts']/1000,dt.timezone.utc).strftime('%Y-%m-%d %H:%M'),
    'return30':z['ret'],'win30':z['win'],'exitReason':z['exitReason'],
    'baseFeature':z['features'],'flow':f})
 assert len(rows)==24
 out={'status':'POST_HOC_24_SELECTED_NATIVE_FULL8_ENTRY_DIAGNOSTIC_NO_VETO_ALLOWED',
 'warning':'Selected sample is small and previously researched; causal features valid but outcome-based gates would be hindsight-overfit',
 'all':summ(rows),
 'periods':{'JAN_MAR_2026':summ([r for r in rows if '2026-01'<=r['date'][:7]<='2026-03']),
   'APR_AUG_2026':summ([r for r in rows if '2026-04'<=r['date'][:7]<='2026-08'])},
 'entryGroups':{},'exitGroups':{},'selectedTrades':rows}
 groups={
  'oi_up_sellers':lambda x:x['flow']['oi1Pct']>0 and x['flow']['seller1']>0,
  'oi_up_buyers':lambda x:x['flow']['oi1Pct']>0 and x['flow']['seller1']<=0,
  'oi_down_sellers':lambda x:x['flow']['oi1Pct']<=0 and x['flow']['seller1']>0,
  'oi_down_buyers':lambda x:x['flow']['oi1Pct']<=0 and x['flow']['seller1']<=0,
  'oi_3h_expanding':lambda x:x['flow']['oi3Pct']>0,
  'oi_3h_contracting':lambda x:x['flow']['oi3Pct']<=0,
 }
 for k,f in groups.items():out['entryGroups'][k]=summ([z for z in rows if f(z)])
 for k in sorted({x['exitReason'] for x in rows}):
  out['exitGroups'][k]=summ([x for x in rows if x['exitReason']==k])
 out['winCohort']=summ([z for z in rows if z['win30']])
 out['lossCohort']=summ([z for z in rows if not z['win30']])
 file=OUT/'RENDER_NATIVE_SELECTED24_OI_FLOW_ATTRIBUTION_20261024.json'
 file.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
 print('NATIVE24',out['all'])
 print('PERIODS',out['periods'])
 print('ENTRY_GROUPS',out['entryGroups'])
 print('EXIT_GROUPS',out['exitGroups'])
 print('WIN_CONTRAST',out['winCohort'],'LOSS_CONTRAST',out['lossCohort'])
 print('OUTPUT',file)
if __name__=='__main__':main()
