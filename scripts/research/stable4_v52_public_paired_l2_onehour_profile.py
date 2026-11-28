"""Public no-credential V52 ASTER/Hyperliquid xyz hourly L2 source profile.

Download exactly two explicitly capped source files (AMZN pair on 2026-09-02
16:00 UTC) into owner user-root; hash and read via an isolated DuckDB wheel.
No order endpoints, queue/fill inference, no bulk yearly acquisition.
"""
from __future__ import annotations
from datetime import datetime,timezone
from hashlib import sha256
import json
from pathlib import Path
import sys
import urllib.request

ROOT=Path(__file__).resolve().parents[2]
ONE_HOUR='2026-09-02T16:00:00Z'
BASE='https://api.cryptohftdata.com/download?file='
PAIRS={
 'ASTER':('aster_futures/2026-09-02/16/AMZNUSDT_orderbook.parquet','ASTER_AMZNUSDT_20260902_16.parquet',1653986,'AMZNUSDT'),
 'HYPERLIQUID_XYZ':('hyperliquid_futures/2026-09-02/16/xyz:AMZN_orderbook.parquet','HL_XYZ_AMZN_20260902_16.parquet',115815,'xyz:AMZN'),
}
SOURCE='docs/research/STABLE4_V52_PUBLIC_ASTER_XYZ_PAIRED_L2_SAMPLES_20261128.json'
PIN='96f7ce8af39a04da8135e974877b2576c58d2fe43dee9d2561b621c370ac989f'

def download_pair(target:Path):
    proof=(ROOT/SOURCE).read_bytes()
    if sha256(proof).hexdigest()!=PIN:raise ValueError('PAIR_SAMPLE_PROVENANCE_SHA_MISMATCH')
    p=json.loads(proof)
    for venue,(remote,_,length,sym) in PAIRS.items():
        rs=[x for x in p['pairObservations'] if x['dateUtc']=='2026-09-02' and x['hourUtc']==16 and x['venue']==venue and x['base']=='AMZN']
        if len(rs)!=1 or rs[0]['status']!='PARQUET_FRAME_HEADER_ONLY' or rs[0]['fileLengthBytes']!=length or rs[0]['datasetFile']!=remote:
            raise ValueError('PUBLISHER_SAMPLE_PATH_OR_SIZE_CHANGED')
    if not target.resolve().is_relative_to(Path.home().resolve()):raise ValueError('OUTPUT_MUST_BE_UNDER_OWNER_HOME')
    target.mkdir(parents=True,exist_ok=True)
    downloads={}
    for venue,(remote,local,length,sym) in PAIRS.items():
        url=BASE+remote
        req=urllib.request.Request(url,headers={'User-Agent':'DisDexV52L2SourceProfileReadOnly/1.0'})
        with urllib.request.urlopen(req,timeout=22) as r:
            if r.status!=200:raise ValueError('SOURCE_DOWNLOAD_HTTP_NOT_200')
            contents=r.read(6_000_001)
        if len(contents)>6_000_000 or len(contents)!=length or contents[:4]!=b'PAR1' or contents[-4:]!=b'PAR1':
            raise ValueError('SOURCE_PARQUET_PAYLOAD_REJECTED:'+venue)
        with (target/local).open('xb') as f:f.write(contents)
        downloads[venue]={'datasetFile':remote,'localFilename':local,'sha256':sha256(contents).hexdigest(),
          'byteLength':len(contents),'parquetHeadTailMagic':True,'expectedMarket':sym,'signedFillProof':False}
        print('PRIVATE_SAMPLE',venue,'bytes',len(contents),'sha256',downloads[venue]['sha256'],flush=True)
    return downloads

def profile(target:Path,packages:Path,downloads:dict):
    if not packages.is_dir() or not packages.resolve().is_relative_to(Path.home().resolve()):
        raise ValueError('ISOLATED_PARQUET_READER_NOT_IN_OWNER_HOME')
    sys.path.insert(0,str(packages))
    import duckdb
    db=duckdb.connect(':memory:')
    results={}
    for venue,meta in downloads.items():
        path=target/meta['localFilename']
        if sha256(path.read_bytes()).hexdigest()!=meta['sha256']:
            raise ValueError('PAIRED_SAMPLE_BYTES_CHANGED:'+venue)
        fields=db.execute('DESCRIBE SELECT * FROM read_parquet(?)',[str(path)]).fetchall()
        names=[r[0] for r in fields]
        required={'received_time','symbol','event_type','side','price','quantity'}
        if not required.issubset(names):raise ValueError('L2_PUBLIC_SOURCE_SCHEMA_UNEXPECTED:'+venue)
        expected=meta['expectedMarket']
        meta_sql=db.execute('''SELECT COUNT(*) AS n,COUNT(DISTINCT received_time) AS clocks,MIN(received_time),MAX(received_time),
          SUM(CASE WHEN received_time IS NULL THEN 1 ELSE 0 END),
          COUNT(DISTINCT symbol),MIN(symbol),MAX(symbol),
          SUM(CASE WHEN price IS NULL OR quantity IS NULL THEN 1 ELSE 0 END)
          FROM read_parquet(?)''',[str(path)]).fetchone()
        n,clocks,tmin,tmax,missing_clock,nsyms,sym_min,sym_max,missing_price=meta_sql
        if not n or not clocks or missing_clock or nsyms!=1 or sym_min!=expected or sym_max!=expected:
            raise ValueError('L2_SAMPLE_MARKET_OR_TIME_MISSING:'+venue+':'+repr(meta_sql))
        types=db.execute('''SELECT event_type,side,COUNT(*) FROM read_parquet(?)
            GROUP BY event_type,side ORDER BY event_type,side''',[str(path)]).fetchall()
        # No claim about per-2s continuity: event intervals can be absent when
        # no book changes, or invalid after a publisher reconnect. Report only.
        gaps=db.execute('''WITH clocks AS (SELECT DISTINCT received_time AS t FROM read_parquet(?) WHERE received_time IS NOT NULL),
            seq AS (SELECT t-LAG(t) OVER(ORDER BY t) AS gap FROM clocks)
            SELECT MAX(gap),AVG(gap) FROM seq WHERE gap IS NOT NULL''',[str(path)]).fetchone()
        report={'sourceFile':meta['datasetFile'],'sourceSha256':meta['sha256'],'parquetColumns':names,
          'rows':n,'distinctReceivedClocks':clocks,'receivedMin':tmin,'receivedMax':tmax,
          'nullPricesOrQuantity':missing_price,
          'eventsByTypeAndSide':[{'eventType':v[0],'side':v[1],'count':v[2]} for v in types],
          'maxUniqueReceiveClockGapRaw':gaps[0],'meanUniqueReceiveClockGapRaw':gaps[1],
          'sourceVenueMarket':expected,'snapshotReconstructionCertified':False,'nativeV52OrdersOrFillsVerified':False}
        results[venue]=report
        print('L2_PROFILE',venue,'rows',n,'distinctClocks',clocks,'eventTypeSides',types[:8],flush=True)
    return results

if __name__=='__main__':
    if len(sys.argv)!=4:raise ValueError('OWNER_DATA_ROOT ISOLATED_PYTHON_PACKAGES NEW_RESEARCH_OUTPUT_REQUIRED')
    data=Path(sys.argv[1]);pkgs=Path(sys.argv[2]);out=Path(sys.argv[3])
    downloads=download_pair(data)
    report={'schema':'stable4-v52-public-paired-onehour-l2-data-profile/v1',
       'status':'PARTIAL_SOURCE_CANDIDATE_ONE_HOUR_NOT_NATIVE_V52_BT',
       'observedAtUtc':datetime.now(timezone.utc).isoformat(),
       'sampleHourUtc':ONE_HOUR,'sourcePin':PIN,'files':downloads,
       'duckdbVersion':'1.4.3',
       'profile':profile(data,pkgs,downloads),
       'nativeV52EntryReplayComplete':False,'fullSevenRunnerAnnualBtComplete':False,
       'executionOrFillProven':False,'productionEligible':False,'orderAuthority':False,
       'limitations':[
         'Only one same-hour AMZN source pair; all 5 stocks annual continuous coverage, updated-book reconciliation and comparable exchange timestamps remain unverified.',
         'Parquet files are stored under owner user-root, SHA256 only in Git. DuckDB reads in an isolated package directory. No API key, no full-year bulk download.',
         'L2 rows alone lack per-account maker queue position, actual order/fill and resident STOP readbacks. Vendor known pre-Oct2026 duplicate REST snapshots and missing empty-book clears must be handled before native book replay.',
         'Event counts and raw receiver gaps are diagnostic only, never live quote parity, spread execution cost, native V52 entry/exit or real PnL/DD.'
       ]}
    with out.open('x',encoding='utf8',newline='\n') as f:json.dump(report,f,indent=2,sort_keys=True);f.write('\n')
    print('DONE',json.dumps({k:v['rows'] for k,v in report['profile'].items()},sort_keys=True))
