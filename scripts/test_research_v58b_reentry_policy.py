from pathlib import Path
import importlib.util

# Contract: V58b re-entry may repeat Recovery only, never native V57 entries.
POLICY = Path('scripts/research_v58b_reentry_policy.py')
assert POLICY.exists(), 'V58b reentry policy module not implemented yet'
spec = importlib.util.spec_from_file_location('research_v58b_reentry_policy', POLICY)
module = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(module)

assert module.REENTRY_NATIVE_V57 is False
assert module.REENTRY_RECOVERY is True
assert module.RECOVERY_COOLDOWN_HOURS == 6
assert module.ONE_FAIL_GROSS_CAP == 0.625
assert module.TWO_FAIL_GROSS_CAP == 0.375
assert module.V58B_MODES == (
    'V58B_REENTRY_ONE_FAIL',
    'V58B_REENTRY_CORE',
    'V58B_REENTRY_ELITE',
)
print('V58B_REENTRY_POLICY_TEST=PASS')
