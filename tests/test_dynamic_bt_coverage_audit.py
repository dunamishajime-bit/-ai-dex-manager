import json
import tempfile
import unittest
from pathlib import Path
from scripts.audit_dynamic_bt_coverage import audit, REQUIRED_FAMILIES


class DynamicBtCoverageAuditTests(unittest.TestCase):
    def test_fail_closed_for_missing_families_or_route_sha_mismatch(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            output = root / "DYNAMIC_SCORE" / "PRICE_MODEL_10BPS"
            output.mkdir(parents=True)
            decisions = [{"strategy_id": strategy} for strategy in ("V12", "PENGU", "Q102", "FET", "V52")]
            (output / "candidate-decisions.jsonl").write_text(
                "".join(json.dumps(row) + "\n" for row in decisions), encoding="utf-8")
            (output / "portfolio-trades.jsonl").write_text(
                json.dumps({"strategy_id": "V12", "route": None, "source_runtime_sha": "old"}) + "\n", encoding="utf-8")
            result = audit(root, "new")
            self.assertEqual(result["missingFamilies"], ["HYPE_LONG", "IDLE", "RESIDUAL"])
            self.assertFalse(result["fullIntegratedSourceParity"])
            self.assertEqual(result["v12WrongSourceSha"], 1)
            self.assertEqual(result["v12MissingRouteIdentity"], 1)
            self.assertFalse(result["eligibleForAutomaticLiveCutover"])

    def test_complete_source_shape_does_not_claim_venue_fill_certification(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            output = root / "DYNAMIC_SCORE" / "PRICE_MODEL_10BPS"
            output.mkdir(parents=True)
            (output / "candidate-decisions.jsonl").write_text(
                "".join(json.dumps({"strategy_id": strategy}) + "\n" for strategy in REQUIRED_FAMILIES),
                encoding="utf-8")
            (output / "portfolio-trades.jsonl").write_text(
                json.dumps({"strategy_id": "V12", "route": "V4_01", "source_runtime_sha": "new"}) + "\n",
                encoding="utf-8")
            result = audit(root, "new")
            self.assertTrue(result["fullIntegratedSourceParity"])
            self.assertFalse(result["venueL2FillCertified"])
            self.assertFalse(result["eligibleForAutomaticLiveCutover"])


if __name__ == "__main__":
    unittest.main()
