import json,unittest
from pathlib import Path
R=Path(__file__).resolve().parent
class V52Readiness(unittest.TestCase):
 def test_current_sha_running_only(self):
  x=json.loads((R/"P107_V52_RUNNING_UNIT_AND_HISTORICAL_MICROSTRUCTURE_BLOCKERS_20261123.json").read_text(encoding="utf8"))
  self.assertEqual(x["pinSha"],"c7310d34ba1b6de07071d8883a2ed0de8dcce2a7")
  u=[a for a in x["liveUnitReadOnly"]["v52Units"] if "c7310d34" in a["unit"]]
  self.assertEqual(len(u),1)
  self.assertEqual(u[0]["active"],"active")
  self.assertTrue(u[0]["hasProcess"])
 def test_all_87_legacy_model_only_at_each_bps(self):
  x=json.loads((R/"P107_V52_RUNNING_UNIT_AND_HISTORICAL_MICROSTRUCTURE_BLOCKERS_20261123.json").read_text(encoding="utf8"))
  for bps in ["10","30"]:
   model=x["model10_30bps"][bps]
   self.assertEqual(model["modeledFills"],87)
   self.assertEqual(model["signedFills"],0)
   self.assertEqual(model["modelClass"],"V52_H1_BASIS_PRICE_ONLY")
  self.assertFalse(x["sourceEntryAndExitNativeFullReplayed"])
  self.assertFalse(x["allPortfolioP107FullParity"])
 def test_order_book_quote_and_reference_essential(self):
  x=json.loads((R/"P107_V52_RUNNING_UNIT_AND_HISTORICAL_MICROSTRUCTURE_BLOCKERS_20261123.json").read_text(encoding="utf8"))
  z=x["sourceProofRequiredDataFields"]
  for key in ["reference_basis_vs_aster_mid","source_age","reference_age","minimum_orderbook_depth","spread_bps","post_only_entry","poll_signed_fill"]:
   self.assertIn(key,z)
  self.assertFalse(x["verifiedHistoricalAsterQuoteBookMarketDepthAndCrossVenueReceiveTimestampsAvailable"])
if __name__=="__main__":unittest.main()
