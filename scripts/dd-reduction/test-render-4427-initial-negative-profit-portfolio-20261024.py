#!/usr/bin/env python3
"""Strict model/source/three-replay parity and rejection gate for RENDER exits."""
from pathlib import Path
import ast,json
R=Path(__file__).resolve().parents[2]
D=R/'docs/research/results/render-three-regime-20261024'
def read(n):return json.loads((D/n).read_text('utf8'))
scan=read('RENDER_4427_INITIAL_NEGATIVE_PROFIT_JOINT_2024_2026_GRID_20261024.json')
retro=read('RENDER_4427_INITIAL_LOSS_PROFIT_PRESERVATION_AUG_OCT_RETROSPECTIVE_20261024.json')
source=read('RENDER_4427_INITIAL_NEGATIVE_AND_PROFIT_PROTECTION_M5_MODEL_BANK_20261024.json')
orig=read('RENDER_4427_RESEARCH_NATIVE8_10_30BPS_COMPARISON_20261024.json')
p28=read('RENDER_4427_V28_EARLY_PROFIT_ISOLATED_NATIVE8_20261024.json')
p53=read('RENDER_4427_V53_EARLY_PROFIT_ISOLATED_NATIVE8_20261024.json')
p561=read('RENDER_4427_V561_EARLY_LOSS_AND_PEAK_PROTECTION_NATIVE8_20261024.json')
assert source['variantsPerCandidate']==130 and source['entryEvents']==605
assert scan['caseCount']==604 and scan['strictCount']==42
assert len(scan['allModelSummaries'])==604
baseline=scan['baseline']['30']['years']
assert baseline['2024']['n']==70 and baseline['2024']['pf']==1.1579
assert baseline['2025']['n']==64 and baseline['2025']['pf']==1.4868
assert baseline['2026']['n']==41 and baseline['2026']['pf']==2.4013
candidate={v['i']:v for v in scan['allModelSummaries']}
assert candidate[28]['stage']=='early_only'
assert candidate[53]['stage']=='profit_only'
assert candidate[561]['stage']=='cross_A_loss_B_profit'
assert candidate[561]['30']['h2']['n']==19 and candidate[561]['30']['h2']['pf']==1.5591
assert candidate[561]['30']['year']['2024']['compoundPct']<baseline['2024']['compoundPct']
assert candidate[561]['30']['year']['2025']['compoundPct']<baseline['2025']['compoundPct']
assert candidate[561]['30']['year']['2026']['closeDdPct']<baseline['2026']['closeDdPct']
assert not any(
 z['30']['h2']['pf'] is not None and z['30']['h2']['pf']>1.25
 and all(z['30']['year'][year]['compoundPct']>=baseline[year]['compoundPct']
     and z['30']['year'][year]['closeDdPct']>=baseline[year]['closeDdPct']
         for year in ('2024','2025','2026'))
 for z in scan['allModelSummaries'])
retroMap={z['i']:z for z in retro['cases']}
assert retro['base']['30']['n']==13 and retro['base']['30']['pf']==1.1998
assert retroMap[28]['retro']['30']==retro['base']['30']
assert retroMap[561]['retro']['30']['compoundPct']<0
assert retroMap[561]['retro']['30']['pnlPctSum']<retro['base']['30']['pnlPctSum']
assert retroMap[53]['retro']['30']['compoundPct']<0
oldcase=orig['cases']['RENDER_4427_3ENTRY_INTEGRATED_NATIVE8']
keys={28:(p28,'RENDER_4427_EARLY_PROFIT_V28_NATIVE8'),
      53:(p53,'RENDER_4427_EARLY_PROFIT_V53_NATIVE8'),
      561:(p561,'RENDER_4427_EARLY_PROFIT_V561_NATIVE8')}
for idx,(obj,key) in keys.items():
 assert obj['cases'][key]['10']['threeReplayEconomicsEqual']
 assert obj['cases'][key]['30']['threeReplayEconomicsEqual']
 for cost in ('10','30'):
  z=obj['cases'][key][cost]
  assert z['newResearchMaxGross']<=.251
  assert len(z['tradeDetails']) in (8,9,10)
  assert z['deltaDdPctPoints']==0.0
  assert z['byStrategy']['V12'] in (834,835)
  assert all(t['utc'].startswith('2026-') for t in z['tradeDetails'])
  assert z['portfolioPF']>1 and z['finalEquityJpy']>1e8
for cost in ('10','30'):
 assert p28['cases'][keys[28][1]][cost]['finalEquityJpy']==oldcase[cost]['finalEquityJpy']
 assert p561['cases'][keys[561][1]][cost]['finalEquityJpy']>oldcase[cost]['finalEquityJpy']
 assert p561['cases'][keys[561][1]][cost]['portfolioPF']>oldcase[cost]['portfolioPF']
 assert p561['cases'][keys[561][1]][cost]['maxMtmDdPct']==oldcase[cost]['maxMtmDdPct']
for f in ('render-4427-neg-loss-profit-protection-m5-20261024.py',
 'render-4427-negative-profit-joint-grid-20261024.py',
 'render-4427-negative-profit-postaug-retrospective-20261024.py',
 'run-render-4427-initial-loss-profit-variant-native8-20261024.py',
 'audit-render-4427-exit-v28-native8-20261024.py',
 'audit-render-4427-exit-v53-native8-20261024.py',
 'audit-render-4427-exit-v561-native8-20261024.py'):
 ast.parse((R/'scripts/dd-reduction'/f).read_text('utf8'))
print('PASS: 130 causal exits, 604 comparisons, historic Pareto failure, 2026 retro warning, 3x native8 isolated+joint 10/30bps accounting and model profitability')
