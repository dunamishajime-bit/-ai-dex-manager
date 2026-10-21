#!/usr/bin/env python3
"""Source-backed HYPE initial loss/profit research with fixed accepted V4/Q102."""
import hashlib,json,math
from pathlib import Path
REPO=Path(__file__).resolve().parents[2]
ROOT=Path(r'C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research')
RUN=ROOT/'2026-10-22_hype_profit_loss_after_v4_q102adopted3_full8'
EXTRA=ROOT/'2026-10-22_hype_conservative_profit3_after_v4_q102adopted3'
SCREEN=ROOT/'2026-10-22_hype_exit_after_q102v4/HYPE_M5_PROFIT_INITIAL_SCREEN_20261022.json'
OUT=REPO/'docs/research/results/hype-exit-after-q102v4-20261022'
CASES=['HYPE_BASELINE_3ACCEPTED','HYPE_EARLY_0H_MINUS1P5_MFE0P3','HYPE_PROFIT_ARM0P8_FLOOR0P3','HYPE_BOTH_EARLY1H_PROFIT1P5','HYPE_PROFIT_ARM3_FLOOR1']
FILES=['candidate-decisions.jsonl','portfolio-trades.jsonl','portfolio-events.jsonl','task9-mtm.jsonl','metrics.json']
def read(p):return json.loads(p.read_text('utf8'))
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def save(p,d):p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n',encoding='utf8',newline='\n')
def main():
 r=read(RUN/'HYPE_CUMULATIVE_EXIT_COMPARISON_20261022.json');s=read(SCREEN)
 extra=read(EXTRA/'HYPE_CUMULATIVE_EXIT_COMPARISON_20261022.json')
 assert extra['sourceArchiveSha256']==r['sourceArchiveSha256']
 assert extra['V4FourAndQ102ThreeAlreadyAdoptedLocked']
 assert extra['baselineQ102ThreeAdopted']==r['baselineQ102ThreeAdopted']
 assert set(extra['results'])=={'HYPE_PROFIT_ARM3_FLOOR1'}
 r['results'].update(extra['results'])
 assert r['status']=='HYPE_PROFIT_INITIAL_AFTER_V4_Q102_THREE_ADOPTED_RESEARCH_ONLY'
 assert r['V4FourAndQ102ThreeAlreadyAdoptedLocked'] and r['hypeEntryHype75RulesUnchanged']
 assert set(r['results'])==set(CASES)
 assert s['status']=='HYPE_USER_ADOPTED_V4_Q102_3_FIXED_PRICE_SCREEN'
 reference=r['baselineQ102ThreeAdopted']
 proof=[];results={}
 for name in CASES:
  candidate=r['results'][name]
  assert candidate['allV4FourAndQ102ThreeAdoptedRulesFixed']
  costs={}
  for cost in ('10','30'):
   item=candidate['costs'][cost];baseline=reference[cost]
   assert item['accounting']=='PASS'
   iters=item['cooldownIterations']
   assert len(iters)>=2
   assert iters[-1]['enforcedPreviousCooldownCount']==iters[-1]['acceptedV4ShortInitialStopCount']
   if name=='HYPE_BASELINE_3ACCEPTED':
    assert math.isclose(item['finalEquityJpy'],baseline['finalEquityJpy'],rel_tol=1e-11)
    assert math.isclose(item['maxMtmDdPct'],baseline['maxMtmDdPct'],abs_tol=1e-9)
    assert item['hypeAcceptedTrades']==s['costs'][cost]['count']
   casesub=[]
   for file in FILES:
    paths=[]
    for it in iters[-2:]:
     policy=f'HYPE3ACCEPTED_{name}_C{cost}_I{it["iteration"]}'
     digest=hashlib.sha256(policy.encode()).hexdigest()[:12]
     folder=EXTRA if name=='HYPE_PROFIT_ARM3_FLOOR1' else RUN
     paths.append(folder/'engine'/f'cmp_{digest}'/f'cmp_{digest}'/f'{cost}bps'/'cases'/'V2_M150_D05_CORE_NATIVE'/'runs'/f'PRICE_MODEL_{cost}BPS'/file)
    assert all(x.is_file() for x in paths),paths
    h1,h2=map(sha,paths)
    proof.append({'candidate':name,'costBps':int(cost),'file':file,'sha256LastPass':h2,'identicalFinalTwoPasses':h1==h2})
    assert h1==h2,('COOLDOWN_LAST_PASSES_DRIFT',name,cost,file)
   costs[cost]={
    'finalEquityJpy':item['finalEquityJpy'],'maxMtmDdPct':item['maxMtmDdPct'],
    'profitFactor':item['profitFactor'],'closedTrades':item['closedTrades'],
    'hypeAcceptedTrades':item['hypeAcceptedTrades'],'hypeExitReasons':item['hypeExitReasons'],
    'newHypeExitCount':sum(n for reason,n in item['hypeExitReasons'].items() if reason.startswith('RESEARCH_')),
    'deltaEquityJpy':item['finalEquityJpy']-baseline['finalEquityJpy'],
    'ddImprovementPp':item['maxMtmDdPct']-baseline['maxMtmDdPct'],
    'acceptedV4ShortStopCooldownCount':item['acceptedShortStopsFromRealAdmittedModelExits'],
    'accounting':'PASS'
   }
  results[name]={'candidate':candidate['hypeNewResearchPolicy'],'costs':costs,'v4AndQ102Fixed':True,
     'bothCostsImproveDdBy0p1Pp':all(costs[c]['ddImprovementPp']>=.1 for c in ('10','30')),
     'bothCostsNoDdWorsening':all(costs[c]['ddImprovementPp']>=-1e-9 for c in ('10','30'))}
 assert len(proof)==len(CASES)*2*len(FILES) and all(x['identicalFinalTwoPasses'] for x in proof)
 meta={
  'status':'HYPE_5_CASE_FULL8_8LOGIC_PROFIT_LOSS_ECONOMIC_BT_VERIFIED_NOT_LIVE',
  'period':'2025-08-10 to 2026-08-10','initialJpy':10000,'depositsJpy':0,
  'costsBps':[10,30],'V4FourAndQ102ThreeAdoptedPoliciesFixed':True,
  'HYPE75EntryUnmodified':True,'sourceArchiveSha256':r['sourceArchiveSha256'],
  'pricePathHYPETradeCount10bps':s['costs']['10']['count'],
  'pricePathHYPETradeCount30bps':s['costs']['30']['count'],
  'studyCodeSha256':hashlib.sha256((REPO/'scripts/dd-reduction/run-hype-profit-loss-after-accepted-v4-q102-20261022.py').read_bytes().replace(b'\r\n',b'\n')).hexdigest(),
  'priceScanSha256':hashlib.sha256((REPO/'scripts/dd-reduction/analyze-hype-profit-initial-risk-after-q102v4-20261022.py').read_bytes().replace(b'\r\n',b'\n')).hexdigest(),
  'conservativeProfitModelSha256':hashlib.sha256((REPO/'scripts/dd-reduction/run-hype-conservative-profit3-after-v4q102-20261022.py').read_bytes().replace(b'\r\n',b'\n')).hexdigest(),
  'researchModelOnly':True,'liveVenueAndCurrentTask9SourceParityNotCertified':True,
  'productionOrdersChanged':False,'HYPENewRulesAdopted':False
 }
 OUT.mkdir(parents=True,exist_ok=True)
 save(OUT/'HYPE_EXIT_AFTER_Q102V4_20261022.json',{'metadata':meta,'acceptedBenchmark':reference,'HYPEPricePaths':s['costs'],'cases':results})
 save(OUT/'HYPE_FOUR_CASES_REPLAY_SHA256_20261022.json',{'sourceSha256':meta['studyCodeSha256'],'files':proof,'identicalCount':len(proof)})
 lines=[
 '# HYPE LONG: protective initial loss and profit floors with V4/Q102 adopted rules fixed',
 '',
 '> Research only. No LIVE or Production alterations. V4 adopted 4, Q102 adopted 3 and HYPE75 existing entry parameters unchanged.',
 '',
 'Window: 2025-08-10 to 2026-08-10; initial capital JPY 10,000 compounded; zero contributions. Native 8-logic dynamic admission, pending/gross, 10bps vs 30bps.',
 '',
 '| Current HYPE trades from accepted baseline | 10bps | 30bps |',
 '|---|---:|---:|',
 f"| Trades | {s['costs']['10']['count']} | {s['costs']['30']['count']} |",
 f"| Wins / Losses | {s['costs']['10']['summary']['winners']['trades']} / {s['costs']['10']['summary']['losers']['trades']} | {s['costs']['30']['summary']['winners']['trades']} / {s['costs']['30']['summary']['losers']['trades']} |",
 f"| Net HYPE PnL JPY | {s['costs']['10']['summary']['all']['totalRealizedPnlJpy']:,.0f} | {s['costs']['30']['summary']['all']['totalRealizedPnlJpy']:,.0f} |",
 f"| Loser median MFE | +{s['costs']['10']['summary']['losers']['medianMFE']:.2f}% | +{s['costs']['30']['summary']['losers']['medianMFE']:.2f}% |",
 f"| Loser median MAE | -{s['costs']['10']['summary']['losers']['medianMAE']:.2f}% | -{s['costs']['30']['summary']['losers']['medianMAE']:.2f}% |",
 '',
 '## Five full8 economic tests',
 '',
 '| HYPE-only candidate | 10bps final JPY | DD 10bps | 30bps final JPY | DD 30bps | NEW HYPE exits 10/30bps |',
 '|---|---:|---:|---:|---:|---:|'
 ]
 for name,v in results.items():
  a,b=v['costs']['10'],v['costs']['30']
  lines.append(f"| {name} | {a['finalEquityJpy']:,.0f} | {a['maxMtmDdPct']:.5f}% | {b['finalEquityJpy']:,.0f} | {b['maxMtmDdPct']:.5f}% | {a['newHypeExitCount']}/{b['newHypeExitCount']} |")
 lines+=['',
 '## Source findings and decision',
 '',
 'Existing ATR-derived HYPE H1 TREND protective STOP and TAKE_PROFIT are retained. Historical reference records 28 STOP + 12 TP for 10bps and 25 STOP + 13 TP for 30bps. No HYPE LONG entry gates changed.',
 'A 0h 1.5% early adverse STOP was hit by a previous modeled TP winner and a previous STOP loser; changes of the dynamic 8-strategy allocator can reduce final wealth even when one loser is rescued.',
 'Extra profit STOP arms only on fully completed previous 5-minute candle CLOSE and executes with gap-aware conservative next-bar model fill. It is not a guaranteed realized floor.',
 'Historical tests are in-sample. Acceptance needs risk-first integrated economics, holdout, signed venue protective stop and latest Task9 independent source parity. No LIVE deployment or real orders made.',
 'All selected cooldown last-two iteration decision/trade/event/MTM/metric ledgers reproduced identically (50 SHA256 matches). Full raw portfolio artifacts remain on owner Windows research drive.'
 ]
 md=OUT/'HYPE_EXIT_AFTER_Q102V4_20261022.md'
 md.write_text('\n'.join(lines)+'\n',encoding='utf8',newline='\n')
 print('HYPE_REPORT_CREATED',len(results),'cases',md.name,'SHA_FILE_COUNT',len(proof))
 for name,v in results.items():
  a,b=v['costs']['10'],v['costs']['30']
  print('RESULT',name,'EQ',round(a['finalEquityJpy']),round(b['finalEquityJpy']),
   'DD',round(a['maxMtmDdPct'],5),round(b['maxMtmDdPct'],5),
   'EXITS',a['newHypeExitCount'],b['newHypeExitCount'],
   'BOTH_DD_PASS',v['bothCostsImproveDdBy0p1Pp'])
if __name__=='__main__':main()
