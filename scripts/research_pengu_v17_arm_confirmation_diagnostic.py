#!/usr/bin/env python3
import importlib.util
import json
import os
import subprocess
from pathlib import Path

ROOT = Path('.research-state/pengu-v17-arm-confirmation-diagnostic')
ROOT.mkdir(parents=True, exist_ok=True)

spec = importlib.util.spec_from_file_location('v17', 'scripts/research_pengu_short_v17_confirmed_failure_stress_cover.py')
v17 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v17)

DIAG_FN = r'''function transformShort(
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
  let armed = false, progressed = false, lowWater = trade.entryPrice, probationIndex = -1, armedAtCursor = -1, failureCursor = -1;
  let armDiagnostic: any = null;

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

  for (let cursor = entryIndex; cursor < originalExitIndex; cursor += 1) {
    const bar = rows[cursor].candle;
    lowWater = Math.min(lowWater, bar.low);
    const mfe = 1 - lowWater / trade.entryPrice;
    if (!armed && !progressed && mfe >= arm) {
      armed = true;
      armedAtCursor = cursor;
      const closeProfit = 1 - bar.close / trade.entryPrice;
      armDiagnostic = {
        armedAtTs: bar.openTime,
        armDelayHours: (bar.openTime - trade.entryTs) / HOUR,
        unit,
        intrabarMfeAtArm: mfe,
        closeProfitAtArm: closeProfit,
        closeConfirmedArm: closeProfit >= arm,
        snapshot: snapshot(cursor),
      };
    }
    if (armed && mfe >= goal) {
      progressed = true;
      armed = false;
    }
    if (armed && !progressed && armedAtCursor >= 0 && cursor > armedAtCursor
      && (1 - bar.close / trade.entryPrice) <= failLevel && cursor + 1 <= originalExitIndex) {
      failureCursor = cursor;
      probationIndex = cursor + 1;
      break;
    }
  }
  if (probationIndex < 0) return [{ ...trade, kind: "BASE" as const }];

  const costPerSide = BASE_FEE_PER_SIDE + (mode === "stress" ? STRESS_SLIPPAGE_PER_SIDE : 0);
  const worstCostPerSide = BASE_FEE_PER_SIDE + STRESS_SLIPPAGE_PER_SIDE;
  const stressCoverPrice = trade.entryPrice / (1 + 2 * worstCostPerSide);
  const deadlineTs = trade.entryTs + (PENGU_DUAL_LS_V2.short.maxHoldHours / 4) * HOUR;
  const diagnosticBase: any = {
    baselineAccountReturn: trade.accountReturn,
    baselineExitTs: trade.exitTs,
    entryTs: trade.entryTs,
    arm: armDiagnostic,
    failureTs: rows[failureCursor].candle.openTime,
    failureDelayHours: (rows[failureCursor].candle.openTime - trade.entryTs) / HOUR,
    failure: snapshot(failureCursor),
    stressCoverPrice,
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
        diagnostic: { ...diagnosticBase, terminationReason: "DEADLINE", decisionTs: bar.openTime, decision: snapshot(cursor) } }];
    }

    if (bar.open >= stressCoverPrice || bar.high >= stressCoverPrice) {
      const exitPrice = bar.open >= stressCoverPrice ? bar.open : stressCoverPrice;
      const raw = trade.entryPrice / exitPrice - 1;
      const f = fundingBetween(funding, trade.entryTs, bar.openTime);
      const net = raw + f - 2 * costPerSide;
      return [{ ...trade, kind: "BASE" as const, exitTs: bar.openTime, exitPrice,
        accountReturn: trade.requestedGross * net, netUnitReturn: net, progressFail: true,
        diagnostic: { ...diagnosticBase, terminationReason: "STRESS_COVER_STOP", decisionTs: bar.openTime, decision: snapshot(cursor) } }];
    }

    const resumed = bar.close < lowWater && bar.close < features.ema72 && features.btcReturn24h >= 0;
    if (resumed) return [{ ...trade, kind: "BASE" as const, progressFail: true, reentryFrom: bar.openTime,
      diagnostic: { ...diagnosticBase, terminationReason: "RESUME", decisionTs: bar.openTime, decision: snapshot(cursor) } }];
  }

  return [{ ...trade, kind: "BASE" as const, progressFail: true,
    diagnostic: { ...diagnosticBase, terminationReason: "ORIGINAL_EXIT", decisionTs: trade.exitTs, decision: snapshot(originalExitIndex) } }];
}'''


def instrumented_source(venue):
    temp = v17.source_for(venue)
    text = temp.read_text()
    temp.unlink(missing_ok=True)
    fn_start = text.index('function transformShort(')
    fn_end = text.index('\nfunction metrics(', fn_start)
    text = text[:fn_start] + DIAG_FN + text[fn_end:]
    metrics_start = text.index('function metrics(')
    needle = '  return {\n    trades: trades.length,'
    pos = text.index(needle, metrics_start)
    replacement = '''  return {\n    diagnosticEvents: trades.filter((trade: any) => trade.diagnostic).map((trade: any) => ({\n      entryTs: trade.entryTs,\n      exitTs: trade.exitTs,\n      accountReturn: trade.accountReturn,\n      diagnostic: trade.diagnostic,\n    })),\n    trades: trades.length,'''
    text = text[:pos] + replacement + text[pos + len(needle):]
    out = Path(f'scripts/.pengu_v17_arm_diag_{venue.lower()}.ts')
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
            raise RuntimeError(f'V17 arm diagnostic {venue} failed code={cp.returncode}')
        return json.loads(out.read_text())
    finally:
        temp.unlink(missing_ok=True)


def summarize(x):
    rows = []
    for e in x['results']['NORMAL']['CANDIDATE'].get('diagnosticEvents', []):
        d = e.get('diagnostic') or {}
        arm = d.get('arm') or {}
        base = d.get('baselineAccountReturn')
        cand = e.get('accountReturn')
        rows.append({
            'entryTs': e.get('entryTs'),
            'baselineAccountReturn': base,
            'candidateAccountReturn': cand,
            'accountReturnDelta': cand - base if isinstance(cand, (int, float)) and isinstance(base, (int, float)) else None,
            'baselineWin': bool(isinstance(base, (int, float)) and base > 0),
            'candidateWin': bool(isinstance(cand, (int, float)) and cand > 0),
            'armDelayHours': arm.get('armDelayHours'),
            'unit': arm.get('unit'),
            'intrabarMfeAtArm': arm.get('intrabarMfeAtArm'),
            'closeProfitAtArm': arm.get('closeProfitAtArm'),
            'closeConfirmedArm': arm.get('closeConfirmedArm'),
            'armSnapshot': arm.get('snapshot'),
            'failureDelayHours': d.get('failureDelayHours'),
            'failure': d.get('failure'),
            'terminationReason': d.get('terminationReason'),
            'decision': d.get('decision'),
        })
    return rows


def main():
    v17.v15.v12.v11runner.load_binance_klines('PENGUUSDT')
    v17.v15.v12.v11runner.load_binance_klines('BTCUSDT')
    v17.v15.v12.v11runner.load_binance_funding()
    okx = run('OKX')
    binance = run('Binance')

    gp = v17.v15.v12final.load_gate_klines('PENGU_USDT')
    gb = v17.v15.v12final.load_gate_klines('BTC_USDT')
    v17.v15.v12final.write_gate_cache(gp, gb, [])
    gate = run('Gate')

    v17.v15.dense_bitget_candles('PENGUUSDT')
    v17.v15.dense_bitget_candles('BTCUSDT')
    v17.v15.v13.load_bitget_funding()
    bitget = run('Bitget')

    summary = {k: summarize(v) for k, v in {'OKX':okx,'Binance':binance,'Gate':gate,'Bitget':bitget}.items()}
    payload = {
        'status':'PASS_RESEARCH_ONLY',
        'diagnosticOnly':True,
        'frozenCandidate':'CONFIRMED_PROGRESS_FAIL_STRESS_COVER_PROBATION',
        'frozenPreRegistrationSha':v17.PRE_SHA,
        'candidateCount':0,
        'thresholdSweep':False,
        'summary':summary,
        'kucoinPerformanceObserved':False,
        'safety':{'mode':'RESEARCH_ONLY','ordersSent':False,'liveChanged':False,'vpsChanged':False,'productionChanged':False},
    }
    (ROOT/'diagnostic.json').write_text(json.dumps(payload, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps({'counts':{k:len(v) for k,v in summary.items()},'wickOnlyArms':{k:sum(1 for e in v if e.get('closeConfirmedArm') is False) for k,v in summary.items()},'safety':payload['safety']},indent=2))


if __name__ == '__main__':
    main()
