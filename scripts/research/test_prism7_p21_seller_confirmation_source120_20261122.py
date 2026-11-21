#!/usr/bin/env python3
"""P21 precommitted causal H1 structure -> M5 seller confirmation -> next print entry.

Regression does not certify actual venue fills or out-of-sample profitability.
"""
import json,unittest
from pathlib import Path
from collections import Counter,defaultdict
R=Path(__file__).resolve().parents[1]/"results"
P="PRISM7_P21_PENGU_S3_CONFIRM_FSM_"
class P21(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.a=json.loads((R/(P+"SUMMARY_20261122.json")).read_text(encoding="utf-8"))
  cls.events=[json.loads(z) for z in (R/(P+"240_EVENTS_20261122.jsonl")).read_text(encoding="utf-8").splitlines() if z.strip()]
  cls.old=json.loads((R/"PRISM7_P20_PENGU_S3_SOURCE_COMPARISON_SUMMARY_20261122.json").read_text(encoding="utf-8"))
 def test_source_structural_opportunities_never_dropped(self):
  self.assertEqual(self.a["original120H1StructureCandidatesPreserved"],120)
  self.assertEqual(len(self.events),240)
  by=defaultdict(list)
  for z in self.events:by[z["group"]].append(z)
  self.assertEqual(set(by),{"S3_CONFIRM_ALL_STRUCTURAL_SETUPS","S3_CONFIRM_SINGLE_SLOT"})
  self.assertTrue(all(len(v)==120 for v in by.values()))
  for group,rows in by.items():
   self.assertEqual(len(set(z["id"] for z in rows)),120)
   self.assertEqual(Counter(z["route"] for z in rows),
    {"SELLER_PULLBACK_REJECTION":58,"BREAKDOWN_RETEST_FAILURE":58,
     "RELATIVE_WEAKNESS_DOWNSHIFT":4})
 def test_after_completed_confirm_bar_and_next_print(self):
  for z in self.events:
   st=z["sellerState"]
   self.assertFalse(z["sourceVenueSignedFillProven"])
   self.assertTrue(z["entryIntentStillCounted"])
   if "confirmationM5CloseTs" not in st:continue
   self.assertGreater(st["confirmationM5CloseTs"],z["intentTs"])
   self.assertLess(st["confirmationM5CloseTs"],z["intentTs"]+2*3600000)
   self.assertLessEqual(
    st.get("confirmationThreePrintsEndTs",st["confirmationM5StartTs"])-st["confirmationThreePrintsStartTs"],35*60000)
   self.assertLessEqual(st["confirmationTakerBuyRatio"],.42+1e-12)
   if "confirmedPriceClose" in st:
    self.assertLessEqual(st["confirmedPriceClose"],
        st["H1StructureLowFixedAtSetup"]*(1-.002)+1e-12)
    self.assertGreaterEqual(st["entryProxyTs"],st["confirmationM5CloseTs"])
    self.assertLess(st["entryProxyTs"],z["intentTs"]+2*3600000)
 def test_profit_policy_and_source_original_reference(self):
  a=[x for x in self.a["resultSummary"] if x["group"]=="S3_CONFIRM_SINGLE_SLOT" and
     x["feeBps"]==30 and x["additionalExitSlippageBps"]==0 and
     "route" not in x and "cohort" not in x]
  self.assertEqual(len(a),1)
  z=a[0]
  self.assertEqual(z["candidateIntents"],120)
  self.assertEqual(z["priceProxyClosed"],34)
  self.assertEqual(z["wins"],19)
  self.assertEqual(z["occupiedSlot"],15)
  self.assertEqual(z["unconfirmedSellingWithin2H"],69)
  self.assertEqual(z["confirmedNoExecutionPrint"],2)
  self.assertEqual(z["rightCensored"],0)
  self.assertAlmostEqual(z["profitFactorConditional"],1.296183,places=6)
  self.assertAlmostEqual(z["meanNetPctConditional"],1.00244522,places=8)
  self.assertAlmostEqual(z["profitPctPointsPerAllInitialSetups"],.28402614,places=8)
 def test_single_slot_admission_is_chronological_and_total_metrics_labeled(self):
  entries=sorted((z for z in self.events if z["group"]=="S3_CONFIRM_SINGLE_SLOT"
                  and z["status"]=="PRICE_PROXY_CLOSED"),key=lambda z:z["entryProxyTs"])
  for i in range(1,len(entries)):
   self.assertGreaterEqual(entries[i]["entryProxyTs"],
       entries[i-1]["exitProxyTs"]+300000)
  self.assertTrue(all(z["sourceEconomicStop72ReferenceOnly"] for z in self.events))
  self.assertEqual(self.a["originalSourceNativeV20PinnedSha"],
    "1657e173d250ad58f53e62f7bb0a3428fb405496")
 def test_route_b_high_fraction_only_small_conditional_subset(self):
  by={z["route"]:z for z in self.a["resultSummary"] if z["group"]=="S3_CONFIRM_SINGLE_SLOT" and
     z["feeBps"]==30 and z["additionalExitSlippageBps"]==0 and "route" in z}
  a=by["SELLER_PULLBACK_REJECTION"];b=by["BREAKDOWN_RETEST_FAILURE"]
  self.assertEqual((a["priceProxyClosed"],a["wins"]),(22,9))
  self.assertEqual((b["priceProxyClosed"],b["wins"]),(12,10))
  self.assertEqual(b["candidateIntents"],58)
  self.assertGreater(b["profitFactorConditional"],5)
  self.assertLess(a["profitFactorConditional"],1)
 def test_cost_monotonic(self):
  a=self.a["resultSummary"]
  for group in ("S3_CONFIRM_ALL_STRUCTURAL_SETUPS","S3_CONFIRM_SINGLE_SLOT"):
   for fee in (10,30):
    m=sorted((x for x in a if x["group"]==group and x["feeBps"]==fee and
       "route" not in x and "cohort" not in x),
       key=lambda x:x["additionalExitSlippageBps"])
    self.assertEqual(len(m),3)
    self.assertTrue(m[0]["meanNetPctConditional"]>m[1]["meanNetPctConditional"]>
                    m[2]["meanNetPctConditional"])
if __name__=="__main__":unittest.main(verbosity=2)
