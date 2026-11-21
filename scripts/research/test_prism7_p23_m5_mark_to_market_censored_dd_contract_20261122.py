#!/usr/bin/env python3
"""P23 actual positive-volume M5 close/high mark risk including unclosed S4 source position."""
import json,unittest
from pathlib import Path
from collections import Counter
R=Path(__file__).resolve().parents[1]/"results"
class MarkRisk(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.summary=json.loads((R/"PRISM7_P23_M5_MARK_TO_MARKET_RISK_SUMMARY_20261122.json").read_text(encoding="utf-8"))
  cls.ledger=json.loads((R/"PRISM7_P23_M5_MARK_TO_MARKET_TRADE_RISK_LEDGER_20261122.json").read_text(encoding="utf-8"))
 def test_all_four_source_models_two_fees_three_slips(self):
  self.assertEqual(len(self.summary["groups"]),24)
  self.assertEqual(len(self.ledger),142)
  self.assertEqual(self.summary["feesBps"],[10,30])
  self.assertEqual(self.summary["additionalExitSlippageBps"],[0,10,25])
  self.assertEqual(Counter(x["group"] for x in self.ledger),{
    "SOURCE53_SINGLE_SLOT":33,"S3_SINGLE_SLOT":53,
    "S3_CONFIRM_SINGLE_SLOT":34,"S4_SINGLE_SLOT":22,
  })
 def test_censored_last_s4_mark_retained_and_all_groups_m5_dd_gt_20(self):
  m={x["group"]:x for x in self.summary["groups"]
     if x["feeBps"]==30 and x["exitSlippageBps"]==0}
  self.assertEqual(m["S4_SINGLE_SLOT"]["priceProxyClosed"],21)
  self.assertEqual(m["S4_SINGLE_SLOT"]["rightCensoredOpenPositions"],1)
  self.assertAlmostEqual(m["S4_SINGLE_SLOT"]["maximumM5CloseMarkToMarketDDPct"],35.94150348,places=8)
  self.assertAlmostEqual(m["S4_SINGLE_SLOT"]["maximumM5HighAdverseEnvelopeDDPct"],37.64670276,places=8)
  self.assertAlmostEqual(m["SOURCE53_SINGLE_SLOT"]["maximumM5CloseMarkToMarketDDPct"],32.45294329,places=8)
  self.assertTrue(all(x["maximumM5CloseMarkToMarketDDPct"]>20 for x in m.values()))
  z=[x for x in self.ledger if x["group"]=="S4_SINGLE_SLOT" and x["sourceStatus"].startswith("RIGHT_CENSORED")]
  self.assertEqual(len(z),1)
  self.assertIsNone(z[0]["exitTs"])
  self.assertFalse(z[0]["openUncensoredVenueFillProven"])
 def test_mark_high_stress_worst_drawdown_not_better_than_close(self):
  for x in self.summary["groups"]:
   self.assertGreaterEqual(x["maximumM5HighAdverseEnvelopeDDPct"]+1e-7,
                           x["maximumM5CloseMarkToMarketDDPct"])
   self.assertGreater(x["totalPositivePrintBarsDuringHold"],0)
   self.assertGreater(x["totalHoldingBarsChecked"],0)
 def test_fee_slippage_increases_equity_cost_without_intrabar_fill_claim(self):
  groups={}
  for x in self.summary["groups"]:
   groups[(x["group"],x["feeBps"],x["exitSlippageBps"])]=x
  for name in {x["group"] for x in self.summary["groups"]}:
   for fee in (10,30):
    x=[groups[(name,fee,s)]["referenceFinalEquityIncludingUnrealizedYen"] for s in (0,10,25)]
    self.assertGreater(x[0],x[1])
    self.assertGreater(x[1],x[2])
  for z in self.ledger:
   self.assertGreater(z["entrySourceOpen"],0)
   self.assertGreaterEqual(z["totalM5BarsInspected"],1)
   self.assertGreaterEqual(z["positiveM5PrintsObserved"],1)
 def test_specific_source_DD_21_percent_policy_not_certified(self):
  joined=" ".join(self.summary["limitations"])
  self.assertIn("funding",joined)
  self.assertIn("other Runner",joined)
  self.assertIn("NOT",joined)
if __name__=="__main__":unittest.main(verbosity=2)
