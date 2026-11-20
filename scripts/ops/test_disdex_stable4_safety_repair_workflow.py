from pathlib import Path
import unittest


WORKFLOW = Path(__file__).parents[2] / ".github" / "workflows" / "disdex-stable4-safety-repair-cutover.yml"


class Stable4SafetyRepairWorkflowTests(unittest.TestCase):
    def test_workflow_is_exact_sha_monitor_only_and_formal(self):
        text = WORKFLOW.read_text(encoding="utf-8")
        for value in (
            "b8d681f048b087f07e0dcfb743cc14ec3a796b27",
            "542b30ea87fa0e6ea9d27dd63fecc00181e95d4040a544aa9004fed579f4d68f",
            "ALL_RUNNERS_MONITOR_REFRESH",
            "FULL_PROJECT",
            "orders-enabled false",
            "--preflight-readonly",
            "--execute-approved",
            "three signed GETs",
            "Repair Q102 state ownership without changing bytes",
            "/var/lib/disdex/quality102-causal-v1/state.json",
            "Q102_STATE_SHA256_UNCHANGED=",
            "Repair shared Margin Guard metadata without changing bytes",
            "/var/lib/disdex/shared/margin-risk/guard-live.json",
            "MARGIN_GUARD_SHA256_UNCHANGED=",
        ):
            self.assertIn(value, text)
        self.assertNotIn("ALL_RUNNERS_ORDER_ENABLE", text)
        self.assertNotIn("--clear-global-hold", text)

    def test_workflow_has_environment_and_single_concurrency_group(self):
        text = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("name: disdex-production", text)
        self.assertEqual(text.count("group: disdex-unified-production"), 1)
        self.assertIn("cancel-in-progress: false", text)


if __name__ == "__main__":
    unittest.main()

