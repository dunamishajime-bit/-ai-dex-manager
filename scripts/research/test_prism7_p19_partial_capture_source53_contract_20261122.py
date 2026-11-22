#!/usr/bin/env python3
"""P19 fixed fraction cashflow non-improvement and 53 original intent preservation."""
import csv,json,unittest
from pathlib import Path
from collections import defaultdict
R=Path(__file__).resolve().parents[1]/"results"
S="PRISM7_P19_SOURCE53_PARTIAL_CAPTURE_SUMMARY_20261122.json"
L="PRISM7_P19_SOURCE53_PARTIAL_CAPTURE_3180_CASES_20261122.csv"
class CashFlowContract(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.summary=json.loads((R/S).read_text(encoding="utf-8"))
  with (R/L).open("r",encoding="utf-8",newline="") as f:cls.rows=list(csv.DictReader(f))
 def test_full_53_intents_and_all_scenarios(self):
  a=self.summary
  self.assertEqual(a["sourceNaturalIntents"],53)
  self.assertEqual(len(self.rows),3180)
  self.assertEqual(len(a["outcomes"]),60)
  self.assertEqual(a["fractions"],[0,.25,.5,.75,1])
  self.assertEqual(a["feesBps"],[10,30])
  for m in a["outcomes"]:
   self.assertEqual(m["sourceOriginalIntentCount"],53)
   self.assertEqual(m["priceProxyObserved"],52)
   self.assertEqual(m["sourceIntentPriceUnobserved"],1)
 def test_never_create_signed_fill_and_unobserved_source_winner(self):
  u=[x for x in self.rows if x["status"]!="SOURCE_PRICE_PROXY_OBSERVED"]
  self.assertEqual(len(u),60)
  self.assertEqual(set(x["id"] for x in u),{"PENGU_00071"})
  for row in self.rows:
   self.assertEqual(row["sourcePriceProxyExecutionNotSignedFill"],"True")
   self.assertEqual(row["residualSTOPStateRecomputedAfterPartial"],"False")
   self.assertEqual(row["sourceNaturalTradeIntentPreserved"],"True")
  self.assertTrue(all(x["net_pct"]=="" for x in u))
 def test_no_nonzero_fraction_restores_mean_or_pf(self):
  for rule in self.summary["rules"]:
   for fee in [10,30]:
    arr=sorted([x for x in self.summary["outcomes"] if x["rule"]==rule and
       x["feeBps"]==fee and x["earlyExitAdditionalSlippageBps"]==0],
       key=lambda x:x["partialCloseFraction"])
    self.assertEqual(len(arr),5)
    means=[x["scenarioMeanNetPctConditional"] for x in arr]
    pfs=[x["scenarioProfitFactorConditional"] for x in arr]
    self.assertTrue(all(means[i+1]<means[i] for i in range(4)))
    self.assertTrue(all(pfs[i+1]<pfs[i] for i in range(4)))
    base,full=means[0],means[-1]
    for x in arr:
     f=x["partialCloseFraction"]
     self.assertAlmostEqual(x["scenarioMeanNetPctConditional"],(1-f)*base+f*full,places=9)
 def test_zero_fraction_fee_and_slip_is_source_even_with_triggers(self):
  for rule in self.summary["rules"]:
   for fee in [10,30]:
    arr=[x for x in self.summary["outcomes"] if x["rule"]==rule and
         x["feeBps"]==fee and x["partialCloseFraction"]==0]
    self.assertEqual(len(arr),3)
    self.assertEqual(len(set(x["scenarioMeanNetPctConditional"] for x in arr)),1)
    self.assertTrue(all(x["scenarioWins"]==29 for x in arr))
 def test_30bps_50pct_strong_btc_does_not_convert_losses(self):
  sel=next(x for x in self.summary["outcomes"] if x["rule"]=="BTC_STRONG_BOUNCE_LOCK" and
     x["partialCloseFraction"]==.5 and x["feeBps"]==30 and x["earlyExitAdditionalSlippageBps"]==0)
  self.assertEqual(sel["scenarioWins"],29)
  self.assertEqual(sel["sourceLosersNowWin"],0)
  self.assertAlmostEqual(sel["scenarioMeanNetPctConditional"],.713727,places=6)
if __name__=="__main__":unittest.main(verbosity=2)
