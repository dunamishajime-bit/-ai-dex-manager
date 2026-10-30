"""Contract tests for the V4 refresh-only systemd staging path."""
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class V4RefreshInstallerContractTests(unittest.TestCase):
    def test_staging_installer_is_root_only_and_never_starts_a_runner(self):
        installer = (ROOT / "scripts/ops/root/install-disdex-v4-evidence-refresh").read_text()
        self.assertIn('"$(id -u)" == "0"', installer)
        self.assertIn("/home/deploy/disdex-trading/releases/", installer)
        self.assertIn(".disdex-release-sha", installer)
        self.assertIn("disdex-v4-dynamic-evidence-refresh@.service", installer)
        self.assertIn("disdex-v4-dynamic-evidence-refresh@.timer", installer)
        self.assertIn("systemctl daemon-reload", installer)
        self.assertNotRegex(installer, r"systemctl\s+(start|restart|enable|disable|stop)")
        self.assertNotIn("current", installer.lower())
        self.assertNotIn("ordersEnabled=true", installer)

    def test_unified_stager_exposes_the_refresh_only_installer(self):
        installer = (ROOT / "scripts/ops/root/install-disdex-unified-deployment").read_text()
        self.assertIn("scripts/ops/root/install-disdex-v4-evidence-refresh", installer)
        self.assertIn("install-disdex-v4-evidence-refresh", installer)

    def test_activation_enables_only_the_sha_pinned_refresh_timer(self):
        wrapper = (ROOT / "scripts/ops/root/disdex-v4-evidence-refresh-activate").read_text()
        self.assertIn("id -u", wrapper)
        self.assertIn("disdex_v4_evidence_refresh_activation.py", wrapper)
        self.assertIn("systemctl enable --now", wrapper)
        self.assertIn("disdex-v4-dynamic-evidence-refresh@${sha}.timer", wrapper)
        self.assertNotRegex(wrapper, r"systemctl\s+(restart|start|stop)\s+disdex-(?!v4-dynamic-evidence-refresh)")
        self.assertNotIn("current", wrapper.lower())


if __name__ == "__main__":
    unittest.main()
