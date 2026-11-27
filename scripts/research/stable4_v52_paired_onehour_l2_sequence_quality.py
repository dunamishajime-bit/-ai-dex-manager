"""Offline V52 ASTER/Hyperliquid public 1h L2 sequence and data-quality audit.

Exact pinned AMZN sample only. Tests Aster per-received-clock update-ID chain
and duplicated snapshot IDs; tests HL full 20+20-level snapshot shape.
No L2 book reconstruction, crossed-spread execution, maker/hedge fill claim,
annual coverage claim, live order/approval/production mutation or network.
"""
from __future__ import annotations
from hashlib import sha256
from pathlib import Path
import json
import sys

ROOT=Path(__file__).resolve().parents[2]
PROFILE='docs/research/STABLE4_V52_PUBLIC_PAIRED_ONEHOUR_L2_PROFILE_20261128.json'
PROFILE_PIN='59cd3a3008c8a7a465750ae5109767e39418d083487290929b027ec558590860'
ENGINE='scripts/disdex_v13d_v11eq_stock_live_engine.py'
ENGINE_PIN='e1c6f16b5deb514fa636c44a859294fec8ee8f81e0dac3ef405cd55a3056a9d8'


def read(private:Path,packages:Path):
    if not (private.resolve().is_relative_to(Path.home().resolve()) and packages.resolve().is_relative_to(Path.home().resolve())):
        raise ValueError('PRIVATE_L2_DATA_AND_TOOLING_MUST_STAY_IN_OWNER_HOME')
    p=(ROOT/PROFILE).read_bytes()
    if sha256(p).hexdigest()!=PROFILE_PIN or sha256((ROOT/ENGINE).read_bytes()).hexdigest()!=ENGINE_PIN:
        raise ValueError('SOURCE_PROFILE_OR_V52_ENGINE_PIN_CHANGED')
    doc=json.loads(p)
    if doc['orderAuthority'] is not False or doc['nativeV52EntryReplayComplete'] is not False:
        raise ValueError('HISTORICAL_L2_DATA_CANNOT_CERTIFY_V52_LIVE')
    sys.path.insert(0,str(packages))
    import duckdb
    db=duckdb.connect(':memory:')
    paths={}
    for v in ('ASTER','HYPERLIQUID_XYZ'):
        desc=doc['files'][v]
        path=private/desc['localFilename']
        if not path.is_file() or sha256(path.read_bytes()).hexdigest()!=desc['sha256']:
            raise ValueError('PRIVATE_HISTORICAL_L2_BYTES_CHANGED:'+v)
        paths[v]=str(path)
    return db,doc,paths


def analyze(private,packages):
    db,doc,paths=read(private,packages)
    a=paths['ASTER'];x=paths['HYPERLIQUID_XYZ']
    ast_updates=db.execute('''SELECT received_time,MIN(first_update_id) AS first,
       MAX(final_update_id) AS final,MIN(prev_final_update_id) AS prior,
       COUNT(DISTINCT prev_final_update_id) AS prior_versions,
       COUNT(DISTINCT first_update_id) AS first_versions,
       COUNT(DISTINCT final_update_id) AS final_versions
       FROM read_parquet(?) WHERE event_type='update'
       GROUP BY received_time ORDER BY received_time''',[a]).fetchall()
    if len(ast_updates)!=39876 or any(row[4:]!=(1,1,1) for row in ast_updates):
        raise ValueError('ASTER_DELTA_PACKETS_NOT_UNIFORMLY_IDENTIFIED')
    ast_snap=db.execute('''SELECT received_time,MIN(last_update_id) AS snapshot_id,
       COUNT(*) AS rows,COUNT(DISTINCT last_update_id) AS id_count,
       COUNT(DISTINCT side) AS sides
       FROM read_parquet(?) WHERE event_type='snapshot'
       GROUP BY received_time ORDER BY received_time''',[a]).fetchall()
    if len(ast_snap)!=38 or any(row[3:]!=(1,2) for row in ast_snap):
        raise ValueError('ASTER_SNAPSHOT_CLOCK_OR_BOTH_SIDES_INVALID')
    all_snapshot_ids={row[1] for row in ast_snap}
    grouped_snap_ids={k:[row[0] for row in ast_snap if row[1]==k] for k in all_snapshot_ids}
    if len(grouped_snap_ids)!=19 or any(len(times)!=2 for times in grouped_snap_ids.values()):
        raise ValueError('ASTER_SNAPSHOT_IDS_NOT_TWO_RECEIPTS_PER_ID')
    gaps=[]
    for preceding,following in zip(ast_updates,ast_updates[1:]):
        if following[3]!=preceding[2]:
            snaps=[s for s in ast_snap if preceding[0]<=s[0]<=following[0]]
            nearest=min(abs(s[0]-following[0]) for s in ast_snap)
            gaps.append({'beforeReceivedNs':preceding[0],
               'afterReceivedNs':following[0],
               'priorUpdateFinalId':preceding[2],
               'nextDeltaDeclaredPriorId':following[3],
               'sourceGapSeconds':round((following[0]-preceding[0])/1e9,6),
               'snapshotsInsideSourceGap':len(snaps),
               'nearestSnapshotToResumedDeltaMs':round(nearest/1e6,6),
               'nativeBookReconciled':False})
    if len(gaps)!=19 or any(r['snapshotsInsideSourceGap']!=2 or r['nearestSnapshotToResumedDeltaMs']>=1000 for r in gaps):
        raise ValueError('ASTER_UPDATE_CHAIN_RESTART_UNACCOUNTED_FOR')
    hl_snap=db.execute('''SELECT received_time,COUNT(*) AS n,
       SUM(CASE WHEN side='bid' THEN 1 ELSE 0 END) AS bid_levels,
       SUM(CASE WHEN side='ask' THEN 1 ELSE 0 END) AS ask_levels,
       COUNT(DISTINCT last_update_id) AS ids
       FROM read_parquet(?) GROUP BY received_time ORDER BY received_time''',[x]).fetchall()
    if len(hl_snap)!=649 or any((r[1],r[2],r[3],r[4])!=(40,20,20,1) for r in hl_snap):
        raise ValueError('HL_XYZ_20_PER_SIDE_SNAPSHOT_SHAPE_CHANGED')
    metrics={}
    for venue,p in [('ASTER',a),('HYPERLIQUID_XYZ',x)]:
        m=db.execute('''SELECT COUNT(*) AS rows,
          SUM(CASE WHEN TRY_CAST(price AS DOUBLE)<=0 THEN 1 ELSE 0 END) AS bad_px,
          SUM(CASE WHEN TRY_CAST(quantity AS DOUBLE)<0 THEN 1 ELSE 0 END) AS bad_q,
          SUM(CASE WHEN TRY_CAST(quantity AS DOUBLE)=0 THEN 1 ELSE 0 END) AS zero_qty,
          SUM(CASE WHEN TRY_CAST(price AS DOUBLE) IS NULL OR TRY_CAST(quantity AS DOUBLE) IS NULL THEN 1 ELSE 0 END) AS nonnum,
          SUM(CASE WHEN received_time < event_time*1000000 THEN 1 ELSE 0 END) AS future,
          MIN((received_time-event_time*1000000)/1000000.0) AS age_min,
          quantile_cont((received_time-event_time*1000000)/1000000.0,0.5) AS age_med,
          quantile_cont((received_time-event_time*1000000)/1000000.0,0.95) AS age_p95,
          MAX((received_time-event_time*1000000)/1000000.0) AS age_max
          FROM read_parquet(?)''',[p]).fetchone()
        if (m[0]!=doc['profile'][venue]['rows'] or any(m[i] for i in (1,2,4,5))
            or m[6]<0 or m[9]<m[8] or m[8]<m[7]):
            raise ValueError('PAIR_L2_ROW_VALIDITY_OR_CLOCK_CORRUPTION:'+venue)
        metrics[venue]={
            'rows':m[0],'nonPositivePrices':m[1],'negativeQuantities':m[2],
            'zeroQuantityLevelRows':m[3],'unparseablePriceOrQuantity':m[4],
            'receivedBeforeSourceEventRows':m[5],
            'receivedMinusEventTimeMs':{'min':round(m[6],6),'median':round(m[7],6),
             'p95':round(m[8],6),'max':round(m[9],6)},
        }
    report={
      'schema':'stable4-v52-paired-onehour-l2-source-update-sequence-quality/v1',
      'status':'PARTIAL_ONE_HOUR_SEQUENCE_AUDIT_WITH_RESTARTS_NOT_RECONSTRUCTED_BOOK',
      'inputPairedHourlyProfileSha256':PROFILE_PIN,'nativeStockEngineSha256':ENGINE_PIN,
      'hourUtc':'2026-09-02T16:00:00Z',
      'aster':{
         'deltaPackets':len(ast_updates),'updateChainBreaks':len(gaps),
         'snapshotClockOccurrences':len(ast_snap),
         'distinctSnapshotSequenceIds':len(grouped_snap_ids),
         'snapshotIdsRepeatedAtTwoReceiveClocks':sum(len(x)==2 for x in grouped_snap_ids.values()),
         'restartGapsWithTwoSnapshotReceipts':sum(r['snapshotsInsideSourceGap']==2 for r in gaps),
         'updateBreaks':gaps,
       },
      'hyperliquidXyz':{
         'distinctSnapshots':len(hl_snap),'exactTwentyBidAndAskLevels':len(hl_snap),
         'incrementalBookUpdatesInSample':0,
       },
      'venueRowHealth':metrics,'orderAuthority':False,
      'fullHistoricalL2BookReplayCertified':False,
      'nativeV52EntryOrHedgeFillProven':False,'annualFiveStockPairedCoverageProven':False,
      'productionEligible':False,
      'limitations':[
        'The 19 ASTER delta-chain nonadjacent prev-final IDs coincide with two snapshot receipt clocks per gap. Sequence resets require independently correct snapshot application and cancellation handling; no book was reconstructed.',
        'Distinct snapshot IDs at two Aster receipt clocks do NOT prove identical payloads or duplicate live orderbook states; publisher/reconnect semantics and empty-book clearing require further validation.',
        'Hyperliquid 649 same-hour received clocks contain exactly 20 bid+20 ask level rows each, but event snapshots are not guaranteed to be true exchange-synchronized books. No order updates were provided in this file.',
        'Row-level received-event lag summarizes third-party publisher event/ingestion delay; separate 1-second both-venue freshness is a necessary V13D condition, not a fill or native trade.',
        'No continuous annual source coverage, reference feeds, per-trader maker queue, hedge orders, fees/slippage, seven-runner DD/Gross, production or Owner approval.',
      ]}
    return report

if __name__=='__main__':
    if len(sys.argv)!=4:raise ValueError('PRIVATE_L2_DATA_ROOT ISOLATED_PYTHON_PACKAGES NEW_REPORT_PATH_REQUIRED')
    r=analyze(Path(sys.argv[1]),Path(sys.argv[2]))
    with open(sys.argv[3],'x',encoding='utf8',newline='\n') as f:json.dump(r,f,sort_keys=True,indent=2);f.write('\n')
    print('L2_SEQUENCE',json.dumps({'asterPackets':r['aster']['deltaPackets'],
      'asterChainBreaks':r['aster']['updateChainBreaks'],
      'asterSnapshotReceiveClocks':r['aster']['snapshotClockOccurrences'],
      'uniqueSnapshotIds':r['aster']['distinctSnapshotSequenceIds'],
      'xyzSnapshots':r['hyperliquidXyz']['distinctSnapshots'],
      'sourceLatency':{k:v['receivedMinusEventTimeMs'] for k,v in r['venueRowHealth'].items()}},sort_keys=True))
