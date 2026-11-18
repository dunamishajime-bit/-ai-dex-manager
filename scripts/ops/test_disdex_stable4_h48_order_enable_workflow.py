"""Contract tests for the HYPE-only H48 order-enable workflow."""
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github" / "workflows" / "disdex-stable4-h48-order-enable.yml"
HELPER = ROOT / "scripts" / "ops" / "deploy" / "disdex_stable4_h48_order_enable.py"


class WorkflowContractTests(unittest.TestCase):
    def test_workflow_is_owner_and_hype_scoped(self):
        text = WORKFLOW.read_text(encoding="utf-8")
        for required in (
            "github.ref == 'refs/heads/master'",
            "github.actor == 'dunamishajime-bit'",
            "environment:",
            "name: disdex-production",
            "HYPE_STABLE4_H48_TIME_ONLY_LIVE",
            "HYPE_TREND_LONG",
            "ordersEnabled",
            "GLOBAL_HOLD_REMAINS_ACTIVE=TRUE",
            "TRADING_MUTATIONS=0",
            "--preflight-readonly",
            "--execute",
        ):
            self.assertIn(required, text)
        self.assertNotIn("ALL_RUNNERS_ORDER_ENABLE", text)
        self.assertNotIn("FULL_PROJECT", text)

    def test_helper_contains_no_venue_mutation_path(self):
        text = HELPER.read_text(encoding="utf-8")
        self.assertIn("ASTER_SIGNED_GET", text)
        self.assertIn("HYPE_ORDER_ENABLE_REQUIRES_FLAT_ACCOUNT", text)
        self.assertIn("GLOBAL_HOLD_CHANGED_DURING_ENABLE", text)
        self.assertIn("systemctl(\"restart\", HYPE_UNIT)", text)
        for forbidden in ("executeMarket", "cancelOrder", "createOrder", "kill-switch clear"):
            self.assertNotIn(forbidden, text)


if __name__ == "__main__":
    unittest.main()
