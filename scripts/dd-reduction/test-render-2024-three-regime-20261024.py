#!/usr/bin/env python3
"""2024 legacy vs new contract and three-expert research invariant tests."""
import ast,json
from pathlib import Path
root=Path(__file__).resolve().parents[2]
b=root/'docs/research/results/render-three-regime-20261024'
def read(s):return json.loads((b/s).read_text('utf8'))
source=read('RENDER_RNDR_2024_OFFICIAL_CROSS_CONTRACT_SOURCE_MANIFEST_20261024.json')
assert source['requestedN']==source['goodN']==227
assert source['missingN']==source['errorN']==0
assert source['contractSplit']['noSpliceAcrossGap']
assert all(z.get('publisherChecksumMatch') for z in source['files'])
cohort=read('RENDER_2024_RNDR_REBRAND_TWO_CONTRACT_ROUTE_BT_20261024.json')
assert cohort['provenance']['officialChecksumVerified']==227
assert cohort['provenance']['zeroVolumeOldRNDRPostExpiryRowsDiscarded']>100
assert cohort['provenance']['noCrossContractCandlesOrHoldovers']
assert len(cohort['routes'])==12
assert cohort['routes']['btc_trap__fast']['2024_old_RNDR_JAN_MAY']['30']['pf']>1
assert cohort['routes']['btc_trap__fast']['2024_new_RENDER_JUL26_DEC']['30']['pf']<1
assert cohort['routes']['two_stage__wide']['2024_new_RENDER_JUL26_DEC']['30']['n']>=120
early=read('RENDER_2024_TRAINED_TRIPLE_EXPERT_CAUSAL_BT_20261024.json')
assert early['status']=='RESEARCH_ONLY_NOT_ADOPTED'
assert early['data']['train2024RNDR']==514
assert early['data']['trainingSizes']==[514,105,74]
assert not early['calibrationAdoptionPassed']
full=read('RENDER_2024_FULLYEAR_TRIPLE_EXPERT_CAUSAL_BT_20261024.json')
assert full['status']=='RESEARCH_ONLY_NOT_ADOPTED'
assert full['data']['train2024BothContracts']==1197
assert full['data']['trainingSizes']==[1197,306,174]
assert len(full['models'])==12
assert not full['calibrationAdoptionPassed']
case=full['models']['hard_triple__q0.4']['periods']
for period in ('check_RENDER_2025_JAN_MAR','check_RENDER_2025_APR_JUL','recent_RENDER_2025_AUG_2026_AUG'):
 assert case[period]['30']['n']>=50
 assert (case[period]['30']['pf'] or 0)<1
for s in ('acquire-render-rndr-2024-history-20261024.py',
 'render-2024-route-cohort-comparison-20261024.py',
 'render-full-2024-rndr-render-separated-bt-20261024.py',
 'render-2024-trained-triple-regime-experts-20261024.py',
 'render-2024-fullyear-three-experts-20261024.py'):
 ast.parse((root/'scripts/dd-reduction'/s).read_text('utf8'))
print('PASS 2024 official SHA, old contract expiry exclusion, full-year splits, triple expert causal training and rejection')
