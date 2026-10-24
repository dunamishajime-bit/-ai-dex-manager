#!/usr/bin/env python3
"""Research-only entire selected-cohort native market M5 exit re-pricing.
Check pre-existing six-hour model parity before computing a fixed 55m time cap
across all 12 accepted-as-of independent shadow trades from 2025-2026.
This is not a true 55m-trained as-of gate; historical selection uses the original
6-hour shadow score. Never mislabel it as untouched out of sample or venue-native.
"""
from __future__ import annotations
import collections,csv,datetime as dt,gzip,hashlib,io,json,zipfile
from pathlib import Path
ROOT=Path('C:/tmp')
BASE=ROOT/'render-mtf-study-20261024'
DEST=ROOT/'render4427-independent-gates-audit-20261024/docs/research/results/render4427-scoped-priority-native8-20261024'
POL=DEST/'RENDER_4427_HIGHWR_EXPANDING_CAUSAL_ASOF_OWNER_20261025.json'
policy=json.loads(POL.read_text('utf8'))
choice=next(x for x in policy['cases'] if x['gate']=='WICK_SHARP_S6' and x['policy']=='expanding_highwr')
selected=choice['shadowAddedTrades'];assert len(selected)==12
SOURCE_ROOTS=[
 ROOT/'render-rndr-2024-history-20261024',
 ROOT/'idle-render-independent-older-m5-20261024',
 ROOT/'render-flow-raw-data-20261024',
 ROOT/'render-2026-aug-oct-research-20261024']
used={};bars={}
for s in selected:
 sym=s['sym'];t=s['t']
 timestamp=dt.datetime.fromtimestamp(t/1000,dt.timezone.utc)
 month=timestamp.strftime('%Y-%m')
 key=(sym,month)
 if key in used:continue
 matches=sorted(set(p for base in SOURCE_ROOTS for p in base.rglob(sym+'-5m-'+month+'.zip')))
 if not matches:
  daily=timestamp.strftime('%Y-%m-%d')
  matches=sorted(set(p for base in SOURCE_ROOTS for p in base.rglob(sym+'-5m-'+daily+'.zip')))
 assert len(matches)==1,('PUBLISHER_M5_SOURCE_UNAVAILABLE_OR_CONFLICT',key,[str(x) for x in matches])
 path=matches[0];monthdata={}
 with zipfile.ZipFile(path) as z:
  assert z.testzip() is None
  ms=[n for n in z.namelist() if n.endswith('.csv')];assert len(ms)==1
  for row in csv.reader(io.TextIOWrapper(z.open(ms[0]),encoding='utf-8-sig')):
   try:t0=int(row[0]);o,h,l,c=map(float,row[1:5])
   except (ValueError,IndexError):continue
   assert o>0 and h>=max(o,c) and l<=min(o,c)
   monthdata[t0]=(o,h,l,c)
 bars[key]=monthdata
 used[key]={'file':str(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'rows':len(monthdata)}
print('M5_SOURCES',len(used),[(a,used[a]['rows']) for a in used],flush=True)
def simulate(s,minutes):
 t=s['t'];sym=s['sym']
 key=(sym,dt.datetime.fromtimestamp(t/1000,dt.timezone.utc).strftime('%Y-%m'))
 price=bars[key]
 span=[t+k*300000 for k in range(minutes//5+1)]
 assert all(ts in price for ts in span),('M5_HOLE',t,sym,minutes)
 entry=price[t][0];stop=entry*1.02;target=entry*.985
 exit_ts=span[-1];exit_price=price[exit_ts][0];reason='TIME_LIMIT'
 for ts in span[:-1]:
  o,h,l,c=price[ts]
  if h>=stop:
   exit_price=max(o,stop);exit_ts=ts;reason='STOP';break
  if l<=target:
   exit_price=target;exit_ts=ts;reason='TAKE';break
 return {'entry_ts':t,'symbol':sym,'exit_ts':exit_ts,'net30':100*(1-exit_price/entry)-.30,
         'entry_price':entry,'exit_price':exit_price,'reason':reason}
def metric(rows,cost):
 x=[r['net30']+(.30-cost/100) for r in rows]
 g=sum(max(0,a) for a in x);l=-sum(min(0,a) for a in x)
 return {'n':len(x),'wins':sum(a>0 for a in x),
         'wrPct':round(100*sum(a>0 for a in x)/len(x),3) if x else None,
         'pf':round(g/l,5) if l else None,'meanNetPct':round(sum(x)/len(x),5) if x else None}
PER={'2025H1':(1735689600000,1754006400000),'2025H2':(1754006400000,1767225600000),
     '2026JanAug':(1767225600000,1786320000000),
     '2026AugOct':(1786320000000,1792800000000)}
ret={}
for hold in (55,360):
 rs=[]
 for v in selected:
  r=simulate(v,hold)
  if hold==360:
   assert abs(r['net30']-v['net30'])<1e-5 and r['exit_ts']==v['exitTs'],('S6_6H_PRICE_PARITY_FAIL',v,r)
  rs.append(r)
 ret[str(hold)]={'performance':{str(c):metric(rs,c) for c in (10,30)},
    'byPeriod':{p:{str(c):metric([r for r in rs if lo<=r['entry_ts']<hi],c) for c in (10,30)}
     for p,(lo,hi) in PER.items()},
    'trades':rs}
 print('QUALIFIED12',hold,'TOTAL',ret[str(hold)]['performance'],'BY_YEAR',ret[str(hold)]['byPeriod'],flush=True)
out={'status':'RESEARCH_ONLY_COMPLETE_12_SELECTED_SHADOW_REPRICED_WITH55_TIME_CAP',
 'dateJST':'2026-10-25','selectedPolicy':'WICK_SHARP_S6 expanding_highwr on original six-hour CLOSED shadow history',
 'count':len(selected),'sources':{str(k):v for k,v in used.items()},
 'results':ret,'limitations':['55m time cap was proposed after known TAO collision, not pristine forward research',
    'Selection still uses prior closed 6h shadow-trade results; it is NOT re-trained with 55m outcomes',
    'Official Binance M5 price modeling, not Aster actual signed fills',
    'Only 12 selected, not sufficient for high-confidence generalization',
    'LIVE/VPS/Production/HP untouched']}
dst=DEST/'RENDER_4427_HIGHWR_12_SHADOW_TRADES_55MIN_VS_6H_HISTORICAL_REPRICE_20261025.json'
dst.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print('STUDY_SAVED',dst,flush=True)
