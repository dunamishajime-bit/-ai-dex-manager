#!/usr/bin/env python3
"""Build source-backed V4-locked Q102 path-risk report after 9 native model trials."""
import json,collections,hashlib,math
from pathlib import Path
HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
ROOT=Path(r'C:\Users\dis\Desktop\DisDex_AI_Files\01_BT_Research')
OUT=REPO/'docs/research/results/q102-profit-initial-risk-after-v4-20261022'
BT=ROOT/'2026-10-21_v4_locked_next_q102_cumulative'
PX=ROOT/'2026-10-22_q102_entry_path_decomposition'
SETS=['2026-10-22_q102_path_prioritized_after_v4','2026-10-22_q102_prearm_family_exits_after_v4','2026-10-22_q102_focused_family_after_v4','2026-10-22_q102_combined_profit_initial_after_v4']
def load(f):return json.loads(f.read_text('utf8'))
def save(f,d):f.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n',encoding='utf8',newline='\n')
def main():
 origin=load(BT/'v4-locked-q102-cumulative-results.json')
 base=origin['results']['V4_LOCKED']['costs']
 price=load(PX/'Q102_M5_FAMILY_SIDE_PATH_SUMMARY_20261022.json')
 assert price['data']['10']['coverageCounts']=={'OK':182}
 assert price['data']['30']['coverageCounts']=={'OK':181}
 prearm=load(PX/'Q102_PREARM_INITIAL_ADVERSE_GRID_20261022.json')
 cases={}
 for name in SETS:
  d=load(ROOT/name/'v4-locked-q102-cumulative-results.json')
  assert d['sourceArchiveSha256']==origin['sourceArchiveSha256']
  assert d['frozenV4SourceHandoffSha']=='4081eb37fe23f884a4d1fa93e2b608e388bf7071'
  for candidate,x in d['results'].items():
   assert candidate not in cases
   assert x['all4Locked'] is True
   record={}
   for cost in ('10','30'):
    a=x['costs'][cost];b=base[cost]
    assert a['accounting']=='PASS'
    assert a['cooldownModel']=='ADMITTED_FILL_FIXED_POINT'
    assert 2<=len(a['cooldownPasses'])<=5
    assert a['cooldownPasses'][-1]['observedAdmittedInitialShortStops']==a['cooldownPasses'][-1]['enforcedPriorCooldownEventCount']
    ex={k:v for k,v in a['exitReasons'].items() if k.startswith(('RESEARCH_Q102_','RESEARCH_INITIAL_ADVERSE_STOP_Q102_'))}
    record[cost]={
     'finalEquityJpy':a['finalEquityJpy'],'maxMtmDdPct':a['maxMtmDdPct'],
     'profitFactor':a['profitFactor'],'closedTrades':a['closedTrades'],
     'q102Trades':a['q102TradeCount'],'newQ102Exits':sum(ex.values()),
     'reasonMarkers':ex,'equityDeltaJpy':a['finalEquityJpy']-b['finalEquityJpy'],
     'ddImprovementPp':a['maxMtmDdPct']-b['maxMtmDdPct'],
     'shortAcceptedStopCooldownEvents':a['acceptedShortStopCooldownEvents'],
     'accounting':'PASS'
    }
   cases[candidate]={'policy':x['rules'][-1],'costs':record,'allFourV4RulesFixed':True}
 assert len(cases)==9,(len(cases),list(cases))
 exb={}
 for cost in (10,30):
  ls=sorted([x for x in BT.rglob('portfolio-trades.jsonl') if x.parent.name==f'PRICE_MODEL_{cost}BPS'],key=lambda x:x.stat().st_mtime)
  assert len(ls)==3
  rows=[json.loads(s) for s in ls[-1].read_text('utf8').splitlines() if s.strip()]
  q=[x for x in rows if x.get('strategy_id')=='Q102']
  reasons=collections.defaultdict(lambda:{'count':0,'wins':0,'losses':0,'grossWinJpy':0.,'grossLossJpy':0.})
  for x in q:
   pnl=float(x['modeled_realized_pnl_jpy_at_exit_fx'])
   a=reasons[str(x['exit_reason_actual'])]
   a['count']+=1;a['wins']+=pnl>0;a['losses']+=pnl<0;a['grossWinJpy']+=max(0,pnl);a['grossLossJpy']+=min(0,pnl)
  assert len(q)==price['data'][str(cost)]['total']
  exb[str(cost)]=dict(reasons)
 assert exb['10']['5M_PROTECTIVE_STOP']['count']==70
 assert exb['10']['Q102_HARD_STOP']['losses']==10
 sources=[
 'analyze-q102-entry-paths-after-v4-20261022.py',
 'analyze-q102-prearm-stop-sensitivity-20261022.py',
 'run-q102-path-prioritized-after-v4-20261022.py',
 'run-q102-prearm-family-exits-after-v4-20261022.py',
 'run-q102-focused-family-guard-after-v4-20261022.py',
 'run-q102-combined-risk-and-profit-after-v4-20261022.py',
 ]
 method={
 'status':'Q102_DEEP_FULL8_9_CANDIDATES_RESEARCH_COMPLETE_NOT_LIVE',
 'V4FixedSourceSha':'febb75a511f7be02a40e67ae6c426b0d24feaafb',
 'V4OriginalHandoffSha':'4081eb37fe23f884a4d1fa93e2b608e388bf7071',
 'period':'2025-08-10 to 2026-08-10','initialJpy':10000,'costBps':[10,30],
 'sourceArchiveSha256':origin['sourceArchiveSha256'],
 'sourceScripts':{n:hashlib.sha256((HERE/n).read_bytes().replace(b'\r\n',b'\n')).hexdigest() for n in sources},
 'priceCoverage5mQ102':{'10':price['data']['10']['coverageCounts'],'30':price['data']['30']['coverageCounts']},
 'researchOnly':True,'currentTask9IndependentTSParity':False,
 'signedExchangeOrdersReadback':False,'productionModified':False,
 'Q102NewRulesAdopted':False,
 'legacyResearchProfitExitMarker':'Tiered profit guards emit generic ARM2_FLOOR0P5 label; overlay policy gives real threshold, correct before LIVE implementation'
 }
 OUT.mkdir(parents=True,exist_ok=True)
 save(OUT/'Q102_PROFIT_INITIAL_RISK_AFTER_V4_20261022.json',{'method':method,'baseline':base,'existingQ102ExitReasons':exb,'cases':cases,'lossGroups10bps':price['data']['10']['grouped']})
 save(OUT/'Q102_M5_FAMILY_SIDE_PATH_SUMMARY_20261022.json',price)
 save(OUT/'Q102_PREARM_INITIAL_ADVERSE_GRID_20261022.json',prearm)
 lines=[
 '# Q102 profit protection and initial-adverse losses (2026-10-22)',
 '',
 'Research only; V4 4 approved rules frozen for ALL tests. No LIVE / Production / venue order changes.',
 '',
 'Sample: 2025-08-10 through 2026-08-10, initial JPY 10,000, no deposits, eight-logic native chronological allocator, 10bps real-like and 30bps stress.',
 '',
 '| V4 fixed baseline | 10bps | 30bps |',
 '|---|---:|---:|',
 f"| Final equity JPY | {base['10']['finalEquityJpy']:,.0f} | {base['30']['finalEquityJpy']:,.0f} |",
 f"| MTM max DD | {base['10']['maxMtmDdPct']:.4f}% | {base['30']['maxMtmDdPct']:.4f}% |",
 f"| PF | {base['10']['profitFactor']:.4f} | {base['30']['profitFactor']:.4f} |",
 '',
 '## Existing Q102 exit reasons in the accepted 10bps ledger',
 '',
 '| Reason | trades | winners | losers | Loss sum JPY |',
 '|---|---:|---:|---:|---:|',
 ]
 for k,v in sorted(exb['10'].items(),key=lambda item:-item[1]['count']):
  lines.append(f"| {k} | {v['count']} | {v['wins']} | {v['losses']} | {v['grossLossJpy']:,.0f} |")
 lines+=['',
 'Existing +2% CONFIRMED M5 close -> +0.5% entry-relative protective STOP already appeared in the research baseline and 70 accepted 5M_PROTECTIVE_STOP exits, all wins. Re-applying it as a new overlay is not an incremental improvement.',
 '',
 'Q102_TIME_EXIT includes 30 losing trades totaling about -9.90m JPY (10bps) and 57 winners. HIGH_VOL_TRAIL72 large 72h adverse excursions warrant pre-profit-arm risk caps; live venue stop behavior remains unverified.',
 '',
 '## Q102 loss path by Family/Side (10bps, no data gaps across 182 accepted Q102 5m paths)',
 '',
 '| Family / Side | Trades | Losses | Total loser JPY | median loser MFE | median loser MAE |',
 '|---|---:|---:|---:|---:|---:|',
 ]
 for key,x in sorted(price['data']['10']['grouped'].items(),key=lambda k:k[1]['losers']['oldPnlJpySum']):
  l=x['losers']
  lines.append(f"| {key} | {x['all']['n']} | {l['n']} | {l['oldPnlJpySum']:,.0f} | {l['medianMfePct']:.2f}% | {l['medianMaePct']:.2f}% |")
 lines+=['',
 '## Full 8-logic economics with frozen V4 (original accepted Short 12h cooldown recalculated to fixed point)',
 '',
 '| Candidate | Final JPY 10bps | DD 10bps | Final JPY 30bps | DD 30bps | New Q102 exits (10/30bps) |',
 '|---|---:|---:|---:|---:|---:|'
 ]
 for name,v in cases.items():
  a=v['costs']['10'];b=v['costs']['30']
  lines.append(f"| {name} | {a['finalEquityJpy']:,.0f} | {a['maxMtmDdPct']:.4f}% | {b['finalEquityJpy']:,.0f} | {b['maxMtmDdPct']:.4f}% | {a['newQ102Exits']}/{b['newQ102Exits']} |")
 lines+=['',
 '## Most promising two-axis candidate, not yet formally adopted',
 '',
 '- Keep existing Q102 confirmed M5 close +2% -> resident-like entry +0.5% profit protection.',
 '- Research addition 1: PB LONG ONLY, after 3h and prior peak favorable movement below +0.5%, adverse movement reaches -1.5% => early reduce-only exit candidate.',
 '- Research addition 2: after a confirmed M5 close reaches +3% favorable gain, upgrade desired resident-like protection from entry +0.5% to entry +1% for Q102, with safe readback before retiring the prior stop.',
 '- Combined historical 10bps JPY 195,323,811 / DD -14.3599% versus V4 fixed baseline JPY 191,750,055 / DD -14.6033%.',
 '- Combined historical 30bps JPY 79,716,312 / DD -15.8230% versus V4 fixed baseline JPY 74,740,268 / DD -15.7782%.',
 '- Both costs compound ending equity increases; 10bps DD improves +0.2434pp. Stress 30bps DD worsens -0.0449pp, so this FAILS strict dual-cost DD improvement. Do not quietly authorize LIVE.',
 '- Family-scoped HIGH_VOL SHORT +3% -> +1% profit upgrade is a conservative alternate: both costs equity increase and 30bps DD improves slightly, while 10bps DD is unchanged.',
 '- PB-only -1.5% after3h is also a worthwhile small-sample candidate: original 2 losses early, no original winners caught, but portfolio DD unchanged. Requires unused holdout/forward validation.',
 '- MR SHORT -4% after3h, HIGH_VOL LONG -3% after3h, and the whole six-family prearm bundle do NOT improve the integrated DD; reject regardless of isolated losers rescued.',
 '',
 '## Interpretation and safety',
 '',
 '- Per-accepted-trade loser/winner selection alone is misleading: early exits free gross, trigger different downstream trade admissions and may WORSEN whole-portfolio MTM DD.',
 '- Q102 current +2% close arm / +0.5% stop is a resident-like 5m price-model condition, not proof the feature is enabled or authenticated on the real Production venue.',
 '- Supplemental +3% close -> +1% and +5% close -> +2% are staged upgrades to the existing +0.5% floor, not replacements of the resident initial protection. Actual fill can slip below floor.',
 '- MR SHORT, HIGH_VOL LONG and PB LONG initial early-stop gates are family- and side-specific research choices. Single-trade samples, especially six annual HIGH_VOL LONG positions, are too small for a production rule without independent untouched holdout/forward shadow.',
 '- The current model records upgraded Q102 stepped exits with a generic ARM2_FLOOR0P5 research label; use the case policy metadata to identify real stage. Rename and recertify venue/exit ledgers before actual implementation.',
 '- No new Q102 option is adopted from these tests. V4 adopted four conditions remain immutable. Independent current Task9 TypeScript economic parity and signed-exchange STOP lifecycle still unproved.',
 '',
 'Reproducible scripts in scripts/dd-reduction (source hashes in JSON). Local PC contains full decisions, trades, events and MTM ledgers. GitHub stores compact reproducible source and summaries.',
 ]
 md=OUT/'Q102_PROFIT_INITIAL_RISK_AFTER_V4_20261022.md'
 md.write_text('\n'.join(lines)+'\n',encoding='utf8',newline='\n')
 print('BUILT',len(cases),'CASE_PAIRS',md.stat().st_size,flush=True)
 for k,x in cases.items():
  a,b=x['costs']['10'],x['costs']['30']
  print('RESULT',k,round(a['finalEquityJpy']),round(a['maxMtmDdPct'],5),round(b['finalEquityJpy']),round(b['maxMtmDdPct'],5),flush=True)
if __name__=='__main__':main()
