#!/usr/bin/env python3
"""Source-backed full8 research PENGU entry veto integrity tests."""
from __future__ import annotations
import json,unittest
from pathlib import Path
HERE=Path(__file__).resolve().parent
DOC=HERE.parents[1]/"docs/research/results/pengu-entry-after-avax-20261023"
ANCHOR=HERE.parents[1]/"docs/research/results/residual-composite-20261023/RESIDUAL_AVAX_WATCH35_HARD5_NATIVE_FULL8_20261023.json"
RESULT=DOC/"PENGU_ENTRY_VETO_AFTER_AVAX_FULL8_20261023.json"
class TestPenguFull8Economics(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.data=json.loads(RESULT.read_text('utf8'))
  cls.anchor=json.loads(ANCHOR.read_text('utf8'))
 def test_exact_scenarios_two_costs(self):
  self.assertEqual(set(self.data['cases']),{'BASE','LONG_BTC3_GE3','SHORT_REL3_LE1','SHORT_REL6_LE1P5','DUAL_LONG_BTC3_SHORT_REL3'})
  for case in self.data['cases'].values():self.assertEqual(set(case['costs']),{'10','30'})
 def test_exact_reference_baseline_wallet_trades(self):
  for c in ('10','30'):
   a=self.data['cases']['BASE']['costs'][c]
   b=self.anchor['cases']['WATCH35_2H_PLUS_HARD5']['costs'][c]
   self.assertEqual(a['ledgerSha256'],b['ledgerSha256'])
   self.assertAlmostEqual(a['finalEquityJpy'],b['finalEquityJpy'],places=7)
   self.assertEqual(a['closedTrades'],b['closedTrades'])
 def test_dynamic_wallet_accounting_reselection(self):
  for name,case in self.data['cases'].items():
   for c,row in case['costs'].items():
    self.assertEqual(row['accounting'],'PASS')
    self.assertEqual(row['reselectionPasses'],3)
    self.assertEqual(sum(row['byStrategy'].values()),row['closedTrades'])
    self.assertEqual(row['penguN'],row['penguLongN']+row['penguShortN'])
    self.assertEqual(row['penguWins'],row['penguLongWins']+row['penguShortWins'])
    self.assertEqual(row['penguN'],row['byStrategy']['PENGU'])
    self.assertEqual(row['hard5Count']+row['watch35Count'],row['initialStopCount'])
 def test_baseline_penguins_67_same_for_both_costs(self):
  for c in ('10','30'):
   row=self.data['cases']['BASE']['costs'][c]
   self.assertEqual(row['penguN'],67)
   self.assertEqual(row['penguWins'],50)
   self.assertEqual(row['penguLongN'],47)
   self.assertEqual(row['penguShortN'],20)
 def test_no_live_or_other_strategy_edit_claim(self):
  self.assertIn('RESEARCH_ONLY',self.data['status'])
  self.assertIn('NOT_LIVE',self.data['status'])
  source=(HERE/'research-pengu-entry-veto-after-avax-full8-20261023.py').read_text('utf8')
  self.assertIn('row.get("strategy_id")=="PENGU"',source)
  self.assertIn('reference.reason("DUAL",avax,btc)',source)
  self.assertIn('settings={"watch":True,"hard":True}',source)
  self.assertIn('native.replay(source_name,cost,source,helper,previous,STOCK)',source)
if __name__=='__main__':unittest.main()
