#!/usr/bin/env python3
import importlib.util
import json
import os
import subprocess
from pathlib import Path

ROOT = Path('.research-state/pengu-short-v14')
ROOT.mkdir(parents=True, exist_ok=True)
PRE_SHA = 'd8c9bbcb513e1ab65ae39a30b3755b1faeb5b22d'
SOURCE = Path('scripts/research_pengu_short_v11_bybit_holdout.ts')

spec = importlib.util.spec_from_file_location('v13', 'scripts/research_pengu_short_v13_okx_binance_gate_bitget.py')
v13 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v13)
v12final = v13.v12final
v12 = v13.v12
HOUR = 3_600_000


def continuous_bitget(symbol):
    meta = v13.load_bitget_candles(symbol)
    path = v13.ROOT / f'bitget-{symbol}.json'
    rows = json.loads(path.read_text())
    gaps = []
    last_gap_right = None
    for a, b in zip(rows, rows[1:]):
        delta = b['openTime'] - a['openTime']
        if delta != HOUR:
            gaps.append({'left':a['openTime'],'right':b['openTime'],'deltaHours':delta/HOUR})
            last_gap_right = b['openTime']
    if last_gap_right is not None:
        rows = [r for r in rows if r['openTime'] >= last_gap_right]
    if len(rows) < 10_000:
        raise RuntimeError(f'Insufficient continuous Bitget {symbol} rows={len(rows)} gaps={gaps[-10:]}')
    path.write_text(json.dumps(rows,separators=(',',':')))
    return {**meta,'continuousRows':len(rows),'trimStart':rows[0]['openTime'],'gaps':gaps}


BITGET_FUNCS = v13.BITGET_FUNCS


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
    source = source.replace('schema: "pengu-short-v11-bybit-holdout/v1"', f'schema: "pengu-short-v14-{venue.lower()}/v1"')
    source = source.replace('64b22dad74d1c026b2146d41d39cc8a3d3a819e3', PRE_SHA)
    source = source.replace('COUNTERWIND_PROGRESS_FAIL_REENTRY', 'COUNTERWIND_PROBATION_BREAKEVEN_RESUME')
    if venue == 'Gate':
        source = source.replace('const WARM_START = Date.parse("2024-12-17T00:00:00Z");', f'const WARM_START = Date.parse("{v12final.PRICE_WARM}");')
        source = source.replace('const EVAL_START = Date.parse("2024-12-24T00:00:00Z");', f'const EVAL_START = Date.parse("{v12final.PRICE_START}");')
        source = source.replace('const EVAL_END = Date.parse("2026-08-01T00:00:00Z");', f'const EVAL_END = Date.parse("{v12final.PRICE_END}");')

    fn_start = source.index('function transformShort(')
    fn_end = source.index('\nfunction metrics(', fn_start)
    v14_fn = r'''function transformShort(
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
  let armed = false, progressed = false, lowWater = trade.entryPrice, probationIndex = -1;

  for (let cursor = entryIndex; cursor < originalExitIndex; cursor += 1) {
    const bar = rows[cursor].candle;
    lowWater = Math.min(lowWater, bar.low);
    const mfe = 1 - lowWater / trade.entryPrice;
    if (!armed && !progressed && mfe >= arm) armed = true;
    if (armed && mfe >= goal) { progressed = true; armed = false; }
    if (armed && !progressed && (1 - bar.close / trade.entryPrice) <= failLevel && cursor + 1 <= originalExitIndex) {
      probationIndex = cursor + 1;
      break;
    }
  }
  if (probationIndex < 0) return [{ ...trade, kind: "BASE" as const }];

  const costPerSide = BASE_FEE_PER_SIDE + (mode === "stress" ? STRESS_SLIPPAGE_PER_SIDE : 0);
  const feeBreakEvenStop = trade.entryPrice / (1 + 2 * BASE_FEE_PER_SIDE);
  const deadlineTs = trade.entryTs + (PENGU_DUAL_LS_V2.short.maxHoldHours / 4) * HOUR;

  for (let cursor = probationIndex; cursor <= originalExitIndex; cursor += 1) {
    const bar = rows[cursor].candle;
    const features = rows[cursor].features;
    if (!features) continue;

    // Absolute 18h probation deadline is checked at the open; no result-derived time threshold.
    if (bar.openTime >= deadlineTs) {
      const raw = trade.entryPrice / bar.open - 1;
      const f = fundingBetween(funding, trade.entryTs, bar.openTime);
      const net = raw + f - 2 * costPerSide;
      return [{ ...trade, kind: "BASE" as const, exitTs: bar.openTime, exitPrice: bar.open,
        accountReturn: trade.requestedGross * net, netUnitReturn: net, progressFail: true }];
    }

    // Conservative same-bar ordering: intrabar protective stop is assumed before close-based thesis resume.
    if (bar.high >= feeBreakEvenStop) {
      const raw = trade.entryPrice / feeBreakEvenStop - 1;
      const f = fundingBetween(funding, trade.entryTs, bar.openTime);
      const net = raw + f - 2 * costPerSide;
      return [{ ...trade, kind: "BASE" as const, exitTs: bar.openTime, exitPrice: feeBreakEvenStop,
        accountReturn: trade.requestedGross * net, netUnitReturn: net, progressFail: true }];
    }

    const resumed = bar.close < lowWater && bar.close < features.ema72 && features.btcReturn24h >= 0;
    if (resumed) {
      // Thesis recovered quickly: preserve the untouched original baseline lifecycle/outcome.
      return [{ ...trade, kind: "BASE" as const, progressFail: true, reentryFrom: bar.openTime }];
    }
  }

  return [{ ...trade, kind: "BASE" as const, progressFail: true }];
}'''
    source = source[:fn_start] + v14_fn + source[fn_end:]
    source = source.replace('reentries: trades.filter((trade) => trade.kind === "REENTRY").length,', 'reentries: trades.filter((trade) => trade.progressFail && trade.reentryFrom !== undefined).length,')

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

    temp = Path(f'scripts/.pengu_v14_{venue.lower()}.ts')
    temp.write_text(source)
    return temp


def run(venue):
    temp = source_for(venue)
    out = ROOT / f'{venue.lower()}.json'
    env = dict(os.environ); env['PENGU_V11_OUT'] = str(out)
    try:
        cp = subprocess.run(['npx','tsx',str(temp)],env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
        (ROOT/f'{venue.lower()}.log').write_text(cp.stdout)
        print(cp.stdout)
        if cp.returncode != 0: raise RuntimeError(f'V14 {venue} failed code={cp.returncode}')
        return json.loads(out.read_text())
    finally:
        temp.unlink(missing_ok=True)


def gate_nonworse(x):
    for mode in ('NORMAL','STRESS'):
        b=x['results'][mode]['BASELINE']; c=x['results'][mode]['CANDIDATE']
        pf=lambda z: z.get('profitFactor') or 0; wr=lambda z: z.get('winRatePct') or 0
        if not (c['trades']==b['trades'] and wr(c)>=wr(b) and c['returnPct']>=b['returnPct'] and pf(c)>=pf(b) and c['maxDrawdownPct']>=b['maxDrawdownPct']): return False
    return True


def main():
    v12.v11runner.load_binance_klines('PENGUUSDT'); v12.v11runner.load_binance_klines('BTCUSDT'); v12.v11runner.load_binance_funding()
    okx=run('OKX'); binance=run('Binance')

    gp=v12final.load_gate_klines('PENGU_USDT'); gb=v12final.load_gate_klines('BTC_USDT')
    v12final.write_gate_cache(gp,gb,[])
    gate=run('Gate')

    bitget_data={
        'pengu':continuous_bitget('PENGUUSDT'),
        'btc':continuous_bitget('BTCUSDT'),
        'funding':v13.load_bitget_funding(),
    }
    bitget=run('Bitget')
    passes={'OKX':bool(okx['promotion']['pass']),'Binance':bool(binance['promotion']['pass']),'GateDiagnostic':gate_nonworse(gate),'Bitget':bool(bitget['promotion']['pass'])}
    result={'status':'PASS_RESEARCH_ONLY','schema':'pengu-short-v14/v1','candidate':'COUNTERWIND_PROBATION_BREAKEVEN_RESUME',
        'preRegistrationSha':PRE_SHA,'candidateCount':1,'thresholdSweep':False,'bitgetPerformanceObservedBeforePreRegistration':False,
        'bitgetData':bitget_data,'venues':{'OKX':okx,'Binance':binance,'Gate':gate,'Bitget':bitget},'venuePasses':passes,
        'promotionPass':all(passes.values()),'safety':{'mode':'RESEARCH_ONLY','ordersSent':False,'liveChanged':False,'vpsChanged':False,'productionChanged':False}}
    (ROOT/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'promotionPass':result['promotionPass'],'venuePasses':passes,'bitgetData':bitget_data},indent=2))

if __name__=='__main__': main()
