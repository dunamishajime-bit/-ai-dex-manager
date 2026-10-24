#!/usr/bin/env python3
"""Offline immutable evidence audit for the 2024-origin triple research and
post-2026-Aug first-look holdout. No network, no account changes, no orders."""
import ast,json
from pathlib import Path
root=Path(__file__).resolve().parents[2]
folder=root/'docs/research/results/render-three-regime-20261024'
def read(s):return json.loads((folder/s).read_text('utf8'))
a=read('RENDER_2024_FRESH_LONG_SHORT_12_ENTRY_7_EXIT_SCREENER_20261024.json')
assert a['status'].startswith('RESEARCH_ONLY')
assert len(a['families'])==84 and len(a['selectedBenchTradeAudit'])==121
assert len(a['allBenchSignalEvents'])==151
assert len(a['dualShortResearchSignalEvents'])==263
res=read('RENDER_2024_BEAR_REBOUND_NATIVE_COHORT_DYNAMIC_OI3_GATE_20261024.json')
assert res['candidateN']==151
assert 'OI3_CONTRACTION_MIN0P6' in res['researchThreeYearPositive']
g=read('RENDER_THREE_EXPERT_AB_PLUS_NATIVE_B_PREALLOCATION_SCREEN_20261024.json')
assert g['status'].startswith('RESEARCH_ONLY')
assert g['bankN']==263
candidate='AB_TRAP_PLUS_FADE_OI3_LE_M0P6'
assert candidate in g['threeYearProfitableResearchOnly']
for year,num in (('2024',65),('2025',57),('2026',35)):
 e=g['models'][candidate]['periods'][year]
 assert e['30']['n']==num and e['10']['n']==num
 assert (e['30']['pf'] or 0)>1 and (e['10']['pf'] or 0)>1
for section in ('2024_RNDR_JAN_MAY','2024_RNDR_JUN_JUL16','2024_RENDER_JUL_DEC',
 '2025_RENDER_JAN_MAR','2025_RENDER_APR_JUL','2025_RENDER_AUG_DEC',
 '2026_RENDER_JAN_MAR','2026_RENDER_APR_AUG'):
 assert (g['models'][candidate]['periods'][section]['30']['pf'] or 0)>1
assert g['models'][candidate]['newResearchEntriesWithin24hExistingNative']==9
r=read('RENDER_THREE_EXPERT_2024_AB_PROVISIONAL_RISK_AND_NATIVE_CONFLICT_20261024.json')
assert r['n']==157
assert r['data']['newEntryTimesNearNative24h']==9
for year in ('2024','2025','2026'):
 v=r['sizing']['30bps__0.5x'][year]
 assert v['trades']>=35 and v['closeDDPct']>=-15 and v['compoundPct']>0
s=read('RENDER_POST_2026AUG_HELDOUT_PUBLIC_SOURCE_MANIFEST_20261024.json')
assert s['status']=='HOLDOUT_INPUTS_READY'
assert s['staticRequested']==s['staticPublisherChecksumVerified']==99
assert s['staticBad']==0 and all(z['publisherChecksumMatch'] for z in s['files'])
assert s['fundingOctoberPublicApi']['count']==132
assert len(s['fundingOctoberPublicApi']['rawResponseSHA256'])==64
h=read('RENDER_POST_2026AUG_FROZEN_TRIPLE_ENTRY_HOLDOUT_FIRST_LOOK_20261024.json')
assert h['frozenPrimaryStatus']=='PASS_HISTORICAL_RECHECK_NOT_NATIVE8'
assert h['sources']['freshZipCount']==99
assert h['candidateN']>=9
for c in ('10','30'):
 x=h['variants'][candidate]['entireWindow'][c]
 assert x['n']==10 and x['wins']==6 and (x['pf'] or 0)>1
assert h['variants'][candidate]['entireWindow']['30']['closeDDPct']>=-7
assert h['variants'][candidate]['afterSep1']['30']['n']==6
for code in (
 'render-2024-directional-long-short-search-20261024.py',
 'render-2024-bearfade-oi-dynamic-gates-20261024.py',
 'render-three-regime-preallocation-short-experts-20261024.py',
 'render-three-expert-market-score-risk-20261024.py',
 'acquire-render-post2026aug-holdout-20261024.py',
 'render-post2026aug-frozen-3expert-holdout-20261024.py'):
 ast.parse((root/'scripts/dd-reduction'/code).read_text('utf8'))
print('PASS: 84-entry-exit screen, 2024/25/26 all 30bps and 10bps, risk sizing, 99 SHA-verified first-look archives and no-adoption invariant')
