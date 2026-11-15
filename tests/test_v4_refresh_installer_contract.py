import ast
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
INSTALLER = ROOT / "scripts/ops/root/install-disdex-v4-evidence-refresh"
ACTIVATION = ROOT / "scripts/ops/deploy/disdex_v4_evidence_refresh_activation.py"
NEW_OUTPUT = "/var/lib/disdex/unified-deploy/v4-evidence/evidence-refresh-last.json"
OLD_OUTPUT = "/var/lib/disdex/v12-v4/evidence-refresh-last.json"

class RefreshInstallerContractTest(unittest.TestCase):
    def test_activation_uses_root_managed_output(self):
        source = ACTIVATION.read_text(encoding="utf-8")
        ast.parse(source)
        self.assertIn(f'REFRESH_OUTPUT_PATH = "{NEW_OUTPUT}"', source)
        self.assertNotIn(f'REFRESH_OUTPUT_PATH = "{OLD_OUTPUT}"', source)
        self.assertIn('"ordersEnabled": False', source)

    def test_installer_creates_private_contract_paths_and_installs_activation(self):
        source = INSTALLER.read_text(encoding="utf-8")
        self.assertIn("scripts/ops/deploy/disdex_v4_evidence_refresh_activation.py", source)
        self.assertIn("install -d -o root -g root -m 0700 /var/lib/disdex/unified-deploy/refresh-leases/v4", source)
        self.assertIn("install -d -o root -g root -m 0700 /var/lib/disdex/unified-deploy/v4-evidence", source)
        self.assertIn("/usr/local/libexec/disdex-unified/disdex_v4_evidence_refresh_activation.py", source)
        self.assertNotIn("install -d -o root -g root -m 0750 /var/lib/disdex/unified-deploy/refresh-leases/v4", source)

if __name__ == "__main__":
    unittest.main()
