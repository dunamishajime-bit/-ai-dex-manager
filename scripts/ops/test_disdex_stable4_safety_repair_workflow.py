from pathlib import Path
import unittest


WORKFLOW = Path(__file__).parents[2] / ".github" / "workflows" / "disdex-stable4-safety-repair-cutover.yml"


class Stable4SafetyRepairWorkflowTests(unittest.TestCase):
    def test_workflow_is_exact_sha_monitor_only_and_formal(self):
        text = WORKFLOW.read_text(encoding="utf-8")
        for value in (
            "c7310d34ba1b6de07071d8883a2ed0de8dcce2a7",
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
            '0:${deploy_gid}:640',
            "0:${deploy_gid}:600|0:${deploy_gid}:640)",
            "setfacl -m u:deploy:--x",
            "setfacl -m u:deploy:r--",
            "Q102_STATE_DEPLOY_READ_ACL_PASS=",
            "getent group deploy",
            "chown root:deploy",
            "chmod g+r",
            "test -x \"$parent\"",
            "Q102_STATE_DEPLOY_READ_POSIX_PASS=",
            "Repair shared Margin Guard metadata without changing bytes",
            "/var/lib/disdex/shared/margin-risk/guard-live.json",
            "MARGIN_GUARD_SHA256_UNCHANGED=",
            "scripts/disdex-quality102-causal-v1-monitor.ts",
            "tests/quality102-monitor-only.test.ts",
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

