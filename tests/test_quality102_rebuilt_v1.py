import copy
import importlib.util
from pathlib import Path

MODULE = Path('scripts/quality102_rebuilt_v1.py')
spec = importlib.util.spec_from_file_location('quality102_rebuilt_v1', MODULE)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


def bars(n=260):
    out = []
    price = 100.0
    for i in range(n):
        # Deterministic synthetic history with alternating trend/pullback regimes.
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
assert first == second, 'selector must be deterministic'
assert all(1_700_000_000_000 <= x['entry_ms'] < 1_701_000_000_000 for x in first)
assert all(x['side'] == 'long' for x in first)
assert all(x['requested_gross'] <= 0.35 + 1e-12 for x in first)
assert all('normal_net' not in x and 'stress_net' not in x and 'exit' not in x for x in first)

# Input ordering must not change selection.
reversed_input = {'AVAX': copy.deepcopy(base['AVAX']), 'SOL': copy.deepcopy(base['SOL']), 'FET': copy.deepcopy(base['FET'])}
third = mod.select_candidates(reversed_input, start_ms=1_700_000_000_000, end_ms=1_701_000_000_000)
assert first == third, 'selector must be order-invariant'

# Future bars appended beyond end_ms must not alter selections inside the evaluation window.
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

# One-slot invariant: no candidate can enter before the prior selected hold expires.
for a, b in zip(first, first[1:]):
    assert b['entry_ms'] >= a['entry_ms'] + a['hold_hours'] * 3_600_000

print('QUALITY102_REBUILT_V1_UNIT=PASS')
