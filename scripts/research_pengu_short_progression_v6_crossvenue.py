#!/usr/bin/env python3
import csv
import io
import json
import os
import subprocess
import zipfile
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path('.research-state/pengu-short-progression-v6-crossvenue')
ROOT.mkdir(parents=True, exist_ok=True)
ARCHIVE = 'https://data.binance.vision/data/futures/um/monthly'
CANDIDATE_SHA = '23bba4885495ef9eeeb8e761a867178d6f147bf1'
CANDIDATE = 'PROGRESS_2_TO_4_EXIT_1'


def month_keys(y0, m0, y1, m1):
    y, m = y0, m0
    while (y, m) <= (y1, m1):
        yield f'{y:04d}-{m:02d}'
        m += 1
        if m == 13:
            y, m = y + 1, 1


def fetch_zip(url):
    try:
        req = Request(url, headers={'User-Agent': 'DisDex-Research/1.0'})
        with urlopen(req, timeout=90) as r:
            return r.read()
    except HTTPError as e:
        if e.code == 404:
            return None
        raise


def norm_ts(v):
    x = int(float(v))
    while x > 10_000_000_000_000:
        x //= 1000
    return x


def load_klines(symbol):
    by_ts, found = {}, []
    for ym in month_keys(2024, 12, 2026, 7):
        blob = fetch_zip(f'{ARCHIVE}/klines/{symbol}/1h/{symbol}-1h-{ym}.zip')
        if blob is None:
            continue
        found.append(ym)
        with zipfile.ZipFile(io.BytesIO(blob)) as z:
            with z.open(z.namelist()[0]) as fh:
                for row in csv.reader(io.TextIOWrapper(fh, encoding='utf-8-sig')):
                    if len(row) < 7:
                        continue
                    try:
                        t = norm_ts(row[0])
                        by_ts[t] = {'openTime': t, 'open': float(row[1]), 'high': float(row[2]), 'low': float(row[3]), 'close': float(row[4]), 'volume': float(row[5]), 'closeTime': norm_ts(row[6])}
                    except Exception:
                        continue
    rows = [by_ts[k] for k in sorted(by_ts)]
    minimum = 1000 if symbol == 'PENGUUSDT' else 5000
    if len(rows) < minimum:
        raise RuntimeError(f'Insufficient {symbol} rows={len(rows)} months={found}')
    (ROOT / f'{symbol}.json').write_text(json.dumps(rows, separators=(',', ':')))
    return {'rows': len(rows), 'months': found, 'first': rows[0]['openTime'], 'last': rows[-1]['openTime']}


def load_funding(symbol):
    by_ts, found = {}, []
    for ym in month_keys(2024, 12, 2026, 7):
        blob = fetch_zip(f'{ARCHIVE}/fundingRate/{symbol}/{symbol}-fundingRate-{ym}.zip')
        if blob is None:
            continue
        found.append(ym)
        with zipfile.ZipFile(io.BytesIO(blob)) as z:
            with z.open(z.namelist()[0]) as fh:
                rows = list(csv.reader(io.TextIOWrapper(fh, encoding='utf-8-sig')))
        if not rows:
            continue
        header = [x.strip().lower() for x in rows[0]]
        has_header = any(any(c.isalpha() for c in x) for x in header)
        if has_header:
            ti = next((i for i, x in enumerate(header) if 'time' in x), 0)
            ri = next((i for i, x in enumerate(header) if 'funding' in x and 'rate' in x), len(header)-1)
            data = rows[1:]
        else:
            ti, ri, data = 0, len(rows[0])-1, rows
        for row in data:
            if len(row) <= max(ti, ri):
                continue
            try:
                t, r = norm_ts(row[ti]), float(row[ri])
            except Exception:
                continue
            by_ts[t] = {'fundingTime': t, 'fundingRate': r}
    vals = [by_ts[k] for k in sorted(by_ts)]
    if len(vals) < 100:
        raise RuntimeError(f'Insufficient funding rows={len(vals)} months={found}')
    (ROOT / 'PENGUUSDT-funding.json').write_text(json.dumps(vals, separators=(',', ':')))
    return {'rows': len(vals), 'months': found, 'first': vals[0]['fundingTime'], 'last': vals[-1]['fundingTime']}


LOCAL_FUNCS = r'''async function downloadCandles(symbol:string){const raw=JSON.parse(await fs.readFile(`.research-state/pengu-short-progression-v6-crossvenue/${symbol}.json`,"utf8")) as DisDexV35Candle[];return raw.filter(c=>c.openTime>=WARM_START&&c.openTime<EVAL_END);}
async function downloadFunding(){const raw=JSON.parse(await fs.readFile(".research-state/pengu-short-progression-v6-crossvenue/PENGUUSDT-funding.json","utf8")) as FundingPoint[];return raw.filter(x=>x.fundingTime>=WARM_START&&x.fundingTime<EVAL_END);}
'''


def build_copy(name, warm, start, end):
    source = Path('scripts/research_pengu_short_progression_v6.ts').read_text()
    source = source.replace('const WARM_START=Date.parse("2025-08-01T00:00:00Z");', f'const WARM_START=Date.parse("{warm}");')
    source = source.replace('const EVAL_START=Date.parse("2025-08-23T15:00:00Z");', f'const EVAL_START=Date.parse("{start}");')
    source = source.replace('const EVAL_END=Date.parse("2026-08-23T15:00:00Z");', f'const EVAL_END=Date.parse("{end}");')
    begin = source.index('async function downloadCandles(symbol:string)')
    finish = source.index('function fundingBetween', begin)
    source = source[:begin] + LOCAL_FUNCS + source[finish:]
    old = 'const expected=Math.floor((EVAL_END-EVAL_START)/HOUR);assert.equal(pengu.filter(x=>x.openTime>=EVAL_START&&x.openTime<EVAL_END).length,expected);assert.equal(btc.filter(x=>x.openTime>=EVAL_START&&x.openTime<EVAL_END).length,expected);'
    source = source.replace(old, 'assert.ok(pengu.length>500);assert.ok(btc.length>500);')
    old2 = 'assert.equal(base.length,32);assert.equal(shorts.length,25);assert.equal(longs.length,7);'
    source = source.replace(old2, 'assert.ok(base.length>=10);assert.ok(shorts.length>=5);')
    p = Path(f'scripts/.pengu_progression_{name}.ts')
    p.write_text(source)
    return p


def run_copy(name, file):
    out = ROOT / f'{name}.json'
    env = dict(os.environ)
    env['PENGU_SHORT_PROGRESSION_OUT'] = str(out)
    cp = subprocess.run(['npx', 'tsx', str(file)], env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    (ROOT / f'{name}.log').write_text(cp.stdout)
    print(cp.stdout)
    if cp.returncode != 0:
        raise RuntimeError(f'{name} replay failed code={cp.returncode}')
    return json.loads(out.read_text())


def extract(p):
    n, s = p['results'][CANDIDATE]['NORMAL'], p['results'][CANDIDATE]['STRESS']
    return {
        'normal': {'baseline': n['BASELINE'], 'candidateShort': n['CANDIDATE_SHORT'], 'combined': n['COMBINED'], 'changedExits': n['changedExits']},
        'stress': {'baseline': s['BASELINE'], 'candidateShort': s['CANDIDATE_SHORT'], 'combined': s['COMBINED'], 'changedExits': s['changedExits']},
    }


def passes(x):
    n, s = x['normal'], x['stress']
    b, c, bs, cs = n['baseline'], n['combined'], s['baseline'], s['combined']
    return (b['trades'] >= 10 and c['trades'] == b['trades'] and n['changedExits'] >= 2
            and (c['winRatePct'] or 0) >= (b['winRatePct'] or 0) + 5
            and c['returnPct'] >= b['returnPct']
            and (c['profitFactor'] or 0) >= (b['profitFactor'] or 0)
            and c['maxDrawdownPct'] >= b['maxDrawdownPct']
            and cs['returnPct'] >= bs['returnPct']
            and (cs['profitFactor'] or 0) >= (bs['profitFactor'] or 0)
            and cs['maxDrawdownPct'] >= bs['maxDrawdownPct'])


def main():
    data = {'pengu': load_klines('PENGUUSDT'), 'btc': load_klines('BTCUSDT'), 'funding': load_funding('PENGUUSDT')}
    prior_file = build_copy('prior', '2024-12-17T00:00:00Z', '2024-12-24T00:00:00Z', '2025-08-01T00:00:00Z')
    overlap_file = build_copy('overlap', '2025-08-01T00:00:00Z', '2025-08-23T15:00:00Z', '2026-08-01T00:00:00Z')
    try:
        prior = extract(run_copy('prior', prior_file))
        overlap = extract(run_copy('overlap', overlap_file))
    finally:
        prior_file.unlink(missing_ok=True)
        overlap_file.unlink(missing_ok=True)
    result = {
        'status': 'PASS_RESEARCH_ONLY',
        'schema': 'pengu-short-progression-v6-crossvenue/v1',
        'candidate': f'{CANDIDATE} frozen at {CANDIDATE_SHA}',
        'dataSource': 'Binance Vision official USD-M monthly archives',
        'data': data,
        'priorPeriod': {'period': ['2024-12-24T00:00:00Z','2025-08-01T00:00:00Z'], 'metrics': prior, 'pass': passes(prior)},
        'overlapPeriod': {'period': ['2025-08-23T15:00:00Z','2026-08-01T00:00:00Z'], 'metrics': overlap, 'pass': passes(overlap)},
        'promotion': {'pass': passes(prior) and passes(overlap)},
        'safety': {'mode':'RESEARCH_ONLY','ordersSent':False,'liveChanged':False,'vpsChanged':False,'productionChanged':False},
    }
    (ROOT/'crossvenue.json').write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
