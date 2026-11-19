import json
from pathlib import Path
import re,unittest
from datetime import datetime,timezone

BASE=Path(__file__).resolve().parents[1]/"docs/research-results"
class H48RootCertSnapshotTests(unittest.TestCase):
 def setUp(self):
  self.snap=json.loads((BASE/"BT_HYPE_ROOT_H48_CERTIFICATE_METADATA_20261119_UNCERTIFIED.json").read_text(encoding="utf-8-sig"))
  self.pinned=json.loads((BASE/"BT_HYPE_SOURCE_GROSS_CAP_DRIFT_20261119_UNCERTIFIED.json").read_text(encoding="utf8"))
 def test_readonly_certificate_snapshot_matches_pinned_hype_sha(self):
  s=self.snap
  self.assertEqual(s["schema"],"disdex-bt-hype-root-h48-certificate-snapshot/v1")
  self.assertEqual(s["observed_hype_sha"],self.pinned["observed_live_sha"])
  self.assertTrue(s["root_owned_regular_read_only"])
  self.assertTrue(s["certificate_not_expired_at_observation"])
  self.assertTrue(s["service_active_at_observation"])
  self.assertTrue(s["service_has_main_pid_at_observation"])
  self.assertRegex(s["root_certificate_sha256"],r"^[a-f0-9]{64}$")
  self.assertGreater(datetime.fromisoformat(s["observed_utc"]).timestamp(),0)
 def test_h48_certificate_metadata_not_explicit_stop_protection(self):
  s=self.snap
  self.assertEqual(s["policy"],"H48_TIME_ONLY")
  self.assertEqual(s["hold_hours"],48)
  self.assertIs(s["resident_stop_required"],False)
  self.assertIs(s["resident_take_profit_required"],False)
  self.assertEqual(s["route"],"HYPE_REDESIGN_CAUSAL_H48R4_WSIG")
 def test_approved_gross_matches_pinned_source_not_research_target(self):
  s=self.snap
  caps=s["certificate_approved_gross_x"]
  self.assertEqual(caps,{"crypto":3,"stock":4,"total":4.25,"hype":1})
  policy=self.pinned["comparison"]["crypto_stock_total"]
  self.assertEqual(caps["stock"],policy["stockGrossCap"]["pinned_hype_stable4"])
  self.assertEqual(caps["total"],policy["totalGrossCap"]["pinned_hype_stable4"])
  self.assertFalse(s["effective_final_account_gross_cap_certified"])
  self.assertFalse(s["owner_global_35_cap_policy_certified"])
 def test_no_actual_trading_or_credential_data_entered_evidence(self):
  s=self.snap
  self.assertEqual(s["live_mutations"],0)
  self.assertIs(s["actual_live_positions_and_stops_checked"],False)
  self.assertIs(s["actual_exchange_orders_checked"],False)
  self.assertIs(s["private_ssh_key_content_copied"],False)
  self.assertIs(s["root_certificate_content_copied"],False)
  self.assertIs(s["actual_production_bt_parity_certified"],False)
if __name__=="__main__":
 unittest.main()
