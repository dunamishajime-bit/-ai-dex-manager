import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / "docs" / "research" / "results" / "dd-reduction-initial-adverse-stop-audit-20261020"


def load_json(name: str):
    return json.loads((RESULTS / name).read_text(encoding="utf-8"))


class Task8ArtifactContractTests(unittest.TestCase):
    def test_task6_source_coverage_remains_blocked(self):
        manifest = load_json("../dd-reduction-dynamic-baseline-task6-20261021/task6-dynamic-baseline-manifest.json")
        source = manifest["candidate_source"]
        self.assertEqual(source["expected_rows"], 3185)
        self.assertEqual(source["observed_rows"], 3185)
        self.assertEqual(source["normalized_rows"], 0)
        self.assertEqual(source["fail_closed_rows"], 3185)
        self.assertEqual(source["replayable_rows"], 0)
        self.assertEqual(manifest["runs"]["10"]["parity_classification"], "BLOCKED_INCOMPLETE_SOURCE_COVERAGE")
        self.assertEqual(manifest["runs"]["30"]["parity_classification"], "BLOCKED_INCOMPLETE_SOURCE_COVERAGE")

    def test_task7_cases_are_non_economic_and_blocked(self):
        status = load_json("task9-dynamic-status.json")
        self.assertEqual(status["classification"], "BLOCKED_INCOMPLETE_SOURCE_COVERAGE")
        self.assertFalse(status["economic_acceptance_eligible"])
        self.assertEqual(len(status["cases"]), 16)
        self.assertTrue(all(item["classification"] == "BLOCKED_INCOMPLETE_SOURCE_COVERAGE" for item in status["cases"]))
        self.assertTrue(status["diagnostic_only"]["zero_trade_result_is_not_a_backtest_metric"])

    def test_task8_audit_is_research_only(self):
        audit = load_json("task8-research-only-audit.json")
        self.assertEqual(audit["audit_status"], "PASS")
        self.assertEqual(audit["production_changes"], 0)
        self.assertFalse(audit["live_claim"])
        self.assertEqual(audit["forbidden_paths"], [])
        self.assertEqual(audit["forbidden_markers"], [])

    def test_workflow_has_a_real_verification_job(self):
        workflow = (ROOT / ".github" / "workflows" / "task9-dynamic-integrated-bt.yml").read_text(encoding="utf-8")
        self.assertIn("jobs:", workflow)
        self.assertIn("verify-task9-dynamic-research:", workflow)
        self.assertIn("npm run dd:reduction:test", workflow)
        self.assertIn("npm run dd:reduction:artifacts", workflow)
        self.assertIn("run-task9-python-discovery.py", workflow)
        self.assertNotIn("if: false", workflow.lower())


if __name__ == "__main__":
    unittest.main()
