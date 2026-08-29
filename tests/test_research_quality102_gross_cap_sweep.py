import importlib.util
from pathlib import Path

MODULE = Path('scripts/research_quality102_gross_cap_sweep.py')
spec = importlib.util.spec_from_file_location('q102sweep', MODULE)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

sample = '''TOTAL_GROSS_CAP = 2.5\nSUPPLEMENT_GROSS_CAP = 0.15\nfoo = SUPPLEMENT_GROSS_CAP\n'''
out = mod.patch_supplement_cap(sample, 0.20)
assert 'SUPPLEMENT_GROSS_CAP = 0.2' in out
assert 'TOTAL_GROSS_CAP = 2.5' in out

try:
    mod.patch_supplement_cap('TOTAL_GROSS_CAP = 2.5\n', 0.20)
except RuntimeError as e:
    assert 'exactly one' in str(e)
else:
    raise AssertionError('missing cap constant must fail closed')

assert mod.CAPS == (0.15, 0.175, 0.20, 0.225, 0.25, 0.275, 0.30, 0.325, 0.35)
print('QUALITY102_SWEEP_UNIT=PASS')
