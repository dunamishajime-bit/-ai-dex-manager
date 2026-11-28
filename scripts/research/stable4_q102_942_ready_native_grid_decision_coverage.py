"""Deterministic 942-clock Q102 source-ready native-grid provenance audit.

Full 20-symbol native selector was run for every clock having a raw HIGH_VOL
or S34 candidate (96/942); 846 raw empty clocks were native-generator screened,
NOT full-selector invoked. Never elevate to annual/native portfolio certification.
"""
from __future__ import annotations
from collections import Counter
from hashlib import sha256
import json
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[2]
H=3_600_000
START=1759276800000
END=1790812800000
SOURCES={
 'full':('STABLE4_Q102_FULL_UNIVERSE_ALL_READY_CLOCK_SCREEN_20261128.json','8bcaa800393b4cd920c3524f0ba242bc482c54fa05564ed4c8b53276a49864f0'),
 'cross':('STABLE4_Q102_FULL_SOURCE_S34_CROSS_PARITY_20261128.json','bbb086306e9e1293bb0035e607adb73c179566baf3acc60d6c0ad705d6b6f4e9'),
}
CATEGORIES={
 'NATIVE_S34_ENTRY_EXACT_RANK':'FULL_NATIVE_SELECTED_S34_SOURCE_ONLY',
 'NATIVE_S34_REV_GATE_EXACT_NO_BACKFILL':'FULL_NATIVE_REJECTED_REV_LONG_SOURCE_ONLY',
 'NATIVE_HIGH_VOL_PRIORITY_SEPARATE':'FULL_NATIVE_SELECTED_HIGH_VOL_SOURCE_ONLY',
 'NATIVE_NO_SIGNAL_SEPARATE':'FULL_NATIVE_NO_SIGNAL_AFTER_RAW_MATCH_SOURCE_ONLY',
}


def read():
    d={}
    for k,(f,h) in SOURCES.items():
        raw=(ROOT/'docs/research'/f).read_bytes()
        if sha256(raw).hexdigest()!=h:raise ValueError('Q102_SOURCE_READY_PIN_CHANGED:'+k)
        d[k]=json.loads(raw)
    return d


def verify_out(report):
    if (report.get('schema')!='stable4-q102-942-ready-clock-native-raw-grid-and-conditional-full-selector/v1'
        or report.get('status')!='ALL_READY_CLOCKS_ACCOUNTED_NOT_FULL_YEAR_OR_REAL_FILLS'
        or report.get('sourceArtifactPins')!={f:h for f,h in SOURCES.values()}):
        raise ValueError('Q102_SOURCE_READY_COVERAGE_SCOPE_WRONG')
    for prop in ('orderAuthority','fullQ102AnnualReplay','sevenRunnerSharedWalletComplete',
                 'allReadyClocksFullyNativeSelectorInvoked','productionEligible'):
        if report.get(prop) is not False:raise ValueError('Q102_FALSE_EXECUTION_OR_COMPLETE_NATIVE_SELECTOR:'+prop)
    info=report['summary']
    if (info.get('allConfiguredSymbols')!=20 or info.get('fullYearDecisionHours')!=8760 or
       info.get('sourceReadyHours')!=942 or info.get('sourceBlockedHours')!=7818 or
       info.get('allReadyHoursRawGeneratorScreened')!=942 or
       info.get('rawEmptyNoNativeSelectorInvoked')!=846 or
       info.get('fullNativeSelectorInvokedAtRawMatchClocks')!=96 or
       info.get('nativeFullSelectorS34Selected')!=29 or
       info.get('nativeFullSelectorHighVolSelected')!=9 or
       info.get('nativeFullSelectorRevLongVeto')!=23 or
       info.get('nativeFullSelectorMatchedRawButIdle')!=35):
        raise ValueError('Q102_942_CLOCK_ACCOUNTING_NOT_EXACT')
    rows=report.get('decisions',[])
    if len(rows)!=942 or len({r['decisionTs'] for r in rows})!=942:
        raise ValueError('Q102_DUPLICATE_OR_MISSING_READY_CLOCK')
    for a,b in zip(rows,rows[1:]):
        if a['decisionTs']>=b['decisionTs']:raise ValueError('NONMONOTONIC_SOURCE_CLOCKS')
    counts=Counter(x['category'] for x in rows)
    if counts!={
        'NATIVE_GRID_NO_CANDIDATE_NO_FULL_SELECTOR_INVOKED':846,
        'FULL_NATIVE_SELECTED_S34_SOURCE_ONLY':29,
        'FULL_NATIVE_SELECTED_HIGH_VOL_SOURCE_ONLY':9,
        'FULL_NATIVE_REJECTED_REV_LONG_SOURCE_ONLY':23,
        'FULL_NATIVE_NO_SIGNAL_AFTER_RAW_MATCH_SOURCE_ONLY':35}:
        raise ValueError('Q102_942_HOUR_NATIVE_OR_RAW_COUNTS_CHANGED')
    for row in rows:
        clock=row['decisionTs']
        if clock%H or clock<START or clock>=END or row['closedH1DataCutoffTs']!=clock-H:
            raise ValueError('Q102_CAUSAL_H1_CLOCK_LEAK_OR_OUT_OF_RANGE')
        if row['orderAuthority'] is not False or row['sourceFillProven'] is not False:
            raise ValueError('Q102_FORGED_SOURCE_ORDER_OR_FILL')
        if row['category']=='NATIVE_GRID_NO_CANDIDATE_NO_FULL_SELECTOR_INVOKED':
            if (row['fullNativeSelectorInvoked'] is not False or row['nativeFullSelectorSignal'] is not None
                or row['rawHighVolSymbolsCount'] or row['rawS34CandidatesCount']):
                raise ValueError('Q102_RAW_EMPTY_CLOCK_CONFLATED_WITH_NATIVE_SIGNAL')
        else:
            if row['fullNativeSelectorInvoked'] is not True or not isinstance(row['nativeFullSelectorSignal'],dict):
                raise ValueError('Q102_NATIVE_SELECTOR_NOT_PROVEN_AT_CANDIDATE_CLOCK')


def evaluate():
    d=read()
    full,cross=d['full'],d['cross']
    if (full.get('schema')!='stable4-q102-full-universe-all-ready-clock-screen/v1'
        or cross.get('schema')!='stable4-q102-native-full-selector-s34-independent-parity/v1'
        or full.get('orderAuthority') is not False or cross.get('orderAuthority') is not False
        or full.get('fullQ102AnnualReplay') is not False or cross.get('fullQ102AnnualReplay') is not False):
        raise ValueError('SOURCE_BOUNDARY_WEAK')
    if (full['readyClocks']!=942 or full['blockedClocks']!=7818 or
        len(full['symbols'])!=20 or len(full['rawScreens'])!=942 or len(full['observations'])!=96 or
        len(cross['checks'])!=96 or cross['sourceArtifactPins']!={SOURCES['full'][0]:SOURCES['full'][1],
                             'STABLE4_Q102_S34_CONDITIONAL_RANK_ONE_SLOT_20261128.json':
                             '5ba29f0a2f8297c84673e8d47616673a8820b537e275b411f9d96ed1aaf3e17b'}):
        raise ValueError('Q102_ORIGINAL_SCANNED_UNIVERSE_INCOMPLETE')
    # Pin source claims to the exact native generator configuration and scripts.
    for path,expected in full['sourcePins'].items():
        file=ROOT/path
        if not file.is_file() or sha256(file.read_bytes()).hexdigest()!=expected:
            raise ValueError('Q102_CANDIDATE_SELECTION_SOURCE_SHA_CHANGED:'+path)
    if (full['totalClocks']!=8760 or full['historyHours']!=5400 or
        full['firstReadyUtc']!='2026-08-22T18:00:00.000Z' or
        full['lastReadyUtc']!='2026-09-30T23:00:00.000Z'):
        raise ValueError('Q102_DATA_HISTORY_NOT_READY_ALL_YEAR')
    raw=full['rawScreens']
    observations={r['decisionTs']:r for r in full['observations']}
    cross_checks={r['decisionTs']:r for r in cross['checks']}
    if len(observations)!=96 or len(cross_checks)!=96 or set(observations)!=set(cross_checks):
        raise ValueError('NATIVE_SOURCE_SELECTION_AND_PARITY_CLOCKS_DIFFER')
    rows=[];seen=set()
    for record in raw:
        clock=record['decisionTs']
        if clock in seen or not isinstance(record['highVolRawGridSymbols'],list) or not isinstance(record['s34CandidateIds'],list):
            raise ValueError('Q102_DUPLICATED_OR_UNCHECKED_RAW_CLOCK')
        seen.add(clock)
        native=observations.get(clock)
        matched=bool(record['highVolRawGridSymbols'] or record['s34CandidateIds'])
        if matched!=record['requiresFullSelector'] or matched!=(native is not None):
            raise ValueError('CANDIDATE_CLOCK_NOT_EXACTLY_EVALUATED_BY_FULL_NATIVE')
        if native is None:
            row={'decisionTs':clock,'closedH1DataCutoffTs':clock-H,
                'category':'NATIVE_GRID_NO_CANDIDATE_NO_FULL_SELECTOR_INVOKED',
                'rawHighVolSymbolsCount':0,'rawS34CandidatesCount':0,
                'nativeFullSelectorSignal':None,'fullNativeSelectorInvoked':False,
                'orderAuthority':False,'sourceFillProven':False}
        else:
            cross_row=cross_checks[clock]
            if cross_row['category'] not in CATEGORIES:
                raise ValueError('UNRECOGNIZED_NATIVE_SOURCE_CATEGORY')
            sig=native['signal']
            if sig['dataCutoffTs']!=clock-H or sig['referenceTs']!=clock:
                raise ValueError('NATIVE_CAUSAL_SOURCE_CUTOFF_WRONG')
            if cross_row['nativeReason']!=sig['reason'] or cross_row['nativeFamily']!=sig.get('family') or cross_row['nativeSide']!=sig['side'] or cross_row['nativeSymbol']!=sig.get('symbol'):
                raise ValueError('NATIVE_PARITY_SIGNAL_NOT_EXACT')
            if sig['side'] in (-1,1) and (sig['symbol'] not in full['symbols'] or sig.get('family') is None):
                raise ValueError('SOURCE_SELECTED_SYMBOL_OR_FAMILY_UNKNOWN')
            if cross_row['category']=='NATIVE_HIGH_VOL_PRIORITY_SEPARATE':
                if sig['family']!='HIGH_VOL' or sig['symbol'] not in record['highVolRawGridSymbols']:
                    raise ValueError('SOURCE_NATIVE_HIGHVOL_NOT_IN_RAW_GRID')
            if cross_row['category']=='NATIVE_S34_ENTRY_EXACT_RANK' and not record['s34CandidateIds']:
                raise ValueError('NATIVE_S34_SELECTED_FROM_RAW_EMPTY')
            row={'decisionTs':clock,'closedH1DataCutoffTs':clock-H,
                'category':CATEGORIES[cross_row['category']],
                'rawHighVolSymbolsCount':len(record['highVolRawGridSymbols']),
                'rawS34CandidatesCount':len(record['s34CandidateIds']),
                'nativeFullSelectorSignal':sig,
                'fullNativeSelectorInvoked':True,'orderAuthority':False,
                'sourceFillProven':False}
        rows.append(row)
    if len(seen)!=942:raise ValueError('SOURCE_READY_CLOCKS_MISSING')
    counts=Counter(r['category'] for r in rows)
    summary={'allConfiguredSymbols':len(full['symbols']),
      'fullYearDecisionHours':full['totalClocks'],'sourceReadyHours':full['readyClocks'],
      'sourceBlockedHours':full['blockedClocks'],
      'allReadyHoursRawGeneratorScreened':len(rows),
      'rawEmptyNoNativeSelectorInvoked':counts['NATIVE_GRID_NO_CANDIDATE_NO_FULL_SELECTOR_INVOKED'],
      'fullNativeSelectorInvokedAtRawMatchClocks':sum(r['fullNativeSelectorInvoked'] for r in rows),
      'nativeFullSelectorS34Selected':counts['FULL_NATIVE_SELECTED_S34_SOURCE_ONLY'],
      'nativeFullSelectorHighVolSelected':counts['FULL_NATIVE_SELECTED_HIGH_VOL_SOURCE_ONLY'],
      'nativeFullSelectorRevLongVeto':counts['FULL_NATIVE_REJECTED_REV_LONG_SOURCE_ONLY'],
      'nativeFullSelectorMatchedRawButIdle':counts['FULL_NATIVE_NO_SIGNAL_AFTER_RAW_MATCH_SOURCE_ONLY'],
      'firstReadyUtc':full['firstReadyUtc'],'lastReadyUtc':full['lastReadyUtc']}
    result={'schema':'stable4-q102-942-ready-clock-native-raw-grid-and-conditional-full-selector/v1',
      'status':'ALL_READY_CLOCKS_ACCOUNTED_NOT_FULL_YEAR_OR_REAL_FILLS',
      'sourceArtifactPins':{f:h for f,h in SOURCES.values()},
      'summary':summary,'decisions':rows,
      'allReadyClocksFullyNativeSelectorInvoked':False,'fullQ102AnnualReplay':False,
      'sevenRunnerSharedWalletComplete':False,'productionEligible':False,'orderAuthority':False,
      'limitations':[
       'All 942 H1 source-ready clocks are covered by the actual native HIGH_VOL grid/S34 raw generators; the complete native V4 selector was invoked at each of the 96 raw candidate clocks. No actual complete-native selector invocation on the other 846 raw-empty clocks. This is a source-level no-entry implication, NOT a substitute for testing runtime errors at all hours.',
       'The 942 ready clocks occur only 2026-08-22 18 UTC to 2026-09-30 23 UTC; the other 7,818 hourly decisions require source-authentic 225d all-20-symbol H1 coverage. No missing hours imputed or substituted.',
       'For 96 native candidate-clock results: 29 S34, 9 HIGH_VOL, 23 REV long no-backfill rejections and 35 idle, under hypothetical all-other-sleeves-idle occupancy. No signed Q102 positions, funding, exchange orders/fills, resident STOP readback, whole-wallet PnL or DD.',
       'Q102 native one-slot lifecycle must resolve actual venue exits and base sleeve state, and source HIGH_VOL full annual monthly training must be verified; none of that is certified by this raw-entry decision screen.'
      ]}
    verify_out(result)
    return result

if __name__=='__main__':
    if len(sys.argv)!=2:raise ValueError('OUTPUT_PATH_REQUIRED')
    r=evaluate()
    with open(sys.argv[1],'x',encoding='utf8',newline='\n') as f:json.dump(r,f,indent=2,sort_keys=True);f.write('\n')
    print('Q102_READY_942_CLOCKS',json.dumps(r['summary'],sort_keys=True))
