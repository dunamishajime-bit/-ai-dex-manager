"""Fail-closed Q102 full 20-symbol selected signals -> delayed-M5 price model.

The source exit helper is native, the M5 entry/execution is a CONDITIONAL
hypothesis; a real Q102 slot can never be unlocked by this artifact.
"""
from __future__ import annotations
import copy
from collections import Counter
from hashlib import sha256
import json
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
EVIDENCE={
 'source':('STABLE4_Q102_FULL_UNIVERSE_ALL_READY_CLOCK_SCREEN_20261128.json','8bcaa800393b4cd920c3524f0ba242bc482c54fa05564ed4c8b53276a49864f0'),
 'exit':('STABLE4_Q102_SELECTED_NATIVE_DELAYED_M5_EXIT_V2_20261128.json','0ab3e3dfa5c069becd27b7abb042f67fe368532eb7847fea1ccedb92bd332b2d'),
 'slot':('STABLE4_Q102_SELECTED_ONE_SLOT_DELAYED_M5_V2_20261128.json','5035cfb3364cc388211f0291f9a1d3b5f4a5c7e05c382ef4c1c937a50e9f77d5'),
}
M=300_000

def read():
    result={}
    for k,(name,pin) in EVIDENCE.items():
        raw=(ROOT/'docs/research'/name).read_bytes()
        if sha256(raw).hexdigest()!=pin:raise ValueError('Q102_DEL_M5_ARTIFACT_SHA_CHANGED:'+k)
        result[k]=json.loads(raw)
    return result

def verify(d):
    src,exit,slot=(d[x] for x in ('source','exit','slot'))
    if (src.get('schema')!='stable4-q102-full-universe-all-ready-clock-screen/v1'
       or exit.get('schema')!='stable4-q102-selected-native-delayed-m5-exit-model/v2'
       or slot.get('schema')!='stable4-q102-selected-one-slot-delayed-m5/v2'
       or src.get('orderAuthority') is not False
       or exit.get('orderAuthority') is not False
       or slot.get('orderAuthority') is not False
       or src.get('fullQ102AnnualReplay') is not False
       or exit.get('fullQ102AnnualReplay') is not False
       or slot.get('fullQ102AnnualReplay') is not False):
        raise ValueError('Q102_FALSE_LIVE_NATIVE_REPLAY_OR_FILLS')
    if exit.get('status')!='PARTIAL_SELECTED_NATIVE_DELAYED_M5_PRICE_MODEL_NO_ACTUAL_FILL' or slot.get('status')!='PARTIAL_SOURCE_SELECTED_ONE_SLOT_DELAYED_M5_NO_EXECUTION':
        raise ValueError('Q102_EVIDENCE_SCOPE_MISSING')
    if exit['inputLedgerSha256']!=EVIDENCE['source'][1] or slot['inputPins']!={
        EVIDENCE['exit'][0]:EVIDENCE['exit'][1], EVIDENCE['source'][0]:EVIDENCE['source'][1]}:
        raise ValueError('Q102_SELECTED_EVIDENCE_PROVENANCE')
    for path,pin in exit['sourcePins'].items():
        p=ROOT/path
        if not p.is_file() or sha256(p.read_bytes()).hexdigest()!=pin:raise ValueError('EXIT_POLICY_MODULE_SHA_DRIFT:'+path)
    source_signals={r['decisionTs']:r['signal'] for r in src['observations'] if r['signal']['side']}
    if src.get('readyClocks')!=942 or len(source_signals)!=38 or len(exit['rows'])!=38 or len(slot['decisions'])!=38:
        raise ValueError('Q102_NATIVE_READY_SCOPE_OR_COUNT_INVALID')
    if Counter(r['signal']['family'] for r in exit['rows'])!={'HIGH_VOL':9,'PB':11,'MR':9,'BRK':5,'REV':4}:
        raise ValueError('Q102_NATIVE_ROUTE_COUNT_DRIFT')
    by={}
    for r in exit['rows']:
        t=r['entryTs']
        if t in by or source_signals.get(t)!=r['signal']:raise ValueError('Q102_SELECTED_SIGNAL_NOT_NATIVE')
        by[t]=r
        if r['status']=='MODELED_EXIT_NOT_FILL':
            if (r.get('modelEntryTs')!=t+M or not r.get('entryPrice',0)>0
                 or not r.get('exitPrice',0)>0 or r['exitTs']<=r['modelEntryTs']):
                raise ValueError('Q102_CAUSAL_M5_DELAY_OR_MODEL_EXIT_INVALID')
        if r.get('modelEntryTs') is not None and r['modelEntryTs']!=t+M:
            raise ValueError('Q102_M5_LOOKAHEAD_CAUSAL_CLOCK')
    if exit['summary']['all']['status']!={
        'FIRST_CONFIRMED_M5_ZERO_VOLUME':8,'MODELED_EXIT_NOT_FILL':26,
        'TIME_EXIT_PRICE_UNAVAILABLE':3,'STUDY_END_OPEN_POSITION':1}:
        raise ValueError('Q102_SELECTED_M5_RESULT_STATUS_CHANGED')
    if sum(r.get('modelEntryTs') is not None and r.get('followingM5VolumePositiveExPost') is False for r in exit['rows'])!=3:
        raise ValueError('NEXT_BAR_EX_POST_VOLUME_USED_AS_ENTRY_PERMISSION')
    if slot['summary']!={
        'BLOCKED_OCCUPIED_SLOT':2,'BLOCKED_UNRESOLVED_SLOT':32,
        'MODELED_ADMIT_AND_EXIT':1,'MODELED_ADMIT_UNRESOLVED_LATCH':1,
        'NO_MODELED_ENTRY_PRICE':2}:
        raise ValueError('Q102_STRICT_ONE_SLOT_LATCH_CHANGED')
    active_until=0;unresolved=False
    for r in sorted(slot['decisions'],key=lambda x:x['entryTs']):
        ts=r['entryTs'];source=by.get(ts)
        if not source or r['sourceStatus']!=source['status'] or r['symbol']!=source['signal']['symbol'] or r['side']!=source['signal']['side']:
            raise ValueError('Q102_SOURCE_SLEEVE_DECISION_DIVERGED')
        if r['decision']=='MODELED_ADMIT_AND_EXIT':
            if unresolved or ts<active_until or source['status']!='MODELED_EXIT_NOT_FILL' or r['exitTs']!=source['exitTs']:
                raise ValueError('Q102_UNVERIFIED_SLOT_FREED')
            active_until=r['exitTs']
        elif r['decision']=='MODELED_ADMIT_UNRESOLVED_LATCH':
            if unresolved or ts<active_until or source['status']=='MODELED_EXIT_NOT_FILL':
                raise ValueError('Q102_FALSE_UNRESOLVED_ENTRY')
            unresolved=True
        elif r['decision']=='BLOCKED_UNRESOLVED_SLOT':
            if not unresolved:raise ValueError('Q102_UNRESOLVED_SLOT_IGNORED')
        elif r['decision']=='BLOCKED_OCCUPIED_SLOT':
            if unresolved or not ts<active_until:raise ValueError('Q102_FALSE_OCCUPANCY')
        elif r['decision']=='NO_MODELED_ENTRY_PRICE':
            if unresolved or ts<active_until or source['status'] not in ('FIRST_CONFIRMED_M5_ZERO_VOLUME','FIRST_CONFIRMED_M5_MISSING_OR_INVALID','FOLLOWING_M5_OPEN_PRICE_UNAVAILABLE'):
                raise ValueError('Q102_FALSE_ENTRY_PRICE_BLOCK')
        else:raise ValueError('Q102_UNEXPECTED_VENUE_TRADE_STATUS')
    if not unresolved:raise ValueError('MISSING_STRICT_UNRESOLVED_SLOT_BLOCK')

class Q102SelectedDelayedM5Evidence(unittest.TestCase):
    def test_selected_native38_delayed_m5_strict_slot(self):verify(read())
    def test_reject_fake_live_and_full_year(self):
        for name,field in [('source','orderAuthority'),('exit','orderAuthority'),('slot','orderAuthority'),('exit','fullQ102AnnualReplay'),('slot','fullQ102AnnualReplay')]:
            d=copy.deepcopy(read());d[name][field]=True
            with self.subTest(name=name,field=field),self.assertRaises(ValueError):verify(d)
    def test_reject_unresolved_slot_release(self):
        d=read();row=next(x for x in d['slot']['decisions'] if x['decision']=='BLOCKED_UNRESOLVED_SLOT')
        row['decision']='NO_MODELED_ENTRY_PRICE'
        with self.assertRaises(ValueError):verify(d)
    def test_reject_next_bar_lookahead(self):
        d=read();row=next(x for x in d['exit']['rows'] if x.get('modelEntryTs'))
        row['modelEntryTs']=row['entryTs']
        with self.assertRaises(ValueError):verify(d)

if __name__=='__main__':unittest.main()
