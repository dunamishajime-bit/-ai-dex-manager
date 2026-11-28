"""Read-only, 4-request bounded official ASTER H1 source availability audit.

FET & LDO sampled Oct 2025 vs Jan 2026, for source-native Q102 225d gate.
No trading requests, credentials, environment changes, synthetic OHLC or fill
claims; a date sample does not prove the full 8760-hour annual universe.
"""
from __future__ import annotations
from datetime import datetime,timezone
import hashlib
import json
import sys
import urllib.error,urllib.parse,urllib.request

BASE='https://fapi.asterdex.com/fapi/v3/klines'
STARTS=(('2025-10-01T00:00:00Z',1759276800000,1759363200000),
        ('2026-01-10T00:00:00Z',1768003200000,1768089600000))
SYMBOLS=('FETUSDT','LDOUSDT')

def run():
    observations=[]
    for date,start,end in STARTS:
        for symbol in SYMBOLS:
            args={'symbol':symbol,'interval':'1h','startTime':start,'endTime':end,'limit':3}
            item={'symbol':symbol,'requestedUtcDate':date,'venue':'ASTER_FAPI_PUBLIC',
              'endpointPath':'/fapi/v3/klines','httpMethod':'GET','requestParams':args,
              'liveOrderOrAccountAccess':False}
            request=urllib.request.Request(BASE+'?'+urllib.parse.urlencode(args),headers={
              'User-Agent':'DisDexSourceNativeQ102H1ReadOnly/1.0'})
            try:
                with urllib.request.urlopen(request,timeout=16) as response:
                    raw=response.read(12_001)
                    if len(raw)>12_000:raise ValueError('PUBLIC_RESPONSE_OVER_12KB')
                    obj=json.loads(raw)
                    if not isinstance(obj,list):
                        item.update(status='UNEXPECTED_PUBLIC_API_PAYLOAD_NOT_CANDLE_ARRAY',httpStatus=response.status)
                    else:
                        ts=[int(row[0]) for row in obj if isinstance(row,list) and len(row)>=7]
                        if len(ts)!=len(obj) or any(t<start or t>=end or t%3600000 for t in ts):
                            raise ValueError('PUBLIC_H1_SOURCE_NONCAUSAL_OR_WRONG_DATE')
                        item.update(status='EMPTY_H1_ON_EXACT_SAMPLED_DAY' if not ts else 'H1_BARS_PRESENT_ON_EXACT_SAMPLED_DAY',
                             httpStatus=response.status,returnedRows=len(obj),firstOpenMs=ts[0] if ts else None,
                             lastOpenMs=ts[-1] if ts else None,sourceRawResponseSha256=hashlib.sha256(raw).hexdigest())
            except urllib.error.HTTPError as error:
                item.update(status='UNVERIFIED_HTTP_RESPONSE',httpStatus=error.code)
            except (TimeoutError,urllib.error.URLError) as error:
                item.update(status='UNVERIFIED_NETWORK_ERROR',errorType=type(error).__name__)
            observations.append(item)
            print('Q102_ASTERV3_H1_SAMPLE',date,symbol,item['status'],item.get('returnedRows'),flush=True)
    return {'schema':'stable4-q102-official-aster-public-h1-four-source-date-probe/v1',
       'status':'TWO_DATE_PER_SYMBOL_H1_PUBLIC_SOURCE_SAMPLE_NOT_ANNUAL_BT',
       'observedAtUtc':datetime.now(timezone.utc).isoformat(),
       'sourceOrigin':'Official ASTER public FAPI klines endpoint',
       'annualRequestedRangeUtc':['2025-10-01T00:00:00Z','2026-10-01T00:00:00Z'],
       'defaultQ102SourceHistoryHours':5400,
       'sampleRequestCount':len(observations),'sampleObservations':observations,
       'annualAll20SymbolHistoryProven':False,
       'historical225dWarmupFullyProven':False,
       'actualSourceNativeAnnualQ102ReplayComplete':False,
       'realTradesOrFillsProven':False,'orderAuthority':False,'productionEligible':False,
       'limitations':[
          'Four public unauthenticated GET klines requests: one day Oct 2025 and one day Jan 2026 for FET/LDO. Empty response on one day does not prove unlisted trading market, permanent provider absence or all-day data gaps elsewhere.',
          'Return of at most three rows per date only establishes presence or absence at sampled startTime; no complete 225d contiguous 20-symbol source or monthly HIGH_VOL walk-forward training reconstructed.',
          'ASTER public H1 and Binance H1 are not interchangeable for exact production Q102 matching; do not infer real fills or live entry authority from these presence tests.',
          'No POST/DELETE, signed GET, API keys, test orders, VPS production, Root, Owner, approval or release certificate.',
       ]}

if __name__=='__main__':
    if len(sys.argv)!=2:raise ValueError('RESEARCH_REPORT_OUTPUT_REQUIRED')
    report=run()
    with open(sys.argv[1],'x',encoding='utf8',newline='\n') as f:json.dump(report,f,indent=2,sort_keys=True);f.write('\n')
    print('SAMPLE_RESULTS',json.dumps({x['requestedUtcDate']+'/'+x['symbol']:x['status'] for x in report['sampleObservations']},sort_keys=True))
