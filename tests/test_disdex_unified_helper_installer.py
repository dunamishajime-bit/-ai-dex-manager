from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class UnifiedHelperInstallerContractTests(unittest.TestCase):
    def test_installer_is_root_only_exact_release_and_stages_refresh_systemd(self):
        installer = (ROOT / "scripts/ops/root/install-disdex-unified-deployment").read_text()
        self.assertIn('"$(id -u)" == "0"', installer)
        self.assertIn("/home/deploy/disdex-trading/releases/", installer)
        self.assertIn(".disdex-release-sha", installer)
        self.assertIn("install -o root -g root", installer)
        self.assertIn("ops/systemd/disdex-v4-dynamic-evidence-refresh@.service", installer)
        self.assertIn("ops/systemd/disdex-v4-dynamic-evidence-refresh@.timer", installer)
        self.assertIn("/etc/systemd/system/disdex-v4-dynamic-evidence-refresh@.service", installer)
        self.assertIn("/etc/systemd/system/disdex-v4-dynamic-evidence-refresh@.timer", installer)
        self.assertIn("/var/lib/disdex/unified-deploy/refresh-leases/v4", installer)
        self.assertIn("/var/lib/disdex/unified-deploy/nonces", installer)
        self.assertIn("systemctl daemon-reload", installer)
        self.assertNotIn("authorized_keys", installer)
        self.assertNotIn("PRIVATE_KEY", installer)

    def test_installer_groups_permission_bit_checks_before_comparison(self):
        installer = (ROOT / "scripts/ops/root/install-disdex-unified-deployment").read_text()
        self.assertIn("(( (0$release_mode & 022) == 0 ))", installer)
        self.assertIn("(( (0$marker_mode & 0222) == 0 ))", installer)

    def test_deployed_python_entrypoints_use_unix_line_endings(self):
        for path in sorted((ROOT / "scripts/ops/deploy").glob("*.py")):
            self.assertNotIn(b"\r\n", path.read_bytes(), path.as_posix())

    def test_authorized_keys_example_is_forced_command_only(self):
        example = (ROOT / "deploy/ssh/disdex-unified-forced-command.authorized_keys.example").read_text()
        self.assertIn("command=\"/usr/local/libexec/disdex-unified/disdex_unified_forced_command.py\"", example)
        self.assertIn("no-pty", example)
        self.assertIn("OWNER_PUBLIC_KEY", example)
        self.assertNotIn("BEGIN OPENSSH PRIVATE KEY", example)


if __name__ == "__main__":
    unittest.main()
