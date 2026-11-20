import importlib.util
from pathlib import Path
import unittest

p=Path(__file__).resolve().parents[1]/"scripts/research/audit_bt_v4_gross_policy_drift.py"
spec=importlib.util.spec_from_file_location("v4_gross_drift",p)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

def manifest():
 return {"status":"STRICT_V2_PLUS_V4Q102_PENGU_RECOVERY_REVERSAL_RESEARCH_ONLY_NOT_FULL_PRODUCTION_PARITY",
         "results":[{"case":m.CASE,"cost_bps_roundtrip":bps,"v4_aggregate_cap":2.0,
                    "v4_per_position_cap":1.0,"crypto_cap":3.0,"stock_cap":1.5,"total_cap":3.5} for bps in (10,30)]}

class V4DriftTests(unittest.TestCase):
 def test_model_caps_from_both_fee_cases(self):
  self.assertEqual(m.study_caps(manifest())["v4AggregateGrossCap"],2.0)
  self.assertEqual(m.study_caps(manifest())["totalGrossCap"],3.5)
 def test_mismatched_fee_caps_rejected(self):
  data=manifest()
  data["results"][1]["total_cap"]=4.25
  with self.assertRaisesRegex(ValueError,"DIFFER"):
   m.study_caps(data)
 def test_missing_evidence_rejected(self):
  with self.assertRaisesRegex(ValueError,"TRUSTED"):
   m.build(manifest(),{}, {},b"")
 def test_missing_lifecycle_guards_rejected(self):
  with self.assertRaisesRegex(ValueError,"UNKNOWN"):
   m.extract_lifecycle_cap_literals("if (g.total+worst>4.75) throw Error()")

if __name__=="__main__":
 unittest.main()
