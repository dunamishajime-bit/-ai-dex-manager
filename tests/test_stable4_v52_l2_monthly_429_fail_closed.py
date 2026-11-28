"""V52 12-month sampled public L2 file audit: 429 != 404 != usable book."""
from __future__ import annotations
import copy
from hashlib import sha256
import json
from pathlib import Path
import unittest
from scripts.research.stable4_v52_l2_monthly_throttled_source_guard import audit

ROOT=Path(__file__).resolve().parents[1]
ART='STABLE4_V52_MONTHLY_L2_PUBLIC_PROVIDER_404VS429_GUARD_20261128.json'
PIN='5088bb189016955d106ebec04a20ef15a85d7ff699217ca430b030dd70aa3d77'
SCRIPT='scripts/research/stable4_v52_l2_monthly_throttled_source_guard.py'
SCRIPT_PIN='2866eb25b03f8d774ad707c6d5673c75af22b8809cd9fc04694669fc5a3f4b7f'
OTHER='scripts/research/stable4_v52_public_l2_monthly_dual_venue_coverage_probe.py'
OTHER_PIN='06efbc168b9e3c921ff2e94c95b21657c3f7f344658501bc1a1132f2d0203589'

def load():
    b=(ROOT/'docs/research'/ART).read_bytes()
    if sha256(b).hexdigest()!=PIN:raise ValueError('PUBLIC_PROVIDER_SOURCE_429_REPORT_CHANGED')
    for f,h in ((SCRIPT,SCRIPT_PIN),(OTHER,OTHER_PIN)):
        if sha256((ROOT/f).read_bytes()).hexdigest()!=h:raise ValueError('SOURCE_READONLY_PROBE_CODE_CHANGED:'+f)
    return json.loads(b)

def validate(doc):
    if (doc.get('schema')!='stable4-v52-public-monthly-5stock-dual-venue-header-rate-limit-guard/v1'
        or doc.get('status')!='LIMITED_SOURCE_SAMPLE_404_AND_429_DISTINCT_12_MONTHS_NOT_ANNUAL_BT'
        or doc.get('sourceEvidenceSha256')!='a903a34bbf74468c3e05693baf415884e8952b0d2de895db2798183d7d7bc533'):
        raise ValueError('PROVIDER_SOURCE_SCOPE_INVALID')
    for k in ('historicalAnnualDualVenueBooksPresent','nativeV52AnnualReplayReady',
              'sourceNativeFiveStockAnnualPortfolioReady','productionEligible','orderAuthority'):
        if doc.get(k) is not False:raise ValueError('FALSE_LIVE_OR_ANNUAL_L2_CLAIM:'+k)
    if doc.get('neverTreat429As404') is not True:
        raise ValueError('RATE_LIMIT_429_CONFLATED_WITH_MISSING_404')
    if doc.get('sampleCount')!=120 or doc.get('counts')!={
        'ZSTD_MAGIC_HEADER_ONLY':28,'HTTP_404_NO_SAMPLE_FILE':32,'HTTP_ERROR_UNCONFIRMED':60}:
        raise ValueError('PUBLIC_API_SAMPLE_RESPONSE_COUNTS_DRIFT')
    if (doc.get('monthsWithSampledVenue404')!=6
        or doc.get('monthsUnknownBecauseProvider429')!=6
        or doc.get('sampledHoursBothVenuesAllFiveAvailable')!=0):
        raise ValueError('PUBLIC_SOURCE_MONTHLY_BLOCKER_DRIFT')
    m=doc['allSampleMonths']
    if len(m)!=12 or list(m)!=[f'2025-{v:02d}' for v in (10,11,12)]+[f'2026-{v:02d}' for v in range(1,10)]:
        raise ValueError('V52_TWELVE_MONTH_GRAIN_MISSING')
    for ix,(name,row) in enumerate(m.items()):
        if row.get('noAnnualCoverageInferred') is not True or row.get('sampleHourUtc')!=16:
            raise ValueError('SOURCE_ONE_HOUR_WRONGLY_CERTIFIED_FULL_YEAR')
        for v in ('ASTER','HYPERLIQUID_XYZ'):
            d=row['venues'][v]
            if (d['headerPresentOnly']+d['confirmed404AtOneSampleHour']+
                d['unconfirmed429RateLimited']!=5 or d.get('confirmedFullYearlyCoverage') is not False):
                raise ValueError('SOURCE_FIVE_STOCK_PER_VENUE_COUNTS_DRIFT')
        expected='BLOCKED_404_AT_SAMPLED_HOUR' if ix<6 else 'UNKNOWN_RATE_LIMITED'
        if row['pairedAllFiveAtSampleHourState']!=expected:
            raise ValueError('MISSING_VS_THROTTLED_MONTH_CONFLATION')
        if ix>=6 and (row['venues']['ASTER']['unconfirmed429RateLimited']!=5 or row['venues']['HYPERLIQUID_XYZ']['unconfirmed429RateLimited']!=5):
            raise ValueError('PROVIDER_429_UNAVAILABLE_NOT_PROVEN')

class PublicV52L2MonthlySource429Audit(unittest.TestCase):
    def test_source_header_120_responses_no_yearly_book_inference(self):
        doc=load();validate(doc);self.assertEqual(doc,audit())
    def test_reject_429_pretending_404_or_live(self):
        for flag in ('historicalAnnualDualVenueBooksPresent','nativeV52AnnualReplayReady',
                     'sourceNativeFiveStockAnnualPortfolioReady','productionEligible','orderAuthority'):
            doc=copy.deepcopy(load());doc[flag]=True
            with self.subTest(flag=flag),self.assertRaises(ValueError):validate(doc)
        doc=load();doc['allSampleMonths']['2026-04']['pairedAllFiveAtSampleHourState']='BLOCKED_404_AT_SAMPLED_HOUR'
        with self.assertRaises(ValueError):validate(doc)
    def test_reject_429_fabricated_success(self):
        doc=load();doc['allSampleMonths']['2026-08']['venues']['HYPERLIQUID_XYZ']['unconfirmed429RateLimited']=0
        with self.assertRaises(ValueError):validate(doc)
        doc=load();doc['allSampleMonths']['2026-09']['venues']['ASTER']['headerPresentOnly']=5
        with self.assertRaises(ValueError):validate(doc)

if __name__=='__main__':unittest.main()
