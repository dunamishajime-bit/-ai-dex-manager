"""Cross-day row diagnosis for BTCUSDT daily USD-M metrics archives.

Probe-only, design period only. Measures rows whose `create_time` date differs
from the archive date, to distinguish harmless next-day boundary overlap from
arbitrary contamination. No strategy evaluation and no Fresh OOS access.
"""
from __future__ import annotations

import concurrent.futures
import csv
import datetime as dt
import io
import json
import urllib.request
import zipfile
from collections import Counter
from pathlib import Path

UTC=dt.timezone.utc
START=dt.date(2023,7,1); END=dt.date(2026,7,1); SYMBOL='BTCUSDT'
BASE='https://data.binance.vision/data/futures/um/daily/metrics'


def days():
    d=START
    while d<END:
        yield d
        d+=dt.timedelta(days=1)


def parse_time(s:str)->dt.datetime:
    return dt.datetime.strptime(s.strip(),'%Y-%m-%d %H:%M:%S').replace(tzinfo=UTC)


def inspect(day:dt.date):
    date=day.isoformat(); name=f'{SYMBOL}-metrics-{date}.zip'; url=f'{BASE}/{SYMBOL}/{name}'
    req=urllib.request.Request(url,headers={'User-Agent':'research-crossday-probe/1.0'})
    with urllib.request.urlopen(req,timeout=30) as r: payload=r.read()
    with zipfile.ZipFile(io.BytesIO(payload)) as zf:
        names=[n for n in zf.namelist() if n.lower().endswith('.csv')]
        raw=zf.read(names[0]).decode('utf-8-sig',errors='replace')
    reader=csv.DictReader(io.StringIO(raw))
    cross=[]; total=0
    day_start=dt.datetime.combine(day,dt.time(),tzinfo=UTC)
    day_end=day_start+dt.timedelta(days=1)
    for item in reader:
        total+=1
        ts=parse_time(item['create_time'])
        if ts.date()!=day:
            if ts>=day_end: offset=(ts-day_end).total_seconds()
            else: offset=-(day_start-ts).total_seconds()
            cross.append({'time':item['create_time'],'offsetSecondsFromNearestBoundary':offset})
    return {'date':date,'totalRows':total,'crossRows':cross}


def main():
    ds=list(days())
    with concurrent.futures.ThreadPoolExecutor(max_workers=20) as p:
        rows=list(p.map(inspect,ds))
    affected=[r for r in rows if r['crossRows']]
    offsets=[]; direction=Counter(); counts=Counter()
    for r in affected:
        counts[str(len(r['crossRows']))]+=1
        day=dt.date.fromisoformat(r['date'])
        for x in r['crossRows']:
            off=float(x['offsetSecondsFromNearestBoundary']); offsets.append(off)
            direction['next_day' if off>=0 else 'previous_day']+=1
    out={
      'researchLine':'BINANCE_USDM_METRICS_CROSSDAY_DIAGNOSIS','researchOnly':True,'strategyEvaluationPerformed':False,
      'productionChanged':False,'vpsChanged':False,'liveChanged':False,'realTradingEnabled':False,'freshOosRead':False,'post20260701DataUsed':False,
      'symbol':SYMBOL,'start':START.isoformat(),'endExclusive':END.isoformat(),'totalDays':len(rows),'affectedDays':len(affected),
      'totalCrossRows':sum(len(r['crossRows']) for r in affected),'directionCounts':dict(direction),'crossRowsPerDayDistribution':dict(counts),
      'minOffsetSeconds':min(offsets) if offsets else None,'maxOffsetSeconds':max(offsets) if offsets else None,
      'affectedDetails':affected,
    }
    root=Path('.research-state'); root.mkdir(exist_ok=True)
    (root/'binance-usdm-metrics-crossday-diagnosis.json').write_text(json.dumps(out,indent=2,sort_keys=True))
    lines=['# Binance USD-M Metrics Cross-day Diagnosis','',f"Affected days: {len(affected)}/{len(rows)}",f"Cross rows: {out['totalCrossRows']}",f"Directions: {out['directionCounts']}",f"Offset range: {out['minOffsetSeconds']} .. {out['maxOffsetSeconds']} seconds",f"Rows/day: {out['crossRowsPerDayDistribution']}",'','First 40 affected:']
    lines += [f"- {r['date']}: {r['crossRows']}" for r in affected[:40]]
    lines += ['','Probe only. No strategy evaluation. No Fresh OOS data read.']
    (root/'binance-usdm-metrics-crossday-diagnosis.md').write_text('\n'.join(lines)+'\n')
    print(json.dumps(out,indent=2,sort_keys=True))

if __name__=='__main__':main()
