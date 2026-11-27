"""Verify sampled ASTER/XYZ source-clock staleness stays narrow and fail-closed.

1-second observed publisher receipt recency is NOT an actual live websocket
freshness or book/liquidity/fill certification. No network in tests.
"""
from __future__ import annotations
import copy
from hashlib import sha256
import json
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
NAME='STABLE4_V52_PUBLIC_PAIRED_ONEHOUR_SOURCE_FRESHNESS_20261128.json'
PIN='fbb17f77e7caf42debee3e5842fe07b063dd6bb8f27421b8fb8b38cd50f4786a'
ENGINE_SHA='e1c6f16b5deb514fa636c44a859294fec8ee8f81e0dac3ef405cd55a3056a9d8'
PROFILE_SHA='59cd3a3008c8a7a465750ae5109767e39418d083487290929b027ec558590860'
SOURCE='scripts/research/stable4_v52_paired_onehour_source_freshness.py'
SOURCE_SHA='b0162638de13133dc3fbad6a88c070a5d79b04d749ed88227d467dbc498ca624'
EXPECTED={'ASTER':3199,'HYPERLIQUID_XYZ':971,'both':893}

def load():
    path=ROOT/'docs/research'/NAME
    raw=path.read_bytes()
    if sha256(raw).hexdigest()!=PIN:raise ValueError('PUBLIC_L2_FRESHNESS_ARTIFACT_CHANGED')
    return json.loads(raw)

def verify(r):
    if (r.get('schema')!='stable4-v52-paired-public-aster-xyz-l2-source-clock-freshness/v1'
        or r.get('status')!='PARTIAL_ONEHOUR_SOURCE_CLOCK_FRESHNESS_NECESSARY_ONLY'
        or r.get('nativeSourcePolicyMaxBookAgeMs')!=1500
        or r.get('pairSampleSha256')!=PROFILE_SHA
        or r.get('nativeStockEngineSha256')!=ENGINE_SHA
        or r.get('sampleHourUtc')!='2026-09-02T16:00:00Z'
        or r.get('sampledEverySeconds')!=1
        or r.get('sampledSeconds')!=3600):
        raise ValueError('STALE_OR_FORGED_V52_L2_FRESHNESS_SCOPE')
    for flag in ('orderAuthority','twoVenueL2SnapshotReplayProven','nativeV52EntryReplayProven',
                 'sharedSevenRunnerAnnualBtComplete','productionEligible'):
        if r.get(flag) is not False:raise ValueError('FALSE_L2_NATIVE_OR_TRADE_AUTHORITY:'+flag)
    if sha256((ROOT/SOURCE).read_bytes()).hexdigest()!=SOURCE_SHA:
        raise ValueError('RESEARCH_FRESHNESS_CALCULATOR_SHA_CHANGED')
    if sha256((ROOT/'docs/research/STABLE4_V52_PUBLIC_PAIRED_ONEHOUR_L2_PROFILE_20261128.json').read_bytes()).hexdigest()!=PROFILE_SHA:
        raise ValueError('PAIRED_L2_DATA_SOURCE_PROFILE_SHA_CHANGED')
    if sha256((ROOT/'scripts/disdex_v13d_v11eq_stock_live_engine.py').read_bytes()).hexdigest()!=ENGINE_SHA:
        raise ValueError('V52_NATIVE_SOURCE_CHANGED')
    counts=r.get('sourceAgeWithin1500msSeconds')
    pct=r.get('sourceAgeWithin1500msPct')
    if counts!=EXPECTED or set(pct or {})!=set(EXPECTED):
        raise ValueError('FRESHNESS_SECOND_COUNTS_CHANGED')
    for key,v in EXPECTED.items():
        if abs(pct[key]-(v/36.0))>0.000001:
            raise ValueError('FRESHNESS_PERCENTAGE_MISMATCH:'+key)
    if counts['both']>min(counts['ASTER'],counts['HYPERLIQUID_XYZ']):
        raise ValueError('INTERSECTION_CANNOT_EXCEED_SINGLE_MARKET')
    buckets=r.get('minuteBuckets')
    if len(buckets)!=60 or [v['utcMinute'] for v in buckets]!=list(range(60)):
        raise ValueError('SOURCE_60MIN_COVERAGE_UNPROVEN')
    sums={k:0 for k in EXPECTED}
    for row in buckets:
        c=row['sourceClockFreshOneSecondTicks']
        if set(c)!=set(EXPECTED):raise ValueError('FRESHNESS_GRANULARITY_CHANGED')
        if any(type(v) is not int or v<0 or v>60 for v in c.values()):
            raise ValueError('IMPOSSIBLE_FRESHNESS_SECOND_COUNT')
        if c['both']>min(c['ASTER'],c['HYPERLIQUID_XYZ']):
            raise ValueError('BAD_FRESHNESS_INTERSECTION')
        for k,v in c.items():sums[k]+=v
    if sums!=EXPECTED:raise ValueError('FRESHNESS_MINUTES_FAIL_RECONCILIATION')
    if r.get('longestConsecutiveBothStaleSeconds')!=262 or max(b['sourceClockFreshOneSecondTicks']['both'] for b in buckets)!=19:
        raise ValueError('VENUE_STALENESS_RISK_CONCEALED')
    decision=r.get('realClockAtSourceWindow')
    if (decision.get('utcClock')!='2026-09-02T16:30:00Z'
      or decision.get('asterAndXyzSourceTimestampsWithin1500ms') is not True
      or decision.get('nativeV52SignalOrFillProven') is not False):
        raise ValueError('V52_REFERENCE_CLOCK_OR_SCOPE_FORGED')
    for venue,age in (('ASTER',190.050885),('HYPERLIQUID_XYZ',778.075113)):
        if abs(decision['lastPublisherReceivedAgeMs'][venue]-age)>0.000001:
            raise ValueError('BOOK_AGE_OBSERVATION_DRIFT:'+venue)

class V52PairedOneHourSourceFreshness(unittest.TestCase):
    def test_exact_pinned_onehour_source_freshness_not_native_trade(self):verify(load())
    def test_reject_false_live_book_or_full_year(self):
        for flag in ('orderAuthority','twoVenueL2SnapshotReplayProven',
          'nativeV52EntryReplayProven','sharedSevenRunnerAnnualBtComplete','productionEligible'):
            d=copy.deepcopy(load());d[flag]=True
            with self.subTest(flag=flag),self.assertRaises(ValueError):verify(d)
    def test_reject_hidden_xyz_staleness_or_future_clock(self):
        d=load();d['sourceAgeWithin1500msSeconds']['both']=d['sourceAgeWithin1500msSeconds']['ASTER']
        with self.assertRaises(ValueError):verify(d)
        d=load();d['minuteBuckets'][0]['sourceClockFreshOneSecondTicks']['both']=60
        with self.assertRaises(ValueError):verify(d)
        d=load();d['realClockAtSourceWindow']['nativeV52SignalOrFillProven']=True
        with self.assertRaises(ValueError):verify(d)

if __name__=='__main__':unittest.main()
