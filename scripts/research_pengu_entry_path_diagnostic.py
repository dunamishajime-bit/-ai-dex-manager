#!/usr/bin/env python3
import importlib.util
import json
import os
import subprocess
from pathlib import Path

ROOT = Path('.research-state/pengu-entry-path-diagnostic')
ROOT.mkdir(parents=True, exist_ok=True)

spec = importlib.util.spec_from_file_location('v15', 'scripts/research_pengu_short_v15_close_probation_bitget.py')
v15 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v15)


def source_for(venue):
    temp = v15.source_for(venue)
    text = temp.read_text()
    temp.unlink(missing_ok=True)

    iface = '  progressFail?: boolean;\n  reentryFrom?: number;\n}'
    if iface not in text:
        raise RuntimeError('Trade interface signature changed')
    text = text.replace(iface, '  diagnostic?: any;\n  progressFail?: boolean;\n  reentryFrom?: number;\n}', 1)

    needle = '''      const net = raw + (side === "L" ? -fundingReturn : fundingReturn) - 2 * costPerSide;\n      trades.push({'''
    if needle not in text:
        raise RuntimeError('baseline push signature changed')
    insert = '''      const net = raw + (side === "L" ? -fundingReturn : fundingReturn) - 2 * costPerSide;\n      const signalClose = rows[index].candle.close;\n      const pathStats = (hours: number) => {\n        const bars = rows.slice(entryIndex, Math.min(rows.length, entryIndex + hours)).map((row) => row.candle);\n        const low = Math.min(...bars.map((bar) => bar.low));\n        const high = Math.max(...bars.map((bar) => bar.high));\n        const endClose = bars[bars.length - 1].close;\n        return {\n          hours,\n          maxFavorableShort: 1 - low / entry.open,\n          maxAdverseShort: high / entry.open - 1,\n          endCloseReturn: endClose / entry.open - 1,\n          revisitedSignalClose: high >= signalClose,\n        };\n      };\n      trades.push({'''
    text = text.replace(needle, insert, 1)

    btc_close = 'rows[index].btcCandle.close'
    diagnostic_anchor = '''        btcReturn24h: signalFeatures.btcReturn24h,\n      });'''
    if diagnostic_anchor not in text:
        raise RuntimeError('baseline trade object signature changed')
    diagnostic = f'''        btcReturn24h: signalFeatures.btcReturn24h,\n        diagnostic: {{\n          signalTs: rows[index].candle.openTime,\n          signalClose,\n          entryGapVsSignal: entry.open / signalClose - 1,\n          signal: {{\n            atr24Ratio: signalFeatures.atr24Ratio,\n            penguReturn24h: signalFeatures.penguReturn24h,\n            btcReturn24h: signalFeatures.btcReturn24h,\n            relativeReturn24h: signalFeatures.relativeReturn24h,\n            volumeRatio6OverPrior36: signalFeatures.volumeRatio6OverPrior36,\n            rsi14: signalFeatures.rsi14,\n            ema72Distance: rows[index].candle.close / signalFeatures.ema72 - 1,\n            btcEma168Distance: signalFeatures.btcEma168Distance,\n          }},\n          entryBtcClose: {btc_close},\n          path1h: pathStats(1),\n          path3h: pathStats(3),\n          path6h: pathStats(6),\n        }},\n      }});'''
    text = text.replace(diagnostic_anchor, diagnostic, 1)

    metrics_needle = '  return {\n    trades: trades.length,'
    if metrics_needle not in text:
        raise RuntimeError('metrics signature changed')
    metrics_insert = '''  return {\n    tradeDetails: trades.filter((trade) => trade.kind === "BASE").map((trade) => ({\n      side: trade.side,\n      entryTs: trade.entryTs,\n      exitTs: trade.exitTs,\n      entryPrice: trade.entryPrice,\n      exitPrice: trade.exitPrice,\n      requestedGross: trade.requestedGross,\n      accountReturn: trade.accountReturn,\n      netUnitReturn: trade.netUnitReturn,\n      diagnostic: trade.diagnostic ?? null,\n    })),\n    trades: trades.length,'''
    text = text.replace(metrics_needle, metrics_insert, 1)

    out = Path(f'scripts/.pengu_entry_path_diag_{venue.lower()}.ts')
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
            raise RuntimeError(f'entry path diagnostic {venue} failed code={cp.returncode}')
        return json.loads(out.read_text())
    finally:
        temp.unlink(missing_ok=True)


def summarize(x):
    normal = {t['entryTs']: t for t in x['results']['NORMAL']['BASELINE'].get('tradeDetails', []) if t.get('side') == 'S'}
    stress = {t['entryTs']: t for t in x['results']['STRESS']['BASELINE'].get('tradeDetails', []) if t.get('side') == 'S'}
    rows = []
    for ts, t in normal.items():
        s = stress.get(ts, {})
        d = t.get('diagnostic') or {}
        rows.append({
            'entryTs': ts,
            'exitTs': t.get('exitTs'),
            'normalAccountReturn': t.get('accountReturn'),
            'normalWin': bool((t.get('accountReturn') or 0) > 0),
            'stressAccountReturn': s.get('accountReturn'),
            'stressWin': bool((s.get('accountReturn') or 0) > 0),
            'signalTs': d.get('signalTs'),
            'signalClose': d.get('signalClose'),
            'entryPrice': t.get('entryPrice'),
            'entryGapVsSignal': d.get('entryGapVsSignal'),
            'signal': d.get('signal'),
            'path1h': d.get('path1h'),
            'path3h': d.get('path3h'),
            'path6h': d.get('path6h'),
        })
    return sorted(rows, key=lambda r: r['entryTs'])


def main():
    v15.v12.v11runner.load_binance_klines('PENGUUSDT')
    v15.v12.v11runner.load_binance_klines('BTCUSDT')
    v15.v12.v11runner.load_binance_funding()
    okx = run('OKX')
    binance = run('Binance')

    gp = v15.v12final.load_gate_klines('PENGU_USDT')
    gb = v15.v12final.load_gate_klines('BTC_USDT')
    v15.v12final.write_gate_cache(gp, gb, [])
    gate = run('Gate')

    v15.dense_bitget_candles('PENGUUSDT')
    v15.dense_bitget_candles('BTCUSDT')
    v15.v13.load_bitget_funding()
    bitget = run('Bitget')

    summary = {k: summarize(v) for k, v in {'OKX':okx,'Binance':binance,'Gate':gate,'Bitget':bitget}.items()}
    payload = {
        'status':'PASS_RESEARCH_ONLY',
        'diagnosticOnly':True,
        'candidateCount':0,
        'thresholdSweep':False,
        'summary':summary,
        'kucoinPerformanceObserved':False,
        'safety':{'mode':'RESEARCH_ONLY','ordersSent':False,'liveChanged':False,'vpsChanged':False,'productionChanged':False},
    }
    (ROOT/'diagnostic.json').write_text(json.dumps(payload, ensure_ascii=False, indent=2)+'\n')
    brief = {}
    for venue, rows in summary.items():
        wins=[r for r in rows if r['normalWin']]
        losses=[r for r in rows if not r['normalWin']]
        def avg(rs,key):
            vals=[r[key] for r in rs if isinstance(r.get(key),(int,float))]
            return sum(vals)/len(vals) if vals else None
        brief[venue]={
            'shorts':len(rows),'wins':len(wins),'losses':len(losses),
            'avgEntryGapWins':avg(wins,'entryGapVsSignal'),
            'avgEntryGapLosses':avg(losses,'entryGapVsSignal'),
            'signalRetest6hWins':sum(1 for r in wins if (r.get('path6h') or {}).get('revisitedSignalClose')),
            'signalRetest6hLosses':sum(1 for r in losses if (r.get('path6h') or {}).get('revisitedSignalClose')),
        }
    print(json.dumps({'brief':brief,'safety':payload['safety']},indent=2))


if __name__ == '__main__':
    main()
