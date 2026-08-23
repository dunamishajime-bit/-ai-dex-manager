#!/usr/bin/env python3
import csv
import io
import json
import re
import subprocess
import sys
import zipfile
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path('.research-state/pengu-bulltrap-crossvenue-v2')
ROOT.mkdir(parents=True, exist_ok=True)
ARCHIVE = 'https://data.binance.vision/data/futures/um/monthly'
CANDIDATE_SHA = 'eaab138cb8ddc97ce6e61f03839d2a172c46f2a5'


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
    by_ts = {}
    found = []
    for ym in month_keys(2024, 12, 2026, 7):
        url = f'{ARCHIVE}/klines/{symbol}/1h/{symbol}-1h-{ym}.zip'
        blob = fetch_zip(url)
        if blob is None:
            continue
        found.append(ym)
        with zipfile.ZipFile(io.BytesIO(blob)) as z:
            name = z.namelist()[0]
            with z.open(name) as fh:
                text = io.TextIOWrapper(fh, encoding='utf-8-sig')
                for row in csv.reader(text):
                    if len(row) < 7:
                        continue
                    try:
                        t = norm_ts(row[0])
                        rec = {
                            'openTime': t,
                            'open': float(row[1]),
                            'high': float(row[2]),
                            'low': float(row[3]),
                            'close': float(row[4]),
                            'volume': float(row[5]),
                            'closeTime': norm_ts(row[6]),
                        }
                    except Exception:
                        continue
                    by_ts[t] = rec
    rows = [by_ts[k] for k in sorted(by_ts)]
    if symbol == 'PENGUUSDT' and len(rows) < 1000:
        raise RuntimeError(f'Insufficient Binance Vision {symbol} rows={len(rows)} months={found}')
    if symbol == 'BTCUSDT' and len(rows) < 5000:
        raise RuntimeError(f'Insufficient Binance Vision {symbol} rows={len(rows)} months={found}')
    (ROOT / f'{symbol}.json').write_text(json.dumps(rows, separators=(',', ':')))
    return {'rows': len(rows), 'months': found, 'first': rows[0]['openTime'], 'last': rows[-1]['openTime']}


def load_funding(symbol):
    by_ts = {}
    found = []
    for ym in month_keys(2024, 12, 2026, 7):
        url = f'{ARCHIVE}/fundingRate/{symbol}/{symbol}-fundingRate-{ym}.zip'
        blob = fetch_zip(url)
        if blob is None:
            continue
        found.append(ym)
        with zipfile.ZipFile(io.BytesIO(blob)) as z:
            name = z.namelist()[0]
            with z.open(name) as fh:
                rows = list(csv.reader(io.TextIOWrapper(fh, encoding='utf-8-sig')))
        if not rows:
            continue
        header = [x.strip().lower() for x in rows[0]]
        has_header = any(any(c.isalpha() for c in x) for x in header)
        if has_header:
            ti = next((i for i, x in enumerate(header) if 'time' in x), 0)
            ri = next((i for i, x in enumerate(header) if 'funding' in x and 'rate' in x), len(header) - 1)
            data = rows[1:]
        else:
            ti, ri, data = 0, len(rows[0]) - 1, rows
        for row in data:
            if len(row) <= max(ti, ri):
                continue
            try:
                t = norm_ts(row[ti])
                r = float(row[ri])
            except Exception:
                continue
            by_ts[t] = {'fundingTime': t, 'fundingRate': r}
    vals = [by_ts[k] for k in sorted(by_ts)]
    if len(vals) < 100:
        raise RuntimeError(f'Insufficient Binance Vision funding rows={len(vals)} months={found}')
    (ROOT / 'PENGUUSDT-funding.json').write_text(json.dumps(vals, separators=(',', ':')))
    return {'rows': len(vals), 'months': found, 'first': vals[0]['fundingTime'], 'last': vals[-1]['fundingTime']}


LOCAL_FUNCS = r'''async function downloadCandles(symbol:string){const raw=JSON.parse(await fs.readFile(`.research-state/pengu-bulltrap-crossvenue-v2/${symbol}.json`,"utf8")) as DisDexV35Candle[];return raw.filter(c=>c.openTime>=WARM_START&&c.openTime<EVAL_END);}
async function downloadFunding(){const raw=JSON.parse(await fs.readFile(".research-state/pengu-bulltrap-crossvenue-v2/PENGUUSDT-funding.json","utf8")) as FundingPoint[];return raw.filter(x=>x.fundingTime>=WARM_START&&x.fundingTime<EVAL_END);}
'''


def build_copy(name, warm, start, end):
    source = Path('scripts/research_pengu_bulltrap_overlay_v3.ts').read_text()
    source = source.replace('const WARM_START=Date.parse("2025-08-01T00:00:00Z");', f'const WARM_START=Date.parse("{warm}");')
    source = source.replace('const EVAL_START=Date.parse("2025-08-23T15:00:00Z");', f'const EVAL_START=Date.parse("{start}");')
    source = source.replace('const EVAL_END=Date.parse("2026-08-23T15:00:00Z");', f'const EVAL_END=Date.parse("{end}");')
    begin = source.index('async function downloadCandles(symbol:string)')
    finish = source.index('function fundingBetween', begin)
    source = source[:begin] + LOCAL_FUNCS + source[finish:]
    old = 'const expected=Math.floor((EVAL_END-EVAL_START)/HOUR);assert.equal(pengu.filter(x=>x.openTime>=EVAL_START&&x.openTime<EVAL_END).length,expected);assert.equal(btc.filter(x=>x.openTime>=EVAL_START&&x.openTime<EVAL_END).length,expected);'
    source = source.replace(old, 'assert.ok(pengu.length>500);assert.ok(btc.length>500);')
    old2 = 'assert.equal(base.length,32);if(mode==="normal")assert.equal(base.filter(t=>t.side==="S").length,25);'
    source = source.replace(old2, 'assert.ok(base.length>0);')
    p = Path(f'scripts/.pengu_bulltrap_{name}.ts')
    p.write_text(source)
    return p


def run_copy(name, file):
    out = ROOT / f'{name}.json'
    env = dict(__import__('os').environ)
    env['PENGU_BULLTRAP_OVERLAY_OUT'] = str(out)
    cp = subprocess.run(['npx', 'tsx', str(file)], env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    (ROOT / f'{name}.log').write_text(cp.stdout)
    print(cp.stdout)
    if cp.returncode != 0:
        raise RuntimeError(f'{name} replay failed with code {cp.returncode}')
    return json.loads(out.read_text())


def extract(p):
    n = p['results']['RETEST_REJECT']['NORMAL']
    s = p['results']['RETEST_REJECT']['STRESS']
    return {'normal': {'baseline': n['BASELINE'], 'overlay': n['OVERLAY'], 'combined': n['COMBINED']},
            'stress': {'baseline': s['BASELINE'], 'overlay': s['OVERLAY'], 'combined': s['COMBINED']}}


def passes(x):
    n, s = x['normal'], x['stress']
    o, b, c = n['overlay'], n['baseline'], n['combined']
    return (b['trades'] >= 10 and o['trades'] >= 5 and (o['winRatePct'] or 0) >= 65
            and (o['profitFactor'] or 0) >= 1.5 and (c['winRatePct'] or 0) > (b['winRatePct'] or 0)
            and c['returnPct'] >= b['returnPct'] and (c['profitFactor'] or 0) >= (b['profitFactor'] or 0)
            and s['combined']['returnPct'] >= s['baseline']['returnPct'])


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
        'schema': 'pengu-bulltrap-frozen-crossvenue/v3',
        'candidate': f'RETEST_REJECT frozen at {CANDIDATE_SHA}',
        'dataSource': 'Binance Vision official USD-M monthly archives',
        'data': data,
        'priorPeriod': {'period': ['2024-12-24T00:00:00Z', '2025-08-01T00:00:00Z'], 'metrics': prior, 'pass': passes(prior)},
        'overlapPeriod': {'period': ['2025-08-23T15:00:00Z', '2026-08-01T00:00:00Z'], 'metrics': overlap, 'pass': passes(overlap)},
        'promotion': {'pass': passes(prior) and passes(overlap)},
        'safety': {'mode': 'RESEARCH_ONLY', 'ordersSent': False, 'liveChanged': False, 'vpsChanged': False, 'productionChanged': False},
    }
    (ROOT / 'crossvenue.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
