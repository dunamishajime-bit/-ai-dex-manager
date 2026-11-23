#!/usr/bin/env python3
import csv
import importlib.util
import io
import json
import os
import subprocess
import zipfile
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path('.research-state/pengu-short-v12-okx-binance-gate')
ROOT.mkdir(parents=True, exist_ok=True)
FROZEN_V11_SHA = '64b22dad74d1c026b2146d41d39cc8a3d3a819e3'
PRE_REGISTER_SHA = '2cfe0d7bb829e6cd928cef4871e1f0168c098506'
SOURCE = Path('scripts/research_pengu_short_v11_bybit_holdout.ts')

spec = importlib.util.spec_from_file_location('v11runner', 'scripts/research_pengu_short_v11_okx_binance.py')
v11runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v11runner)

GATE_BASE = 'https://api.gateio.ws/api/v4'
WARM_START_S = int(__import__('datetime').datetime.fromisoformat('2024-12-17T00:00:00+00:00').timestamp())
EVAL_END_S = int(__import__('datetime').datetime.fromisoformat('2026-08-01T00:00:00+00:00').timestamp())


def gate_get(path, params):
    url = GATE_BASE + path + '?' + urlencode(params)
    req = Request(url, headers={'Accept':'application/json','User-Agent':'DisDex-PENGU-V12-Holdout/1.0'})
    with urlopen(req, timeout=90) as response:
        return json.loads(response.read().decode('utf-8'))


def load_gate_klines(contract):
    by_ts = {}
    step = 70 * 24 * 3600
    start = WARM_START_S
    while start < EVAL_END_S:
        end = min(EVAL_END_S - 1, start + step - 1)
        rows = gate_get('/futures/usdt/candlesticks', {
            'contract': contract,
            'from': str(start),
            'to': str(end),
            'interval': '1h',
        })
        for row in rows:
            try:
                ts = int(row['t']) * 1000
                by_ts[ts] = {
                    'openTime': ts,
                    'open': float(row['o']),
                    'high': float(row['h']),
                    'low': float(row['l']),
                    'close': float(row['c']),
                    'volume': float(row.get('v', 0) or 0),
                    'closeTime': ts + 3_600_000 - 1,
                }
            except Exception:
                continue
        start = end + 1
    rows = [by_ts[k] for k in sorted(by_ts)]
    if len(rows) < 5_000:
        raise RuntimeError(f'Insufficient Gate {contract} rows={len(rows)}')
    p = ROOT / f'gate-{contract}.json'
    p.write_text(json.dumps(rows, separators=(',', ':')))
    return {'rows':len(rows),'first':rows[0]['openTime'],'last':rows[-1]['openTime']}


def load_gate_funding():
    by_ts = {}
    step = 90 * 24 * 3600
    start = WARM_START_S
    while start < EVAL_END_S:
        end = min(EVAL_END_S - 1, start + step - 1)
        rows = gate_get('/futures/usdt/funding_rate', {
            'contract':'PENGU_USDT',
            'from':str(start),
            'to':str(end),
            'limit':'1000',
        })
        for row in rows:
            try:
                ts = int(row['t']) * 1000
                rate = float(row['r'])
                by_ts[ts] = {'fundingTime':ts,'fundingRate':rate}
            except Exception:
                continue
        start = end + 1
    rows = [by_ts[k] for k in sorted(by_ts)]
    if len(rows) < 100:
        raise RuntimeError(f'Insufficient Gate funding rows={len(rows)}')
    (ROOT/'gate-PENGUUSDT-funding.json').write_text(json.dumps(rows,separators=(',',':')))
    return {'rows':len(rows),'first':rows[0]['fundingTime'],'last':rows[-1]['fundingTime']}


GATE_FUNCS = r'''async function downloadCandles(symbol: string) {
  const file = symbol === "PENGUUSDT" ? "gate-PENGU_USDT.json" : "gate-BTC_USDT.json";
  const raw = JSON.parse(await fs.readFile(`.research-state/pengu-short-v12-okx-binance-gate/${file}`, "utf8")) as DisDexV35Candle[];
  return raw.filter((candle) => candle.openTime >= WARM_START && candle.openTime < EVAL_END);
}

async function downloadFunding() {
  const raw = JSON.parse(await fs.readFile(".research-state/pengu-short-v12-okx-binance-gate/gate-PENGUUSDT-funding.json", "utf8")) as FundingPoint[];
  return raw.filter((point) => point.fundingTime >= WARM_START && point.fundingTime < EVAL_END);
}

'''

V12_REENTRY_OLD = '''    if (rows[cursor].candle.close < lowWater && rows[cursor].candle.close < features.ema72) {\n      reentryIndex = cursor + 1;\n      break;\n    }'''
V12_REENTRY_NEW = '''    const rapidRelativeWeakness = (rows[cursor].candle.openTime - trade.entryTs) <= (PENGU_DUAL_LS_V2.short.maxHoldHours / 4) * HOUR\n      && features.btcReturn24h >= 0;\n    if (rapidRelativeWeakness && rows[cursor].candle.close < lowWater && rows[cursor].candle.close < features.ema72) {\n      reentryIndex = cursor + 1;\n      break;\n    }'''


def venue_source(venue):
    source = SOURCE.read_text()
    begin = source.index('async function bybit(')
    end = source.index('function fundingBetween', begin)
    if venue == 'OKX':
        funcs = v11runner.OKX_FUNCS
    elif venue == 'Binance':
        funcs = v11runner.BINANCE_FUNCS
    else:
        funcs = GATE_FUNCS
    source = source[:begin] + funcs + source[end:]
    source = source.replace('venue: "Bybit"', f'venue: "{venue}"')
    source = source.replace('schema: "pengu-short-v11-bybit-holdout/v1"', f'schema: "pengu-short-v12-{venue.lower()}/v1"')
    source = source.replace('64b22dad74d1c026b2146d41d39cc8a3d3a819e3', PRE_REGISTER_SHA)
    source = source.replace('COUNTERWIND_PROGRESS_FAIL_REENTRY', 'RAPID_RISKON_RELATIVE_WEAKNESS_REENTRY')
    if V12_REENTRY_OLD not in source:
        raise RuntimeError('V11 reentry signature changed')
    source = source.replace(V12_REENTRY_OLD, V12_REENTRY_NEW)
    temp = Path(f'scripts/.pengu_v12_{venue.lower()}.ts')
    temp.write_text(source)
    return temp


def run_venue(venue):
    temp = venue_source(venue)
    output = ROOT / f'{venue.lower()}.json'
    env = dict(os.environ)
    env['PENGU_V11_OUT'] = str(output)
    try:
        cp = subprocess.run(['npx','tsx',str(temp)],env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
        (ROOT/f'{venue.lower()}.log').write_text(cp.stdout)
        print(cp.stdout)
        if cp.returncode != 0:
            raise RuntimeError(f'V12 {venue} replay failed code={cp.returncode}')
        result = json.loads(output.read_text())
        result['v12PreRegistrationSha'] = PRE_REGISTER_SHA
        result['v11SourceSha'] = FROZEN_V11_SHA
        result['candidateName'] = 'RAPID_RISKON_RELATIVE_WEAKNESS_REENTRY'
        output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
        return result
    finally:
        temp.unlink(missing_ok=True)


def main():
    # Binance official archive is reused only as a development/confirmation venue.
    binance_data = {
        'pengu': v11runner.load_binance_klines('PENGUUSDT'),
        'btc': v11runner.load_binance_klines('BTCUSDT'),
        'funding': v11runner.load_binance_funding(),
    }
    # Gate is intentionally first fetched after PRE_REGISTER_SHA exists.
    gate_data = {
        'pengu': load_gate_klines('PENGU_USDT'),
        'btc': load_gate_klines('BTC_USDT'),
        'funding': load_gate_funding(),
    }
    venues = {
        'OKX': run_venue('OKX'),
        'Binance': run_venue('Binance'),
        'Gate': run_venue('Gate'),
    }
    passes = {name: bool(result.get('promotion',{}).get('pass')) for name,result in venues.items()}
    result = {
        'status':'PASS_RESEARCH_ONLY',
        'schema':'pengu-short-v12-okx-binance-gate/v1',
        'preRegistrationSha':PRE_REGISTER_SHA,
        'v11SourceSha':FROZEN_V11_SHA,
        'candidate':'RAPID_RISKON_RELATIVE_WEAKNESS_REENTRY',
        'candidateCount':1,
        'thresholdSweep':False,
        'gateUntouchedBeforePreRegistration':True,
        'binanceVisionData':binance_data,
        'gateData':gate_data,
        'venues':venues,
        'venuePasses':passes,
        'promotionPass':all(passes.values()),
        'safety':{'mode':'RESEARCH_ONLY','ordersSent':False,'liveChanged':False,'vpsChanged':False,'productionChanged':False},
    }
    (ROOT/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'promotionPass':result['promotionPass'],'venuePasses':passes},ensure_ascii=False,indent=2))

if __name__=='__main__':
    main()
