#!/usr/bin/env python3
"""Compare baseline, high-WR S6 and independent max55 M5 exit Native8 triplicates.
Fail closed on missing economic ledgers/accounting; isolate route-vs-slot opportunity
cost, with source hash evidence. Research only, no production modifications.
"""
from __future__ import annotations
import collections,hashlib,json
from pathlib import Path
ROOT=Path('C:/tmp')
BRANCH=ROOT/'render4427-independent-gates-audit-20261024'
DEST=BRANCH/'docs/research/results/render4427-scoped-priority-native8-20261024'
SOURCES={
'baseline':ROOT/'r4427cx',
'highwr_s6_original_exit':ROOT/'r4427hwr1',
'highwr_s6_max55m':ROOT/'r4427hw55'
}
ROUTE='IDLE_RENDER_INDEPENDENT_HIGHWR_WICK_SHARP_S6_SHORT'
def load_run(root,cost):
 ps=sorted(p for p in root.rglob('result.json') if p.parent.name==str(cost)+'bps' and p.parent.parent.name.startswith('cmp_'))
 assert len(ps)==3,('NEED_THREE_REPEATS',root,cost,[str(p) for p in ps])
 runs=[]
 for path in ps:
  metric=json.loads(path.read_text('utf8'))
  ledger=path.parent/'cases'/'V2_M150_D05_CORE_NATIVE'/'runs'/('PRICE_MODEL_'+str(cost)+'BPS')/'portfolio-trades.jsonl'
  assert ledger.is_file()
  trades=[json.loads(row) for row in ledger.read_text('utf8').splitlines() if row.strip()]
  assert len(trades)==metric['closed_trades']
  assert metric['accounting']=='PASS'
  short_metrics={k:metric[k] for k in ('final_equity_jpy','profit_factor','maximum_mtm_drawdown_pct','closed_trades','accounting')}
  canon=[{k:v for k,v in r.items() if k!='candidate_id'} for r in trades]
  h=hashlib.sha256(json.dumps(canon,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode('utf8')).hexdigest()
  runs.append({'metric':short_metrics,'rows':trades,'sha':h,'file':str(ledger)})
 metrics={json.dumps(z['metric'],sort_keys=True) for z in runs}
 assert len(metrics)==1,('METRIC_NONDETERMINISTIC',root,cost)
 # The economics and all trade details except synthesized candidate id are equal.
 assert len({x['sha'] for x in runs})==1,('TRADE_CONTENT_DIFFERENCE',root,cost)
 return runs[0],{'tripleSame':True,'canonicalEconomicSha256':runs[0]['sha'],'metrics':runs[0]['metric'],
                 'triplicateLedgerPaths':[x['file'] for x in runs]}
def key(r):
 return (r.get('strategy_id'),r.get('symbol'),r.get('side'),r.get('route'),int(r['entry_ts_ms']))
def describe(r):
 return {'strategy':r['strategy_id'],'symbol':r['symbol'],'side':r['side'],
  'route':r.get('route'),'entryTs':r['entry_ts_ms'],'exitTs':r['exit_ts_ms'],
  'pnlJpyAtExitFx':r.get('modeled_realized_pnl_jpy_at_exit_fx'),
  'feeIncludedPnlUsd':r.get('total_pnl_jpy'),'acceptedGross':r.get('accepted_gross'),
  'researchHistoricalFillVerified':r.get('historical_fill_verified')}
out={'status':'RESEARCH_ONLY_HIGHWR_OWNER_SLOT_AND_TIME55_NATIVE8_AUDIT','dateJST':'2026-10-25',
 'period':'2025-08-10_2026-08-10','sourceRoots':{k:str(v) for k,v in SOURCES.items()},
 'testedCostsBps':[10,30],'cases':{},
 'limitations':['All dates have already been seen; native8 portfolio is non-pristine in-sample replay',
  'Time55 intervention chosen specifically after observed original May28 TAO profitable displacement: material ex-post bias',
  'Native filling uses modeled H1 prices and Binance M5 exits; no signed venue fill/partial/stop parity',
  'New route is modeled as IDLE; true independent owner/slot not yet implemented',
  'LIVE, VPS, Production, HP, actual orders untouched']}
for cost in (10,30):
 cohort={}
 for name,root in SOURCES.items():
  cohort[name]=load_run(root,cost)
 baseline=cohort['baseline'][0]; baseline_m=cohort['baseline'][1]['metrics']
 reference=collections.Counter(key(r) for r in baseline['rows'])
 names={}
 for label,(run,meta) in cohort.items():
  m=meta['metrics']
  local=collections.Counter(key(r) for r in run['rows'])
  base_index={key(r):r for r in baseline['rows']}
  now_index={key(r):r for r in run['rows']}
  added=[describe(now_index[k]) for k in (local-reference).elements()]
  displaced=[describe(base_index[k]) for k in (reference-local).elements()]
  route_trades=[describe(r) for r in run['rows'] if r.get('route')==ROUTE]
  names[label]={**meta,'finalEquityVsBaselineJpy':m['final_equity_jpy']-baseline_m['final_equity_jpy'],
   'pfVsBaseline':m['profit_factor']-baseline_m['profit_factor'],
   'ddPctPointsVsBaseline':m['maximum_mtm_drawdown_pct']-baseline_m['maximum_mtm_drawdown_pct'],
   'tradeDelta':m['closed_trades']-baseline_m['closed_trades'],
   'newIndependentFilledN':len(route_trades),
   'newIndependentWinsN':sum(r['feeIncludedPnlUsd']>0 for r in route_trades),
   'newIndependentRealizedPnlJpyAtExitFx':sum(r['pnlJpyAtExitFx'] for r in route_trades),
   'addedTradeDiff':added,'baselineTradeDisplacements':displaced,
   'newRouteAcceptedTrades':route_trades}
 print('AUDITED_NATIVE8',cost,label,'FINAL',round(m['final_equity_jpy'],3),
   'DELTA',round(names[label]['finalEquityVsBaselineJpy'],3),
   'N',m['closed_trades'],'DD',m['maximum_mtm_drawdown_pct'],
   'NNEW',len(route_trades),'WINS',names[label]['newIndependentWinsN'],
   'DISPLACED',len(displaced),flush=True)
 out['cases'][str(cost)]=names
OUT=DEST/'RENDER_4427_HIGHWR_S6_55MIN_NATIVE8_OWNER_OPPORTUNITY_COST_AUDIT_20261025.json'
DEST.mkdir(parents=True,exist_ok=True)
OUT.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print('AUDIT_COMPLETE',OUT,flush=True)
