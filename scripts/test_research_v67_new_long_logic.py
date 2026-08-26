from pathlib import Path

p = Path('scripts/research_patch_v67_new_long_logic.py')
assert p.exists(), 'V67 independent new Long patch not implemented yet'
s = p.read_text()

required = [
    'V67_NEW_LONG',
    'PULLBACK_CONTINUATION',
    'BREAKOUT_CONFIRMATION',
    'OVERSOLD_REVERSAL',
    'incumbentIdentityPreserved',
    'holdoutAddedLongTrades',
    'normalHoldoutPositive',
    'stressHoldoutPositive',
    'materialIntegratedGain',
    'strictPass',
    'KEEP_V64_RESEARCH_CANDIDATE',
    'ADOPT_V67_NEW_LONG_RESEARCH_CANDIDATE',
    'ordersSent:false',
    'liveChanged:false',
    'vpsChanged:false',
    'productionChanged:false',
]
for token in required:
    assert token in s, f'missing V67 policy token: {token}'

# V64 is the immutable research incumbent for this stage.
assert '0.12049482888834451' in s
assert '0.1875' in s

# V67 must be additive Long research, not another V64 sizing/exit optimization.
assert 'V67_NEW_SHORT' not in s
assert 'v67SupplementalGross' not in s
assert 'hardStopPct' not in s
assert 'trailingRetracePct' not in s

# The integrated hurdle is intentionally material: at least +5% ending asset
# versus V64, rather than accepting another marginal V66-style gain.
assert '1.05' in s

print('V67_INDEPENDENT_NEW_LONG_POLICY=PASS')
