#!/usr/bin/env python3
"""P13 source53 frozen M5 print proxy checks. No signed fills or native reprice."""
from pathlib import Path
import csv,json,unittest
from collections import defaultdict
R=Path(__file__).resolve().parents[1]/"results"
class ProxyProof(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.summary=json.loads((R/"PRISM7_P13_NATIVE53_M5_PRICE_PROXY_SUMMARY_20261122.json").read_text(encoding="utf-8"))
  with (R/"PRISM7_P13_NATIVE53_M5_PRICE_PROXY_636_CASES_20261122.csv").open("r",encoding="utf-8",newline="") as f:
   cls.data=list(csv.DictReader(f))
  cls.by={(x["period"],x["id"],x["entryTs"],x["priceScenario"],x["feeBps"],x["additionalExitSlippageBps"]):x for x in cls.data}

 def test_all_source_intents_retained_twelve_independent_scenarios(self):
  self.assertEqual(len(self.data),636)
  self.assertEqual(len(self.by),636)
  self.assertEqual(self.summary["naturalSource53Intents"],53)
  self.assertEqual(self.summary["sourceModelWins30"],29)
  self.assertEqual(len(self.summary["summary"]),12)
  for scenario in self.summary["summary"]:
   self.assertEqual(scenario["sourceIntentCount"],53)
   self.assertEqual(scenario["proxyComplete"],52)
   self.assertEqual(scenario["entryProxyNotWitnessed"],1)
   self.assertEqual(scenario["exitProxyNotWitnessed"],0)
   self.assertEqual(scenario["sourceWinsAllIntents"],29)

 def test_unchanged_source_signals_and_no_false_fill(self):
  keys={(x["period"],x["id"],x["entryTs"]) for x in self.data}
  self.assertEqual(len(keys),53)
  for row in self.data:
   self.assertEqual(row["pinnedRuntimeSha"],"1657e173d250ad58f53e62f7bb0a3428fb405496")
   self.assertEqual(row["proxyNotSignedOwnerFill"],"True")
   self.assertEqual(row["fullNativeDynamicStopReplayedWithProxyEntry"],"False")
   if row["status"]=="PRICE_PROXY_OBSERVED":
    self.assertGreater(float(row["entryWitnessTradeOpen"]),0)
    self.assertGreater(float(row["exitExecutionPriceProxy"]),0)
   else:
    self.assertEqual(row["status"],"NO_ENTRY_POSITIVE_PRINT_IN_H1")
    self.assertEqual(row["exitExecutionPriceProxy"],"")
  miss=self.summary["sourceEntryNotWitnessedCaseIds"]
  self.assertEqual(len(miss),1)
  self.assertEqual(miss[0]["id"],"PENGU_00071")

 def test_cost_and_extra_slippage_never_improve_proxy_net(self):
  grouped=defaultdict(list)
  for x in self.data:
   if x["status"]!="PRICE_PROXY_OBSERVED":continue
   key=(x["period"],x["id"],x["entryTs"],x["priceScenario"])
   grouped[key].append(x)
  self.assertEqual(len(grouped),52*2)
  for key,items in grouped.items():
   values={(int(x["feeBps"]),int(x["additionalExitSlippageBps"])):float(x["net_pct"]) for x in items}
   for fee in [10,30]:
    self.assertGreaterEqual(values[(fee,0)]+1e-7,values[(fee,10)])
    self.assertGreaterEqual(values[(fee,10)]+1e-7,values[(fee,25)])
   for slip in [0,10,25]:
    self.assertAlmostEqual(values[(10,slip)]-values[(30,slip)],.20,places=7)

 def test_gap_model_never_better_than_source_stop_level(self):
  for row in self.data:
   if row["priceScenario"]!="STOP_AT_SOURCE_LEVEL":continue
   key=(row["period"],row["id"],row["entryTs"],
         "STOP_GAP_AT_FIRST_PRINT_OPEN",row["feeBps"],row["additionalExitSlippageBps"])
   gap=self.by[key]
   if row["status"]!="PRICE_PROXY_OBSERVED":continue
   self.assertLessEqual(float(gap["net_pct"]),float(row["net_pct"])+1e-8)
   if row["sourceExitIsStop"]!="1":
    self.assertEqual(gap["exitExecutionPriceProxy"],row["exitExecutionPriceProxy"])

 def test_expected_30bps_realistic_model_result_is_not_native_proof(self):
  group={(x["scenario"],x["feeBps"],x["additionalExitSlippageBps"]):x for x in self.summary["summary"]}
  base=group[("STOP_GAP_AT_FIRST_PRINT_OPEN",30,0)]
  stress=group[("STOP_GAP_AT_FIRST_PRINT_OPEN",30,25)]
  self.assertEqual(base["proxyWinsConditionalOnObserved"],29)
  self.assertEqual(stress["proxyWinsConditionalOnObserved"],27)
  self.assertAlmostEqual(base["proxyMeanNetConditionalPct"],.85738052,places=8)
  self.assertAlmostEqual(stress["proxyMeanNetConditionalPct"],.60738052,places=8)
  self.assertAlmostEqual(base["proxyPricePfConditional"],1.31628055,places=8)
  self.assertAlmostEqual(stress["proxyPricePfConditional"],1.21517484,places=8)
if __name__=="__main__":
 unittest.main(verbosity=2)
