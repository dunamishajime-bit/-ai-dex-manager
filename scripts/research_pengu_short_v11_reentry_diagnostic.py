#!/usr/bin/env python3
import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path('.research-state/pengu-short-v11-reentry-diagnostic')
ROOT.mkdir(parents=True, exist_ok=True)

spec = importlib.util.spec_from_file_location('v11runner', 'scripts/research_pengu_short_v11_okx_binance.py')
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)

DIAG_SNIPPET = r'''
    const reentryDiagnostics = candidate.filter((trade) => trade.kind === "REENTRY").map((trade) => {
      const parent = baseline.find((baseTrade) => baseTrade.entryTs === trade.reentryFrom);
      const firstLeg = candidate.find((candidateTrade) => candidateTrade.kind === "BASE" && candidateTrade.entryTs === trade.reentryFrom && candidateTrade.progressFail);
      const reentryIndex = rowIndex.get(trade.entryTs);
      const parentIndex = parent ? rowIndex.get(parent.entryTs) : undefined;
      const failureIndex = firstLeg ? rowIndex.get(firstLeg.exitTs) : undefined;
      const signalRow = reentryIndex !== undefined && reentryIndex > 0 ? rows[reentryIndex - 1] : undefined;
      const parentSignalRow = parentIndex !== undefined && parentIndex > 0 ? rows[parentIndex - 1] : undefined;
      let lowWater: number | null = null;
      if (parentIndex !== undefined && failureIndex !== undefined) {
        lowWater = Number.POSITIVE_INFINITY;
        for (let cursor = parentIndex; cursor <= failureIndex; cursor += 1) lowWater = Math.min(lowWater, rows[cursor].candle.low);
        if (!Number.isFinite(lowWater)) lowWater = null;
      }
      const signalClose = signalRow?.candle.close ?? null;
      const ema72 = (signalRow?.features as any)?.ema72 ?? null;
      return {
        entryTs: trade.entryTs,
        exitTs: trade.exitTs,
        reentryFrom: trade.reentryFrom,
        win: trade.accountReturn > 0,
        accountReturn: trade.accountReturn,
        netUnitReturn: trade.netUnitReturn,
        requestedGross: trade.requestedGross,
        parentOriginalReturn: parent?.accountReturn ?? null,
        firstLegReturn: firstLeg?.accountReturn ?? null,
        delayFromFailureHours: firstLeg ? (trade.entryTs - firstLeg.exitTs) / HOUR : null,
        delayFromOriginalEntryHours: parent ? (trade.entryTs - parent.entryTs) / HOUR : null,
        signalClose,
        lowWater,
        breachBelowLowPct: lowWater && signalClose ? (lowWater - signalClose) / lowWater * 100 : null,
        ema72DistancePct: ema72 && signalClose ? (signalClose / ema72 - 1) * 100 : null,
        reentrySignalFeatures: signalRow?.features ?? null,
        parentSignalFeatures: parentSignalRow?.features ?? null,
      };
    });
'''

ASSIGN = '''    output.results[mode.toUpperCase()] = {\n      BASELINE: metrics(baseline),\n      CANDIDATE: metrics(candidate),\n      FOLDS: folds,\n      withoutBestReentry: removeBestReentry(baseline, candidate),\n    };\n'''


def patched_source(venue: str):
    source = runner.SOURCE.read_text()
    begin = source.index('async function bybit(')
    end = source.index('function fundingBetween', begin)
    replacement = runner.OKX_FUNCS if venue == 'OKX' else runner.BINANCE_FUNCS
    source = source[:begin] + replacement + source[end:]
    source = source.replace('venue: "Bybit"', f'venue: "{venue}"')
    source = source.replace('schema: "pengu-short-v11-bybit-holdout/v1"', f'schema: "pengu-short-v11-{venue.lower()}-diagnostic/v1"')
    if ASSIGN not in source:
        raise RuntimeError('V11 result assignment signature changed')
    source = source.replace(ASSIGN, DIAG_SNIPPET + ASSIGN.replace('    };\n', '      REENTRY_DIAGNOSTICS: reentryDiagnostics,\n    };\n'))
    temp = Path(f'scripts/.pengu_v11_diag_{venue.lower()}.ts')
    temp.write_text(source)
    return temp


def run_venue(venue: str):
    temp = patched_source(venue)
    output = ROOT / f'{venue.lower()}.json'
    env = dict(os.environ)
    env['PENGU_V11_OUT'] = str(output)
    try:
        cp = subprocess.run(['npx', 'tsx', str(temp)], env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        (ROOT / f'{venue.lower()}.log').write_text(cp.stdout)
        if cp.returncode != 0:
            print(cp.stdout)
            raise RuntimeError(f'diagnostic {venue} failed code={cp.returncode}')
        return json.loads(output.read_text())
    finally:
        temp.unlink(missing_ok=True)


def summarize(result):
    rows = result['results']['NORMAL']['REENTRY_DIAGNOSTICS']
    wins = [x for x in rows if x['win']]
    losses = [x for x in rows if not x['win']]
    def stats(items):
        if not items:
            return {'n': 0}
        keys = ['accountReturn','delayFromFailureHours','delayFromOriginalEntryHours','breachBelowLowPct','ema72DistancePct']
        out = {'n': len(items)}
        for key in keys:
            vals = [x[key] for x in items if x.get(key) is not None]
            if vals:
                out[key] = {'mean': sum(vals)/len(vals), 'min': min(vals), 'max': max(vals)}
        feature_keys = ['atr24Ratio','btcEma168Distance','btcReturn24h','return6h','return24h','return72h','volumeRatio','rsi14']
        out['features'] = {}
        for key in feature_keys:
            vals = [x.get('reentrySignalFeatures',{}).get(key) for x in items if x.get('reentrySignalFeatures') and x['reentrySignalFeatures'].get(key) is not None]
            if vals:
                out['features'][key] = {'mean': sum(vals)/len(vals), 'min': min(vals), 'max': max(vals)}
        return out
    return {'all': rows, 'wins': stats(wins), 'losses': stats(losses)}


def main():
    # Populate the same official Binance Vision cache used by frozen V11 cross-venue.
    runner.load_binance_klines('PENGUUSDT')
    runner.load_binance_klines('BTCUSDT')
    runner.load_binance_funding()
    okx = run_venue('OKX')
    binance = run_venue('Binance')
    out = {
        'status':'PASS_RESEARCH_ONLY',
        'frozenCandidateSha':runner.FROZEN_SHA,
        'diagnosticOnly':True,
        'venues': {'OKX': summarize(okx), 'Binance': summarize(binance)},
        'safety': {'mode':'RESEARCH_ONLY','ordersSent':False,'liveChanged':False,'vpsChanged':False,'productionChanged':False},
    }
    (ROOT/'diagnostic.json').write_text(json.dumps(out, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps(out, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main()
