#!/usr/bin/env python3
"""Consolidate 5 further full8 Q102 time-exit/profit-loss interventions on adopted V4.
Requires all economic results (not a request to hide incomplete runs). No LIVE.
"""
import json,hashlib,math,collections
from pathlib import Path
REPO=Path(__file__).resolve().parents[2]
HERE=Path(__file__).resolve().parent
ROOT=Path(r'C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research')
FIXED=ROOT/'2026-10-21_v4_locked_next_q102_cumulative'/'v4-locked-q102-cumulative-results.json'
A=ROOT/'2026-10-22_q102_timeexit_risk_continued_after_v4'
B=ROOT/'2026-10-22_q102_timeexit_h1_confirmed_after_v4'
EX=ROOT/'2026-10-22_q102_timeexit_h1_path_screen'/'Q102_H1_CONFIRMED_TIME_EXIT_CAUSAL_SCREEN_20261022.json'
OUT=REPO/'docs/research/results/q102-timeexit-risk-continuation-20261022'
def load(f):return json.loads(f.read_text('utf8'))
def sha(p):return hashlib.sha256(p.read_bytes().replace(b'\r\n',b'\n')).hexdigest()
def save(p,d):p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n',encoding='utf8',newline='\n')
def main():
 old=load(FIXED)
 base=old['results']['V4_LOCKED']['costs']
 assert base['10']['accounting']=='PASS' and base['30']['accounting']=='PASS'
 assert math.isclose(base['10']['finalEquityJpy'],191750055.32685158,rel_tol=1e-12)
 assert math.isclose(base['30']['finalEquityJpy'],74740267.7840667,rel_tol=1e-12)
 screen=load(EX)
 assert screen['status']=='Q102_H1_2_CLOSED_CANDLE_TIME_EXIT_SIGNAL_SCREEN_NOT_PORTFOLIO_BT'
 assert screen['costs']['10']['count']==182 and screen['costs']['30']['count']==181
 evidence={}
 for family,side,h,pct in [('MR','SHORT',12,2.0),('HIGH_VOL','LONG',12,3.0)]:
  evidence[f'{family}/{side}@{h}h_{pct}%']={}
  for c in ('10','30'):
   xx=[r for r in screen['costs'][c]['cells'] if r['family']==family and r['side']==side and r['ageHours']==h and r['negativeClosedH1ThresholdPct']==pct]
   assert len(xx)==1
   evidence[f'{family}/{side}@{h}h_{pct}%'][c]=xx[0]
 cases={}
 for dirname,folder in [(A.name,A),(B.name,B)]:
  result=load(folder/'v4-locked-q102-cumulative-results.json')
  assert result['sourceArchiveSha256']==old['sourceArchiveSha256']
  assert result['frozenV4SourceHandoffSha']=='4081eb37fe23f884a4d1fa93e2b608e388bf7071'
  for k,v in result['results'].items():
   assert k not in cases and v['all4Locked']
   out={}
   for cost in ('10','30'):
    x=v['costs'][cost];o=base[cost]
    assert x['accounting']=='PASS'
    assert x['cooldownModel']=='ADMITTED_FILL_FIXED_POINT' and 2<=len(x['cooldownPasses'])<=5
    assert x['cooldownPasses'][-1]['observedAdmittedInitialShortStops']==x['cooldownPasses'][-1]['enforcedPriorCooldownEventCount']
    extra={label:n for label,n in x['exitReasons'].items() if label.startswith(('RESEARCH_Q102','RESEARCH_INITIAL_ADVERSE_STOP_Q102'))}
    out[cost]={'equityJpy':x['finalEquityJpy'],'mtmMaxDdPct':x['maxMtmDdPct'],
      'profitFactor':x['profitFactor'],'trades':x['closedTrades'],
      'extraQ102ExitLabels':extra,'extraQ102ExitCount':sum(extra.values()),
      'deltaEquityJpy':x['finalEquityJpy']-o['finalEquityJpy'],
      'ddImprovementPp':x['maxMtmDdPct']-o['maxMtmDdPct'],
      'q102Trades':x['q102TradeCount'],'acceptedV4ShortCooldowns':x['acceptedShortStopCooldownEvents'],
      'replayConverged':True,'accounting':'PASS'}
   cases[k]={'sourceFolder':dirname,'rule':v['rules'][-1],
    'costs':out,'v4FourRuleLocked':True,
    'noDdWorseningBothCosts':all(out[c]['ddImprovementPp']>=-1e-9 for c in ('10','30')),
    'strict0p1PpDdImprovementBothCosts':all(out[c]['ddImprovementPp']>=.1 for c in ('10','30')),
   }
 assert len(cases)==5,(len(cases),list(cases))
 source=['run-q102-timeexit-continued-after-v4-20261022.py',
   'run-q102-timeexit-two-confirmed-h1-after-v4-20261022.py',
   'analyze-q102-timeexit-h1-2close-research-20261022.py',
   'test-q102-h1-timeexit-after-v4-20261022.py',
   'build-q102-timeexit-continuation-report-20261022.py']
 meta={'status':'FIVE_FRESH_Q102_TIMEEXIT_AND_COMPOSITE_FULL8_RESEARCH_VERIFIED_NOT_LIVE',
 'V4AdoptedFourFixed':True,'lockedV4HandoffSha':'4081eb37fe23f884a4d1fa93e2b608e388bf7071',
 'priorQ102DeepResearchSha':'b9ee034d7d085647f146689475920223c53fb2f1',
 'priorBaselineLatestQ102Research':'2026-10-22_q102_entry_path_decomposition',
 'dateRange':'2025-08-10..2026-08-10','initialJpy':10000,'compounding':True,
 'noDeposits':True,'costsBps':[10,30],'sourceArchiveSha256':old['sourceArchiveSha256'],
 'sourceSha256':{name:sha(HERE/name) for name in source},
 'modelOnly':True,'noProductionChanges':True,'signedVenueCertified':False,
 'independentLatestTask9TSEconomicParity':False,
 'noNewQ102RulesAdopted':True}
 payload={'meta':meta,'baseline':{c:{key:base[c][key] for key in ('finalEquityJpy','maxMtmDdPct','profitFactor','closedTrades','accounting')} for c in ('10','30')},
 'H1CausalScreenByFamily':evidence,'cases':cases}
 OUT.mkdir(parents=True,exist_ok=True)
 save(OUT/'Q102_TIMEEXIT_CONTINUED_FIVE_CASES_20261022.json',payload)
 # static archived references, not runtime model continuation.
 save(OUT/'Q102_H1_CONFIRMED_TIME_EXIT_CAUSAL_SCREEN_20261022.json',screen)
 lines=[
 '# Q102 time-exit loss and profit protection — continuation after fixed V4 (2026-10-22)',
 '',
 '> Research only. V12 V4 LONG/SHORT all four accepted rules kept fixed. No current VPS/LIVE/venue modifications.',
 '',
 '## Source and comparison',
 '',
 'Historical interval 2025-08-10..2026-08-10, initial ¥10,000, no contributions, 8-strategy native dynamic admission, 10bps and stress 30bps; no signed venue evidence.',
 '',
 f"V4 frozen anchor: 10bps ¥{base['10']['finalEquityJpy']:,.0f}, DD {base['10']['maxMtmDdPct']:.5f}% PF {base['10']['profitFactor']:.4f}; 30bps ¥{base['30']['finalEquityJpy']:,.0f}, DD {base['30']['maxMtmDdPct']:.5f}% PF {base['30']['profitFactor']:.4f}.",
 '',
 'The already-existing Q102 +2% confirmed-M5-close -> +0.5% protective STOP remains unchanged.',
 '',
 '## Added 5 × 2 completed full8 causal dynamic portfolio BT cases',
 '',
 '| Variant | JPY 10bps | MaxDD 10bps | JPY 30bps | MaxDD 30bps | Additional Q102 exits 10/30 |',
 '|---|---:|---:|---:|---:|---|'
 ]
 for name,v in cases.items():
  a,b=v['costs']['10'],v['costs']['30']
  lines.append(f"| {name} | ¥{a['equityJpy']:,.0f} | {a['mtmMaxDdPct']:.5f}% | ¥{b['equityJpy']:,.0f} | {b['mtmMaxDdPct']:.5f}% | {a['extraQ102ExitCount']}/{b['extraQ102ExitCount']} |")
 lines+=['',
 '## Causal MR/HIGH_VOL H1 exit hypothesis (screen, not economics)',
 '',
 '| Family / Side | Confirmed H1 rule | 10bps previously losing TIME exits | 10bps originally winning trades also cut |',
 '|---|---|---:|---:|'
 ]
 for title,item in evidence.items():
  val=item['10']
  lines.append(f"| {val['family']} / {val['side']} | after {val['ageHours']}h; two completed UTC H1 closes each <= -{val['negativeClosedH1ThresholdPct']}% gain, no prior Q102 +2% confirmed 5m profit arm | {val['oldTimeExitLosers']} | {val['oldWinners']} |")
 lines+=['',
 '### Interpretation',
 '',
 '- These counts are **screen-only** uses of already-realized winner/loser labels to assess separability; no outcome labels enter actual proposed triggers. The full8 dynamic candidate reallocation results above determine economic merit.',
 '- Profit protection at Q102 +3% close -> +1% should NEVER replace +2% close -> +0.5% base stop: it must layer above and only ratchet protection monotonically. Gaps/spread and readback can realize below quote floor.',
 '- Any extra early Q102 exit changes shared gross and may worsen portfolio MTM DD even if all affected original Q102 trades were historical losers.',
 '- All tests retain V4 LONG37 -5% after +2%, LONG X3 +3% to +1% H1x2; V4 SHORT 12h initial +2.5% adverse and 12h same-symbol admitted-fill cooldown; SHORT TIME37 +5% to +2% H1x2.',
 '- Production signed-venue STOP readback, partial fills, duplicate-stop avoidance and latest independent TypeScript Task9 full8 parity are NOT certified. This repo contains no authorized current LIVE changes.',
 '- Research winner/loser thresholds were selected on historical data; independent post-selection holdout or forward shadow required before promotions.',
 '',
 '### Source artifact receipt',
 '',
 '- Historical already-adopted pinned V4 SHA 4081eb37fe23f884a4d1fa93e2b608e388bf7071.',
 '- Q102 original detailed nine-trial analysis SHA b9ee034d7d085647f146689475920223c53fb2f1.',
 '- Source code paths and SHA256 in accompanying machine-verifiable JSON. Full native historic ledger and M5 source archive remain on owner Windows PC; evidence coverage verified.',
 ]
 md=OUT/'Q102_TIMEEXIT_CONTINUED_FIVE_CASES_20261022.md'
 md.write_text('\n'.join(lines)+'\n',encoding='utf8',newline='\n')
 print('REPORT_COMPLETED',len(cases),'MD_BYTES',md.stat().st_size,'JSON_BYTES',(OUT/'Q102_TIMEEXIT_CONTINUED_FIVE_CASES_20261022.json').stat().st_size)
 for k,v in cases.items():
  a,b=v['costs']['10'],v['costs']['30']
  print('RESULT',k,'EQ',round(a['equityJpy']),round(b['equityJpy']),
   'DD',round(a['mtmMaxDdPct'],5),round(b['mtmMaxDdPct'],5),'MORE',a['extraQ102ExitCount'],b['extraQ102ExitCount'])
if __name__=='__main__':main()
