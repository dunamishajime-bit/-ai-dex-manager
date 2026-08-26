from pathlib import Path

impl = Path('scripts/research_patch_v71_independent_long_sleeve.py')
dca = Path('scripts/research_patch_v71_dual_pengu_dca.py')
workflow = Path('.github/workflows/pengu-v71-independent-long-sleeve-1y.yml')
v64 = Path('scripts/research_patch_v64_supplemental_sizing.py')

assert impl.exists(), 'V71 implementation missing (expected RED before implementation)'
assert dca.exists(), 'V71 DCA patch missing (expected RED before implementation)'
assert workflow.exists(), 'V71 full workflow missing (expected RED before implementation)'
assert v64.exists(), 'V64 source missing'

s = impl.read_text()
d = dca.read_text()
w = workflow.read_text()

# One fixed, predeclared family only. No family/grid/gross/threshold search.
for token in [
    'V71Family = "FAILED_BREAKDOWN_RECLAIM"',
    'V71_NEW_LONG_GROSS = 0.25',
    'V71_NEW_LONG_SLEEVE = "PENGU_V71_NEW_LONG_SLEEVE"',
    'penguReturn24h<=-0.02',
    'relativeReturn24h<=0.01',
    'btcReturn24h>=-0.03',
    'volumeRatio6OverPrior36>=0.80',
    'rsi14>=25 && f.rsi14<=52',
    'prev.low<priorLow',
    'row.candle.close>priorLow',
    'row.candle.close>prev.open',
    '2025-08-10T00:00:00Z',
    '2025-12-09T16:00:00Z',
    '2026-04-10T08:00:00Z',
    '2026-08-10T00:00:00Z',
    'MIN_TRADES_PER_FOLD = 2',
    'ADOPT_V71_RESEARCH_CANDIDATE',
    'KEEP_V64_RESEARCH_CANDIDATE',
]:
    assert token in s, f'missing V71 fixed-contract token: {token}'

for forbidden in [
    'V71_FAMILIES', 'candidateCount', 'trainScore', 'threshold_candidates',
    'gross_candidates', 'grid_search', 'optimize_threshold', 'optimize_gross'
]:
    assert forbidden not in s, f'forbidden V71 tuning path: {forbidden}'

# Separate slot and reserved capacity: V71 must never erase V64.
for token in [
    'V71_NEW_LONG_GROSS_CAP', 'V71_RESERVE_V64_GROSS',
    'PENGU_V71_NEW_LONG_SLEEVE', 'PENGU_NEW_LONG_ENTRY',
    'active_pengu_new_long', '--pengu-new-long-ledger',
    'V71_NEW_LONG_ENTERED', 'PENGU_V64_RESERVED_CAPACITY_BLOCKED'
]:
    assert token in d, f'missing V71 DCA isolation token: {token}'

for token in [
    'a76fd7aaa0788209532a5a2c6489135dd8e4a27e',
    'python scripts/test_research_v71_independent_long_sleeve.py',
    'python scripts/research_patch_v64_supplemental_sizing.py',
    'python scripts/research_patch_v71_independent_long_sleeve.py',
    'python scripts/research_patch_v71_dual_pengu_dca.py',
    'materialGainThresholdMultiple',
    '1.05',
    'NO_CHANGE_V56',
    "! -path '*/MANIFEST.sha256'",
]:
    assert token in w, f'missing V71 workflow token: {token}'

print('V71_INDEPENDENT_LONG_POLICY=PASS')
