import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts" / "ops" / "deploy"))
from disdex_codex_ssh import build_ssh_command


SHA = "c9beb423ae9b6b18333ae9426a21a69cf35baeef"
PLAN = "d" * 64


class CodexSshAdapterTests(unittest.TestCase):
    def command(self, **overrides):
        args = dict(
            host="professional-dismanager.net",
            identity_file="C:/Users/dis/Desktop/DisDex.pem",
            known_hosts="C:/Users/dis/Desktop/disdex-known-hosts",
            port=22,
            sha=SHA,
            scope="SHARED_CRYPTO_RISK_ONLY",
            plan_sha256=PLAN,
            orders_enabled=False,
            owner='dunamishajime-bit',
        )
        args.update(overrides)
        return build_ssh_command(**args)

    def test_uses_fixed_root_helper_and_codex_route(self):
        command = self.command()
        self.assertIn("root@professional-dismanager.net", command)
        self.assertIn("/usr/local/sbin/disdex-unified-production-deploy", command)
        self.assertIn("CODEX_SSH", command)
        self.assertIn("--owner", command)
        self.assertIn("--execute", command)
        self.assertIn("--read-approval-stdin", command)
        self.assertNotIn("bash", command)
        self.assertNotIn("sh -c", command)

    def test_rejects_other_host(self):
        with self.assertRaisesRegex(ValueError, "deployment host"):
            self.command(host="other.example")

    def test_shared_risk_rejects_order_permission(self):
        with self.assertRaisesRegex(ValueError, "order permission"):
            self.command(orders_enabled=True)

    def test_v4_refresh_scope_uses_dedicated_owner_wrapper(self):
        command = self.command(scope="V4_EVIDENCE_REFRESH_ONLY")
        self.assertIn("/usr/local/sbin/disdex-v4-evidence-refresh-activate", command)
        self.assertIn("--install", command)
        self.assertIn("--token-stdin", command)
        self.assertNotIn("--execute", command)
        self.assertNotIn("disdex-unified-production-deploy", command)

    def test_rejects_invalid_sha_and_plan(self):
        with self.assertRaisesRegex(ValueError, "SHA"):
            self.command(sha="not-a-sha")
        with self.assertRaisesRegex(ValueError, "plan"):
            self.command(plan_sha256="not-a-plan")


if __name__ == "__main__":
    unittest.main()
