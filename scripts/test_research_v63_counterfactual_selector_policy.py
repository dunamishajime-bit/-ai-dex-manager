from pathlib import Path
import importlib.util

POLICY=Path('scripts/research_v63_counterfactual_selector_policy.py')
assert POLICY.exists(), 'V63 selector policy module not implemented yet'
spec=importlib.util.spec_from_file_location('research_v63_counterfactual_selector_policy',POLICY)
module=importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(module)

assert module.NATIVE_V57_GROSS_MAX == 0.9375
assert module.RESCUE_GROSS_MAX == 0.375
assert module.RESCUE_HARD_STOP == 0.04
assert module.RESCUE_TRAIL_ACTIVATION == 0.05
assert module.RESCUE_TRAIL_RETRACE == 0.02
assert module.RESCUE_MAX_HOLD_HOURS == 36
assert module.MIN_TRAIN_OPPORTUNITIES == 6
assert module.MIN_SELECTED_TRAIN_TRADES == 2
assert module.SELECTOR_MODES == ('TOP1','TOP2')
print('V63_COUNTERFACTUAL_SELECTOR_POLICY_TEST=PASS')
