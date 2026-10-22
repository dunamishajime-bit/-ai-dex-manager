#!/usr/bin/env python3
"""Unit/integration source gates for V52-only extraction and short risk sizing."""
import importlib.util,json,unittest,hashlib
from pathlib import Path
HERE=Path(__file__).resolve().parent
ROOT=Path(r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/2026-10-22_hype_entry_plus_exit_full8")
RESULTS=HERE.parents[1]/"docs/research/results/v52-short-risk-followup-20261022"

def module(name,path):
 sp=importlib.util.spec_from_file_location(name,path)
 assert sp and sp.loader
 mod=importlib.util.module_from_spec(sp);sp.loader.exec_module(mod)
 return mod

a=module("v52_analysis_tests",HERE/"analyze-v52-only-trades-after-fet-20261022.py")
s=module("v52_short_risk_tests",HERE/"run-v52-short-risk-sizing-full8-after-fet-20261022.py")

class V52TradeAttributionTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.report=json.loads((RESULTS/"V52_ONLY_PNL_DD_ANALYSIS_20261022.json").read_text(encoding="utf-8"))
  cls.native=s.native.m.jsonl(s.native.STOCK_ARCHIVE/"v52-model-ledger.jsonl")
  cls.prov=json.loads((s.native.STOCK_ARCHIVE/"restore-provenance.json").read_text(encoding="utf-8"))
 def test_pinned_ledger_anchors(self):
  self.assertEqual(self.report["cost"]["10"]["overall"]["trades"],87)
  self.assertEqual(self.report["cost"]["30"]["overall"]["trades"],87)
  self.assertEqual(len(self.native),99)
  self.assertEqual(sum(r.get("status")=="MODELED_CLOSED_TRADE" for r in self.native),88)
  self.assertEqual(s.sha(s.native.STOCK_ARCHIVE/"v52-model-ledger.jsonl"),self.prov["reconstructed_v52_ledger_sha256"])
 def test_split_long_short(self):
  for cost in ("10","30"):
   v=self.report["cost"][cost]
   self.assertEqual(v["side"]["LONG"]["trades"],35)
   self.assertEqual(v["side"]["SHORT"]["trades"],52)
   self.assertEqual(v["overall"]["trades"],v["side"]["LONG"]["trades"]+v["side"]["SHORT"]["trades"])
 def test_win_loss_counts_and_capital(self):
  for cost in ("10","30"):
   r=self.report["cost"][cost]
   self.assertEqual(r["overall"]["wins"]+r["overall"]["losses"],87)
   self.assertAlmostEqual(r["overall"]["netContributionJpy"],r["overall"]["positiveContributionJpy"]+r["overall"]["negativeContributionJpy"],places=4)
   self.assertAlmostEqual(r["overall"]["netContributionJpy"],r["side"]["LONG"]["netContributionJpy"]+r["side"]["SHORT"]["netContributionJpy"],places=4)
   self.assertAlmostEqual(r["overall"]["netContributionJpy"],sum(v["netContributionJpy"] for v in r["bySymbol"].values()),places=4)
   self.assertGreater(r["overall"]["syntheticIsolatedEndJpy"],10000)
 def test_realized_only_dd_bounds(self):
  for cost in ("10","30"):
   v=self.report["cost"][cost]
   self.assertLess(v["overall"]["closedTradeOnlyMaxDDPct"],0)
   self.assertGreater(v["overall"]["closedTradeOnlyMaxDDPct"],-10)
   self.assertLess(v["side"]["SHORT"]["closedTradeOnlyMaxDDPct"],v["side"]["LONG"]["closedTradeOnlyMaxDDPct"])
 def test_short_price_stop5_did_not_touch_any_saved_h1(self):
  for cost in ("10","30"):
   counts=self.report["cost"][cost]["potentialShortOHLCStopTouchesAtOrAbovePct"]
   self.assertEqual(counts["5"],0)
   self.assertEqual(counts["3"],0)
   self.assertEqual(counts["2"],0)
   self.assertEqual(counts["1.5"],1)
   self.assertEqual(counts["1"],2)
 def test_replay_compounding_toy(self):
  pair=[{"exit_ts_ms":10,"entry_ts_ms":0,"total_pnl_jpy":10,"entry_equity":100,"symbol":"TSLAUSDT","side":"SHORT","candidate_id":"A"},
        {"exit_ts_ms":20,"entry_ts_ms":10,"total_pnl_jpy":-20,"entry_equity":100,"symbol":"TSLAUSDT","side":"SHORT","candidate_id":"B"}]
  result=a.comp(pair)
  self.assertAlmostEqual(result["syntheticIsolatedEndJpy"],8800)
  self.assertAlmostEqual(result["closedTradeOnlyMaxDDPct"],-20)
 def test_old_native_11_skipped_untouched(self):
  skipped=[x for x in self.native if x.get("status")!="MODELED_CLOSED_TRADE"]
  self.assertEqual(len(skipped),11)
  for name in s.CASES:
   p=ROOT/"v52_stock_risk_sensitivity_20261022"/name/"v52-model-ledger.jsonl"
   self.assertTrue(p.exists())
   rows=s.native.m.jsonl(p)
   self.assertEqual(len(rows),99)
   for orig,new in zip(self.native,rows):
    if orig.get("status")!="MODELED_CLOSED_TRADE":self.assertEqual(orig,new)
 def test_short_sizing_cannot_change_entries_exits_or_long(self):
  for name in s.CASES:
   rows=s.native.m.jsonl(ROOT/"v52_stock_risk_sensitivity_20261022"/name/"v52-model-ledger.jsonl")
   delta=0
   for orig,new in zip(self.native,rows):
    changed={k for k in orig if orig[k]!=new[k]}
    self.assertTrue(changed<=set(["slot_gross"]),changed)
    if changed:
     delta+=1
     self.assertEqual(orig["side"],"SHORT")
     threshold,target=s.CASES[name]
     self.assertLess(float(orig["entry_basis_bps"]),threshold)
     self.assertAlmostEqual(new["slot_gross"],target)
   self.assertIn(delta,(19,26))
 def test_historical_shared_equity_is_not_standalone(self):
  r=self.report["cost"]["10"]
  self.assertGreater(r["overall"]["netContributionJpy"],1e7)
  self.assertLess(r["overall"]["syntheticIsolatedEndJpy"],1e5)
  self.assertLess(r["overall"]["closedTradeOnlyMaxDDPct"],0)
 def test_no_live_or_production_cert(self):
  self.assertTrue(self.report["noProductionChanges"])
  self.assertFalse(self.report["cost"]["10"]["sourceIsLiveFillCertified"])
  self.assertEqual(s.OUTCOME,"RESEARCH_ONLY_FIXED_NATIVE_STOCK_TAPE_V52_SIZE_SENSITIVITY")

if __name__=="__main__":unittest.main()
