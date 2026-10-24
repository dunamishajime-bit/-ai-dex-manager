#!/usr/bin/env python3
"""RESEARCH ONLY: Audit existing 0/60/120 additional slippage Native8 studies."""
from __future__ import annotations
import collections,hashlib,json,datetime
from pathlib import Path
ROOT=Path('C:/tmp')
BRANCH=ROOT/'render4427-independent-gates-audit-20261024'
DEST=BRANCH/'docs/research/results/render4427-scoped-priority-native8-20261024'
MODEL='RENDER_4427_INDEPENDENT_ASOF_SELL55_NATIVE8_20261024'
ROUTE='IDLE_RENDER_IND_BTC_DIVERGENCE_SELL55_SHORT'
ROOTS={'baseline':ROOT/'r4427cx','newNoExtraSlippage':ROOT/'r4427c3',
    'newExtra60Bps':ROOT/'r4427s60','newExtra120Bps':ROOT/'r4427s120'}
def canonical_hash(p):
 arr=[]
 for line in p.read_text('utf8').splitlines():
  if not line.strip():continue
  obj=json.loads(line);obj.pop('candidate_id',None);arr.append(obj)
 return hashlib.sha256(json.dumps(arr,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode('utf8')).hexdigest()
def read_run(root,cost):
 paths=sorted(p for p in root.rglob('result.json') if p.parent.name==str(cost)+'bps' and p.parent.parent.name.startswith('cmp_'))
 assert len(paths)==3,(root,cost,len(paths))
 out=[]
 for p in paths:
  metric=json.loads(p.read_text('utf8'))
  ledger=p.parent/'cases'/'V2_M150_D05_CORE_NATIVE'/'runs'/('PRICE_MODEL_'+str(cost)+'BPS')/'portfolio-trades.jsonl'
  assert ledger.is_file()
  lines=[json.loads(x) for x in ledger.read_text('utf8').splitlines() if x.strip()]
  assert metric['accounting']=='PASS'
  accepted=[x for x in lines if x.get('route')==ROUTE]
  out.append({'metric':{k:metric[k] for k in ('final_equity_jpy','profit_factor','maximum_mtm_drawdown_pct','closed_trades','accounting')},
    'canonHash':canonical_hash(ledger),'rows':lines,'accepted':accepted})
 return out
data={'status':'RESEARCH_ONLY_MODEL_COST_STRESS_REPRODUCED','dateJST':'2026-10-24',
      'period':'2025-08-10–2026-08-10','nativeRuns':{},'modelOnly':True,
      'venueCertified':False,'prodEdited':False,'costs':{}}
for cost in (10,30):
 cases={}
 for label,root in ROOTS.items():
  triple=read_run(root,cost)
  metrics=[r['metric'] for r in triple]
  assert all(z==metrics[0] for z in metrics)
  hashes=[x['canonHash'] for x in triple]
  assert len(set(hashes))==1,(label,cost,'NON_DETERMINISTIC_ECONOMIC_LEDGER')
  cases[label]={'metrics':metrics[0],'economicLedgerSha256':hashes[0],
      'tripleEconomicMatch':True,'independentAcceptedCount':len(triple[0]['accepted'])}
  assert len(triple[0]['accepted'])==(0 if label=='baseline' else 2)
  if label=='baseline':baseline_rows=triple[0]['rows']
  else:
   def cohort(rows):
    return collections.Counter((r['strategy_id'],r['symbol'],r['side'],int(r['entry_ts_ms']),str(r.get('route'))) for r in rows if r.get('route')!=ROUTE)
   displaced=list((cohort(baseline_rows)-cohort(triple[0]['rows'])).elements())
   assert not displaced,('COHORT_DISPLACED',label,cost,displaced[:5])
   cases[label]['existingTradesDisplaced']=len(displaced)
   group=triple[0]['accepted']
   for a in group:
    assert not any(b is not a and b['symbol']==a['symbol'] and int(b['entry_ts_ms'])<int(a['exit_ts_ms']) and int(b['exit_ts_ms'])>int(a['entry_ts_ms']) for b in triple[0]['rows'])
 base=cases['baseline']['metrics']
 for label,x in cases.items():
  m=x['metrics']
  x['vsBaseline']={'finalEquityDeltaJpy':m['final_equity_jpy']-base['final_equity_jpy'],
                   'pfDelta':m['profit_factor']-base['profit_factor'],
                   'ddDeltaPp':m['maximum_mtm_drawdown_pct']-base['maximum_mtm_drawdown_pct'],
                   'closedTradesDelta':m['closed_trades']-base['closed_trades']}
  assert x['vsBaseline']['ddDeltaPp']>=-1e-10
 data['costs'][str(cost)]=cases
assert data['costs']['30']['newExtra120Bps']['vsBaseline']['finalEquityDeltaJpy']<0
assert data['costs']['30']['newNoExtraSlippage']['vsBaseline']['finalEquityDeltaJpy']>0
sens=json.loads((DEST/'RENDER_4427_SELLER_THRESHOLD_TEMPORAL_SENSITIVITY_20261024.json').read_text('utf8'))
data['sourceScreenSensitivitySha256']=hashlib.sha256((DEST/'RENDER_4427_SELLER_THRESHOLD_TEMPORAL_SENSITIVITY_20261024.json').read_bytes()).hexdigest()
data['sensitivityPassThresholds']=[x['sellPctMinimum'] for x in sens['cases'] if x['nondegradationAllFiveBothCosts']]
data['warnings']=['No venue/L2 fill certification; H1 native replay and Binance-modeled new exit',
 'Thresholds fit on previously inspected historical periods; no untouched OOS',
 'Only two new accepted fills; 2025 Sep additional candidates lack Aster marks',
 '0.6% and 1.2% extra fill price disadvantages applied only to research RENDER independent route',
 'Do not generalize from economic ledgers to real execution performance',
 'Candidate IDs vary between replay copies; normalized economic ledger excluding ID is stable']
DEST.mkdir(parents=True,exist_ok=True)
out=DEST/'RENDER_4427_INDEPENDENT_NATIVE8_COST_STRESS_AUDIT_20261024.json'
out.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print('COST_STRESS_AUDIT_SAVED',out)
for cost,arr in data['costs'].items():
 for label,x in arr.items():
  print('AUDITED',cost,label,'EQUITY',round(x['metrics']['final_equity_jpy'],2),
    'DELTA',round(x['vsBaseline']['finalEquityDeltaJpy'],2),'TRADES',x['metrics']['closed_trades'],
    'DD',round(x['metrics']['maximum_mtm_drawdown_pct'],6),'N',x['independentAcceptedCount'])
