#!/usr/bin/env python3
"""PRISM VII P14 source 53 natural SHORT, native H1/M5 event-time contract.

Validates candidate preservation, no preentry fills, event ordering, stop
policy source pin, fee/slip monotonicity and no signed fill claims.
"""
import json
import pathlib
import unittest
from collections import Counter,defaultdict
from statistics import mean
R=pathlib.Path(__file__).resolve().parents[1]/"results"
P="PRISM7_P14_NATIVE53_M5_CLOCK_REPRICE_SUMMARY_20261122"
def j(s):return json.loads((R/s).read_text(encoding="utf-8"))
def jl(s):return [json.loads(x) for x in (R/s).read_text(encoding="utf-8").splitlines() if x.strip()]
class NativeM5ClockContract(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.sum=j(P+".json")
  cls.events=j(P+"_EVENTS_53.json")
  cls.cases=jl(P+"_SCENARIOS_318.jsonl")
  cls.native=j("PRISM7_P8_PINNED_NATIVE53_REAL_PARITY_20261122_53_CASES.json")
 def test_pin_and_source_original_53_permanent(self):
  self.assertEqual(self.sum["pinnedSourceSha"],"1657e173d250ad58f53e62f7bb0a3428fb405496")
  self.assertEqual(self.sum["nativeEntryAndExitPrecondition"],"PASS_53_53")
  self.assertEqual(self.sum["sourceOriginalIntents"],53)
  self.assertEqual(self.sum["sourceOriginalWins"],29)
  self.assertEqual(len(self.events),53)
  source={(x["period"],x["id"],x["entryTs"]):x for x in self.native}
  for e in self.events:
   s=source[(e["period"],e["id"],e["sourceEntryTs"])]
   self.assertEqual(s["entryPrice"],e["sourceEntryPrice"])
   self.assertEqual(s["exitPrice"],e["sourceExitPrice"])
   self.assertEqual(s["exitTs"],e["sourceExitTs"])
   self.assertEqual(s["exitReason"],e["sourceExitReason"])
   self.assertEqual(s["net30pct"],e["sourceNativeNet30Pct"])
 def test_native_source_stop_policy(self):
  self.assertEqual(self.sum["sourceNativeStopPolicy"],{
   "hardStopPct":.08,"trailingActivationPct":.15,
   "trailingRetracePct":.04,"maxHoldHours":72})
  self.assertEqual(self.sum["observedProxyReasons"]["SHORT_HARD_STOP"],14)
  self.assertEqual(self.sum["observedProxyReasons"]["SHORT_TRAILING_STOP"],9)
  self.assertEqual(self.sum["observedProxyReasons"]["SHORT_MAX_HOLD"],27)
  self.assertEqual(self.sum["observedProxyReasons"]["SHORT_V20_DEADLINE_EXIT"],2)
 def test_initial_missing_print_excluded_not_falsified(self):
  self.assertEqual(self.sum["modelStatusCounts"]["PRICE_PROXY_CLOSED"],52)
  self.assertEqual(self.sum["modelStatusCounts"]["NO_ENTRY_POSITIVE_PRINT_IN_H1"],1)
  unmatched=[e for e in self.events if e["model"]["status"]!="PRICE_PROXY_CLOSED"]
  self.assertEqual(len(unmatched),1)
  self.assertEqual(unmatched[0]["id"],"PENGU_00071")
  self.assertTrue(unmatched[0]["sourceNativeNet30Pct"]>6)
  self.assertEqual(len(self.cases),318)
  for x in self.cases:
   if x["id"]=="PENGU_00071":self.assertIsNone(x["netPct"])
 def test_all_event_price_proxy_execs_after_entry_and_H1_signal(self):
  for event in self.events:
   m=event["model"]
   self.assertFalse(m["syntheticVenueFillProven"])
   if m["status"]!="PRICE_PROXY_CLOSED":continue
   self.assertGreaterEqual(m["observedEntryTs"],m["entryIntentTs"])
   self.assertLess(m["observedEntryTs"],m["entryIntentTs"]+3600000)
   self.assertGreaterEqual(m["observedExitBarStartTs"],m["observedEntryTs"])
   self.assertGreater(m["observedEntryPrice"],0)
   self.assertGreater(m["observedExitPrice"],0)
   if m["observedExitType"]=="NATIVE_H1_CLOSE_INTENT_NEXT_POSITIVE_M5_OPEN_PROXY":
    self.assertGreaterEqual(m["observedExitBarStartTs"],m["exitIntentTs"])
   elif m["observedExitType"]=="RESIDENT_STOP_M5_HIGH_FIRST_TOUCH_PROXY":
    self.assertEqual(m["observedExitBarStartTs"],m["exitIntentTs"])
    self.assertGreaterEqual(m["observedExitPrice"],m["exitIntentPriceProxy"])
   else:
    self.fail("UNEXPECTED_EXIT_TYPE")
 def test_all_fee_slippage_combinations_not_winrate_gamed(self):
  by=defaultdict(dict)
  for x in self.cases:
   key=(x["period"],x["id"],x["sourceEntryTs"])
   by[key][(x["feeBps"],x["extraExitSlippageBps"])]=x
   self.assertFalse(x["signedVenueFillProven"])
  self.assertEqual(len(by),53)
  for key,g in by.items():
   self.assertEqual(len(g),6)
   if g[(30,0)]["netPct"] is None:continue
   for fee in (10,30):
    v=[g[(fee,k)]["netPct"] for k in (0,10,25)]
    self.assertGreaterEqual(v[0],v[1])
    self.assertGreaterEqual(v[1],v[2])
   for slip in (0,10,25):
    self.assertAlmostEqual(g[(10,slip)]["netPct"]-g[(30,slip)]["netPct"],.2)
 def test_source_model_same_subset_and_unproven_execution(self):
  a=next(x for x in self.sum["economic"] if x["feeBps"]==30 and x["extraExitSlippageBps"]==0)
  self.assertEqual(a["sourceIntentCount"],53)
  self.assertEqual(a["modelProxyComplete"],52)
  self.assertEqual(a["proxyWinCountConditional"],29)
  self.assertAlmostEqual(a["proxyMeanNetConditionalPct"],.8587786422254624,places=9)
  self.assertAlmostEqual(a["proxyPfConditional"],1.3141020968528965,places=9)
  self.assertEqual(a["sameSubsetSourceWinCount"],28)
  self.assertEqual(a["newWinnersFromSourceLosers"],1)
  self.assertEqual(a["sourceWinnersNowLose"],0)
  self.assertEqual(sum(len(e["model"].get("eventLog",[])) for e in self.events),2812)
if __name__=="__main__":
 unittest.main(verbosity=2)
