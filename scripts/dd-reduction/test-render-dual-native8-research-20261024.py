#!/usr/bin/env python3
"""Portable invariants: source-authentic research-only native8 and older-year evidence."""
import ast,json
from pathlib import Path
R=Path(__file__).resolve().parents[2]
base=R/'docs/research/results/render-two-regime-20261024'
j=json.loads((base/'RENDER_DUAL_REGIME_NATIVE8_RESEARCH_OUTCOME_20261024.json').read_text('utf8'))
assert j['decision']=='NO_NEW_ENTRY_OR_EXIT_ADOPTION'
names=('RENDER_TWO_REGIME_PARITY_BASELINE','RENDER_TWO_REGIME_A_WEAK_SELLER_0P05_OI_UP','RENDER_DUAL_A_ADD_SELLER_0P0_OI_UP')
for cost in ('10','30'):
 x=j['cases'][cost]
 for c in names:assert x[c]['ledgerSha256'] and x[c]['totalTrades']>1200
 assert x[names[0]]['maxDrawdownPct']==x[names[1]]['maxDrawdownPct']==x[names[2]]['maxDrawdownPct']
 assert x[names[1]]['deltaEquityFromBaselineJpy']<0
 assert x[names[1]]['deltaTrades']==-7
 assert x[names[2]]['deltaEquityFromBaselineJpy']==x[names[2]]['deltaTrades']==0
assert j['nativeAdditionalCandidateTotals']['newDistinct']==5
assert j['nativeAdditionalCandidateTotals']['hypotheticalPriceWinners']==3
assert j['nativeAdditionalCandidateTotals']['hypotheticalPriceLosers']==2
assert j['nativeAdditionalCandidateTotals']['actualAdditionalModelFills']==0
assert any(z['modeledPriceReturnShortPct']<=-9 for z in j['nativeAdditionalCandidates'])
x=json.loads((base/'RENDER_EXTREME_TWO_REGIME_OLDER_YEAR_CAUSAL_DIAGNOSTIC_20261024.json').read_text('utf8'))
z=x['groups']['A_extreme_7d_minus20_seller3_OIup']
assert z['oldTrain']['30']['pf']<1 and z['oldCal']['30']['pf']<1
assert z['recent']['30']['pf']>1
assert z['oldCal']['10']['pf']<1
for script in ('run-render-two-regime-native-full8-20261024.py',
 'run-render-dual-regime-additive-native8-20261024.py',
 'compare-render-two-regime-native8-20261024.py',
 'render-extreme-ab-older-history-20261024.py'):
 ast.parse((R/'scripts/dd-reduction'/script).read_text('utf8'))
print('PASS: native8 10/30 accounting audit, no adoption, A gate rejection, additive candidate nonadmission, old historical regimes unstable')
