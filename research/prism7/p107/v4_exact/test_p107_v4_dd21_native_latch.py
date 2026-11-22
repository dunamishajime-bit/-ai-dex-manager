import json,unittest
from pathlib import Path
R=Path(__file__).resolve().parent
class TestV4NativeDD21Latch(unittest.TestCase):
 def test_five_native_marks(self):
  d=json.loads((R/"P107_V4_NATIVE_DD21_PERMANENT_LATCH_TEST_20261123.json").read_text(encoding="utf8"))
  self.assertEqual(d["riskThresholdPct"],21)
  self.assertEqual(len(d["tests"]),5)
  self.assertFalse(d["realVPSStateTouched"])
  self.assertEqual(d["venueOrderCount"],0)
 def test_no_automatic_rearm(self):
  d=json.loads((R/"P107_V4_NATIVE_DD21_PERMANENT_LATCH_TEST_20261123.json").read_text(encoding="utf8"))
  s={x["scenario"]:x for x in d["tests"]}
  self.assertFalse(s["20pct"]["sharedReservationsDd21Hold"])
  self.assertFalse(s["21pct_exact"]["sharedReservationsDd21Hold"])
  self.assertTrue(s["21pct_plus"]["sharedReservationsDd21Hold"])
  self.assertTrue(s["22pct_then_full_rebound"]["sharedReservationsDd21Hold"])
  self.assertEqual(s["22pct_then_full_rebound"]["finalEquity"],10000)
  self.assertAlmostEqual(s["22pct_then_full_rebound"]["latchedMaximumDDPct"],22,places=9)
if __name__=="__main__":unittest.main()
