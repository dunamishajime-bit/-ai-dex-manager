from pathlib import Path

POLICY=Path('scripts/research_patch_v65_supplemental_exit.py')
assert POLICY.exists(), 'V65 supplemental exit patch not implemented yet'
s=POLICY.read_text()
for token in [
    'V65_DYNAMIC',
    'v65ActiveConfig',
    'hardStopPct',
    'trailingActivationPct',
    'trailingRetracePct',
    'maxHoldHours',
    'trainingEligible',
    'normalHoldoutPositive',
    'stressHoldoutPositive',
    'strictPass',
]: assert token in s, f'missing V65 token: {token}'
print('V65_SUPPLEMENTAL_EXIT_POLICY_TEST=PASS')
