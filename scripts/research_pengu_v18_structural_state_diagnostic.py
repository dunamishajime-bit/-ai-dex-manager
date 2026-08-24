#!/usr/bin/env python3
import importlib.util
import json
import os
import subprocess
from pathlib import Path

ROOT = Path('.research-state/pengu-v18-structural-state-diagnostic')
ROOT.mkdir(parents=True, exist_ok=True)
TARGET_ENTRY_TS = 1737792000000  # 2025-01-25T08:00:00Z
GATE_Q3_ENTRY_TS = 1771560000000
CATEGORY_FIELDS = (
    'baselineExitReason',
    'priorShortSetupActive',
    'priorShortSetupArmed',
    'sizingState',
    'signalImpulseCondition',
    'priorImpulseCondition',
    'entryCounterwindBranch',
    'failureCounterwindBranch',
)

spec = importlib.util.spec_from_file_location(
    'crossloss', 'scripts/research_pengu_v18_crossvenue_loss_diagnostic.py'
)
crossloss = importlib.util.module_from_spec(spec)
spec.loader.exec_module(crossloss)


def branch(ema_distance, btc_return):
    ema = isinstance(ema_distance, (int, float)) and ema_distance >= 0
    ret = isinstance(btc_return, (int, float)) and btc_return >= 0
    if ema and ret:
        return 'BOTH'
    if ema:
        return 'EMA_ONLY'
    if ret:
        return 'RETURN_ONLY'
    return 'NEITHER'


def structural_source(venue):
    temp = crossloss.instrumented_source(venue)
    text = temp.read_text()
    temp.unlink(missing_ok=True)

    interface_marker = '  reentryFrom?: number;\n}'
    if text.count(interface_marker) != 1:
        raise RuntimeError(f'Trade interface marker count={text.count(interface_marker)}')
    text = text.replace(
        interface_marker,
        '''  reentryFrom?: number;\n  baselineExitReason?: string;\n  priorShortSetupActive?: boolean;\n  priorShortSetupArmed?: boolean;\n  sizingState?: string;\n  signalImpulseCondition?: boolean;\n  priorImpulseCondition?: boolean;\n}''',
        1,
    )

    replay_start = text.index('function replayBaseline(')
    replay_end = text.index('\nfunction nextBaselineEntry', replay_start)
    replay = text[replay_start:replay_end]

    exit_init = '    let exitIndex = last;\n    let exitPrice = rows[last].candle.close;'
    if replay.count(exit_init) != 1:
        raise RuntimeError(f'replay exit init count={replay.count(exit_init)}')
    replay = replay.replace(
        exit_init,
        '''    let exitIndex = last;\n    let exitPrice = rows[last].candle.close;\n    let baselineExitReason = side === "L" ? "LONG_MAX_HOLD" : "SHORT_MAX_HOLD";''',
        1,
    )

    exit_branch = '''      if (evaluation.exit) {\n        exitIndex = cursor;\n        exitPrice = evaluation.exit.stopPrice ?? rows[cursor].candle.close;\n        break;\n      }'''
    if replay.count(exit_branch) != 1:
        raise RuntimeError(f'replay exit branch count={replay.count(exit_branch)}')
    replay = replay.replace(
        exit_branch,
        '''      if (evaluation.exit) {\n        exitIndex = cursor;\n        exitPrice = evaluation.exit.stopPrice ?? rows[cursor].candle.close;\n        baselineExitReason = evaluation.exit.reason;\n        break;\n      }''',
        1,
    )

    trade_push = '''        btcEma168Distance: signalFeatures.btcEma168Distance,\n        btcReturn24h: signalFeatures.btcReturn24h,\n      });'''
    if replay.count(trade_push) != 1:
        raise RuntimeError(f'replay trade push count={replay.count(trade_push)}')
    trade_push_replacement = '''        btcEma168Distance: signalFeatures.btcEma168Distance,\n        btcReturn24h: signalFeatures.btcReturn24h,\n        baselineExitReason,\n        priorShortSetupActive: index > 0 ? rows[index - 1].shortSetupActive : false,\n        priorShortSetupArmed: index > 0 ? rows[index - 1].shortSetupArmed : false,\n        sizingState: gross === PENGU_DUAL_LS_V2.sizing.grossCap\n          ? "CAP"\n          : gross === PENGU_DUAL_LS_V2.sizing.grossFloor\n            ? "FLOOR"\n            : "VOL_TARGET",\n        signalImpulseCondition: signalFeatures.penguReturn24h <= PENGU_DUAL_LS_V2.short.impulseReturn24hMaximum,\n        priorImpulseCondition: index > 0 && Boolean(rows[index - 1].features)\n          ? rows[index - 1].features!.penguReturn24h <= PENGU_DUAL_LS_V2.short.impulseReturn24hMaximum\n          : false,\n      });'''
    replay = replay.replace(trade_push, trade_push_replacement, 1)
    text = text[:replay_start] + replay + text[replay_end:]

    diag_marker = '    baselineExitTs: trade.exitTs,\n'
    if text.count(diag_marker) != 1:
        raise RuntimeError(f'diagnostic baseline marker count={text.count(diag_marker)}')
    diag_injection = '''    baselineExitTs: trade.exitTs,\n    baselineExitReason: (trade as any).baselineExitReason ?? null,\n    priorShortSetupActive: Boolean((trade as any).priorShortSetupActive),\n    priorShortSetupArmed: Boolean((trade as any).priorShortSetupArmed),\n    sizingState: (trade as any).sizingState ?? null,\n    signalImpulseCondition: Boolean((trade as any).signalImpulseCondition),\n    priorImpulseCondition: Boolean((trade as any).priorImpulseCondition),\n    entryCounterwindBranch: trade.btcEma168Distance >= 0\n      ? (trade.btcReturn24h >= 0 ? "BOTH" : "EMA_ONLY")\n      : (trade.btcReturn24h >= 0 ? "RETURN_ONLY" : "NEITHER"),\n'''
    text = text.replace(diag_marker, diag_injection, 1)

    out = Path(f'scripts/.pengu_v18_structural_state_{venue.lower()}.ts')
    out.write_text(text)
    return out


def run(venue):
    temp = structural_source(venue)
    out = ROOT / f'{venue.lower()}.json'
    env = dict(os.environ)
    env['PENGU_V11_OUT'] = str(out)
    try:
        cp = subprocess.run(
            ['npx', 'tsx', str(temp)],
            env=env,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
        )
        (ROOT / f'{venue.lower()}.log').write_text(cp.stdout)
        print(cp.stdout)
        if cp.returncode != 0:
            raise RuntimeError(f'V18 structural-state {venue} failed code={cp.returncode}')
        x = json.loads(out.read_text())
        wins, ret = crossloss.EXPECTED_NORMAL[venue]
        actual = x['results']['NORMAL']['CANDIDATE']
        if actual['wins'] != wins or abs(actual['returnPct'] - ret) > 1e-9:
            raise RuntimeError(
                f'formal V18 parity mismatch {venue}: wins={actual["wins"]} return={actual["returnPct"]}'
            )
        return x
    finally:
        temp.unlink(missing_ok=True)


def compact(event):
    d = event.get('diagnostic') or {}
    failure = d.get('failure') or {}
    base_ret = d.get('baselineAccountReturn')
    cand_ret = event.get('accountReturn')
    row = {
        'entryTs': event.get('entryTs'),
        'baselineAccountReturn': base_ret,
        'candidateAccountReturn': cand_ret,
        'accountReturnDelta': (
            cand_ret - base_ret
            if isinstance(cand_ret, (int, float)) and isinstance(base_ret, (int, float))
            else None
        ),
        'candidateWin': bool(isinstance(cand_ret, (int, float)) and cand_ret > 0),
        'baselineWin': bool(isinstance(base_ret, (int, float)) and base_ret > 0),
        'decisionReason': d.get('decisionReason'),
        'failureDelayHours': d.get('failureDelayHours'),
        'baselineExitReason': d.get('baselineExitReason'),
        'priorShortSetupActive': d.get('priorShortSetupActive'),
        'priorShortSetupArmed': d.get('priorShortSetupArmed'),
        'sizingState': d.get('sizingState'),
        'signalImpulseCondition': d.get('signalImpulseCondition'),
        'priorImpulseCondition': d.get('priorImpulseCondition'),
        'entryCounterwindBranch': d.get('entryCounterwindBranch'),
        'failureCounterwindBranch': branch(failure.get('btcEma168Distance'), failure.get('btcReturn24h')),
    }
    return row


def normal_events(result):
    return [compact(e) for e in result['results']['NORMAL']['CANDIDATE'].get('diagnosticEvents', [])]


def analyze_venue(venue, result):
    events = normal_events(result)
    target_hits = [e for e in events if e['entryTs'] == TARGET_ENTRY_TS]
    if len(target_hits) != 1:
        raise RuntimeError(f'{venue} target count={len(target_hits)}')
    target = target_hits[0]
    if target['candidateWin'] or not isinstance(target['accountReturnDelta'], (int, float)) or abs(target['accountReturnDelta']) <= 1e-12:
        raise RuntimeError(f'{venue} target is not the expected changed V18 loss')

    modified_winners = [
        e for e in events
        if e['candidateWin']
        and isinstance(e['accountReturnDelta'], (int, float))
        and abs(e['accountReturnDelta']) > 1e-12
    ]
    comparisons = {}
    for field in CATEGORY_FIELDS:
        collisions = [e['entryTs'] for e in modified_winners if e.get(field) == target.get(field)]
        comparisons[field] = {
            'targetValue': target.get(field),
            'modifiedWinnerCollisionCount': len(collisions),
            'modifiedWinnerCollisionEntryTs': collisions,
        }
    return {
        'target': target,
        'modifiedWinners': modified_winners,
        'singleDimensionComparisons': comparisons,
    }


def main():
    crossloss.diag15.v15.v12.v11runner.load_binance_klines('PENGUUSDT')
    crossloss.diag15.v15.v12.v11runner.load_binance_klines('BTCUSDT')
    crossloss.diag15.v15.v12.v11runner.load_binance_funding()
    okx = run('OKX')
    binance = run('Binance')

    gp = crossloss.diag15.v15.v12final.load_gate_klines('PENGU_USDT')
    gb = crossloss.diag15.v15.v12final.load_gate_klines('BTC_USDT')
    crossloss.diag15.v15.v12final.write_gate_cache(gp, gb, [])
    gate = run('Gate')

    bitget_data = {
        'pengu': crossloss.diag15.v15.dense_bitget_candles('PENGUUSDT'),
        'btc': crossloss.diag15.v15.dense_bitget_candles('BTCUSDT'),
        'funding': crossloss.diag15.v15.v13.load_bitget_funding(),
    }
    bitget = run('Bitget')

    results = {'OKX': okx, 'Binance': binance, 'Gate': gate, 'Bitget': bitget}
    analysis = {v: analyze_venue(v, results[v]) for v in ('OKX', 'Binance', 'Bitget')}

    gate_events = normal_events(gate)
    q3_hits = [e for e in gate_events if e['entryTs'] == GATE_Q3_ENTRY_TS]
    if len(q3_hits) != 1:
        raise RuntimeError(f'Gate Q3 count={len(q3_hits)}')
    q3 = q3_hits[0]
    if abs(q3['candidateAccountReturn'] - q3['baselineAccountReturn']) > 1e-12:
        raise RuntimeError('Gate Q3 parity guard failed')

    single_dimension_separators = []
    for field in CATEGORY_FIELDS:
        if all(
            analysis[v]['singleDimensionComparisons'][field]['modifiedWinnerCollisionCount'] == 0
            for v in ('OKX', 'Binance', 'Bitget')
        ):
            single_dimension_separators.append(field)

    payload = {
        'status': 'PASS_RESEARCH_ONLY',
        'schema': 'pengu-v18-structural-state-diagnostic/v1',
        'diagnosticOnly': True,
        'frozenCandidate': crossloss.V18_NAME,
        'frozenPreRegistrationSha': crossloss.V18_SHA,
        'candidateCount': 0,
        'thresholdSweep': False,
        'featureCombinationSearch': False,
        'singleDimensionOnly': True,
        'preExistingCategoricalFields': list(CATEGORY_FIELDS),
        'targetEntryTs': TARGET_ENTRY_TS,
        'formalV18Parity': {v: True for v in crossloss.EXPECTED_NORMAL},
        'analysis': analysis,
        'singleDimensionSeparators': single_dimension_separators,
        'gateQ3Preserved': True,
        'gateQ3': q3,
        'bitgetData': bitget_data,
        'kucoinPerformanceObserved': False,
        'kucoinHoldoutStatus': 'RESERVED_UNOPENED',
        'safety': {
            'mode': 'RESEARCH_ONLY',
            'ordersSent': False,
            'liveChanged': False,
            'vpsChanged': False,
            'productionChanged': False,
        },
    }
    (ROOT / 'diagnostic.json').write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({
        'targetEntryTs': TARGET_ENTRY_TS,
        'singleDimensionSeparators': single_dimension_separators,
        'targetCategories': {v: analysis[v]['target'] for v in ('OKX', 'Binance', 'Bitget')},
        'gateQ3': q3,
        'kucoinHoldoutStatus': payload['kucoinHoldoutStatus'],
        'safety': payload['safety'],
    }, indent=2))


if __name__ == '__main__':
    main()
