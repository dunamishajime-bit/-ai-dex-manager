import importlib.util
from pathlib import Path
import unittest

p=Path(__file__).resolve().parents[1]/"scripts/research/audit_bt_hype_missing_candidate_exposure.py"
spec=importlib.util.spec_from_file_location("bt_hype_gaps",p)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

FILL={
 "trade_id":"r1","entry_utc":"2025-10-01T00:00:00Z",
 "exit_utc":"2025-10-01T06:00:00Z","strategy":"V4",
}
def sample(time,open_count,gross):
 return {"utc":time,"open_count":str(open_count),"crypto_gross_x":str(gross),
         "stock_gross_x":"0","total_gross_x":str(gross)}

class ModelGapTests(unittest.TestCase):
 def test_gap_without_any_exposure_is_preserved_as_unresolved(self):
  time="2025-10-02T00:00:00Z"
  result=m.context_for_gaps([time],[FILL],[sample(time,0,0)])[0]
  self.assertTrue(result["no_research_open_exposure"])
  self.assertFalse(result["reason_for_missing_hype_decision_proven"])
 def test_gap_with_other_owner_exposure(self):
  time="2025-10-01T03:00:00Z"
  result=m.context_for_gaps([time],[FILL],[sample(time,1,0.5)])[0]
  self.assertEqual(result["research_modeled_open_owner_groups"],["V4"])
  self.assertFalse(result["research_hype_model_open"])
 def test_mismatch_against_model_snapshot_fails_closed(self):
  time="2025-10-01T03:00:00Z"
  with self.assertRaisesRegex(ValueError,"MISMATCH"):
   m.context_for_gaps([time],[FILL],[sample(time,0,0)])
 def test_duplicate_gap_rejected(self):
  with self.assertRaisesRegex(ValueError,"DUPLICATE"):
   m.context_for_gaps(["a","a"],[],[])
 def test_missing_snapshot_rejected(self):
  with self.assertRaisesRegex(ValueError,"MISSING"):
   m.context_for_gaps(["2025-10-01T00:00:00Z"],[],[])
 def test_nan_gross_rejected(self):
  time="2025-10-01T03:00:00Z"
  with self.assertRaisesRegex(ValueError,"INVALID"):
   m.context_for_gaps([time],[FILL],[sample(time,1,"nan")])

if __name__=="__main__":
 unittest.main()
