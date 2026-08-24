#!/usr/bin/env python3
import importlib.util
import json
import os
import re
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path('.research-state/pengu-v20-recent-1y-dca')
ROOT.mkdir(parents=True, exist_ok=True)

V20_PRE_SHA = 'ad7cedb3cafaf9f9680e390112f72375d84b50ac'
DCA_PREREG_SHA = 'd2a8a7939b296913141658b66786289be7227c1f'
CANDIDATE = 'COUNTERWIND_VOL_TARGET_FAILURE_EXIT'
WARM_ISO = '2025-07-01T00:00:00Z'
EVAL_START_ISO = '2025-08-24T00:00:00Z'
EVAL_END_ISO = '2026-08-24T00:00:00Z'
HOUR = 3_600_000
INITIAL_CAPITAL = 10_000
MONTHLY_CONTRIBUTION = 10_000


def ms(iso):
    return int(datetime.fromisoformat(iso.replace('Z', '+00:00')).timestamp() * 1000)

WARM_START = ms(WARM_ISO)
EVAL_START = ms(EVAL_START_ISO)
EVAL_END = ms(EVAL_END_ISO)


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

v20 = load_module('v20_recent_dca', 'scripts/research_pengu_short_v20_vol_target_failure_exit.py')
v15 = load_module('v15_recent_dca', 'scripts/research_pengu_short_v15_close_probation_bitget.py')
ku = load_module('ku_recent_dca', 'scripts/research_pengu_short_v20_kucoin_holdout.py')


def json_get(base, path, params, retries=6):
    url = base + path + '?' + urlencode(params)
    last = None
    for attempt in range(retries):
        try:
            req = Request(url, headers={'Accept': 'application/json', 'User-Agent': 'DisDex-PENGU-V20-1Y-DCA/1.0'})
            with urlopen(req, timeout=90) as response:
                return json.loads(response.read().decode('utf-8'))
        except (HTTPError, URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
            last = exc
            if attempt + 1 == retries:
                break
            time.sleep(0.6 * (attempt + 1))
    raise RuntimeError(f'GET failed url={url}: {last}')


def assert_h1_grid(rows, symbol, minimum=8_000):
    rows = sorted(rows, key=lambda x: x['openTime'])
    if len(rows) < minimum:
        raise RuntimeError(f'Insufficient {symbol} H1 rows={len(rows)}')
    gaps = []
    for a, b in zip(rows, rows[1:]):
        if b['openTime'] - a['openTime'] != HOUR:
            gaps.append((a['openTime'], b['openTime']))
    if gaps:
        raise RuntimeError(f'{symbol} H1 gaps count={len(gaps)} first={gaps[:5]}')
    return rows


def load_binance_candles(symbol):
    base = 'https://fapi.binance.com'
    by_ts = {}
    cursor = WARM_START
    while cursor < EVAL_END:
        payload = json_get(base, '/fapi/v1/klines', {
            'symbol': symbol,
            'interval': '1h',
            'startTime': str(cursor),
            'endTime': str(EVAL_END - 1),
            'limit': '1500',
        })
        if not isinstance(payload, list) or not payload:
            break
        last = cursor
        for row in payload:
            ts = int(row[0])
            last = max(last, ts)
            if WARM_START <= ts < EVAL_END:
                by_ts[ts] = {
                    'openTime': ts,
                    'open': float(row[1]),
                    'high': float(row[2]),
                    'low': float(row[3]),
                    'close': float(row[4]),
                    'volume': float(row[5]),
                    'closeTime': int(row[6]),
                }
        if last < cursor:
            break
        cursor = last + HOUR
        time.sleep(0.08)
    rows = assert_h1_grid(list(by_ts.values()), f'Binance {symbol}')
    out = Path('.research-state/pengu-short-v11-okx-binance')
    out.mkdir(parents=True, exist_ok=True)
    (out / f'binance-{symbol}.json').write_text(json.dumps(rows, separators=(',', ':')))
    return {'rows': len(rows), 'first': rows[0]['openTime'], 'last': rows[-1]['openTime']}


def load_binance_funding():
    base = 'https://fapi.binance.com'
    by_ts = {}
    cursor = WARM_START
    while cursor < EVAL_END:
        payload = json_get(base, '/fapi/v1/fundingRate', {
            'symbol': 'PENGUUSDT',
            'startTime': str(cursor),
            'endTime': str(EVAL_END - 1),
            'limit': '1000',
        })
        if not isinstance(payload, list) or not payload:
            break
        last = cursor
        for row in payload:
            ts = int(row['fundingTime'])
            last = max(last, ts)
            if WARM_START <= ts < EVAL_END:
                by_ts[ts] = {'fundingTime': ts, 'fundingRate': float(row['fundingRate'])}
        if last <= cursor:
            break
        cursor = last + 1
        time.sleep(0.08)
    rows = [by_ts[k] for k in sorted(by_ts)]
    if len(rows) < 100:
        raise RuntimeError(f'Insufficient Binance funding rows={len(rows)}')
    out = Path('.research-state/pengu-short-v11-okx-binance')
    (out / 'binance-PENGUUSDT-funding.json').write_text(json.dumps(rows, separators=(',', ':')))
    return {'rows': len(rows), 'first': rows[0]['fundingTime'], 'last': rows[-1]['fundingTime']}


DCA_FUNCTION = r'''
function dcaMetrics(trades: Trade[]) {
  const initialCapital = 10000;
  const monthlyContribution = 10000;
  const deposits: number[] = [];
  const start = new Date(EVAL_START);
  let year = start.getUTCFullYear();
  let month = start.getUTCMonth() + 1;
  if (month >= 12) { year += 1; month = 0; }
  let next = Date.UTC(year, month, 1, 0, 0, 0, 0);
  while (next < EVAL_END) {
    deposits.push(next);
    const d = new Date(next);
    year = d.getUTCFullYear();
    month = d.getUTCMonth() + 1;
    if (month >= 12) { year += 1; month = 0; }
    next = Date.UTC(year, month, 1, 0, 0, 0, 0);
  }

  let balance = initialCapital;
  let contributed = initialCapital;
  let peak = balance;
  let maxDrawdown = 0;
  let depositIndex = 0;
  let previousExit = -Infinity;
  const curve: any[] = [{ ts: EVAL_START, type: "INITIAL", amount: initialCapital, balance }];
  const ordered = [...trades].sort((a, b) => a.entryTs - b.entryTs || a.exitTs - b.exitTs);

  for (const trade of ordered) {
    assert(trade.entryTs >= previousExit, `DCA overlay requires non-overlapping trades: ${trade.entryTs} < ${previousExit}`);
    while (depositIndex < deposits.length && deposits[depositIndex] < trade.entryTs) {
      balance += monthlyContribution;
      contributed += monthlyContribution;
      peak = Math.max(peak, balance);
      curve.push({ ts: deposits[depositIndex], type: "CONTRIBUTION", amount: monthlyContribution, balance });
      depositIndex += 1;
    }
    const entryEquity = balance;
    while (depositIndex < deposits.length && deposits[depositIndex] <= trade.exitTs) {
      balance += monthlyContribution;
      contributed += monthlyContribution;
      peak = Math.max(peak, balance);
      curve.push({ ts: deposits[depositIndex], type: "CONTRIBUTION", amount: monthlyContribution, balance });
      depositIndex += 1;
    }
    const pnl = entryEquity * trade.accountReturn;
    balance += pnl;
    peak = Math.max(peak, balance);
    maxDrawdown = Math.min(maxDrawdown, balance / peak - 1);
    curve.push({ ts: trade.exitTs, type: "TRADE_EXIT", entryTs: trade.entryTs, side: trade.side,
      accountReturn: trade.accountReturn, entryEquity, pnl, balance });
    previousExit = trade.exitTs;
  }

  while (depositIndex < deposits.length) {
    balance += monthlyContribution;
    contributed += monthlyContribution;
    peak = Math.max(peak, balance);
    curve.push({ ts: deposits[depositIndex], type: "CONTRIBUTION", amount: monthlyContribution, balance });
    depositIndex += 1;
  }

  return {
    initialCapital,
    monthlyContribution,
    contributionCount: deposits.length,
    totalContributed: contributed,
    finalBalance: balance,
    netProfit: balance - contributed,
    profitPctOnContributed: (balance / contributed - 1) * 100,
    accountBalanceMaxDrawdownPct: maxDrawdown * 100,
    depositTimes: deposits,
    curve,
  };
}
'''


def patch_source(temp, venue):
    text = temp.read_text()
    text = re.sub(r'const WARM_START = Date\.parse\("[^"]+"\);', f'const WARM_START = Date.parse("{WARM_ISO}");', text, count=1)
    text = re.sub(r'const EVAL_START = Date\.parse\("[^"]+"\);', f'const EVAL_START = Date.parse("{EVAL_START_ISO}");', text, count=1)
    text = re.sub(r'const EVAL_END = Date\.parse\("[^"]+"\);', f'const EVAL_END = Date.parse("{EVAL_END_ISO}");', text, count=1)
    if CANDIDATE not in text or V20_PRE_SHA not in text:
        raise RuntimeError(f'{venue}: frozen V20 identity missing from generated source')
    marker = '\nfunction foldName(timestamp: number) {'
    if marker not in text:
        raise RuntimeError(f'{venue}: foldName marker missing')
    text = text.replace(marker, '\n' + DCA_FUNCTION + marker, 1)
    result_marker = '      CANDIDATE: metrics(candidate),\n      FOLDS: folds,'
    if result_marker not in text:
        raise RuntimeError(f'{venue}: result marker missing')
    text = text.replace(result_marker,
        '      CANDIDATE: metrics(candidate),\n      DCA: dcaMetrics(candidate),\n      CANDIDATE_TRADES: candidate,\n      FOLDS: folds,', 1)
    out = Path(f'scripts/.pengu_v20_recent_1y_dca_{venue.lower()}.ts')
    out.write_text(text)
    temp.unlink(missing_ok=True)
    return out


def run_ts(temp, venue):
    out = ROOT / f'{venue.lower()}.json'
    env = dict(os.environ)
    env['PENGU_V11_OUT'] = str(out)
    try:
        cp = subprocess.run(['npx', 'tsx', str(temp)], env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        (ROOT / f'{venue.lower()}.log').write_text(cp.stdout)
        if cp.returncode != 0:
            raise RuntimeError(f'{venue} evaluator failed code={cp.returncode}: {cp.stdout[-2000:]}')
        return json.loads(out.read_text())
    finally:
        temp.unlink(missing_ok=True)


def monthly_balances(dca):
    events = sorted(dca['curve'], key=lambda x: (x['ts'], 0 if x['type'] == 'CONTRIBUTION' else 1))
    out = []
    cur_balance = INITIAL_CAPITAL
    idx = 0
    y, m = 2025, 9
    while (y, m) <= (2026, 8):
        if m == 12:
            ny, nm = y + 1, 1
        else:
            ny, nm = y, m + 1
        boundary = int(datetime(ny, nm, 1, tzinfo=timezone.utc).timestamp() * 1000)
        while idx < len(events) and events[idx]['ts'] < boundary:
            cur_balance = events[idx]['balance']
            idx += 1
        out.append({'month': f'{y:04d}-{m:02d}', 'endingBalance': cur_balance})
        y, m = ny, nm
    return out


def compact(result):
    normal = result['results']['NORMAL']
    stress = result['results']['STRESS']
    return {
        'normal': {'metrics': normal['CANDIDATE'], 'dca': {k: v for k, v in normal['DCA'].items() if k != 'curve'},
                   'monthlyBalances': monthly_balances(normal['DCA'])},
        'stress': {'metrics': stress['CANDIDATE'], 'dca': {k: v for k, v in stress['DCA'].items() if k != 'curve'},
                   'monthlyBalances': monthly_balances(stress['DCA'])},
    }


def prepare_bitget():
    v15.v13.WARM_START = WARM_START
    v15.v13.EVAL_START = EVAL_START
    v15.v13.EVAL_END = EVAL_END
    p = v15.dense_bitget_candles('PENGUUSDT')
    b = v15.dense_bitget_candles('BTCUSDT')
    f = v15.v13.load_bitget_funding()
    return {'pengu': p, 'btc': b, 'funding': f}


def prepare_kucoin():
    ku.WARM_START = WARM_START
    ku.EVAL_START = EVAL_START
    ku.EVAL_END = EVAL_END
    return {
        'pengu': ku.load_klines('PENGUUSDTM'),
        'btc': ku.load_klines('XBTUSDTM'),
        'funding': ku.load_funding(),
    }


def run_venue(venue):
    prep = None
    if venue == 'Binance':
        prep = {'pengu': load_binance_candles('PENGUUSDT'), 'btc': load_binance_candles('BTCUSDT'), 'funding': load_binance_funding()}
        temp = v20.source_for('Binance')
    elif venue == 'OKX':
        temp = v20.source_for('OKX')
    elif venue == 'Bitget':
        prep = prepare_bitget()
        temp = v20.source_for('Bitget')
    elif venue == 'KuCoin':
        prep = prepare_kucoin()
        temp = ku.kucoin_source()
    else:
        raise ValueError(venue)
    patched = patch_source(temp, venue)
    result = run_ts(patched, venue)
    if result.get('preRegistrationSha') != V20_PRE_SHA:
        raise RuntimeError(f'{venue}: V20 preregistration mismatch')
    if result.get('preRegisteredCandidate', {}).get('name') != CANDIDATE:
        raise RuntimeError(f'{venue}: candidate mismatch')
    return {'dataPreparation': prep, 'result': result, 'summary': compact(result)}


def main():
    venues = {}
    for venue in ('OKX', 'Binance', 'Bitget', 'KuCoin'):
        try:
            venues[venue] = {'status': 'COMPLETED', **run_venue(venue)}
        except Exception as exc:
            venues[venue] = {'status': 'BLOCKED_DATA_OR_ADAPTER', 'error': str(exc)}
            (ROOT / f'{venue.lower()}-error.txt').write_text(str(exc) + '\n')

    completed = [v for v in venues.values() if v['status'] == 'COMPLETED']
    if not completed:
        status = 'BLOCKED_ALL_VENUES'
    else:
        status = 'COMPLETED_RESEARCH_ONLY'
    payload = {
        'status': status,
        'schema': 'pengu-v20-recent-1y-dca/v1',
        'candidate': CANDIDATE,
        'v20PreRegistrationSha': V20_PRE_SHA,
        'dcaPreRegistrationSha': DCA_PREREG_SHA,
        'window': {'warmStart': WARM_ISO, 'evaluationStart': EVAL_START_ISO, 'evaluationEnd': EVAL_END_ISO},
        'capitalPlan': {'currency': 'JPY', 'initialCapital': INITIAL_CAPITAL, 'monthlyContribution': MONTHLY_CONTRIBUTION,
                        'scheduledContributionCount': 12, 'totalContributed': 130_000,
                        'contributionRule': 'first day 00:00 UTC; deposits during an open trade are not retroactively exposed'},
        'venues': venues,
        'safety': {'mode': 'RESEARCH_ONLY', 'ordersSent': False, 'liveChanged': False, 'vpsChanged': False, 'productionChanged': False},
    }
    (ROOT / 'result.json').write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({
        'status': status,
        'completedVenues': [k for k, v in venues.items() if v['status'] == 'COMPLETED'],
        'blockedVenues': {k: v.get('error') for k, v in venues.items() if v['status'] != 'COMPLETED'},
        'summaries': {k: v.get('summary') for k, v in venues.items() if v['status'] == 'COMPLETED'},
        'safety': payload['safety'],
    }, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main()
