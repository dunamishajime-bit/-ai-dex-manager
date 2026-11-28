"""Only three unique ASTER snapshot IDs align to recent xyz full snapshots.

Protect against promoting six duplicate receipt rows to executable V52 trades,
complete native maker/hedge book state, or continuous five-stock annual coverage.
"""
from __future__ import annotations
from collections import Counter
from hashlib import sha256
from pathlib import Path
import copy,json,unittest

ROOT=Path(__file__).resolve().parents[1]
REPORT='STABLE4_V52_PAIRED_ONEHOUR_SNAPSHOT_QUOTE_OVERLAP_20261128.json'
PIN='fe360a564e6999b518cab16ef403bf34d6381773af6231017fb6b22f323de95b'
SCRIPT='scripts/research/stable4_v52_paired_onehour_snapshot_quote_overlap.py'
SCRIPT_SHA='d1f536d3756caf569792216289eb6edef826d32bba548dbfd11555201e9611ed'
PROFILE='docs/research/STABLE4_V52_PUBLIC_PAIRED_ONEHOUR_L2_PROFILE_20261128.json'
PROFILE_SHA='59cd3a3008c8a7a465750ae5109767e39418d083487290929b027ec558590860'
SEQUENCE='docs/research/STABLE4_V52_PAIRED_ONEHOUR_L2_SEQUENCE_QUALITY_20261128.json'
SEQUENCE_SHA='f878a19d0174ab655fe772641c78bffe3ec61cbd67bef67d168a60935d4366f8'
ENGINE='scripts/disdex_v13d_v11eq_stock_live_engine.py'
ENGINE_SHA='e1c6f16b5deb514fa636c44a859294fec8ee8f81e0dac3ef405cd55a3056a9d8'

def load():
    raw=(ROOT/'docs/research'/REPORT).read_bytes()
    if sha256(raw).hexdigest()!=PIN:raise ValueError('L2_SNAPSHOT_OBSERVATIONS_SHA_MISMATCH')
    return json.loads(raw)

def verify(d):
    if (d.get('schema')!='stable4-v52-public-l2-onehour-snapshot-only-cross-venue-observations/v1'
       or d.get('status')!='SOURCE_SNAPSHOT_OVERLAP_ONLY_NO_BOOK_REPLAY_OR_NATIVE_BASIS'
       or d.get('sampleHourUtc')!='2026-09-02T16:00:00Z'
       or d.get('nativeV13dMaxAgeMs')!=1500
       or d.get('inputOneHourProfileSha256')!=PROFILE_SHA
       or d.get('inputBookSequenceSha256')!=SEQUENCE_SHA
       or d.get('nativeEngineSha256')!=ENGINE_SHA):
        raise ValueError('SOURCE_SNAPSHOT_SCOPE_UNTRUSTED')
    for k in ('orderAuthority','nativeV52EntryOrFillProven',
              'continuousTwoVenueOrderbookReplayProven','oneYearFiveStockCoverageProven',
              'productionEligible'):
        if d.get(k) is not False:raise ValueError('SAMPLE_PRETENDS_TO_BE_NATIVE_V52:'+k)
    for f,h in ((SCRIPT,SCRIPT_SHA),(PROFILE,PROFILE_SHA),(SEQUENCE,SEQUENCE_SHA),(ENGINE,ENGINE_SHA)):
        if sha256((ROOT/f).read_bytes()).hexdigest()!=h:
            raise ValueError('SAMPLE_SOURCE_INPUT_SHA_CHANGED:'+f)
    if d.get('asterSnapshotReceiveClocks')!=38 or d.get('xyzSnapshotReceiveClocks')!=649:
        raise ValueError('SNAPSHOT_CLOCK_SCOPE_CHANGED')
    if d.get('asterSnapshotReceiptsWithPriorXyzFresh')!=6 or d.get('distinctAsterSnapshotSequenceIdsAmongFresh')!=3:
        raise ValueError('FALSE_CORRELATED_SNAPSHOT_COVERAGE')
    rows=d['observations']
    if len(rows)!=6 or len({r['asterSnapshotReceivedNs'] for r in rows})!=6:
        raise ValueError('DUPLICATED_L2_SNAPSHOT_RECEIPT_CLOCK')
    counts=Counter(x['asterSnapshotSequenceId'] for x in rows)
    if len(counts)!=3 or set(counts.values())!={2}:
        raise ValueError('SNAPSHOT_ID_DUPLICATE_NOT_EXPOSED')
    for r in rows:
        if (r['makerHedgeFillValidated'] is not False
          or not 0<=r['xyzSnapshotAgeMs']<=1500.0
          or r['asterSnapshotReceivedNs'] < r['xyzPriorSnapshotReceivedNs']
          or abs((r['asterSnapshotReceivedNs']-r['xyzPriorSnapshotReceivedNs'])/1_000_000-r['xyzSnapshotAgeMs'])>0.000001):
            raise ValueError('L2_SNAPSHOT_FUTURE_LOOKAHEAD_OR_FILL')
        if (not 0<r['asterBestBidObserved']<r['asterBestAskObserved']
            or not 0<r['xyzBestBidObserved']<r['xyzBestAskObserved']):
            raise ValueError('CROSSED_OR_MISSING_BID_ASK')
        for pre,bid,ask,spread in (
            ('ASTER',r['asterBestBidObserved'],r['asterBestAskObserved'],r['asterRawBidAskSpreadBps']),
            ('XYZ',r['xyzBestBidObserved'],r['xyzBestAskObserved'],r['xyzRawBidAskSpreadBps'])):
            expected=(ask-bid)/((ask+bid)/2)*10_000
            if abs(expected-spread)>0.000001:
                raise ValueError('SOURCE_SNAPSHOT_SPREAD_CALC_WRONG:'+pre)
        mid_a=(r['asterBestBidObserved']+r['asterBestAskObserved'])/2
        mid_x=(r['xyzBestBidObserved']+r['xyzBestAskObserved'])/2
        if abs((mid_a/mid_x-1)*10_000-r['rawPublisherMidDifferenceBpsNotV52Basis'])>0.000001:
            raise ValueError('SOURCE_PAIR_MID_DIFFERENCE_NOT_IDENTICAL')

class V52PairedSnapshotQuoteOverlap(unittest.TestCase):
    def test_exact_source_pin_3_unique_ids_6_receipts_only(self):verify(load())
    def test_reject_live_and_false_full_book_replay(self):
        for flag in ('orderAuthority','nativeV52EntryOrFillProven',
          'continuousTwoVenueOrderbookReplayProven','oneYearFiveStockCoverageProven','productionEligible'):
            d=copy.deepcopy(load());d[flag]=True
            with self.subTest(flag=flag),self.assertRaises(ValueError):verify(d)
    def test_reject_future_orderbook_or_fake_six_trades(self):
        d=load();d['observations'][0]['makerHedgeFillValidated']=True
        with self.assertRaises(ValueError):verify(d)
        d=load();d['observations'][0]['xyzSnapshotAgeMs']=-2
        with self.assertRaises(ValueError):verify(d)
        d=load();d['distinctAsterSnapshotSequenceIdsAmongFresh']=6
        with self.assertRaises(ValueError):verify(d)

if __name__=='__main__':unittest.main()
