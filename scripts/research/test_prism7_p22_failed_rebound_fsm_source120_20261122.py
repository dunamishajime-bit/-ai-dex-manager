#!/usr/bin/env python3
"""P22 S4 failed-buyer-retest structure vs unchanged P21 B/C: source120 preserved."""
import json,unittest
from pathlib import Path
from collections import Counter,defaultdict
R=Path(__file__).resolve().parents[1]/"results"
class P22(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.s=json.loads((R/"PRISM7_P22_PENGU_S4_FAILED_REBOUND_SUMMARY_20261122.json").read_text(encoding="utf-8"))
  cls.e=[json.loads(x) for x in (R/"PRISM7_P22_PENGU_S4_FAILED_REBOUND_240_EVENTS_20261122.jsonl").read_text(encoding="utf-8").splitlines() if x]
  cls.p21=[json.loads(x) for x in (R/"PRISM7_P21_PENGU_S3_CONFIRM_FSM_240_EVENTS_20261122.jsonl").read_text(encoding="utf-8").splitlines() if x]
 def test_preserves_p20_source120_and_routes(self):
  self.assertEqual(self.s["researchEngineName"],"PENGU_S4_FAILED_REBOUND_V1")
  self.assertEqual(self.s["originalP20H1Setups"],120)
  self.assertEqual(len(self.e),240)
  a=defaultdict(list)
  for x in self.e:a[x["group"]].append(x)
  self.assertEqual(set(a),{"S4_ALL_CANDIDATES","S4_SINGLE_SLOT"})
  for x in a.values():
   self.assertEqual(len(x),120)
   self.assertEqual(len(set(z["id"] for z in x)),120)
   self.assertEqual(Counter(z["route"] for z in x),{
    "SELLER_PULLBACK_REJECTION":58,
    "BREAKDOWN_RETEST_FAILURE":58,
    "RELATIVE_WEAKNESS_DOWNSHIFT":4,
   })
 def test_p21_B_C_states_and_affected_entries_unmodified(self):
  orig={x["id"]:x for x in self.p21 if x["group"]=="S3_CONFIRM_ALL_STRUCTURAL_SETUPS"
        and x["route"]!="SELLER_PULLBACK_REJECTION"}
  self.assertEqual(len(orig),62)
  for x in self.e:
   if x["group"]!="S4_ALL_CANDIDATES" or x["route"]=="SELLER_PULLBACK_REJECTION":continue
   o=orig[x["id"]]
   for key in ("sellerState","status","entryProxyTs","entryProxyPrice",
               "exitProxyTs","exitProxyPrice","exitReason","exitKind"):
    self.assertEqual(x.get(key),o.get(key))
 def test_failed_buyer_retest_8h_asof_then_later_entry(self):
  for x in self.e:
   if x["route"]!="SELLER_PULLBACK_REJECTION":continue
   st=x["sellerState"]
   if st["status"]!="FAILED_REBOUND_REJECTION_CONFIRMED":continue
   self.assertGreaterEqual(st["retestGainFromH1Close"],.015-1e-9)
   self.assertGreaterEqual(st["rejectionClose"],
       st["initialStructureSignalH1Close"]*1.005-1e-12)
   self.assertLessEqual(st["sellerThreeM5BuyRatio"],.42+1e-12)
   self.assertLessEqual(st["sellerThreeM5PositivePrintSpanMinutes"],35)
   self.assertGreater(st["rejectionM5StartTs"],st["retestM5StartTs"])
   self.assertGreaterEqual(st["entryProxyTs"],st["rejectionM5ClosedTs"])
   self.assertLess(st["entryProxyTs"],x["intentTs"]+8*3600000)
   self.assertLess(st["btcLatestCompletedH1StartTs"],st["rejectionM5ClosedTs"])
   self.assertLessEqual(st["btcCompleted6hReturnPct"],0)
   self.assertTrue(st["btcCloseBelowAsOfEMA72"])
   self.assertTrue(st["noFutureM5UsedInEntrySignal"])
 def test_primary_economics_and_right_censored(self):
  a=next(x for x in self.s["outcomes"] if x["group"]=="S4_SINGLE_SLOT" and
       x["feeBps"]==30 and x["additionalExitSlippageBps"]==0 and
       "route" not in x and "cohort" not in x)
  self.assertEqual((a["candidateIntents"],a["priceProxyClosed"],a["wins"]),(120,21,15))
  self.assertEqual(a["rightCensored"],1)
  self.assertEqual(a["occupiedSlot"],9)
  self.assertAlmostEqual(a["meanNetPctConditional"],4.93362992,places=8)
  self.assertAlmostEqual(a["profitFactorConditional"],3.905601,places=6)
  self.assertAlmostEqual(a["referenceSequentialRealizedDDPct"],16.101754,places=6)
 def test_old_reference_stop_and_real_market_fill_unproven(self):
  self.assertEqual(self.s["referenceStopHardPct"],.08)
  self.assertEqual(self.s["referenceStopTrailStartPct"],.15)
  self.assertEqual(self.s["referenceStopTrailRetracePct"],.04)
  self.assertEqual(self.s["referenceStopMaxHoldHours"],72)
  for x in self.e:
   self.assertFalse(x["sourceVenueSignedFillProven"])
   if x["status"]=="PRICE_PROXY_CLOSED":
    self.assertGreaterEqual(x["exitProxyTs"],x["entryProxyTs"])
    self.assertGreater(x["exitProxyPrice"],0)
 def test_fee_and_extra_slip_monotone(self):
  for group in ["S4_ALL_CANDIDATES","S4_SINGLE_SLOT"]:
   a=[x for x in self.s["outcomes"] if x["group"]==group and
      "route" not in x and "cohort" not in x]
   self.assertEqual(len(a),6)
   for fee in (10,30):
    z=sorted((x for x in a if x["feeBps"]==fee),key=lambda x:x["additionalExitSlippageBps"])
    self.assertTrue(z[0]["meanNetPctConditional"]>z[1]["meanNetPctConditional"]>
                    z[2]["meanNetPctConditional"])
if __name__=="__main__":unittest.main(verbosity=2)
