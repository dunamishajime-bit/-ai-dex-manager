"""Content coverage diagnosis for BTCUSDT daily USD-M metrics archives.

Probe-only, design period only. Downloads each existing daily archive exactly
for row/header/timestamp diagnostics; no strategy evaluation and no Fresh OOS.
This isolates deterministic parser failures from network/archive availability.
"""
from __future__ import annotations

import concurrent.futures
import csv
import datetime as dt
import io
import json
import urllib.error
import urllib.request
import zipfile
from collections import Counter
from pathlib import Path

UTC=dt.timezone.utc
START=dt.date(2023,7,1)
END=dt.date(2026,7,1)
SYMBOL='BTCUSDT'
BASE='https://data.binance.vision/data/futures/um/daily/metrics'
EXPECTED=('create_time','symbol','sum_open_interest','sum_open_interest_value','count_toptrader_long_short_ratio','sum_toptrader_long_short_ratio','count_long_short_ratio','sum_taker_long_short_vol_ratio')


def days():
    d=START
    while d<END:
        yield d
        d+=dt.timedelta(days=1)


def parse_day(day: dt.date):
    date=day.isoformat(); name=f'{SYMBOL}-metrics-{date}.zip'; url=f'{BASE}/{SYMBOL}/{name}'
    rec={'date':date,'available':False,'validHeader':False,'rowCount':None}
    try:
        req=urllib.request.Request(url,headers={'User-Agent':'research-content-probe/1.0'})
        with urllib.request.urlopen(req,timeout=30) as r: payload=r.read()
        rec['available']=True; rec['zipBytes']=len(payload)
        with zipfile.ZipFile(io.BytesIO(payload)) as zf:
            names=[n for n in zf.namelist() if n.lower().endswith('.csv')]
            if len(names)!=1:
                rec['error']=f'CSV_COUNT:{len(names)}'; return rec
            raw=zf.read(names[0]).decode('utf-8-sig',errors='replace')
        rows=list(csv.reader(io.StringIO(raw)))
        header=tuple(rows[0]) if rows else ()
        rec['validHeader']=header==EXPECTED
        rec['header']=list(header)
        rec['rowCount']=max(0,len(rows)-1)
        if len(rows)>1:
            rec['firstTime']=rows[1][0]; rec['lastTime']=rows[-1][0]
        return rec
    except urllib.error.HTTPError as e:
        rec['status']=e.code
    except Exception as e:
        rec['error']=type(e).__name__+':'+str(e)[:160]
    return rec


def main():
    ds=list(days())
    with concurrent.futures.ThreadPoolExecutor(max_workers=20) as pool:
        rows=list(pool.map(parse_day,ds))
    available=[r for r in rows if r['available']]
    row_counts=Counter(str(r.get('rowCount')) for r in available)
    short=[r for r in available if isinstance(r.get('rowCount'),int) and r['rowCount']<250]
    bad_header=[r for r in available if not r.get('validHeader')]
    failed=[r for r in rows if not r['available']]
    short_weekday=Counter(dt.date.fromisoformat(r['date']).strftime('%A') for r in short)
    short_month=Counter(r['date'][:7] for r in short)
    out={
      'researchLine':'BINANCE_USDM_METRICS_CONTENT_COVERAGE_DIAGNOSIS','researchOnly':True,
      'strategyEvaluationPerformed':False,'productionChanged':False,'vpsChanged':False,'liveChanged':False,'realTradingEnabled':False,
      'freshOosRead':False,'post20260701DataUsed':False,
      'symbol':SYMBOL,'start':START.isoformat(),'endExclusive':END.isoformat(),'totalDays':len(rows),
      'downloadedDays':len(available),'failedDownloads':len(failed),'validHeaderDays':sum(r.get('validHeader',False) for r in available),
      'rowCountDistribution':dict(row_counts),'shortDayCount':len(short),'shortWeekdayCounts':dict(short_weekday),'shortMonthCounts':dict(sorted(short_month.items())),
      'shortDays':[{k:r.get(k) for k in ('date','rowCount','firstTime','lastTime','zipBytes')} for r in short],
      'badHeaderDays':[r['date'] for r in bad_header],
      'failedDays':[{k:r.get(k) for k in ('date','status','error')} for r in failed],
    }
    root=Path('.research-state'); root.mkdir(exist_ok=True)
    (root/'binance-usdm-metrics-content-coverage-diagnosis.json').write_text(json.dumps(out,indent=2,sort_keys=True))
    lines=['# Binance USD-M Metrics Content Coverage Diagnosis','',f"Downloaded: {len(available)}/{len(rows)}",f"Valid headers: {out['validHeaderDays']}/{len(available)}",f"Short (<250 rows): {len(short)}",f"Failed downloads: {len(failed)}",'',f"Row-count distribution: {out['rowCountDistribution']}",f"Short weekdays: {out['shortWeekdayCounts']}",'','First 40 short days:']
    lines += [f"- {r['date']}: rows={r['rowCount']} first={r.get('firstTime')} last={r.get('lastTime')}" for r in out['shortDays'][:40]]
    lines += ['','First 20 failed downloads:']+[f"- {r}" for r in out['failedDays'][:20]]
    lines += ['','Probe only. No strategy evaluation. No Fresh OOS data read.']
    (root/'binance-usdm-metrics-content-coverage-diagnosis.md').write_text('\n'.join(lines)+'\n')
    print(json.dumps(out,indent=2,sort_keys=True))

if __name__=='__main__': main()
