from pathlib import Path

standalone = Path('scripts/research_patch_v68_independent_sleeve.py')
dca = Path('scripts/research_patch_v68_independent_sleeve_dca_v2.py')
assert standalone.exists(), 'V68 independent sleeve standalone patch not implemented yet'
assert dca.exists(), 'V68 latest-contract independent sleeve DCA patch not implemented yet'

s = standalone.read_text()
d = dca.read_text()

required_standalone = [
    'V68_INDEPENDENT_SLEEVE','V68_NEW_LONG_MAX_GROSS','PULLBACK_CONTINUATION',
    'BREAKOUT_CONFIRMATION','OVERSOLD_REVERSAL','v64CoreIdentityPass','newLongSleeve',
    'holdoutAddedLongTrades','normalHoldoutPositive','stressHoldoutPositive','strictPass',
    'KEEP_V64_RESEARCH_CANDIDATE','ADOPT_V68_INDEPENDENT_SLEEVE_RESEARCH_CANDIDATE',
    'ordersSent:false','liveChanged:false','vpsChanged:false','productionChanged:false',
]
for token in required_standalone:
    assert token in s, f'missing V68 standalone policy token: {token}'
assert '0.12049482888834451' in s
assert '0.1875' in s
assert 'replayV68NewLongSleeve' in s
assert 'candidate-pengu-ledger.json' not in s

required_dca = [
    'PENGU_NEW_LONG_MAX_GROSS','active_pengu_core','active_pengu_new','PENGU_CORE_ENTRY',
    'PENGU_NEW_ENTRY','PENGU_NEW_LONG','pengu-new-long-ledger','materialIntegratedGain',
    'CRYPTO_GROSS_CAP = 1.5','TOTAL_GROSS_CAP = 2.5','PENGU_MAX_GROSS = 0.9375','1.05',
]
for token in required_dca:
    assert token in d, f'missing V68 DCA policy token: {token}'
assert 'PENGU_CORE_ENTRY": 2' in d
assert 'PENGU_NEW_ENTRY": 3' in d
assert 'core_reserve = PENGU_MAX_GROSS' in d

print('V68_INDEPENDENT_SLEEVE_POLICY=PASS')
