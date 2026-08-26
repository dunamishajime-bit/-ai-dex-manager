from pathlib import Path

logic = Path('scripts/research_patch_v68_independent_long_sleeve.py')
dca = Path('scripts/research_patch_v68_dual_pengu_dca.py')
assert logic.exists(), 'V68 independent Long sleeve patch not implemented yet'
assert dca.exists(), 'V68 dual-PENGU DCA patch not implemented yet'

ls = logic.read_text()
ds = dca.read_text()

for token in [
    'V68_NEW_LONG_GROSS',
    '0.25',
    'replayV68NewLongSleeve',
    'PULLBACK_CONTINUATION',
    'BREAKOUT_CONFIRMATION',
    'OVERSOLD_REVERSAL',
    'holdoutTrades',
    'normalHoldoutPositive',
    'stressHoldoutPositive',
    'KEEP_V64_RESEARCH_CANDIDATE',
    'ADOPT_V68_INDEPENDENT_LONG_SLEEVE_RESEARCH_CANDIDATE',
    'ordersSent:false',
    'liveChanged:false',
    'vpsChanged:false',
    'productionChanged:false',
]:
    assert token in ls, f'missing V68 logic policy token: {token}'

# Frozen V64 remains an immutable standalone sleeve.
assert '0.12049482888834451' in ls
assert '0.1875' in ls
assert 'incumbent-v64-pengu-ledger.json' in ls
assert 'new-long-sleeve-ledger.json' in ls

for token in [
    'V68_RESERVE_V64_GROSS',
    '0.9375',
    'PENGU_NEW_LONG_ENTRY',
    'PENGU_NEW_LONG_EXIT',
    'active_pengu_new_long',
    '--pengu-new-long-ledger',
    'PENGU_V64_RESERVED_CAPACITY_BLOCKED',
    'V68_NEW_LONG_ENTERED',
]:
    assert token in ds, f'missing V68 DCA policy token: {token}'

# The new sleeve is subordinate; it must not replace the incumbent PENGU input.
assert '--pengu-ledger' in ds
assert 'PENGU_NEW_LONG_SLOT_OCCUPIED' in ds

# Keep the material hurdle from V67: at least +5% integrated ending asset.
assert '1.05' in ls or '1.05' in ds

print('V68_INDEPENDENT_LONG_SLEEVE_POLICY=PASS')
