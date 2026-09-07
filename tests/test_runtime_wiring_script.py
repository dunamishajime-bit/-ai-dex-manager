import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "ops" / "root" / "disdex-current-runtime-wiring"


class RuntimeWiringScriptTest(unittest.TestCase):
    def test_wiring_is_current_sha_driven_and_has_read_only_mode(self):
        source = SCRIPT.read_text(encoding="utf-8")
        self.assertIn('CURRENT_RELEASE="$(readlink -f -- "$TRADING_CURRENT")"', source)
        self.assertIn('[[ "$DEPLOYED_SHA" =~ ^[0-9a-f]{40}$ ]]', source)
        self.assertIn("--check|--apply", source)
        self.assertIn("DISDEX_WATCHDOG_EXPECTED_SHA=${DEPLOYED_SHA}", source)
        self.assertIn("DISDEX_HEALTH_SNAPSHOT_EXPECTED_SHA=${DEPLOYED_SHA}", source)
        self.assertIn("DISDEX_V96_STATE_DIR=${V52_LEGACY_CRYPTO_ROOT}", source)

    def test_wiring_script_does_not_stop_or_cancel_trading(self):
        source = SCRIPT.read_text(encoding="utf-8")
        self.assertNotIn("systemctl stop", source)
        self.assertNotIn("systemctl cancel", source)
        self.assertNotIn("pkill", source)


if __name__ == "__main__":
    unittest.main()
