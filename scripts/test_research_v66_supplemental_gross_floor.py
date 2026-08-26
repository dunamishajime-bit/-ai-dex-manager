from pathlib import Path

p = Path('scripts/research_patch_v66_supplemental_gross_floor.py')
assert p.exists(), 'V66 supplemental gross floor patch not implemented yet'
s = p.read_text()
required = [
    'V66_DYNAMIC',
    'v66CandidateGrosses',
    'selectedV64',
    'penguReturn72h',
    '0.1875',
    '0.15625',
    '0.125',
    'trainingEligible',
    'normalHoldoutPositive',
    'stressHoldoutPositive',
    'stressRobust',
    'fullNormalImproves',
    'strictPass',
    'KEEP_V64_RESEARCH_CANDIDATE',
    'ADOPT_V66_RESEARCH_CANDIDATE',
    'ordersSent:false',
    'liveChanged:false',
    'vpsChanged:false',
    'productionChanged:false',
]
for token in required:
    assert token in s, f'missing V66 policy token: {token}'

# This research stage may refine only the already-selected V64 supplemental rule's
# low gross floor. It must not search new features or add entry modes.
assert 'v66FeatureNames' not in s
assert 'deriveV66Thresholds' not in s
print('V66_SUPPLEMENTAL_GROSS_FLOOR_POLICY=PASS')
