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

ROOT = Path('.research-state/pengu-short-v11-okx-binance')
ROOT.mkdir(parents=True, exist_ok=True)
ARCHIVE = 'https://data.binance.vision/data/futures/um/monthly'
SOURCE = Path('scripts/research_pengu_short_v11_bybit_holdout.ts')
FROZEN_SHA = '64b22dad74d1c026b2146d41d39cc8a3d3a819e3'


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
        with urlopen(req, timeout=90) as response:
            return response.read()
    except HTTPError as exc:
        if exc.code == 404:
            return None
        raise


def norm_ts(value):
    x = int(float(value))
    while x > 10_000_000_000_000:
        x //= 1000
    return x


def load_binance_klines(symbol):
    by_ts, found = {}, []
    for ym in month_keys(2024, 12, 2026, 7):
        blob = fetch_zip(f'{ARCHIVE}/klines/{symbol}/1h/{symbol}-1h-{ym}.zip')
        if blob is None:
            continue
        found.append(ym)
        with zipfile.ZipFile(io.BytesIO(blob)) as archive:
            with archive.open(archive.namelist()[0]) as fh:
                for row in csv.reader(io.TextIOWrapper(fh, encoding='utf-8-sig')):
                    if len(row) < 7:
                        continue
                    try:
                        ts = norm_ts(row[0])
                        by_ts[ts] = {
                            'openTime': ts,
                            'open': float(row[1]),
                            'high': float(row[2]),
                            'low': float(row[3]),
                            'close': float(row[4]),
                            'volume': float(row[5]),
                            'closeTime': norm_ts(row[6]),
                        }
                    except Exception:
                        continue
    rows = [by_ts[key] for key in sorted(by_ts)]
    minimum = 5_000
    if len(rows) < minimum:
        raise RuntimeError(f'Insufficient Binance Vision {symbol} rows={len(rows)} months={found}')
    path = ROOT / f'binance-{symbol}.json'
    path.write_text(json.dumps(rows, separators=(',', ':')))
    return {'rows': len(rows), 'months': found, 'first': rows[0]['openTime'], 'last': rows[-1]['openTime']}


def load_binance_funding():
    by_ts, found = {}, []
    symbol = 'PENGUUSDT'
    for ym in month_keys(2024, 12, 2026, 7):
        blob = fetch_zip(f'{ARCHIVE}/fundingRate/{symbol}/{symbol}-fundingRate-{ym}.zip')
        if blob is None:
            continue
        found.append(ym)
        with zipfile.ZipFile(io.BytesIO(blob)) as archive:
            with archive.open(archive.namelist()[0]) as fh:
                rows = list(csv.reader(io.TextIOWrapper(fh, encoding='utf-8-sig')))
        if not rows:
            continue
        header = [x.strip().lower() for x in rows[0]]
        has_header = any(any(ch.isalpha() for ch in cell) for cell in header)
        if has_header:
            ti = next((i for i, cell in enumerate(header) if 'time' in cell), 0)
            ri = next((i for i, cell in enumerate(header) if 'funding' in cell and 'rate' in cell), len(header) - 1)
            data = rows[1:]
        else:
            ti, ri, data = 0, len(rows[0]) - 1, rows
        for row in data:
            if len(row) <= max(ti, ri):
                continue
            try:
                ts, rate = norm_ts(row[ti]), float(row[ri])
            except Exception:
                continue
            by_ts[ts] = {'fundingTime': ts, 'fundingRate': rate}
    rows = [by_ts[key] for key in sorted(by_ts)]
    if len(rows) < 100:
        raise RuntimeError(f'Insufficient Binance Vision funding rows={len(rows)} months={found}')
    (ROOT / 'binance-PENGUUSDT-funding.json').write_text(json.dumps(rows, separators=(',', ':')))
    return {'rows': len(rows), 'months': found, 'first': rows[0]['fundingTime'], 'last': rows[-1]['fundingTime']}


BINANCE_FUNCS = r'''async function downloadCandles(symbol: string) {
  const raw = JSON.parse(await fs.readFile(`.research-state/pengu-short-v11-okx-binance/binance-${symbol}.json`, "utf8")) as DisDexV35Candle[];
  return raw.filter((candle) => candle.openTime >= WARM_START && candle.openTime < EVAL_END);
}

async function downloadFunding() {
  const raw = JSON.parse(await fs.readFile(".research-state/pengu-short-v11-okx-binance/binance-PENGUUSDT-funding.json", "utf8")) as FundingPoint[];
  return raw.filter((point) => point.fundingTime >= WARM_START && point.fundingTime < EVAL_END);
}

'''

OKX_FUNCS = r'''async function okx(pathname: string, query: Record<string, string>) {
  const url = new URL(pathname, "https://www.okx.com");
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  let lastError: unknown;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { accept: "application/json", "user-agent": "DisDex-PENGU-V11-OKX/1.0" } });
      if (!response.ok) throw new Error(`OKX HTTP ${response.status}`);
      const json = await response.json() as any;
      if (json?.code !== "0" || !Array.isArray(json?.data)) throw new Error(`OKX code=${json?.code} msg=${json?.msg}`);
      return json.data as any[];
    } catch (error) {
      lastError = error;
      await sleep(500 * (attempt + 1));
    }
  }
  throw lastError;
}

async function downloadCandles(symbol: string) {
  const instId = symbol === "PENGUUSDT" ? "PENGU-USDT-SWAP" : "BTC-USDT-SWAP";
  const byTs = new Map<number, DisDexV35Candle>();
  let cursor = EVAL_END + 1;
  let previousOldest = Number.POSITIVE_INFINITY;
  for (let page = 0; page < 220 && cursor > WARM_START; page += 1) {
    const list = await okx("/api/v5/market/history-candles", { instId, bar: "1H", after: String(cursor), limit: "100" });
    if (!list.length) break;
    let oldest = Number.POSITIVE_INFINITY;
    for (const row of list) {
      const ts = Number(row[0]);
      oldest = Math.min(oldest, ts);
      if (ts < WARM_START || ts >= EVAL_END || String(row[8] ?? "1") !== "1") continue;
      byTs.set(ts, {
        openTime: ts,
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        volume: Number(row[5]),
        closeTime: ts + HOUR - 1,
      });
    }
    if (!(oldest < previousOldest)) break;
    previousOldest = oldest;
    cursor = oldest;
    await sleep(120);
  }
  const rows = [...byTs.values()].sort((a, b) => a.openTime - b.openTime);
  if (rows.length < 5_000) throw new Error(`Insufficient OKX ${instId} rows=${rows.length}`);
  return rows;
}

async function downloadFunding() {
  const byTs = new Map<number, FundingPoint>();
  let cursor = EVAL_END + 1;
  let previousOldest = Number.POSITIVE_INFINITY;
  for (let page = 0; page < 80 && cursor > WARM_START; page += 1) {
    const list = await okx("/api/v5/public/funding-rate-history", { instId: "PENGU-USDT-SWAP", after: String(cursor), limit: "100" });
    if (!list.length) break;
    let oldest = Number.POSITIVE_INFINITY;
    for (const row of list) {
      const ts = Number(row.fundingTime), rate = Number(row.fundingRate);
      oldest = Math.min(oldest, ts);
      if (ts >= WARM_START && ts < EVAL_END && Number.isFinite(rate)) byTs.set(ts, { fundingTime: ts, fundingRate: rate });
    }
    if (!(oldest < previousOldest)) break;
    previousOldest = oldest;
    cursor = oldest;
    await sleep(120);
  }
  const rows = [...byTs.values()].sort((a, b) => a.fundingTime - b.fundingTime);
  if (rows.length < 100) throw new Error(`Insufficient OKX funding rows=${rows.length}`);
  return rows;
}

'''


def patched_source(venue):
    source = SOURCE.read_text()
    begin = source.index('async function bybit(')
    end = source.index('function fundingBetween', begin)
    replacement = OKX_FUNCS if venue == 'OKX' else BINANCE_FUNCS
    source = source[:begin] + replacement + source[end:]
    source = source.replace('venue: "Bybit"', f'venue: "{venue}"')
    source = source.replace('schema: "pengu-short-v11-bybit-holdout/v1"', f'schema: "pengu-short-v11-{venue.lower()}-crossvenue/v1"')
    temp = Path(f'scripts/.pengu_v11_{venue.lower()}.ts')
    temp.write_text(source)
    return temp


def run_venue(venue):
    temp = patched_source(venue)
    output = ROOT / f'{venue.lower()}.json'
    env = dict(os.environ)
    env['PENGU_V11_OUT'] = str(output)
    try:
        cp = subprocess.run(['npx', 'tsx', str(temp)], env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        (ROOT / f'{venue.lower()}.log').write_text(cp.stdout)
        print(cp.stdout)
        if cp.returncode != 0:
            raise RuntimeError(f'V11 {venue} replay failed code={cp.returncode}')
        result = json.loads(output.read_text())
        result['frozenCandidateSha'] = FROZEN_SHA
        output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
        return result
    finally:
        temp.unlink(missing_ok=True)


def main():
    binance_data = {
        'pengu': load_binance_klines('PENGUUSDT'),
        'btc': load_binance_klines('BTCUSDT'),
        'funding': load_binance_funding(),
    }
    okx = run_venue('OKX')
    binance = run_venue('Binance')
    result = {
        'status': 'PASS_RESEARCH_ONLY',
        'schema': 'pengu-short-v11-okx-binance/v1',
        'frozenCandidateSha': FROZEN_SHA,
        'candidate': 'COUNTERWIND_PROGRESS_FAIL_REENTRY',
        'binanceVisionData': binance_data,
        'venues': {'OKX': okx, 'Binance': binance},
        'bothPromotionPass': bool(okx.get('promotion', {}).get('pass')) and bool(binance.get('promotion', {}).get('pass')),
        'safety': {'mode': 'RESEARCH_ONLY', 'ordersSent': False, 'liveChanged': False, 'vpsChanged': False, 'productionChanged': False},
    }
    (ROOT / 'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'bothPromotionPass': result['bothPromotionPass'], 'OKX': okx.get('promotion'), 'Binance': binance.get('promotion')}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
