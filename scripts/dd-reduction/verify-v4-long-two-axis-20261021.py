#!/usr/bin/env python3
"""Verify two-axis V4 LONG non-production 10/30bps BT result invariants."""
import hashlib,json,math
from pathlib import Path
here=Path(__file__).resolve().parent
doc=here.parents[1]/'docs/research/results/v12-v4-long-route-risk-20261021'
j=json.loads((doc/'V12_V4_LONG_H1_TWO_AXIS_RESEARCH_20261021.json').read_text('utf8'))
assert j['status']=='RESEARCH_ONLY_NO_ACCEPTED_CASE'
assert j['liveChange'] is False and j['productionChange'] is False
assert j['signedVenueParity'] is False and j['independentNewTask9ReducerParity'] is False
assert len(j['studyCases'])==10
assert j['researchScriptSha256']==hashlib.sha256((here/'run-task9-v4-long-two-axis-20261021.py').read_bytes()).hexdigest()
for cost in ('10','30'):
 b=j['baseline'][cost]
 for id,item in j['studyCases'].items():
  r=item['costs'][cost]
  assert r['accounting']=='PASS', (id,cost)
  assert math.isclose(r['maxMtmDdPct']-b['maxMtmDdPct'],r['ddImprovementPp'],abs_tol=1e-8),(id,cost)
  assert r['admittedLongExits']>=0 and 0<=r['originalLosersImproved']<=r['admittedLongExits']
  assert 0<=r['originalWinnersExitedEarly']<=r['admittedLongExits']
for id,item in j['studyCases'].items():
 assert item['gate10and30ddImproveAtLeast0p1pt'] is False,id
assert '2h' in j['sourceRule'] or '2H' in j['sourceRule']
print('PASS 10 candidates, 20 full8 cost cases, causal-study source SHA, finance/DD invariants, all gated NO-ADOPT')
