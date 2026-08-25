#!/usr/bin/env python3
import importlib.util
import json
import os
import subprocess
from pathlib import Path

ROOT = Path('.research-state/pengu-short-v12-gate-reentry-diagnostic')
ROOT.mkdir(parents=True, exist_ok=True)

spec = importlib.util.spec_from_file_location('final', 'scripts/research_pengu_short_v12_gate_final.py')
final = importlib.util.module_from_spec(spec)
spec.loader.exec_module(final)


def make_source():
    pengu = final.load_gate_klines('PENGU_USDT')
    btc = final.load_gate_klines('BTC_USDT')
    final.write_gate_cache(pengu, btc, [])
    temp = final.gate_source(final.PRICE_WARM, final.PRICE_START, final.PRICE_END)
    text = temp.read_text()

    old_iface = '''  btcReturn24h: number;\n  progressFail?: boolean;\n  reentryFrom?: number;\n}'''
    new_iface = '''  btcReturn24h: number;\n  relativeReturn24h?: number;\n  penguReturn24h?: number;\n  volumeRatio6OverPrior36?: number;\n  rsi14?: number;\n  ema72DistancePct?: number;\n  delayFromOriginalEntryHours?: number;\n  progressFail?: boolean;\n  reentryFrom?: number;\n}'''
    if old_iface not in text:
        raise RuntimeError('Trade interface signature changed')
    text = text.replace(old_iface, new_iface)

    old_obj = '''    btcEma168Distance: reSignalFeatures.btcEma168Distance,\n    btcReturn24h: reSignalFeatures.btcReturn24h,\n    reentryFrom: trade.entryTs,\n  };'''
    new_obj = '''    btcEma168Distance: reSignalFeatures.btcEma168Distance,\n    btcReturn24h: reSignalFeatures.btcReturn24h,\n    relativeReturn24h: reSignalFeatures.relativeReturn24h,\n    penguReturn24h: reSignalFeatures.penguReturn24h,\n    volumeRatio6OverPrior36: reSignalFeatures.volumeRatio6OverPrior36,\n    rsi14: reSignalFeatures.rsi14,\n    ema72DistancePct: (reSignalFeatures.close / reSignalFeatures.ema72 - 1) * 100,\n    delayFromOriginalEntryHours: (reentry.openTime - trade.entryTs) / HOUR,\n    reentryFrom: trade.entryTs,\n  };'''
    if old_obj not in text:
        raise RuntimeError('reentry trade signature changed')
    text = text.replace(old_obj, new_obj)

    old_result = '''      withoutBestReentry: removeBestReentry(baseline, candidate),\n    };'''
    new_result = '''      withoutBestReentry: removeBestReentry(baseline, candidate),\n      REENTRY_TRADES: candidate.filter((trade) => trade.kind === "REENTRY"),\n      BASE_TRADES: baseline,\n    };'''
    if old_result not in text:
        raise RuntimeError('result signature changed')
    text = text.replace(old_result, new_result)

    out = Path('scripts/.pengu_v12_gate_diag.ts')
    out.write_text(text)
    return out, len(pengu), len(btc)


def main():
    temp, pengu_rows, btc_rows = make_source()
    raw_path = ROOT / 'raw.json'
    env = dict(os.environ)
    env['PENGU_V11_OUT'] = str(raw_path)
    try:
        cp = subprocess.run(['npx','tsx',str(temp)], env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        (ROOT/'run.log').write_text(cp.stdout)
        print(cp.stdout)
        if cp.returncode != 0:
            raise RuntimeError(f'Gate diagnostic replay failed code={cp.returncode}')
    finally:
        temp.unlink(missing_ok=True)

    raw = json.loads(raw_path.read_text())
    normal = raw['results']['NORMAL']
    reentries = normal.get('REENTRY_TRADES', [])
    bases = normal.get('BASE_TRADES', [])
    base_by_entry = {t['entryTs']: t for t in bases}
    enriched = []
    for r in reentries:
        enriched.append({
            'reentry': r,
            'parent': base_by_entry.get(r.get('reentryFrom')),
            'win': r.get('accountReturn', 0) > 0,
        })

    out = {
        'status':'PASS_RESEARCH_ONLY',
        'diagnosticOnly':True,
        'candidate':'RAPID_RISKON_RELATIVE_WEAKNESS_REENTRY',
        'v12PreRegistrationSha':'2cfe0d7bb829e6cd928cef4871e1f0168c098506',
        'venue':'Gate',
        'period':[final.PRICE_START, final.PRICE_END],
        'penguRows':pengu_rows,
        'btcRows':btc_rows,
        'reentries':enriched,
        'count':len(enriched),
        'wins':sum(1 for x in enriched if x['win']),
        'safety':{'mode':'RESEARCH_ONLY','ordersSent':False,'liveChanged':False,'vpsChanged':False,'productionChanged':False},
    }
    (ROOT/'diagnostic.json').write_text(json.dumps(out, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(out, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main()
