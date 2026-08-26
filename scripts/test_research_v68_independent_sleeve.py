from pathlib import Path

standalone = Path('scripts/research_patch_v68_independent_sleeve.py')
dca = Path('scripts/research_patch_v68_independent_sleeve_dca.py')
assert standalone.exists(), 'V68 independent sleeve standalone patch not implemented yet'
assert dca.exists(), 'V68 independent sleeve DCA patch not implemented yet'

s = standalone.read_text()
d = dca.read_text()

required_standalone = [
    'V68_INDEPENDENT_SLEEVE',
    'V68_NEW_LONG_MAX_GROSS',
    'PULLBACK_CONTINUATION',
    'BREAKOUT_CONFIRMATION',
    'OVERSOLD_REVERSAL',
    'v64CoreIdentityPass',
    'newLongSleeve',
    'holdoutAddedLongTrades',
    'normalHoldoutPositive',
    'stressHoldoutPositive',
    'strictPass',
    'KEEP_V64_RESEARCH_CANDIDATE',
    'ADOPT_V68_INDEPENDENT_SLEEVE_RESEARCH_CANDIDATE',
    'ordersSent:false',
    'liveChanged:false',
    'vpsChanged:false',
    'productionChanged:false',
]
for token in required_standalone:
    assert token in s, f'missing V68 standalone policy token: {token}'

# Frozen V64 must remain exact and the new sleeve must be a separate replay.
assert '0.12049482888834451' in s
assert '0.1875' in s
assert 'replayV68NewLongSleeve' in s
assert 'candidate-pengu-ledger.json' not in s, 'V68 must not replace the protected V64 ledger'

required_dca = [
    'PENGU_NEW_LONG_MAX_GROSS',
    'active_pengu_core',
    'active_pengu_new',
    'PENGU_CORE_ENTRY',
    'PENGU_NEW_ENTRY',
    'PENGU_NEW_LONG',
    'pengu-new-long-ledger',
    'materialIntegratedGain',
    'CRYPTO_GROSS_CAP',
    'TOTAL_GROSS_CAP',
    '1.05',
]
for token in required_dca:
    assert token in d, f'missing V68 DCA policy token: {token}'

# Core has deterministic priority before the new sleeve; global caps are reused, not replaced.
assert 'PENGU_CORE_ENTRY": 2' in d
assert 'PENGU_NEW_ENTRY": 3' in d
assert 'core_reserve = PENGU_MAX_GROSS' in d

print('V68_INDEPENDENT_SLEEVE_POLICY=PASS')
