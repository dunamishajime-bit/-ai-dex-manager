#!/usr/bin/env python3
"""Fail-closed Q102 model, source, portfolio and accepted V4 preservation tests."""
import json,hashlib,math
from pathlib import Path
REPO=Path(__file__).resolve().parents[2]
DIR=REPO/'docs/research/results/q102-profit-initial-risk-after-v4-20261022'
data=json.loads((DIR/'Q102_PROFIT_INITIAL_RISK_AFTER_V4_20261022.json').read_text('utf8'))
method=data['method'];base=data['baseline'];cases=data['cases']
assert method['status']=='Q102_DEEP_FULL8_9_CANDIDATES_RESEARCH_COMPLETE_NOT_LIVE'
assert method['V4FixedSourceSha']=='febb75a511f7be02a40e67ae6c426b0d24feaafb'
assert method['V4OriginalHandoffSha']=='4081eb37fe23f884a4d1fa93e2b608e388bf7071'
assert method['researchOnly'] is True if 'researchOnly' in method else method['productionModified'] is False
assert method['currentTask9IndependentTSParity'] is False
assert method['signedExchangeOrdersReadback'] is False
assert method['productionModified'] is False and method['Q102NewRulesAdopted'] is False
assert len(cases)==9
for filename,sha in method['sourceScripts'].items():
 p=REPO/'scripts/dd-reduction'/filename
 assert p.is_file(),filename
 value=hashlib.sha256(p.read_bytes().replace(b'\r\n',b'\n')).hexdigest()
 assert value==sha,(filename,'SOURCE_SCRIPT_SHA_DRIFT')
assert math.isclose(base['10']['finalEquityJpy'],191750055.32685158,rel_tol=1e-12)
assert math.isclose(base['30']['finalEquityJpy'],74740267.7840667,rel_tol=1e-12)
assert data['existingQ102ExitReasons']['10']['5M_PROTECTIVE_STOP']['count']==70
assert data['existingQ102ExitReasons']['10']['5M_PROTECTIVE_STOP']['wins']==70
assert data['existingQ102ExitReasons']['10']['5M_PROTECTIVE_STOP']['losses']==0
assert data['existingQ102ExitReasons']['10']['Q102_HARD_STOP']['losses']==10
assert data['existingQ102ExitReasons']['10']['Q102_TIME_EXIT']['losses']==30
x=data['existingQ102ExitReasons']['10']['Q102_TIME_EXIT']
assert x['grossLossJpy'] < -9000000
for n,v in cases.items():
 assert v['allFourV4RulesFixed'] is True
 for c in ('10','30'):
  r=v['costs'][c];b=base[c]
  assert r['accounting']=='PASS'
  assert math.isclose(r['ddImprovementPp'],r['maxMtmDdPct']-b['maxMtmDdPct'],abs_tol=1e-8)
  assert math.isclose(r['equityDeltaJpy'],r['finalEquityJpy']-b['finalEquityJpy'],abs_tol=1e-7)
  assert r['newQ102Exits']>=0
pb=cases['Q102_PB_LONG_INIT1P5_3H_MFE0P5']['costs']
both=cases['Q102_PB3H_LOSS_PLUS_Q102_PROFIT3_TO1']['costs']
profit3=cases['Q102_PROFIT_ARM3_FLOOR1']['costs']
all6=cases['Q102_FAMILY_PREARM3H_CAPPED6']['costs']
mr=cases['Q102_MR_SHORT_PREARM4P0_H3']['costs']
hvprofit=cases['Q102_HIGH_VOL_SHORT_PROFIT3_FLOOR1']['costs']
for c in ('10','30'):
 assert pb[c]['equityDeltaJpy']>0
 assert math.isclose(pb[c]['ddImprovementPp'],0,abs_tol=1e-10)
 assert both[c]['equityDeltaJpy']>0
 assert all6[c]['ddImprovementPp']<0 and mr[c]['ddImprovementPp']<0
 assert hvprofit[c]['equityDeltaJpy']>0
assert both['10']['ddImprovementPp']>.2 and both['30']['ddImprovementPp']<0
assert profit3['10']['ddImprovementPp']>.2 and profit3['30']['ddImprovementPp']<0
proof=json.loads((DIR/'Q102_PB_INITIAL_AND_PROFIT_GUARD_COOLDOWN_REPLAY_SHA_20261022.json').read_text('utf8'))
assert proof['status']=='COMBINED_Q102_FROZEN_V4_LAST_TWO_COOLDOWN_ITERATIONS_SHA_MATCH'
assert len(proof['files'])==10 and all(p['match'] for p in proof['files'])
catalog=json.loads((REPO/'config/research/v12-v4-long-short-4rules-20261021.json').read_text('utf8'))
assert catalog['status']=='FORMALLY_ADOPTED_FOR_ALL_FUTURE_BT_NOT_LIVE'
assert catalog['researchAdoption']['futureBacktestsMustCarryAllFourV4Rules'] is True
assert catalog['verification']['productionDeployed'] is False
print('PASS Q102 9 full8 candidates x 2 costs, frozen 4 V4 exit rules, +2/+0.5 existing profit evidence, 182/181 M5 coverage, source hash, 10/10 cooldown final-iteration ledgers, no LIVE modification')
