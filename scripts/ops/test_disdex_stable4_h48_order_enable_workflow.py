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
            "Verify native H48 time-only runtime before consuming Owner approval",
            "validate_native_h48_runtime_source",
        ):
            self.assertIn(required, text)
        self.assertLess(
            text.index("Verify native H48 time-only runtime before consuming Owner approval"),
            text.index("Redeem exact HYPE Owner approval through official HP bridge"),
        )
        self.assertNotIn("ALL_RUNNERS_ORDER_ENABLE", text)
        self.assertNotIn("FULL_PROJECT", text)

    def test_helper_contains_no_venue_mutation_path(self):
        text = HELPER.read_text(encoding="utf-8")
        self.assertIn("ASTER_SIGNED_GET", text)
        self.assertIn("HYPE_ORDER_ENABLE_REQUIRES_FLAT_ACCOUNT", text)
        self.assertIn("GLOBAL_HOLD_CHANGED_DURING_ENABLE", text)
        self.assertIn("systemctl(\"restart\", HYPE_UNIT)", text)
        self.assertIn("H48_NATIVE_ENTRY_POSITION_AUTHORITY_NOT_WIRED", text)
        self.assertNotIn("build_hype_source_overlay", text)
        self.assertNotIn("BindReadOnlyPaths=", text)
        for forbidden in ("executeMarket", "cancelOrder", "createOrder", "kill-switch clear"):
            self.assertNotIn(forbidden, text)

    def test_existing_trend_runner_denies_h48_live_permit_even_when_valid(self):
        path = ROOT / "lib" / "hype-zec-long-runner.ts"
        text = path.read_text(encoding="utf-8")
        entry = text[text.index("  private async enter("):text.index("  async tick(")]
        self.assertIn("await hasValidHypeH48OrderPermit(", entry)
        self.assertIn("HYPE_H48_NATIVE_TIME_ONLY_EXECUTOR_NOT_WIRED", entry)
        self.assertGreater(entry.count("HYPE_H48_NATIVE_TIME_ONLY_EXECUTOR_NOT_WIRED"), 1)
        self.assertLess(entry.index("HYPE_H48_NATIVE_TIME_ONLY_EXECUTOR_NOT_WIRED"),
                        entry.index("this.dependencies.executor.executeMarket("))
        self.assertIn('return { status: "held", message: "HYPE_H48_NATIVE_TIME_ONLY_EXECUTOR_NOT_WIRED"', entry)
        self.assertIn("this.dependencies.stateStore.save(state)", entry)



if __name__ == "__main__":
    unittest.main()
