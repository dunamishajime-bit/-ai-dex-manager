#!/usr/bin/env python3
import importlib.util
import json
import os
import subprocess
from pathlib import Path

ROOT = Path('.research-state/pengu-v18-crossvenue-loss-diagnostic')
ROOT.mkdir(parents=True, exist_ok=True)
HOUR = 3_600_000
V18_NAME = 'COUNTERWIND_REVERSIBLE_PROBATION_TO_DEADLINE'
V18_SHA = '42bb6297d893125ad3b2de0a9e26dba342852223'
GATE_Q3_ENTRY_TS = 1771560000000
EXPECTED_NORMAL = {
    'OKX': (42, 222.10090930595317),
    'Binance': (43, 251.71979884972768),
    'Gate': (20, 118.90502119805673),
    'Bitget': (41, 215.4456304339644),
}

spec = importlib.util.spec_from_file_location('diag15', 'scripts/research_pengu_v15_regime_diagnostic.py')
diag15 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(diag15)


def instrumented_source(venue):
    temp = diag15.instrumented_source(venue)
    text = temp.read_text()
    temp.unlink(missing_ok=True)

    old = 'if (bar.close >= costCoverPrice) {'
    if text.count(old) != 1:
        raise RuntimeError(f'expected one frozen V15 cost-floor branch, got {text.count(old)}')
    text = text.replace(old, 'if (false) {', 1)
    text = text.replace('COUNTERWIND_CLOSE_PROBATION_COST_FLOOR_RESUME', V18_NAME)
    text = text.replace('9873c0b3b345f2273b5fe3c6dde4a08ae741f9ef', V18_SHA)
    text = text.replace('pengu-short-v15-', 'pengu-v18-crossloss-')

    marker = '  (trade as any).diagnostic = diagnosticBase;'
    injection = r'''  const trajectoryCostCoverPrice = trade.entryPrice / (1 + 2 * (BASE_FEE_PER_SIDE + STRESS_SLIPPAGE_PER_SIDE));
  const trajectoryDeadlineTs = trade.entryTs + (PENGU_DUAL_LS_V2.short.maxHoldHours / 4) * HOUR;
  const trajectory: any[] = [];
  for (let cursor = failureCursor; cursor <= originalExitIndex; cursor += 1) {
    const row: any = rows[cursor];
    const f: any = row?.features;
    const bar: any = row?.candle;
    if (!f || !bar) continue;
    if (bar.openTime > trajectoryDeadlineTs) break;
    trajectory.push({
      ...snapshot(cursor),
      high: bar.high,
      low: bar.low,
      hoursFromEntry: (bar.openTime - trade.entryTs) / HOUR,
      shortMfe: 1 - bar.low / trade.entryPrice,
      shortMae: bar.high / trade.entryPrice - 1,
      costFloorCovered: bar.close >= trajectoryCostCoverPrice,
      relativeReversed: f.relativeReturn24h >= 0,
      ema72Reclaimed: bar.close >= f.ema72,
      structuralReclaim: bar.close >= trajectoryCostCoverPrice && f.relativeReturn24h >= 0 && bar.close >= f.ema72,
      thesisResumed: bar.close < lowWater && bar.close < f.ema72 && f.btcReturn24h >= 0,
      deadlineReached: bar.openTime >= trajectoryDeadlineTs,
    });
  }
  diagnosticBase.probationTrajectory = trajectory;
  diagnosticBase.provisionalStructuralReclaims = trajectory.filter((x: any) => x.structuralReclaim);
  diagnosticBase.thesisResumeSignals = trajectory.filter((x: any) => x.thesisResumed);
  diagnosticBase.probationMfe = trajectory.length ? Math.max(...trajectory.map((x: any) => x.shortMfe)) : null;
  diagnosticBase.probationMae = trajectory.length ? Math.max(...trajectory.map((x: any) => x.shortMae)) : null;
  diagnosticBase.originalExit = snapshot(originalExitIndex);
  diagnosticBase.baselineWouldWin = trade.accountReturn > 0;
  (trade as any).diagnostic = diagnosticBase;'''
    if text.count(marker) != 1:
        raise RuntimeError(f'diagnostic marker count={text.count(marker)}')
    text = text.replace(marker, injection, 1)

    out = Path(f'scripts/.pengu_v18_crossloss_{venue.lower()}.ts')
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
            raise RuntimeError(f'V18 crossloss {venue} failed code={cp.returncode}')
        x = json.loads(out.read_text())
        wins, ret = EXPECTED_NORMAL[venue]
        actual = x['results']['NORMAL']['CANDIDATE']
        if actual['wins'] != wins or abs(actual['returnPct'] - ret) > 1e-9:
            raise RuntimeError(f'formal V18 parity mismatch {venue}: wins={actual["wins"]} return={actual["returnPct"]}')
        return x
    finally:
        temp.unlink(missing_ok=True)


def compact_event(event):
    d = event.get('diagnostic') or {}
    base_ret = d.get('baselineAccountReturn')
    cand_ret = event.get('accountReturn')
    trajectory = d.get('probationTrajectory') or []
    return {
        'entryTs': event.get('entryTs'),
        'entryIso': None if event.get('entryTs') is None else __import__('datetime').datetime.fromtimestamp(event['entryTs']/1000, __import__('datetime').timezone.utc).isoformat().replace('+00:00','Z'),
        'baselineExitTs': d.get('baselineExitTs'),
        'candidateExitTs': event.get('exitTs'),
        'failureTs': d.get('failureTs'),
        'failureDelayHours': d.get('failureDelayHours'),
        'decisionReason': d.get('decisionReason'),
        'decisionTs': d.get('decisionTs'),
        'baselineAccountReturn': base_ret,
        'candidateAccountReturn': cand_ret,
        'accountReturnDelta': (cand_ret - base_ret) if isinstance(cand_ret, (int, float)) and isinstance(base_ret, (int, float)) else None,
        'baselineWouldWin': bool(d.get('baselineWouldWin')),
        'candidateWouldWin': bool(isinstance(cand_ret, (int, float)) and cand_ret > 0),
        'probationMfe': d.get('probationMfe'),
        'probationMae': d.get('probationMae'),
        'provisionalStructuralReclaims': d.get('provisionalStructuralReclaims') or [],
        'thesisResumeSignals': d.get('thesisResumeSignals') or [],
        'failure': d.get('failure'),
        'decision': d.get('decision'),
        'originalExit': d.get('originalExit'),
        'probationTrajectory': trajectory,
    }


def summarize(x):
    out = {}
    for mode in ('NORMAL', 'STRESS'):
        events = [compact_event(e) for e in x['results'][mode]['CANDIDATE'].get('diagnosticEvents', [])]
        losses = [e for e in events if isinstance(e['candidateAccountReturn'], (int, float)) and e['candidateAccountReturn'] < 0]
        changed_losses = [e for e in losses if isinstance(e['accountReturnDelta'], (int, float)) and abs(e['accountReturnDelta']) > 1e-12]
        out[mode] = {'events': events, 'remainingLosses': losses, 'changedRemainingLosses': changed_losses}
    return out


def align_three(summary):
    aligned = []
    for anchor in summary['OKX']['NORMAL']['remainingLosses']:
        group = {'OKX': anchor}
        for venue in ('Binance', 'Bitget'):
            rows = summary[venue]['NORMAL']['remainingLosses']
            if not rows:
                break
            hit = min(rows, key=lambda e: abs(e['entryTs'] - anchor['entryTs']))
            if abs(hit['entryTs'] - anchor['entryTs']) > 2 * HOUR:
                break
            group[venue] = hit
        if len(group) != 3:
            continue
        key = tuple(group[v]['entryTs'] for v in ('OKX','Binance','Bitget'))
        if any(tuple(g['events'][v]['entryTs'] for v in ('OKX','Binance','Bitget')) == key for g in aligned):
            continue
        aligned.append({
            'entrySpanHours': (max(e['entryTs'] for e in group.values()) - min(e['entryTs'] for e in group.values())) / HOUR,
            'allDeadline': all(e['decisionReason'] == 'DEADLINE' for e in group.values()),
            'allBaselineWouldWin': all(e['baselineWouldWin'] for e in group.values()),
            'allHaveProvisionalStructuralReclaim': all(bool(e['provisionalStructuralReclaims']) for e in group.values()),
            'allNoThesisResume': all(not e['thesisResumeSignals'] for e in group.values()),
            'events': group,
        })
    return aligned


def main():
    diag15.v15.v12.v11runner.load_binance_klines('PENGUUSDT')
    diag15.v15.v12.v11runner.load_binance_klines('BTCUSDT')
    diag15.v15.v12.v11runner.load_binance_funding()
    okx = run('OKX')
    binance = run('Binance')

    gp = diag15.v15.v12final.load_gate_klines('PENGU_USDT')
    gb = diag15.v15.v12final.load_gate_klines('BTC_USDT')
    diag15.v15.v12final.write_gate_cache(gp, gb, [])
    gate = run('Gate')

    bitget_data = {
        'pengu': diag15.v15.dense_bitget_candles('PENGUUSDT'),
        'btc': diag15.v15.dense_bitget_candles('BTCUSDT'),
        'funding': diag15.v15.v13.load_bitget_funding(),
    }
    bitget = run('Bitget')

    raw = {'OKX': okx, 'Binance': binance, 'Gate': gate, 'Bitget': bitget}
    summary = {venue: summarize(x) for venue, x in raw.items()}
    aligned = align_three(summary)

    q3 = {}
    q3_preserved = True
    for mode in ('NORMAL', 'STRESS'):
        hits = [e for e in summary['Gate'][mode]['events'] if e['entryTs'] == GATE_Q3_ENTRY_TS]
        if len(hits) != 1:
            q3_preserved = False
            q3[mode] = {'error': f'count={len(hits)}'}
        else:
            q3[mode] = hits[0]
            if abs(hits[0]['candidateAccountReturn'] - hits[0]['baselineAccountReturn']) > 1e-12:
                q3_preserved = False
    if not q3_preserved:
        raise RuntimeError('Gate Q3 parity guard failed')

    payload = {
        'status': 'PASS_RESEARCH_ONLY',
        'schema': 'pengu-v18-crossvenue-loss-diagnostic/v1',
        'diagnosticOnly': True,
        'frozenCandidate': V18_NAME,
        'frozenPreRegistrationSha': V18_SHA,
        'candidateCount': 0,
        'thresholdSweep': False,
        'formalV18Parity': {v: True for v in EXPECTED_NORMAL},
        'summary': summary,
        'alignedThreeVenueNormalLosses': aligned,
        'gateQ3Preserved': q3_preserved,
        'gateQ3': q3,
        'bitgetData': bitget_data,
        'kucoinPerformanceObserved': False,
        'kucoinHoldoutStatus': 'RESERVED_UNOPENED',
        'safety': {'mode':'RESEARCH_ONLY','ordersSent':False,'liveChanged':False,'vpsChanged':False,'productionChanged':False},
    }
    (ROOT / 'diagnostic.json').write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({
        'remainingNormalLossCounts': {v: len(summary[v]['NORMAL']['remainingLosses']) for v in ('OKX','Binance','Bitget')},
        'changedRemainingNormalLossCounts': {v: len(summary[v]['NORMAL']['changedRemainingLosses']) for v in ('OKX','Binance','Bitget')},
        'alignedThreeVenueNormalLossCount': len(aligned),
        'gateQ3Preserved': q3_preserved,
        'kucoinHoldoutStatus': payload['kucoinHoldoutStatus'],
        'safety': payload['safety'],
    }, indent=2))


if __name__ == '__main__':
    main()
