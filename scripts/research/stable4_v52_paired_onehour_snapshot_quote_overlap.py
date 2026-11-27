"""Offline ASTER/xyz same-hour raw FULL-SNAPSHOT quote-overlap on one AMZN hour.

No continuous Aster L2 delta book reconstruct, no executable order/hedge book,
no V52 strategy signal or real fill, no network or trader credentials.
Only both-snapshot quote observations fresh within source V13D 1500ms.
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
SEQUENCE='docs/research/STABLE4_V52_PAIRED_ONEHOUR_L2_SEQUENCE_QUALITY_20261128.json'
SEQUENCE_SHA='f878a19d0174ab655fe772641c78bffe3ec61cbd67bef67d168a60935d4366f8'
ENGINE='scripts/disdex_v13d_v11eq_stock_live_engine.py'
ENGINE_SHA='e1c6f16b5deb514fa636c44a859294fec8ee8f81e0dac3ef405cd55a3056a9d8'


def run(private:Path,packages:Path):
    if not (private.resolve().is_relative_to(Path.home().resolve())
       and packages.resolve().is_relative_to(Path.home().resolve())):
        raise ValueError('OWNER_ROOT_REQUIRED')
    raws=[(p,h) for p,h in ((PROFILE,PROFILE_SHA),(SEQUENCE,SEQUENCE_SHA),(ENGINE,ENGINE_SHA))]
    for p,h in raws:
        if sha256((ROOT/p).read_bytes()).hexdigest()!=h:raise ValueError('SOURCE_INPUT_HASH_CHANGED:'+p)
    engine=(ROOT/ENGINE).read_text(encoding='utf8')
    if not re.search(r'^V13D_MAX_BOOK_AGE_MS\s*=\s*1500\s*$',engine,re.M):
        raise ValueError('V13D_NATIVE_STALE_THRESHOLD_CHANGED')
    profile=json.loads((ROOT/PROFILE).read_bytes())
    sequence=json.loads((ROOT/SEQUENCE).read_bytes())
    if profile['orderAuthority'] is not False or sequence['orderAuthority'] is not False:
        raise ValueError('RESEARCH_SCOPE_INVALID')
    sys.path.insert(0,str(packages))
    import duckdb
    db=duckdb.connect(':memory:')
    groups={}
    for venue in ('ASTER','HYPERLIQUID_XYZ'):
        src=profile['files'][venue]
        path=private/src['localFilename']
        if not path.is_file() or sha256(path.read_bytes()).hexdigest()!=src['sha256']:
            raise ValueError('PRIVATE_L2_SOURCE_BYTES_CHANGED:'+venue)
        sql='''SELECT received_time,
         MAX(CASE WHEN side='bid' THEN TRY_CAST(price AS DOUBLE) ELSE NULL END) AS bid,
         MIN(CASE WHEN side='ask' THEN TRY_CAST(price AS DOUBLE) ELSE NULL END) AS ask,
         SUM(CASE WHEN side='bid' THEN 1 ELSE 0 END) AS n_bid,
         SUM(CASE WHEN side='ask' THEN 1 ELSE 0 END) AS n_ask,
         COUNT(DISTINCT last_update_id) AS snapshot_versions,
         MIN(last_update_id) AS snapshot_id
         FROM read_parquet(?) WHERE event_type='snapshot'
         GROUP BY received_time ORDER BY received_time'''
        data=db.execute(sql,[str(path)]).fetchall()
        expected=sequence['aster']['snapshotClockOccurrences'] if venue=='ASTER' else sequence['hyperliquidXyz']['distinctSnapshots']
        if len(data)!=expected:raise ValueError('SNAPSHOT_CLOCK_GRAIN_CHANGED:'+venue)
        for r in data:
            if not r[1]>0 or not r[2]>r[1] or r[3]<=0 or r[4]<=0 or r[5]!=1:
                raise ValueError('CROSSED_OR_MISSING_SNAPSHOT_BOOK_SIDE:'+venue)
            if venue=='HYPERLIQUID_XYZ' and (r[3]!=20 or r[4]!=20):
                raise ValueError('HYPERLIQUID_TWENTY_LEVEL_DEPTH_CHANGED')
        groups[venue]=data
    hl=groups['HYPERLIQUID_XYZ']
    times=[x[0] for x in hl]
    matched=[]
    for ast in groups['ASTER']:
        t=ast[0]
        idx=bisect_right(times,t)-1
        if idx<0:continue
        x=hl[idx]
        age_ns=t-x[0]
        if not 0<=age_ns<=1_500_000_000:continue
        amid=(ast[1]+ast[2])/2
        hmid=(x[1]+x[2])/2
        ast_spread=(ast[2]-ast[1])/amid*10_000
        hl_spread=(x[2]-x[1])/hmid*10_000
        raw_mid_difference=(amid/hmid-1)*10_000
        matched.append({'asterSnapshotReceivedNs':t,
          'asterSnapshotSequenceId':ast[6],
          'xyzPriorSnapshotReceivedNs':x[0],
          'xyzSnapshotAgeMs':round(age_ns/1e6,6),
          'asterBestBidObserved':ast[1],'asterBestAskObserved':ast[2],
          'xyzBestBidObserved':x[1],'xyzBestAskObserved':x[2],
          'asterRawBidAskSpreadBps':round(ast_spread,6),
          'xyzRawBidAskSpreadBps':round(hl_spread,6),
          'rawPublisherMidDifferenceBpsNotV52Basis':round(raw_mid_difference,6),
          'makerHedgeFillValidated':False})
    unique=len({m['asterSnapshotSequenceId'] for m in matched})
    if len(matched)!=6 or unique!=3:raise ValueError('UNEXPECTED_1P5S_SNAPSHOT_OVERLAP_SHAPE')
    return {'schema':'stable4-v52-public-l2-onehour-snapshot-only-cross-venue-observations/v1',
      'status':'SOURCE_SNAPSHOT_OVERLAP_ONLY_NO_BOOK_REPLAY_OR_NATIVE_BASIS',
      'inputOneHourProfileSha256':PROFILE_SHA,'inputBookSequenceSha256':SEQUENCE_SHA,
      'nativeEngineSha256':ENGINE_SHA,
      'sampleHourUtc':'2026-09-02T16:00:00Z',
      'nativeV13dMaxAgeMs':1500,
      'asterSnapshotReceiveClocks':len(groups['ASTER']),
      'xyzSnapshotReceiveClocks':len(groups['HYPERLIQUID_XYZ']),
      'asterSnapshotReceiptsWithPriorXyzFresh':len(matched),
      'distinctAsterSnapshotSequenceIdsAmongFresh':unique,
      'observations':matched,
      'orderAuthority':False,'nativeV52EntryOrFillProven':False,
      'continuousTwoVenueOrderbookReplayProven':False,
      'oneYearFiveStockCoverageProven':False,'productionEligible':False,
      'limitations':[
        'Only full third-party ASTER snapshot receipt clocks vs latest prior 20/20 Hyperliquid xyz snapshot, NOT reconstructed Aster update stream. Aster snapshot IDs are reused at two receipt clocks; six observations correspond to only three unique snapshot sequence IDs.',
        'Raw source-snapshot bid/ask and mid-price differences are NOT native V52 reference basis, executable maker-side quote, queue position, or hedge fill. 1500ms is a necessary source policy condition, not proof of full book/timestamp consistency.',
        'No source 2s/30s window, no Yahoo/reference clocks, no end-to-end native entry/exits or real account execution, no seven-runner annual wallet, DD/Gross, release, or Owner authorization.',
      ]}

if __name__=='__main__':
    if len(sys.argv)!=4:raise ValueError('PRIVATE_L2_ROOT ISOLATED_PY_PACKAGES NEW_REPORT_PATH')
    r=run(Path(sys.argv[1]),Path(sys.argv[2]))
    with open(sys.argv[3],'x',encoding='utf8',newline='\n') as f:json.dump(r,f,sort_keys=True,indent=2);f.write('\n')
    print('V52_SNAPSHOT_OVERLAP',json.dumps({'asterClocks':r['asterSnapshotReceiveClocks'],
      'xyzClocks':r['xyzSnapshotReceiveClocks'],
      'pairedWithin1500ms':r['asterSnapshotReceiptsWithPriorXyzFresh'],
      'uniqueAsterSnapshotIds':r['distinctAsterSnapshotSequenceIdsAmongFresh']},sort_keys=True))
