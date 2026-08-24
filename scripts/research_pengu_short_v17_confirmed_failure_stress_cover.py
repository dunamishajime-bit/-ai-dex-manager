#!/usr/bin/env python3
import importlib.util
import json
import os
import subprocess
from pathlib import Path

ROOT = Path('.research-state/pengu-short-v17')
ROOT.mkdir(parents=True, exist_ok=True)
PRE_SHA = '9197d2dbcf486a5be0ef5ad4c9275b4c912b90b9'
V15_PRE_SHA = '9873c0b3b345f2273b5fe3c6dde4a08ae741f9ef'
V15_NAME = 'COUNTERWIND_CLOSE_PROBATION_COST_FLOOR_RESUME'
V17_NAME = 'CONFIRMED_PROGRESS_FAIL_STRESS_COVER_PROBATION'

spec = importlib.util.spec_from_file_location('v15', 'scripts/research_pengu_short_v15_close_probation_bitget.py')
v15 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v15)

V17_FN = r'''function transformShort(
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
  let armed = false, progressed = false, lowWater = trade.entryPrice, probationIndex = -1, armedAtCursor = -1;

  for (let cursor = entryIndex; cursor < originalExitIndex; cursor += 1) {
    const bar = rows[cursor].candle;
    lowWater = Math.min(lowWater, bar.low);
    const mfe = 1 - lowWater / trade.entryPrice;
    if (!armed && !progressed && mfe >= arm) {
      armed = true;
      armedAtCursor = cursor;
    }
    if (armed && mfe >= goal) {
      progressed = true;
      armed = false;
    }
    // V17 confirmation: arm and failure may not be declared in the same H1 bar.
    if (armed && !progressed && armedAtCursor >= 0 && cursor > armedAtCursor
      && (1 - bar.close / trade.entryPrice) <= failLevel && cursor + 1 <= originalExitIndex) {
      probationIndex = cursor + 1;
      break;
    }
  }
  if (probationIndex < 0) return [{ ...trade, kind: "BASE" as const }];

  const costPerSide = BASE_FEE_PER_SIDE + (mode === "stress" ? STRESS_SLIPPAGE_PER_SIDE : 0);
  const worstCostPerSide = BASE_FEE_PER_SIDE + STRESS_SLIPPAGE_PER_SIDE;
  const stressCoverPrice = trade.entryPrice / (1 + 2 * worstCostPerSide);
  const deadlineTs = trade.entryTs + (PENGU_DUAL_LS_V2.short.maxHoldHours / 4) * HOUR;

  for (let cursor = probationIndex; cursor < originalExitIndex; cursor += 1) {
    const bar = rows[cursor].candle;
    const features = rows[cursor].features;
    if (!features) continue;

    if (bar.openTime >= deadlineTs) {
      const raw = trade.entryPrice / bar.open - 1;
      const f = fundingBetween(funding, trade.entryTs, bar.openTime);
      const net = raw + f - 2 * costPerSide;
      return [{ ...trade, kind: "BASE" as const, exitTs: bar.openTime, exitPrice: bar.open,
        accountReturn: trade.requestedGross * net, netUnitReturn: net, progressFail: true }];
    }

    // Protective stop is active from the first probation bar. A gap through the stop fills conservatively at the open.
    if (bar.open >= stressCoverPrice || bar.high >= stressCoverPrice) {
      const exitPrice = bar.open >= stressCoverPrice ? bar.open : stressCoverPrice;
      const raw = trade.entryPrice / exitPrice - 1;
      const f = fundingBetween(funding, trade.entryTs, bar.openTime);
      const net = raw + f - 2 * costPerSide;
      return [{ ...trade, kind: "BASE" as const, exitTs: bar.openTime, exitPrice,
        accountReturn: trade.requestedGross * net, netUnitReturn: net, progressFail: true }];
    }

    // If the protective stop did not execute intrabar, preserve the frozen close-confirmed thesis resumption rule.
    const resumed = bar.close < lowWater && bar.close < features.ema72 && features.btcReturn24h >= 0;
    if (resumed) return [{ ...trade, kind: "BASE" as const, progressFail: true, reentryFrom: bar.openTime }];
  }

  return [{ ...trade, kind: "BASE" as const, progressFail: true }];
}'''


def source_for(venue):
    temp = v15.source_for(venue)
    text = temp.read_text()
    temp.unlink(missing_ok=True)
    if V15_PRE_SHA not in text:
        raise RuntimeError('Frozen V15 preregistration SHA not found')
    text = text.replace(V15_PRE_SHA, PRE_SHA)
    text = text.replace(V15_NAME, V17_NAME)
    fn_start = text.index('function transformShort(')
    fn_end = text.index('\nfunction metrics(', fn_start)
    text = text[:fn_start] + V17_FN + text[fn_end:]
    text = text.replace('pengu-short-v15-', 'pengu-short-v17-')
    out = Path(f'scripts/.pengu_v17_{venue.lower()}.ts')
    out.write_text(text)
    return out


def run(venue):
    temp = source_for(venue)
    out = ROOT / f'{venue.lower()}.json'
    env = dict(os.environ)
    env['PENGU_V11_OUT'] = str(out)
    try:
        cp = subprocess.run(['npx', 'tsx', str(temp)], env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        (ROOT / f'{venue.lower()}.log').write_text(cp.stdout)
        print(cp.stdout)
        if cp.returncode != 0:
            raise RuntimeError(f'V17 {venue} failed code={cp.returncode}')
        return json.loads(out.read_text())
    finally:
        temp.unlink(missing_ok=True)


def gate_nonworse(x):
    for mode in ('NORMAL', 'STRESS'):
        b = x['results'][mode]['BASELINE']
        c = x['results'][mode]['CANDIDATE']
        pf = lambda z: z.get('profitFactor') or 0
        wr = lambda z: z.get('winRatePct') or 0
        if not (
            c['trades'] == b['trades']
            and wr(c) >= wr(b)
            and c['returnPct'] >= b['returnPct']
            and pf(c) >= pf(b)
            and c['maxDrawdownPct'] >= b['maxDrawdownPct']
        ):
            return False
    return True


def main():
    # Known venues only. KuCoin remains performance-unobserved unless all gates pass.
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

    passes = {
        'OKX': bool(okx['promotion']['pass']),
        'Binance': bool(binance['promotion']['pass']),
        'GateDiagnostic': gate_nonworse(gate),
        'Bitget': bool(bitget['promotion']['pass']),
    }
    development_pass = all(passes.values())
    result = {
        'status': 'PASS_RESEARCH_ONLY',
        'schema': 'pengu-short-v17-development/v1',
        'candidate': V17_NAME,
        'preRegistrationSha': PRE_SHA,
        'candidateCount': 1,
        'thresholdSweep': False,
        'knownVenuePasses': passes,
        'developmentPass': development_pass,
        'kucoinPerformanceObserved': False,
        'kucoinHoldoutStatus': 'ELIGIBLE_TO_OPEN' if development_pass else 'RESERVED_UNOPENED',
        'promotionPass': False,
        'venues': {'OKX': okx, 'Binance': binance, 'Gate': gate, 'Bitget': bitget},
        'bitgetData': bitget_data,
        'safety': {
            'mode': 'RESEARCH_ONLY',
            'ordersSent': False,
            'liveChanged': False,
            'vpsChanged': False,
            'productionChanged': False,
        },
    }
    (ROOT / 'development-result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({
        'developmentPass': development_pass,
        'knownVenuePasses': passes,
        'kucoinHoldoutStatus': result['kucoinHoldoutStatus'],
        'safety': result['safety'],
    }, indent=2))


if __name__ == '__main__':
    main()
