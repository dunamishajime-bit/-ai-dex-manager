#!/usr/bin/env python3
"""P30 real-historical source 120 setup causal postshock recovery contract."""
import csv,json,unittest
from pathlib import Path
R=Path(__file__).resolve().parents[1]/"results"
class P30Real(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.a=json.loads((R/"PRISM7_P30_REAL_SOURCE120_RECOVERY_CONFIRMED_SUMMARY_20261122.json").read_text(encoding="utf-8"))
  cls.events=json.loads((R/"PRISM7_P30_REAL_SOURCE120_RECOVERY_EVENTS_20261122.json").read_text(encoding="utf-8"))
  with (R/"PRISM7_P30_REAL_SOURCE120_1440_SCENARIO_LEDGER_20261122.csv").open("r",encoding="utf-8",newline="") as f:
   cls.rows=list(csv.DictReader(f))
 def selected(self,delay,slip,fee=30):
  return next(x for x in self.a["all12SourceFeeCostDelayScenarios"] if
       x["positivePrintDelayAfterRecovery"]==delay and x["extraP30ExitSlipBps"]==slip and
       x["roundtripFeeBps"]==fee)
 def test_all_original_source120_p25_and_p22_parity(self):
  self.assertEqual(self.a["originalH1StructuralSetups"],120)
  self.assertEqual(self.a["originalSourceS4SingleSlot120Parity"],"PASS")
  self.assertEqual(len(self.events),120)
  self.assertEqual(len(self.a["all12SourceFeeCostDelayScenarios"]),12)
  self.assertEqual(len(self.rows),1440)
  self.assertEqual(set(x["feeBps"] for x in self.rows),{"10","30"})
  self.assertEqual(set(x["delay"] for x in self.rows),{"1","2"})
  self.assertEqual(set(x["slipBps"] for x in self.rows),{"0","100","1000"})
  for m in self.a["all12SourceFeeCostDelayScenarios"]:
   self.assertEqual(m["referenceEconomics"]["candidateIntents"],120)
   self.assertEqual(m["referenceEconomics"]["priceProxyClosed"],21)
   self.assertEqual(m["referenceEconomics"]["wins"],15)
   self.assertEqual(m["referenceM5Risk"]["rightCensoredOpenPositions"],1)
 def test_recovery_confirm_is_future_M5_close_then_NEXT_positive_M5_open(self):
  reco={k:v for k,v in self.events.items() if
        v["status"]=="RECOVERY_CONFIRMED_COMPLETED_SOURCE_M5"}
  self.assertEqual(set(reco),{"S3_01700"})
  e=reco["S3_01700"]
  self.assertEqual(e["lastCapitulationCloseTs"],1760131200000)
  self.assertEqual(e["confirmationM5StartTs"],1760131500000)
  self.assertEqual(e["confirmationM5CloseTs"],1760131800000)
  self.assertAlmostEqual(e["penguConfirmedClose"],.013801)
  self.assertAlmostEqual(e["btcConfirmedClose"],109076.5)
  self.assertTrue(e["confirmPENGUGreenClose"])
  self.assertTrue(e["noFutureM5PriceUsedToDecideConfirmation"])
  self.assertFalse(e["signedVenueFillProven"])
  self.assertEqual([z["ts"] for z in e["positiveM5BuyProxyAfterConfirmation"]],
                   [1760131800000,1760132100000])
  self.assertEqual([z["px"] for z in e["positiveM5BuyProxyAfterConfirmation"]],
                   [.0158,.01703])
 def test_slow_source_recovery_execution_increases_dd_above_20(self):
  a=self.selected(1,0)
  b=self.selected(2,0)
  self.assertEqual(a["earlyExitExecutedCountAfterSingleSlot"],1)
  self.assertEqual(b["earlyExitExecutedCountAfterSingleSlot"],1)
  self.assertAlmostEqual(a["referenceEconomics"]["meanNetPctConditional"],5.81939432,places=8)
  self.assertAlmostEqual(a["referenceEconomics"]["profitFactorConditional"],4.427261,places=6)
  self.assertAlmostEqual(a["referenceM5Risk"]["maximumM5CloseMarkToMarketDDPct"],25.22992914,places=8)
  self.assertAlmostEqual(b["referenceEconomics"]["meanNetPctConditional"],5.56042351,places=8)
  self.assertAlmostEqual(b["referenceM5Risk"]["maximumM5CloseMarkToMarketDDPct"],28.36167063,places=8)
  self.assertGreater(a["referenceM5Risk"]["maximumM5CloseMarkToMarketDDPct"],20)
  self.assertGreater(b["referenceM5Risk"]["maximumM5CloseMarkToMarketDDPct"],a["referenceM5Risk"]["maximumM5CloseMarkToMarketDDPct"])
 def test_extra_slip_worsens_economics_without_changing_reference_wins(self):
  for delay in (1,2):
   a=[self.selected(delay,s) for s in (0,100,1000)]
   v=[x["referenceEconomics"]["meanNetPctConditional"] for x in a]
   self.assertGreater(v[0],v[1]);self.assertGreater(v[1],v[2])
   self.assertTrue(all(x["referenceEconomics"]["wins"]==15 for x in a))
 def test_one_unchanged_source_crash_case_only_and_real_fills_not_invented(self):
  early=[x for x in self.rows if x["p30ExitApplied"]=="True"]
  self.assertEqual(len(early),12)
  self.assertEqual(set(x["id"] for x in early),{"S3_01700"})
  for z in early:
   self.assertEqual(z["signedFill"],"False")
   self.assertEqual(int(z["exitTs"]),1760131800000 if z["delay"]=="1" else 1760132100000)
  self.assertEqual(len(self.a["BTCSourceMalformedOffPosition"]),1)
  self.assertEqual(self.a["BTCSourceMalformedOffPosition"][0]["overlappingS4CandidatePositions"],0)
 def test_original_winners_preserved_as_winners_not_full_pnl_retained(self):
  m=self.selected(1,0)
  self.assertEqual(m["referenceEconomics"]["wins"],15)
  self.assertLess(m["referenceEconomics"]["meanNetPctConditional"],7.01950296)
  self.assertLess(m["referenceEconomics"]["profitFactorConditional"],5.13405)
if __name__=="__main__":unittest.main(verbosity=2)
