#!/usr/bin/env python3
import importlib.util
import json
import os
import subprocess
from pathlib import Path

ROOT = Path('.research-state/pengu-v16-q3-decision-diagnostic')
ROOT.mkdir(parents=True, exist_ok=True)
TARGET_ENTRY_TS = 1771560000000

spec = importlib.util.spec_from_file_location('diag15', 'scripts/research_pengu_v15_regime_diagnostic.py')
diag15 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(diag15)


def main():
    gp = diag15.v15.v12final.load_gate_klines('PENGU_USDT')
    gb = diag15.v15.v12final.load_gate_klines('BTC_USDT')
    diag15.v15.v12final.write_gate_cache(gp, gb, [])

    temp = diag15.instrumented_source('Gate')
    text = temp.read_text()
    temp.unlink(missing_ok=True)

    old = 'if (bar.close >= costCoverPrice) {'
    new = 'if (bar.close >= costCoverPrice && features.relativeReturn24h >= 0) {'
    if text.count(old) != 1:
        raise RuntimeError(f'expected one frozen V15 cost-floor condition, got {text.count(old)}')
    text = text.replace(old, new, 1)
    text = text.replace('withDecision("COST_FLOOR", cursor)', 'withDecision("RELATIVE_COST_FLOOR", cursor)')
    text = text.replace('COUNTERWIND_CLOSE_PROBATION_COST_FLOOR_RESUME', 'COUNTERWIND_RELATIVE_THESIS_PROBATION')
    text = text.replace('9873c0b3b345f2273b5fe3c6dde4a08ae741f9ef', '1528d182ad3593460d325e2c1e1f6bacf0b07795')

    source = Path('scripts/.pengu_v16_q3_gate_diag.ts')
    source.write_text(text)
    raw = ROOT / 'raw.json'
    env = dict(os.environ)
    env['PENGU_V11_OUT'] = str(raw)
    try:
        cp = subprocess.run(['npx', 'tsx', str(source)], env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        (ROOT / 'run.log').write_text(cp.stdout)
        print(cp.stdout)
        if cp.returncode != 0:
            raise RuntimeError(f'Gate V16 decision diagnostic failed code={cp.returncode}')
    finally:
        source.unlink(missing_ok=True)

    x = json.loads(raw.read_text())
    rows = []
    for mode in ('NORMAL', 'STRESS'):
        events = x['results'][mode]['CANDIDATE'].get('diagnosticEvents', [])
        hit = [e for e in events if e.get('entryTs') == TARGET_ENTRY_TS]
        if len(hit) != 1:
            raise RuntimeError(f'{mode} target event count={len(hit)}')
        e = hit[0]
        d = e.get('diagnostic') or {}
        rows.append({
            'mode': mode,
            'entryTs': e.get('entryTs'),
            'baselineAccountReturn': d.get('baselineAccountReturn'),
            'candidateAccountReturn': e.get('accountReturn'),
            'decisionReason': d.get('decisionReason'),
            'failureDelayHours': d.get('failureDelayHours'),
            'failure': d.get('failure'),
            'decision': d.get('decision'),
            'entryToFailure': d.get('entryToFailure'),
            'failureToDecision': d.get('failureToDecision'),
            'entryToDecision': d.get('entryToDecision'),
        })

    out = {
        'status': 'PASS_RESEARCH_ONLY',
        'diagnosticOnly': True,
        'candidate': 'COUNTERWIND_RELATIVE_THESIS_PROBATION',
        'preRegistrationSha': '1528d182ad3593460d325e2c1e1f6bacf0b07795',
        'venue': 'Gate',
        'targetEntryTs': TARGET_ENTRY_TS,
        'results': rows,
        'kucoinPerformanceObserved': False,
        'safety': {
            'mode': 'RESEARCH_ONLY',
            'ordersSent': False,
            'liveChanged': False,
            'vpsChanged': False,
            'productionChanged': False,
        },
    }
    (ROOT / 'diagnostic.json').write_text(json.dumps(out, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
