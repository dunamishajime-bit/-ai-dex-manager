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
        self.assertIn("ExecStart=/usr/bin/node ${MONITOR_RUNTIME_ROOT}/scripts/ops/root/disdex-runner-health-snapshot-current.mjs", wiring)

    def test_idle_parity_gate_is_visible_in_health_state(self):
        source = SNAPSHOT.read_text(encoding="utf-8")
        self.assertIn("parityCertificatePath", source)
        self.assertIn("IDLE_PARITY_CERT_RUNTIME_SHA_MISMATCH", source)
        self.assertIn("IDLE_PARITY_CERT_NOT_VERIFIED", source)


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
        self.assertIn("heartbeat.healthReason = blockedReason", source)
        watchdog = (ROOT / "scripts" / "ops" / "root" / "disdex-runner-watchdog-current.mjs").read_text(encoding="utf-8")
        self.assertIn("value.healthReason || value.reason", watchdog)

    def test_snapshot_pins_mixed_sha_safety_daemons_to_peer_release_roots(self):
        source = SNAPSHOT.read_text(encoding="utf-8")
        self.assertIn("DISDEX_HEALTH_SNAPSHOT_SHARED_RISK_RELEASE_ROOT", source)
        self.assertIn("DISDEX_HEALTH_SNAPSHOT_MARGIN_RELEASE_ROOT", source)
        self.assertIn("SHARED_RISK_RELEASE_ROOT", source)
        self.assertIn("MARGIN_RELEASE_ROOT", source)
        wiring = WIRING.read_text(encoding="utf-8")
        self.assertIn("DISDEX_HEALTH_SNAPSHOT_SHARED_RISK_RELEASE_ROOT=${CURRENT_RELEASE}", wiring)
        self.assertIn("DISDEX_HEALTH_SNAPSHOT_MARGIN_RELEASE_ROOT=${CURRENT_RELEASE}", wiring)

    def test_v4_primary_keeps_peer_margin_paths_explicit_without_peer_env_reload(self):
        wiring = WIRING.read_text(encoding="utf-8")
        self.assertIn("EnvironmentFile=${V4_CONTRACT_ENV_FILE}", wiring)
        self.assertNotIn(
            "EnvironmentFile=${CONTRACT_ENV_FILE}\nEnvironmentFile=${V4_CONTRACT_ENV_FILE}",
            wiring,
        )
        self.assertIn(
            "DISDEX_V96_V52_MARGIN_GUARD_STATE_DIR=${SHARED_ROOT}/margin-risk",
            wiring,
        )
        self.assertIn(
            "DISDEX_V96_V52_MARGIN_GUARD_STATE_FILE=${SHARED_ROOT}/margin-risk/guard-live.json",
            wiring,
        )
        self.assertIn("DISDEX_V96_V52_PREORDER_MARGIN_GUARD_ENABLED=true", wiring)
        self.assertIn(
            "DISDEX_V96_V52_MARGIN_GUARD_SCRIPT=scripts/disdex_v96_v52_margin_guard_runtime.py",
            wiring,
        )

    def test_wiring_makes_safety_daemons_self_restarting_and_visible(self):
        wiring = WIRING.read_text(encoding="utf-8")
        self.assertIn("DISDEX_HEALTH_SNAPSHOT_SHARED_RISK_STATE_PATH=/var/lib/disdex/shared/crypto-daily-risk.json", wiring)
        self.assertIn("DISDEX_HEALTH_SNAPSHOT_SHARED_RISK_SERVICE_UNIT=${SHARED_RISK_UNIT}", wiring)
        self.assertIn("DISDEX_HEALTH_SNAPSHOT_MARGIN_SERVICE_UNIT=${MARGIN_UNIT}", wiring)
        self.assertGreaterEqual(wiring.count("Restart=always"), 2)
        self.assertIn('ensure_safety_daemon_active "$SHARED_RISK_UNIT"', wiring)
        self.assertIn('ensure_safety_daemon_active "$MARGIN_UNIT"', wiring)

    def test_wiring_migrates_only_explicitly_disabled_flat_v52_state(self):
        wiring = WIRING.read_text(encoding="utf-8")
        self.assertIn("migrate_v52_disabled_state_lineage", wiring)
        self.assertIn("LIMITED_OVERLAY_SCOPE_V52_PEER_DISABLED", wiring)
        self.assertIn("V52_DISABLED_STATE_SHA_MIGRATE_PASS", wiring)
        self.assertIn("V52_DISABLED_STATE_SHA_MIGRATE_NOT_FLAT", wiring)

    def test_v4_cutover_resets_stale_decision_telemetry_before_start(self):
        wiring = WIRING.read_text(encoding="utf-8")
        self.assertIn("migrate_v4_telemetry_lineage", wiring)
        self.assertIn("/var/lib/disdex/v12-v4/realtime-decision.json", wiring)
        self.assertIn("/var/lib/disdex/v12-v4/gate-telemetry.json", wiring)
        self.assertIn("V4_TELEMETRY_LINEAGE_MIGRATION", wiring)
        self.assertIn("V4_TELEMETRY_LINEAGE_MIGRATION_NOT_FLAT", wiring)
        self.assertIn("sourceRuntimeSha", wiring)
        self.assertLess(
            wiring.index("migrate_v4_telemetry_lineage"),
            wiring.index("ensure_trading_unit_running"),
        )

    def test_v4_telemetry_cutover_does_not_require_flat_state_when_lineage_is_current(self):
        wiring = WIRING.read_text(encoding="utf-8")
        start = wiring.index("migrate_v4_telemetry_lineage() {")
        end = wiring.index("\nrecover_hype_benign_state() {", start)
        function = wiring[start:end]
        self.assertIn('[[ "$from_sha" == "$V4_PRIMARY_SHA" ]] && continue', function)
        self.assertIn("V4_TELEMETRY_LINEAGE_MIGRATION_NOT_FLAT", function)
        self.assertLess(
            function.index('[[ "$from_sha" == "$V4_PRIMARY_SHA" ]] && continue'),
            function.index("V4_TELEMETRY_LINEAGE_MIGRATION_NOT_FLAT"),
        )

if __name__ == "__main__":
    unittest.main()
