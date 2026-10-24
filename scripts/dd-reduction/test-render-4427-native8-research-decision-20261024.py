#!/usr/bin/env python3
"""No-LIVE evidence/portfolio test: 8 shared-wallet 4427 accepted-trade parity."""
from pathlib import Path
import ast,json
r=Path(__file__).resolve().parents[2]
base=r/'docs/research/results/render-three-regime-20261024'
data=json.loads((base/'RENDER_4427_RESEARCH_NATIVE8_10_30BPS_COMPARISON_20261024.json').read_text('utf8'))
key='RENDER_4427_3ENTRY_INTEGRATED_NATIVE8'
assert data['status']=='RESEARCH_ONLY_RENDER_4427_NATIVE_EIGHT_STRATEGY_ACCOUNTING_VERIFIED'
grid=json.loads((base/'RENDER_B_30_INITIAL_STOP_AND_ENTRY_PORTFOLIO_COHORT_GRID_20261024.json').read_text('utf8'))
candidate=next(row for row in grid['allCasesSummary'] if row['index']==4427)
assert candidate['year30']['2024']['pf']>1.1
assert candidate['year30']['2025']['pf']>1.1
assert candidate['year30']['2026']['pf']>2.0
assert candidate['year30']['2025']['wr']<70
assert not candidate['strict']
hold=json.loads((base/'RENDER_2026AUG_OCT_7_CANDIDATE_B_STOP_RECHECK_20261024.json').read_text('utf8'))
retro=hold['candidates']['4427']['all']['30']
assert retro['n']==13 and retro['pf']>1.1
assert hold['status'].startswith('RESEARCH_ONLY_RETROSPECTIVE')
for c,added,improved in [('10',9,4_168_598.04335),('30',8,847_535.05678)]:
 old=data['baseline'][c]
 now=data['cases'][key][c]
 assert len(old['byStrategy'])==8 and len(now['byStrategy'])==8
 assert now['threeReplayEconomicsEqual'] and now['newResearchMaxGross']<=.251
 assert now['deltaTrades']==6 and now['deltaDdPctPoints']==0.0
 assert now['deltaEquityJpy']>0 and abs(now['deltaEquityJpy']-improved)<1e-2
 assert now['newResearchTradesCount']==added
 assert now['newResearchTradesByRoute']['IDLE_RENDER_4427_BTC_TRAP_SHORT']==6
 assert now['newResearchTradesByRoute'].get('IDLE_RENDER_4427_FAILED_RETEST_SHORT',0)==0
 assert now['newResearchTradesByRoute']['IDLE_RENDER_4427_BEAR_OI_SHORT']==added-6
 assert all(item['utc'].startswith('2026-') for item in now['tradeDetails'])
 assert sum(now['strategyReallocationCounts'].values())==now['deltaTrades']
 assert now['portfolioPF']>1
 assert not now['rawByteLedgersEqual'] or now['threeReplayEconomicsEqual']
assert data['cases'][key]['30']['deltaPF']<0
for name in ('render-all-short-regime-m5-entry-bank-20261024.py',
 'render-six-short-entry-portfolio-priority-grid-20261024.py',
 'render-2024-2026-short-B-30-bracket-models-20261024.py',
 'render-B-brackets-six-family-all-combo-screen-20261024.py',
 'render-six-short-postaug2026-retrospective-bank-20261024.py',
 'render-B-stops-seven-shortlist-postaug-retrospective-20261024.py',
 'run-render-4427-native8-shared-wallet-20261024.py',
 'audit-render-4427-native8-20261024.py'):
 ast.parse((r/'scripts/dd-reduction'/name).read_text('utf8'))
print('PASS: native8 10/30 accounting 3 replay economic equality, model profit/DD/trades, no unsupported LIVE')
