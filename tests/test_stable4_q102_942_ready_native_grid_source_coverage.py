"""Q102 complete 942 source-ready raw-screen vs 96 true native selection checks.

These are 942 PARTIAL-year H1 source-ready clocks, not 8760 annual native
executions; 846 raw-empty clocks were not fully selector-invoked.
"""
from __future__ import annotations
from collections import Counter
import copy
from hashlib import sha256
import json
from pathlib import Path
import unittest
from scripts.research.stable4_q102_942_ready_native_grid_decision_coverage import evaluate, verify_out

ROOT=Path(__file__).resolve().parents[1]
P='docs/research/STABLE4_Q102_942_READY_SOURCE_NATIVE_GRID_DECISIONS_20261128.json'
PIN='03ea6dceb8e3f5425d392dfa17cba035f496a63b4f805983d5b657e74c13f254'
SOURCE='scripts/research/stable4_q102_942_ready_native_grid_decision_coverage.py'
SOURCE_PIN='92a32ebcc5a56221eb580fd16b8bcc8c529857f1a6b0c58ccd10bcba58ba9203'

def load():
    raw=(ROOT/P).read_bytes()
    if sha256(raw).hexdigest()!=PIN:raise ValueError('Q102_READY_SOURCE_DECISIONS_REPORT_CHANGED')
    if sha256((ROOT/SOURCE).read_bytes()).hexdigest()!=SOURCE_PIN:
        raise ValueError('Q102_READY_NATIVE_GRID_SOURCE_SCRIPT_CHANGED')
    return json.loads(raw)

class Q102SourceReadyNativeGridDecisionCoverage(unittest.TestCase):
    def test_every_hour_accounted_exact_native_raw_or_final_selector(self):
        result=load()
        verify_out(result)
        self.assertEqual(result,evaluate())
        counts=Counter(x['category'] for x in result['decisions'])
        self.assertEqual(counts['NATIVE_GRID_NO_CANDIDATE_NO_FULL_SELECTOR_INVOKED'],846)
        self.assertEqual(counts['FULL_NATIVE_SELECTED_HIGH_VOL_SOURCE_ONLY'],9)
        self.assertEqual(counts['FULL_NATIVE_SELECTED_S34_SOURCE_ONLY'],29)
        self.assertEqual(result['summary']['sourceBlockedHours'],7818)
        self.assertFalse(result['allReadyClocksFullyNativeSelectorInvoked'])
    def test_reject_false_full_selector_annual_or_production_authority(self):
        for flag in ('orderAuthority','fullQ102AnnualReplay','sevenRunnerSharedWalletComplete',
                     'allReadyClocksFullyNativeSelectorInvoked','productionEligible'):
            r=copy.deepcopy(load());r[flag]=True
            with self.subTest(flag=flag),self.assertRaises(ValueError):verify_out(r)
    def test_reject_historical_future_h1_or_fake_raw_empty_full_selector(self):
        r=load();r['decisions'][0]['closedH1DataCutoffTs']=r['decisions'][0]['decisionTs']
        with self.assertRaises(ValueError):verify_out(r)
        r=load();r['decisions'][0]['fullNativeSelectorInvoked']=True
        with self.assertRaises(ValueError):verify_out(r)
        r=load();r['decisions'][0]['sourceFillProven']=True
        with self.assertRaises(ValueError):verify_out(r)
    def test_reject_hidden_raw_signal_or_missing_native_96_selector(self):
        r=load();i=next(i for i,x in enumerate(r['decisions']) if x['fullNativeSelectorInvoked'])
        r['decisions'][i]['fullNativeSelectorInvoked']=False
        with self.assertRaises(ValueError):verify_out(r)
        r=load();r['decisions'][0]['rawS34CandidatesCount']=1
        with self.assertRaises(ValueError):verify_out(r)

if __name__=='__main__':unittest.main()
