"""Offline classify sampled V52 L2 source 404 vs HTTP 429 without retries.

This is a deterministic immutable assessment of one 120-request provider sample,
not an authorized way to bypass provider limits or an annual market book replay.
"""
from __future__ import annotations
from collections import Counter
from hashlib import sha256
import json
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[2]
SOURCE='docs/research/STABLE4_V52_12_MONTHLY_ASTERVSXYZ_L2_SOURCE_HEADERS_20261128.json'
PIN='a903a34bbf74468c3e05693baf415884e8952b0d2de895db2798183d7d7bc533'
HEADERS={'PARQUET_MAGIC_HEADER_ONLY','ZSTD_MAGIC_HEADER_ONLY'}
VENUES=('ASTER','HYPERLIQUID_XYZ')
STOCKS=('AMZN','META','MSFT','NVDA','TSLA')

def audit():
    raw=(ROOT/SOURCE).read_bytes()
    if sha256(raw).hexdigest()!=PIN:raise ValueError('PUBLIC_SOURCE_429_AUDIT_INPUT_CHANGED')
    doc=json.loads(raw)
    if (doc.get('schema')!='stable4-v52-public-l2-dual-venue-monthly-5stock-sampled-coverage/v1'
        or doc.get('status')!='TWELVE_ISOLATED_MARKET_HOUR_FILE_HEADERS_NOT_FULL_YEARLY_COVERAGE'
        or doc.get('orderAuthority') is not False or doc.get('fullAnnualL2HoursCertified') is not False):
        raise ValueError('PUBLIC_PROVIDER_SOURCE_SCOPE_INVALID')
    records=doc['sampleRecords']
    if len(records)!=120 or len(doc['monthly'])!=12:
        raise ValueError('SOURCE_MONTHLY_120_EXPECTED_SAMPLE_INVALID')
    seen=set();stats={};total=Counter()
    for m in sorted(doc['monthly']):
        group=[r for r in records if r['yearMonth']==m]
        if len(group)!=10:raise ValueError('EXPECTED_TEN_ONE_HOUR_SAMPLES_PER_MONTH')
        counts={}
        per_venue={}
        for venue in VENUES:
            items=[r for r in group if r['venue']==venue]
            if len(items)!=5 or {r['symbol'] for r in items}!=set(STOCKS):
                raise ValueError('V52_FIVE_STOCK_PAIRS_MISSING:'+m+':'+venue)
            counts_by_status=Counter(r['status'] for r in items)
            present=sum(r['status'] in HEADERS and r.get('httpStatus')==206 for r in items)
            missing=sum(r['status']=='HTTP_404_NO_SAMPLE_FILE' and r.get('httpStatus')==404 for r in items)
            unknown=sum(r.get('httpStatus')==429 and r['status']=='HTTP_ERROR_UNCONFIRMED' for r in items)
            if present+missing+unknown!=len(items):
                raise ValueError('UNEXPECTED_PROBE_RESPONSE_CANNOT_CERTIFY_SOURCE:'+m)
            per_venue[venue]={
               'headerPresentOnly':present,'confirmed404AtOneSampleHour':missing,
               'unconfirmed429RateLimited':unknown,
               'confirmedFullYearlyCoverage':False,
            }
        for row in group:
            key=(row['sampleDateUtc'],row['hourUtc'],row['symbol'],row['venue'])
            if key in seen or row.get('sourceOrderAuthority') is not False:
                raise ValueError('SOURCE_REQUEST_DUPLICATED_OR_ORDER_AUTHORITY')
            seen.add(key)
            total[row['status']]+=1
        # Different states: 404 NOT at this exact filename/time and 429 UNKNOWN;
        # neither is permission to substitute synthetic book rows.
        missing_pair=per_venue['ASTER']['confirmed404AtOneSampleHour']+per_venue['HYPERLIQUID_XYZ']['confirmed404AtOneSampleHour']
        unknown_pair=per_venue['ASTER']['unconfirmed429RateLimited']+per_venue['HYPERLIQUID_XYZ']['unconfirmed429RateLimited']
        stats[m]={
           'sampleDateUtc':group[0]['sampleDateUtc'],'sampleHourUtc':group[0]['hourUtc'],
           'venues':per_venue,
           'pairedAllFiveAtSampleHourState':('UNKNOWN_RATE_LIMITED' if unknown_pair else
             'BLOCKED_404_AT_SAMPLED_HOUR' if missing_pair else
             'BOTH_VENUES_ALL_FIVE_HEADERS_PRESENT_NOT_REAL_BOOKS'),
           'noAnnualCoverageInferred':True,
        }
    expected={'ZSTD_MAGIC_HEADER_ONLY':28,'HTTP_404_NO_SAMPLE_FILE':32,'HTTP_ERROR_UNCONFIRMED':60}
    if dict(total)!=expected:raise ValueError('PUBLIC_SOURCE_COUNTER_NOT_PINNED')
    if any(stats[m]['pairedAllFiveAtSampleHourState']!='BLOCKED_404_AT_SAMPLED_HOUR' for m in list(stats)[:6]):
        raise ValueError('FIRST_SIX_MONTHS_XYZ_NO_SOURCE_GAP_NOT_RECORDED')
    if any(stats[m]['pairedAllFiveAtSampleHourState']!='UNKNOWN_RATE_LIMITED' for m in list(stats)[6:]):
        raise ValueError('LATER_SIX_MONTHS_429_CONFLATED_WITH_MISSING')
    result={'schema':'stable4-v52-public-monthly-5stock-dual-venue-header-rate-limit-guard/v1',
      'status':'LIMITED_SOURCE_SAMPLE_404_AND_429_DISTINCT_12_MONTHS_NOT_ANNUAL_BT',
      'sourceEvidenceSha256':PIN,'allSampleMonths':stats,'sampleCount':120,
      'counts':dict(total),
      'monthsWithSampledVenue404':6,'monthsUnknownBecauseProvider429':6,
      'sampledHoursBothVenuesAllFiveAvailable':0,
      'neverTreat429As404':True,
      'historicalAnnualDualVenueBooksPresent':False,
      'nativeV52AnnualReplayReady':False,'sourceNativeFiveStockAnnualPortfolioReady':False,
      'productionEligible':False,'orderAuthority':False,
      'limitations':[
        '120 four-byte Range GETs at one selected hour on second Wednesday of each month, not 8760 hours. A 404 confirms absent at that sampled filename only, not global venue inception date or all-hours coverage.',
        'All 60 HTTP 429 requests in Apr-Sep 2026 are explicitly UNKNOWN: do not infer absence, success, or retry aggressively; respect the public provider rate limit.',
        '2025 Oct-Mar six monthly market-hour samples include 5/5 XYZ 404. No claim that historical data is impossible from all providers; alternate authorized sources or verified reconstructed venue snapshots may exist.',
        'No L2 book reconstruction, source 2s/30s price windows, real maker/hedge queues, fills, seven-runner Gross/DD or new exact-source owner certificate.',
      ]}
    return result

if __name__=='__main__':
    if len(sys.argv)!=2:raise ValueError('NEW_OUTPUT_REQUIRED')
    r=audit()
    with open(sys.argv[1],'x',encoding='utf8',newline='\n') as f:json.dump(r,f,indent=2,sort_keys=True);f.write('\n')
    print('RATE_LIMIT_GUARD',json.dumps({'counts':r['counts'],'known404Months':r['monthsWithSampledVenue404'],'unknown429Months':r['monthsUnknownBecauseProvider429']},sort_keys=True))
