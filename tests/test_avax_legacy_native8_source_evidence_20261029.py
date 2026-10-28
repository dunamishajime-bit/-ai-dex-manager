"""Verify archived 2026-10-23 AVAX historical eight-sleeve risk contract.

This is NOT a rerun of the new Q102 SHA nor independent venue certification.
"""
import json
import unittest
from pathlib import Path

DATA=Path(__file__).resolve().parents[1]/"docs/research/evidence/AVAX_WATCH35_HARD5_NATIVE_FULL8_20261023.json"
EXPECTED={
 10:(268310796.44031164,-14.514985270751623,1287,18,13,"415c1011b80eca3f1e91ee928767fe22128c02e7965f967720df784866829b7c"),
 30:(158222977.5296772,-15.785694763547497,1282,18,12,"b0d97988af02fd07841657b4ed85fa67f8c59ea194689cf041e4767a6cf7d360"),
}
class AVAXReferenceEvidence(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.j=json.loads(DATA.read_text(encoding="utf8"))
 def test_reference_scope_is_legacy_not_live(self):
  self.assertEqual(self.j["status"],"RESEARCH_ONLY_AVAX_WATCH35_2H_PLUS_HARD5_NATIVE_FULL8_NOT_LIVE")
  self.assertEqual(self.j["scope"],"Only RESIDUAL AVAXUSDT LONG. DOGE veto and AVAX DUAL entry veto fixed.")
 def test_four_hedge_cases_two_costs_use_unchanged_trade_ledger(self):
  base=self.j["cases"]["BASE_DUAL"]["costs"]
  hedge=self.j["cases"]["WATCH35_2H_PLUS_HARD5"]["costs"]
  for cost,(final,dd,trades,avax,winners,sha) in EXPECTED.items():
   with self.subTest(costBps=cost):
    x=base[str(cost)];y=hedge[str(cost)]
    for key in ["finalEquityJpy","ddPct","closedTrades","avaxCount","avaxWins","portfolioPF","ledgerSha256"]:
     self.assertEqual(x[key],y[key],key)
    self.assertAlmostEqual(x["finalEquityJpy"],final,places=5)
    self.assertAlmostEqual(x["ddPct"],dd,places=6)
    self.assertEqual(x["closedTrades"],trades)
    self.assertEqual(x["avaxCount"],avax)
    self.assertEqual(x["avaxWins"],winners)
    self.assertEqual(x["ledgerSha256"],sha)
    self.assertEqual(x["accounting"],"PASS")
    self.assertEqual(x["watch35Count"],0)
    self.assertEqual(x["hard5Count"],0)
    self.assertEqual(x["reselectionPasses"],3)
 def test_hedge_never_claims_unseen_stop_fill(self):
  self.assertTrue(any("LIVE" in x or "real" in x for x in self.j["limitations"]))
if __name__=="__main__":
 unittest.main()
