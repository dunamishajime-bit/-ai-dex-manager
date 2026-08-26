from pathlib import Path
import importlib.util

POLICY = Path('scripts/research_v60_pullback_policy.py')
assert POLICY.exists(), 'V60 pullback policy module not implemented yet'
spec = importlib.util.spec_from_file_location('research_v60_pullback_policy', POLICY)
module = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(module)

assert module.NATIVE_V57_GROSS_MAX == 0.9375
assert module.PULLBACK_GROSS_MAX == 0.5
assert module.FREQUENCY_GOAL_LONG_TRADES == 20
assert module.V60_MODES == (
    'V60_EMA72_TOUCH_BOUNCE',
    'V60_EMA72_RECLAIM',
    'V60_MOMENTUM_RESET_RECLAIM',
)
print('V60_PULLBACK_POLICY_TEST=PASS')
