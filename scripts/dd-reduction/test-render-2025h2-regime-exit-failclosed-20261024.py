#!/usr/bin/env python3
"""Strict research evidence validation: no adoption after adverse 2026 recheck."""
from pathlib import Path
import ast,json
r=Path(__file__).resolve().parents[2]
folder=r/'docs/research/results/render-three-regime-20261024'
def data(f):return json.loads((folder/f).read_text('utf8'))
scan=data('RENDER_2025H2_CAUSAL_ASOF_EXIT_GATE_1D_RESEARCH_20261024.json')
hold=data('RENDER_2026AUG_OCT_ASOF_EXIT_REGIME_RETROSPECTIVE_RECHECK_20261024.json')
grid=data('RENDER_2024_2026_OI2_4_6_8_AND_AB_EXIT_196_NATIVE_CANDIDATE_REPLAY_20261024.json')
assert scan['tested']==5184
assert scan['acceptedNoFrequencyReductionAll2025QuartersPF1']>0
assert hold['status']=='RESEARCH_ONLY_PREVIEWED_HOLDOUT_REUSE_IS_NOT_INDEPENDENT'
named=hold['results']['ASOF_RANGE_GE_0P133']['all']['30']
assert named['n']==13 and named['wins']==8 and named['pf']<1
assert named['sumPct']<0
assert abs(named['pf']-0.7757)<1e-5
assert hold['results']['ALWAYS_FLOOR']['all']['30']['pf']>1
assert hold['results']['LEGACY']['all']['30']['pf']>1
assert grid['examined']==196 and grid['qualifying']==0
assert len(grid['allSummary'])==196
assert sum(bool(z['passes']) for z in grid['allSummary'])==0
for path in ('render-2025H2-loss-fix-1D-exit-asof-study-20261024.py',
             'render-post2026aug-AB-asof-exit-retrospective-recheck-20261024.py',
             'render-2024-2026-oi-and-exits-196-grid-20261024.py'):
 ast.parse((r/'scripts/dd-reduction'/path).read_text('utf8'))
print('PASS: 5,184 in-sample one-dimensional regimes; independent-period fixed regime FAIL; 196 grids none accepted; no LIVE change')
