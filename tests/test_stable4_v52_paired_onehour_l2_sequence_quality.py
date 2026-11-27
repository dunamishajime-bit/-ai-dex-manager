"""Guard native V52 from falsely certifying reconnected third-party L2 history."""
from __future__ import annotations
from hashlib import sha256
from pathlib import Path
import copy
import json
import unittest

ROOT=Path(__file__).resolve().parents[1]
FILE='STABLE4_V52_PAIRED_ONEHOUR_L2_SEQUENCE_QUALITY_20261128.json'
PIN='f878a19d0174ab655fe772641c78bffe3ec61cbd67bef67d168a60935d4366f8'
SCRIPT='scripts/research/stable4_v52_paired_onehour_l2_sequence_quality.py'
SCRIPT_PIN='6b7be3ee1e8d8d30e2e0a3dcdecec2c6f842e490d96c820caf32222d1fc25e16'
PROFILE='docs/research/STABLE4_V52_PUBLIC_PAIRED_ONEHOUR_L2_PROFILE_20261128.json'
PROFILE_SHA='59cd3a3008c8a7a465750ae5109767e39418d083487290929b027ec558590860'
ENGINE='scripts/disdex_v13d_v11eq_stock_live_engine.py'
ENGINE_SHA='e1c6f16b5deb514fa636c44a859294fec8ee8f81e0dac3ef405cd55a3056a9d8'

def read():
    b=(ROOT/'docs/research'/FILE).read_bytes()
    if sha256(b).hexdigest()!=PIN:raise ValueError('L2_CHAIN_EVIDENCE_HASH_CHANGED')
    return json.loads(b)

def verify(x):
    if (x.get('schema')!='stable4-v52-paired-onehour-l2-source-update-sequence-quality/v1'
        or x.get('status')!='PARTIAL_ONE_HOUR_SEQUENCE_AUDIT_WITH_RESTARTS_NOT_RECONSTRUCTED_BOOK'
        or x.get('hourUtc')!='2026-09-02T16:00:00Z'
        or x.get('inputPairedHourlyProfileSha256')!=PROFILE_SHA
        or x.get('nativeStockEngineSha256')!=ENGINE_SHA):
        raise ValueError('V52_L2_SOURCE_CHAIN_SCOPE_ORIGIN_CHANGED')
    for key in ('orderAuthority','fullHistoricalL2BookReplayCertified',
                'nativeV52EntryOrHedgeFillProven','annualFiveStockPairedCoverageProven',
                'productionEligible'):
        if x.get(key) is not False:raise ValueError('FALSE_V52_NATIVE_REPLAY_OR_LIVE:'+key)
    if sha256((ROOT/SCRIPT).read_bytes()).hexdigest()!=SCRIPT_PIN:
        raise ValueError('SOURCE_CHAIN_AUDITOR_CHANGED')
    for rel,expected in ((PROFILE,PROFILE_SHA),(ENGINE,ENGINE_SHA)):
        if sha256((ROOT/rel).read_bytes()).hexdigest()!=expected:
            raise ValueError('SOURCE_CHAIN_INPUT_SHA_CHANGED:'+rel)
    a=x['aster'];h=x['hyperliquidXyz']
    if (a['deltaPackets']!=39876 or a['updateChainBreaks']!=19 or
        a['snapshotClockOccurrences']!=38 or a['distinctSnapshotSequenceIds']!=19 or
        a['snapshotIdsRepeatedAtTwoReceiveClocks']!=19 or
        a['restartGapsWithTwoSnapshotReceipts']!=19 or
        len(a['updateBreaks'])!=19):
        raise ValueError('ASTER_SOURCE_RESTARTS_NOT_CERTIFIED')
    for gap in a['updateBreaks']:
        if not (gap['nativeBookReconciled'] is False and
                gap['priorUpdateFinalId']!=gap['nextDeltaDeclaredPriorId'] and
                gap['beforeReceivedNs']<gap['afterReceivedNs'] and
                gap['snapshotsInsideSourceGap']==2 and
                0<=gap['nearestSnapshotToResumedDeltaMs']<1000):
            raise ValueError('ASTER_UNRESOLVED_UPDATE_ID_BREAK_CONCEALED')
    if (h['distinctSnapshots']!=649 or h['exactTwentyBidAndAskLevels']!=649
        or h['incrementalBookUpdatesInSample']!=0):
        raise ValueError('HL_20_LEVEL_SNAPSHOT_GRAIN_CHANGED')
    health=x['venueRowHealth']
    for v,n,zero,med,p95 in (('ASTER',93372,8992,129.823043,145.457142),
                              ('HYPERLIQUID_XYZ',25960,0,994.176107,1233.253772)):
        a=health[v]
        if a['rows']!=n or a['zeroQuantityLevelRows']!=zero:
            raise ValueError('SOURCE_BOOK_ROW_QUALITY_CHANGED:'+v)
        if any(a[key]!=0 for key in ('negativeQuantities','nonPositivePrices',
            'receivedBeforeSourceEventRows','unparseablePriceOrQuantity')):
            raise ValueError('INVALID_SOURCE_BOOK_ROW:'+v)
        if (abs(a['receivedMinusEventTimeMs']['median']-med)>0.000001 or
            abs(a['receivedMinusEventTimeMs']['p95']-p95)>0.000001 or
            a['receivedMinusEventTimeMs']['max']<p95):
            raise ValueError('RECEIVED_TO_SOURCE_CLOCK_LAG_DRIFT:'+v)

class V52OnehourL2SequenceQuality(unittest.TestCase):
    def test_source_chain_and_known_snapshot_restart_gaps(self):verify(read())
    def test_reject_fake_native_book_fill_and_annual_certification(self):
        for field in ('orderAuthority','fullHistoricalL2BookReplayCertified',
         'nativeV52EntryOrHedgeFillProven','annualFiveStockPairedCoverageProven',
         'productionEligible'):
            d=copy.deepcopy(read());d[field]=True
            with self.subTest(field=field),self.assertRaises(ValueError):verify(d)
    def test_reject_hidden_reset_or_future_received_time(self):
        d=read();d['aster']['updateBreaks'][0]['nativeBookReconciled']=True
        with self.assertRaises(ValueError):verify(d)
        d=read();d['aster']['updateChainBreaks']=0
        with self.assertRaises(ValueError):verify(d)
        d=read();d['venueRowHealth']['HYPERLIQUID_XYZ']['receivedBeforeSourceEventRows']=1
        with self.assertRaises(ValueError):verify(d)

if __name__=='__main__':unittest.main()
