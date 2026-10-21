#!/usr/bin/env python3
"""Fail-closed research proof against source SHA and 40 native 8-logic ledger pairs."""
import json,hashlib,math
from pathlib import Path
REPO=Path(__file__).resolve().parents[2]
ROOT=Path(r'C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research')
OUT=ROOT/'2026-10-22_hype_entry_winrate_after_v4_q102adopted3_full8'
DOC=REPO/'docs/research/results/hype-entry-winrate-after-v4-q102-20261022'
def read(p):return json.loads(p.read_text('utf8'))
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
data=read(DOC/'HYPE_ENTRY_WINRATE_V4_Q102_20261022.json')
proof=read(DOC/'HYPE_WINRATE_FULL8_40_LEDGER_SHA256_PROOF_20261022.json')
meta=data['metadata']
assert meta['status']=='HYPE_WINRATE_CAUSAL_H1_ENTRY_4POLICY_FULL8_ECONOMIC_MODEL_VERIFIED_RESEARCH_ONLY'
assert meta['V4FourAndQ102ThreeUserAdoptedRetained']
assert meta['HYPEGateAuditedAllNewAdmittedNativeTrades']
assert meta['productionOrdersChanged'] is False
assert meta['independentFutureUnseenHoldoutRequired'] is True
for name,digest in meta['sourceSha256'].items():
 p=REPO/'scripts/dd-reduction'/name
 assert p.is_file()
 assert hashlib.sha256(p.read_bytes().replace(b'\r\n',b'\n')).hexdigest()==digest,name
cases=data['cases'];old=data['baselineSevenUserAdopted']
assert len(cases)==4
assert len(proof['proof'])==40 and proof['filesExact']==40
for item in proof['proof']:
 name=item['policy'];c=str(item['costBps']);file=item['file']
 assert item['identicalLastTwoCooldownPasses'] is True
 assert name in cases and c in ('10','30')
 expected=item['sha256']
 paths=[]
 for i in (1,2):
  key=f'HYPE_WINRATE_{name}_C{c}_I{i}'
  tag=hashlib.sha256(key.encode()).hexdigest()[:12]
  paths.append(OUT/'engine'/f'cmp_{tag}'/f'cmp_{tag}'/f'{c}bps/cases/V2_M150_D05_CORE_NATIVE/runs'/f'PRICE_MODEL_{c}BPS'/file)
 assert all(p.is_file() for p in paths),paths
 assert sha(paths[0])==sha(paths[1])==expected,(name,c,file)
for name,case in cases.items():
 assert case['preservesAllSevenAdoptedExitRules']
 for c in ('10','30'):
  v=case['costs'][c]
  assert v['accounting']=='PASS'
  assert v['hypeWins']+v['hypeLosses']==v['hypeAcceptedTrades']
  assert math.isclose(v['hypeWins']/v['hypeAcceptedTrades']*100,v['hypeWinRatePct'],abs_tol=1e-9)
  assert math.isclose(v['finalEquityJpy']-old[c]['finalEquityJpy'],v['equityVsSevenAdoptedJpy'],abs_tol=1e-6)
  assert math.isclose(v['maxMtmDdPct']-old[c]['maxMtmDdPct'],v['ddVsSevenAdoptedPp'],abs_tol=1e-9)
best=cases['HYPE_BTC3H_LE0P6_REL3H_GE2P0']['costs']
assert best['10']['hypeAcceptedTrades']==18 and best['10']['hypeWins']==12
assert best['30']['hypeAcceptedTrades']==17 and best['30']['hypeWins']==12
assert all(best[c]['finalEquityJpy']>old[c]['finalEquityJpy'] for c in ('10','30'))
assert best['30']['ddVsSevenAdoptedPp']<0
print('PASS HYPE entry 4 rules x 10/30bps; 40/40 last 2 native economic ledgers SHA256; V4 4 + Q102 3 adopted locked; best 12/18 and 12/17; no LIVE')
