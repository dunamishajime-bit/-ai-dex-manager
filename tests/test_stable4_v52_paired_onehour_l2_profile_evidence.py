"""Offline provenance and safety contract for paired public AMZN L2 sample.

93k+26k rows on one hour do not prove a year of native V52 trading, real
maker/hedge executions or execution-quality book parity.
"""
from __future__ import annotations
import copy
from hashlib import sha256
import json
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
NAME='STABLE4_V52_PUBLIC_PAIRED_ONEHOUR_L2_PROFILE_20261128.json'
PIN='59cd3a3008c8a7a465750ae5109767e39418d083487290929b027ec558590860'
PROBE_SOURCE='scripts/research/stable4_v52_public_paired_l2_onehour_profile.py'
PROBE_SOURCE_PIN='38cc9a1e74e17da45d73524c9bf53b7086f00bba9d450754854a130bfc85ed0e'
PAIR_SAMPLE_PIN='96f7ce8af39a04da8135e974877b2576c58d2fe43dee9d2561b621c370ac989f'
MARKETS={'ASTER':('AMZNUSDT',93372,39902,'7334077a62b095dac84a1706c0e00de6bd7a3d4fdeb1728e3221d291a4e677e5',1653986),
         'HYPERLIQUID_XYZ':('xyz:AMZN',25960,649,'e191f12d0522fe0f1e918002935c76c22cdf7e44931945277735b3d5fa059ab3',115815)}
COLUMNS={'received_time','event_time','transaction_time','symbol','event_type','first_update_id','final_update_id','prev_final_update_id','last_update_id','side','price','quantity','order_count'}
START=1788364800000000000
END=1788368400000000000

def load():
    b=(ROOT/'docs/research'/NAME).read_bytes()
    if sha256(b).hexdigest()!=PIN:raise ValueError('L2_SAMPLE_RESEARCH_SHA_CHANGED')
    return json.loads(b)

def validate(d):
    if (d.get('schema')!='stable4-v52-public-paired-onehour-l2-data-profile/v1'
       or d.get('status')!='PARTIAL_SOURCE_CANDIDATE_ONE_HOUR_NOT_NATIVE_V52_BT'
       or d.get('sampleHourUtc')!='2026-09-02T16:00:00Z'
       or d.get('sourcePin')!=PAIR_SAMPLE_PIN
       or d.get('duckdbVersion')!='1.4.3'):
        raise ValueError('SOURCE_PROFILE_SCHEMA_SCOPE')
    for flag in ('nativeV52EntryReplayComplete','fullSevenRunnerAnnualBtComplete',
                 'executionOrFillProven','productionEligible','orderAuthority'):
        if d.get(flag) is not False:raise ValueError('FALSE_LIVE_OR_NATIVE_CERTIFICATION:'+flag)
    code=(ROOT/PROBE_SOURCE).read_bytes()
    if sha256(code).hexdigest()!=PROBE_SOURCE_PIN:raise ValueError('READ_ONLY_SOURCE_CODE_CHANGED')
    if set(d.get('files',{}))!=set(MARKETS) or set(d.get('profile',{}))!=set(MARKETS):
        raise ValueError('SOURCE_PAIRED_MARKET_MISSING')
    paired=(ROOT/'docs/research/STABLE4_V52_PUBLIC_ASTER_XYZ_PAIRED_L2_SAMPLES_20261128.json').read_bytes()
    if sha256(paired).hexdigest()!=PAIR_SAMPLE_PIN:raise ValueError('PUBLIC_SOURCE_SAMPLE_PROVENANCE_CHANGED')
    for venue,(name,expected_rows,clocks,digest,byte_count) in MARKETS.items():
        m=d['files'][venue];r=d['profile'][venue]
        if (m.get('expectedMarket')!=name or m.get('sha256')!=digest
            or m.get('byteLength')!=byte_count or m.get('parquetHeadTailMagic') is not True
            or m.get('signedFillProof') is not False or r.get('sourceSha256')!=digest):
            raise ValueError('RAW_PUBLIC_FILE_SHA_OR_SIZE_INVALID:'+venue)
        if (r.get('rows')!=expected_rows or r.get('distinctReceivedClocks')!=clocks
            or r.get('sourceVenueMarket')!=name or set(r.get('parquetColumns',[]))!=COLUMNS
            or r.get('nullPricesOrQuantity')!=0):
            raise ValueError('PARQUET_ROW_SCHEMA_OR_MARKET_INVALID:'+venue)
        if not START<=r['receivedMin']<r['receivedMax']<END:
            raise ValueError('RAW_L2_SAMPLE_OUTSIDE_REQUIRED_HOUR:'+venue)
        if (r.get('snapshotReconstructionCertified') is not False
            or r.get('nativeV52OrdersOrFillsVerified') is not False):
            raise ValueError('FALSE_L2_BOOK_OR_EXECUTION_RECONCILIATION:'+venue)
        kinds={x['eventType']:0 for x in r['eventsByTypeAndSide']}
        count=0
        for x in r['eventsByTypeAndSide']:
            if x['side'] not in ('bid','ask') or x['eventType'] not in ('snapshot','update'):
                raise ValueError('UNKNOWN_L2_BOOK_EVENT:'+venue)
            kinds[x['eventType']]+=x['count'];count+=x['count']
        if count!=expected_rows or kinds['snapshot']<=0:
            raise ValueError('L2_EVENT_ROW_COUNT_DIVERGED:'+venue)
        if (venue=='ASTER' and kinds.get('update',0)<=0) or (venue=='HYPERLIQUID_XYZ' and kinds.get('update',0)!=0):
            raise ValueError('L2_PUBLISHER_EVENT_TYPE_MODEL_DIVERGED:'+venue)
        if r['maxUniqueReceiveClockGapRaw']<=2_000_000_000:
            raise ValueError('REPORTED_MAX_BOOK_AGE_RISK_HIDDEN:'+venue)

class V52PairedOneHourL2SourceProfileEvidence(unittest.TestCase):
    def test_readonly_paired_aster_xyz_hourly_parquet(self):validate(load())
    def test_reject_claim_of_annual_or_live(self):
        for flag in ('nativeV52EntryReplayComplete','fullSevenRunnerAnnualBtComplete','executionOrFillProven','productionEligible','orderAuthority'):
            d=copy.deepcopy(load());d[flag]=True
            with self.subTest(flag=flag),self.assertRaises(ValueError):validate(d)
    def test_reject_false_snapshot_or_market(self):
        d=load();d['profile']['ASTER']['snapshotReconstructionCertified']=True
        with self.assertRaises(ValueError):validate(d)
        d=load();d['profile']['HYPERLIQUID_XYZ']['rows']-=1
        with self.assertRaises(ValueError):validate(d)

if __name__=='__main__':unittest.main()
