import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SNAPSHOT = ROOT / "scripts/ops/root/disdex-runner-health-snapshot-current.mjs"
WATCHDOG = ROOT / "scripts/ops/root/disdex-runner-watchdog-current.mjs"
WIRING = ROOT / "scripts/ops/root/disdex-current-runtime-wiring"


class RuntimeMultilineageMonitoringTest(unittest.TestCase):
    def test_health_snapshot_supports_per_runner_release_pins(self):
        source = SNAPSHOT.read_text(encoding="utf-8")
        for sleeve in ("V12", "PENGU", "V52", "Q102"):
            self.assertIn(f"DISDEX_HEALTH_SNAPSHOT_{sleeve}_EXPECTED_SHA", source)
            self.assertIn(f"DISDEX_HEALTH_SNAPSHOT_{sleeve}_RELEASE_ROOT", source)
        self.assertIn("runner.expectedSha", source)
        self.assertIn("runner.releaseRoot", source)

    def test_watchdog_supports_per_runner_release_pins(self):
        source = WATCHDOG.read_text(encoding="utf-8")
        for sleeve in ("V12", "PENGU", "V52", "Q102"):
            self.assertIn(f"DISDEX_WATCHDOG_{sleeve}_EXPECTED_SHA", source)
            self.assertIn(f"DISDEX_WATCHDOG_{sleeve}_RELEASE_ROOT", source)
        self.assertIn("runner.expectedSha", source)
        self.assertIn("runner.expectedCwd", source)

    def test_monolithic_wiring_emits_explicit_per_runner_defaults(self):
        source = WIRING.read_text(encoding="utf-8")
        for sleeve in ("V12", "PENGU", "V52", "Q102"):
            self.assertIn(f"DISDEX_HEALTH_SNAPSHOT_{sleeve}_EXPECTED_SHA=${{DEPLOYED_SHA}}", source)
            self.assertIn(f"DISDEX_WATCHDOG_{sleeve}_EXPECTED_SHA=${{DEPLOYED_SHA}}", source)
        self.assertIn("QUALITY102_CAUSAL_V1_STATE_PATH=/var/lib/disdex/quality102-causal-v1/state.json", source)
        self.assertIn("DISDEX_Q102_RUNTIME_SHA=${DEPLOYED_SHA}", source)
        self.assertIn("DISDEX_WATCHDOG_APPROVED_SHA=${DEPLOYED_SHA}", source)


if __name__ == "__main__":
    unittest.main()


class RuntimeCurrentContractCleanupTest(unittest.TestCase):
    def test_current_wiring_has_no_legacy_pengu_or_q102_caps(self):
        source = WIRING.read_text(encoding="utf-8")
        self.assertIn("PENGU_GROSS_CAP=0.75", source)
        self.assertIn("QUALITY102_CAUSAL_V1_MAX_GROSS=1.0", source)
        self.assertIn("QUALITY102_CAUSAL_V1_SELECTOR_MODE=CAUSAL_V4", source)
        self.assertNotIn("PENGU_GROSS_CAP=0.9375", source)
        self.assertNotIn("QUALITY102_CAUSAL_V1_MAX_GROSS=0.5", source)
        self.assertNotIn("DERIVED_HIGH_VOL_ONLY", source)
