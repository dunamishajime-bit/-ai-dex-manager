from pathlib import Path

POLICY = Path('scripts/research_patch_v64_supplemental_sizing.py')
assert POLICY.exists(), 'V64 supplemental sizing patch not implemented yet'
s = POLICY.read_text()
for token in [
    'V64_DYNAMIC',
    'v64ActiveConfig',
    'supplemental',
    'lowGross',
    'trainingEligible',
    'normalHoldoutPositive',
    'stressHoldoutPositive',
    'strictPass',
    'incumbent-v57-pengu-ledger.json',
    'candidate-pengu-ledger.json',
]:
    assert token in s, f'missing V64 policy token: {token}'
print('V64_SUPPLEMENTAL_SIZING_POLICY_TEST=PASS')
