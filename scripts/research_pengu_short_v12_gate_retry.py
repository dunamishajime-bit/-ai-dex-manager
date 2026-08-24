#!/usr/bin/env python3
import importlib.util
import json
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

spec = importlib.util.spec_from_file_location('v12', 'scripts/research_pengu_short_v12_okx_binance_gate.py')
v12 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v12)


def gate_get(path, params):
    url = v12.GATE_BASE + path + '?' + urlencode(params)
    req = Request(url, headers={'Accept':'application/json','User-Agent':'DisDex-PENGU-V12-Holdout/1.0'})
    try:
        with urlopen(req, timeout=90) as response:
            return json.loads(response.read().decode('utf-8'))
    except HTTPError as exc:
        body = exc.read().decode('utf-8', errors='replace')
        raise RuntimeError(f'Gate HTTP {exc.code} url={url} body={body[:800]}') from exc


def load_gate_klines(contract):
    by_ts = {}
    # Conservative 30-day windows keep the request well below Gate's 2000-candle maximum.
    step = 30 * 24 * 3600
    start = v12.WARM_START_S
    while start < v12.EVAL_END_S:
        end = min(v12.EVAL_END_S - 1, start + step - 1)
        rows = gate_get('/futures/usdt/candlesticks', {
            'contract': contract,
            'from': str(start),
            'to': str(end),
            'interval': '1h',
            'timezone': 'utc0',
        })
        for row in rows:
            try:
                ts = int(float(row['t'])) * 1000
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
    p = v12.ROOT / f'gate-{contract}.json'
    p.write_text(json.dumps(rows, separators=(',', ':')))
    return {'rows':len(rows),'first':rows[0]['openTime'],'last':rows[-1]['openTime']}


def load_gate_funding():
    by_ts = {}
    step = 60 * 24 * 3600
    start = v12.WARM_START_S
    while start < v12.EVAL_END_S:
        end = min(v12.EVAL_END_S - 1, start + step - 1)
        rows = gate_get('/futures/usdt/funding_rate', {
            'contract':'PENGU_USDT',
            'from':str(start),
            'to':str(end),
            'limit':'1000',
        })
        for row in rows:
            try:
                ts = int(float(row['t'])) * 1000
                rate = float(row['r'])
                by_ts[ts] = {'fundingTime':ts,'fundingRate':rate}
            except Exception:
                continue
        start = end + 1
    rows = [by_ts[k] for k in sorted(by_ts)]
    if len(rows) < 100:
        raise RuntimeError(f'Insufficient Gate funding rows={len(rows)}')
    (v12.ROOT/'gate-PENGUUSDT-funding.json').write_text(json.dumps(rows,separators=(',',':')))
    return {'rows':len(rows),'first':rows[0]['fundingTime'],'last':rows[-1]['fundingTime']}


v12.gate_get = gate_get
v12.load_gate_klines = load_gate_klines
v12.load_gate_funding = load_gate_funding
v12.main()
