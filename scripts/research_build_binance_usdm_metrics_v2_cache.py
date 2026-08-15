"""Build the independently validated Binance USD-M metrics V2 cache.

This is a data-adapter repair only. The frozen V7 mechanism router is not
changed. Empirical archive audit established that Binance daily metrics ZIPs
may contain (a) one row stamped at the next UTC day boundary and (b) isolated
blank numeric cells. The old V1 parser rejected the entire day in either case.

V2 policy, fixed before V7 is executed:
- URL generation remains sealed by the frozen V1 archive_url firewall to
  2023-07-01 <= day < 2026-07-01.
- Every daily archive must exist and parse with the exact expected header.
- rows outside the archive's requested UTC day are discarded, never reassigned;
- rows with blank required numeric fields are discarded, never imputed;
- malformed non-blank numerics and symbol/header mismatches remain hard errors;
- final cache must have >=99.5% hourly coverage and <=12 consecutive missing
  hours per symbol, otherwise build fails closed;
- Fresh OOS is never requested or read.
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
from pathlib import Path
from typing import Any

import research_fetch_binance_usdm_metrics_history as v1

START = v1.START
END = v1.END
SYMBOLS = v1.SYMBOLS
EXPECTED_HEADER = v1.EXPECTED_HEADER
CACHE_VERSION = 'v2'
DEFAULT_ROOT = Path('.cache/research-usdm-metrics-v2')
MAX_WORKERS = 8
RETRIES = 6
MIN_HOUR_COVERAGE = 0.995
MAX_GAP_HOURS = 12
NUMERIC_FIELDS = (
    'sum_open_interest',
    'sum_open_interest_value',
    'count_toptrader_long_short_ratio',
    'sum_toptrader_long_short_ratio',
    'count_long_short_ratio',
    'sum_taker_long_short_vol_ratio',
)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def _download(symbol: str, day: dt.date) -> dict[str, Any]:
    url = v1.archive_url(symbol, day)  # frozen pre-OOS firewall
    last_error: str | None = None
    for attempt in range(1, RETRIES + 1):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'research-usdm-metrics-v2-cache/1.0'})
            with urllib.request.urlopen(req, timeout=30) as response:
                payload = response.read()
            if len(payload) < 100:
                raise RuntimeError(f'SMALL_ARCHIVE:{len(payload)}')
            with zipfile.ZipFile(io.BytesIO(payload)) as zf:
                names = [n for n in zf.namelist() if n.lower().endswith('.csv')]
                if len(names) != 1:
                    raise RuntimeError(f'CSV_COUNT:{len(names)}')
                raw = zf.read(names[0]).decode('utf-8-sig', errors='strict')
            reader = csv.DictReader(io.StringIO(raw))
            header = tuple(reader.fieldnames or ())
            if header != EXPECTED_HEADER:
                raise RuntimeError('HEADER_MISMATCH:' + '|'.join(header))

            day_start = dt.datetime.combine(day, dt.time.min, tzinfo=v1.UTC)
            day_end = day_start + dt.timedelta(days=1)
            kept: list[dict[str, Any]] = []
            dropped_cross_day = 0
            dropped_blank = 0
            raw_rows = 0
            for item in reader:
                raw_rows += 1
                ts = v1.parse_time(item['create_time'])
                # Source archives are allowed to carry a boundary row, but the
                # row is not moved into the requested day and cannot enter cache.
                if not (day_start <= ts < day_end):
                    dropped_cross_day += 1
                    continue
                if not (START <= ts < END):
                    raise RuntimeError(f'FRESH_OOS_ROW_BLOCK:{ts.isoformat()}')
                if item['symbol'].strip().upper() != symbol:
                    raise RuntimeError(f"SYMBOL_MISMATCH:{item['symbol']}:{symbol}")
                if any(item[field].strip() == '' for field in NUMERIC_FIELDS):
                    dropped_blank += 1
                    continue
                try:
                    row = {
                        'ts': int(ts.timestamp() * 1000),
                        'openInterest': float(item['sum_open_interest']),
                        'openInterestValue': float(item['sum_open_interest_value']),
                        'topTraderCountLongShort': float(item['count_toptrader_long_short_ratio']),
                        'topTraderPositionLongShort': float(item['sum_toptrader_long_short_ratio']),
                        'globalLongShort': float(item['count_long_short_ratio']),
                        'takerLongShortVol': float(item['sum_taker_long_short_vol_ratio']),
                    }
                except ValueError as exc:
                    raise RuntimeError(f'NONBLANK_NUMERIC_PARSE:{ts.isoformat()}:{exc}') from exc
                if not all(math.isfinite(float(row[k])) for k in row if k != 'ts'):
                    raise RuntimeError(f'NONFINITE_METRIC:{ts.isoformat()}')
                kept.append(row)
            if raw_rows == 0:
                raise RuntimeError('EMPTY_CSV')
            kept.sort(key=lambda r: int(r['ts']))
            hourly: dict[int, dict[str, Any]] = {}
            for row in kept:
                hour = int(row['ts'] // 3_600_000 * 3_600_000)
                hourly[hour] = row
            return {
                'symbol': symbol,
                'day': day.isoformat(),
                'url': url,
                'archiveAvailable': True,
                'rawRows': raw_rows,
                'validRows': len(kept),
                'droppedCrossDayRows': dropped_cross_day,
                'droppedBlankRows': dropped_blank,
                'hourly': [dict(v, hourTs=k) for k, v in sorted(hourly.items())],
            }
        except urllib.error.HTTPError as exc:
            last_error = f'HTTP_{exc.code}'
            if exc.code == 404:
                # Daily archive coverage is a hard 100% requirement.
                break
        except Exception as exc:
            last_error = f'{type(exc).__name__}:{str(exc)[:240]}'
            # Deterministic content errors should not be retried six times.
            if last_error.startswith(('RuntimeError:HEADER_', 'RuntimeError:SYMBOL_', 'RuntimeError:NONBLANK_', 'RuntimeError:NONFINITE_', 'RuntimeError:FRESH_OOS_')):
                break
        if attempt < RETRIES:
            time.sleep(0.35 * attempt)
    return {'symbol': symbol, 'day': day.isoformat(), 'url': url, 'archiveAvailable': False, 'error': last_error}


def _max_missing_gap_hours(hours: list[int]) -> int:
    if not hours:
        return int((END - START).total_seconds() // 3600)
    present = set(int(x) for x in hours)
    cur = int(START.timestamp() * 1000 // 3_600_000 * 3_600_000)
    end = int(END.timestamp() * 1000)
    longest = run = 0
    while cur < end:
        if cur in present:
            run = 0
        else:
            run += 1
            longest = max(longest, run)
        cur += 3_600_000
    return longest


def _write_gzip(path: Path, rows: list[dict[str, Any]]) -> str:
    with gzip.open(path, 'wt', encoding='utf-8', compresslevel=6) as fh:
        json.dump(rows, fh, separators=(',', ':'), sort_keys=True)
    return sha256_file(path)


def validate_existing(root: Path) -> dict[str, Any] | None:
    p = root / 'manifest.json'
    if not p.is_file():
        return None
    try:
        d = json.loads(p.read_text(encoding='utf-8'))
    except Exception:
        return None
    if d.get('cacheVersion') != CACHE_VERSION or d.get('start') != START.isoformat() or d.get('endExclusive') != END.isoformat():
        return None
    for symbol in SYMBOLS:
        meta = d.get('symbols', {}).get(symbol)
        fp = root / f'{symbol}.hourly.json.gz'
        if not meta or not fp.is_file() or meta.get('sha256') != sha256_file(fp):
            return None
    return d


def build(root: Path) -> dict[str, Any]:
    root.mkdir(parents=True, exist_ok=True)
    existing = validate_existing(root)
    if existing is not None:
        print('METRICS_V2_EXACT_CACHE_READY')
        return existing

    v1.self_test_firewall()
    days = list(v1.day_range(START, END))
    tasks = [(s, d) for s in SYMBOLS for d in days]
    results: list[dict[str, Any]] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futs = {pool.submit(_download, symbol, day): (symbol, day) for symbol, day in tasks}
        for n, fut in enumerate(concurrent.futures.as_completed(futs), 1):
            results.append(fut.result())
            if n % 250 == 0 or n == len(tasks):
                ok = sum(bool(x.get('archiveAvailable')) for x in results)
                print(f'METRICS_V2_PROGRESS:{n}/{len(tasks)}:archives={ok}', flush=True)

    symbol_meta: dict[str, Any] = {}
    for symbol in SYMBOLS:
        sr = sorted((x for x in results if x['symbol'] == symbol), key=lambda x: x['day'])
        missing_archives = [x for x in sr if not x.get('archiveAvailable')]
        if missing_archives:
            sample = ';'.join(f"{x['day']}={x.get('error')}" for x in missing_archives[:10])
            raise RuntimeError(f'METRICS_V2_DAILY_ARCHIVE_COVERAGE_FAIL:{symbol}:{len(missing_archives)}:{sample}')
        hourly: dict[int, dict[str, Any]] = {}
        for item in sr:
            for row in item.get('hourly', []):
                hour = int(row['hourTs'])
                if hour >= int(END.timestamp() * 1000):
                    raise RuntimeError(f'METRICS_V2_FRESH_OOS_CONTAMINATION:{symbol}:{hour}')
                hourly[hour] = row
        rows = [hourly[h] for h in sorted(hourly)]
        expected_hours = len(days) * 24
        hour_coverage = len(rows) / expected_hours
        max_gap = _max_missing_gap_hours(list(hourly))
        if hour_coverage < MIN_HOUR_COVERAGE:
            raise RuntimeError(f'METRICS_V2_HOUR_COVERAGE_FAIL:{symbol}:{hour_coverage:.6f}:{len(rows)}/{expected_hours}')
        if max_gap > MAX_GAP_HOURS:
            raise RuntimeError(f'METRICS_V2_MAX_GAP_FAIL:{symbol}:{max_gap}')
        path = root / f'{symbol}.hourly.json.gz'
        digest = _write_gzip(path, rows)
        symbol_meta[symbol] = {
            'path': str(path),
            'sha256': digest,
            'dailyArchivesExpected': len(days),
            'dailyArchivesAvailable': len(days),
            'dailyArchiveCoverage': 1.0,
            'expectedHours': expected_hours,
            'hourRows': len(rows),
            'hourCoverage': hour_coverage,
            'maxGapHours': max_gap,
            'raw5mRows': sum(int(x.get('rawRows', 0)) for x in sr),
            'valid5mRows': sum(int(x.get('validRows', 0)) for x in sr),
            'droppedCrossDayRows': sum(int(x.get('droppedCrossDayRows', 0)) for x in sr),
            'droppedBlankRows': sum(int(x.get('droppedBlankRows', 0)) for x in sr),
            'lowRowDaysUnder250': [x['day'] for x in sr if int(x.get('validRows', 0)) < 250],
            'firstHourTs': rows[0]['hourTs'] if rows else None,
            'lastHourTs': rows[-1]['hourTs'] if rows else None,
            'freshOosRead': False,
            'post20260701DataUsed': False,
        }

    manifest = {
        'cacheVersion': CACHE_VERSION,
        'source': 'binance-data-vision-usdm-daily-metrics',
        'adapterPolicy': 'drop_cross_day_boundary_rows_and_blank_numeric_rows_no_imputation',
        'researchOnly': True,
        'productionChanged': False,
        'vpsChanged': False,
        'liveChanged': False,
        'realTradingEnabled': False,
        'strategyEvaluationPerformed': False,
        'freshOosRead': False,
        'post20260701DataUsed': False,
        'freshOosBoundaryExclusiveMs': int(END.timestamp() * 1000),
        'start': START.isoformat(),
        'endExclusive': END.isoformat(),
        'schema': list(EXPECTED_HEADER),
        'hourlyRule': 'last valid 5m metrics snapshot inside each UTC candle hour',
        'minimumHourCoverage': MIN_HOUR_COVERAGE,
        'maximumGapHours': MAX_GAP_HOURS,
        'symbols': symbol_meta,
    }
    (root / 'manifest.json').write_text(json.dumps(manifest, indent=2, sort_keys=True), encoding='utf-8')
    print(json.dumps(manifest, indent=2, sort_keys=True))
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', default=str(DEFAULT_ROOT))
    parser.add_argument('--firewall-self-test', action='store_true')
    args = parser.parse_args()
    if args.firewall_self_test:
        v1.self_test_firewall()
        return
    build(Path(args.root))


if __name__ == '__main__':
    main()
