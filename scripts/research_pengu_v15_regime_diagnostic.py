#!/usr/bin/env python3
import importlib.util
import json
import os
import subprocess
from pathlib import Path

ROOT = Path('.research-state/pengu-v15-regime-diagnostic')
ROOT.mkdir(parents=True, exist_ok=True)

spec = importlib.util.spec_from_file_location('v15', 'scripts/research_pengu_short_v15_close_probation_bitget.py')
v15 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v15)
HOUR = 3_600_000


def instrumented_source(venue):
    temp = v15.source_for(venue)
    text = temp.read_text()
    temp.unlink(missing_ok=True)

    fn_start = text.index('function transformShort(')
    fn_end = text.index('\nfunction metrics(', fn_start)
    diag_fn = r'''function transformShort(
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
  let armed = false, progressed = false, lowWater = trade.entryPrice, probationIndex = -1, failureCursor = -1;

  for (let cursor = entryIndex; cursor < originalExitIndex; cursor += 1) {
    const bar = rows[cursor].candle;
    lowWater = Math.min(lowWater, bar.low);
    const mfe = 1 - lowWater / trade.entryPrice;
    if (!armed && !progressed && mfe >= arm) armed = true;
    if (armed && mfe >= goal) { progressed = true; armed = false; }
    if (armed && !progressed && (1 - bar.close / trade.entryPrice) <= failLevel && cursor + 1 <= originalExitIndex) {
      failureCursor = cursor;
      probationIndex = cursor + 1;
      break;
    }
  }
  if (probationIndex < 0) return [{ ...trade, kind: "BASE" as const }];

  const snapshot = (cursor: number) => {
    const row: any = rows[cursor];
    const f: any = row?.features;
    const c: any = row?.candle;
    if (!f || !c) return null;
    return {
      ts: c.openTime,
      close: c.close,
      penguReturn24h: f.penguReturn24h,
      btcReturn24h: f.btcReturn24h,
      relativeReturn24h: f.relativeReturn24h,
      atr24Ratio: f.atr24Ratio,
      volumeRatio6OverPrior36: f.volumeRatio6OverPrior36,
      rsi14: f.rsi14,
      btcEma168Distance: f.btcEma168Distance,
      ema72Distance: c.close / f.ema72 - 1,
    };
  };
  const entrySignalCursor = Math.max(0, entryIndex - 1);
  const entrySnap: any = snapshot(entrySignalCursor);
  const failureSnap: any = snapshot(failureCursor);
  const safeDelta = (a: any, b: any) => (Number.isFinite(a) && Number.isFinite(b)) ? a - b : null;
  const safeRatioDelta = (a: any, b: any) => (Number.isFinite(a) && Number.isFinite(b) && b !== 0) ? a / b - 1 : null;
  const diagnosticBase: any = {
    baselineAccountReturn: trade.accountReturn,
    baselineExitTs: trade.exitTs,
    entryTs: trade.entryTs,
    failureTs: rows[failureCursor].candle.openTime,
    failureDelayHours: (rows[failureCursor].candle.openTime - trade.entryTs) / HOUR,
    progressionUnit: unit,
    lowWaterAtFailure: lowWater,
    entrySignal: entrySnap,
    failure: failureSnap,
    entryToFailure: {
      relativeAcceleration24h: safeDelta(failureSnap?.relativeReturn24h, entrySnap?.relativeReturn24h),
      btcAcceleration24h: safeDelta(failureSnap?.btcReturn24h, entrySnap?.btcReturn24h),
      atrRatioChange: safeRatioDelta(failureSnap?.atr24Ratio, entrySnap?.atr24Ratio),
      volumeRatioChange: safeRatioDelta(failureSnap?.volumeRatio6OverPrior36, entrySnap?.volumeRatio6OverPrior36),
    },
  };
  (trade as any).diagnostic = diagnosticBase;

  const costPerSide = BASE_FEE_PER_SIDE + (mode === "stress" ? STRESS_SLIPPAGE_PER_SIDE : 0);
  const worstCostPerSide = BASE_FEE_PER_SIDE + STRESS_SLIPPAGE_PER_SIDE;
  const costCoverPrice = trade.entryPrice / (1 + 2 * worstCostPerSide);
  const deadlineTs = trade.entryTs + (PENGU_DUAL_LS_V2.short.maxHoldHours / 4) * HOUR;

  const withDecision = (reason: string, cursor: number) => {
    const d: any = snapshot(cursor);
    return {
      ...diagnosticBase,
      decisionReason: reason,
      decisionTs: rows[cursor].candle.openTime,
      decisionClose: rows[cursor].candle.close,
      costCoverPrice,
      decision: d,
      entryToDecision: {
        relativeAcceleration24h: safeDelta(d?.relativeReturn24h, entrySnap?.relativeReturn24h),
        btcAcceleration24h: safeDelta(d?.btcReturn24h, entrySnap?.btcReturn24h),
        atrRatioChange: safeRatioDelta(d?.atr24Ratio, entrySnap?.atr24Ratio),
        volumeRatioChange: safeRatioDelta(d?.volumeRatio6OverPrior36, entrySnap?.volumeRatio6OverPrior36),
      },
      failureToDecision: {
        relativeAcceleration24h: safeDelta(d?.relativeReturn24h, failureSnap?.relativeReturn24h),
        btcAcceleration24h: safeDelta(d?.btcReturn24h, failureSnap?.btcReturn24h),
        atrRatioChange: safeRatioDelta(d?.atr24Ratio, failureSnap?.atr24Ratio),
        volumeRatioChange: safeRatioDelta(d?.volumeRatio6OverPrior36, failureSnap?.volumeRatio6OverPrior36),
      },
    };
  };

  for (let cursor = probationIndex; cursor < originalExitIndex; cursor += 1) {
    const bar = rows[cursor].candle;
    const features = rows[cursor].features;
    if (!features) continue;

    if (bar.openTime >= deadlineTs) {
      const raw = trade.entryPrice / bar.open - 1;
      const f = fundingBetween(funding, trade.entryTs, bar.openTime);
      const net = raw + f - 2 * costPerSide;
      return [{ ...trade, kind: "BASE" as const, exitTs: bar.openTime, exitPrice: bar.open,
        accountReturn: trade.requestedGross * net, netUnitReturn: net, progressFail: true,
        diagnostic: withDecision("DEADLINE", cursor) }];
    }

    const resumed = bar.close < lowWater && bar.close < features.ema72 && features.btcReturn24h >= 0;
    if (resumed) return [{ ...trade, kind: "BASE" as const, progressFail: true, reentryFrom: bar.openTime,
      diagnostic: withDecision("RESUME", cursor) }];

    if (bar.close >= costCoverPrice) {
      const next = Math.min(cursor + 1, originalExitIndex);
      const exitBar = rows[next].candle;
      const raw = trade.entryPrice / exitBar.open - 1;
      const f = fundingBetween(funding, trade.entryTs, exitBar.openTime);
      const net = raw + f - 2 * costPerSide;
      return [{ ...trade, kind: "BASE" as const, exitTs: exitBar.openTime, exitPrice: exitBar.open,
        accountReturn: trade.requestedGross * net, netUnitReturn: net, progressFail: true,
        diagnostic: withDecision("COST_FLOOR", cursor) }];
    }
  }

  return [{ ...trade, kind: "BASE" as const, progressFail: true,
    diagnostic: withDecision("ORIGINAL_EXIT", originalExitIndex) }];
}'''
    text = text[:fn_start] + diag_fn + text[fn_end:]

    metrics_start = text.index('function metrics(')
    needle = '  return {\n    trades: trades.length,'
    pos = text.index(needle, metrics_start)
    replacement = '''  return {\n    diagnosticEvents: trades.filter((trade: any) => trade.diagnostic).map((trade: any) => ({\n      entryTs: trade.entryTs,\n      exitTs: trade.exitTs,\n      accountReturn: trade.accountReturn,\n      netUnitReturn: trade.netUnitReturn,\n      requestedGross: trade.requestedGross,\n      progressFail: Boolean(trade.progressFail),\n      reentryFrom: trade.reentryFrom ?? null,\n      diagnostic: trade.diagnostic,\n    })),\n    trades: trades.length,'''
    text = text[:pos] + replacement + text[pos + len(needle):]

    out = Path(f'scripts/.pengu_v15_regime_diag_{venue.lower()}.ts')
    out.write_text(text)
    return out


def run(venue):
    temp = instrumented_source(venue)
    out = ROOT / f'{venue.lower()}.json'
    env = dict(os.environ)
    env['PENGU_V11_OUT'] = str(out)
    try:
        cp = subprocess.run(['npx', 'tsx', str(temp)], env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        (ROOT / f'{venue.lower()}.log').write_text(cp.stdout)
        print(cp.stdout)
        if cp.returncode != 0:
            raise RuntimeError(f'V15 diagnostic {venue} failed code={cp.returncode}')
        return json.loads(out.read_text())
    finally:
        temp.unlink(missing_ok=True)


def summarize(venue_result):
    result = {}
    for mode in ('NORMAL', 'STRESS'):
        cand = venue_result['results'][mode]['CANDIDATE']
        rows = []
        for event in cand.get('diagnosticEvents', []):
            diag = event.get('diagnostic') or {}
            base_ret = diag.get('baselineAccountReturn')
            cand_ret = event.get('accountReturn')
            rows.append({
                'entryTs': event.get('entryTs'),
                'baselineAccountReturn': base_ret,
                'candidateAccountReturn': cand_ret,
                'accountReturnDelta': (cand_ret - base_ret) if isinstance(cand_ret, (int, float)) and isinstance(base_ret, (int, float)) else None,
                'decisionReason': diag.get('decisionReason'),
                'failureDelayHours': diag.get('failureDelayHours'),
                'entrySignal': diag.get('entrySignal'),
                'failure': diag.get('failure'),
                'decision': diag.get('decision'),
                'entryToFailure': diag.get('entryToFailure'),
                'failureToDecision': diag.get('failureToDecision'),
                'entryToDecision': diag.get('entryToDecision'),
            })
        result[mode] = rows
    return result


def main():
    # Same research caches/data sources as frozen V15. No strategy parameters are changed.
    v15.v12.v11runner.load_binance_klines('PENGUUSDT')
    v15.v12.v11runner.load_binance_klines('BTCUSDT')
    v15.v12.v11runner.load_binance_funding()
    okx = run('OKX')
    binance = run('Binance')

    gp = v15.v12final.load_gate_klines('PENGU_USDT')
    gb = v15.v12final.load_gate_klines('BTC_USDT')
    v15.v12final.write_gate_cache(gp, gb, [])
    gate = run('Gate')

    bitget_data = {
        'pengu': v15.dense_bitget_candles('PENGUUSDT'),
        'btc': v15.dense_bitget_candles('BTCUSDT'),
        'funding': v15.v13.load_bitget_funding(),
    }
    bitget = run('Bitget')

    venues = {'OKX': okx, 'Binance': binance, 'Gate': gate, 'Bitget': bitget}
    summary = {name: summarize(value) for name, value in venues.items()}
    payload = {
        'status': 'PASS_RESEARCH_ONLY',
        'diagnosticOnly': True,
        'frozenCandidate': 'COUNTERWIND_CLOSE_PROBATION_COST_FLOOR_RESUME',
        'frozenPreRegistrationSha': v15.PRE_SHA,
        'thresholdSweep': False,
        'candidateCount': 0,
        'bitgetData': bitget_data,
        'summary': summary,
        'safety': {
            'mode': 'RESEARCH_ONLY',
            'ordersSent': False,
            'liveChanged': False,
            'vpsChanged': False,
            'productionChanged': False,
        },
    }
    (ROOT / 'diagnostic.json').write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({
        'status': payload['status'],
        'counts': {v: {m: len(summary[v][m]) for m in ('NORMAL', 'STRESS')} for v in summary},
        'safety': payload['safety'],
    }, indent=2))


if __name__ == '__main__':
    main()
