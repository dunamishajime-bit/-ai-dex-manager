from pathlib import Path

logic=Path('scripts/research_patch_v69_independent_short_sleeve.py')
dca=Path('scripts/research_patch_v69_dual_pengu_dca.py')
assert logic.exists(), 'V69 independent Short sleeve patch not implemented yet'
assert dca.exists(), 'V69 dual-PENGU Short DCA patch not implemented yet'
ls=logic.read_text(); ds=dca.read_text()
for token in ['V69_NEW_SHORT_GROSS','0.25','replayV69NewShortSleeve','BREAKDOWN_CONTINUATION','RALLY_FAILURE','BTC_RISK_OFF','holdoutTrades','normalHoldoutPositive','stressHoldoutPositive','KEEP_V64_RESEARCH_CANDIDATE','ADOPT_V69_INDEPENDENT_SHORT_SLEEVE_RESEARCH_CANDIDATE','ordersSent:false','liveChanged:false','vpsChanged:false','productionChanged:false']:
    assert token in ls, f'missing V69 logic token: {token}'
assert '0.12049482888834451' in ls and '0.1875' in ls
assert 'incumbent-v64-pengu-ledger.json' in ls and 'new-short-sleeve-ledger.json' in ls
for token in ['V69_RESERVE_V64_GROSS','PENGU_NEW_SHORT_ENTRY','PENGU_NEW_SHORT_EXIT','active_pengu_new_short','--pengu-new-short-ledger','V69_NEW_SHORT_ENTERED','PENGU_V69_NEW_SHORT_SLEEVE']:
    assert token in ds, f'missing V69 DCA token: {token}'
assert '1.05' in ls or '1.05' in ds
print('V69_INDEPENDENT_SHORT_SLEEVE_POLICY=PASS')
