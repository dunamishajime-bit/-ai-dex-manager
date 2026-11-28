"""Guard R21 true 24-case model vs false annual 7-runner or LIVE claims."""
from __future__ import annotations
from collections import Counter
from hashlib import sha256
import copy,json
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
EVIDENCE='docs/research/STABLE4_R21_24CASE_NATIVE_SYNTHETIC_DD30_STOP_GAP_HEADROOM_20261128.json'
SHA='d0454af3a88759773d1173b717a6bf61b783cec111c5e85762fd5d6fec4da333'
CODE='scripts/research/stable4_r21_native_dd30_projected_headroom_audit.py'
CODE_SHA='c55e62e184e23e3d2918c3fa27118e5e7c68204092d32c1c12564492ff4658bd'
KEYS=['DD30_NEW_ENTRY_LATCH_ONLY','STOP8_LOSS_HEADROOM','STOP8_PLUS_2PCT_GAP_HEADROOM']
EXPECTED={
 'DD30_NEW_ENTRY_LATCH_ONLY/10bps':(31.358319,807,360,2),
 'DD30_NEW_ENTRY_LATCH_ONLY/30bps':(31.044914,803,351,23),
 'STOP8_LOSS_HEADROOM/10bps':(29.648785,802,359,44),
 'STOP8_LOSS_HEADROOM/30bps':(29.782722,800,349,53),
 'STOP8_PLUS_2PCT_GAP_HEADROOM/10bps':(28.342018,800,358,53),
 'STOP8_PLUS_2PCT_GAP_HEADROOM/30bps':(29.159924,799,349,65),
}

def load():
    raw=(ROOT/EVIDENCE).read_bytes()
    if sha256(raw).hexdigest()!=SHA:raise ValueError('MODEL_R21_SYNTHETIC_RESULT_SHA_CHANGED')
    if sha256((ROOT/CODE).read_bytes()).hexdigest()!=CODE_SHA:
        raise ValueError('R21_MODEL_PROVENANCE_SCRIPT_CHANGED')
    return json.loads(raw)

def check(j):
    if (j.get('schema')!='stable4-r21-24case-real-synthetic-projective-stop-loss-headroom-audit/v1'
       or j.get('status')!='R21_ONLY_24_SYNTH_CASES_STOP8_GAP2_IMPROVES_DD_NOT_APPROVED'
       or j.get('startCapitalJPY')!=10000
       or j.get('roundTripCostBpsModels')!=[10,30]):
        raise ValueError('R21_NATIVE_24CASE_SCOPE_CHANGED')
    for k in ('livePositionGrossOrExitChanged','sourceNativeSevenRunnerSyntheticCompleted',
              'realVenueExecutionProven','productionEligible','orderAuthority'):
        if j.get(k) is not False:raise ValueError('FALSE_R21_LIVE_OR_SEVEN_RUNNER_CLAIM:'+k)
    if j.get('oldPortfolioDDStopAt30PercentDoesNotGuaranteeRealizedDDAt30') is not True:
        raise ValueError('SOURCE_DD30_NEW_ENTRY_STOP_FALSE_GUARANTEE')
    if (j.get('baselineNativeEngineSha256')!='e2b0a7f63021af4a2b53c58910e9915971e9490c7a0350d557e08a0a8ed03130'
       or len(j.get('sourceFilesSha256',{}))!=4):
        raise ValueError('R21_ORIGINAL_ARCHIVED_NATIVE_SOURCE_NOT_PINNED')
    cases=j['cases']
    if len(cases)!=144 or len(set((x['regime'],x['seed'],x['arm'],x['bps']) for x in cases))!=144:
        raise ValueError('R21_6_REGIMES_4_SEEDS_3_ARMS_2_FEES_MISSING')
    if len(j['perCaseSignalInvariance'])!=24 or not all(x['sameRawEntrySignalsAcrossArms'] is True for x in j['perCaseSignalInvariance']):
        raise ValueError('SIGNAL_REGEN_INVARIANCE_NOT_PROVEN')
    if len(j.get('limitations',[]))<4:
        raise ValueError('R21_SYNTHETIC_LIMITATIONS_HIDDEN')
    for key,(dd,n,w,b) in EXPECTED.items():
        r=j['summary'][key]
        if (r['caseCount']!=24 or abs(r['maxDdPct']-dd)>1e-6 or
            r['modeledTrades']!=n or r['modeledWins']!=w or
            r['ddOrProjectedStopNewEntryBlocks']!=b or
            abs(r['modeledWinRatePct']-100*w/n)>1e-5):
            raise ValueError('R21_24CASE_ACTUAL_STOP_PROJECTION_RESULT_NOT_REPRODUCED:'+key)
        if r['modeledWinRateMeets70PctObjective'] is not False:
            raise ValueError('R21_FALSE_70PCT_WIN_RATE_CLAIM')
        selected=[x for x in cases if x['arm']+'/%sbps'%x['bps']==key]
        if (len(selected)!=24 or sum(x['trades'] for x in selected)!=n or
            sum(x['wins'] for x in selected)!=w or
            sum(x['blockedByDdOrProjectedStop'] for x in selected)!=b or
            abs(max(x['maximumDdPct'] for x in selected)-dd)>1e-5):
            raise ValueError('R21_STRESS_TRADE_OR_DD_CASES_NOT_RECONCILED:'+key)
        # An observed model DD under 30 does not justify claiming a future bound.
        if r['all24CasesMaxDDAtOrUnder30'] is not (dd<=30):
            raise ValueError('R21_INCORRECT_24_SYNTH_CASES_DD_CEILING_CLAIM')
    if j['checks']!={
        'r21StopGap2Pct30bpsSyntheticMaxDDUnder30':True,
        'r21StopGap2Pct10bpsSyntheticMaxDDUnder30':True,
        'r21StopGap2Pct30bpsWin70':False,
        'oldDdLatchOnly30bpsBreaches30':True,
        'r21FullSevenRunnerAnnualNativeSourceValidated':False,
        'r21LiveStopProtectiveOrderAttested':False,
    }:raise ValueError('R21_STOP_GAP_AUDIT_CONCLUSION_FABRICATED')

class R21Native24caseStopGapHeadroomEvidence(unittest.TestCase):
    def test_exact_pinned_six_regimes_four_seeds_three_arms_twobps(self):check(load())
    def test_forged_live_or_seven_runner_coverage_rejected(self):
        for key in ('livePositionGrossOrExitChanged','sourceNativeSevenRunnerSyntheticCompleted',
                    'realVenueExecutionProven','productionEligible','orderAuthority'):
            j=copy.deepcopy(load());j[key]=True
            with self.subTest(key=key),self.assertRaises(ValueError):check(j)
    def test_reject_fake_70pct_and_dd30_guarantee(self):
        j=load();j['summary']['STOP8_PLUS_2PCT_GAP_HEADROOM/30bps']['modeledWinRateMeets70PctObjective']=True
        with self.assertRaises(ValueError):check(j)
        j=load();j['oldPortfolioDDStopAt30PercentDoesNotGuaranteeRealizedDDAt30']=False
        with self.assertRaises(ValueError):check(j)
    def test_reject_lost_model_trades_and_missing_synthetic_seeds(self):
        j=load();j['cases'][0]['trades']+=1
        with self.assertRaises(ValueError):check(j)
        j=load();j['cases'].pop()
        with self.assertRaises(ValueError):check(j)

if __name__=='__main__':unittest.main()
