#!/usr/bin/env python3
"""P32 native pinned exit function adapted to new S4 entries: research source contract."""
import json,unittest
from pathlib import Path
R=Path(__file__).resolve().parents[1]/"results"
P="PRISM7_P32_S4_NATIVE_V20_EXIT_REPLAY_SUMMARY_20261122"
class P32(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.s=json.loads((R/(P+".json")).read_text(encoding="utf-8"))
  cls.all=json.loads((R/(P+"_NATIVE_ALL120_EVENTS.json")).read_text(encoding="utf-8"))
  cls.single=json.loads((R/(P+"_NATIVE_ALL120_SINGLE_SLOT.json")).read_text(encoding="utf-8"))
  cls.details=json.loads((R/(P+"_NATIVE_EXIT_31_POSITION_DETAIL.json")).read_text(encoding="utf-8"))
  cls.old=[json.loads(x) for x in (R/"PRISM7_P22_PENGU_S4_FAILED_REBOUND_240_EVENTS_20261122.jsonl").read_text(encoding="utf-8").splitlines() if x]
  cls.source=json.loads((R/"PRISM7_P8_PINNED_NATIVE53_REAL_PARITY_20261122_53_CASES.json").read_text(encoding="utf-8"))
 def test_pinned_original_source53_still_29wins_and_53_parity(self):
  self.assertEqual(self.s["immutablePinnedV20Sha"],"1657e173d250ad58f53e62f7bb0a3428fb405496")
  self.assertEqual(self.s["sourceNative53OriginalTradeParity"],"PASS_53_53")
  self.assertEqual(self.s["nativeSourceOriginal53WinsUnchanged"],29)
  self.assertEqual(len(self.source),53)
  self.assertEqual(sum(x["net30pct"]>0 for x in self.source),29)
 def test_new_s4_entry_intents_entry_time_price_unmodified(self):
  old={z["id"]:z for z in self.old if z["group"]=="S4_ALL_CANDIDATES"}
  self.assertEqual(len(old),120)
  self.assertEqual(len(self.all),120)
  self.assertEqual(len(self.single),120)
  self.assertEqual(len(set(x["id"] for x in self.all)),120)
  self.assertEqual(len(self.details),self.s["originalS4PositiveM5EntryCandidates"])
  for x in self.all:
   o=old[x["id"]]
   for fld in ("intentTs","entryProxyTs","entryProxyPrice","route","cohort"):
    self.assertEqual(x[fld],o[fld])
   self.assertTrue(x["newS4EntryNotGeneratedByPinnedV20NativeSignal"])
   self.assertTrue(x["useOnlyImmutablePinnedNativeShortExit"])
 def test_native_state_started_only_after_completed_H1_anchor(self):
  old={z["id"]:z for z in self.old if z["group"]=="S4_ALL_CANDIDATES"}
  for d in self.details:
   y=d["nativePinnedExitSimulatedFromNewS4Entry"]
   self.assertTrue(y["sourcePinNativeV20StateUsed"])
   self.assertTrue(y["fromNewS4EntryNotPinnedV20Signal"])
   self.assertLess(y["sourceH1Anchor"],y["entryTs"])
   self.assertEqual(y["entryTs"],old[d["id"]]["entryProxyTs"])
   self.assertEqual(y["entryPrice"],old[d["id"]]["entryProxyPrice"])
   if y["status"]=="PRICE_PROXY_CLOSED":
    self.assertGreaterEqual(y["exitTs"],y["entryTs"])
    self.assertGreater(y["exitPrice"],0)
 def test_source_native_h1_nonstop_did_not_execute_in_the_past(self):
  for d in self.details:
   z=d["nativePinnedExitSimulatedFromNewS4Entry"]
   for event in z["eventLog"]:
    if event["kind"]=="SOURCE_H1_V20_COMPLETED_NON_RESIDENT_EXIT_INTENT":
     self.assertTrue(isinstance(event["nativeReason"],str) and
                     event["nativeReason"].startswith("SHORT_"))
     self.assertIn("intentNotBeforeTs",event)
     if z["status"]=="PRICE_PROXY_CLOSED":
      self.assertGreaterEqual(z["exitTs"],event["intentNotBeforeTs"])
 def test_costs_and_source_original_reference_comparator_separate(self):
  a=self.s["allCostAndSourceComparatorStats"]
  self.assertEqual(len(a),6)
  self.assertEqual(set(x["feeBps"] for x in a),{10,30})
  for fee in (10,30):
   z=[x for x in a if x["feeBps"]==fee]
   self.assertEqual(len(z),3)
   self.assertTrue(all(x["originalSetupCount"]==120 for x in z))
   self.assertTrue(all(x["sourceRiskIsOneAsset1xOnly"] for x in z))
  x=next(x for x in a if x["group"]=="PINNED_NATIVE_S4_SINGLE_SLOT" and x["feeBps"]==30)
  self.assertGreater(x["priceProxyClosed"],0)
  self.assertLessEqual(x["priceProxyClosed"],self.s["originalS4PositiveM5EntryCandidates"])
if __name__=="__main__":unittest.main(verbosity=2)
