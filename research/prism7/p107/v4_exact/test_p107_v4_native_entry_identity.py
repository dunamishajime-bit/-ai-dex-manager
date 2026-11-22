import collections,json,unittest
from pathlib import Path
BASE=Path(__file__).resolve().parent
def read(p):return json.loads((BASE/p).read_text(encoding="utf8"))
class V4AsOfNative(unittest.TestCase):
 def test_annual_native_grid(self):
  j=read("P107_V4_PIN_NATIVE_H1_1YEAR_DECISION_SCAN_20261123.json")
  self.assertEqual(j["pin"],"e788abc82e80f9fc7ab0e1ba83fdb8be267eb513")
  self.assertEqual(j["gridTotal"],4380)
  self.assertEqual(j["statusBreakdown"]["PIN_SOURCE_NATIVE_DECISION"],4339)
  self.assertEqual(j["statusBreakdown"]["REJECT:INVALID_SIGNED_H1_CANDLE"],41)
  self.assertEqual(j["V4MaximumDrawdownPolicy"],0.21)
  self.assertFalse(j["fullAccountBT"])
  self.assertTrue(j["noOrders"])
 def test_exact_all_candidate_count_and_no_errors(self):
  j=read("P107_V4_PIN_NATIVE_H1_1YEAR_DECISION_SCAN_20261123.json")
  a=[x for x in j["results"] if x.get("result")=="PIN_SOURCE_NATIVE_DECISION"]
  self.assertEqual(sum(x["candidateCount"] for x in a),1394)
  self.assertTrue(all(x["candidateCount"]>=len(x["candidates"]) for x in a))
  self.assertTrue(all(not x["errors"] for x in a))
  self.assertTrue(all(x["sourceFingerprint"] for x in a))
 def test_identity_and_fingerprint_1394(self):
  x=read("P107_V4_1394_ENTRY_IDENTITY_VS_OLD_LEDGER_20261123.json")
  self.assertEqual(x["new_current_count"],1394)
  self.assertEqual(x["old_research_count"],1394)
  self.assertEqual(x["matching_key_occurrences"],1394)
  self.assertEqual(x["sourceFingerprintMismatches"],0)
  self.assertEqual(x["new_not_old_occurrences"],0)
  self.assertEqual(x["old_not_new_occurrences"],0)
  self.assertTrue(x["current_pin_source_native_entry_production_parity"])
  self.assertFalse(x["live_order_and_exit_parity"])
 def test_no_attempted_live_actions(self):
  j=read("P107_V4_PIN_NATIVE_H1_1YEAR_DECISION_SCAN_20261123.json")
  self.assertEqual(j["mode"],"full")
  self.assertTrue(j["noOrders"])
if __name__=="__main__":unittest.main()
