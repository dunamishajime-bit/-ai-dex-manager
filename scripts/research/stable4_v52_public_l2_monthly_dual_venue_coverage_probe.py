"""Bounded 12-month x 5 stock x two venue L2 source file-presence audit.

ONE Wednesday NY-market hour per month only, at most 120 public 4-byte Range
GETs, up to 4 concurrent read-only workers. Not continuous daily/hourly L2,
not book rows, not native V52 entries, never order/fill or release authority.
"""
from __future__ import annotations
import calendar
from collections import Counter
from concurrent.futures import ThreadPoolExecutor,as_completed
from datetime import date,datetime,timezone
from hashlib import sha256
import json
import re
import sys
import urllib.error
import urllib.request

HOST='https://api.cryptohftdata.com/download?file='
VENUES=('ASTER','HYPERLIQUID_XYZ')
STOCKS=('AMZN','META','MSFT','NVDA','TSLA')
MONTHS=[(2025,m) for m in (10,11,12)]+[(2026,m) for m in range(1,10)]
HOUR=16
BUDGET=12*5*2

def second_wednesday(year:int,month:int)->str:
    first=date(year,month,1)
    delta=(2-first.weekday())%7
    day=first.day+delta+7
    return date(year,month,day).isoformat()

def sample(args):
    year,month,sym,venue=args
    day=second_wednesday(year,month)
    market=sym+'USDT' if venue=='ASTER' else 'xyz:'+sym
    folder='aster_futures' if venue=='ASTER' else 'hyperliquid_futures'
    path=f'{folder}/{day}/{HOUR:02d}/{market}_orderbook.parquet'
    item={'yearMonth':f'{year:04d}-{month:02d}','sampleDateUtc':day,
      'hourUtc':HOUR,'symbol':sym,'venue':venue,'datasetFile':path,
      'requestsRangeBytes':'0-3','sourceOrderAuthority':False}
    request=urllib.request.Request(HOST+path,headers={'Range':'bytes=0-3','User-Agent':'DisDexResearchMonthlySourceCoverage/1.0'})
    try:
        with urllib.request.urlopen(request,timeout=16) as resp:
            b=resp.read(4)
            cr=resp.headers.get('Content-Range','')
            m=re.fullmatch(r'bytes 0-3/(\d+)',cr)
            if resp.status==206 and m and int(m.group(1))>8 and b in (b'PAR1',b'\x28\xb5\x2f\xfd'):
                status='PARQUET_MAGIC_HEADER_ONLY' if b==b'PAR1' else 'ZSTD_MAGIC_HEADER_ONLY'
            else:status='UNKNOWN_PUBLIC_DATA_FORMAT_OR_RANGE'
            item.update(status=status,httpStatus=resp.status,prefixHex=b.hex(),
                fileByteLength=int(m.group(1)) if m else None)
    except urllib.error.HTTPError as e:
        item.update(status='HTTP_404_NO_SAMPLE_FILE' if e.code==404 else 'HTTP_ERROR_UNCONFIRMED',httpStatus=e.code)
    except (urllib.error.URLError,TimeoutError) as e:
        item.update(status='NETWORK_ERROR_UNCONFIRMED',errorType=type(e).__name__)
    return item

def main():
    tasks=[(y,m,s,v) for y,m in MONTHS for s in STOCKS for v in VENUES]
    if len(tasks)!=BUDGET:raise ValueError('READ_ONLY_HTTP_REQUEST_BUDGET_DRIFT')
    data=[]
    with ThreadPoolExecutor(max_workers=4) as workers:
        futures={workers.submit(sample,x):x for x in tasks}
        for f in as_completed(futures):
            data.append(f.result())
    data.sort(key=lambda x:(x['yearMonth'],x['symbol'],x['venue']))
    statuses=Counter(x['status'] for x in data)
    by_month={}
    for y,m in MONTHS:
        month=f'{y:04d}-{m:02d}'
        items=[x for x in data if x['yearMonth']==month]
        by_month[month]={
            'sourceDateUtc':second_wednesday(y,m),
            'asterFiveSymbolsPresent':sum(x['status'] in ('PARQUET_MAGIC_HEADER_ONLY','ZSTD_MAGIC_HEADER_ONLY') for x in items if x['venue']=='ASTER'),
            'xyzFiveSymbolsPresent':sum(x['status'] in ('PARQUET_MAGIC_HEADER_ONLY','ZSTD_MAGIC_HEADER_ONLY') for x in items if x['venue']=='HYPERLIQUID_XYZ'),
            'sampledAllFivePairedPresent':all(any(x['symbol']==s and x['venue']==v and x['status'] in ('PARQUET_MAGIC_HEADER_ONLY','ZSTD_MAGIC_HEADER_ONLY') for x in items) for s in STOCKS for v in VENUES),
            'statusCount':dict(Counter(x['status'] for x in items)),
        }
    out={'schema':'stable4-v52-public-l2-dual-venue-monthly-5stock-sampled-coverage/v1',
         'status':'TWELVE_ISOLATED_MARKET_HOUR_FILE_HEADERS_NOT_FULL_YEARLY_COVERAGE',
         'observedAtUtc':datetime.now(timezone.utc).isoformat(),
         'provider':'CryptoHFTData public third-party historical ASTER and Hyperliquid Parquet archive',
         'samplePolicy':'Second Wednesday of each month UTC hour 16; trade-day sampling only; no holiday/rate/venue uptime guarantee',
         'dateRange':['2025-10-01T00:00:00Z','2026-10-01T00:00:00Z'],
         'symbols':list(STOCKS),'venues':list(VENUES),'sampleHourUtc':HOUR,
         'sourceRequestsExecuted':len(data),'responseStatusCounts':dict(statuses),
         'monthly':by_month,'sampleRecords':data,
         'fullAnnualL2HoursCertified':False,'nativeV52AllSymbolEntryReplayProven':False,
         'historicalDualVenueOrderBookReconstructionProven':False,
         'signedMakerOrHedgeOrdersAndFillsProven':False,
         'productionEligible':False,'orderAuthority':False,
         'limitations':[
           'Only one hour on one sample day per month for 5 stocks and 2 venue filenames (120 GET Range of four bytes); no day/hour contiguous source availability or native feature reconstruction.',
           '404 may be a market-not-listed, archived-data gap, vendor outage or source naming issue, and cannot be converted into synthetic book/fills. PAR1/ZSTD header alone does not prove nonempty valid book rows.',
           'Aster and Hyperliquid receive clocks, depth updates, source re-snapshot resets, V13D queue/hedge and V11EQ 2s/30s features need separate full reconstructed data before trading inference.',
           'No authentication, API charges/subscription, bulk downloads, actual or test orders, V52 LIVE process changes, signed Owner production release or seven-runner portfolio BT.',
         ]}
    return out

if __name__=='__main__':
    if len(sys.argv)!=2:raise ValueError('NEW_SOURCE_AUDIT_OUTPUT_PATH_REQUIRED')
    report=main()
    with open(sys.argv[1],'x',encoding='utf8',newline='\n') as f:json.dump(report,f,indent=2,sort_keys=True);f.write('\n')
    print('V52_MONTHLY_SAMPLE_STATUS',json.dumps(report['responseStatusCounts'],sort_keys=True))
    print('V52_MONTHLY_PAIRED',json.dumps({m:{k:v[k] for k in ('asterFiveSymbolsPresent','xyzFiveSymbolsPresent','sampledAllFivePairedPresent')} for m,v in report['monthly'].items()},sort_keys=True))
