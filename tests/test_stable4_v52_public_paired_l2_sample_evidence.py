"""Fail-closed proof of sampled external L2 file headers; NOT V52 native BT.

Two matched ASTER+xyz five-stock September 2026 header sets do not certify
any full-year 2s/30s book replay or actual maker/hedge fills.
"""
from __future__ import annotations
from collections import Counter
from hashlib import sha256
import copy
import json
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
FILES={
 'aster':('STABLE4_V52_ASTER_L2_PUBLIC_RANGE_SAMPLE_20261128.json','3fa8cff9bf26eafd6a9837d5a8d58700b6d4c1d7422b1a096478044e2989c46d'),
 'paired':('STABLE4_V52_PUBLIC_ASTER_XYZ_PAIRED_L2_SAMPLES_20261128.json','96f7ce8af39a04da8135e974877b2576c58d2fe43dee9d2561b621c370ac989f'),
}
SOURCES={
 'scripts/research/stable4_v52_public_aster_l2_presence_probe.py':'2eb3f5e2d1dad336dd2f287bcc4d529399907370339884e73323c0908fec413f',
 'scripts/research/stable4_v52_public_aster_xyz_l2_pair_probe.py':'f49fec7eef6a1709ce36cd3fba88229832e6dc188cd5b99afb3e88b4f1b7f510',
}
STOCKS={'AMZN','META','MSFT','NVDA','TSLA'}

def load():
    out={}
    for k,(name,digest) in FILES.items():
        raw=(ROOT/'docs/research'/name).read_bytes()
        if sha256(raw).hexdigest()!=digest:raise ValueError('THIRD_PARTY_SAMPLE_SHA_CHANGED:'+k)
        out[k]=json.loads(raw)
    return out

def verify(d):
    a,p=d['aster'],d['paired']
    if (a.get('schema')!='stable4-v52-third-party-aster-l2-public-range-presence/v1'
        or p.get('schema')!='stable4-v52-public-aster-hyperliquid-xyz-sampled-l2-presence/v1'
        or a.get('status')!='SAMPLE_ONLY_NO_ANNUAL_COVERAGE_OR_SOURCE_FILL_PROOF'
        or p.get('status')!='SAMPLED_DUAL_VENUE_L2_HEADERS_NOT_CONTIGUOUS_NATIVE_BT'
        or p.get('previousAsterSampleSha256')!=FILES['aster'][1]):
        raise ValueError('L2_SAMPLE_SCHEMA_PROVENANCE_OR_STATUS_INVALID')
    for k in ('actualHistoricalL2DataDownloaded','continuousYearlyL2Proven','nativeV52EntryReplayProven','fillsCertified','orderAuthority'):
        if a.get(k) is not False:raise ValueError('ASTER_SAMPLE_FALSE_SCOPE:'+k)
    for k in ('nativeV52EntryReplayProven','continuousAnnualPairedL2Proven','signedMakerHedgeFillsProven','orderAuthority','productionEligible'):
        if p.get(k) is not False:raise ValueError('PAIRED_L2_FALSE_SCOPE:'+k)
    for f,digest in SOURCES.items():
        path=ROOT/f
        if not path.is_file() or sha256(path.read_bytes()).hexdigest()!=digest:
            raise ValueError('EXTERNAL_SOURCE_AUDIT_SCRIPT_SHA_CHANGED:'+f)
    if len(a['observations'])!=20 or len(p['priorAsterSamplesReclassified'])!=20 or len(p['pairObservations'])!=20:
        raise ValueError('PUBLIC_L2_SAMPLE_COUNT_INVALID')
    if {r['symbol'] for r in a['observations']}!={s+'USDT' for s in STOCKS}:
        raise ValueError('UNREVIEWED_STOCK_SYMBOL')
    old_by={(x['dateUtc'],x['symbol'],x['hourUtc']):x for x in a['observations']}
    previous=p['priorAsterSamplesReclassified']
    if len(old_by)!=20 or len({(x['dateUtc'],x['symbol'],x['hourUtc']) for x in previous})!=20:
        raise ValueError('DUPLICATE_OLD_SAMPLE_KEYS')
    for rec in previous:
        key=(rec['dateUtc'],rec['symbol'],rec['hourUtc'])
        if key not in old_by or any(rec.get(k)!=v for k,v in old_by[key].items()):
            raise ValueError('SOURCE_RECLASSIFICATION_NOT_PINNED')
        kind=rec['headerClassification']
        if kind=='ZSTD_ENVELOPE_HEADER_ONLY':
            if rec.get('responsePrefixHex')!='28b52ffd' or rec.get('httpStatus')!=206:
                raise ValueError('NOT_ZSTD_MAGIC')
        elif kind=='PARQUET_FRAME_HEADER_ONLY':
            if rec.get('status')!='PARQUET_MAGIC_RANGE_CONFIRMED':raise ValueError('NOT_PARQUET_MAGIC')
        elif kind=='HTTP_404_NOT_AVAILABLE_AT_SAMPLED_HOUR':
            if rec.get('httpStatus')!=404:raise ValueError('FALSE_PUBLIC_MISSING_HOUR')
        else:raise ValueError('UNKNOWN_L2_SAMPLE_FORMAT')
    if Counter(x['headerClassification'] for x in previous)!={
        'ZSTD_ENVELOPE_HEADER_ONLY':13,'PARQUET_FRAME_HEADER_ONLY':5,
        'HTTP_404_NOT_AVAILABLE_AT_SAMPLED_HOUR':2}:
        raise ValueError('ASTER_SAMPLE_HEADER_COUNT_CHANGED')
    found={}
    for r in p['pairObservations']:
        if r.get('modelOrderAuthority') is not False:raise ValueError('TRADE_AUTHORITY_FORGED')
        key=(r['dateUtc'],r['hourUtc'],r['venue'],r['base'])
        if key in found or r['base'] not in STOCKS or r['dateUtc'] not in ('2025-10-20','2026-09-02') or r['hourUtc']!=16 or r['venue'] not in ('ASTER','HYPERLIQUID_XYZ'):
            raise ValueError('L2_PAIR_SAMPLE_OUTSIDE_REVIEWED_UNIVERSE')
        expected_name=r['base']+'USDT' if r['venue']=='ASTER' else 'xyz:'+r['base']
        expected_prefix='aster_futures' if r['venue']=='ASTER' else 'hyperliquid_futures'
        if r['datasetFile']!=f'{expected_prefix}/{r["dateUtc"]}/16/{expected_name}_orderbook.parquet':
            raise ValueError('L2_PAIR_SOURCE_PATH_MISMATCH')
        if r['dateUtc']=='2026-09-02':
            if (r['status']!='PARQUET_FRAME_HEADER_ONLY' or r.get('prefixHex')!='50415231'
                or r.get('httpStatus')!=206 or r.get('fileLengthBytes',0)<=8):
                raise ValueError('PAIRING_NOT_PROVEN_BY_TWO_PUBLISHED_FILES')
        elif r['venue']=='ASTER':
            if r['status']!='ZSTD_ENVELOPE_HEADER_ONLY' or r.get('prefixHex')!='28b52ffd' or r.get('httpStatus')!=206:
                raise ValueError('OLDER_ASTER_COMPRESSED_SAMPLE_NOT_PROVEN')
        else:
            if r['status']!='HTTP_ERROR_UNVERIFIED' or r.get('httpStatus')!=404:
                raise ValueError('OLDER_XYZ_L2_NOT_CONFIRMED_MISSING')
        found[key]=r
    if len(found)!=20:raise ValueError('L2_PAIR_SAMPLE_INCOMPLETE')
    if len(p.get('zstdPayloadSamples',[]))!=2:
        raise ValueError('ZSTD_SAMPLE_COUNT')
    for sample in p['zstdPayloadSamples']:
        if sample.get('parquetHeadTailMagicVerified') is not True or sample.get('sampleOnly') is not True or sample.get('compression')!='ZSTD':
            raise ValueError('ZSTD_PAYLOAD_PARQUET_NOT_VALIDATED')
        if sample.get('compressedBytes',0)<100 or sample.get('decompressedBytes',0)<=sample['compressedBytes']:
            raise ValueError('ZSTD_PAYLOAD_IMPLAUSIBLE')

class V52PublicL2PairedSampleEvidence(unittest.TestCase):
    def test_5_stock_aster_xyz_sample_is_narrow_only(self):verify(load())
    def test_reject_falsely_certified_full_year_or_live(self):
        for side,k in (('paired','orderAuthority'),('paired','nativeV52EntryReplayProven'),
            ('paired','continuousAnnualPairedL2Proven'),('paired','signedMakerHedgeFillsProven'),
            ('paired','productionEligible'),('aster','fillsCertified')):
            doc=copy.deepcopy(load());doc[side][k]=True
            with self.subTest(side=side,key=k),self.assertRaises(ValueError):verify(doc)
    def test_reject_forged_old_xyz_and_zstd_header(self):
        doc=load();hit=next(x for x in doc['paired']['pairObservations'] if x['venue']=='HYPERLIQUID_XYZ' and x['dateUtc']=='2025-10-20')
        hit.update(status='PARQUET_FRAME_HEADER_ONLY',prefixHex='50415231',httpStatus=206)
        with self.assertRaises(ValueError):verify(doc)
        doc=load();hit=next(x for x in doc['paired']['priorAsterSamplesReclassified'] if x['headerClassification']=='ZSTD_ENVELOPE_HEADER_ONLY')
        hit['headerClassification']='PARQUET_FRAME_HEADER_ONLY'
        with self.assertRaises(ValueError):verify(doc)

if __name__=='__main__':unittest.main()
