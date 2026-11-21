#!/usr/bin/env python3
"""P25 source S4 event-time cross-asset crash test.

Check frozen 120 setup, 30 scenario/3600 candidate ledger, 1 event, two-price
delay, no signed venue fills, all results conditioning and 1 censored position.
"""
import csv,json,unittest
from pathlib import Path
from collections import Counter,defaultdict
R=Path(__file__).resolve().parents[1]/"results"
class P25(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.a=json.loads((R/"PRISM7_P25_CAPITULATION_30_SCENARIO_SUMMARY_20261122.json").read_text(encoding="utf-8"))
  cls.events=json.loads((R/"PRISM7_P25_CAPITULATION_120_SOURCE_EVENTS_20261122.json").read_text(encoding="utf-8"))
  with (R/"PRISM7_P25_CAPITULATION_3600_SCENARIO_CANDIDATES_20261122.csv").open("r",encoding="utf-8",newline="") as f:
   cls.rows=list(csv.DictReader(f))
 def test_native_source_120_all_scenarios_preserved(self):
  self.assertEqual(self.a["source120P22AllSetupParity"],"PASS")
  self.assertEqual(self.a["sourceS4SingleSlot120BaselineReplay"],"PASS")
  self.assertEqual(len(self.events),120)
  self.assertEqual(len(self.a["costAndExitDelayScenarios"]),30)
  self.assertEqual(len(self.rows),3600)
  self.assertEqual(self.a["pinnedV20Sha"],"1657e173d250ad58f53e62f7bb0a3428fb405496")
  self.assertEqual(len(set((x["scenarioDelay"],x["scenarioExtraExitSlipBps"],x["feeBps"]) for x in self.rows)),30)
  for s in self.a["costAndExitDelayScenarios"]:
   self.assertEqual(s["referenceEconomics"]["candidateIntents"],120)
   self.assertEqual(s["referenceM5MarkRisk"]["sourceIntents"],120)
   self.assertEqual(s["referenceM5MarkRisk"]["rightCensoredOpenPositions"],1)
 def test_confirmed_source_signal_is_one_and_no_future_m5(self):
  confirmed={k:v for k,v in self.events.items() if v["state"]=="CROSS_ASSET_CAPITULATION_CONFIRMED"}
  self.assertEqual(list(confirmed),["S3_01700"])
  e=confirmed["S3_01700"]
  self.assertEqual(e["eventM5OpenTs"],1760130900000)
  self.assertEqual(e["eventCloseTs"],1760131200000)
  self.assertFalse(e["signalUsesFutureM5Bars"])
  self.assertFalse(e["venueSignedFillProven"])
  self.assertLess(e["pengu5mDropPct"],-55)
  self.assertLess(e["btc5mDropPct"],-6.5)
  self.assertLess(e["penguTakerBuyVolumeRatio"],.45)
  self.assertEqual([q["ts"] for q in e["first3AfterSignalPositiveM5OpenProxies"]],
                   [1760131200000,1760131500000,1760131800000])
  for q in e["first3AfterSignalPositiveM5OpenProxies"]:
   self.assertGreaterEqual(q["ts"],e["eventCloseTs"])
   self.assertLess(q["ts"],e["sourceBaselineExitTs"])
   self.assertGreater(q["positiveVolumeNotionalUSDT"],0)
 def test_extra_btc_invalid_quote_outside_source_position_only(self):
  q=self.a["sourceBTCM5QuarantinedOffPosition"]
  self.assertEqual(len(q),1)
  self.assertEqual(q[0]["timestamp"],1757771400000)
  self.assertEqual(q[0]["overlappingS4CandidatePositions"],0)
  self.assertTrue(q[0]["priceNotModified"])
 def test_main_30bps_two_positive_print_25min_proxy_and_s4_profit(self):
  x=self.a["mainCase30bpsDelay2ExtraSlip0"]
  self.assertEqual(x["selectedSingleSlotExitOverrides"],1)
  self.assertEqual(x["source120CandidateExitOverrides"],1)
  self.assertEqual(x["referenceEconomics"]["priceProxyClosed"],21)
  self.assertEqual(x["referenceEconomics"]["wins"],15)
  self.assertAlmostEqual(x["referenceEconomics"]["meanNetPctConditional"],7.01950296)
  self.assertAlmostEqual(x["referenceEconomics"]["profitFactorConditional"],5.13405)
  self.assertAlmostEqual(x["referenceM5MarkRisk"]["maximumM5CloseMarkToMarketDDPct"],21.95877323)
  self.assertGreater(x["referenceM5MarkRisk"]["maximumM5HighAdverseEnvelopeDDPct"],37)
  self.assertGreater(x["referenceM5MarkRisk"]["maximumM5CloseMarkToMarketDDPct"],20)
  self.assertEqual(x["selectedSingleSlotExitOverrides"],x["referenceEconomics"]["exitReasons"]["RESEARCH_P25_CAPITULATION_CAPTURE"])
 def test_simulated_execution_delay_and_slippage_never_stated_as_fills(self):
  for z in self.rows:
   self.assertEqual(z["signedFill"],"False")
   self.assertEqual(z["sourceEntryIntentTs"]!="",True)
  events=[z for z in self.rows if z["p25EarlyExitApplied"]=="True"]
  self.assertEqual(len(events),30)
  self.assertEqual(set(z["id"] for z in events),{"S3_01700"})
  for z in events:
   q=self.events[z["id"]]["first3AfterSignalPositiveM5OpenProxies"]
   nth=int(z["scenarioDelay"])
   self.assertEqual(int(z["exitTs"]),q[nth-1]["ts"])
   self.assertGreaterEqual(int(z["exitTs"]),self.events[z["id"]]["eventCloseTs"])
   self.assertLess(int(z["exitTs"]),self.events[z["id"]]["sourceBaselineExitTs"])
 def test_cost_extra_slip_monotone_and_profit_under_bad_fill(self):
  cases=self.a["costAndExitDelayScenarios"]
  for fee in (10,30):
   for delay in (1,2,3):
    a=sorted((z for z in cases if z["feeBps"]==fee and z["delayPositiveM5PrintsAfterSignal"]==delay),
       key=lambda z:z["additionalEntryIndependentExitSlipBps"])
    self.assertEqual(len(a),5)
    nets=[z["referenceEconomics"]["meanNetPctConditional"] for z in a]
    self.assertTrue(all(nets[i]>nets[i+1] for i in range(4)))
    self.assertTrue(all(z["selectedSingleSlotExitOverrides"]==1 for z in a))
  for fee in (10,30):
   r=[z for z in cases if z["feeBps"]==fee and z["additionalEntryIndependentExitSlipBps"]==0]
   self.assertEqual(len(r),3)
   s=sorted(r,key=lambda x:x["delayPositiveM5PrintsAfterSignal"])
   self.assertGreater(s[0]["referenceEconomics"]["meanNetPctConditional"],
                      s[1]["referenceEconomics"]["meanNetPctConditional"])
   self.assertGreater(s[1]["referenceEconomics"]["meanNetPctConditional"],
                      s[2]["referenceEconomics"]["meanNetPctConditional"])
if __name__=="__main__":unittest.main(verbosity=2)
