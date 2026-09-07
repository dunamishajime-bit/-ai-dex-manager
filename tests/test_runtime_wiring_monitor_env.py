import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "ops" / "root" / "disdex-current-runtime-wiring"


class RuntimeWiringMonitorEnvironmentTest(unittest.TestCase):
    def test_monitor_dropins_clear_legacy_environment_files(self):
        source = SCRIPT.read_text(encoding="utf-8")

        self.assertIn('HEALTH_SNAPSHOT_ENV_FILE="${RUNTIME_CONTRACT_ENV_DIR}/${DEPLOYED_SHA}.health-snapshot.env"', source)
        self.assertIn('WATCHDOG_ENV_FILE="${RUNTIME_CONTRACT_ENV_DIR}/${DEPLOYED_SHA}.watchdog.env"', source)
        self.assertIn('write_atomic "$HEALTH_SNAPSHOT_ENV_FILE"', source)
        self.assertIn('write_atomic "$WATCHDOG_ENV_FILE"', source)

        snapshot_dropin = 'EnvironmentFile=\nEnvironmentFile=${HEALTH_SNAPSHOT_ENV_FILE}'
        watchdog_dropin = 'EnvironmentFile=\nEnvironmentFile=${WATCHDOG_ENV_FILE}'
        self.assertIn(snapshot_dropin, source)
        self.assertIn(watchdog_dropin, source)

    def test_monitor_environment_files_are_release_pinned(self):
        source = SCRIPT.read_text(encoding="utf-8")
        self.assertIn("DISDEX_HEALTH_SNAPSHOT_EXPECTED_SHA=${DEPLOYED_SHA}", source)
        self.assertIn("DISDEX_HEALTH_SNAPSHOT_RELEASE_ROOT=${CURRENT_RELEASE}", source)
        self.assertIn("DISDEX_WATCHDOG_EXPECTED_SHA=${DEPLOYED_SHA}", source)
        self.assertIn("DISDEX_WATCHDOG_RELEASE_ROOT=${CURRENT_RELEASE}", source)
        self.assertIn("DISDEX_WATCHDOG_RUNNER_ROOT=${CURRENT_RELEASE}", source)


if __name__ == "__main__":
    unittest.main()
