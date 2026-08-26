from pathlib import Path
import importlib.util

POLICY = Path('scripts/research_v58_recovery_policy.py')
assert POLICY.exists(), 'V58 recovery policy module not implemented yet'

spec = importlib.util.spec_from_file_location('research_v58_recovery_policy', POLICY)
module = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(module)

assert module.recovery_gross_cap(0) is None
assert module.recovery_gross_cap(1) == 0.625
assert module.recovery_gross_cap(2) == 0.375
assert module.recovery_gross_cap(3) is None
assert module.allowed_core_failure_count(0) is False
assert module.allowed_core_failure_count(1) is True
assert module.allowed_core_failure_count(2) is True
assert module.allowed_core_failure_count(3) is False
assert module.V58_MODES == (
    'V58_ONE_FAIL_CORE',
    'V58_ONE_OR_TWO_FAIL_CORE',
    'V58_ONE_OR_TWO_FAIL_ELITE',
)
print('V58_POLICY_TEST=PASS')
