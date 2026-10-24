#!/usr/bin/env python3
"""Full 2024 historic short families, cross-contract separation verified.
RNDR old perpetual Jan1-Jul16 09UTC, then discrete RENDER perpetual
Jul26 10UTC onward; archived zero-volume postdelisting RNDR rows discarded.
No fills during delisting gap, no synthetic continuity or price splice.
"""
from __future__ import annotations
import datetime as dt,hashlib,json
from pathlib import Path
HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
DST=REPO/'docs/research/results/render-three-regime-20261024'
from importlib import util
def load(n,p):
 sp=util.spec_from_file_location(n,p);m=util.module_from_spec(sp);sp.loader.exec_module(m);return m
m=load('year2024_research_old_src',HERE/'render-orderflow-composite-20261024.py')
e=m.e
OLD_EXPIRY=e.ms('2024-07-16')+9*3600000
NEW_START=e.ms('2024-07-26')+10*3600000
END_2024=e.ms('2025-01-01')
def bars(entries,symbol):
 xs=[]
 for f in sorted((r for r in entries if r['kind']=='klines5m' and r['symbol']==symbol),key=lambda z:z['key']):
  rows=m.csv_from_archive(f)
  for row in rows:
   if not row or not row[0].isdigit():continue
   xs.append((int(row[0]),float(row[1]),float(row[2]),float(row[3]),float(row[4]),float(row[5]),float(row[9])))
 xs.sort(key=lambda r:r[0])
 assert len(xs)==len({r[0] for r in xs}),(symbol,'DUP')
 return xs
def continuous(xs):
 return all(xs[k][0]-xs[k-1][0]==300000 for k in range(1,len(xs)))
def filt_cooldown(rows,tag,policy):
 allowed=-1;sel=[]
 for r in rows:
  if r['t']<allowed or tag not in r['tags']:continue
  x=dict(r,policy=policy);sel.append(x)
  allowed=int(x['exits'][policy]['exitTs'])+12*e.screen.HOUR
 return sel
def metrics(rows):
 return {str(cost):e.summarize(rows,cost) for cost in (10,30)}
def main():
 old_source=json.loads((DST/'RENDER_RNDR_2024_OFFICIAL_CROSS_CONTRACT_SOURCE_MANIFEST_20261024.json').read_text('utf8'))
 assert old_source['goodN']==old_source['requestedN']==227
 assert old_source['errorN']==old_source['missingN']==0
 past=json.loads((REPO/'docs/research/results/render-orderflow-20261024/RENDER_ORDERFLOW_SOURCE_MANIFEST_20261024.json').read_text('utf8'))
 rn=bars(old_source['files'],'RNDRUSDT')
 rawpost=sum(t[0]>=OLD_EXPIRY for t in rn)
 rn=[r for r in rn if r[0]<OLD_EXPIRY]
 assert rn[-1][0]<OLD_EXPIRY and len(rn)>50000 and continuous(rn)
 assert rawpost>100,('EXPECTED_STALE_POST_SETTLEMENT_RECORDS_NOT_FOUND',rawpost)
 bc=bars(old_source['files'],'BTCUSDT')
 assert continuous(bc)
 rj=bars(old_source['files'],'RENDERUSDT')
 assert rj[0][0]==NEW_START and continuous(rj)
 oldm=json.loads((REPO/'docs/research/results/idle-entry-three-20261024/IDLE_RENDER_OLDER_BINANCE_PUBLIC_M5_SOURCE_MANIFEST_20261024.json').read_text('utf8'))
 oldrender=m.read_render_bars(past['files'],True)
 oldbtc,_=e.old_mod.parse_months(oldm,'BTCUSDT')
 newrender=[*rj,*oldrender]
 newbtc=[*bc,*oldbtc]
 assert continuous(newrender) and continuous(newbtc) and newrender[0][0]==NEW_START
 # RENDER starts late July, BTC whole year; i indexing in prepare uses t-based bisect.
 rn_events=e.prepare(rn,bc,rn[0][0],OLD_EXPIRY,'RNDR_2024_PREEXPIRY')
 new_events=e.prepare(newrender,newbtc,NEW_START,END_2024,'RENDER_2024_AFTERLIST')
 assert rn_events and new_events
 periods=[
  ('2024_old_RNDR_JAN_MAY',e.ms('2024-01-01'),e.ms('2024-06-01')),
  ('2024_old_RNDR_JUN_JUL16',e.ms('2024-06-01'),OLD_EXPIRY),
  ('2024_new_RENDER_JUL26_DEC',NEW_START,END_2024),
 ]
 out={'status':'RESEARCH_ONLY_REAL_2024_TWO_CONTRACT_SHORT_FAMILY_SCREEN',
  'provenance':{'source':'RENDER_RNDR_2024_OFFICIAL_CROSS_CONTRACT_SOURCE_MANIFEST_20261024.json',
   'officialChecksumVerified':227,'zeroVolumeOldRNDRPostExpiryRowsDiscarded':rawpost,
   'oldRNDRLastAcceptedTsMs':rn[-1][0], 'RENDERFirstAcceptedTsMs':rj[0][0],
   'noCrossContractCandlesOrHoldovers':True,'RNDRbarsAccepted':len(rn),
   'RENDER2024barCount':sum(z[0]<END_2024 for z in newrender)},
  'limitations':['RNDR and RENDER are different futures contracts, never an executable single position spanning delisting gap',
   'Native Aster RENDER strategy and ownership may differ from this Binance historical tape',
   '2024 cohorts all previously known period for historical research; no pristine OOS','No funding settlement expense in modeled PnL',
   'Exit path is M5 stop-first and next bar, not venue latency and partial fill'],
  'routes':{}}
 for tag in ('two_stage','bear_break','relative_top','btc_trap'):
  for policy in e.POLICIES:
   oa=filt_cooldown(rn_events,tag,policy)
   nb=filt_cooldown(new_events,tag,policy)
   each={}
   for key,a,b in periods:
    both=oa if key.startswith('2024_old') else nb
    each[key]=metrics([z for z in both if a<=z['t']<b])
   each['2024_pooled_research_not_continuous_contract']=metrics(oa+nb)
   out['routes'][f'{tag}__{policy}']=each
   val=each['2024_pooled_research_not_continuous_contract']['30']
   print('YEAR2024_ROUTE',tag,policy,'POOL_N',val['n'],'POOL_WR',val['wrPct'],'POOL_PF',val['pf'],
     'RNDR_JANMAY',each['2024_old_RNDR_JAN_MAY']['30']['n'],
        each['2024_old_RNDR_JAN_MAY']['30']['pf'],
     'RENDER_JULDEC',each['2024_new_RENDER_JUL26_DEC']['30']['n'],
        each['2024_new_RENDER_JUL26_DEC']['30']['pf'],flush=True)
 dst=DST/'RENDER_2024_RNDR_REBRAND_TWO_CONTRACT_ROUTE_BT_20261024.json'
 dst.write_text(json.dumps(out,indent=2,ensure_ascii=False)+'\n',encoding='utf8')
 print('RESULT',dst,flush=True)
if __name__=='__main__':main()
