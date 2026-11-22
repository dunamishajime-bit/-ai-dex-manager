#!/usr/bin/env python3
"""P18 53 source intents 954 native-stop-priority BTC M5 tests."""
import json,csv,unittest
from pathlib import Path
from collections import Counter
R=Path(__file__).resolve().parents[1]/"results"
P="PRISM7_P18_NATIVE53_BTC_GIVEBACK"
class P18Contract(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.summary=json.loads((R/(P+"_SUMMARY_20261122.json")).read_text(encoding="utf-8"))
  with (R/(P+"_954_SCENARIOS_20261122.csv")).open("r",encoding="utf-8",newline="") as f:cls.rows=list(csv.DictReader(f))
  cls.events=json.loads((R/(P+"_SUMMARY_20261122_53_EVENTS.json")).read_text(encoding="utf-8"))
 def test_input_53_source_all_six_fees_each_three_rules(self):
  self.assertEqual(self.summary["naturalShortIntentCount"],53)
  self.assertEqual(self.summary["cases"],954)
  self.assertEqual(len(self.rows),954)
  self.assertEqual(len(self.events),53)
  self.assertEqual(len(self.summary["resultSummary"]),18)
  for m in self.summary["resultSummary"]:
   self.assertEqual(m["sourceIntents"],53)
   self.assertEqual(m["priceProxyComplete"],52)
   self.assertEqual(m["unobservedEntryOrExit"],1)
 def test_outside_position_malformed_BTC_quarantined_no_market_rewrite(self):
  q=self.summary["btcSourceQualityQuarantinedOutsidePositionWindows"]
  self.assertEqual(len(q),1)
  self.assertEqual(q[0]["timestamp"],1757771400000)
  self.assertEqual(q[0]["activeSourcePositionOverlapCount"],0)
  self.assertFalse(q[0]["priceDataModified"])
 def test_stop_price_event_timestamp_priority(self):
  for row in self.rows:
   self.assertEqual(row["sourceNativeStopPriorityMaintained"],"True")
   self.assertEqual(row["signedVenueFill"],"False")
   if row["scenario_exit_type"]=="FIRST_NEXT_POSITIVE_M5":
    self.assertLess(int(row["scenario_exit_m5_open_ts"]),int(row["originalP14M5ExitTs"]))
    self.assertLessEqual(int(row["scenario_signal_close_ts"]),int(row["scenario_exit_m5_open_ts"]))
  self.assertEqual(sum(x["scenario_exit_type"]=="FIRST_NEXT_POSITIVE_M5" for x in self.rows),54*6)
 def test_two_research_hypotheses_reject_on_profit(self):
  m={x["rule"]:x for x in self.summary["resultSummary"] if x["feeBps"]==30 and x["additionalExitSlippageBps"]==0}
  a=m["SOURCE_P14_NATIVE_M5_BASELINE"]
  self.assertEqual(a["scenarioWins"],29)
  self.assertAlmostEqual(a["scenarioMeanNetConditionalPct"],.858779,places=6)
  for rule,n in [("BTC_CONFIRM_GAIN_LOCK",29),("BTC_STRONG_BOUNCE_LOCK",25)]:
   r=m[rule]
   self.assertEqual(r["researchEarlyExits"],n)
   self.assertEqual(r["scenarioWins"],35)
   self.assertEqual(r["sourceLosersNowWin"],6)
   self.assertEqual(r["sourceWinnersNowLose"],0)
   self.assertLess(r["scenarioMeanNetConditionalPct"],a["scenarioMeanNetConditionalPct"])
   self.assertLess(r["scenarioPfConditional"],a["scenarioPfConditional"])
 def test_mfe3_giveback_cases_all7_touched(self):
  z=[x for x in self.events if x["diagnosticCategory"]=="PROFIT_GIVEBACK_AFTER_MFE3"]
  self.assertEqual(len(z),7)
  for e in z:
   self.assertIsNotNone(e["triggerByRule"]["BTC_CONFIRM_GAIN_LOCK"])
   self.assertIsNotNone(e["triggerByRule"]["BTC_STRONG_BOUNCE_LOCK"])
if __name__=="__main__":unittest.main(verbosity=2)
