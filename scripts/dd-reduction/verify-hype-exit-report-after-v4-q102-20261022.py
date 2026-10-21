#!/usr/bin/env python3
"""Fail-closed HYPE exit 4x(10/30bps) 8-strategy audit with seven adopted rules."""
import hashlib,json,math
from pathlib import Path
REPO=Path(__file__).resolve().parents[2]
D=REPO/'docs/research/results/hype-exit-after-q102v4-20261022'
def read(p):return json.loads(p.read_text('utf8'))
r=read(D/'HYPE_EXIT_AFTER_Q102V4_20261022.json')
p=read(D/'HYPE_FOUR_CASES_REPLAY_SHA256_20261022.json')
m=r['metadata'];ref=r['acceptedBenchmark'];cases=r['cases']
assert m['status']=='HYPE_5_CASE_FULL8_8LOGIC_PROFIT_LOSS_ECONOMIC_BT_VERIFIED_NOT_LIVE'
assert m['V4FourAndQ102ThreeAdoptedPoliciesFixed'] is True
assert m['HYPE75EntryUnmodified'] is True
assert m['productionOrdersChanged'] is False
assert m['researchModelOnly'] is True
assert len(cases)==5 and len(p['files'])==50 and p['identicalCount']==50
assert all(x['identicalFinalTwoPasses'] for x in p['files'])
for key,filename in [('studyCodeSha256','run-hype-profit-loss-after-accepted-v4-q102-20261022.py'),
                     ('priceScanSha256','analyze-hype-profit-initial-risk-after-q102v4-20261022.py')]:
 x=REPO/'scripts/dd-reduction'/filename
 assert m[key]==hashlib.sha256(x.read_bytes().replace(b'\r\n',b'\n')).hexdigest(),(key,'SOURCE_DRIFT')
conservative=REPO/'scripts/dd-reduction/run-hype-conservative-profit3-after-v4q102-20261022.py'
assert m['conservativeProfitModelSha256']==hashlib.sha256(conservative.read_bytes().replace(b'\r\n',b'\n')).hexdigest()
assert math.isclose(ref['10']['finalEquityJpy'],198324735.05909136,rel_tol=1e-12)
assert math.isclose(ref['30']['finalEquityJpy'],88431930.94000964,rel_tol=1e-12)
assert r['HYPEPricePaths']['10']['count']==40 and r['HYPEPricePaths']['30']['count']==38
base=cases['HYPE_BASELINE_3ACCEPTED']
for cost in ('10','30'):
 assert math.isclose(base['costs'][cost]['finalEquityJpy'],ref[cost]['finalEquityJpy'],rel_tol=1e-12)
 assert math.isclose(base['costs'][cost]['maxMtmDdPct'],ref[cost]['maxMtmDdPct'],abs_tol=1e-10)
 for name,case in cases.items():
  x=case['costs'][cost]
  assert x['accounting']=='PASS'
  assert x['newHypeExitCount']>=0
  assert math.isclose(x['ddImprovementPp'],x['maxMtmDdPct']-ref[cost]['maxMtmDdPct'],abs_tol=1e-9)
  assert math.isclose(x['deltaEquityJpy'],x['finalEquityJpy']-ref[cost]['finalEquityJpy'],abs_tol=1e-6)
assert cases['HYPE_EARLY_0H_MINUS1P5_MFE0P3']['costs']['10']['deltaEquityJpy']<0
assert cases['HYPE_EARLY_0H_MINUS1P5_MFE0P3']['costs']['30']['deltaEquityJpy']<0
print('PASS HYPE 5 cases x 10/30bps, 50/50 identical final cooldown ledgers, user adopted V4four+Q102three baseline exact, source SHA, no LIVE')
