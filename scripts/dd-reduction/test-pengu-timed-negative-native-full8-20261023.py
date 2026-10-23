#!/usr/bin/env python3
"""Full8 economic audit: PENGU time-negative soft-exits, including unchanged AVAX baseline."""
from __future__ import annotations
import json,unittest
from pathlib import Path
HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
REPORT=REPO/"docs/research/results/pengu-timed-negative-20261023/PENGU_TIMED_NEGATIVE_NATIVE_FULL8_COMBINED_20261023.json"
ANCHOR=REPO/"docs/research/results/residual-composite-20261023/RESIDUAL_AVAX_WATCH35_HARD5_NATIVE_FULL8_20261023.json"
CASES={
 "BASE","AT3_MINUS2P5_ALL","AT8_MINUS4_ALL","H1X2_MINUS3_ALL","H1X3_MINUS3_ALL",
 "H1X3_MINUS4_ALL","H1X4_MINUS4_ALL","AT8_MINUS4_SHORT","AT8_MINUS4_BASE_LONG",
 "AT8_MINUS4_RECOVERY","H1X3_MINUS3_SHORT","H1X3_MINUS3_RECOVERY",
 "H1X3_MINUS4_MFE1_ALL",
 "H1X2_MINUS3_BASE_LONG","H1X2_MINUS3_SHORT","H1X2_MINUS3_RECOVERY",
 "H1X3_MINUS4_BASE_LONG","H1X2_MINUS4_BASE_LONG","AT3_MINUS2P5_SHORT","SHORT_AT3_MINUS2P5_OR_AT8_MINUS4",
}
class TestPenguTimedNativeFull8(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.j=json.loads(REPORT.read_text('utf8'))
  cls.anchor=json.loads(ANCHOR.read_text('utf8'))
 def test_count13_and_both_costs(self):
  self.assertEqual(set(self.j['cases']),CASES)
  for name,case in self.j['cases'].items():
   self.assertEqual(set(case['costs']),{'10','30'})
 def test_anchor_baseline_exact_transaction_ledger(self):
  for cost in ('10','30'):
   a=self.j['cases']['BASE']['costs'][cost]
   b=self.anchor['cases']['WATCH35_2H_PLUS_HARD5']['costs'][cost]
   self.assertEqual(a['ledgerSha256'],b['ledgerSha256'])
   self.assertEqual(a['closedTrades'],b['closedTrades'])
   self.assertAlmostEqual(a['finalEquityJpy'],b['finalEquityJpy'],places=7)
   self.assertAlmostEqual(a['ddPct'],b['ddPct'],places=8)
 def test_wallet_full_accounting(self):
  for name,item in self.j['cases'].items():
   for cost,r in item['costs'].items():
    with self.subTest(name=name,cost=cost):
     self.assertEqual(r['accounting'],'PASS')
     self.assertEqual(r['reselectionPasses'],3)
     self.assertEqual(sum(r['byStrategy'].values()),r['closedTrades'])
     self.assertEqual(r['penguN'],r['penguLongN']+r['penguShortN'])
     self.assertEqual(r['penguWins'],r['penguLongWins']+r['penguShortWins'])
     self.assertEqual(r['penguN'],r['byStrategy']['PENGU'])
     self.assertEqual(r['hard5Count']+r['watch35Count'],r['initialStopCount'])
     self.assertEqual(r['penguTimedStops'],len(r['penguTimedStopEntries']))
     self.assertLessEqual(r['penguTimedShortStops'],r['penguTimedStops'])
     self.assertLessEqual(r['penguTimedRecoveryStops'],r['penguTimedStops'])
 def test_recovery_short_scope_does_not_cross(self):
  for cost in ('10','30'):
   a=self.j['cases']['AT8_MINUS4_SHORT']['costs'][cost]
   self.assertEqual(a['penguTimedRecoveryStops'],0)
   b=self.j['cases']['AT8_MINUS4_RECOVERY']['costs'][cost]
   self.assertEqual(b['penguTimedShortStops'],0)
   c=self.j['cases']['AT8_MINUS4_BASE_LONG']['costs'][cost]
   self.assertEqual(c['penguTimedShortStops'],0)
   self.assertEqual(c['penguTimedRecoveryStops'],0)
 def test_config_keeps_hard_stops_8_and_6(self):
  ordinary=(REPO/'config/penguDualLsV2Runtime.ts').read_text('utf8')
  recovery=(REPO/'config/penguRecoveryV8.ts').read_text('utf8')
  self.assertGreaterEqual(ordinary.count('hardStopPct: 0.08'),2)
  self.assertIn('hardStopPct: 0.06',recovery)
  source=(HERE/'research-pengu-timed-negative-native-full8-20261023.py').read_text('utf8')
  self.assertIn('row.get("strategy_id")=="PENGU"',source)
  self.assertIn('reference.reason("DUAL",avax,btc)',source)
  self.assertIn('settings={"watch":True,"hard":True}',source)
  self.assertIn('native.replay(source_name,cost,source,helper,previous,STOCK)',source)
  self.assertTrue(self.j['status'].startswith('RESEARCH_ONLY_'))
  self.assertTrue(self.j['status'].endswith('NOT_LIVE'))
if __name__=='__main__':unittest.main()
