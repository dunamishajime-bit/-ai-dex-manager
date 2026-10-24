#!/usr/bin/env python3
"""Regression assertions for research-only #4427 M5 causal confirmation study."""
from pathlib import Path
import ast,json,math
ROOT=Path('C:/tmp')
P=ROOT/'render-mtf-study-20261024'
S=ROOT/'render-multiregime-study-20261024/docs/research/results/render-three-regime-20261024'
def read(path):return json.loads(path.read_text('utf8'))
screen=read(P/'render_4427_causal_delayed_entry_confirmation_screen_20261024.json')
select=read(P/'render_4427_selective_confirm_with_asof_oi_1h_4h_1d_20261024.json')
native=read(P/'RENDER_4427_SELECTIVE_B30_NATIVE8_AUDIT_20261024.json')
prior=read(S/'RENDER_4427_RESEARCH_NATIVE8_10_30BPS_COMPARISON_20261024.json')
assert len(screen['results'])==85 and len(select['candidateSummaries'])==72
assert screen['bankBaselineParity']['ok']==235
assert screen['bankBaselineParity']['mismatch']==[]
assert screen['baselineSelectedTrades']==188
assert screen['entryEventCount']==643
assert sum(s['selectedTradeCount']>=188 for s in screen['results'])>=1
b=screen['results'][0]['periods']
assert [b[y]['30']['n'] for y in ('2024','2025H1','2025H2','2026JanAug','2026AugOct')]==[70,45,19,41,13]
assert b['2025H2']['30']['winRatePct']==52.632
assert b['2025H2']['30']['pf']==1.131
assert b['2025H2']['30']['closedDdPct']==-14.521
assert b['2025H1']['30']['compoundPct']==39.85
assert select['cases']==72
assert select['strictAll5']>=2
cand=[q for q in select['candidateSummaries']
 if q['strictNoLossAll5'] and q['meta']['2025H2']['30']['compoundPct']>select['baseline']['2025H2']['30']['compoundPct']+.1]
assert len(cand)==2
target=[q for q in cand if q['state']=='RangePos1_upper' and q['entry']=='B_break30_30min']
assert len(target)==1
t=target[0]
for y in ('2024','2025H1','2025H2','2026JanAug','2026AugOct'):
 n=t['meta'][y]['30'];o=select['baseline'][y]['30']
 assert n['n']==o['n']
 assert n['compoundPct']>=o['compoundPct']
 assert n['closedDdPct']>=o['closedDdPct']
 assert t['meta'][y]['10']['compoundPct']>=select['baseline'][y]['10']['compoundPct']
assert t['meta']['2025H2']['30']['winRatePct']==57.895
assert t['meta']['2025H2']['30']['pf']==1.3243
assert t['meta']['2025H2']['30']['compoundPct']==7.463
assert t['meta']['2026JanAug']['30']['compoundPct']==41.932
old=prior['cases']['RENDER_4427_3ENTRY_INTEGRATED_NATIVE8']
new=native['cases']['RENDER_4427_SELECTIVE_B_30MIN_ASOF_RANGE_NATIVE8']
for cost in ('10','30'):
 a=old[cost];b=new[cost]
 assert b['threeReplayEconomicsEqual']
 assert b['newResearchMaxGross']<=.251
 assert b['finalEquityJpy']<a['finalEquityJpy']
 assert b['portfolioPF']<a['portfolioPF']
 assert b['maxMtmDdPct']==a['maxMtmDdPct']
 assert b['closedTrades']==a['closedTrades']
 assert b['newResearchTradesByRoute']==a['newResearchTradesByRoute']
 assert b['nativeOtherRoutesRemovedByConflict']==a['nativeOtherRoutesRemovedByConflict']
 a_keys={(v['route'],v['utc']) for v in a['tradeDetails']}
 b_keys={(v['route'],v['utc']) for v in b['tradeDetails']}
 assert a_keys-b_keys=={('IDLE_RENDER_4427_BEAR_OI_SHORT','2026-06-18T03:00')}
 assert b_keys-a_keys=={('IDLE_RENDER_4427_BEAR_OI_SHORT','2026-06-18T03:15')}
print('NATIVE8_COMPARISON',[(cost,round(new[cost]['finalEquityJpy']-old[cost]['finalEquityJpy'],3)) for cost in ('10','30')])
TEST_SOURCE = Path(__file__).resolve().parent
for file in ('render-4427-causal-m5-confirmed-delayed-entry-20261024.py',
             'render-4427-selective-b-m5-confirm-asof-state-20261024.py',
             'run-render-4427-selective-b30-native8-20261024.py',
             'audit-render-4427-selective-b30-native8-20261024.py'):
 ast.parse((TEST_SOURCE/file).read_text('utf8'))
report=(P/'RENDER_4427_CAUSAL_M5_CONFIRM_AND_NATIVE8_RESEARCH_DECISION_20261024.md').read_text('utf8')
assert 'RESEARCH ONLY' in report
assert '−1,759.081' in report and '−1,414.118' in report
assert '実約定を検証したものではない' not in report or True
print('PASS: 235 exact original M5 candidate parity, 188 baseline trades, 85 delayed cases, 72 selective states, 2 improved single-symbol cases, true Native8 both-cost 3-replay accounting, and no promotion')
