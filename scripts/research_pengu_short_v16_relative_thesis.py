#!/usr/bin/env python3
import importlib.util
import json
import os
import subprocess
from pathlib import Path

ROOT = Path('.research-state/pengu-short-v16')
ROOT.mkdir(parents=True, exist_ok=True)
PRE_SHA = '1528d182ad3593460d325e2c1e1f6bacf0b07795'
V15_PRE_SHA = '9873c0b3b345f2273b5fe3c6dde4a08ae741f9ef'
V15_NAME = 'COUNTERWIND_CLOSE_PROBATION_COST_FLOOR_RESUME'
V16_NAME = 'COUNTERWIND_RELATIVE_THESIS_PROBATION'

spec = importlib.util.spec_from_file_location('v15', 'scripts/research_pengu_short_v15_close_probation_bitget.py')
v15 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v15)


def source_for(venue):
    temp = v15.source_for(venue)
    text = temp.read_text()
    temp.unlink(missing_ok=True)

    if text.count(V15_PRE_SHA) < 1:
        raise RuntimeError('Frozen V15 preregistration SHA not found in generated source')
    text = text.replace(V15_PRE_SHA, PRE_SHA)
    text = text.replace(V15_NAME, V16_NAME)

    old = 'if (bar.close >= costCoverPrice) {'
    new = 'if (bar.close >= costCoverPrice && features.relativeReturn24h >= 0) {'
    if text.count(old) != 1:
        raise RuntimeError(f'Expected exactly one V15 cost-floor decision, got {text.count(old)}')
    text = text.replace(old, new, 1)

    text = text.replace('pengu-short-v15-', 'pengu-short-v16-')
    out = Path(f'scripts/.pengu_v16_{venue.lower()}.ts')
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
            raise RuntimeError(f'V16 {venue} failed code={cp.returncode}')
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
    # Known venues only. KuCoin performance remains unopened unless these gates pass.
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
        'schema': 'pengu-short-v16-development/v1',
        'candidate': V16_NAME,
        'preRegistrationSha': PRE_SHA,
        'candidateCount': 1,
        'thresholdSweep': False,
        'ruleChangeCount': 1,
        'ruleChange': 'cost-floor exit additionally requires features.relativeReturn24h >= 0',
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
