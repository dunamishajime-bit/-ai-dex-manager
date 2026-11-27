"""Q102 S34 source-native rank + delayed-M5 conditional one-slot evidence.

NO HIGH_VOL, exact Q102 live selector parity, signed fills or 7-runner claims.
Reject prospective admission from next-M5 volume (known ex-post only).
"""
from __future__ import annotations
from collections import Counter,defaultdict
from hashlib import sha256
import copy
import json
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
DOCS={
 'raw':('STABLE4_Q102_S34_ANNUAL_SOURCE_INVENTORY_20261128.json','04209f9c8e49d8fcb781f6aa2afa7a16952dd9a3f2e876866ee1fa40bf73eeac'),
 'delayed':('STABLE4_Q102_S34_M5_DELAYED_CAUSAL_EXIT_V2_20261128.json','b3ceaad7cf64929b31dbbd4f81b02bc62f44fb238a60c9ae9c3cdadeb1facd98'),
 'selected':('STABLE4_Q102_S34_CONDITIONAL_RANK_ONE_SLOT_20261128.json','5ba29f0a2f8297c84673e8d47616673a8820b537e275b411f9d96ed1aaf3e17b'),
}
H=3600000;M=300000


def load():
    result={}
    for name,(file,hash_value) in DOCS.items():
        b=(ROOT/'docs/research'/file).read_bytes()
        if sha256(b).hexdigest()!=hash_value:raise ValueError('SOURCE_RESEARCH_PIN_CHANGED:'+name)
        result[name]=json.loads(b)
    return result


def validate(d):
    raw,m5,s=d['raw'],d['delayed'],d['selected']
    if (s.get('schema')!='stable4-q102-s34-conditional-source-ranked-one-slot/v1'
       or s.get('status')!='ISOLATED_S34_ONLY_NO_HIGH_VOL_OR_BASE_OCCUPANCY_NO_FILL'
       or s.get('orderAuthority') is not False or s.get('fullQ102AnnualReplay') is not False
       or s.get('fullSevenRunnerWalletReplay') is not False or s.get('productionEligible') is not False
       or raw.get('orderAuthority') is not False or raw.get('fullQ102AnnualReplay') is not False
       or m5.get('orderAuthority') is not False or m5.get('fullQ102AnnualReplay') is not False):
        raise ValueError('Q102_FALSE_EXECUTION_OR_CERTIFICATION')
    if s.get('rawCandidateLedgerSha256')!=DOCS['raw'][1] or s.get('delayedM5LedgerSha256')!=DOCS['delayed'][1] or m5.get('inputLedgerSha256')!=DOCS['raw'][1]:
        raise ValueError('Q102_EVIDENCE_LINEAGE_BROKEN')
    for doc in (raw,m5,s):
        for path,hash_value in doc['sourcePins'].items():
            f=ROOT/path
            if not f.is_file() or sha256(f.read_bytes()).hexdigest()!=hash_value:
                raise ValueError('Q102_NATIVE_SOURCE_CHANGED:'+path)
    if raw['rawCandidates']!=520 or len(raw['events'])!=520 or len(m5['rows'])!=520 or len(s['selected'])!=326:
        raise ValueError('Q102_RAW_OR_SELECTED_COUNT_DRIFT')
    if raw['distinctCandidateClocks']!=326 or s['summary']['distinctCandidateClocks']!=326:
        raise ValueError('Q102_UNVERIFIED_DECISION_CLOCKS')
    rows={x['id']:x for x in m5['rows']}
    if len(rows)!=520:raise ValueError('Q102_DUPLICATED_M5_SOURCE_EVENT')
    e_by_ts=defaultdict(list)
    for e in raw['events']:
        if e['dataCutoffTs']!=e['entryTs']-H:raise ValueError('Q102_FUTURE_H1_CANDLE')
        e_by_ts[e['entryTs']].append(e)
    rank_layer={'S3':1,'S4':2};rank_family={'BRK':1,'PB':2,'MR':3,'REV':4}
    selected_by_ts={}
    for selected in s['selected']:
        t=selected['entryTs']
        if t in selected_by_ts:raise ValueError('SELECTED_CLOCK_DUPLICATED')
        selected_by_ts[t]=selected
        group=e_by_ts[t]
        best=sorted(group,key=lambda e:(rank_layer[e['layer']],rank_family[e['family']],-e['margin'],e['key']))[0]
        if selected['selectedId']!=best['id'] or selected['selectedKey']!=best['key'] or selected['rawSameClock']!=len(group):
            raise ValueError('NOT_SOURCE_V4_S34_PRECEDENCE')
        if selected['family']!=best['family'] or selected['side']!=best['side']:
            raise ValueError('SELECTED_ROUTE_MUTATION')
        if rows[best['id']]['entryTs']!=t or rows[best['id']]['symbol']!=best['symbol']:
            raise ValueError('Q102_M5_SIGNAL_WRONG_CLOCK')
    gate=Counter(e['sourceSelectionGate'] for e in s['selected'])
    if gate!={'SOURCE_S34_QUALITY_PASS_CONDITIONAL_HIGH_VOL_ABSENT':272,
             'QUALITY102_CAUSAL_V4_REV_LONG_RET14_BELOW_24PCT_NO_BACKFILL':53,
             'Q102_BRK_FET_SHORT_EXHAUSTION':1}:
        raise ValueError('Q102_POSTGEN_NO_BACKFILL_GATE_CHANGED')
    if dict(gate)!=s['summary']['gateDecisionCounts']:
        raise ValueError('GATE_SUMMARY_DRIFT')
    for arm,expected in [('base',(95,131,42,58)),('profitFloor',(107,105,45,69))]:
        rr=s['passes'][arm]
        decisions=rr['decisions']
        if len(decisions)!=326 or len({row['entryTs'] for row in decisions})!=326:
            raise ValueError('Q102_ONE_SLOT_CLOCK_UNIVERSE')
        counts=Counter(x['status'] for x in decisions)
        exp={
            'ADMITTED_CONDITIONAL_S34_ONE_SLOT_NOT_FILL':expected[0],
            'BLOCKED_CONDITIONAL_ONE_SLOT_OCCUPIED':expected[1],
            'BLOCKED_SOURCE_IMPROVEMENT_OR_EXHAUSTION_NO_BACKFILL':expected[2],
            'BLOCKED_DELAYED_M5_PRICE_OR_CONFIRMATION_UNAVAILABLE':expected[3],
        }
        if counts!=exp or dict(counts)!=rr['summary']['status']:
            raise ValueError('Q102_CONDITIONAL_ONE_SLOT_COUNTS_DRIFT')
        if Counter(r['key'] for r in decisions if r['status']=='ADMITTED_CONDITIONAL_S34_ONE_SLOT_NOT_FILL')!=rr['summary']['admittedByRoute']:
            raise ValueError('Q102_MODEL_ROUTE_COUNTS_DRIFT')
        occupied_until=0;seen_expost_zero=0
        for r in decisions:
            t=r['entryTs']
            if r.get('orderAuthority') is not False:raise ValueError('FALSE_Q102_ORDER_PERMISSION')
            c=selected_by_ts.get(t)
            if c is None or r['selectedId']!=c['selectedId'] or r['sourceSelectionGate']!=c['sourceSelectionGate']:
                raise ValueError('Q102_PROVENANCE_SLOT_MISMATCH')
            source=rows[c['selectedId']][arm]
            if r['status']=='ADMITTED_CONDITIONAL_S34_ONE_SLOT_NOT_FILL':
                if t<occupied_until or c['sourceSelectionGate']!='SOURCE_S34_QUALITY_PASS_CONDITIONAL_HIGH_VOL_ABSENT':
                    raise ValueError('Q102_ONE_SLOT_OVERLAP_OR_FINAL_GATE_BYPASS')
                if source['status']!='MODELED_EXIT_NOT_FILL' or r['modelEntryTs']!=t+M or source['modelEntryTs']!=t+M:
                    raise ValueError('Q102_M5_ENTRY_LOOKAHEAD_OR_NOT_CONFIRMED')
                if r['modelExitTs']!=source['exitTs'] or r['modelExitTs']<=r['modelEntryTs']:
                    raise ValueError('Q102_MODEL_EXIT_SOURCE_DRIFT')
                occupied_until=r['modelExitTs']
                if source['followingM5VolumePositiveExPost'] is False:seen_expost_zero+=1
            elif r['status']=='BLOCKED_CONDITIONAL_ONE_SLOT_OCCUPIED':
                if t>=occupied_until or r.get('occupiedUntilTs')!=occupied_until:raise ValueError('FALSE_ONE_SLOT_OCCUPANCY')
            elif r['status']=='BLOCKED_SOURCE_IMPROVEMENT_OR_EXHAUSTION_NO_BACKFILL':
                if t<occupied_until or c['sourceSelectionGate']=='SOURCE_S34_QUALITY_PASS_CONDITIONAL_HIGH_VOL_ABSENT':raise ValueError('FALSE_POSTGEN_VETO')
            elif r['status']=='BLOCKED_DELAYED_M5_PRICE_OR_CONFIRMATION_UNAVAILABLE':
                if t<occupied_until or c['sourceSelectionGate']!='SOURCE_S34_QUALITY_PASS_CONDITIONAL_HIGH_VOL_ABSENT' or source['status']=='MODELED_EXIT_NOT_FILL':raise ValueError('FALSE_M5_ENTRY_BLOCK')
            else:raise ValueError('UNKNOWN_SOURCE_MODEL_DECISION')
        if seen_expost_zero != (24 if arm=='base' else 25):
            raise ValueError('Q102_M5_NEXT_BAR_VOLUME_LOOKAHEAD_REINTRODUCED')
    for arm in ('base','profitFloor'):
        records=[x[arm] for x in m5['rows']]
        if (Counter(x['status'] for x in records)!={
          'MODELED_EXIT_NOT_FILL':341,'ENTRY_CONFIRMED_M5_ZERO_VOLUME':179}):
            raise ValueError('Q102_DELAYED_M5_MODEL_QUALITY_CHANGED')
        for row in records:
            if row['status']=='MODELED_EXIT_NOT_FILL' and row['modelEntryTs']<=0:
                raise ValueError('Q102_MODEL_ENTRY_CLOCK_MISSING')

class Q102S34ConditionalSourceTest(unittest.TestCase):
    def test_exact_pinned_source_selector_and_conditional_slot(self):validate(load())
    def test_reject_fake_final_live_and_full_wallet(self):
        for target,field in [('selected','orderAuthority'),('selected','productionEligible'),
            ('selected','fullQ102AnnualReplay'),('selected','fullSevenRunnerWalletReplay'),('delayed','orderAuthority')]:
            docs=copy.deepcopy(load());docs[target][field]=True
            with self.subTest(target=target,field=field),self.assertRaises(ValueError):validate(docs)
    def test_reject_hidden_selected_route_or_occupancy_change(self):
        docs=load();docs['selected']['selected'][0]['selectedKey']='FORGED'
        with self.assertRaises(ValueError):validate(docs)
        docs=load();admitted=next(r for r in docs['selected']['passes']['base']['decisions'] if r['status'].startswith('ADMITTED'))
        admitted['modelExitTs']+=H
        with self.assertRaises(ValueError):validate(docs)
    def test_reject_future_m5_volume_gate(self):
        docs=load()
        for x in docs['selected']['passes']['base']['decisions']:
            if x['status']=='ADMITTED_CONDITIONAL_S34_ONE_SLOT_NOT_FILL' and docs['delayed']['rows']:
                source=next(r['base'] for r in docs['delayed']['rows'] if r['id']==x['selectedId'])
                if source['followingM5VolumePositiveExPost'] is False:
                    x['status']='BLOCKED_DELAYED_M5_PRICE_OR_CONFIRMATION_UNAVAILABLE'
        with self.assertRaises(ValueError):validate(docs)

if __name__=='__main__':unittest.main()
