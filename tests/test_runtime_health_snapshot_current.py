import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT = ROOT / "scripts" / "ops" / "root" / "disdex-runner-health-snapshot-current.mjs"
WIRING = ROOT / "scripts" / "ops" / "root" / "disdex-current-runtime-wiring"


class RuntimeHealthSnapshotCurrentTest(unittest.TestCase):
    def test_current_snapshot_uses_current_state_paths(self):
        source = SNAPSHOT.read_text(encoding="utf-8")
        self.assertIn("/var/lib/disdex/v12-x1-all/runner.json", source)
        self.assertIn("/var/lib/disdex/pengu-dual-ls-v2/runner-live.json", source)
        self.assertNotIn("/var/lib/disdex/pengu-dual-ls-v2-final/runner-live.json", source)
        self.assertIn("/var/lib/disdex/v52-aster-only/runner-live.json", source)
        self.assertIn("/var/lib/disdex/quality102-causal-v1/state.json", source)

    def test_current_snapshot_is_read_only_and_release_pinned(self):
        source = SNAPSHOT.read_text(encoding="utf-8")
        self.assertIn("DISDEX_HEALTH_SNAPSHOT_EXPECTED_SHA", source)
        self.assertIn("DISDEX_HEALTH_SNAPSHOT_RELEASE_ROOT", source)
        self.assertIn("ordersSent: 0", source)
        self.assertNotRegex(source, r"(?:submitOrder|cancelOrder|executeMarket|placeOrder)\s*\(")

        wiring = WIRING.read_text(encoding="utf-8")
        self.assertIn("scripts/ops/root/disdex-runner-health-snapshot-current.mjs", wiring)
        self.assertIn("ExecStart=/usr/bin/node ${CURRENT_RELEASE}/scripts/ops/root/disdex-runner-health-snapshot-current.mjs", wiring)


class MarginGuardHealthVisibilityTest(unittest.TestCase):
    def test_snapshot_surfaces_margin_guard_state_and_freshness(self):
        source = SNAPSHOT.read_text(encoding="utf-8")
        self.assertIn("DISDEX_HEALTH_SNAPSHOT_MARGIN_STATE_PATH", source)
        self.assertIn("/var/lib/disdex/shared/margin-risk/guard-live.json", source)
        self.assertIn("marginGuardStatus", source)
        self.assertIn("DATA_UNAVAILABLE", source)
        self.assertIn("ordersAllowed", source)
        self.assertIn("nextCheckAt", source)
        self.assertIn("overallSafetyState", source)

    def test_wiring_supplies_canonical_margin_guard_state_path(self):
        wiring = WIRING.read_text(encoding="utf-8")
        self.assertIn("DISDEX_HEALTH_SNAPSHOT_MARGIN_STATE_PATH=/var/lib/disdex/shared/margin-risk/guard-live.json", wiring)


class DependencyLivenessHealthTest(unittest.TestCase):
    def test_snapshot_blocks_on_shared_risk_and_service_liveness(self):
        source = SNAPSHOT.read_text(encoding="utf-8")
        self.assertIn("DISDEX_HEALTH_SNAPSHOT_SHARED_RISK_STATE_PATH", source)
        self.assertIn("/var/lib/disdex/shared/crypto-daily-risk.json", source)
        self.assertIn("DISDEX_HEALTH_SNAPSHOT_SHARED_RISK_SERVICE_UNIT", source)
        self.assertIn("DISDEX_HEALTH_SNAPSHOT_MARGIN_SERVICE_UNIT", source)
        self.assertIn("sharedRiskStatus", source)
        self.assertIn("safetyServiceStatus", source)
        self.assertIn("summarizeOverallSafety", source)
        self.assertIn("blockReasons", source)
        self.assertIn("sourceComplete", source)
        self.assertIn("Shared Risk state is stale", source)

    def test_wiring_makes_safety_daemons_self_restarting_and_visible(self):
        wiring = WIRING.read_text(encoding="utf-8")
        self.assertIn("DISDEX_HEALTH_SNAPSHOT_SHARED_RISK_STATE_PATH=/var/lib/disdex/shared/crypto-daily-risk.json", wiring)
        self.assertIn("DISDEX_HEALTH_SNAPSHOT_SHARED_RISK_SERVICE_UNIT=${SHARED_RISK_UNIT}", wiring)
        self.assertIn("DISDEX_HEALTH_SNAPSHOT_MARGIN_SERVICE_UNIT=${MARGIN_UNIT}", wiring)
        self.assertGreaterEqual(wiring.count("Restart=always"), 2)
        self.assertIn('ensure_safety_daemon_active "$SHARED_RISK_UNIT"', wiring)
        self.assertIn('ensure_safety_daemon_active "$MARGIN_UNIT"', wiring)

if __name__ == "__main__":
    unittest.main()
