"""Bounded public file-presence audit for V52 ASTER and Hyperliquid XYZ L2.

Read-only HTTP GET Range=0..3 for 20 paired samples, plus at most two tiny
ZSTD->Parquet proof samples via locally installed Git/libzstd.dll. No account,
trading API, private key, open order, full-year data download or fee commitment.
"""
from __future__ import annotations
from collections import Counter
from datetime import datetime,timezone
from hashlib import sha256
import ctypes
import json
from pathlib import Path
import re
import sys
import urllib.error,urllib.request

ROOT=Path(__file__).resolve().parents[2]
OLD=ROOT/'docs/research/STABLE4_V52_ASTER_L2_PUBLIC_RANGE_SAMPLE_20261128.json'
OLD_SHA='3fa8cff9bf26eafd6a9837d5a8d58700b6d4c1d7422b1a096478044e2989c46d'
SYMBOLS=('AMZN','META','MSFT','NVDA','TSLA')
DATES=('2025-10-20','2026-09-02')
HOUR_UTC=16
API='https://api.cryptohftdata.com/download?file='
ZSTD=b'\x28\xb5\x2f\xfd'

def classify_raw(item):
    if item['status']=='PARQUET_MAGIC_RANGE_CONFIRMED':return 'PARQUET_FRAME_HEADER_ONLY'
    if item.get('responsePrefixHex')=='28b52ffd' and item.get('httpStatus')==206 and re.fullmatch(r'bytes 0-3/\d+',item.get('contentRange','')):
        return 'ZSTD_ENVELOPE_HEADER_ONLY'
    if item.get('httpStatus')==404:return 'HTTP_404_NOT_AVAILABLE_AT_SAMPLED_HOUR'
    return 'UNKNOWN_SOURCE_RESPONSE'

def source_request(file,full=False):
    url=API+file
    req=urllib.request.Request(url,headers={'User-Agent':'DisDexV52-ExternalSourceReadOnly/1.0',**({} if full else {'Range':'bytes=0-3'})})
    with urllib.request.urlopen(req,timeout=16) as resp:
        if full:
            raw=resp.read(2_000_001)
            if len(raw)>2_000_000:raise ValueError('UNEXPECTED_SOURCE_SAMPLE_GT_2MB')
            return {'httpStatus':resp.status,'raw':raw}
        raw=resp.read(4)
        cr=resp.headers.get('Content-Range','')
        match=re.fullmatch(r'bytes 0-3/(\d+)',cr)
        status=('PARQUET_FRAME_HEADER_ONLY' if raw==b'PAR1' else
            'ZSTD_ENVELOPE_HEADER_ONLY' if raw==ZSTD else 'UNVERIFIED_BYTE_PREFIX')
        if resp.status!=206 or not match:status='UNVERIFIED_RANGE_RESPONSE'
        return {'httpStatus':resp.status,'prefixHex':raw.hex(),'contentRange':cr,
          'fileLengthBytes':int(match.group(1)) if match else None,'status':status}

def payload_sample(date):
    file=f'aster_futures/{date}/12/AMZNUSDT_orderbook.parquet'
    r=source_request(file,True)
    data=r['raw'];compressed_size=len(data)
    if r['httpStatus']!=200 or data[:4]!=ZSTD:raise ValueError('EXPECTED_ZSTD_PUBLIC_SAMPLE_MISSING')
    lib=ctypes.CDLL(r'C:\Program Files\Git\mingw64\bin\libzstd.dll')
    lib.ZSTD_getFrameContentSize.argtypes=[ctypes.c_void_p,ctypes.c_size_t]
    lib.ZSTD_getFrameContentSize.restype=ctypes.c_ulonglong
    lib.ZSTD_decompress.argtypes=[ctypes.c_void_p,ctypes.c_size_t,ctypes.c_void_p,ctypes.c_size_t]
    lib.ZSTD_decompress.restype=ctypes.c_size_t
    lib.ZSTD_isError.argtypes=[ctypes.c_size_t];lib.ZSTD_isError.restype=ctypes.c_uint
    buf=ctypes.create_string_buffer(data)
    needed=int(lib.ZSTD_getFrameContentSize(buf,len(data)))
    if not 0<needed<=20_000_000:raise ValueError('UNSAFE_ZSTD_DECODE_BYTES')
    dst=ctypes.create_string_buffer(needed)
    decoded_size=int(lib.ZSTD_decompress(dst,needed,buf,len(data)))
    if lib.ZSTD_isError(decoded_size) or decoded_size!=needed or dst.raw[:4]!=b'PAR1' or dst.raw[-4:]!=b'PAR1':
        raise ValueError('ZSTD_PAYLOAD_IS_NOT_PROVEN_PARQUET')
    return {'datasetFile':file,'compression':'ZSTD','compressedBytes':compressed_size,
      'compressedSha256':sha256(data).hexdigest(),'decompressedBytes':decoded_size,
      'parquetHeadTailMagicVerified':True,'sampleOnly':True}

def analyze():
    old_bytes=OLD.read_bytes()
    if sha256(old_bytes).hexdigest()!=OLD_SHA:raise ValueError('PRIOR_SAMPLE_SHA_MISMATCH')
    old=json.loads(old_bytes)
    if old['orderAuthority'] is not False or old['nativeV52EntryReplayProven'] is not False or len(old['observations'])!=20:
        raise ValueError('PUBLIC_SAMPLE_SCOPE')
    prior=[{**x,'headerClassification':classify_raw(x)} for x in old['observations']]
    categories=Counter(x['headerClassification'] for x in prior)
    if categories!={'ZSTD_ENVELOPE_HEADER_ONLY':13,'PARQUET_FRAME_HEADER_ONLY':5,'HTTP_404_NOT_AVAILABLE_AT_SAMPLED_HOUR':2}:
        raise ValueError('PRIOR_SAMPLE_HEADER_COUNTS_CHANGED')
    samples=[payload_sample(d) for d in ('2025-10-01','2026-01-10')]
    requested=[]
    for date in DATES:
      for base in SYMBOLS:
       for venue,filename in (('ASTER',f'{base}USDT'),('HYPERLIQUID_XYZ',f'xyz:{base}')):
        path=f'{"aster_futures" if venue=="ASTER" else "hyperliquid_futures"}/{date}/{HOUR_UTC:02d}/{filename}_orderbook.parquet'
        record={'dateUtc':date,'hourUtc':HOUR_UTC,'base':base,'venue':venue,'datasetFile':path,'modelOrderAuthority':False}
        try:
         record.update(source_request(path))
        except urllib.error.HTTPError as error:
         record.update(status='HTTP_ERROR_UNVERIFIED',httpStatus=error.code)
        except (urllib.error.URLError,TimeoutError) as error:
         record.update(status='NETWORK_ERROR_UNVERIFIED',errorType=type(error).__name__)
        requested.append(record)
        print('PAIR',date,venue,base,record['status'],record.get('fileLengthBytes',record.get('httpStatus')),flush=True)
    stats={date:{venue:dict(Counter(r['status'] for r in requested if r['dateUtc']==date and r['venue']==venue)) for venue in ('ASTER','HYPERLIQUID_XYZ')} for date in DATES}
    return {'schema':'stable4-v52-public-aster-hyperliquid-xyz-sampled-l2-presence/v1',
     'status':'SAMPLED_DUAL_VENUE_L2_HEADERS_NOT_CONTIGUOUS_NATIVE_BT',
     'capturedAtUtc':datetime.now(timezone.utc).isoformat(),
     'previousAsterSampleSha256':OLD_SHA,'priorAsterSamplesReclassified':prior,
     'priorHeaderClasses':dict(categories),'zstdPayloadSamples':samples,
     'newPairSampleHoursUtc':[{'date':d,'hour':HOUR_UTC} for d in DATES],
     'pairObservations':requested,'pairSummaryByDate':stats,
     'nativeV52EntryReplayProven':False,'continuousAnnualPairedL2Proven':False,
     'signedMakerHedgeFillsProven':False,'orderAuthority':False,'productionEligible':False,
     'limitations':[
      'Header-only Range checks prove file objects and compression magic, not full book state or synchronized ASTER/XYZ timestamp alignment. Two separately re-fetched old ZSTD samples decode to Parquet (AMZN only).',
      'Historical early META/MSFT sampled 2025-10-01 12 UTC still HTTP404; a later file cannot supply a nonexistent earlier market hour. Provider snapshot gaps, producer clock differences, and 2s/30s cadence remain untested.',
      'Only two dates x one hour per venue and five symbols. No bulk download, historical one-hour file sequence proof, source-native V52 candidate generation, actual maker queue position, hedge IOC fills or realized PnL/DD.',
      'No credential, account action, provider subscription, LIVE trade, safety gate override, or release authority. 5-minute OHLC cannot substitute for L2 and third-party L2 must be independently verified before BT.'
     ]}

if __name__=='__main__':
    if len(sys.argv)!=2:raise ValueError('OUTPUT_REQUIRED')
    doc=analyze()
    with open(sys.argv[1],'x',encoding='utf8',newline='\n') as f:json.dump(doc,f,sort_keys=True,indent=2);f.write('\n')
    print('RESULT',json.dumps({'priorClasses':doc['priorHeaderClasses'],'paired':doc['pairSummaryByDate']},sort_keys=True))
