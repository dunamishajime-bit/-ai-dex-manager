"""Source-clock freshness necessary-condition audit for one paired ASTER/xyz hour.

Compares historical third-party RECEIVED timestamps at 1-second closed clocks
against V13D's actual 1500 ms book-freshness threshold. This is NOT a reconstructed
bid/ask book or executable maker/hedge fill; a fresh timestamp is necessary but
not sufficient for true V52 route eligibility.
"""
from __future__ import annotations
from bisect import bisect_right
from hashlib import sha256
import json
from pathlib import Path
import re
import sys

ROOT=Path(__file__).resolve().parents[2]
PROFILE='docs/research/STABLE4_V52_PUBLIC_PAIRED_ONEHOUR_L2_PROFILE_20261128.json'
PROFILE_SHA='59cd3a3008c8a7a465750ae5109767e39418d083487290929b027ec558590860'
ENGINE='scripts/disdex_v13d_v11eq_stock_live_engine.py'
ENGINE_SHA='e1c6f16b5deb514fa636c44a859294fec8ee8f81e0dac3ef405cd55a3056a9d8'
HOUR_NS=1788364800000000000
SECOND_NS=1_000_000_000


def calc(private_root:Path,packages:Path):
    a=(ROOT/PROFILE).read_bytes();b=(ROOT/ENGINE).read_bytes()
    if sha256(a).hexdigest()!=PROFILE_SHA or sha256(b).hexdigest()!=ENGINE_SHA:
        raise ValueError('SOURCE_PROFILE_OR_NATIVE_V52_ENGINE_CHANGED')
    native=b.decode('utf8')
    match=re.search(r'^V13D_MAX_BOOK_AGE_MS\s*=\s*(\d+)\s*$',native,re.M)
    if not match or int(match.group(1))!=1500:raise ValueError('V13D_MAX_BOOK_AGE_POLICY_CHANGED')
    profile=json.loads(a)
    if profile['orderAuthority'] is not False or profile['nativeV52EntryReplayComplete'] is not False:
        raise ValueError('SOURCE_PROFILE_SCOPE_INVALID')
    if not private_root.resolve().is_relative_to(Path.home().resolve()) or not packages.resolve().is_relative_to(Path.home().resolve()):
        raise ValueError('PRIVATE_MARKET_DATA_MUST_STAY_IN_OWNER_HOME')
    sys.path.insert(0,str(packages))
    import duckdb
    db=duckdb.connect(':memory:')
    clocks={}
    for venue in ('ASTER','HYPERLIQUID_XYZ'):
        source=profile['files'][venue]
        path=private_root/source['localFilename']
        if not path.is_file() or sha256(path.read_bytes()).hexdigest()!=source['sha256']:
            raise ValueError('PRIVATE_L2_FILE_SHA_MISMATCH:'+venue)
        rows=db.execute('SELECT DISTINCT received_time FROM read_parquet(?) ORDER BY received_time',[str(path)]).fetchall()
        ts=[int(r[0]) for r in rows]
        if not ts or len(ts)!=profile['profile'][venue]['distinctReceivedClocks'] or ts[0]!=profile['profile'][venue]['receivedMin'] or ts[-1]!=profile['profile'][venue]['receivedMax']:
            raise ValueError('SOURCE_RECEIVED_CLOCK_GRAIN_INVALID:'+venue)
        if not HOUR_NS<=ts[0]<ts[-1]<HOUR_NS+3600*SECOND_NS:
            raise ValueError('SOURCE_SAMPLE_CLOCK_OUTSIDE_HOUR:'+venue)
        clocks[venue]=ts
    freshness_ns=1500*1_000_000
    stats={k:0 for k in ('ASTER','HYPERLIQUID_XYZ','both')}
    bins=[]
    longest_stale=0;run_stale=0
    decision=None
    for minute in range(60):
        count={k:0 for k in stats}
        for second_of_minute in range(60):
            second=minute*60+second_of_minute
            now=HOUR_NS+second*SECOND_NS
            ages={}
            fresh={}
            for venue in clocks:
                ix=bisect_right(clocks[venue],now)-1
                age=(now-clocks[venue][ix]) if ix>=0 else None
                if age is not None and age<0:raise ValueError('FUTURE_TIMESTAMP_LEAKAGE')
                ages[venue]=age
                fresh[venue]=age is not None and age<=freshness_ns
                if fresh[venue]:
                    stats[venue]+=1;count[venue]+=1
            pair=fresh['ASTER'] and fresh['HYPERLIQUID_XYZ']
            if pair:stats['both']+=1;count['both']+=1;run_stale=0
            else:run_stale+=1;longest_stale=max(longest_stale,run_stale)
            if second==1800:
                decision={'utcClock':'2026-09-02T16:30:00Z',
                    'lastPublisherReceivedAgeMs':{v:(ages[v]/1_000_000 if ages[v] is not None else None) for v in clocks},
                    'asterAndXyzSourceTimestampsWithin1500ms':pair,
                    'nativeV52SignalOrFillProven':False}
        bins.append({'utcMinute':minute,'sourceClockFreshOneSecondTicks':count})
    if sum(x['sourceClockFreshOneSecondTicks']['both'] for x in bins)!=stats['both'] or decision is None:
        raise ValueError('FRESHNESS_ACCOUNTING_CONFLICT')
    return {'schema':'stable4-v52-paired-public-aster-xyz-l2-source-clock-freshness/v1',
        'status':'PARTIAL_ONEHOUR_SOURCE_CLOCK_FRESHNESS_NECESSARY_ONLY',
        'pairSampleSha256':PROFILE_SHA,'nativeStockEngineSha256':ENGINE_SHA,
        'nativeSourcePolicyMaxBookAgeMs':1500,
        'sampleHourUtc':'2026-09-02T16:00:00Z','sampledEverySeconds':1,
        'sampledSeconds':3600,'sourceAgeWithin1500msSeconds':stats,
        'sourceAgeWithin1500msPct':{k:round(100*v/3600,6) for k,v in stats.items()},
        'longestConsecutiveBothStaleSeconds':longest_stale,
        'realClockAtSourceWindow':decision,
        'minuteBuckets':bins,'orderAuthority':False,
        'twoVenueL2SnapshotReplayProven':False,'nativeV52EntryReplayProven':False,
        'sharedSevenRunnerAnnualBtComplete':False,'productionEligible':False,
        'limitations':[
         'Historical publisher received_time is NOT the exact native live Aster/XYZ websocket receipt clock. At 1-second grid, recent RECEIVED timestamp is a necessary observation, not a valid 20-level book or executable quote.',
         'V13D uses a strict 1,500 ms source-book age gate; crossed quotes, missing-book clears, unknown sequence resets, maker queue, reference freshness and hedge flow are NOT replayed.',
         'One public AMZN paired NY market-hour sample only. The 2025-10 to 2026-10 complete 5-symbol pair does not exist in this evidence. No venue fills, account Gross/DD or OWNER release certification.',
        ]}

if __name__=='__main__':
    if len(sys.argv)!=4:raise ValueError('PRIVATE_L2_ROOT ISOLATED_PY_PACKAGES NEW_SOURCE_EVIDENCE_OUTPUT_REQUIRED')
    report=calc(Path(sys.argv[1]),Path(sys.argv[2]))
    with open(sys.argv[3],'x',encoding='utf8',newline='\n') as f:json.dump(report,f,sort_keys=True,indent=2);f.write('\n')
    print('V52_ONE_HOUR_SOURCE_CLOCKS',json.dumps({'ticks':report['sourceAgeWithin1500msSeconds'],'pct':report['sourceAgeWithin1500msPct'],'decisionClock':report['realClockAtSourceWindow'],'longestBothStaleSeconds':report['longestConsecutiveBothStaleSeconds']},sort_keys=True))
