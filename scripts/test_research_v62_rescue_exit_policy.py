from pathlib import Path
import importlib.util

POLICY=Path('scripts/research_v62_rescue_exit_policy.py')
assert POLICY.exists(), 'V62 rescue exit policy module not implemented yet'
spec=importlib.util.spec_from_file_location('research_v62_rescue_exit_policy',POLICY)
module=importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(module)

assert module.NATIVE_V57_GROSS_MAX == 0.9375
assert module.RESCUE_GROSS_MAX == 0.375
assert module.ENTRY_FAMILIES == ('MOMENTUM_RESET','CONTRACTION','RESET_OR_CONTRACTION')
assert module.EXIT_PROFILES == (
    ('FAST',0.04,0.05,0.02,36),
    ('BALANCED',0.05,0.07,0.025,48),
    ('WIDE',0.06,0.08,0.025,72),
)
print('V62_RESCUE_EXIT_POLICY_TEST=PASS')
