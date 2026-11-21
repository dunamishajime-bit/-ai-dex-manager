#!/usr/bin/env python3
"""P20 structural short strategy vs original 53 frozen source: reference execution contract."""
import json
import csv
import unittest
from pathlib import Path
from collections import defaultdict,Counter
R=Path(__file__).resolve().parents[1]/"results"
P="PRISM7_P20_PENGU_S3_"
class S3NativeControl(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.summary=json.loads((R/(P+"SOURCE_COMPARISON_SUMMARY_20261122.json")).read_text(encoding="utf-8"))
  with (R/(P+"ALL_CANDIDATES_20261122.csv")).open("r",encoding="utf-8",newline="") as f:
   cls.candidates=list(csv.DictReader(f))
  with (R/(P+"ALL_TRADE_EVENTS_20261122.jsonl")).open("r",encoding="utf-8") as f:
   cls.events=[json.loads(x) for x in f if x.strip()]
  cls.source=json.loads((R/"PRISM7_P8_PINNED_NATIVE53_REAL_PARITY_20261122_53_CASES.json").read_text(encoding="utf-8"))
 def test_three_frozen_archetypes_and_no_future_source(self):
  a=self.summary
  self.assertEqual(a["researchEngineName"],"PENGU_S3_STRUCTURE_V1")
  self.assertEqual(a["pinnedComparisonV20RuntimeSHA"],"1657e173d250ad58f53e62f7bb0a3428fb405496")
  self.assertEqual(a["originalSourceNaturalIntents"],53)
  self.assertEqual(a["originalSourceNativeWins"],29)
  self.assertEqual(len(self.candidates),120)
  self.assertEqual(a["newPrimaryRouteCounts"],{
   "SELLER_PULLBACK_REJECTION":58,
   "BREAKDOWN_RETEST_FAILURE":58,
   "RELATIVE_WEAKNESS_DOWNSHIFT":4,
  })
  for x in self.candidates:
   self.assertEqual(int(x["signalReferenceTs"])+3600000,int(x["intentTs"]))
   self.assertEqual(x["futurePricesUsedToFormSignal"],"False")
   self.assertIn(x["route"],a["newPrimaryRouteCounts"])
 def test_all_raw_source_candidates_are_retained_as_control(self):
  self.assertEqual(len(self.source),53)
  x=[z for z in self.events if z["group"]=="SOURCE53_ALL_CANDIDATES"]
  self.assertEqual(len(x),53)
  old={(a["period"],a["id"],int(a["entryTs"])):a for a in self.source}
  for z in x:
   k=(z["cohort"],z["id"],z["intentTs"])
   o=old[k]
   self.assertEqual(z["sourceNativeExitTs"],o["exitTs"])
   self.assertEqual(z["sourceNativeExitPrice"],o["exitPrice"])
   self.assertEqual(z["sourceNativePnL30Pct"],o["net30pct"])
 def test_single_slot_state_keeps_opportunity_rejections_visible(self):
  s3=[z for z in self.events if z["group"]=="S3_SINGLE_SLOT"]
  source=[z for z in self.events if z["group"]=="SOURCE53_SINGLE_SLOT"]
  self.assertEqual(len(s3),120)
  self.assertEqual(len(source),53)
  self.assertEqual(Counter(z["status"] for z in s3),{
   "PRICE_PROXY_CLOSED":53,"OCCUPIED_SLOT":65,"ENTRY_PRINT_MISSING":2})
  self.assertEqual(Counter(z["status"] for z in source),{
   "PRICE_PROXY_CLOSED":33,"OCCUPIED_SLOT":20})
  for group in (s3,source):
   prev_exit=-1
   for a in group:
    if a["status"]=="PRICE_PROXY_CLOSED":
     self.assertGreaterEqual(a["intentTs"],prev_exit+300000)
     prev_exit=a["exitProxyTs"]
    self.assertFalse(a["sourceVenueSignedFillProven"])
    self.assertTrue(a["sourceEconomicStop72ReferenceOnly"])
 def test_reference_exit_price_time_and_no_false_owner_fills(self):
  for z in self.events:
   if z["status"]!="PRICE_PROXY_CLOSED":continue
   self.assertGreater(z["entryProxyPrice"],0)
   self.assertGreater(z["exitProxyPrice"],0)
   self.assertGreaterEqual(z["entryProxyTs"],z["intentTs"])
   self.assertLess(z["entryProxyTs"],z["intentTs"]+3600000)
   self.assertGreaterEqual(z["exitProxyTs"],z["entryProxyTs"])
   self.assertIn(z["exitReason"],{"REFERENCE_HARD_STOP","REFERENCE_TRAILING_STOP",
                                  "REFERENCE_MAX_HOLD_72H"})
   self.assertFalse(z["sameEntryM5StopTouchAmbiguous"])
   if z["exitReason"]!="REFERENCE_MAX_HOLD_72H":
    self.assertGreaterEqual(z["exitProxyPrice"]+1e-11,z["stopLevel"])
 def test_economics_fees_slip_monotonic_and_source_winner_limit(self):
  groups=defaultdict(dict)
  for z in self.summary["economic"]:
   if "cohort" in z:continue
   groups[z["strategyGroup"]][(z["feeBps"],z["additionalExitSlippageBps"])]=z
  for name,g in groups.items():
   self.assertEqual(len(g),6)
   for fee in [10,30]:
    self.assertGreater(g[(fee,0)]["meanNetPctConditional"],
                       g[(fee,25)]["meanNetPctConditional"])
   self.assertAlmostEqual(g[(10,0)]["meanNetPctConditional"]-
                          g[(30,0)]["meanNetPctConditional"],.2,places=6)
  a=groups["S3_SINGLE_SLOT"][(30,0)]
  b=groups["SOURCE53_SINGLE_SLOT"][(30,0)]
  self.assertEqual(a["priceProxyClosed"],53)
  self.assertEqual(b["priceProxyClosed"],33)
  self.assertLess(a["profitFactorConditional"],b["profitFactorConditional"])
  self.assertGreater(a["referenceSequentialRealizedDDPct"],b["referenceSequentialRealizedDDPct"])
if __name__=="__main__":unittest.main(verbosity=2)
