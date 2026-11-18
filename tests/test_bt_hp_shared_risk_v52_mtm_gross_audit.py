"""Source-model Shared Risk/V52 denominator arithmetic, not live trading gates."""
import math,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from bt_hp_shared_risk_v52_mtm_gross_audit import (
    checked_loss_event,assert_entry_allowed_at_snapshot,n,utc,eq,
)
class SharedRiskV52ModelAuditTests(unittest.TestCase):
 def test_shared_risk_trip_pct_calculated_from_settled_unrealized(self):
    loss=checked_loss_event(8.125,-100,-550,8000,7.5,"SHARED_RISK")
    self.assertAlmostEqual(loss,8.125)
 def test_shared_risk_trip_under_7p5_rejected(self):
    with self.assertRaisesRegex(ValueError,"LOSS_BELOW_THRESHOLD"):
       checked_loss_event(7.4,0,-740,10000,7.5,"SHARED_RISK")
 def test_shared_risk_percent_not_matching_loss_rejected(self):
    with self.assertRaisesRegex(ValueError,"PNL_DENOMINATOR_DRIFT"):
       checked_loss_event(8.0,0,-900,10000,7.5,"SHARED_RISK")
 def test_v52_trip_math_with_static_bucket_computes_extreme_ratio(self):
    # Arithmetic identity alone is not a good economic risk denominator.
    v=checked_loss_event(25000,0,-200000,800,3.5,"V52")
    self.assertEqual(v,25000)
 def test_v52_trip_percent_computation_wrong_reference_denominator_fails(self):
    with self.assertRaisesRegex(ValueError,"PNL_DENOMINATOR_DRIFT"):
       checked_loss_event(25000,0,-200000,80000,3.5,"V52")
 def test_zero_or_negative_risk_capital_fails_closed(self):
    for val in (0,-1):
      with self.subTest(val=val),self.assertRaisesRegex(ValueError,"BAD_DENOMINATOR"):
       checked_loss_event(8,-100,0,val,3.5,"V52")
 def test_nonfinite_risk_values_fail(self):
    for x in ("nan","inf","-inf"):
      with self.subTest(x=x),self.assertRaisesRegex(ValueError,"NONFINITE_NUMBER"):
       checked_loss_event(8,x,0,1000,3.5,"V52")
 def test_gate_blocks_model_admission_when_daily_loss_active(self):
    with self.assertRaisesRegex(ValueError,"ADMITTED_WHILE_SHARED_DAILY_GATE_ACTIVE"):
      assert_entry_allowed_at_snapshot(True,"MODEL_ENTER")
 def test_no_new_model_admission_gate_false(self):
    self.assertIsNone(assert_entry_allowed_at_snapshot(False,"MODEL_ENTER"))
 def test_gate_may_record_block_while_active(self):
    self.assertIsNone(assert_entry_allowed_at_snapshot(True,"BLOCK"))
 def test_unknown_model_decision_rejected(self):
    with self.assertRaisesRegex(ValueError,"DECISION_UNKNOWN"):
      assert_entry_allowed_at_snapshot(False,"PENDING_UNKNOWN")
 def test_utc_strict(self):
    self.assertEqual(utc("2025-10-01T00:00:00Z").utcoffset().total_seconds(),0)
    with self.assertRaisesRegex(ValueError,"NOT_UTC"):
      utc("2025-10-01T00:00:00")
 def test_numeric_tolerance_bounded(self):
    self.assertTrue(eq(10,10+1e-9))
    self.assertFalse(eq(10,10.001))
if __name__=="__main__":unittest.main()
