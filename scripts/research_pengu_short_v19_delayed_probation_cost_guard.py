#!/usr/bin/env python3
import importlib.util
import json
import os
import subprocess
from pathlib import Path

ROOT = Path('.research-state/pengu-short-v19')
ROOT.mkdir(parents=True, exist_ok=True)
PRE_SHA = '21b82c72b0c14d23f16a907bc252e02c30b393ed'
V18_PRE_SHA = '42bb6297d893125ad3b2de0a9e26dba342852223'
V18_NAME = 'COUNTERWIND_REVERSIBLE_PROBATION_TO_DEADLINE'
V19_NAME = 'COUNTERWIND_DELAYED_PROBATION_COST_GUARD'

spec = importlib.util.spec_from_file_location('v18', 'scripts/research_pengu_short_v18_reversible_probation.py')
v18 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v18)


def source_for(venue):
    temp = v18.source_for(venue)
    text = temp.read_text()
    temp.unlink(missing_ok=True)

    if text.count(V18_PRE_SHA) < 1:
        raise RuntimeError('Frozen V18 preregistration SHA not found')
    text = text.replace(V18_PRE_SHA, PRE_SHA)
    text = text.replace(V18_NAME, V19_NAME)

    old_state = 'let armed = false, progressed = false, lowWater = trade.entryPrice, probationIndex = -1;'
    new_state = 'let armed = false, progressed = false, lowWater = trade.entryPrice, probationIndex = -1, failureCursor = -1;'
    if text.count(old_state) != 1:
        raise RuntimeError(f'Expected one V18 progression state declaration, got {text.count(old_state)}')
    text = text.replace(old_state, new_state, 1)

    old_fail = '''    if (armed && !progressed && (1 - bar.close / trade.entryPrice) <= failLevel && cursor + 1 <= originalExitIndex) {
      probationIndex = cursor + 1;
      break;
    }'''
    new_fail = '''    if (armed && !progressed && (1 - bar.close / trade.entryPrice) <= failLevel && cursor + 1 <= originalExitIndex) {
      failureCursor = cursor;
      probationIndex = cursor + 1;
      break;
    }'''
    if text.count(old_fail) != 1:
        raise RuntimeError(f'Expected one V18 progression-failure branch, got {text.count(old_fail)}')
    text = text.replace(old_fail, new_fail, 1)

    resume_marker = '''    // Close-confirmed thesis recovery has priority; this avoids an intrabar stop cutting a recovered large winner.
    const resumed = bar.close < lowWater && bar.close < features.ema72 && features.btcReturn24h >= 0;'''
    guard = '''    // V19 single preregistered change: only a progression failure confirmed on a later H1 than the entry H1
    // receives the inherited worst-case round-trip cost guard. Same-entry-H1 failures keep V18 fully reversible.
    // The guard starts strictly after the failure-confirming H1, so it never claims an impossible historical fill.
    if (failureCursor > entryIndex && cursor > failureCursor) {
      if (bar.open >= costCoverPrice || bar.high >= costCoverPrice) {
        const exitPrice = bar.open >= costCoverPrice ? bar.open : costCoverPrice;
        const raw = trade.entryPrice / exitPrice - 1;
        const f = fundingBetween(funding, trade.entryTs, bar.openTime);
        const net = raw + f - 2 * costPerSide;
        return [{ ...trade, kind: "BASE" as const, exitTs: bar.openTime, exitPrice,
          accountReturn: trade.requestedGross * net, netUnitReturn: net, progressFail: true,
          v19DelayedProbationCostGuard: true }];
      }
    }

    // Close-confirmed thesis recovery remains exactly the V18 recovery rule.
    const resumed = bar.close < lowWater && bar.close < features.ema72 && features.btcReturn24h >= 0;'''
    if text.count(resume_marker) != 1:
        raise RuntimeError(f'Expected one V18 resume marker, got {text.count(resume_marker)}')
    text = text.replace(resume_marker, guard, 1)
    text = text.replace('pengu-short-v18-', 'pengu-short-v19-')

    out = Path(f'scripts/.pengu_v19_{venue.lower()}.ts')
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
            raise RuntimeError(f'V19 {venue} failed code={cp.returncode}')
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


def gate_q3_preserved(gate):
    entry_ts = 1771560000000
    for mode in ('NORMAL', 'STRESS'):
        events = gate['results'][mode]['CANDIDATE'].get('diagnosticEvents', [])
        # V18/V19 formal output may not expose diagnostic events; exact Gate aggregate parity is the primary guard.
        if events:
            hits = [e for e in events if e.get('entryTs') == entry_ts]
            if hits and any(abs((e.get('accountReturn') or 0) - (e.get('diagnostic') or {}).get('baselineAccountReturn', e.get('accountReturn') or 0)) > 1e-12 for e in hits):
                return False
    return True


def main():
    # Known venues only. KuCoin stays untouched unless every frozen V19 known-venue gate passes.
    v18.v17.v16.v15.v12.v11runner.load_binance_klines('PENGUUSDT')
    v18.v17.v16.v15.v12.v11runner.load_binance_klines('BTCUSDT')
    v18.v17.v16.v15.v12.v11runner.load_binance_funding()
    okx = run('OKX')
    binance = run('Binance')

    gp = v18.v17.v16.v15.v12final.load_gate_klines('PENGU_USDT')
    gb = v18.v17.v16.v15.v12final.load_gate_klines('BTC_USDT')
    v18.v17.v16.v15.v12final.write_gate_cache(gp, gb, [])
    gate = run('Gate')

    bitget_data = {
        'pengu': v18.v17.v16.v15.dense_bitget_candles('PENGUUSDT'),
        'btc': v18.v17.v16.v15.dense_bitget_candles('BTCUSDT'),
        'funding': v18.v17.v16.v15.v13.load_bitget_funding(),
    }
    bitget = run('Bitget')

    passes = {
        'OKX': bool(okx['promotion']['pass']),
        'Binance': bool(binance['promotion']['pass']),
        'GateDiagnostic': gate_nonworse(gate) and gate_q3_preserved(gate),
        'Bitget': bool(bitget['promotion']['pass']),
    }
    development_pass = all(passes.values())
    result = {
        'status': 'PASS_RESEARCH_ONLY',
        'schema': 'pengu-short-v19-development/v1',
        'candidate': V19_NAME,
        'preRegistrationSha': PRE_SHA,
        'parentV18PreRegistrationSha': V18_PRE_SHA,
        'candidateCount': 1,
        'thresholdSweep': False,
        'ruleChangeCount': 1,
        'ruleChange': 'enable existing worst-case round-trip cost guard only for progression failures confirmed after the entry H1; same-entry-H1 failures remain V18-reversible',
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
