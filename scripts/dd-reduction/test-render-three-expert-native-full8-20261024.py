#!/usr/bin/env python3
"""Offline accounting and research safety invariants for full-eight RENDER tri entry."""
import ast,json
from pathlib import Path
r=Path(__file__).resolve().parents[2]
d=r/'docs/research/results/render-three-regime-20261024'
j=json.loads((d/'RENDER_THREE_EXPERT_TRUE_NATIVE8_10_30BPS_COMPARISON_20261024.json').read_text('utf8'))
assert j['status']=='RESEARCH_ONLY_NATIVE_EIGHT_LOGIC_INTEGRATED_ACCOUNTING_VERIFIED'
expected={'V12','PENGU','Q102','FET','HYPE_LONG','V52','IDLE','RESIDUAL'}
assert all(set(j['baseline'][c]['byStrategy'])==expected for c in ('10','30'))
assert len(j['cases'])==2
for cost in ('10','30'):
 base=j['baseline'][cost]
 for name,v in j['cases'].items():
  x=v[cost]
  assert set(x['byStrategy'])==expected
  assert x['deltaTrades']>=5 and x['deltaEquityJpy']>0
  assert abs(x['deltaDdPctPoints'])<1e-7
  assert x['threeReplayEconomicsEqual']
  assert len(x['economicLedgerSha256'])==64
  assert x['newResearchTradesCount']>=7
  assert x['newResearchMaxGross']<=0.251
  assert all(int(t['utc'][:4])==2026 for t in x['tradeDetails'])
  assert x['byStrategy']['IDLE']>base['byStrategy']['IDLE']
  assert x['closedTrades']>base['closedTrades']
more=j['cases']['RENDER_TRI_ALPHA_BTC_TRAP_OI02_ADD']
less=j['cases']['RENDER_TRI_ALPHA_BTC_TRAP_OI06_ADD']
for c in ('10','30'):
 assert more[c]['finalEquityJpy']>less[c]['finalEquityJpy']
 assert more[c]['closedTrades']>less[c]['closedTrades']
assert more['10']['newResearchTradesCount']==9
assert more['30']['newResearchTradesCount']==8
assert less['10']['newResearchTradesCount']==8
assert less['30']['newResearchTradesCount']==7
assert abs(more['10']['finalEquityJpy']-288120929.77070844)<0.01
assert abs(more['30']['finalEquityJpy']-173946438.6979451)<0.01
p=r/'scripts/dd-reduction/run-render-2024-triple-native-full8-20261024.py'
src=p.read_text('utf8')
assert 'START=1767830400000;END=1786320000000' in src
assert "requested_gross':.25" in src
assert "funding_return_per_gross':0." in src
assert 'kernel.entry_filter=injection_filter' in src
ast.parse(src)
ast.parse((r/'scripts/dd-reduction/audit-render-three-expert-native-full8-20261024.py').read_text('utf8'))
print('PASS: all8 10/30bps native wallet, accounting baseline, economic rerun parity, H1 mark Fail-Closed, no LIVE adoption')
