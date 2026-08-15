"""Calendar coverage diagnosis for Binance USD-M daily metrics archives.

Probe-only, BTCUSDT only, design period only. No strategy evaluation, no file
contents, and no post-2026-07-01 Fresh OOS access. The goal is to determine
whether the reproducible ~14% archive gaps follow a fixed calendar pattern or
represent irregular missing data.
"""
from __future__ import annotations

import concurrent.futures
import datetime as dt
import json
import urllib.error
import urllib.request
from collections import Counter
from pathlib import Path

UTC=dt.timezone.utc
START=dt.date(2023,7,1)
END=dt.date(2026,7,1)
SYMBOL='BTCUSDT'
BASE='https://data.binance.vision/data/futures/um/daily/metrics'


def days():
    d=START
    while d<END:
        yield d
        d += dt.timedelta(days=1)


def probe(day: dt.date):
    date=day.isoformat(); name=f'{SYMBOL}-metrics-{date}.zip'; url=f'{BASE}/{SYMBOL}/{name}'
    req=urllib.request.Request(url,method='HEAD',headers={'User-Agent':'research-calendar-probe/1.0'})
    try:
        with urllib.request.urlopen(req,timeout=20) as r:
            return {'date':date,'available':200 <= r.status < 400,'status':r.status,'length':r.headers.get('Content-Length')}
    except urllib.error.HTTPError as e:
        return {'date':date,'available':False,'status':e.code}
    except Exception as e:
        return {'date':date,'available':False,'error':type(e).__name__+':'+str(e)[:120]}


def main():
    ds=list(days())
    with concurrent.futures.ThreadPoolExecutor(max_workers=24) as pool:
        rows=list(pool.map(probe,ds))
    missing=[r for r in rows if not r.get('available')]
    weekday=Counter(dt.date.fromisoformat(r['date']).strftime('%A') for r in missing)
    by_month=Counter(r['date'][:7] for r in missing)
    status=Counter(str(r.get('status',r.get('error','UNKNOWN'))) for r in missing)
    # Gap-run lengths on the calendar.
    miss_set={dt.date.fromisoformat(r['date']) for r in missing}
    runs=[]; cur=START
    while cur<END:
        if cur not in miss_set:
            cur+=dt.timedelta(days=1); continue
        start=cur; n=0
        while cur<END and cur in miss_set:
            n+=1; cur+=dt.timedelta(days=1)
        runs.append({'start':start.isoformat(),'days':n})
    out={
      'researchLine':'BINANCE_USDM_METRICS_CALENDAR_GAP_DIAGNOSIS',
      'researchOnly':True,'strategyEvaluationPerformed':False,
      'productionChanged':False,'vpsChanged':False,'liveChanged':False,'realTradingEnabled':False,
      'freshOosRead':False,'post20260701DataUsed':False,
      'symbol':SYMBOL,'start':START.isoformat(),'endExclusive':END.isoformat(),
      'totalDays':len(rows),'availableDays':len(rows)-len(missing),'missingDays':len(missing),
      'coverage':(len(rows)-len(missing))/len(rows),
      'missingWeekdayCounts':dict(weekday),'missingMonthCounts':dict(sorted(by_month.items())),
      'missingStatusCounts':dict(status),'missingDates':[r['date'] for r in missing],
      'gapRuns':runs,'maxGapDays':max((r['days'] for r in runs),default=0),
    }
    root=Path('.research-state'); root.mkdir(exist_ok=True)
    (root/'binance-usdm-metrics-calendar-gap-diagnosis.json').write_text(json.dumps(out,indent=2,sort_keys=True))
    lines=['# Binance USD-M Metrics Calendar Gap Diagnosis','',f"Coverage: {out['availableDays']}/{out['totalDays']} = {out['coverage']:.4%}",f"Missing days: {out['missingDays']}",f"Max consecutive gap: {out['maxGapDays']} days",'',f"Weekdays: {out['missingWeekdayCounts']}",f"Statuses: {out['missingStatusCounts']}",'','First 40 missing dates:']
    lines += [f'- {d}' for d in out['missingDates'][:40]]
    lines += ['','Probe only. No strategy evaluation. No Fresh OOS data read.']
    (root/'binance-usdm-metrics-calendar-gap-diagnosis.md').write_text('\n'.join(lines)+'\n')
    print(json.dumps(out,indent=2,sort_keys=True))

if __name__=='__main__': main()
