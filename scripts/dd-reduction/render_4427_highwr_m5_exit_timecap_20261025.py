#!/usr/bin/env python3
"""RESEARCH ONLY: causal hard maximum hold (45/55/60min) for high-WR RENDER S6.
Uses publisher M5 only, fully preserves original TP/stop, never uses future info to
decide entry. Entry is predeclared H1; time stop is fixed at entry.
The earlier 2026 May 28 TAO collision is known ex post: prospective bias warning.
"""
from __future__ import annotations
import csv,datetime as dt,gzip,hashlib,io,json,zipfile
from pathlib import Path
ROOT=Path('C:/tmp')
BASE=ROOT/'render-mtf-study-20261024'
DIR=ROOT/'render-flow-raw-data-20261024/monthly/klines/RENDERUSDT/5m'
OUT=ROOT/'render4427-independent-gates-audit-20261024/docs/research/results/render4427-scoped-priority-native8-20261024'
policy=json.loads((OUT/'RENDER_4427_HIGHWR_EXPANDING_CAUSAL_ASOF_OWNER_20261025.json').read_text('utf8'))
case=next(x for x in policy['cases'] if x['gate']=='WICK_SHARP_S6' and x['policy']=='expanding_highwr')
events=case['accepted2026'];assert len(events)==6
months={dt.datetime.fromtimestamp(e['t']/1000,dt.timezone.utc).strftime('%Y-%m') for e in events}
data={}
archives=[]
for mo in sorted(months):
 p=DIR/('RENDERUSDT-5m-'+mo+'.zip')
 assert p.is_file(),('MISSING_BINANCE_M5',p)
 with zipfile.ZipFile(p) as z:
  assert z.testzip() is None
  member=[n for n in z.namelist() if n.endswith('.csv')]
  assert len(member)==1
  for row in csv.reader(io.TextIOWrapper(z.open(member[0]),encoding='utf-8-sig')):
   try:
    ts=int(row[0]);o,h,l,c=map(float,row[1:5])
   except (ValueError,IndexError):continue
   assert o>0 and h>=max(o,c) and l<=min(o,c)
   data[ts]=(o,h,l,c)
 archives.append({'file':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
def simulate(ts,limit_mins):
 i=[ts+300000*j for j in range(limit_mins//5+1)]
 assert all(t in data for t in i),('M5_HOLE',ts,limit_mins)
 entry=data[ts][0];tp=entry*.985;sl=entry*1.02
 end_ts=i[-1];ex=data[end_ts][0];why='TIME_LIMIT'
 for t in i[:-1]:
  o,h,l,c=data[t]
  if h>=sl:
   ex=max(o,sl);end_ts=t;why='STOP';break
  if l<=tp:
   ex=tp;end_ts=t;why='TAKE';break
 return {'entry_ts_ms':ts,'exit_ts_ms':end_ts,'entry_price_binance':entry,
       'exit_price_binance':ex,'exit_kind':why,
       'net30Pct':100*(1-ex/entry)-.30,'net10Pct':100*(1-ex/entry)-.10}
results={}
for hold in (45,55,60,90,120,180,360):
 sample=[simulate(e['t'],hold) for e in events]
 # 6h original exits are exact shadow price under same S6 bracket.
 if hold==360:
  by={x['t']:x['net30'] for x in events}
  for row in sample:assert abs(row['net30Pct']-by[row['entry_ts_ms']])<1e-5,(row,by)
 n=len(sample)
 summary={}
 for c in (10,30):
  arr=[x['net10Pct' if c==10 else 'net30Pct'] for x in sample]
  gains=sum(max(0,x) for x in arr);loss=-sum(min(0,x) for x in arr)
  summary[str(c)]={'count':n,'wins':sum(x>0 for x in arr),
          'wrPct':100*sum(x>0 for x in arr)/n,
          'meanPct':sum(arr)/n,'pf':gains/loss if loss else None}
 results[str(hold)]={'costs':summary,'trades':sample}
 print('FIXED_TIME_CAP',hold,'MINS',summary,'MAY28',[z for z in sample if z['entry_ts_ms']==1779930000000][0],flush=True)
out={'status':'RESEARCH_ONLY_H1_CAUSAL_FIXED_MAX_HOLD_45_360',
    'date':'2026-10-25','policySha256':hashlib.sha256((OUT/'RENDER_4427_HIGHWR_EXPANDING_CAUSAL_ASOF_OWNER_20261025.json').read_bytes()).hexdigest(),
    'archives':archives,'results':results,
    'caveats':['Known TAO opportunity one hour after May28 new RENDER entry affects hypothesis and creates after-the-fact selection risk',
      'Official Binance 5m not Aster fills or mark; Native8 integration is a separate required test',
      'No 2025 history native mark; only six 2026 entries',
      'Simultaneous bar stop conservatively wins over profit target',
      'No changes to LIVE, VPS, Production or HP']}
OUT.mkdir(parents=True,exist_ok=True)
dst=OUT/'RENDER_4427_HIGHWR_TIME_CAP_M5_45_360MIN_20261025.json'
dst.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print('CAP_STRESS_SAVED',dst,flush=True)
