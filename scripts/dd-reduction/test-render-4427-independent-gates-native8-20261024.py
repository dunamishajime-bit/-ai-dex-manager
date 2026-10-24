#!/usr/bin/env python3
"""RENDER #4427 independent-Gate reproducibility evidence and native8 rejection."""
from pathlib import Path
import ast,gzip,hashlib,json,collections
ROOT=Path('C:/tmp/render-mtf-study-20261024')
REPO=Path('C:/tmp/render-multiregime-study-20261024')
def obj(p):
 if str(p).endswith('.gz'):
  with gzip.open(p,'rt',encoding='utf8') as f:return json.load(f)
 return json.loads(p.read_text('utf8'))
manifest=obj(ROOT/'RENDER_4427_BTC_5M_2025AUG_2026AUG_VERIFIED_SOURCE_MANIFEST_20261024.json')
assert manifest['goodN']==13 and manifest['missingN']==0
for item in manifest['files']:
 p=Path(item['file'])
 assert p.is_file()
 assert hashlib.sha256(p.read_bytes()).hexdigest()==item['sha256']
 assert item['publisherChecksumMatch'] and item['zipCRC']
naive=obj(ROOT/'RENDER_4427_INDEPENDENT_SHORT_DAILY_H4_SELLPRESSURE_DYNAMIC_SCORE_20261024.json')
assert naive['signalCount']==2841 and naive['originalEligible']==235
assert naive['screenCases']==117 and naive['strictAccepted']==0
assert naive['baseline']['total']==188
bank=obj(ROOT/'RENDER_4427_INDEPENDENT_ALL_GATE_SHADOW_ENTRY_BANK_20261024.json.gz')
assert len(bank['rows'])==2841
closed=obj(ROOT/'RENDER_4427_INDEPENDENT_ROLLING_CLOSED_SHADOW_RISK_GATE_20261024.json.gz')
assert len(closed['cases'])==330 and closed['genuineAccepted']==9
combo=obj(ROOT/'RENDER_4427_INDEPENDENT_COMBINED_FAMILY_SCORE_COMPETITION_20261024.json')
assert combo['totalCases']==21 and combo['passedCases']==9
regime=obj(ROOT/'RENDER_4427_BTC_DIVERGENCE_INDEPENDENT_REGIME_CAUSAL_20261024.json')
assert len(regime['cases'])==36 and sum(q['robust5'] for q in regime['cases'])==20
want=['BTC_RENDER_DIVERGE','TREND_BREAK','REBOUND_FAIL','SELL_IMBALANCE']
z=[q for q in regime['cases'] if q['btcRegime']=='SELLER_STRONGER' and q['config']['families']==want]
assert len(z)==1
r=z[0];assert r['robust5'] and r['extraCount']==38
assert r['periods']['2024']['30']['n']==97
assert r['periods']['2024']['30']['compoundPct']==25.404
assert r['periods']['2025H2']['30']['n']==25
assert r['periods']['2025H2']['30']['compoundPct']==4.306
assert r['periods']['2025H2']['30']['closedDdPct']==-13.151
assert r['periods']['2026JanAug']['30']['n']==44
assert r['periods']['2026JanAug']['30']['compoundPct']==41.483
assert r['periods']['2026JanAug']['10']['compoundPct']==54.382
assert r['passedNewByPeriod']['2026JanAug']=={'BTC_RENDER_DIVERGE':3}
old=obj(REPO/'docs/research/results/render-three-regime-20261024/RENDER_4427_RESEARCH_NATIVE8_10_30BPS_COMPARISON_20261024.json')
new=obj(ROOT/'RENDER_4427_INDEPENDENT_SELL55_NATIVE8_AUDIT_20261024.json')
proof=obj(ROOT/'RENDER_4427_INDEPENDENT_SELL55_NATIVE8_CORE_GATE_REJECTION_PROOF_20261024.json')
nativecase=new['cases']['RENDER_4427_INDEPENDENT_ASOF_SELL55_NATIVE8_20261024']
baseline=old['cases']['RENDER_4427_3ENTRY_INTEGRATED_NATIVE8']
for c in ['10','30']:
 x=nativecase[c];b=baseline[c];w=proof['costs'][c]
 assert x['threeReplayEconomicsEqual']
 assert x['finalEquityJpy']==b['finalEquityJpy'] and x['closedTrades']==b['closedTrades']
 assert x['maxMtmDdPct']==b['maxMtmDdPct']
 assert w['acceptedNewSignalsPerReplay']==0 and w['newSignalsPerReplay']==3 and w['nNativeReplays']==3
 for item in w['rejectionProof']:
  assert len(item['candidateEvents'])==3
  assert all(q['reason']=='IDLE:CORE_SIGNAL_OR_POSITION' for q in item['candidateEvents'])
for name in [
 'render_4427_independent_short_gates_dynamic_priority_20261024.py',
 'render_4427_independent_rolling_profit_gate_20261024.py',
 'render_4427_independent_combo_gate_priorities_20261024.py',
 'render_4427_btc_divergence_regime_oiindependent_20261024.py',
 'run_render_4427_independent_profit_sell55_native8_20261024.py',
 'audit_render_4427_independent_sell55_native8_20261024.py']:
 ast.parse((ROOT/name).read_text('utf8'))
assert 'BLOCKED_INDEPENDENT_OWNER_REGISTRATION' in (ROOT/'RENDER_4427_INDEPENDENT_DYNAMIC_SCORE_FULL8_RESEARCH_DECISION_20261024.md').read_text('utf8')
print('PASS official_BTC_13_SHA_256_CRC, 7_independent_gates, 235_parity, 117_unfiltered_fail, 330_prior_shadow, 21_mixed, 36_regime, seller55_fourroute_research_candidate, 10_30bps_native8_accounting_3replay, all_independent_gate_rows_blocked, no_live_adoption')
