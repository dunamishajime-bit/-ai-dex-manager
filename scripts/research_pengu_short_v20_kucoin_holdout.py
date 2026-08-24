#!/usr/bin/env python3
import importlib.util
import json
import os
import subprocess
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path('.research-state/pengu-short-v20-kucoin-holdout')
ROOT.mkdir(parents=True, exist_ok=True)
PRE_SHA = 'ad7cedb3cafaf9f9680e390112f72375d84b50ac'
HOLDOUT_OPEN_SHA = '8ed0f2b3399e0d24882c5852cb7b336f874f441f'
SYMBOL_NORMALIZATION_SHA = '1a5f75577b426386a5f76179e220c28ba00cf821'
CANDIDATE = 'COUNTERWIND_VOL_TARGET_FAILURE_EXIT'
BASE_URL = 'https://api-futures.kucoin.com'
HOUR = 3_600_000
DAY = 24 * HOUR
WARM_START = int(__import__('datetime').datetime.fromisoformat('2025-01-01T00:00:00+00:00').timestamp() * 1000)
EVAL_START = WARM_START + 168 * HOUR
EVAL_END = int(__import__('datetime').datetime.fromisoformat('2026-08-01T00:00:00+00:00').timestamp() * 1000)

spec = importlib.util.spec_from_file_location('v20', 'scripts/research_pengu_short_v20_vol_target_failure_exit.py')
v20 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v20)


class HoldoutDataBlock(RuntimeError):
    pass


class HoldoutAdapterBlock(RuntimeError):
    pass


def kucoin_get(path, params=None):
    url = BASE_URL + path
    if params:
        url += '?' + urlencode(params)
    last = None
    for attempt in range(5):
        try:
            req = Request(url, headers={'Accept': 'application/json', 'User-Agent': 'DisDex-PENGU-V20-Holdout/1.0'})
            with urlopen(req, timeout=60) as response:
                payload = json.loads(response.read().decode('utf-8'))
            if str(payload.get('code')) != '200000':
                raise HoldoutDataBlock(f'KuCoin code={payload.get("code")} msg={payload.get("msg")} path={path}')
            return payload.get('data')
        except HoldoutDataBlock:
            raise
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError, OSError) as exc:
            last = exc
            if attempt == 4:
                break
            time.sleep(0.5 * (attempt + 1))
    raise HoldoutDataBlock(f'KuCoin request failed path={path}: {last}')


def verify_contract(symbol):
    data = kucoin_get(f'/api/v1/contracts/{symbol}')
    if not isinstance(data, dict) or data.get('symbol') != symbol:
        raise HoldoutDataBlock(f'Unexpected KuCoin contract payload for {symbol}')
    first_open = data.get('firstOpenDate')
    if isinstance(first_open, (int, float)) and int(first_open) > WARM_START:
        raise HoldoutDataBlock(f'{symbol} firstOpenDate={int(first_open)} is later than frozen warm start={WARM_START}')
    return {'symbol': symbol, 'firstOpenDate': first_open, 'status': data.get('status')}


def norm_ts(value):
    ts = int(float(value))
    while ts > 10_000_000_000_000:
        ts //= 1000
    if ts < 10_000_000_000:
        ts *= 1000
    return ts


def load_klines(symbol):
    verify_contract(symbol)
    by_ts = {}
    cursor = WARM_START
    calls = 0
    while cursor < EVAL_END:
        end = min(EVAL_END - HOUR, cursor + 479 * HOUR)
        data = kucoin_get('/api/v1/kline/query', {
            'symbol': symbol,
            'granularity': '3600',
            'from': str(cursor),
            'to': str(end),
        })
        calls += 1
        if not isinstance(data, list):
            raise HoldoutDataBlock(f'KuCoin {symbol} kline payload is not a list')
        for row in data:
            if not isinstance(row, list) or len(row) < 6:
                continue
            try:
                ts = norm_ts(row[0])
                if WARM_START <= ts < EVAL_END:
                    by_ts[ts] = {
                        'openTime': ts,
                        'open': float(row[1]),
                        'high': float(row[2]),
                        'low': float(row[3]),
                        'close': float(row[4]),
                        'volume': float(row[5]),
                        'closeTime': ts + HOUR - 1,
                    }
            except (TypeError, ValueError):
                continue
        cursor = end + HOUR
        time.sleep(0.08)

    expected = list(range(WARM_START, EVAL_END, HOUR))
    actual = sorted(by_ts)
    expected_set = set(expected)
    actual_set = set(actual)
    missing = sorted(expected_set - actual_set)
    extra = sorted(actual_set - expected_set)
    if missing or extra or actual != expected:
        raise HoldoutDataBlock(
            f'KuCoin {symbol} H1 grid incomplete expected={len(expected)} actual={len(actual)} '
            f'missing={missing[:20]} extra={extra[:20]}'
        )
    rows = [by_ts[ts] for ts in actual]
    path = ROOT / f'kucoin-{symbol}.json'
    path.write_text(json.dumps(rows, separators=(',', ':')))
    return {'rows': len(rows), 'calls': calls, 'first': rows[0]['openTime'], 'last': rows[-1]['openTime']}


def load_funding():
    symbol = 'PENGUUSDTM'
    by_ts = {}
    cursor = WARM_START
    calls = 0
    while cursor < EVAL_END:
        end = min(EVAL_END - 1, cursor + 7 * DAY - 1)
        data = kucoin_get('/api/v1/contract/funding-rates', {
            'symbol': symbol,
            'from': str(cursor),
            'to': str(end),
        })
        calls += 1
        if not isinstance(data, list):
            raise HoldoutDataBlock('KuCoin funding payload is not a list')
        for item in data:
            if not isinstance(item, dict):
                continue
            try:
                ts = norm_ts(item.get('timepoint'))
                rate = float(item.get('fundingRate'))
            except (TypeError, ValueError):
                continue
            if WARM_START <= ts < EVAL_END:
                by_ts[ts] = {'fundingTime': ts, 'fundingRate': rate}
        cursor = end + 1
        time.sleep(0.1)

    rows = [by_ts[k] for k in sorted(by_ts)]
    if not rows:
        raise HoldoutDataBlock('KuCoin PENGU funding history is empty')
    if rows[0]['fundingTime'] > EVAL_START:
        raise HoldoutDataBlock(
            f'KuCoin funding begins after first eligible evaluation: first={rows[0]["fundingTime"]} evalStart={EVAL_START}'
        )
    if rows[-1]['fundingTime'] < EVAL_END - 12 * HOUR:
        raise HoldoutDataBlock(
            f'KuCoin funding ends too early: last={rows[-1]["fundingTime"]} cutoff={EVAL_END}'
        )
    gaps = []
    for a, b in zip(rows, rows[1:]):
        delta = b['fundingTime'] - a['fundingTime']
        if delta > 24 * HOUR:
            gaps.append({'left': a['fundingTime'], 'right': b['fundingTime'], 'hours': delta / HOUR})
    if gaps:
        raise HoldoutDataBlock(f'KuCoin funding contains >24h gaps: {gaps[:20]}')
    (ROOT / 'kucoin-PENGUUSDTM-funding.json').write_text(json.dumps(rows, separators=(',', ':')))
    return {'rows': len(rows), 'calls': calls, 'first': rows[0]['fundingTime'], 'last': rows[-1]['fundingTime']}


KUCOIN_FUNCS = r'''async function downloadCandles(symbol: string) {
  const mapped = symbol === "PENGUUSDT" ? "PENGUUSDTM" : symbol === "BTCUSDT" ? "XBTUSDTM" : symbol;
  const raw = JSON.parse(await fs.readFile(`.research-state/pengu-short-v20-kucoin-holdout/kucoin-${mapped}.json`, "utf8")) as DisDexV35Candle[];
  return raw.filter((candle) => candle.openTime >= WARM_START && candle.openTime < EVAL_END);
}

async function downloadFunding() {
  const raw = JSON.parse(await fs.readFile(".research-state/pengu-short-v20-kucoin-holdout/kucoin-PENGUUSDTM-funding.json", "utf8")) as FundingPoint[];
  return raw.filter((point) => point.fundingTime >= WARM_START && point.fundingTime < EVAL_END);
}

'''


def kucoin_source():
    temp = v20.source_for('Binance')
    text = temp.read_text()
    temp.unlink(missing_ok=True)

    old_warm = 'const WARM_START = Date.parse("2024-12-17T00:00:00Z");'
    old_eval = 'const EVAL_START = Date.parse("2024-12-24T00:00:00Z");'
    new_warm = 'const WARM_START = Date.parse("2025-01-01T00:00:00Z");'
    new_eval = 'const EVAL_START = Date.parse("2025-01-08T00:00:00Z");'
    if text.count(old_warm) != 1 or text.count(old_eval) != 1:
        raise HoldoutAdapterBlock('Frozen source warm/eval constants changed')
    text = text.replace(old_warm, new_warm, 1).replace(old_eval, new_eval, 1)

    begin = text.index('async function downloadCandles(')
    end = text.index('function fundingBetween', begin)
    text = text[:begin] + KUCOIN_FUNCS + text[end:]
    if 'venue: "Binance"' not in text:
        raise HoldoutAdapterBlock('Frozen Binance venue marker missing')
    text = text.replace('venue: "Binance"', 'venue: "KuCoin"')
    text = text.replace('pengu-short-v20-binance', 'pengu-short-v20-kucoin-holdout')

    out = Path('scripts/.pengu_v20_kucoin_holdout.ts')
    out.write_text(text)
    return out


def run_kucoin():
    temp = kucoin_source()
    out = ROOT / 'kucoin.json'
    env = dict(os.environ)
    env['PENGU_V11_OUT'] = str(out)
    try:
        cp = subprocess.run(['npx', 'tsx', str(temp)], env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        (ROOT / 'kucoin.log').write_text(cp.stdout)
        print(cp.stdout)
        if cp.returncode != 0:
            raise HoldoutAdapterBlock(f'V20 KuCoin evaluator failed code={cp.returncode}')
        return json.loads(out.read_text())
    finally:
        temp.unlink(missing_ok=True)


def blocked_payload(status, exc, market_data_observed):
    return {
        'status': status,
        'schema': 'pengu-short-v20-kucoin-final-holdout/v1',
        'candidate': CANDIDATE,
        'preRegistrationSha': PRE_SHA,
        'holdoutOpenSha': HOLDOUT_OPEN_SHA,
        'symbolNormalizationSha': SYMBOL_NORMALIZATION_SHA,
        'knownVenueFormalRun': 32683827489,
        'knownVenuePasses': {'OKX': True, 'Binance': True, 'GateDiagnostic': True, 'Bitget': True},
        'kucoinMarketDataObserved': market_data_observed,
        'kucoinPerformanceObserved': False,
        'strategyPerformanceCalculated': False,
        'finalHoldoutPass': None,
        'error': str(exc),
        'safety': {'mode':'RESEARCH_ONLY','ordersSent':False,'liveChanged':False,'vpsChanged':False,'productionChanged':False},
    }


def main():
    market_data_observed = False
    try:
        contracts = {
            'pengu': verify_contract('PENGUUSDTM'),
            'btc': verify_contract('XBTUSDTM'),
        }
        market_data_observed = True
        data = {
            'pengu': load_klines('PENGUUSDTM'),
            'btc': load_klines('XBTUSDTM'),
            'funding': load_funding(),
            'contracts': contracts,
        }
    except HoldoutDataBlock as exc:
        payload = blocked_payload('BLOCKED_HOLDOUT_DATA', exc, market_data_observed)
        (ROOT / 'holdout-result.json').write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n')
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return

    try:
        result = run_kucoin()
    except HoldoutAdapterBlock as exc:
        payload = blocked_payload('BLOCKED_HOLDOUT_ADAPTER', exc, True)
        (ROOT / 'holdout-result.json').write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n')
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return

    final_pass = bool(result.get('promotion', {}).get('pass'))
    payload = {
        'status': 'PASS_RESEARCH_ONLY' if final_pass else 'FAIL_RESEARCH_ONLY',
        'schema': 'pengu-short-v20-kucoin-final-holdout/v1',
        'candidate': CANDIDATE,
        'preRegistrationSha': PRE_SHA,
        'holdoutOpenSha': HOLDOUT_OPEN_SHA,
        'symbolNormalizationSha': SYMBOL_NORMALIZATION_SHA,
        'knownVenueFormalRun': 32683827489,
        'knownVenuePasses': {'OKX': True, 'Binance': True, 'GateDiagnostic': True, 'Bitget': True},
        'data': data,
        'kucoinMarketDataObserved': True,
        'kucoinPerformanceObserved': True,
        'strategyPerformanceCalculated': True,
        'finalHoldoutPass': final_pass,
        'kucoin': result,
        'safety': {'mode':'RESEARCH_ONLY','ordersSent':False,'liveChanged':False,'vpsChanged':False,'productionChanged':False},
    }
    (ROOT / 'holdout-result.json').write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({
        'status': payload['status'],
        'finalHoldoutPass': final_pass,
        'promotion': result.get('promotion'),
        'normal': result.get('results', {}).get('NORMAL'),
        'stress': result.get('results', {}).get('STRESS'),
        'data': data,
        'safety': payload['safety'],
    }, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
