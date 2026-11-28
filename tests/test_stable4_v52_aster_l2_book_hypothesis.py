"""Fail-closed source-only ASTER+XYZ one-hour L2 reconstruction hypothesis.

CI never reads local Parquet/online venue data. Exact pinned report and pure
book state transitions prove no future/snapshot mixing or false LIVE claim.
"""
from __future__ import annotations
from decimal import Decimal
from hashlib import sha256
import copy
import json
from pathlib import Path
import unittest
from scripts.research.stable4_v52_public_paired_onehour_l2_book_rebuild_hypothesis import StrictBook

ROOT=Path(__file__).resolve().parents[1]
REPORT='docs/research/STABLE4_V52_PAIRED_ONEHOUR_L2_BOOK_REBUILD_HYPOTHESIS_20261128.json'
REPORT_SHA='e369b0a9052668b154945a90d3d47ebb485367fab204c60168bf12943615d845'
SOURCE='scripts/research/stable4_v52_public_paired_onehour_l2_book_rebuild_hypothesis.py'
SOURCE_SHA='f39e6578e5f780712dcb61c92b0b3fb6c6f26a7c3d3e0a737bd65d71e79d8d49'
PROFILE='docs/research/STABLE4_V52_PUBLIC_PAIRED_ONEHOUR_L2_PROFILE_20261128.json'
PROFILE_SHA='59cd3a3008c8a7a465750ae5109767e39418d083487290929b027ec558590860'
SEQUENCE='docs/research/STABLE4_V52_PAIRED_ONEHOUR_L2_SEQUENCE_QUALITY_20261128.json'
SEQUENCE_SHA='f878a19d0174ab655fe772641c78bffe3ec61cbd67bef67d168a60935d4366f8'
ENGINE='scripts/disdex_v13d_v11eq_stock_live_engine.py'
ENGINE_SHA='e1c6f16b5deb514fa636c44a859294fec8ee8f81e0dac3ef405cd55a3056a9d8'
EXPECTED={'asterStateAvailable':1000,'asterStateFresh':939,
          'xyzSnapshotFresh':971,'pairedSourceFreshState':265}

def load():
    raw=(ROOT/REPORT).read_bytes()
    if sha256(raw).hexdigest()!=REPORT_SHA:raise ValueError('V52_SOURCE_BOOK_EVIDENCE_SHA_CHANGED')
    for f,d in ((SOURCE,SOURCE_SHA),(PROFILE,PROFILE_SHA),(SEQUENCE,SEQUENCE_SHA),(ENGINE,ENGINE_SHA)):
        if sha256((ROOT/f).read_bytes()).hexdigest()!=d:
            raise ValueError('V52_BOOK_SOURCE_CODE_OR_INPUT_PIN_CHANGED:'+f)
    return json.loads(raw)

def validate(doc):
    if (doc.get('schema')!='stable4-v52-public-l2-aster-book-hypothesis-xyz-paired-1h/v1'
        or doc.get('status')!='SOURCE_ONLY_RECONSTRUCTION_HYPOTHESIS_NOT_V52_NATIVE_BOOK_OR_FILLS'
        or doc.get('sampleHourUtc')!='2026-09-02T16:00:00Z'
        or doc.get('sourceHourlyProfileSha256')!=PROFILE_SHA
        or doc.get('sourceSequenceQualitySha256')!=SEQUENCE_SHA
        or doc.get('nativeV52EngineSha256')!=ENGINE_SHA):
        raise ValueError('SOURCE_HYPOTHESIS_SCOPE_OR_PROVENANCE_INVALID')
    for f in ('orderAuthority','nativeV52BookParityProven','actualVenueOrdersOrFillsProven',
              'fullAnnualTwoVenueFiveStockReconstructionProven',
              'sharedSevenRunnerAnnualBtComplete','productionEligible'):
        if doc.get(f) is not False:raise ValueError('FALSE_FULL_SOURCE_OR_LIVE_CERTIFICATION:'+f)
    if doc['sourceRowCount']!={'ASTER':93372,'HYPERLIQUID_XYZ':25960}:
        raise ValueError('UNKNOWN_L2_SOURCE_ROW_COUNTS')
    expected={
      'asterDeltaReceivedPackets':39876,'asterFullSnapshotResets':19,
      'asterSourceIdenticalSnapshotIdPairs':19,
      'asterIdenticalDuplicateSnapshotReceiptsProcessed':7,
      'asterMixedSnapshotAndDeltaSameReceivedClocksQuarantined':12,
      'asterAppliedDeltaPackets':11706,
      'asterInvalidatedOrDiscardedDeltaPackets':28170,
      'asterSequenceRejections':0,'asterOldOrEqualDeltaPacketsSkippedAfterSnapshot':7,
      'asterZeroQuantityLevelDeletes':2713,
      'asterUnknownExistingPriceDeletes':51,
      'asterCrossedOrMissingSidePackets':0,
      'hyperliquidFullSnapshots':649,
      'secondsChecked':3600,
    }
    for k,v in expected.items():
        if doc.get(k)!=v:raise ValueError('SOURCE_L2_REBUILD_RECONCILIATION_CHANGED:'+k)
    if doc['asterAppliedDeltaPackets']+doc['asterInvalidatedOrDiscardedDeltaPackets']!=doc['asterDeltaReceivedPackets']:
        raise ValueError('SOURCE_DELTA_ACCOUNTING_NOT_COMPLETE')
    if doc['oneSecondSourceConditionCounts']!=EXPECTED:
        raise ValueError('SOURCE_FRESHNESS_STATE_NOT_EXACT')
    buckets=doc['perMinute']
    if len(buckets)!=60 or [r['minuteUtc'] for r in buckets]!=list(range(60)):
        raise ValueError('ONEHOUR_MINUTE_COVERAGE_NOT_PROVEN')
    for key,value in EXPECTED.items():
        if sum(r[key] for r in buckets)!=value or abs(doc['oneSecondSourceConditionPct'][key]-value/36)>0.000001:
            raise ValueError('SOURCE_REBUILD_FRESHNESS_MINUTES_DIVERGED:'+key)
    if any(not 0<=row['pairedSourceFreshState']<=min(row['asterStateFresh'],row['xyzSnapshotFresh'])<=60 for row in buckets):
        raise ValueError('SOURCE_TIME_GRID_INTERSECTION_IMPOSSIBLE')
    if doc['longestPairedSourceUnavailableSeconds']!=1100:
        raise ValueError('EXCESSIVE_SOURCE_BOOK_UNKNOWN_HIDDEN')
    if len(doc['sampleObservationsNotNativeBasis'])!=4:
        raise ValueError('OBSERVED_BASIS_SAMPLE_OVERSTATED')
    for row in doc['sampleObservationsNotNativeBasis']:
        if (not 0<=row['sec']<3600 or
            not Decimal(row['asterBid'])<Decimal(row['asterAsk']) or
            not Decimal(row['xyzBid'])<Decimal(row['xyzAsk']) or
            not 0<=row['asterSourceAgeMs']<=1500 or
            not 0<=row['xyzSourceAgeMs']<=1500):
            raise ValueError('QUOTE_FUTURE_LEAK_OR_CROSSED_BOOK')
    if len(doc.get('reconstructionAssumptions',[]))<4 or len(doc.get('limitations',[]))<4:
        raise ValueError('L2_SOURCE_SEMANTICS_UNDISCLOSED')


def full_snapshot(t:int,seq:int,ask='101',bid='100',bidqty='3',askqty='5'):
    return [(t,'snapshot',None,None,None,seq,'bid',bid,bidqty),
            (t,'snapshot',None,None,None,seq,'ask',ask,askqty)]

def update(t,first,last,prev,rows):
    return [(t,'update',first,last,prev,None,side,price,qty) for side,price,qty in rows]

class V52StrictHistoricalL2SourceOnly(unittest.TestCase):
    def test_exact_reconstruction_hypothesis_hash_and_no_live_claim(self):validate(load())
    def test_book_snapshot_delta_delete_and_sequence_gap_fails_closed(self):
        b=StrictBook()
        self.assertIsNone(b.quote())
        self.assertEqual(b.snapshot(1000,full_snapshot(1000,9)), 'FRESH_REINITIALIZED_SNAPSHOT')
        self.assertEqual(b.quote(),(Decimal('100'),Decimal('101')))
        self.assertEqual(b.snapshot(1005,full_snapshot(1005,9)), 'DUPLICATE_IDENTICAL_SNAPSHOT')
        self.assertEqual(b.update(1010,update(1010,8,9,7,[('bid','100','9')])), 'OLDER_OR_EQUAL_DELTA_SUPERSEDED_BY_SNAPSHOT')
        self.assertEqual(b.quote(),(Decimal('100'),Decimal('101')))
        self.assertEqual(b.update(1020,update(1020,10,11,9,[('ask','102','7'),('ask','101','0')])), 'CONTIGUOUS_DELTA_APPLIED')
        self.assertEqual(b.quote(),(Decimal('100'),Decimal('102')))
        self.assertEqual(b.zero_qty_deletions,1)
        self.assertEqual(b.update(1030,update(1030,20,21,19,[('ask','105','7')])), 'DELTA_SEQUENCE_MISMATCH_WAIT_FOR_SNAPSHOT')
        self.assertIsNone(b.quote())
        self.assertEqual(b.update(1040,update(1040,22,23,21,[('bid','100','7')])), 'INVALID_PENDING_NEW_SNAPSHOT')
        self.assertIsNone(b.quote())
        self.assertEqual(b.snapshot(1050,full_snapshot(1050,23,'106','105')),'FRESH_REINITIALIZED_SNAPSHOT')
        self.assertEqual(b.quote(),(Decimal('105'),Decimal('106')))
    def test_reject_duplicate_snapshot_id_changed_levels_and_invalid_data(self):
        b=StrictBook();b.snapshot(2000,full_snapshot(2000,9))
        with self.assertRaisesRegex(ValueError,'DUPLICATE_SNAPSHOT_ID_CHANGED_PAYLOAD'):
            b.snapshot(2001,full_snapshot(2001,9,ask='103'))
        with self.assertRaisesRegex(ValueError,'DUPLICATE_L2_PRICE_IN_RECEIPT_PACKET'):
            b.update(2010,update(2010,10,11,9,[('bid','100','1'),('bid','100','2')]))
        with self.assertRaisesRegex(ValueError,'NEGATIVE_OR_NONFINITE_L2_LEVEL'):
            b.update(2010,update(2010,10,11,9,[('bid','100','-3')]))
    def test_reject_forged_annual_full_book_fills_or_hidden_12_mixed_clocks(self):
        for field in ('orderAuthority','nativeV52BookParityProven',
                      'actualVenueOrdersOrFillsProven',
                      'fullAnnualTwoVenueFiveStockReconstructionProven',
                      'sharedSevenRunnerAnnualBtComplete','productionEligible'):
            data=copy.deepcopy(load());data[field]=True
            with self.subTest(field=field),self.assertRaises(ValueError):validate(data)
        data=load();data['asterMixedSnapshotAndDeltaSameReceivedClocksQuarantined']=0
        with self.assertRaises(ValueError):validate(data)
        data=load();data['oneSecondSourceConditionCounts']['pairedSourceFreshState']=893
        with self.assertRaises(ValueError):validate(data)

if __name__=='__main__':unittest.main()
