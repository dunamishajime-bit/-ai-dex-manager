import unittest
from pathlib import Path


WORKFLOW = Path(".github/workflows/disdex-stable4-runner-bundle-order-enable.yml").read_text(encoding="utf-8")


class Stable4RunnerBundleWorkflowTests(unittest.TestCase):
    def test_workflow_is_master_owner_environment_bound(self):
        self.assertIn("github.ref == 'refs/heads/master'", WORKFLOW)
        self.assertIn("github.actor == 'dunamishajime-bit'", WORKFLOW)
        self.assertIn("name: disdex-production", WORKFLOW)

    def test_workflow_redeems_bundle_and_checks_six_receipts(self):
        self.assertIn("STABLE4_RUNNERS_SCOPED_ORDER_ENABLE_BUNDLE", WORKFLOW)
        self.assertIn("STABLE4_SCOPED_RUNNERS", WORKFLOW)
        self.assertIn("BUNDLE_RUNNERS=6", WORKFLOW)
        self.assertIn("len(result.get('runners') or []) == 6", WORKFLOW)
        self.assertIn("GLOBAL_HOLD_REMAINS_ACTIVE=TRUE", WORKFLOW)
        self.assertIn("TRADING_MUTATIONS=0", WORKFLOW)
        self.assertNotIn("HYPE_TREND_LONG", WORKFLOW)
        self.assertNotIn("ALL_RUNNERS_ORDER_ENABLE", WORKFLOW)

    def test_readiness_preflight_happens_before_approval_redeem(self):
        """A failed Runner preflight must not consume a one-time Owner approval."""
        preflight = WORKFLOW.index("--bundle-readiness-preflight")
        redeem = WORKFLOW.index("Redeem one exact bundle Owner approval through official HP bridge")
        self.assertLess(preflight, redeem)
        self.assertIn("RUNNER_READINESS_PREFLIGHT", WORKFLOW)
        self.assertIn("/usr/bin/python3 -B '$stage/disdex_runner_scoped_order_enable.py' --bundle-readiness-preflight", WORKFLOW)
        self.assertLess(WORKFLOW.index("directly for this read-only check"), redeem)

if __name__ == "__main__":
    unittest.main()
