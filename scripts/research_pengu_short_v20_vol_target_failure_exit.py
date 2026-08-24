#!/usr/bin/env python3
import importlib.util
import json
import os
import subprocess
from pathlib import Path

ROOT = Path('.research-state/pengu-short-v20')
ROOT.mkdir(parents=True, exist_ok=True)
PRE_SHA = 'ad7cedb3cafaf9f9680e390112f72375d84b50ac'
V18_PRE_SHA = '42bb6297d893125ad3b2de0a9e26dba342852223'
V18_NAME = 'COUNTERWIND_REVERSIBLE_PROBATION_TO_DEADLINE'
V20_NAME = 'COUNTERWIND_VOL_TARGET_FAILURE_EXIT'

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
    text = text.replace(V18_NAME, V20_NAME)

    # Insert the one preregistered V20 branch only after the existing V18 progression
    # failure has been confirmed. probationIndex is already cursor+1, i.e. the next H1.
    cost_marker = '  const costPerSide = BASE_FEE_PER_SIDE + (mode === "stress" ? STRESS_SLIPPAGE_PER_SIDE : 0);\n'
    if text.count(cost_marker) != 1:
        raise RuntimeError(f'Expected one V18 cost declaration, got {text.count(cost_marker)}')

    v20_branch = cost_marker + r'''  const v20SizingState = trade.requestedGross === PENGU_DUAL_LS_V2.sizing.grossCap
    ? "CAP"
    : trade.requestedGross === PENGU_DUAL_LS_V2.sizing.grossFloor
      ? "FLOOR"
      : "VOL_TARGET";

  // V20 single preregistered change: VOL_TARGET progression failures restore the old
  // V11 next-H1-open full exit. CAP/FLOOR remain on the frozen V18 probation lifecycle.
  if (v20SizingState === "VOL_TARGET") {
    const failureExit = rows[probationIndex].candle;
    const failureExitTs = failureExit.openTime;
    const raw = trade.entryPrice / failureExit.open - 1;
    const f = fundingBetween(funding, trade.entryTs, failureExitTs);
    const net = raw + f - 2 * costPerSide;
    return [{ ...trade, kind: "BASE" as const, exitTs: failureExitTs, exitPrice: failureExit.open,
      accountReturn: trade.requestedGross * net, netUnitReturn: net, progressFail: true,
      v20VolTargetFailureExit: true }];
  }
'''
    text = text.replace(cost_marker, v20_branch, 1)
    text = text.replace('pengu-short-v18-', 'pengu-short-v20-')

    out = Path(f'scripts/.pengu_v20_{venue.lower()}.ts')
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
            raise RuntimeError(f'V20 {venue} failed code={cp.returncode}')
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
    # Known venues only. KuCoin remains unopened unless every frozen known-venue gate passes.
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
        'GateDiagnostic': gate_nonworse(gate),
        'Bitget': bool(bitget['promotion']['pass']),
    }
    development_pass = all(passes.values())
    result = {
        'status': 'PASS_RESEARCH_ONLY',
        'schema': 'pengu-short-v20-development/v1',
        'candidate': V20_NAME,
        'preRegistrationSha': PRE_SHA,
        'parentV18PreRegistrationSha': V18_PRE_SHA,
        'candidateCount': 1,
        'thresholdSweep': False,
        'featureCombinationSearch': False,
        'ruleChangeCount': 1,
        'ruleChange': 'on existing progression failure, VOL_TARGET original sizing exits full short at next H1 open using restored V11 failure-exit lifecycle; CAP/FLOOR remain frozen V18',
        'venues': {'OKX': okx, 'Binance': binance, 'Gate': gate, 'Bitget': bitget},
        'bitgetData': bitget_data,
        'venuePasses': passes,
        'developmentPass': development_pass,
        'gateQ3ProtectedBySizingRule': True,
        'gateQ3RequiredSizingState': 'CAP',
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
