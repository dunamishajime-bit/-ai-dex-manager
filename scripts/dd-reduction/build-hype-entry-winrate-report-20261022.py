#!/usr/bin/env python3
"""Source+economic+causal provenance report for HYPE pre-entry filters (V4/Q102 frozen)."""
import hashlib,json,math,importlib.util,sys
from pathlib import Path
REPO=Path(__file__).resolve().parents[2]
HERE=Path(__file__).resolve().parent
ROOT=Path(r'C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research')
OUT=ROOT/'2026-10-22_hype_entry_winrate_after_v4_q102adopted3_full8'
SOURCE=ROOT/'2026-10-22_hype_entry_winrate_after_v4_q102'
DOC=REPO/'docs/research/results/hype-entry-winrate-after-v4-q102-20261022'
NAMES=['HYPE_BTC3H_LE0P6','HYPE_REL3H_GE3P0','HYPE_BTC3H_LE0P8_REL3H_GE2P0','HYPE_BTC3H_LE0P6_REL3H_GE2P0']
FILES=('candidate-decisions.jsonl','portfolio-trades.jsonl','portfolio-events.jsonl','task9-mtm.jsonl','metrics.json')
def read(f):return json.loads(f.read_text('utf8'))
def hashfile(f):return hashlib.sha256(f.read_bytes()).hexdigest()
def save(f,x):f.write_text(json.dumps(x,ensure_ascii=False,indent=2)+'\n',encoding='utf8',newline='\n')
def main():
 primary=read(OUT/'HYPE_WINRATE_PRIMARY_BTC0P6_REL2_20261022.json')
 alternatives=read(OUT/'HYPE_WINRATE_FULL8_INTEGRATED_20261022.json')
 screen=read(SOURCE/'HYPE_ENTRY_WINRATE_SCREEN_20261022.json')
 assert screen['status']=='TRAIN_HOLDOUT_CAUSAL_FEATURE_SCREEN_NOT_INTEGRATED_BT'
 assert set(primary['results'])=={'HYPE_BTC3H_LE0P6_REL3H_GE2P0'}
 assert set(alternatives['results'])==set(NAMES)-set(primary['results'])
 assert alternatives['acceptedV4FourAndQ102ThreeLocked'] and primary['acceptedV4FourAndQ102ThreeLocked']
 assert primary['sourceArchiveSha256']==alternatives['sourceArchiveSha256']
 assert primary['priorAcceptedBaseline']==alternatives['priorAcceptedBaseline']
 assert primary['productionOrOrdersChanged'] is False and alternatives['productionOrOrdersChanged'] is False
 spec=importlib.util.spec_from_file_location('hype_winrate_source',HERE/'run-hype-entry-winrate-after-v4-q102adopted3-20261022.py')
 mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
 source,_=mod.core.task8.legacy.bootstrap()
 baseline=primary['priorAcceptedBaseline']
 allitems=dict(alternatives['results']);allitems.update(primary['results'])
 proof=[];cases={}
 for name in NAMES:
  record=allitems[name];rule=record['policy']
  assert rule['id']==name and record['V4FourAndQ102ThreeExitsLocked']
  outcomes={}
  for cost in ('10','30'):
   row=record['costs'][cost];old=baseline[cost]
   assert row['accounting']=='PASS'
   assert len(row['cooldownPasses'])>=2
   assert row['cooldownPasses'][-1]['priorAdmittedCooldowns']==row['cooldownPasses'][-1]['observedAdmittedStops']
   assert row['cooldownPasses'][-1]['sourceMissing']==0
   trialpasses=row['cooldownPasses']
   ledgers=[]
   for ix in (trialpasses[-2]['iteration'],trialpasses[-1]['iteration']):
    key=f'HYPE_WINRATE_{name}_C{cost}_I{ix}'
    digest=hashlib.sha256(key.encode()).hexdigest()[:12]
    ledgers.append(OUT/'engine'/f'cmp_{digest}'/f'cmp_{digest}'/f'{cost}bps/cases/V2_M150_D05_CORE_NATIVE/runs'/f'PRICE_MODEL_{cost}BPS')
   for filename in FILES:
    pair=[loc/filename for loc in ledgers]
    assert all(f.is_file() for f in pair),(name,cost,filename)
    sig=[hashfile(f) for f in pair]
    assert sig[0]==sig[1],('COOLDOWN_REPLAY_DIVERGENCE',name,cost,filename)
    proof.append({'policy':name,'costBps':int(cost),'file':filename,'sha256':sig[1],'identicalLastTwoCooldownPasses':True})
   trades=[json.loads(t) for t in (ledgers[-1]/'portfolio-trades.jsonl').read_text('utf8').splitlines() if t.strip()]
   hype=[r for r in trades if r['strategy_id']=='HYPE_LONG']
   for r in hype:
    feat=mod.pre_entry_features(source,int(r['entry_ts_ms']))
    assert feat is not None,('MISSING_PRE_ENTRY',r['candidate_id'])
    if 'btc3hMaxPct' in rule: assert feat['BTC3hPct']<=rule['btc3hMaxPct']+1e-10,('BTC_GATE_MISMATCH',name,r['candidate_id'],feat)
    if 'hypeMinusBtc3hMinPct' in rule: assert feat['REL3hPct']>=rule['hypeMinusBtc3hMinPct']-1e-10,('REL_GATE_MISMATCH',name,r['candidate_id'],feat)
   assert len(hype)==row['hypeAcceptedTrades']
   assert sum(t['modeled_realized_pnl_jpy_at_exit_fx']>0 for t in hype)==row['hypeWins']
   assert math.isclose(row['equityVsSevenAdoptedJpy'],row['finalEquityJpy']-old['finalEquityJpy'],abs_tol=1e-6)
   assert math.isclose(row['ddVsSevenAdoptedPp'],row['maxMtmDdPct']-old['maxMtmDdPct'],abs_tol=1e-9)
   outcomes[cost]={k:row[k] for k in ('hypeAcceptedTrades','hypeWins','hypeLosses','hypeWinRatePct','hypeRealizedPnlJpy','finalEquityJpy','maxMtmDdPct','profitFactor','closedTrades','equityVsSevenAdoptedJpy','ddVsSevenAdoptedPp','accounting')}
  cases[name]={'policy':rule,'costs':outcomes,'preservesAllSevenAdoptedExitRules':True}
 assert len(proof)==len(NAMES)*2*len(FILES)
 metadata={'status':'HYPE_WINRATE_CAUSAL_H1_ENTRY_4POLICY_FULL8_ECONOMIC_MODEL_VERIFIED_RESEARCH_ONLY',
 'date':'2026-10-22','window':'2025-08-10 to 2026-08-10',
 'startJpy':10000,'noDeposits':True,'costsBps':[10,30],
 'method':'Pre-entry completed M5 BTC and HYPE close returns over last 3h; relative BTC percentage points; only HYPE candidate vetos, before native chronological allocator',
 'V4FourAndQ102ThreeUserAdoptedRetained':True,'HYPEExistingStopsAndEntryBaseGatesRetained':True,
 'ownerPCArchiveSha256':primary['sourceArchiveSha256'],
 'sourceSha256':{name:hashlib.sha256((HERE/name).read_bytes().replace(b'\r\n',b'\n')).hexdigest()
   for name in ('analyze-hype-entry-winrate-after-q102v4-20261022.py','run-hype-entry-winrate-after-v4-q102adopted3-20261022.py','test-hype-entry-winrate-preallocation-20261022.py','build-hype-entry-winrate-report-20261022.py')},
 'HYPEGateAuditedAllNewAdmittedNativeTrades':True,
 'subgroupScreenIsNotAnIntegratedBacktest':True,'screenTrainHoldoutNotUntouchedForPostSelection':True,
 'independentFutureUnseenHoldoutRequired':True,
 'currentLIVEAndVenueStopAuthenticationNotVerified':True,'latestTask9IndependentTSFull8ParityNotVerified':True,
 'productionOrdersChanged':False,'noNewHYPEEntrypolicyFormallyAdoptedYet':True}
 DOC.mkdir(parents=True,exist_ok=True)
 save(DOC/'HYPE_ENTRY_WINRATE_V4_Q102_20261022.json',{'metadata':metadata,'baselineSevenUserAdopted':baseline,'screen':screen['costs'],'cases':cases})
 save(DOC/'HYPE_WINRATE_FULL8_40_LEDGER_SHA256_PROOF_20261022.json',{'proof':proof,'filesExact':len(proof)})
 lines=['# HYPE entry win-rate improvement — fixed V12 V4 + Q102 (2026-10-22)','',
 '> RESEARCH only. Seven already user-adopted exit improvements (V4 four, Q102 three) kept unchanged, no Production or venue changes.',
 '',
 'Historical 2025-08-10..2026-08-10; JPY10k compounded, zero deposits; 10bps and 30bps; eight-logic chronological dynamic allocator.',
 '',
 'HYPE original 10bps 12 wins / 40 = 30%; 30bps 13 wins / 38 = 34.2%. The five exit-protection variants were inferior; focus on avoiding weak entries.',
 '',
 '## Pre-entry causal technical features',
 '',
 'BTC3h% = (most recent fully COMPLETED M5 BTC close / its close 3h earlier - 1) ×100.',
 'HYPE3h% same definition; relative3h% = HYPE3h% minus BTC3h% in *percentage points*.',
 'No current incomplete M5/H1 candle; HYPE candidates vetoed only before actual historical allocation, so other symbols can be reselected.',
 'Unseen 2026-08 onward prices are NOT covered; the chronological 70/30 screen was inspected during selection and therefore NOT a fresh out-of-sample certification.',
 '',
 '## Integrated 8-logic economics versus accepted-seven baseline',
 '',
 '| HYPE entry filter | HYPE W/N 10bps | JPY 10bps | DD 10bps | HYPE W/N 30bps | JPY 30bps | DD 30bps |',
 '|---|---:|---:|---:|---:|---:|---:|']
 for name,record in cases.items():
  a,b=record['costs']['10'],record['costs']['30']
  lines.append(f"| {name} | {a['hypeWins']}/{a['hypeAcceptedTrades']} ({a['hypeWinRatePct']:.1f}%) | ¥{a['finalEquityJpy']:,.0f} | {a['maxMtmDdPct']:.5f}% | {b['hypeWins']}/{b['hypeAcceptedTrades']} ({b['hypeWinRatePct']:.1f}%) | ¥{b['finalEquityJpy']:,.0f} | {b['maxMtmDdPct']:.5f}% |")
 lines+=['',
 f"Original seven-adopted baseline: 10bps ¥{baseline['10']['finalEquityJpy']:,.0f}, DD {baseline['10']['maxMtmDdPct']:.5f}%; 30bps ¥{baseline['30']['finalEquityJpy']:,.0f}, DD {baseline['30']['maxMtmDdPct']:.5f}%.",
 '',
 '## Validations & interpretation',
 '',
 '- All modeled CLOSED HYPE trades under each gate have the exact causal pre-entry BTC/HYPE 3h feature signature. No winner/loser label enters decisions.',
 '- Test code asserts completed M5 no-lookahead, fail-closed missing window, unchanged other strategies.',
 '- Accepted V4 SHORT same-symbol admitted-STOP cooldown replays converge. Last two 8-logic candidate decisions, trades, events, MTM and metrics ledgers: 40/40 SHA256 match.',
 '- WARNING: In raw experimental diagnostics, candidateHypePassed/Blocked sets deduplicate unassigned proposal candidate_id=null and are NOT reliable unique veto counts. Audited accepted fills/returns, not these counters, are the source of truth.',
 '- 30bps stress DD can deteriorate slightly even when normal 10bps DD unchanged. Portfolio DD is an absolute risk preference.',
 '- HYPE subset n~15–25: a high in-sample win rate does not imply future 70% probability. Independent forward shadow or unused prospective series required before making LIVE changes.',
 '- Runtime implementation needs actual current HYPE75 signal source and matched venue-certified Order/STOP manager, not just historical regression.',
 '',
 'Raw historical native engine outputs remain on owner PC; this commit includes research script, validation, hashed receipts and human summary.'
 ]
 (DOC/'HYPE_ENTRY_WINRATE_V4_Q102_20261022.md').write_text('\n'.join(lines)+'\n',encoding='utf8',newline='\n')
 print('HYPE_WINRATE_REPORT_PASS_CASES',len(cases),'SHA256_LAST_TWO',len(proof))
 for name,rec in cases.items():
  a,b=rec['costs']['10'],rec['costs']['30']
  print('RESULT',name,'10',f"{a['hypeWins']}/{a['hypeAcceptedTrades']}",round(a['finalEquityJpy']),round(a['maxMtmDdPct'],5),
    '30',f"{b['hypeWins']}/{b['hypeAcceptedTrades']}",round(b['finalEquityJpy']),round(b['maxMtmDdPct'],5),flush=True)
if __name__=='__main__':main()
