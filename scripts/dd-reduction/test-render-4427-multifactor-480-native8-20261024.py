#!/usr/bin/env python3
"""Deterministic evidence assertions for RENDER 4427 multifactor/native8 research."""
import ast,json
from pathlib import Path
REPO=Path('C:/tmp/render-multiregime-study-20261024')
TMP=Path('C:/tmp/render-mtf-study-20261024')
DOC=REPO/'docs/research/results/render-three-regime-20261024'
a=json.loads((TMP/'RENDER_4427_MULTIFACTOR_CAUSAL_ROUTING_SCREEN_20261024.json').read_text('utf8'))
native=json.loads((TMP/'RENDER_4427_MULTIFACTOR_D1H4RANGE_NATIVE8_AUDIT_20261024.json').read_text('utf8'))
orig=json.loads((DOC/'RENDER_4427_RESEARCH_NATIVE8_10_30BPS_COMPARISON_20261024.json').read_text('utf8'))
assert a['candidateCount']==480
assert a['baseTradeCount']==188
assert a['originalEligible']==235
assert len(a['results'])==480
passed=[r for r in a['results'] if r['allFive30BpsPass'] and r['allFive10BpsPass']]
assert len(passed)==227
improved=[r for r in passed if r['h2CompoundGainPctPts']>=.2]
assert len(improved)==5
target=[r for r in improved if r['rule']=='d1up_h4up_range' and r['factorThreshold']==2 and r['model']=='break30']
assert len(target)==1
new=target[0]['periods'];old=a['baseline']
for period in ('2024','2025H1','2025H2','2026JanAug','2026AugOct'):
 assert new[period]['30']['n']==old[period]['30']['n']
 assert new[period]['30']['compoundPct']>=old[period]['30']['compoundPct']
 assert new[period]['30']['closedDdPct']>=old[period]['30']['closedDdPct']
 assert new[period]['10']['compoundPct']>=old[period]['10']['compoundPct']
assert new['2025H2']['30']['compoundPct']==7.463
assert new['2025H2']['30']['winRatePct']==57.895
assert new['2026JanAug']['30']['compoundPct']==41.932
c=native['cases']['RENDER_4427_COMPOSITE_D1_H4_RANGE_2OF3_NATIVE8']
prior=orig['cases']['RENDER_4427_3ENTRY_INTEGRATED_NATIVE8']
for cost in ('10','30'):
 w=c[cost];v=prior[cost]
 assert w['threeReplayEconomicsEqual']
 assert w['closedTrades']==v['closedTrades']
 assert w['maxMtmDdPct']==v['maxMtmDdPct']
 assert w['newResearchTradesByRoute']==v['newResearchTradesByRoute']
 assert w['newResearchMaxGross']<=.251
 assert w['finalEquityJpy']<v['finalEquityJpy']
 lost={(z['route'],z['utc']) for z in v['tradeDetails']}-{(z['route'],z['utc']) for z in w['tradeDetails']}
 added={(z['route'],z['utc']) for z in w['tradeDetails']}-{(z['route'],z['utc']) for z in v['tradeDetails']}
 assert lost=={('IDLE_RENDER_4427_BEAR_OI_SHORT','2026-06-08T09:00'),('IDLE_RENDER_4427_BEAR_OI_SHORT','2026-06-18T03:00')}
 assert added=={('IDLE_RENDER_4427_BEAR_OI_SHORT','2026-06-08T09:30'),('IDLE_RENDER_4427_BEAR_OI_SHORT','2026-06-18T03:15')}
print('PASS multifactor_480, all_5_windows_30bps_and_10bps, five_2025H2_improvement_candidates, native8_10_30_3replay, no_adoption')
