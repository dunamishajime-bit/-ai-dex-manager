"""Q102 S34 326-clock isolated model vs 20-symbol 225d native V4 signal.

This verifies 52 S34 source decisions on 942 fully-ready historical H1 clocks,
NOT a full-year Q102 replay, signed venue fills, or HIGH_VOL position exits.
"""
from __future__ import annotations
from collections import Counter
from hashlib import sha256
import json
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[2]
FULL='STABLE4_Q102_FULL_UNIVERSE_ALL_READY_CLOCK_SCREEN_20261128.json'
S34='STABLE4_Q102_S34_CONDITIONAL_RANK_ONE_SLOT_20261128.json'
PINS={FULL:'8bcaa800393b4cd920c3524f0ba242bc482c54fa05564ed4c8b53276a49864f0',
      S34:'5ba29f0a2f8297c84673e8d47616673a8820b537e275b411f9d96ed1aaf3e17b'}

def read(name):
    p=ROOT/'docs/research'/name
    raw=p.read_bytes()
    if sha256(raw).hexdigest()!=PINS[name]:raise ValueError('PINNED_Q102_EVIDENCE_SHA_CHANGED:'+name)
    return json.loads(raw)

def verify(doc):
    if (doc.get('schema')!='stable4-q102-native-full-selector-s34-independent-parity/v1'
        or doc.get('status')!='PASS_ON_96_NATIVE_READY_OBSERVATIONS_NOT_ANNUAL_OR_FILLS'
        or doc.get('orderAuthority') is not False or doc.get('fullQ102AnnualReplay') is not False
        or doc.get('fullSevenRunnerWalletReplay') is not False or doc.get('productionEligible') is not False):
        raise ValueError('Q102_NATIVE_SCOPE_PROMOTED')
    if doc.get('sourceArtifactPins')!={k:v for k,v in PINS.items()}:
        raise ValueError('NATIVE_SOURCE_EVIDENCE_PIN_MISSING')
    c=doc['summary']
    if (c.get('all20Symbols')!=20 or c.get('readyH1DecisionClocks')!=942 or c.get('blockedH1DecisionClocks')!=7818
        or c.get('nativeFullSelectorSampledClocks')!=96 or c.get('nativeS34SignalsExact')!=29
        or c.get('nativeS34ImprovementGateRejectedExact')!=23
        or c.get('nativeHighVolSignalsSeparate')!=9 or c.get('nativeNoSignalOnSampledClocks')!=35
        or c.get('nativeS34ComparisonMismatch')!=0 or c.get('nativeCandidateMissing')!=0):
        raise ValueError('NATIVE_S34_CROSS_EVIDENCE_INCOMPLETE')
    if len(doc['checks'])!=96 or len({r['decisionTs'] for r in doc['checks']})!=96:
        raise ValueError('OBSERVATION_CLOCKS_NOT_COMPLETE')
    if Counter(r['category'] for r in doc['checks'])!={
        'NATIVE_S34_ENTRY_EXACT_RANK':29,
        'NATIVE_S34_REV_GATE_EXACT_NO_BACKFILL':23,
        'NATIVE_HIGH_VOL_PRIORITY_SEPARATE':9,
        'NATIVE_NO_SIGNAL_SEPARATE':35}:
        raise ValueError('EXACT_CROSS_CATEGORY_COUNTS_DRIFT')
    if any(r.get('modelClaimsActualFill') is not False for r in doc['checks']):
        raise ValueError('FALSE_Q102_VENUE_FILL_CLAIM')

def analyze():
    full=read(FULL);s34=read(S34)
    if (full.get('schema')!='stable4-q102-full-universe-all-ready-clock-screen/v1'
        or full.get('orderAuthority') is not False or full.get('fullQ102AnnualReplay') is not False
        or s34.get('schema')!='stable4-q102-s34-conditional-source-ranked-one-slot/v1'
        or s34.get('orderAuthority') is not False or s34.get('fullQ102AnnualReplay') is not False):
        raise ValueError('SOURCE_REPORT_OUT_OF_SCOPE')
    if full['readyClocks']!=942 or full['blockedClocks']!=7818 or len(full['symbols'])!=20 or len(full['highVol'])!=9 or len(full['observations'])!=96:
        raise ValueError('20_SYMBOL_NATIVE_SAMPLE_UNIVERSE_CHANGED')
    sel={r['entryTs']:r for r in s34['selected']}
    checks=[]
    for observed in full['observations']:
        sig=observed['signal'];ts=observed['decisionTs']
        if sig.get('dataCutoffTs')!=ts-3600000:
            raise ValueError('FUTURE_H1_SOURCE_CANDLE')
        ranking=sel.get(ts)
        if sig.get('family')=='HIGH_VOL':
            if sig.get('side') not in (-1,1) or sig.get('symbol') not in full['highVol']:
                raise ValueError('HIGH_VOL_SOURCE_UNIVERSE_MISMATCH')
            category='NATIVE_HIGH_VOL_PRIORITY_SEPARATE'
        elif sig.get('side') in (-1,1):
            if not ranking:
                raise ValueError('SELECTED_S34_CANDIDATE_NOT_IN_PINNED_RAW_SOURCE')
            prefix=sig.get('symbol','').removesuffix('USDT')+'|'+sig.get('variant','')
            if (ranking['selectedKey']!=prefix or ranking['symbol']!=sig.get('symbol')
                or ranking['family']!=sig.get('family') or ranking['side']!=sig.get('side')
                or ranking['sourceSelectionGate']!='SOURCE_S34_QUALITY_PASS_CONDITIONAL_HIGH_VOL_ABSENT'):
                raise ValueError('FULL_NATIVE_V4_SIGNAL_S34_RANK_DIVERGENCE')
            category='NATIVE_S34_ENTRY_EXACT_RANK'
        elif sig.get('reason')=='QUALITY102_CAUSAL_V4_REV_LONG_RET14_BELOW_24PCT_NO_BACKFILL':
            if not ranking or ranking['sourceSelectionGate']!=sig['reason']:
                raise ValueError('FULL_NATIVE_S34_IMPROVEMENT_GATE_DIVERGENCE')
            category='NATIVE_S34_REV_GATE_EXACT_NO_BACKFILL'
        elif sig.get('reason')=='QUALITY102_CAUSAL_V4_NO_SIGNAL':
            if ranking:
                raise ValueError('SOURCE_S34_RAW_SIGNAL_MISSING_FROM_NATIVE')
            category='NATIVE_NO_SIGNAL_SEPARATE'
        else:raise ValueError('UNKNOWN_HIGHVOL_OR_S34_NATIVE_SIGNAL')
        checks.append({'decisionTs':ts,'category':category,'nativeReason':sig.get('reason'),
          'nativeFamily':sig.get('family'), 'nativeSide':sig.get('side'),
          'nativeSymbol':sig.get('symbol'), 'sourceSelectionId':ranking['selectedId'] if ranking else None,
          'sourceSelectionGate':ranking['sourceSelectionGate'] if ranking else None,
          'modelClaimsActualFill':False})
    cat=Counter(row['category'] for row in checks)
    result={'schema':'stable4-q102-native-full-selector-s34-independent-parity/v1',
      'status':'PASS_ON_96_NATIVE_READY_OBSERVATIONS_NOT_ANNUAL_OR_FILLS',
      'sourceArtifactPins':{k:v for k,v in PINS.items()},
      'periodUtc':full['periodUtc'],
      'summary':{
        'all20Symbols':len(full['symbols']), 'readyH1DecisionClocks':full['readyClocks'],
        'blockedH1DecisionClocks':full['blockedClocks'],'nativeFullSelectorSampledClocks':len(checks),
        'nativeS34SignalsExact':cat['NATIVE_S34_ENTRY_EXACT_RANK'],
        'nativeS34ImprovementGateRejectedExact':cat['NATIVE_S34_REV_GATE_EXACT_NO_BACKFILL'],
        'nativeHighVolSignalsSeparate':cat['NATIVE_HIGH_VOL_PRIORITY_SEPARATE'],
        'nativeNoSignalOnSampledClocks':cat['NATIVE_NO_SIGNAL_SEPARATE'],
        'nativeS34ComparisonMismatch':0,'nativeCandidateMissing':0,
      },
      'checks':checks,
      'orderAuthority':False,'fullQ102AnnualReplay':False,
      'fullSevenRunnerWalletReplay':False,'productionEligible':False,
      'limitations':[
        'Cross-verifies all 96 previous native V4 full-selector observations at source-ready clocks: 29 exact S34 entries, 23 source REV-long no-backfill rejects, 9 separate HIGH_VOL signals and 35 no signals. This does not run 8760 annual selectors.',
        'Full-source readiness exists for only 942/8760 hours (2026-08-22 18:00 UTC onward) due 225d 20-symbol history, listing history gaps, and source integrity. No symbol exclusion, Binance substitution, or missing candle interpolation.',
        'S34 conditional one-slot 95/107 model admissions are full-year/hypothetical, not directly comparable to the 96 ready-clock source observations or native HIGH_VOL exits. Actual account occupancy and protected venue STOP readback absent.',
        'All evidence is source-only with unsigned quotes, no venue fill proof, PnL/DD or Owner-signed production authorization.'
      ]}
    verify(result)
    return result

if __name__=='__main__':
    if len(sys.argv)!=2:raise ValueError('NEW_REPORT_OUTPUT_REQUIRED')
    report=analyze()
    with open(sys.argv[1],'x',encoding='utf8',newline='\n') as f:json.dump(report,f,indent=2,sort_keys=True);f.write('\n')
    print(json.dumps(report['summary'],sort_keys=True))
