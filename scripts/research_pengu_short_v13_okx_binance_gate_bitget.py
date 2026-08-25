#!/usr/bin/env python3
import importlib.util
import json
import os
import subprocess
import time
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path('.research-state/pengu-short-v13')
ROOT.mkdir(parents=True, exist_ok=True)
PRE_SHA = 'a08da0e618e74ce0ed89163509ba4428abf69997'
SOURCE = Path('scripts/research_pengu_short_v11_bybit_holdout.ts')

spec = importlib.util.spec_from_file_location('v12final', 'scripts/research_pengu_short_v12_gate_final.py')
v12final = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v12final)
v12 = v12final.v12

BITGET_BASE = 'https://api.bitget.com'
WARM_START = 1734393600000  # 2024-12-17T00:00:00Z
EVAL_START = 1734998400000  # 2024-12-24T00:00:00Z
EVAL_END = 1785542400000    # 2026-08-01T00:00:00Z


def bitget_get(path, params):
    url = BITGET_BASE + path + '?' + urlencode(params)
    req = Request(url, headers={'Accept':'application/json','User-Agent':'DisDex-PENGU-V13-Holdout/1.0'})
    try:
        with urlopen(req, timeout=90) as response:
            data = json.loads(response.read().decode('utf-8'))
    except HTTPError as exc:
        body = exc.read().decode('utf-8', errors='replace')
        raise RuntimeError(f'Bitget HTTP {exc.code} url={url} body={body[:800]}') from exc
    if str(data.get('code')) != '00000':
        raise RuntimeError(f'Bitget code={data.get("code")} msg={data.get("msg")} url={url}')
    return data.get('data')


def load_bitget_candles(symbol):
    by_ts = {}
    end = EVAL_END - 1
    for _ in range(180):
        start = max(WARM_START, end - 89 * 24 * 3600 * 1000)
        data = bitget_get('/api/v3/market/history-candles', {
            'category':'USDT-FUTURES',
            'symbol':symbol,
            'interval':'1H',
            'startTime':str(start),
            'endTime':str(end),
            'limit':'100',
            'type':'market',
        }) or []
        if not data:
            break
        oldest = end
        for row in data:
            try:
                ts = int(row[0])
                oldest = min(oldest, ts)
                if WARM_START <= ts < EVAL_END:
                    by_ts[ts] = {
                        'openTime':ts,
                        'open':float(row[1]),
                        'high':float(row[2]),
                        'low':float(row[3]),
                        'close':float(row[4]),
                        'volume':float(row[5]),
                        'closeTime':ts + 3_600_000 - 1,
                    }
            except Exception:
                continue
        if oldest <= WARM_START or oldest >= end:
            break
        end = oldest - 1
        time.sleep(0.06)
    rows = [by_ts[k] for k in sorted(by_ts)]
    if len(rows) < 10_000:
        raise RuntimeError(f'Insufficient Bitget {symbol} rows={len(rows)}')
    p = ROOT / f'bitget-{symbol}.json'
    p.write_text(json.dumps(rows,separators=(',',':')))
    return {'rows':len(rows),'first':rows[0]['openTime'],'last':rows[-1]['openTime']}


def load_bitget_funding():
    out = {}
    for page in range(1, 101):
        data = bitget_get('/api/v3/market/history-fund-rate', {
            'category':'USDT-FUTURES',
            'symbol':'PENGUUSDT',
            'limit':'100',
            'cursor':str(page),
        }) or {}
        rows = data.get('resultList', []) if isinstance(data, dict) else []
        if not rows:
            break
        for row in rows:
            try:
                ts = int(row['fundingRateTimestamp'])
                rate = float(row['fundingRate'])
                if WARM_START <= ts < EVAL_END:
                    out[ts] = {'fundingTime':ts,'fundingRate':rate}
            except Exception:
                continue
        oldest = min(int(r['fundingRateTimestamp']) for r in rows if r.get('fundingRateTimestamp'))
        if oldest <= WARM_START:
            break
        time.sleep(0.06)
    rows = [out[k] for k in sorted(out)]
    if len(rows) < 100:
        raise RuntimeError(f'Insufficient Bitget funding rows={len(rows)}')
    (ROOT/'bitget-PENGUUSDT-funding.json').write_text(json.dumps(rows,separators=(',',':')))
    return {'rows':len(rows),'first':rows[0]['fundingTime'],'last':rows[-1]['fundingTime']}


BITGET_FUNCS = r'''async function downloadCandles(symbol: string) {
  const raw = JSON.parse(await fs.readFile(`.research-state/pengu-short-v13/bitget-${symbol}.json`, "utf8")) as DisDexV35Candle[];
  return raw.filter((candle) => candle.openTime >= WARM_START && candle.openTime < EVAL_END);
}

async function downloadFunding() {
  const raw = JSON.parse(await fs.readFile(".research-state/pengu-short-v13/bitget-PENGUUSDT-funding.json", "utf8")) as FundingPoint[];
  return raw.filter((point) => point.fundingTime >= WARM_START && point.fundingTime < EVAL_END);
}

'''


def source_for(venue):
    source = SOURCE.read_text()
    begin = source.index('async function bybit(')
    end = source.index('function fundingBetween', begin)
    if venue == 'OKX': funcs = v12.v11runner.OKX_FUNCS
    elif venue == 'Binance': funcs = v12.v11runner.BINANCE_FUNCS
    elif venue == 'Gate': funcs = v12.GATE_FUNCS
    elif venue == 'Bitget': funcs = BITGET_FUNCS
    else: raise ValueError(venue)
    source = source[:begin] + funcs + source[end:]
    source = source.replace('venue: "Bybit"', f'venue: "{venue}"')
    source = source.replace('schema: "pengu-short-v11-bybit-holdout/v1"', f'schema: "pengu-short-v13-{venue.lower()}/v1"')
    source = source.replace('64b22dad74d1c026b2146d41d39cc8a3d3a819e3', PRE_SHA)
    source = source.replace('COUNTERWIND_PROGRESS_FAIL_REENTRY', 'COUNTERWIND_SOFT_DERISK_RAPID_RELOAD')

    # Replace the V11 transform function with V13 logical-event soft de-risk architecture.
    fn_start = source.index('function transformShort(')
    fn_end = source.index('\nfunction metrics(', fn_start)
    v13_fn = r'''function transformShort(
  trade: Trade,
  baseline: Trade[],
  rows: PenguDualLsV2EvaluationRow[],
  funding: FundingPoint[],
  mode: Mode,
  rowIndex: Map<number, number>,
) {
  if (trade.side !== "S") return [{ ...trade, kind: "BASE" as const }];
  const counterwind = trade.btcEma168Distance >= 0 || trade.btcReturn24h >= 0;
  if (!counterwind) return [{ ...trade, kind: "BASE" as const }];

  const entryIndex = rowIndex.get(trade.entryTs);
  const originalExitIndex = rowIndex.get(trade.exitTs);
  assert(entryIndex !== undefined && originalExitIndex !== undefined);
  const unit = Math.min(trade.entryAtr24Ratio, PENGU_DUAL_LS_V2.short.hardStopPct / 2);
  const arm = unit;
  const goal = Math.min(2 * unit, PENGU_DUAL_LS_V2.short.hardStopPct);
  const failLevel = unit / 2;
  const costPerSide = BASE_FEE_PER_SIDE + (mode === "stress" ? STRESS_SLIPPAGE_PER_SIDE : 0);
  let armed = false, progressed = false, lowWater = trade.entryPrice, failureExitIndex = -1;

  for (let cursor = entryIndex; cursor < originalExitIndex; cursor += 1) {
    const bar = rows[cursor].candle;
    lowWater = Math.min(lowWater, bar.low);
    const mfe = 1 - lowWater / trade.entryPrice;
    if (!armed && !progressed && mfe >= arm) armed = true;
    if (armed && mfe >= goal) { progressed = true; armed = false; }
    if (armed && !progressed && (1 - bar.close / trade.entryPrice) <= failLevel && cursor + 1 <= originalExitIndex) {
      failureExitIndex = cursor + 1;
      break;
    }
  }
  if (failureExitIndex < 0) return [{ ...trade, kind: "BASE" as const }];

  const halfGross = trade.requestedGross / 2;
  const failureExit = rows[failureExitIndex].candle;
  const firstRaw = trade.entryPrice / failureExit.open - 1;
  const firstFunding = fundingBetween(funding, trade.entryTs, failureExit.openTime);
  const firstNet = firstRaw + firstFunding - 2 * costPerSide;
  const retainedReturn = trade.accountReturn / 2;
  const removedFirstReturn = halfGross * firstNet;

  const nextBaseEntry = nextBaselineEntry(baseline, failureExit.openTime);
  let reloadIndex = -1;
  for (let cursor = failureExitIndex; cursor < Math.min(rows.length - 1, failureExitIndex + PENGU_DUAL_LS_V2.short.maxHoldHours); cursor += 1) {
    const features = rows[cursor].features;
    if (!features) continue;
    if (nextBaseEntry !== undefined && rows[cursor].candle.openTime >= nextBaseEntry) break;
    const rapidRelativeWeakness = (rows[cursor].candle.openTime - trade.entryTs) <= (PENGU_DUAL_LS_V2.short.maxHoldHours / 4) * HOUR
      && features.btcReturn24h >= 0;
    if (rapidRelativeWeakness && rows[cursor].candle.close < lowWater && rows[cursor].candle.close < features.ema72) {
      reloadIndex = cursor + 1;
      break;
    }
  }

  let reloadReturn = 0;
  let reloadTs: number | undefined;
  let reloadExitTs: number | undefined;
  if (reloadIndex >= 0 && reloadIndex < rows.length) {
    const reload = rows[reloadIndex].candle;
    if (nextBaseEntry === undefined || reload.openTime < nextBaseEntry) {
      reloadTs = reload.openTime;
      let position: PenguDualLsV2Position = {
        side: -1, entryTs: reload.openTime, entryPrice: reload.open, quantity: 1,
        gross: halfGross, highWaterMark: reload.open, lowWaterMark: reload.open,
      };
      const last = Math.min(rows.length - 1, reloadIndex + PENGU_DUAL_LS_V2.short.maxHoldHours - 1);
      let exitIndex = last, exitPrice = rows[last].candle.close;
      for (let cursor = reloadIndex; cursor <= last; cursor += 1) {
        if (nextBaseEntry !== undefined && rows[cursor].candle.openTime >= nextBaseEntry) {
          exitIndex = cursor; exitPrice = rows[cursor].candle.open; break;
        }
        const features = rows[cursor].features;
        if (!features) continue;
        const evaluation = evaluatePenguDualLsV2PositionBar(position, features);
        position = evaluation.updatedPosition;
        if (evaluation.exit) { exitIndex = cursor; exitPrice = evaluation.exit.stopPrice ?? rows[cursor].candle.close; break; }
      }
      reloadExitTs = rows[exitIndex].candle.openTime;
      const raw = reload.open / exitPrice - 1;
      const f = fundingBetween(funding, reload.openTime, reloadExitTs);
      reloadReturn = halfGross * (raw + f - 2 * costPerSide);
    }
  }

  const combined = retainedReturn + removedFirstReturn + reloadReturn;
  return [{
    ...trade,
    kind: "BASE" as const,
    accountReturn: combined,
    netUnitReturn: trade.requestedGross > 0 ? combined / trade.requestedGross : 0,
    progressFail: true,
    reentryFrom: reloadTs,
    exitTs: Math.max(trade.exitTs, reloadExitTs ?? trade.exitTs),
  }];
}'''
    source = source[:fn_start] + v13_fn + source[fn_end:]

    # Metrics: logical event count stays baseline; use progressionFailures as modified event count and reentries as reload count.
    source = source.replace('reentries: trades.filter((trade) => trade.kind === "REENTRY").length,', 'reentries: trades.filter((trade) => trade.progressFail && trade.reentryFrom !== undefined).length,')

    # Replace best-reentry robustness with best-modified-event reversion to baseline.
    rb_start = source.index('function removeBestReentry(')
    rb_end = source.index('\nasync function main()', rb_start)
    rb = r'''function removeBestReentry(baseline: Trade[], candidate: Trade[]) {
  const byEntry = new Map(baseline.map((trade) => [trade.entryTs, trade]));
  const modified = candidate.filter((trade) => trade.progressFail);
  if (!modified.length) return { returnDeltaPct: metrics(candidate).returnPct - metrics(baseline).returnPct, removed: null };
  let best = modified[0];
  let bestDelta = best.accountReturn - (byEntry.get(best.entryTs)?.accountReturn ?? 0);
  for (const trade of modified.slice(1)) {
    const delta = trade.accountReturn - (byEntry.get(trade.entryTs)?.accountReturn ?? 0);
    if (delta > bestDelta) { best = trade; bestDelta = delta; }
  }
  const reduced = candidate.map((trade) => trade === best ? (byEntry.get(trade.entryTs) ?? trade) : trade);
  return { returnDeltaPct: metrics(reduced).returnPct - metrics(baseline).returnPct, removed: { entryTs: best.entryTs, improvement: bestDelta } };
}'''
    source = source[:rb_start] + rb + source[rb_end:]

    # Promotion: same event count, modified events >=2, strict event-win criteria.
    p_start = source.index('  output.promotion = {')
    p_end = source.index('\n\n  const outputPath', p_start)
    promo = r'''  output.promotion = {
    pass: base.trades >= 20
      && candidate.trades === base.trades
      && candidate.progressionFailures >= 2
      && (candidate.winRatePct ?? 0) >= (base.winRatePct ?? 0) + 5
      && candidate.returnPct >= base.returnPct
      && (candidate.profitFactor ?? 0) >= (base.profitFactor ?? 0)
      && candidate.maxDrawdownPct >= base.maxDrawdownPct
      && (stressCandidate.winRatePct ?? 0) >= (stressBase.winRatePct ?? 0)
      && stressCandidate.returnPct >= stressBase.returnPct
      && (stressCandidate.profitFactor ?? 0) >= (stressBase.profitFactor ?? 0)
      && stressCandidate.maxDrawdownPct >= stressBase.maxDrawdownPct
      && normal.withoutBestReentry.returnDeltaPct >= 0
      && stress.withoutBestReentry.returnDeltaPct >= 0
      && foldsNonWorseWinRate.length >= 3
      && foldsNonWorseReturn.length >= 3,
    foldsNonWorseWinRate,
    foldsNonWorseReturn,
  };'''
    source = source[:p_start] + promo + source[p_end:]

    temp = Path(f'scripts/.pengu_v13_{venue.lower()}.ts')
    temp.write_text(source)
    return temp


def run(venue):
    temp = source_for(venue)
    out = ROOT / f'{venue.lower()}.json'
    env = dict(os.environ)
    env['PENGU_V11_OUT'] = str(out)
    try:
        cp = subprocess.run(['npx','tsx',str(temp)],env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
        (ROOT/f'{venue.lower()}.log').write_text(cp.stdout)
        print(cp.stdout)
        if cp.returncode != 0: raise RuntimeError(f'V13 {venue} failed code={cp.returncode}')
        return json.loads(out.read_text())
    finally:
        temp.unlink(missing_ok=True)


def gate_nonworse(x):
    for mode in ('NORMAL','STRESS'):
        b=x['results'][mode]['BASELINE']; c=x['results'][mode]['CANDIDATE']
        pf=lambda z: z.get('profitFactor') or 0
        wr=lambda z: z.get('winRatePct') or 0
        if not (c['trades']==b['trades'] and wr(c)>=wr(b) and c['returnPct']>=b['returnPct'] and pf(c)>=pf(b) and c['maxDrawdownPct']>=b['maxDrawdownPct']): return False
    return True


def main():
    # Development venues first. Bitget remains untouched until PRE_SHA exists; this file is after PRE_SHA.
    v12.v11runner.load_binance_klines('PENGUUSDT')
    v12.v11runner.load_binance_klines('BTCUSDT')
    v12.v11runner.load_binance_funding()
    okx=run('OKX'); binance=run('Binance')

    gp=v12final.load_gate_klines('PENGU_USDT'); gb=v12final.load_gate_klines('BTC_USDT')
    v12final.write_gate_cache(gp,gb,[])
    gate=run('Gate')

    # FIRST Bitget performance fetch occurs here, after PRE_SHA is already frozen.
    bitget_data={
        'pengu':load_bitget_candles('PENGUUSDT'),
        'btc':load_bitget_candles('BTCUSDT'),
        'funding':load_bitget_funding(),
    }
    bitget=run('Bitget')
    passes={'OKX':bool(okx['promotion']['pass']),'Binance':bool(binance['promotion']['pass']),'GateDiagnostic':gate_nonworse(gate),'Bitget':bool(bitget['promotion']['pass'])}
    result={
        'status':'PASS_RESEARCH_ONLY','schema':'pengu-short-v13/v1','candidate':'COUNTERWIND_SOFT_DERISK_RAPID_RELOAD',
        'preRegistrationSha':PRE_SHA,'candidateCount':1,'thresholdSweep':False,'bitgetPerformanceObservedBeforePreRegistration':False,
        'bitgetData':bitget_data,'venues':{'OKX':okx,'Binance':binance,'Gate':gate,'Bitget':bitget},'venuePasses':passes,
        'promotionPass':all(passes.values()),
        'safety':{'mode':'RESEARCH_ONLY','ordersSent':False,'liveChanged':False,'vpsChanged':False,'productionChanged':False},
    }
    (ROOT/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'promotionPass':result['promotionPass'],'venuePasses':passes},indent=2))

if __name__=='__main__': main()
