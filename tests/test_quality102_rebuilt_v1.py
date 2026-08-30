import copy
import importlib.util
from pathlib import Path

SELECTOR_MODULE = Path('scripts/quality102_rebuilt_v1.py')
spec = importlib.util.spec_from_file_location('quality102_rebuilt_v1', SELECTOR_MODULE)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

OUTCOME_MODULE = Path('scripts/quality102_rebuilt_v1_outcomes.py')
outcome_spec = importlib.util.spec_from_file_location('quality102_rebuilt_v1_outcomes', OUTCOME_MODULE)
outcomes = importlib.util.module_from_spec(outcome_spec)
outcome_spec.loader.exec_module(outcomes)


def bars(n=360):
    out = []
    price = 100.0
    for i in range(n):
        drift = 0.004 if (i // 48) % 2 == 0 else -0.0015
        shock = 0.018 if i in (120, 121, 200) else (-0.014 if i in (150, 151) else 0.0)
        close = price * (1.0 + drift + shock)
        high = max(price, close) * 1.006
        low = min(price, close) * 0.994
        out.append({
            'ts': 1_700_000_000_000 + i * 3_600_000,
            'open': price,
            'high': high,
            'low': low,
            'close': close,
            'volume': 1000.0 + (i % 24) * 25.0,
        })
        price = close
    return out


assert mod.SELECTOR_ID == 'QUALITY102_REBUILT_V1'
assert mod.MAX_QUALITY_GROSS == 0.35
assert set(mod.FORBIDDEN_SELECTOR_FIELDS) >= {
    'normal_net', 'stress_net', 'exit', 'exit_reason', 'duration_hours', 'ret14'
}

base = {'FET': bars(), 'SOL': bars(), 'AVAX': bars()}
first = mod.select_candidates(copy.deepcopy(base), start_ms=1_700_000_000_000, end_ms=1_701_000_000_000)
second = mod.select_candidates(copy.deepcopy(base), start_ms=1_700_000_000_000, end_ms=1_701_000_000_000)
assert first, 'selector contract must exercise at least one actual selection'
assert first == second, 'selector must be deterministic'
assert all(1_700_000_000_000 <= x['entry_ms'] < 1_701_000_000_000 for x in first)
assert all(x['side'] == 'long' for x in first)
assert all(x['requested_gross'] <= 0.35 + 1e-12 for x in first)
assert all('normal_net' not in x and 'stress_net' not in x and 'exit' not in x for x in first)

reversed_input = {'AVAX': copy.deepcopy(base['AVAX']), 'SOL': copy.deepcopy(base['SOL']), 'FET': copy.deepcopy(base['FET'])}
third = mod.select_candidates(reversed_input, start_ms=1_700_000_000_000, end_ms=1_701_000_000_000)
assert first == third, 'selector must be order-invariant'

with_future = copy.deepcopy(base)
for symbol in with_future:
    tail = copy.deepcopy(with_future[symbol][-24:])
    for j, row in enumerate(tail, 1):
        row['ts'] = 1_701_000_000_000 + j * 3_600_000
        row['close'] *= 3.0
        row['high'] *= 3.0
        row['low'] *= 3.0
        with_future[symbol].append(row)
fourth = mod.select_candidates(with_future, start_ms=1_700_000_000_000, end_ms=1_701_000_000_000)
assert first == fourth, 'future bars outside end_ms must not affect in-window selection'

for a, b in zip(first, first[1:]):
    assert b['entry_ms'] >= a['entry_ms'] + a['hold_hours'] * 3_600_000

selection_snapshot = copy.deepcopy(first)
materialized = outcomes.materialize_supplement_rows(
    first,
    base,
    end_ms=1_701_250_000_000,
    normal_cost_bps=20.0,
    stress_cost_bps=60.0,
)
assert first == selection_snapshot, 'outcome materialization must not mutate selector output'
assert materialized, 'materializer must produce closed trades for the synthetic contract'
assert len(materialized) <= len(first)
for row in materialized:
    assert row['exit_ms'] > row['entry_ms']
    assert row['normal_net'] <= row['gross_return'] + 1e-12
    assert row['stress_net'] <= row['normal_net'] + 1e-12
    assert row['exit_reason'] in {'STOP_8PCT', 'TRAIL_5PCT_AFTER_12PCT', 'TIME'}
    assert row['selector_id'] == 'QUALITY102_REBUILT_V1'

print('QUALITY102_REBUILT_V1_UNIT=PASS')
