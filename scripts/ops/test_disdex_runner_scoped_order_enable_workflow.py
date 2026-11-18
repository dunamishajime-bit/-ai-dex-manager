"""Contract tests for the per-Runner Owner-approved order-enable workflow."""
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github" / "workflows" / "disdex-stable4-runner-scoped-order-enable.yml"
HELPER = ROOT / "scripts" / "ops" / "deploy" / "disdex_runner_scoped_order_enable.py"


class RunnerScopedWorkflowContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflow = WORKFLOW.read_text(encoding="utf-8")
        cls.helper = HELPER.read_text(encoding="utf-8")

    def test_workflow_is_owner_master_and_runner_scoped(self):
        for required in (
            "github.event_name == 'workflow_dispatch'",
            "github.repository == 'dunamishajime-bit/-ai-dex-manager'",
            "github.ref == 'refs/heads/master'",
            "github.actor == 'dunamishajime-bit'",
            "name: disdex-production",
            "RUNNER_SCOPED_ORDER_ENABLE",
            "GLOBAL_HOLD_REMAINS_ACTIVE=TRUE",
            "TRADING_MUTATIONS=0",
            "--normalize-source",
            "--preflight-readonly",
            "--execute",
        ):
            self.assertIn(required, self.workflow)
        self.assertNotIn("ALL_RUNNERS_ORDER_ENABLE", self.workflow)
        self.assertNotIn("FULL_PROJECT", self.workflow)

    def test_helper_has_read_only_venue_and_no_mutation_commands(self):
        for required in (
            "ASTER_SIGNED_GET",
            "GLOBAL_HOLD_CHANGED_DURING_ENABLE",
            "RUNNER_SCOPED_ORDER_ENABLE_INSTALLED_GLOBAL_HOLD_REMAINS_ACTIVE",
            "systemctl(\"restart\", second[\"unit\"])",
        ):
            self.assertIn(required, self.helper)
        for forbidden in ("executeMarket", "cancelOrder", "createOrder", "kill-switch clear"):
            self.assertNotIn(forbidden, self.helper)


if __name__ == "__main__":
    unittest.main()
