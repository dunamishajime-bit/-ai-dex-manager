#!/usr/bin/env python3
"""Verify 5 new Q102 experiments, frozen V4, H1 causal source and real ledger replay.
Independent full8 TS parity/live certification is NOT claimed.
"""
import hashlib,json,math
from pathlib import Path
REPO=Path(__file__).resolve().parents[2]
ROOT=Path(r'C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research')
DOCS=REPO/'docs/research/results/q102-timeexit-risk-continuation-20261022'
SETS={'2026-10-22_q102_timeexit_risk_continued_after_v4':3,
      '2026-10-22_q102_timeexit_h1_confirmed_after_v4':2}
FILES=['candidate-decisions.jsonl','portfolio-trades.jsonl','portfolio-events.jsonl','task9-mtm.jsonl','metrics.json']
def read(f):return json.loads(f.read_text('utf8'))
def sha(f):return hashlib.sha256(f.read_bytes()).hexdigest()
def main():
 d=read(DOCS/'Q102_TIMEEXIT_CONTINUED_FIVE_CASES_20261022.json')
 meta=d['meta'];base=d['baseline'];cases=d['cases']
 assert meta['status']=='FIVE_FRESH_Q102_TIMEEXIT_AND_COMPOSITE_FULL8_RESEARCH_VERIFIED_NOT_LIVE'
 assert meta['V4AdoptedFourFixed'] is True
 assert meta['noProductionChanges'] is True
 assert meta['signedVenueCertified'] is False and meta['independentLatestTask9TSEconomicParity'] is False
 assert len(cases)==sum(SETS.values())==5
 config=read(REPO/'config/research/v12-v4-long-short-4rules-20261021.json')
 assert config['status']=='FORMALLY_ADOPTED_FOR_ALL_FUTURE_BT_NOT_LIVE'
 assert config['researchAdoption']['futureBacktestsMustCarryAllFourV4Rules'] is True
 for filename,h in meta['sourceSha256'].items():
  source=REPO/'scripts/dd-reduction'/filename
  assert source.is_file(),filename
  actual=hashlib.sha256(source.read_bytes().replace(b'\r\n',b'\n')).hexdigest()
  assert actual==h,('SOURCE_DRIFT',filename)
 assert math.isclose(base['10']['finalEquityJpy'],191750055.32685158,rel_tol=1e-12)
 assert math.isclose(base['30']['finalEquityJpy'],74740267.7840667,rel_tol=1e-12)
 screen=d['H1CausalScreenByFamily']
 assert screen['MR/SHORT@12h_2.0%']['10']['oldTimeExitLosers']==8
 assert screen['MR/SHORT@12h_2.0%']['10']['oldWinners']==0
 proof={'sourceV4FourFixed':True,'historyOnly':True,'files':[]}
 for name,v in cases.items():
  assert v['v4FourRuleLocked'] is True
  assert v['sourceFolder'] in SETS
  for cost in ('10','30'):
   row=v['costs'][cost]
   assert row['accounting']=='PASS'
   assert math.isclose(row['equityJpy']-base[cost]['finalEquityJpy'],row['deltaEquityJpy'],abs_tol=1e-6)
   assert math.isclose(row['mtmMaxDdPct']-base[cost]['maxMtmDdPct'],row['ddImprovementPp'],abs_tol=1e-8)
   assert row['replayConverged'] is True
   output=read(ROOT/v['sourceFolder']/'v4-locked-q102-cumulative-results.json')['results'][name]['costs'][cost]
   counts=output['cooldownPasses']
   assert 2<=len(counts)<=5
   assert counts[-1]['observedAdmittedInitialShortStops']==counts[-1]['enforcedPriorCooldownEventCount']
   last_two=(len(counts)-2,len(counts)-1)
   paths=[]
   for ix in last_two:
    t=f'V4LOCKED_{name}_C{cost}_I{ix}'
    digest=hashlib.sha256(t.encode()).hexdigest()[:12]
    dirs=ROOT/v['sourceFolder']/'engine'/f'cmp_{digest}'/f'cmp_{digest}'/f'{cost}bps'/'cases'/'V2_M150_D05_CORE_NATIVE'/'runs'/f'PRICE_MODEL_{cost}BPS'
    paths.append(dirs)
   for filename in FILES:
    a,b=(p/filename for p in paths)
    assert a.is_file() and b.is_file(),(a,b)
    h0=sha(a);h1=sha(b)
    proof['files'].append({'name':name,'costBps':int(cost),'file':filename,'sha256Final':h1,'exactLastTwoCooldownIterations':h0==h1})
 assert len(proof['files'])==5*2*5
 proof['exactProofPassCount']=sum(x['exactLastTwoCooldownIterations'] for x in proof['files'])
 assert proof['exactProofPassCount']==len(proof['files']),(proof['exactProofPassCount'],len(proof['files']))
 doc=DOCS/'Q102_FIVE_CASES_COOLDOWN_FIXEDPOINT_SHA256_20261022.json'
 doc.write_text(json.dumps(proof,ensure_ascii=False,indent=2)+'\n',encoding='utf8',newline='\n')
 combined=cases['Q102_PB3H_LOSS_PLUS_HV_SHORT_PROFIT3_TO1']['costs']
 assert combined['10']['deltaEquityJpy']>0 and combined['30']['deltaEquityJpy']>0
 assert combined['10']['ddImprovementPp']>=-1e-10 and combined['30']['ddImprovementPp']>0
 mr=cases['Q102_MR_SHORT_H1_2CLOSE_BELOW2_AFTER12H']['costs']
 assert mr['10']['ddImprovementPp']<0 and mr['30']['ddImprovementPp']<0
 print('PASS 5 Q102 full8 portfolio BT pairs x10/30bps, V4 frozen, candidate price-path source checks, 50/50 last-2-iteration SHA256 identically replays, no LIVE')
if __name__=='__main__':main()
