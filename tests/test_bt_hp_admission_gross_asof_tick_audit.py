"""Model entry-time cumulative Gross from original pre-entry 5m samples."""
import sys,unittest,math
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from bt_hp_admission_gross_asof_tick_audit import check_requested,num,CAPS
class AdmissionGrossTests(unittest.TestCase):
 def test_empty_wallet_with_new_crypto_only_valid(self):
  d=check_requested({"crypto":0.,"stock":0.,"total":0.},
    {"crypto":1.25,"stock":0.})
  self.assertEqual(d["freshBreaches"],[])
 def test_pre_entry_stock_over_cap_is_market_drift_not_new_order(self):
  d=check_requested({"crypto":.5,"stock":1.58,"total":2.08},
     {"crypto":.3,"stock":0.})
  self.assertEqual(d["alreadyOverCap"],["stock"])
  self.assertEqual(d["freshBreaches"],[])
  self.assertEqual(d["admittedIncreaseToAlreadyOverCap"],[])
 def test_stock_order_into_already_breached_stock_is_flagged(self):
  d=check_requested({"crypto":.2,"stock":1.6,"total":1.8},
      {"crypto":0.,"stock":.2})
  self.assertEqual(d["admittedIncreaseToAlreadyOverCap"],["stock"])
 def test_same_tick_two_requests_cumulatively_exceed_crypto(self):
  d=check_requested({"crypto":2.6,"stock":.1,"total":2.7},
    {"crypto":.5,"stock":0.})
  self.assertEqual(d["freshBreaches"],["crypto"])
 def test_same_tick_multiple_cross_total(self):
  d=check_requested({"crypto":2.,"stock":1.,"total":3.},
    {"crypto":.3,"stock":.3})
  self.assertEqual(d["freshBreaches"],["total"])
 def test_shared_preexisting_total_cap_exacerbation_is_flagged(self):
  d=check_requested({"crypto":3.1,"stock":.5,"total":3.6},
    {"crypto":0.,"stock":.2})
  self.assertEqual(d["admittedIncreaseToAlreadyOverCap"],["total"])
 def test_gross_is_additively_consistent(self):
  with self.assertRaisesRegex(ValueError,"BASE_GROSS_CATEGORY_INCONSISTENT"):
   check_requested({"crypto":1.,"stock":1.,"total":5.},
    {"crypto":0.,"stock":.1})
 def test_missing_category_rejected(self):
  with self.assertRaisesRegex(ValueError,"GROSS_PROVENANCE_FIELDS_INCOMPLETE"):
   check_requested({"crypto":1.,"total":1.},{"crypto":.1,"stock":0.})
 def test_negative_or_nonfinite_exposure_rejected(self):
  with self.assertRaisesRegex(ValueError,"NEGATIVE_GROSS"):
   check_requested({"crypto":0.,"stock":0.,"total":0.},
    {"crypto":-.1,"stock":0.})
  for v in (math.nan,math.inf,-math.inf):
   with self.subTest(v=v),self.assertRaisesRegex(ValueError,"NONFINITE_GROSS"):
    check_requested({"crypto":0.,"stock":0.,"total":0.},
      {"crypto":v,"stock":0.})
if __name__=="__main__":unittest.main()
