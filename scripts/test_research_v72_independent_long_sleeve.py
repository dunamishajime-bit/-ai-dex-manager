from pathlib import Path

impl = Path('scripts/research_patch_v72_independent_long_sleeve.py')
dca = Path('scripts/research_patch_v72_dual_pengu_dca.py')
workflow = Path('.github/workflows/pengu-v72-independent-long-sleeve-1y.yml')
v64 = Path('scripts/research_patch_v64_supplemental_sizing.py')

assert impl.exists(), 'V72 implementation missing'
assert dca.exists(), 'V72 DCA patch missing'
assert workflow.exists(), 'V72 workflow missing'
assert v64.exists(), 'V64 source missing'

s = impl.read_text()
d = dca.read_text()
w = workflow.read_text()

# Exactly one ex-ante family. No family, threshold, or gross search is permitted.
for token in [
    'V72Family = "VOLATILITY_COMPRESSION_RELEASE"',
    'V72_NEW_LONG_GROSS = 0.25',
    'V72_NEW_LONG_SLEEVE = "PENGU_V72_NEW_LONG_SLEEVE"',
    'compression.pct<=reference.pct*0.70',
    'f.close>f.ema72',
    'f.btcReturn24h>=-0.02',
    'f.relativeReturn24h>=-0.01',
    'f.volumeRatio6OverPrior36>=0.80',
    'f.rsi14>=45 && f.rsi14<=75',
    'row.candle.close>compression.high',
    'row.candle.close>row.candle.open',
    '2025-08-10T00:00:00Z',
    '2025-12-09T16:00:00Z',
    '2026-04-10T08:00:00Z',
    '2026-08-10T00:00:00Z',
    'V72_MIN_TRADES_PER_FOLD = 2',
    'ADOPT_V72_STANDALONE_CANDIDATE',
    'KEEP_V64_RESEARCH_CANDIDATE',
]:
    assert token in s, f'missing V72 fixed-contract token: {token}'

for forbidden in [
    'V72_FAMILIES', 'candidateCount', 'const trainScore', 'selectedTraining',
    'threshold_candidates', 'gross_candidates', 'grid_search',
    'optimize_threshold', 'optimize_gross',
    'FAILED_BREAKDOWN_RECLAIM', 'PULLBACK_CONTINUATION',
    'BREAKOUT_CONFIRMATION', 'OVERSOLD_REVERSAL'
]:
    assert forbidden not in s, f'forbidden V72 tuning/old-family path: {forbidden}'

# Frozen incumbent identity is asserted in the executable research patch.
for token in [
    'assert.equal(incNM.trades,41',
    'assert.equal(incNM.longTrades,13)',
    'assert.equal(incNM.shortTrades,28)',
    '303.9903920953809',
]:
    assert token in s, f'missing V64 identity guard: {token}'

# Independent slot plus reserved V64 capacity.
for token in [
    'V72_NEW_LONG_GROSS_CAP', 'V72_RESERVE_V64_GROSS',
    'PENGU_V72_NEW_LONG_SLEEVE', 'PENGU_NEW_LONG_ENTRY',
    'active_pengu_new_long', '--pengu-new-long-ledger',
    'V72_NEW_LONG_ENTERED', 'PENGU_V64_RESERVED_CAPACITY_BLOCKED'
]:
    assert token in d, f'missing V72 DCA isolation token: {token}'

for token in [
    'a76fd7aaa0788209532a5a2c6489135dd8e4a27e',
    'python scripts/test_research_v72_independent_long_sleeve.py',
    'python scripts/research_patch_v64_supplemental_sizing.py',
    'python scripts/research_patch_v72_independent_long_sleeve.py',
    'python scripts/research_patch_v72_dual_pengu_dca.py',
    'materialGainThresholdMultiple=1.05',
    'NO_CHANGE_V56',
    "! -path '*/MANIFEST.sha256'",
]:
    assert token in w, f'missing V72 workflow token: {token}'

print('V72_INDEPENDENT_LONG_POLICY=PASS')
