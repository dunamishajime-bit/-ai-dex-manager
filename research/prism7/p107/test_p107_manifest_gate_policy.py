"""P107 source-parity gate checks. No external services."""
import json
import tempfile
import unittest
from pathlib import Path
from p107_manifest_gate import assess, EFFECTIVE_SOURCE_CAPS
PERIOD=["2025-10-01T00:00:00Z","2026-10-01T00:00:00Z"]
def evaluate(caps,status="RESEARCH_ONLY"):
    data={"status":status,"period":PERIOD,"caveats":[],"results":[{
      "cost_bps_roundtrip":bps,"initial_jpy":10000,
      "blocked_by_reason":{"V4_MAX_DRAWDOWN_21PCT_HOLD":2},
      "final_compounded_jpy":10000,"max_hourly_dd_pct":-12,
      "win_rate_pct":55,"modeled_fills":30,"admitted_by_runner":{"PENGU":10},
      **caps} for bps in (10,30)]}
    with tempfile.TemporaryDirectory() as d:
        p=Path(d)/"RUN_MANIFEST.json"
        p.write_text(json.dumps(data),encoding="utf-8")
        return assess(p)
class TestP107(unittest.TestCase):
    def test_effective_source_profile(self):
        result=evaluate(EFFECTIVE_SOURCE_CAPS)
        self.assertFalse(any("MISMATCH_EFFECTIVE_SOURCE" in r for r in result["reasons"]))
        self.assertIn("EXACT_SHA_AND_FILLS_PARITY_NOT_ATTESTED",result["reasons"])
    def test_sensitivity_profile_fails_live_gate(self):
        result=evaluate({"stock_cap":1.5,"total_cap":3.5,"crypto_cap":3.0})
        self.assertIn("STOCK_CAP_MISMATCH_EFFECTIVE_SOURCE_10BPS",result["reasons"])
        self.assertIn("TOTAL_CAP_MISMATCH_EFFECTIVE_SOURCE_30BPS",result["reasons"])
    def test_missing_caps_fail_closed(self):
        result=evaluate({"crypto_cap":3.0})
        self.assertIn("STOCK_CAP_NOT_ATTESTED_10BPS",result["reasons"])
        self.assertIn("TOTAL_CAP_NOT_ATTESTED_30BPS",result["reasons"])
    def test_corrupted_cap_fails_closed(self):
        result=evaluate({"stock_cap":"oops","crypto_cap":3.0,"total_cap":4.25})
        self.assertIn("STOCK_CAP_INVALID_30BPS",result["reasons"])
    def test_declared_full_parity_never_auto_approved(self):
        result=evaluate(EFFECTIVE_SOURCE_CAPS,"FULL_PARITY")
        self.assertEqual(result["status"],"P107_GATE_BLOCKED_RESEARCH_ONLY")
if __name__=="__main__":unittest.main()
