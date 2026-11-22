import json,unittest
from pathlib import Path
R=Path(__file__).resolve().parent
def get(n):return json.loads((R/n).read_text(encoding="utf8"))
class V4NativeExit(unittest.TestCase):
 def test_all_1394_component_exit_replays(self):
  r=get("P107_V4_NATIVE_1394_ENTRY_ATR_EXIT_COMPONENT_VERDICT_20261123.json")
  self.assertEqual(r["entryAtrNativeMatched"],1394)
  self.assertEqual(r["fourRuleM5ConditionalExitMatched"],131)
  self.assertEqual(r["fourRuleH1ConditionalExitMatched"],176)
  self.assertEqual(r["productionH1ConditionalExitMatched"],1087)
  self.assertEqual(r["conditionalModelExitTotalMatched"],1394)
  self.assertEqual(r["sourceNativeExitMismatchCount"],0)
  self.assertFalse(r["allSTABLE4P107ProductionParity"])
  self.assertEqual(r["actualSignedExchangeEntryOrExitFillsVerified"],0)
 def test_m5_early_exits_not_signed_fills(self):
  r=get("P107_V4_NATIVE_PIN_131_M5_EXIT_CANDIDATE_PARITY_20261123.json")
  self.assertEqual(r["nativeCandidateIdentityPriceMatchCount"],131)
  self.assertEqual(r["nativeCandidateMismatchCount"],0)
  self.assertEqual(r["actualExchangeSignedFills"],0)
  self.assertTrue(all(x["sourceReason"]=="V4_SHORT_INITIAL_ADVERSE_CANDIDATE" for x in r["sourceConfirmedCandidates"]))
 def test_h1_and_m5_chronology(self):
  r=get("P107_V4_NATIVE_PIN_176_H1_EXIT_CANDIDATE_PARITY_20261123.json")
  self.assertEqual(r["matched"],176)
  self.assertEqual(r["mismatchCount"],0)
  self.assertEqual(r["priorM5ProspectiveExitCount"],0)
 def test_production_exit_and_atr(self):
  e=get("P107_V4_1087_PRODUCTION_EXIT_NATIVE_PARITY_20261123.json")
  a=get("P107_V4_PIN_1394_ENTRY_ATR_SOURCE_PARITY_20261123.json")
  self.assertEqual(e["sourceNativeExitIdenticalCount"],1087)
  self.assertEqual(e["sourceNativeExitMismatchedCount"],0)
  self.assertEqual(a["exactSourceAtrMatches"],1394)
  self.assertEqual(a["sourceMaxAbsAtrDelta"],0)
if __name__=="__main__":unittest.main()
