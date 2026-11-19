import importlib.util
from pathlib import Path
import unittest

p=Path(__file__).resolve().parents[1]/"scripts/research/audit_bt_hype_gross_policy_drift.py"
spec=importlib.util.spec_from_file_location("bt_hype_gross_drift",p)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

def manifest(stock=1.5,total=3.5):
  return {"status":"STRICT_V2_PLUS_V4Q102_PENGU_RECOVERY_REVERSAL_RESEARCH_ONLY_NOT_FULL_PRODUCTION_PARITY",
          "results":[{"case":m.CASE,"cost_bps_roundtrip":bps,"crypto_cap":3.0,"stock_cap":stock,"total_cap":total} for bps in (10,30)]}

class GrossDriftTests(unittest.TestCase):
 def test_historical_10_30_independent_caps_match(self):
  self.assertEqual(m.historical_caps(manifest()),{"cryptoGrossCap":3.0,"stockGrossCap":1.5,"totalGrossCap":3.5})
 def test_historical_mismatch_fails_closed(self):
  x=manifest()
  x["results"][1]["total_cap"]=4.25
  with self.assertRaisesRegex(ValueError,"INCONSISTENT"):
   m.historical_caps(x)
 def test_pinned_literals_recognized(self):
  source="const productionRisk = Object.freeze({ cryptoGrossCap: 3.0, stockGrossCap: 4.0, totalGrossCap: 4.25, v4TotalGrossCap: 4.75 });"
  self.assertEqual(m.cap_literals(source)["stockGrossCap"],4.0)
  self.assertEqual(m.cap_literals(source)["v4TotalGrossCap"],4.75)
 def test_no_fake_literal_or_duplicate(self):
  with self.assertRaisesRegex(ValueError,"NOT_FOUND"):
   m.cap_literals("const x = {totalGrossCap: 4.25}")
  with self.assertRaisesRegex(ValueError,"AMBIGUOUS"):
   m.cap_literals("const productionRisk=Object.freeze({cryptoGrossCap:3.0,cryptoGrossCap:4.0,stockGrossCap:4,totalGrossCap:4.25,v4TotalGrossCap:4.75});")
 def test_invalid_historical_cap_rejected(self):
  with self.assertRaisesRegex(ValueError,"INVALID_STUDY_CAP"):
   m.historical_caps(manifest(stock=float("nan")))

if __name__=="__main__":
 unittest.main()
