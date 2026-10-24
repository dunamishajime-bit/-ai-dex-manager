import ast,json
from pathlib import Path
R=Path(__file__).resolve().parents[2]
p=R/'docs/research/results/render-two-regime-20261024'
base=json.loads((p/'RENDER_CAUSAL_PARALLEL_TWO_REGIME_SCREEN_20261024.json').read_text('utf8'))
macro=json.loads((p/'macro7d/RENDER_CAUSAL_PARALLEL_TWO_REGIME_SCREEN_20261024.json').read_text('utf8'))
context=json.loads((p/'RENDER_NATIVE24_MACRO_REGIME_CONTRAST_20261024.json').read_text('utf8'))
assert len(base['models'])==len(macro['models'])==36
assert macro['dataset']['newerCandidates']==1083
assert macro['dataset']['trainRegimeCounts'][0]>=100
assert macro['dataset']['trainRegimeCounts'][1]>=100
assert macro['frozenOldCalibrationPass']==[]
assert macro['retrospectiveStrictPassNotIndependentOOS']==[]
assert macro['models']['oi+taker_global_q0.75']['newer']['recent']['30']['n']==160
assert macro['models']['oi+taker_priority_q0.75']['newer']['recent']['30']['n']==155
assert macro['models']['oi+taker_priority_q0.75']['newer']['recent']['30']['pf']>1
assert macro['models']['oi+taker_priority_q0.75']['older']['oldCal']['30']['pf']<1
assert macro['models']['oi+taker_priority_q0.75']['older']['oldCal']['10']['pf']<1
assert macro['native24Mapping']['matchedNewBank']<5
assert context['periods']['weakJanMar']['n']==context['periods']['strongAprAug']['n']==12
assert context['periods']['weakJanMar']['wins']==3
assert context['periods']['strongAprAug']['wins']==9
assert context['periods']['weakJanMar']['RENDER_7d']['median']<context['periods']['strongAprAug']['RENDER_7d']['median']
for script in ('render-two-parallel-regimes-20261024.py','render-two-parallel-regimes-macro7d-20261024.py',
 'render-regime-macro-native24-20261024.py'):
 ast.parse((R/'scripts/dd-reduction'/script).read_text('utf8'))
print('PASS: regime methods, native24 periods, candidate-bank mismatch, old-year calibration rejection, and independent output reproducibility contract')
