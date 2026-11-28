"""Reconcile genuine 24-case native R21 synthetic DD30 reserve studies.

Read-only, exact SHA-pinned *archived* owner-PC result and Python source files.
No price imputation, fake native seven-runner execution, certificates or orders.
"""
from __future__ import annotations
from collections import Counter
from hashlib import sha256
import json
from pathlib import Path
import statistics
import sys

DATA={
  'baseline':('Y06_R21_NATIVE_SYNTH_DD30_V2_RESULTS_20261127.json','636e941daf9596e7e0e0246306f2f59625a26190e5612adae8132962a281e068'),
  'headroom':('Y06_R21_RISK_HEADROOM_RESULTS_20261127.json','5abb14f0736fc3f99f8a88aaf680a7b4c9a4f95d956eeafc7cf2c811e0dbf8e4'),
  'baselineSource':('y06_r21_native_synthetic_dd30_v2_20261127.py','f39d036c612921a8e4e3b3358ea49c75cca0e53f8bb45f9fbb5789cfe3a94dbe'),
  'headroomSource':('y06_r21_risk_headroom_20261127.py','1692beb87de4d67578e4ca47af86845637c04fb29154c6053a4c76b4535ba232'),
}
SLEEVES={
 'DD30_NEW_ENTRY_LATCH_ONLY':('baseline','R21'),
 'STOP8_LOSS_HEADROOM':('headroom','R21_STOP8_RESERVE'),
 'STOP8_PLUS_2PCT_GAP_HEADROOM':('headroom','R21_STOP8_GAP2_RESERVE'),
}
REGIMES={'BULL','BULL_PULLBACK','BEAR','RANGE','SQUEEZE','REVERSAL'}
SEEDS={202611272401,202611272402,202611272403,202611272404}


def audit(private:Path)->dict:
    if private.name!='disdex-d126-crossrunner-research-20261126' or not private.is_dir() or private.is_symlink():
        raise ValueError('ONLY_ORIGINAL_OWNER_PC_R21_ARCHIVE_ACCEPTED')
    blobs={};data={}
    for key,(filename,pin) in DATA.items():
        file=private/filename
        if not file.is_file() or file.is_symlink():raise ValueError('SOURCE_R21_RESEARCH_FILE_MISSING:'+filename)
        buf=file.read_bytes()
        if sha256(buf).hexdigest()!=pin:raise ValueError('SOURCE_R21_SHA_CHANGED:'+filename)
        blobs[key]=buf
        if key in ('baseline','headroom'):data[key]=json.loads(buf)
    for name,doc in data.items():
        if (doc.get('protocol',{}).get('status')!='RESEARCH_ONLY_SYNTHETIC_STANDALONE_R21_NOT_FULL_RUNNER'
          or len(doc.get('records',[]))!=24 or set(doc['protocol']['regimes'])!=REGIMES or set(doc['protocol']['seeds'])!=SEEDS):
            raise ValueError('SOURCE_R21_SYNTHETIC_SCOPE_OR_24_CASE_COUNT_CHANGED:'+name)
        pairs={(x['regime'],x['seed']) for x in doc['records']}
        if len(pairs)!=24 or pairs!={(reg,seed) for reg in REGIMES for seed in SEEDS}:
            raise ValueError('SOURCE_R21_STRESS_SEEDS_OR_REGIMES_MISMATCH')
        if doc['protocol']['source_sha256']!='e2b0a7f63021af4a2b53c58910e9915971e9490c7a0350d557e08a0a8ed03130':
            raise ValueError('R21_SOURCE_NATIVE_ENGINE_CHANGING_UNAPPROVED')
    keyed={k:{(r['regime'],r['seed']):r for r in doc['records']} for k,doc in data.items()}
    candidates=[]
    for regime in sorted(REGIMES):
        for seed in sorted(SEEDS):
            b=keyed['baseline'][(regime,seed)]
            h=keyed['headroom'][(regime,seed)]
            if any(b[k]!=h[k] for k in ('old_candidates','r21_old_candidates','new_candidates')):
                raise ValueError('SYNTHETIC_24_CASE_SAME_CANDIDATES_NOT_INVARIANT')
            candidates.append({'regime':regime,'seed':seed,'sameRawEntrySignalsAcrossArms':True,
                'oldCandidates':b['old_candidates'],'r21OldCandidates':b['r21_old_candidates'],
                'r21NewCandidates':b['new_candidates']})
    summaries={};rows=[]
    for family,(name,arm) in SLEEVES.items():
        for bps in (10,30):
            cases=[]
            for regime in sorted(REGIMES):
                for seed in sorted(SEEDS):
                    original=keyed[name][(regime,seed)]
                    if arm not in original['results'] or str(bps) not in original['results'][arm]:
                        raise ValueError('R21_STRESS_ARM_UNAVAILABLE')
                    r=original['results'][arm][str(bps)]
                    if not (0<=r['wins']<=r['n']<=200 and 0<=r['max_dd_pct']<=100 and r['terminal_jpy']>0):
                        raise ValueError('R21_INVALID_STRESS_RESULT')
                    if r['win_pct'] is not None and abs(r['win_pct']-100*r['wins']/r['n'])>1e-7:
                        raise ValueError('R21_STRESS_WIN_RATE_DENOMINATOR_INVALID')
                    if any(not isinstance(v,int) or v<0 for v in r['blocked'].values()):
                        raise ValueError('R21_INVALID_ENTRY_BLOCK_COUNTS')
                    cases.append(r)
                    rows.append({'regime':regime,'seed':seed,'arm':family,'bps':bps,
                        'endEquityJPY':round(r['terminal_jpy'],6),
                        'maximumDdPct':round(r['max_dd_pct'],6),'trades':r['n'],
                        'wins':r['wins'],'blockedByDdOrProjectedStop':
                        r['blocked'].get('CUMULATIVE_DD30_LATCHED',0)+r['blocked'].get('PROJECTED_STOP_RISK_DD30',0)})
            n=sum(r['n'] for r in cases)
            wins=sum(r['wins'] for r in cases)
            if n==0:raise ValueError('R21_STRESS_MODEL_HAS_NO_TRADES')
            key=f'{family}/{bps}bps'
            worst=max(r['max_dd_pct'] for r in cases)
            summaries[key]={
                'caseCount':24,'maxDdPct':round(worst,6),
                'all24CasesMaxDDAtOrUnder30':worst<=30,
                'averageFinalJPY':round(statistics.mean(r['terminal_jpy'] for r in cases),6),
                'worstFinalJPY':round(min(r['terminal_jpy'] for r in cases),6),
                'modeledTrades':n,'modeledWins':wins,'modeledWinRatePct':round(100*wins/n,6),
                'modeledWinRateMeets70PctObjective':wins/n>=.70,
                'ddOrProjectedStopNewEntryBlocks':sum(
                    r['blocked'].get('CUMULATIVE_DD30_LATCHED',0)+r['blocked'].get('PROJECTED_STOP_RISK_DD30',0) for r in cases),
            }
    checks={
        'r21StopGap2Pct30bpsSyntheticMaxDDUnder30':summaries['STOP8_PLUS_2PCT_GAP_HEADROOM/30bps']['all24CasesMaxDDAtOrUnder30'],
        'r21StopGap2Pct10bpsSyntheticMaxDDUnder30':summaries['STOP8_PLUS_2PCT_GAP_HEADROOM/10bps']['all24CasesMaxDDAtOrUnder30'],
        'r21StopGap2Pct30bpsWin70':summaries['STOP8_PLUS_2PCT_GAP_HEADROOM/30bps']['modeledWinRateMeets70PctObjective'],
        'oldDdLatchOnly30bpsBreaches30':not summaries['DD30_NEW_ENTRY_LATCH_ONLY/30bps']['all24CasesMaxDDAtOrUnder30'],
        'r21FullSevenRunnerAnnualNativeSourceValidated':False,
        'r21LiveStopProtectiveOrderAttested':False,
    }
    if checks!={
        'r21StopGap2Pct30bpsSyntheticMaxDDUnder30':True,
        'r21StopGap2Pct10bpsSyntheticMaxDDUnder30':True,
        'r21StopGap2Pct30bpsWin70':False,
        'oldDdLatchOnly30bpsBreaches30':True,
        'r21FullSevenRunnerAnnualNativeSourceValidated':False,
        'r21LiveStopProtectiveOrderAttested':False,
    }:raise ValueError('ACTUAL_R21_RISK_TRADEOFF_DIFFERENT_THAN_EXPECTED')
    return {'schema':'stable4-r21-24case-real-synthetic-projective-stop-loss-headroom-audit/v1',
        'status':'R21_ONLY_24_SYNTH_CASES_STOP8_GAP2_IMPROVES_DD_NOT_APPROVED',
        'sourceFilesSha256':{name:pin for name,(f,pin) in DATA.items()},
        'baselineNativeEngineSha256':'e2b0a7f63021af4a2b53c58910e9915971e9490c7a0350d557e08a0a8ed03130',
        'startCapitalJPY':10000,'regimes':sorted(REGIMES),'seeds':sorted(SEEDS),
        'roundTripCostBpsModels':[10,30],'perCaseSignalInvariance':candidates,
        'summary':summaries,'cases':rows,'checks':checks,
        'oldPortfolioDDStopAt30PercentDoesNotGuaranteeRealizedDDAt30':True,
        'livePositionGrossOrExitChanged':False,'sourceNativeSevenRunnerSyntheticCompleted':False,
        'realVenueExecutionProven':False,'productionEligible':False,'orderAuthority':False,
        'limitations':[
            'These are 24 fixed-seed historical real R21 signal-generation artificial markets; R21-only 1-slot STOP8 (H24/H48 TP8) with assumed open-to-close M5 prices, NOT multi-runner portfolio or actual filled orders.',
            '2% gap beyond stop and round-trip 10/30bps are ASSUMPTIONS, not a maximum real tail-gap or signed exchange STOP fill. Even 24/24 within DD30 does NOT guarantee any future maximum drawdown.',
            'A stronger pre-entry reserve lowered worst DD but did NOT achieve 70% win objective and did not prove profitable source-alpha. Gross/account state must be proven from all seven native runners.',
            'Upstream archived source and results remain in owner PC read-only with SHA pins; this derived summary is an immutable research checkpoint. No live adoption, backtest fabrication, source production SHA repin, test orders or owner certificates.',
        ]}

if __name__=='__main__':
    if len(sys.argv)!=3:raise ValueError('OWNER_ARCHIVED_RESEARCH_ROOT NEW_OUTPUT_PATH_REQUIRED')
    r=audit(Path(sys.argv[1]))
    with open(sys.argv[2],'x',encoding='utf8',newline='\n') as f:json.dump(r,f,sort_keys=True,indent=2);f.write('\n')
    print('R21_HEADROOM_RECONCILED',json.dumps(r['summary'],sort_keys=True),flush=True)
