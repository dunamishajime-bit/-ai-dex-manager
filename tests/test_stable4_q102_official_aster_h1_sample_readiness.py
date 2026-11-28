"""Offline pin two public ASTER FET/LDO H1 Oct/Jan day samples only.

An API 200 [] one sampled day does not prove global market inception or all
annual source availability. No network calls, credentials, actual orders.
"""
from __future__ import annotations
import copy
import json
from hashlib import sha256
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
ART='docs/research/STABLE4_Q102_OFFICIAL_ASTER_FET_LDO_H1_SOURCE_SAMPLE_20261128.json'
ART_SHA='0c94784cbbff267616c2c5770add5ceb9092fb8df4982ca93a46834d126391f6'
PROBE='scripts/research/stable4_q102_official_aster_h1_historical_availability_probe.py'
PROBE_SHA='f96f52fbac45efb56fdd9f40f313316df8b4774a9e5a146265561cb19a20419e'
EMPTY_SHA='4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945'
POSITIVE_SHA={'FETUSDT':'962cab92314a35852b34ee54c9398c16a6b3fc7c9521a759ebfb9bb208461aeb',
              'LDOUSDT':'f306acee34337d3b75cfa07dd98de575d8f4eca55346852e8efeaf7323171659'}

def load():
    raw=(ROOT/ART).read_bytes()
    if sha256(raw).hexdigest()!=ART_SHA:raise ValueError('Q102_PUBLIC_H1_FET_LDO_ARTIFACT_SHA_CHANGED')
    if sha256((ROOT/PROBE).read_bytes()).hexdigest()!=PROBE_SHA:raise ValueError('Q102_PUBLIC_SOURCE_PROBE_CODE_CHANGED')
    return json.loads(raw)

def verify(j):
    if (j.get('schema')!='stable4-q102-official-aster-public-h1-four-source-date-probe/v1'
        or j.get('status')!='TWO_DATE_PER_SYMBOL_H1_PUBLIC_SOURCE_SAMPLE_NOT_ANNUAL_BT'
        or j.get('sourceOrigin')!='Official ASTER public FAPI klines endpoint'
        or j.get('sampleRequestCount')!=4 or j.get('defaultQ102SourceHistoryHours')!=5400):
        raise ValueError('Q102_PUBLIC_SOURCE_SAMPLE_SCOPE_CHANGED')
    for key in ('annualAll20SymbolHistoryProven','historical225dWarmupFullyProven',
                'actualSourceNativeAnnualQ102ReplayComplete','realTradesOrFillsProven',
                'orderAuthority','productionEligible'):
        if j.get(key) is not False:raise ValueError('SAMPLED_H1_DATA_FORGED_ANNUAL_OR_LIVE:'+key)
    expected={('2025-10-01T00:00:00Z','FETUSDT'),('2025-10-01T00:00:00Z','LDOUSDT'),
              ('2026-01-10T00:00:00Z','FETUSDT'),('2026-01-10T00:00:00Z','LDOUSDT')}
    samples=j['sampleObservations']
    if len(samples)!=4 or {(r['requestedUtcDate'],r['symbol']) for r in samples}!=expected:
        raise ValueError('Q102_FET_LDO_H1_PUBLIC_SAMPLE_ROWS_MISSING')
    for r in samples:
        if (r.get('venue')!='ASTER_FAPI_PUBLIC' or r.get('httpMethod')!='GET'
          or r.get('endpointPath')!='/fapi/v3/klines'
          or r.get('liveOrderOrAccountAccess') is not False
          or r.get('httpStatus')!=200):
            raise ValueError('ASTERV3_PUBLIC_H1_SAMPLE_NOT_GET_ONLY')
        params=r['requestParams']
        if params['symbol']!=r['symbol'] or params['interval']!='1h' or params['limit']!=3:
            raise ValueError('ASTERV3_H1_SOURCE_SAMPLE_NOT_COMPARABLE')
        if r['requestedUtcDate'].startswith('2025'):
            if (params['startTime'],params['endTime'])!=(1759276800000,1759363200000):
                raise ValueError('FET_LDO_OCT_H1_SOURCE_SAMPLE_TIME_WRONG')
            if (r.get('status')!='EMPTY_H1_ON_EXACT_SAMPLED_DAY' or r.get('returnedRows')!=0
                or r.get('firstOpenMs') is not None or r.get('lastOpenMs') is not None
                or r.get('sourceRawResponseSha256')!=EMPTY_SHA):
                raise ValueError('SOURCE_OCT_ZERO_BAR_RESULT_NOT_PROVEN')
        else:
            if (params['startTime'],params['endTime'])!=(1768003200000,1768089600000):
                raise ValueError('JAN_POSITIVE_H1_SAMPLE_TIME_WRONG')
            if (r.get('status')!='H1_BARS_PRESENT_ON_EXACT_SAMPLED_DAY'
                or r.get('returnedRows')!=3
                or r.get('firstOpenMs')!=1768003200000
                or r.get('lastOpenMs')!=1768010400000
                or r.get('sourceRawResponseSha256')!=POSITIVE_SHA[r['symbol']]):
                raise ValueError('FET_LDO_JAN_SOURCE_EXISTENCE_NOT_PROVEN')
    if j['annualRequestedRangeUtc']!=['2025-10-01T00:00:00Z','2026-10-01T00:00:00Z']:
        raise ValueError('USER_REQUESTED_ANNUAL_PERIOD_CHANGED')

class OfficialAsterFetLdoSourceSample(unittest.TestCase):
    def test_exact_public_200_empty_oct_three_h1_jan_with_no_fills(self):verify(load())
    def test_reject_false_annual_data_or_authorized_live_claim(self):
        for key in ('annualAll20SymbolHistoryProven','historical225dWarmupFullyProven',
                    'actualSourceNativeAnnualQ102ReplayComplete','realTradesOrFillsProven',
                    'orderAuthority','productionEligible'):
            doc=copy.deepcopy(load());doc[key]=True
            with self.subTest(flag=key),self.assertRaises(ValueError):verify(doc)
    def test_reject_fabricated_oct_source_or_implicit_order(self):
        doc=load();doc['sampleObservations'][0]['returnedRows']=3
        with self.assertRaises(ValueError):verify(doc)
        doc=load();doc['sampleObservations'][0]['httpMethod']='POST'
        with self.assertRaises(ValueError):verify(doc)
        doc=load();doc['sampleObservations'][2]['lastOpenMs']+=3600000
        with self.assertRaises(ValueError):verify(doc)

if __name__=='__main__':unittest.main()
