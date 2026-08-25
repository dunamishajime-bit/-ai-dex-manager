#!/usr/bin/env python3
import importlib.util
import json
import os
import subprocess
from datetime import datetime
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path('.research-state/pengu-short-v12-gate-final')
ROOT.mkdir(parents=True, exist_ok=True)

V12_PRE_SHA = '2cfe0d7bb829e6cd928cef4871e1f0168c098506'
GATE_RANGE_SHA = '5cb48d6aa311a1d0574cd30b7ca0eca73b5ec1cf'
GATE_FUNDING_SHA = '974cd393203a1311399f402fc0927eb53aaf0d30'
CANDIDATE = 'RAPID_RISKON_RELATIVE_WEAKNESS_REENTRY'

spec = importlib.util.spec_from_file_location('v12', 'scripts/research_pengu_short_v12_okx_binance_gate.py')
v12 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v12)

GATE_BASE = 'https://api.gateio.ws/api/v4'
HOUR = 3_600_000
PRICE_WARM = '2025-07-10T00:00:00Z'
PRICE_START = '2025-08-01T00:00:00Z'
PRICE_END = '2026-08-01T00:00:00Z'
FUND_WARM = '2026-02-01T00:00:00Z'
FUND_START = '2026-03-01T00:00:00Z'
FUND_END = '2026-08-01T00:00:00Z'

def ts(iso):
    return int(datetime.fromisoformat(iso.replace('Z','+00:00')).timestamp())


def gate_get(path, params):
    url = GATE_BASE + path + '?' + urlencode(params)
    req = Request(url, headers={'Accept':'application/json','User-Agent':'DisDex-PENGU-V12-Final-Holdout/1.0'})
    try:
        with urlopen(req, timeout=90) as response:
            return json.loads(response.read().decode('utf-8'))
    except HTTPError as exc:
        body = exc.read().decode('utf-8', errors='replace')
        raise RuntimeError(f'Gate HTTP {exc.code} url={url} body={body[:800]}') from exc


def load_gate_klines(contract, warm_iso=PRICE_WARM, end_iso=PRICE_END):
    by_ts = {}
    start = ts(warm_iso)
    stop = ts(end_iso)
    step = 30 * 24 * 3600
    while start < stop:
        end = min(stop - 1, start + step - 1)
        rows = gate_get('/futures/usdt/candlesticks', {
            'contract': contract,
            'from': str(start),
            'to': str(end),
            'interval': '1h',
            'timezone': 'utc0',
        })
        for row in rows:
            try:
                t = int(float(row['t'])) * 1000
                by_ts[t] = {
                    'openTime': t,
                    'open': float(row['o']),
                    'high': float(row['h']),
                    'low': float(row['l']),
                    'close': float(row['c']),
                    'volume': float(row.get('v', 0) or 0),
                    'closeTime': t + HOUR - 1,
                }
            except Exception:
                continue
        start = end + 1
    rows = [by_ts[k] for k in sorted(by_ts)]
    if len(rows) < 8_000:
        raise RuntimeError(f'Insufficient Gate {contract} rows={len(rows)}')
    return rows


def load_gate_funding(start_iso=FUND_START, end_iso=FUND_END):
    by_ts = {}
    start = ts(start_iso)
    stop = ts(end_iso)
    step = 30 * 24 * 3600
    while start < stop:
        end = min(stop - 1, start + step - 1)
        rows = gate_get('/futures/usdt/funding_rate', {
            'contract':'PENGU_USDT',
            'from':str(start),
            'to':str(end),
            'limit':'1000',
        })
        for row in rows:
            try:
                t = int(float(row['t'])) * 1000
                r = float(row['r'])
                by_ts[t] = {'fundingTime':t,'fundingRate':r}
            except Exception:
                continue
        start = end + 1
    rows = [by_ts[k] for k in sorted(by_ts)]
    if len(rows) < 100:
        raise RuntimeError(f'Insufficient Gate funding rows={len(rows)}')
    return rows


def write_gate_cache(pengu, btc, funding):
    cache = Path('.research-state/pengu-short-v12-okx-binance-gate')
    cache.mkdir(parents=True, exist_ok=True)
    (cache/'gate-PENGU_USDT.json').write_text(json.dumps(pengu,separators=(',',':')))
    (cache/'gate-BTC_USDT.json').write_text(json.dumps(btc,separators=(',',':')))
    (cache/'gate-PENGUUSDT-funding.json').write_text(json.dumps(funding,separators=(',',':')))


def gate_source(warm_iso, start_iso, end_iso):
    temp = v12.venue_source('Gate')
    text = temp.read_text()
    text = text.replace('const WARM_START = Date.parse("2024-12-17T00:00:00Z");', f'const WARM_START = Date.parse("{warm_iso}");')
    text = text.replace('const EVAL_START = Date.parse("2024-12-24T00:00:00Z");', f'const EVAL_START = Date.parse("{start_iso}");')
    text = text.replace('const EVAL_END = Date.parse("2026-08-01T00:00:00Z");', f'const EVAL_END = Date.parse("{end_iso}");')
    temp.write_text(text)
    return temp


def run_gate(label, warm_iso, start_iso, end_iso):
    temp = gate_source(warm_iso, start_iso, end_iso)
    output = ROOT / f'gate-{label}.json'
    env = dict(os.environ)
    env['PENGU_V11_OUT'] = str(output)
    try:
        cp = subprocess.run(['npx','tsx',str(temp)],env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
        (ROOT/f'gate-{label}.log').write_text(cp.stdout)
        print(cp.stdout)
        if cp.returncode != 0:
            raise RuntimeError(f'Gate {label} replay failed code={cp.returncode}')
        return json.loads(output.read_text())
    finally:
        temp.unlink(missing_ok=True)


def nonworse_short_slice(result):
    n = result['results']['NORMAL']
    s = result['results']['STRESS']
    b, c = n['BASELINE'], n['CANDIDATE']
    bs, cs = s['BASELINE'], s['CANDIDATE']
    def pf(x): return x.get('profitFactor') or 0
    def wr(x): return x.get('winRatePct') or 0
    return (
        c['trades'] >= b['trades']
        and wr(c) >= wr(b)
        and c['returnPct'] >= b['returnPct']
        and pf(c) >= pf(b)
        and c['maxDrawdownPct'] >= b['maxDrawdownPct']
        and wr(cs) >= wr(bs)
        and cs['returnPct'] >= bs['returnPct']
        and pf(cs) >= pf(bs)
        and cs['maxDrawdownPct'] >= bs['maxDrawdownPct']
    )


def main():
    # Development/confirmation venues: exact pre-registered V12, full history.
    binance_data = {
        'pengu': v12.v11runner.load_binance_klines('PENGUUSDT'),
        'btc': v12.v11runner.load_binance_klines('BTCUSDT'),
        'funding': v12.v11runner.load_binance_funding(),
    }
    okx = v12.run_venue('OKX')
    binance = v12.run_venue('Binance')

    # Untouched Gate price path is fetched only after all pre-registration SHAs exist.
    gate_pengu = load_gate_klines('PENGU_USDT')
    gate_btc = load_gate_klines('BTC_USDT')

    # A: full one-year price-edge holdout, funding deliberately zero for baseline AND candidate.
    write_gate_cache(gate_pengu, gate_btc, [])
    gate_price = run_gate('price1y', PRICE_WARM, PRICE_START, PRICE_END)
    gate_price_pass = bool(gate_price.get('promotion',{}).get('pass'))

    # B: actual Gate funding cost-sensitivity slice within the official 180-day history limit.
    gate_funding = load_gate_funding()
    write_gate_cache(gate_pengu, gate_btc, gate_funding)
    gate_funded = run_gate('funded5m', FUND_WARM, FUND_START, FUND_END)
    gate_funded_pass = nonworse_short_slice(gate_funded)

    venue_passes = {
        'OKX': bool(okx.get('promotion',{}).get('pass')),
        'Binance': bool(binance.get('promotion',{}).get('pass')),
        'GatePrice1Y': gate_price_pass,
        'GateFunded5M': gate_funded_pass,
    }
    out = {
        'status':'PASS_RESEARCH_ONLY',
        'schema':'pengu-short-v12-gate-final/v1',
        'candidate':CANDIDATE,
        'preRegistrationSha':V12_PRE_SHA,
        'gateRangeAddendumSha':GATE_RANGE_SHA,
        'gateFundingAddendumSha':GATE_FUNDING_SHA,
        'candidateCount':1,
        'thresholdSweep':False,
        'gatePerformanceObservedBeforeProtocol':False,
        'binanceVisionData':binance_data,
        'gateData':{
            'penguRows':len(gate_pengu),
            'btcRows':len(gate_btc),
            'fundingRowsActualSlice':len(gate_funding),
            'priceHoldout':[PRICE_START,PRICE_END],
            'fundedHoldout':[FUND_START,FUND_END],
        },
        'venues':{
            'OKX':okx,
            'Binance':binance,
            'GatePrice1Y':gate_price,
            'GateFunded5M':gate_funded,
        },
        'venuePasses':venue_passes,
        'promotionPass':all(venue_passes.values()),
        'safety':{'mode':'RESEARCH_ONLY','ordersSent':False,'liveChanged':False,'vpsChanged':False,'productionChanged':False},
    }
    (ROOT/'result.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'promotionPass':out['promotionPass'],'venuePasses':venue_passes},indent=2))

if __name__=='__main__':
    main()
