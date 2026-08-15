"""Numeric-field quality diagnosis for BTCUSDT USD-M daily metrics.

Probe-only, design period only. Quantifies blank/non-numeric cells by column and
measures the exact hourly coverage that would remain if invalid snapshots were
dropped rather than imputed. No strategy evaluation and no Fresh OOS access.
"""
from __future__ import annotations

import concurrent.futures
import csv
import datetime as dt
import io
import json
import math
import urllib.request
import zipfile
from collections import Counter
from pathlib import Path

UTC=dt.timezone.utc
START=dt.date(2023,7,1); END=dt.date(2026,7,1); SYMBOL='BTCUSDT'
BASE='https://data.binance.vision/data/futures/um/daily/metrics'
NUMERIC=(
 'sum_open_interest','sum_open_interest_value','count_toptrader_long_short_ratio',
 'sum_toptrader_long_short_ratio','count_long_short_ratio','sum_taker_long_short_vol_ratio'
)

def days():
 d=START
 while d<END:
  yield d; d+=dt.timedelta(days=1)

def parse_time(s:str)->dt.datetime:
 return dt.datetime.strptime(s.strip(),'%Y-%m-%d %H:%M:%S').replace(tzinfo=UTC)

def inspect(day:dt.date):
 date=day.isoformat(); name=f'{SYMBOL}-metrics-{date}.zip'; url=f'{BASE}/{SYMBOL}/{name}'
 req=urllib.request.Request(url,headers={'User-Agent':'research-numeric-quality-probe/1.0'})
 with urllib.request.urlopen(req,timeout=30) as r: payload=r.read()
 with zipfile.ZipFile(io.BytesIO(payload)) as zf:
  names=[n for n in zf.namelist() if n.lower().endswith('.csv')]
  raw=zf.read(names[0]).decode('utf-8-sig',errors='replace')
 reader=csv.DictReader(io.StringIO(raw))
 invalid=Counter(); total=0; valid=0; hourly={}; examples=[]
 for item in reader:
  total+=1; bad=[]
  for col in NUMERIC:
   value=(item.get(col) or '').strip()
   try:
    x=float(value)
    if not math.isfinite(x): raise ValueError('nonfinite')
   except Exception:
    invalid[col]+=1; bad.append(col)
  if bad:
   if len(examples)<3: examples.append({'time':item.get('create_time'),'columns':bad})
   continue
  ts=parse_time(item['create_time']); valid+=1
  hourly[int(ts.timestamp()*1000)//3_600_000*3_600_000]=1
 return {'date':date,'totalRows':total,'validRows':valid,'invalidRows':total-valid,'invalidByColumn':dict(invalid),'validHours':len(hourly),'examples':examples,'hourKeys':sorted(hourly)}

def max_gap(hours):
 if len(hours)<2:return 999999
 return max(max(0,int((b-a)//3_600_000)-1) for a,b in zip(hours,hours[1:]))

def main():
 ds=list(days())
 with concurrent.futures.ThreadPoolExecutor(max_workers=20) as p: rows=list(p.map(inspect,ds))
 cols=Counter(); affected=[]; all_hours={}
 for r in rows:
  for c,n in r['invalidByColumn'].items(): cols[c]+=n
  if r['invalidRows']>0: affected.append({k:r[k] for k in ('date','totalRows','validRows','invalidRows','invalidByColumn','validHours','examples')})
  for h in r.pop('hourKeys'): all_hours[h]=1
 expected=len(ds)*24; hours=sorted(all_hours); coverage=len(hours)/expected; gap=max_gap(hours)
 out={
  'researchLine':'BINANCE_USDM_METRICS_NUMERIC_QUALITY_DIAGNOSIS','researchOnly':True,'strategyEvaluationPerformed':False,
  'productionChanged':False,'vpsChanged':False,'liveChanged':False,'realTradingEnabled':False,'freshOosRead':False,'post20260701DataUsed':False,
  'symbol':SYMBOL,'start':START.isoformat(),'endExclusive':END.isoformat(),'totalDays':len(rows),'affectedDays':len(affected),
  'invalidCellsByColumn':dict(cols),'totalInvalidCells':sum(cols.values()),'totalInvalidRows':sum(r['invalidRows'] for r in rows),
  'maxInvalidRowsPerDay':max((r['invalidRows'] for r in rows),default=0),'hourlyRowsAfterDroppingInvalidSnapshots':len(hours),
  'expectedHours':expected,'hourCoverageAfterDrop':coverage,'maxGapHoursAfterDrop':gap,'affectedDayDetails':affected,
 }
 root=Path('.research-state');root.mkdir(exist_ok=True)
 (root/'binance-usdm-metrics-numeric-quality-diagnosis.json').write_text(json.dumps(out,indent=2,sort_keys=True))
 lines=['# Binance USD-M Metrics Numeric Quality Diagnosis','',f"Affected days: {len(affected)}/{len(rows)}",f"Invalid rows: {out['totalInvalidRows']}",f"Invalid cells by column: {out['invalidCellsByColumn']}",f"Hourly coverage after dropping invalid snapshots: {coverage:.6%}",f"Max gap after drop: {gap}h",'', 'First 30 affected days:']
 lines += [f"- {r['date']}: invalidRows={r['invalidRows']} cols={r['invalidByColumn']} examples={r['examples']}" for r in affected[:30]]
 lines += ['','Probe only. Invalid rows are measured, not imputed. No strategy evaluation. No Fresh OOS data read.']
 (root/'binance-usdm-metrics-numeric-quality-diagnosis.md').write_text('\n'.join(lines)+'\n')
 print(json.dumps(out,indent=2,sort_keys=True))

if __name__=='__main__':main()
