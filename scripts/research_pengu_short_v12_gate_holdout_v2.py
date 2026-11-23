#!/usr/bin/env python3
import importlib.util
import json
from datetime import datetime
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

spec = importlib.util.spec_from_file_location('v12', 'scripts/research_pengu_short_v12_okx_binance_gate.py')
v12 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v12)

GATE_ADDENDUM_SHA = '5cb48d6aa311a1d0574cd30b7ca0eca73b5ec1cf'
GATE_WARM_ISO = '2025-07-10T00:00:00Z'
GATE_EVAL_START_ISO = '2025-08-01T00:00:00Z'
GATE_EVAL_END_ISO = '2026-08-01T00:00:00Z'
GATE_WARM_S = int(datetime.fromisoformat(GATE_WARM_ISO.replace('Z','+00:00')).timestamp())
GATE_END_S = int(datetime.fromisoformat(GATE_EVAL_END_ISO.replace('Z','+00:00')).timestamp())


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
    step = 30 * 24 * 3600
    start = GATE_WARM_S
    while start < GATE_END_S:
        end = min(GATE_END_S - 1, start + step - 1)
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
    if len(rows) < 8_000:
        raise RuntimeError(f'Insufficient Gate {contract} rows={len(rows)}')
    p = v12.ROOT / f'gate-{contract}.json'
    p.write_text(json.dumps(rows, separators=(',', ':')))
    return {'rows':len(rows),'first':rows[0]['openTime'],'last':rows[-1]['openTime']}


def load_gate_funding():
    by_ts = {}
    step = 60 * 24 * 3600
    start = GATE_WARM_S
    while start < GATE_END_S:
        end = min(GATE_END_S - 1, start + step - 1)
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
    if len(rows) < 500:
        raise RuntimeError(f'Insufficient Gate funding rows={len(rows)}')
    (v12.ROOT/'gate-PENGUUSDT-funding.json').write_text(json.dumps(rows,separators=(',',':')))
    return {'rows':len(rows),'first':rows[0]['fundingTime'],'last':rows[-1]['fundingTime']}


_original_venue_source = v12.venue_source

def venue_source(venue):
    temp = _original_venue_source(venue)
    if venue == 'Gate':
        text = temp.read_text()
        text = text.replace('const WARM_START = Date.parse("2024-12-17T00:00:00Z");', f'const WARM_START = Date.parse("{GATE_WARM_ISO}");')
        text = text.replace('const EVAL_START = Date.parse("2024-12-24T00:00:00Z");', f'const EVAL_START = Date.parse("{GATE_EVAL_START_ISO}");')
        text = text.replace('const EVAL_END = Date.parse("2026-08-01T00:00:00Z");', f'const EVAL_END = Date.parse("{GATE_EVAL_END_ISO}");')
        temp.write_text(text)
    return temp


v12.gate_get = gate_get
v12.load_gate_klines = load_gate_klines
v12.load_gate_funding = load_gate_funding
v12.venue_source = venue_source
v12.main()

result_path = v12.ROOT / 'result.json'
result = json.loads(result_path.read_text())
result['gateHoldoutAddendumSha'] = GATE_ADDENDUM_SHA
result['gateHoldoutPeriod'] = [GATE_EVAL_START_ISO, GATE_EVAL_END_ISO]
result['gateWarmupStart'] = GATE_WARM_ISO
result_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'promotionPass':result['promotionPass'],'venuePasses':result['venuePasses'],'gatePeriod':result['gateHoldoutPeriod']}, indent=2))
