#!/usr/bin/env python3
import importlib.util
import json
import os
import subprocess
from pathlib import Path

ROOT = Path('.research-state/pengu-short-v18')
ROOT.mkdir(parents=True, exist_ok=True)
PRE_SHA = '42bb6297d893125ad3b2de0a9e26dba342852223'
V17_PRE_SHA = '9b02e7ec708d02c712d7577cbd50cc548492d311'
V17_NAME = 'COUNTERWIND_STRUCTURAL_RECLAIM_PROBATION'
V18_NAME = 'COUNTERWIND_REVERSIBLE_PROBATION_TO_DEADLINE'

spec = importlib.util.spec_from_file_location('v17', 'scripts/research_pengu_short_v17_structural_reclaim.py')
v17 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v17)


def source_for(venue):
    temp = v17.source_for(venue)
    text = temp.read_text()
    temp.unlink(missing_ok=True)

    if text.count(V17_PRE_SHA) < 1:
        raise RuntimeError('Frozen V17 preregistration SHA not found')
    text = text.replace(V17_PRE_SHA, PRE_SHA)
    text = text.replace(V17_NAME, V18_NAME)

    old = 'if (bar.close >= costCoverPrice && features.relativeReturn24h >= 0 && bar.close >= features.ema72) {'
    new = 'if (false) {'
    if text.count(old) != 1:
        raise RuntimeError(f'Expected exactly one V17 early probation exit, got {text.count(old)}')
    text = text.replace(old, new, 1)
    text = text.replace('pengu-short-v17-', 'pengu-short-v18-')

    out = Path(f'scripts/.pengu_v18_{venue.lower()}.ts')
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
            raise RuntimeError(f'V18 {venue} failed code={cp.returncode}')
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
    v17.v16.v15.v12.v11runner.load_binance_klines('PENGUUSDT')
    v17.v16.v15.v12.v11runner.load_binance_klines('BTCUSDT')
    v17.v16.v15.v12.v11runner.load_binance_funding()
    okx = run('OKX')
    binance = run('Binance')

    gp = v17.v16.v15.v12final.load_gate_klines('PENGU_USDT')
    gb = v17.v16.v15.v12final.load_gate_klines('BTC_USDT')
    v17.v16.v15.v12final.write_gate_cache(gp, gb, [])
    gate = run('Gate')

    bitget_data = {
        'pengu': v17.v16.v15.dense_bitget_candles('PENGUUSDT'),
        'btc': v17.v16.v15.dense_bitget_candles('BTCUSDT'),
        'funding': v17.v16.v15.v13.load_bitget_funding(),
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
        'schema': 'pengu-short-v18-development/v1',
        'candidate': V18_NAME,
        'preRegistrationSha': PRE_SHA,
        'candidateCount': 1,
        'thresholdSweep': False,
        'ruleChangeCount': 1,
        'ruleChange': 'intermediate probation cost/relative/EMA reclaim no longer terminates early; unrecovered events exit only at inherited deadline',
        'venues': {'OKX': okx, 'Binance': binance, 'Gate': gate, 'Bitget': bitget},
        'bitgetData': bitget_data,
        'venuePasses': passes,
        'developmentPass': development_pass,
        'kucoinPerformanceObserved': False,
        'kucoinHoldoutStatus': 'ELIGIBLE_TO_OPEN' if development_pass else 'RESERVED_UNOPENED',
        'promotionPass': False,
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
        'venuePasses': passes,
        'kucoinHoldoutStatus': result['kucoinHoldoutStatus'],
        'safety': result['safety'],
    }, indent=2))


if __name__ == '__main__':
    main()
