from pathlib import Path
import importlib.util

POLICY = Path('scripts/research_v61_multibar_policy.py')
assert POLICY.exists(), 'V61 multibar policy module not implemented yet'
spec = importlib.util.spec_from_file_location('research_v61_multibar_policy', POLICY)
module = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(module)

assert module.NATIVE_V57_GROSS_MAX == 0.9375
assert module.CONTINUATION_GROSS_MAX == 0.5
assert module.RECENT_BREAKOUT_LOOKBACK_HOURS == 12
assert module.FREQUENCY_GOAL_LONG_TRADES == 20
assert module.V61_MODES == (
    'V61_BREAKOUT_RETEST',
    'V61_HIGHER_LOW_RESUME',
    'V61_CONTRACTION_BREAK',
)
print('V61_MULTIBAR_POLICY_TEST=PASS')
