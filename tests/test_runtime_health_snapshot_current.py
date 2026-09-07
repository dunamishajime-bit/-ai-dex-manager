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


if __name__ == "__main__":
    unittest.main()
