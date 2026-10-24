#!/usr/bin/env python3
"""Audit replayer: FULL8 native wallet with RENDER historical candidate #4427.
Exact SHA-256 ledger parity across all cost pass iterations, raw native market
H1 source coverage bound, Aster market mark missing before Jan 6 2026.
10/30 bps and incumbent rule parity required; reject fabricated full-period
2025 RENDER asset evaluation, never bypass Fail Closed / risk ownership.
"""
from __future__ import annotations
import collections,datetime as dt,hashlib,json
from pathlib import Path
REPO=Path(__file__).resolve().parents[2]
ROOT=Path('C:/tmp/render-4427-full-native8-wallet-20261024')
BASE=Path('C:/tmp/render-regime-native8-results-20261024/RENDER_TWO_REGIME_PARITY_BASELINE')
CASES=['RENDER_4427_3ENTRY_INTEGRATED_NATIVE8']
REPORT_NAME='PENGU_TIMED_NEGATIVE_NATIVE_FULL8_20261023.json'
DEST=REPO/'docs/research/results/render-three-regime-20261024'
EXPECTED_EIGHT={'V12','PENGU','Q102','FET','HYPE_LONG','V52','IDLE','RESIDUAL'}
def sha(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 return h.hexdigest()
def get(c):
 parent=BASE if c=='RENDER_TWO_REGIME_PARITY_BASELINE' else ROOT/c
 src=parent/REPORT_NAME
 z=json.loads(src.read_text('utf8'))['cases'][c]['costs']
 return parent,z
def rows(f):
 with f.open('r',encoding='utf8') as h:
  return [json.loads(x) for x in h if x.strip()]
def time(t):
 return dt.datetime.fromtimestamp(int(t)/1000,dt.timezone.utc).strftime('%Y-%m-%dT%H:%M')
def key(z):
 return (str(z['strategy_id']),str(z['symbol']),str(z['side']),int(z['entry_ts_ms']),str(z.get('route')))
def main():
 basepath,base=get('RENDER_TWO_REGIME_PARITY_BASELINE')
 audit={
  'status':'RESEARCH_ONLY_RENDER_4427_NATIVE_EIGHT_STRATEGY_ACCOUNTING_VERIFIED',
  'periodStart':'2025-08-10','periodEnd':'2026-08-10',
  'initialCapitalJpy':10000,'monthlyContributionJpy':0,
  'newRenderEntryCoverage':'2026-01-08 through 2026-08-09 only, since Aster verified RENDER H1 mark begins 2026-01-06',
  'whyNot2025RENDER':'H1 verified mark tape lacks RENDER before 2026-01-06; Fail Closed remained enforced; no interpolated or invented mark bars',
  'baselineCase':'RENDER_TWO_REGIME_PARITY_BASELINE','baseline':{},
  'cases':{},
  'limitations':['This is 8-strategy native H1 model, not L2/live venue certification or current VPS accounting',
    '2025 RENDER alpha entries intentionally excluded due missing Aster H1 mark evidence',
    'New entry modeled fills and exits are Binance futures M5 proxy, not actual Aster executions',
    '2024/2025/2026 thresholds were explored retrospectively; no pristine forward live fills',
    'Native wallet original IDLE existing route and seven other strategies unchanged',
    'new route funding_return_per_gross initialized to 0 even though other positions use engine venue funding: residual evidence gap',
    'No Production/VPS/HP/real trading changes']}
 for cost in ('10','30'):
  orig=base[cost]
  assert orig['accounting']=='PASS' and set(orig['byStrategy'])==EXPECTED_EIGHT
  paths=[p for p in (basepath/'engine').rglob('portfolio-trades.jsonl') if p.parent.name==f'PRICE_MODEL_{cost}BPS']
  originals=[p for p in paths if sha(p)==orig['ledgerSha256']]
  assert originals,('BASE_SHA_MISSING',cost)
  audit['baseline'][cost]={k:orig[k] for k in ('finalEquityJpy','portfolioPF','ddPct','closedTrades','byStrategy','ledgerSha256')}
  audit['baseline'][cost]['RENDER_Existing'] =sum(z['strategy_id']=='IDLE' and z['symbol']=='RENDERUSDT' for z in rows(originals[0]))
 for c in CASES:
  p,results=get(c)
  per={}
  for cost in ('10','30'):
   z=results[cost];old=audit['baseline'][cost]
   assert z['accounting']=='PASS' and set(z['byStrategy'])==EXPECTED_EIGHT
   candidates=[x for x in (p/'engine').rglob('portfolio-trades.jsonl') if x.parent.name==f'PRICE_MODEL_{cost}BPS']
   matches=[x for x in candidates if sha(x)==z['ledgerSha256']]
   assert matches and len(candidates)==3,('WALLET_REPLAY_MISSING',c,cost,len(matches))
   def econ_hash(f):
    stream=rows(f)
    for item in stream:item.pop('candidate_id',None)
    stream.sort(key=lambda x:(x['entry_ts_ms'],x['strategy_id'],x['symbol'],x['side'],str(x.get('route'))))
    return hashlib.sha256(json.dumps(stream,sort_keys=True,separators=(',',':')).encode()).hexdigest()
   hashes=[econ_hash(q) for q in candidates]
   assert len(set(hashes))==1,('ECONOMIC_MISMATCH',c,cost,hashes)
   run=rows(matches[0]);ledger=rows(next(
    x for x in (basepath/'engine').rglob('portfolio-trades.jsonl')
    if x.parent.name==f'PRICE_MODEL_{cost}BPS' and sha(x)==old['ledgerSha256']))
   fees=rows(matches[0].parent/'candidate-decisions.jsonl')
   recent=[x for x in run if str(x.get('route','')).startswith('IDLE_RENDER_4427_')]
   oldkeys={key(x) for x in ledger};newkeys={key(x) for x in run}
   oldentry={key(x):x for x in ledger}
   newentry={key(x):x for x in run}
   byreason=collections.Counter((x['route'],x['decision'],x['reason'])
    for x in fees if str(x.get('route','')).startswith('IDLE_RENDER_4427_'))
   x={'finalEquityJpy':z['finalEquityJpy'],
     'portfolioPF':z['portfolioPF'],'maxMtmDdPct':z['ddPct'],
     'closedTrades':z['closedTrades'],
     'byStrategy':z['byStrategy'],
     'deltaEquityJpy':round(z['finalEquityJpy']-old['finalEquityJpy'],5),
     'deltaDdPctPoints':round(z['ddPct']-old['ddPct'],8),
     'deltaTrades':int(z['closedTrades']-old['closedTrades']),
     'deltaPF':round(z['portfolioPF']-old['portfolioPF'],6),
     'modelLedgerSha256':z['ledgerSha256'],
     'threeReplayEconomicsEqual':True,
     'economicLedgerSha256':hashes[0],
     'rawByteLedgersEqual':len({sha(q) for q in candidates})==1,
     'strategyReallocationCounts':{k:z['byStrategy'][k]-old['byStrategy'][k]
       for k in sorted(EXPECTED_EIGHT)},
     'newResearchTradesCount':len(recent),
     'newResearchTradesByRoute':dict(collections.Counter(x['route'] for x in recent)),
     'newResearchMaxGross':round(max((float(x['accepted_gross']) for x in recent),default=0),8),
     'nativeOtherRoutesRemovedByConflict':dict(collections.Counter(
       oldentry[k]['strategy_id'] for k in oldkeys-newkeys)),
     'nativeOtherRoutesAdded':dict(collections.Counter(
       newentry[k]['strategy_id'] for k in newkeys-oldkeys
       if not str(newentry[k].get('route','')).startswith('IDLE_RENDER_4427_'))),
     'nativeCandidateDecisions':[
       {'route':route,'status':status,'reason':reason,'count':n}
       for (route,status,reason),n in sorted(byreason.items())],
     'tradeDetails':[{
       'utc':time(x['entry_ts_ms']), 'route':x['route'],
       'gross':round(float(x['accepted_gross']),6),
       'exitReason':x['exit_reason_actual'],
       'netModeledJpy':round(float(x['modeled_realized_pnl_jpy_at_exit_fx']),2)}
       for x in recent]}
   assert x['newResearchMaxGross']<=.251
   assert all(str(item['utc'])[:4]=='2026' for item in x['tradeDetails'])
   assert x['deltaTrades']==len(run)-len(ledger)
   per[cost]=x
   print('NATIVE8',c,cost,'FINAL',round(z['finalEquityJpy']),
    'DELTA_EQ',round(x['deltaEquityJpy']),
    'DD',round(z['ddPct'],4),'DD_DELTA',x['deltaDdPctPoints'],
    'TRADES',z['closedTrades'],'DELTA',x['deltaTrades'],
    'NEW_ACCEPTED',len(recent),'PF',round(z['portfolioPF'],5),
    '3REPLAY_ECONOMIC_PASS',len(hashes),flush=True)
  audit['cases'][c]=per
 DEST.mkdir(parents=True,exist_ok=True)
 dest=DEST/'RENDER_4427_RESEARCH_NATIVE8_10_30BPS_COMPARISON_20261024.json'
 dest.write_text(json.dumps(audit,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
 print('FINISHED',dest)
if __name__=='__main__':main()
