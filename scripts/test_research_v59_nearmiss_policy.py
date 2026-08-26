from pathlib import Path
import importlib.util

POLICY = Path('scripts/research_v59_nearmiss_policy.py')
assert POLICY.exists(), 'V59 near-miss policy module not implemented yet'
spec = importlib.util.spec_from_file_location('research_v59_nearmiss_policy', POLICY)
module = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(module)

assert module.NATIVE_V57_GROSS_MAX == 0.9375
assert module.RECOVERY_GROSS_MAX == 0.375
assert module.ALLOWED_FAILED_GATES == ('rsiMax', 'volumeMax')
assert module.V59_MODES == (
    'V59_RSI_HIGH_RECOVERY',
    'V59_VOLUME_HIGH_RECOVERY',
    'V59_RSI_OR_VOLUME_RECOVERY',
)
print('V59_NEARMISS_POLICY_TEST=PASS')
