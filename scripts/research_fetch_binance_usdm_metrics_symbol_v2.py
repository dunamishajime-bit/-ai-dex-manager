"""Per-symbol research-only Binance USD-M metrics fetcher v2.

Infrastructure diagnostics established three source facts for the design period:
1. Daily archives exist even when a small number of individual ratio fields are
   blank. Those invalid 5-minute snapshots are dropped, never imputed/zeroed.
2. Some daily archives contain exactly one next-day boundary overlap row at
   00:00:00-00:00:02 UTC. Only a verified 0-5 second next-day overlap is
   discarded; any other cross-day row remains fail-closed.
3. A few archives are genuinely partial intraday files. Missing hours are never
   interpolated or carried across hours.

The resulting per-symbol series must still satisfy 100% daily archive/header
availability, >=99.5% hourly coverage, and no continuous missing gap >12 hours.
Each symbol runs in its own GitHub job to avoid long-lived multi-symbol request
failures observed in the bulk fetcher.

Hard Fresh-OOS firewall: only 2023-07-01 <= t < 2026-07-01 UTC is addressable.
No production/VPS/LIVE/order code is imported or modified.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import csv
import datetime as dt
import gzip
import hashlib
import io
import json
import math
import time
import urllib.error
import urllib.request
import zipfile
from collections import Counter
from pathlib import Path
from typing import Any

UTC=dt.timezone.utc
START=dt.datetime(2023,7,1,tzinfo=UTC)
END=dt.datetime(2026,7,1,tzinfo=UTC)
ALLOWED=("BTCUSDT","ETHUSDT","BNBUSDT","LINKUSDT","AVAXUSDT")
BASE="https://data.binance.vision/data/futures/um/daily/metrics"
HEADER=("create_time","symbol","sum_open_interest","sum_open_interest_value","count_toptrader_long_short_ratio","sum_toptrader_long_short_ratio","count_long_short_ratio","sum_taker_long_short_vol_ratio")
NUMERIC_FIELDS=(
    "sum_open_interest","sum_open_interest_value","count_toptrader_long_short_ratio",
    "sum_toptrader_long_short_ratio","count_long_short_ratio","sum_taker_long_short_vol_ratio",
)
WORKERS=20
RETRIES=3
MIN_HOUR_COVERAGE=0.995
MAX_GAP_HOURS=12
MAX_BOUNDARY_OVERLAP_SECONDS=5


def days():
    d=START.date()
    while d<END.date():
        yield d
        d+=dt.timedelta(days=1)


def url_for(symbol: str, day: dt.date) -> str:
    if symbol not in ALLOWED:
        raise RuntimeError(f"UNAPPROVED_METRICS_SYMBOL:{symbol}")
    if day<START.date() or day>=END.date():
        raise RuntimeError(f"METRICS_OOS_FIREWALL_BLOCK:{symbol}:{day.isoformat()}")
    date=day.isoformat(); name=f"{symbol}-metrics-{date}.zip"
    return f"{BASE}/{symbol}/{name}"


def parse_time(value: str) -> dt.datetime:
    return dt.datetime.strptime(value.strip(),"%Y-%m-%d %H:%M:%S").replace(tzinfo=UTC)


def finite_float(value: str) -> float:
    x=float((value or "").strip())
    if not math.isfinite(x):
        raise ValueError("non-finite numeric field")
    return x


def fetch_day(symbol: str, day: dt.date) -> dict[str,Any]:
    url=url_for(symbol,day); last=None
    day_start=dt.datetime.combine(day,dt.time(),tzinfo=UTC)
    day_end=day_start+dt.timedelta(days=1)
    for attempt in range(RETRIES):
        try:
            req=urllib.request.Request(url,headers={"User-Agent":"research-usdm-metrics-symbol-v2/1.0"})
            with urllib.request.urlopen(req,timeout=30) as r: payload=r.read()
            with zipfile.ZipFile(io.BytesIO(payload)) as zf:
                names=[n for n in zf.namelist() if n.lower().endswith('.csv')]
                if len(names)!=1: raise RuntimeError(f"CSV_COUNT:{len(names)}")
                raw=zf.read(names[0]).decode('utf-8-sig',errors='strict')
            reader=csv.DictReader(io.StringIO(raw))
            header=tuple(reader.fieldnames or ())
            if header!=HEADER: raise RuntimeError('HEADER_MISMATCH:'+'|'.join(header))
            valid_rows=[]; source_rows=0; invalid_rows=0; boundary_rows=0; in_day_rows=0; invalid_by_column=Counter()
            for item in reader:
                source_rows+=1
                ts=parse_time(item['create_time'])
                if ts.date()!=day:
                    if day_end<=ts<=day_end+dt.timedelta(seconds=MAX_BOUNDARY_OVERLAP_SECONDS):
                        boundary_rows+=1
                        continue
                    raise RuntimeError(f"UNEXPECTED_CROSS_DAY_ROW:{day.isoformat()}:{ts.isoformat()}")
                in_day_rows+=1
                if not (START<=ts<END): raise RuntimeError(f"FRESH_OOS_ROW_BLOCK:{ts.isoformat()}")
                if item['symbol'].strip().upper()!=symbol: raise RuntimeError(f"SYMBOL_MISMATCH:{item['symbol']}:{symbol}")
                parsed={}; bad=[]
                for field in NUMERIC_FIELDS:
                    try:
                        parsed[field]=finite_float(item.get(field, ""))
                    except Exception:
                        invalid_by_column[field]+=1; bad.append(field)
                if bad:
                    invalid_rows+=1
                    continue
                valid_rows.append({
                  'ts':int(ts.timestamp()*1000),
                  'openInterest':parsed['sum_open_interest'],
                  'openInterestValue':parsed['sum_open_interest_value'],
                  'topTraderCountLongShort':parsed['count_toptrader_long_short_ratio'],
                  'topTraderPositionLongShort':parsed['sum_toptrader_long_short_ratio'],
                  'globalLongShort':parsed['count_long_short_ratio'],
                  'takerLongShortVol':parsed['sum_taker_long_short_vol_ratio'],
                })
            if source_rows<=0: raise RuntimeError('EMPTY_METRICS_DAY')
            if source_rows != in_day_rows + boundary_rows:
                raise RuntimeError(f"ROW_ACCOUNTING_MISMATCH:{source_rows}:{in_day_rows}:{boundary_rows}")
            if in_day_rows != len(valid_rows) + invalid_rows:
                raise RuntimeError(f"IN_DAY_ROW_ACCOUNTING_MISMATCH:{in_day_rows}:{len(valid_rows)}:{invalid_rows}")
            hourly={}
            for row in sorted(valid_rows,key=lambda x:x['ts']):
                hour=int(row['ts']//3_600_000*3_600_000)
                hourly[hour]=row
            return {
                'day':day.isoformat(),'available':True,
                'sourceRows':source_rows,'inDayRows':in_day_rows,'boundaryOverlapRows':boundary_rows,
                'validRows':len(valid_rows),'invalidRows':invalid_rows,
                'invalidByColumn':dict(invalid_by_column),
                'hourly':[dict(v,hourTs=k) for k,v in sorted(hourly.items())],
            }
        except urllib.error.HTTPError as e:
            if e.code==404:
                return {'day':day.isoformat(),'available':False,'status':404}
            last=f"HTTP_{e.code}"
        except Exception as e:
            last=type(e).__name__+':'+str(e)[:180]
        if attempt+1<RETRIES: time.sleep(0.5*(attempt+1))
    return {'day':day.isoformat(),'available':False,'error':last}


def sha256(path: Path) -> str:
    h=hashlib.sha256()
    with path.open('rb') as fh:
        for chunk in iter(lambda:fh.read(1024*1024),b''): h.update(chunk)
    return h.hexdigest()


def max_gap_hours(hours: list[int]) -> int:
    if len(hours)<2: return 999999
    return max(max(0,int((b-a)//3_600_000)-1) for a,b in zip(hours,hours[1:]))


def build(symbol: str, out_root: Path) -> dict[str,Any]:
    if symbol not in ALLOWED: raise RuntimeError(f"UNAPPROVED_METRICS_SYMBOL:{symbol}")
    ds=list(days())
    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as pool:
        rows=list(pool.map(lambda d:fetch_day(symbol,d),ds))
    failed=[r for r in rows if not r.get('available')]
    if failed:
        raise RuntimeError(f"METRICS_ARCHIVE_AVAILABILITY_FAIL:{symbol}:{len(failed)}:{failed[:5]}")
    hourly={}; partial=[]; invalid_days=[]; boundary_days=[]; invalid_totals=Counter()
    source_total=0; in_day_total=0; boundary_total=0; valid_total=0; invalid_total=0
    for r in rows:
        source_rows=int(r['sourceRows']); in_day_rows=int(r['inDayRows']); boundary_rows=int(r['boundaryOverlapRows'])
        valid_rows=int(r['validRows']); invalid_rows=int(r['invalidRows'])
        source_total+=source_rows; in_day_total+=in_day_rows; boundary_total+=boundary_rows; valid_total+=valid_rows; invalid_total+=invalid_rows
        if in_day_rows!=288: partial.append({'day':r['day'],'inDayRows':in_day_rows,'sourceRows':source_rows})
        if boundary_rows:
            boundary_days.append({'day':r['day'],'boundaryOverlapRows':boundary_rows})
        if invalid_rows:
            invalid_days.append({'day':r['day'],'inDayRows':in_day_rows,'validRows':valid_rows,'invalidRows':invalid_rows,'invalidByColumn':r['invalidByColumn']})
            invalid_totals.update(r['invalidByColumn'])
        for x in r['hourly']: hourly[int(x['hourTs'])]=x
    if source_total != in_day_total + boundary_total:
        raise RuntimeError(f"TOTAL_ROW_ACCOUNTING_MISMATCH:{source_total}:{in_day_total}:{boundary_total}")
    if in_day_total != valid_total + invalid_total:
        raise RuntimeError(f"TOTAL_IN_DAY_ROW_ACCOUNTING_MISMATCH:{in_day_total}:{valid_total}:{invalid_total}")
    ordered=[hourly[k] for k in sorted(hourly)]
    expected=len(ds)*24
    coverage=len(ordered)/expected
    gap=max_gap_hours(sorted(hourly))
    if coverage<MIN_HOUR_COVERAGE:
        raise RuntimeError(f"METRICS_HOUR_COVERAGE_FAIL:{symbol}:{coverage:.8f}:{len(ordered)}/{expected}")
    if gap>MAX_GAP_HOURS:
        raise RuntimeError(f"METRICS_MAX_GAP_FAIL:{symbol}:{gap}")
    if ordered and int(ordered[-1]['hourTs'])>=int(END.timestamp()*1000):
        raise RuntimeError(f"METRICS_FRESH_OOS_CONTAMINATION:{symbol}:{ordered[-1]['hourTs']}")
    out_root.mkdir(parents=True,exist_ok=True)
    data_path=out_root/f'{symbol}.hourly.json.gz'
    with gzip.open(data_path,'wt',encoding='utf-8',compresslevel=6) as fh:
        json.dump(ordered,fh,separators=(',',':'),sort_keys=True)
    manifest={
      'symbol':symbol,'source':'binance-data-vision-usdm-daily-metrics','researchOnly':True,
      'productionChanged':False,'vpsChanged':False,'liveChanged':False,'realTradingEnabled':False,
      'strategyEvaluationPerformed':False,'freshOosRead':False,'post20260701DataUsed':False,
      'start':START.isoformat(),'endExclusive':END.isoformat(),'freshOosBoundaryExclusiveMs':int(END.timestamp()*1000),
      'schema':list(HEADER),'dailyArchiveCoverage':1.0,'expectedDays':len(ds),'availableDays':len(ds),
      'sourceArchiveRows':source_total,'inDay5mRows':in_day_total,'boundaryOverlapRows':boundary_total,
      'valid5mRows':valid_total,'invalid5mRows':invalid_total,'invalidCellsByColumn':dict(invalid_totals),
      'invalidDays':invalid_days,'boundaryOverlapDays':boundary_days,
      'expectedHours':expected,'hourlyRows':len(ordered),'hourCoverage':coverage,'maxGapHours':gap,
      'partialDays':partial,
      'hourlyRule':'discard only verified next-day 0-5s boundary-overlap rows; drop in-day snapshots with any non-finite required numeric field; then use last valid in-day 5m snapshot inside each UTC candle hour; no interpolation or cross-hour carry',
      'dataFile':data_path.name,'dataSha256':sha256(data_path),
    }
    manifest_path=out_root/f'{symbol}.manifest.json'
    manifest_path.write_text(json.dumps(manifest,indent=2,sort_keys=True),encoding='utf-8')
    print(json.dumps(manifest,indent=2,sort_keys=True))
    return manifest


def firewall_self_test():
    try: url_for('AVAXUSDT',END.date())
    except RuntimeError as e:
        if 'METRICS_OOS_FIREWALL_BLOCK' in str(e):
            print('METRICS_SYMBOL_V2_OOS_FIREWALL_PASS'); return
        raise
    raise RuntimeError('METRICS_SYMBOL_V2_OOS_FIREWALL_FAILED')


def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--symbol',choices=ALLOWED); ap.add_argument('--out-root',default='.cache/research-usdm-metrics-v2'); ap.add_argument('--firewall-self-test',action='store_true'); args=ap.parse_args()
    if args.firewall_self_test: firewall_self_test(); return
    if not args.symbol: raise SystemExit('--symbol required')
    build(args.symbol,Path(args.out_root))

if __name__=='__main__': main()
