from pathlib import Path

validator = Path('scripts/research_validate_v70_v69_robustness.py')
workflow = Path('.github/workflows/pengu-v70-v69-robustness.yml')
v69 = Path('scripts/research_patch_v69_independent_short_sleeve.py')

assert validator.exists(), 'V70 robustness validator not implemented yet'
assert workflow.exists(), 'V70 robustness workflow not implemented yet'
assert v69.exists(), 'V69 source missing'

vs = validator.read_text()
ws = workflow.read_text()
v69s = v69.read_text()

# V69 is immutable for this audit: exact family, gross and signal thresholds.
for token in [
    'FROZEN_FAMILY = "RALLY_FAILURE"',
    'FROZEN_GROSS = 0.25',
    'EXPECTED_V69_ARTIFACT_SHA256 = "f597a5ddf10963684276d814834b50b695d83dfe5537eccddb0890d4942edb5e"',
    '2025-08-10T00:00:00Z',
    '2025-12-09T16:00:00Z',
    '2026-04-10T08:00:00Z',
    '2026-08-10T00:00:00Z',
    'CONFIRM_V69_ROBUSTNESS_RESEARCH_CANDIDATE',
    'REJECT_V69_ROBUSTNESS_KEEP_V64',
    'NO_CHANGE_V56',
]:
    assert token in vs, f'missing V70 frozen-contract token: {token}'

for token in [
    'f.penguReturn24h>=0.03',
    'f.penguReturn72h>=-0.02',
    'f.relativeReturn24h>=0',
    'f.btcReturn24h<=0.02',
    'f.volumeRatio6OverPrior36>=1.0',
    'f.rsi14>=62 && f.rsi14<=82',
    'prevR1>=0.004 && r1<=-0.004',
    'V69_NEW_SHORT_GROSS = 0.25',
]:
    assert token in v69s, f'V69 frozen source drift: {token}'

# Robustness-only: three predeclared chronological folds; every fold must pass
# in both Normal and Stress. No candidate/grid/threshold search is allowed.
for token in [
    'MIN_TRADES_PER_FOLD = 2',
    "m['returnPct'] > 0.0",
    'profitFactor >= 1.0',
    'allFoldPass',
    "selectedFamily == FROZEN_FAMILY",
    "requestedGross == FROZEN_GROSS",
    "ordersSent': False",
    "liveChanged': False",
    "vpsChanged': False",
    "productionChanged': False",
]:
    assert token in vs, f'missing V70 robustness gate: {token}'

for forbidden in ['threshold_candidates', 'gross_candidates', 'grid_search', 'optimize_threshold', 'optimize_gross']:
    assert forbidden not in vs, f'forbidden tuning path in V70: {forbidden}'

for token in [
    '32975370331',
    'pengu-v69-independent-short-sleeve-1y-32975370331',
    'python scripts/test_research_v70_v69_robustness.py',
    'python scripts/research_validate_v70_v69_robustness.py',
    "! -path '*/MANIFEST.sha256'",
]:
    assert token in ws, f'missing V70 workflow token: {token}'

print('V70_V69_ROBUSTNESS_POLICY=PASS')
