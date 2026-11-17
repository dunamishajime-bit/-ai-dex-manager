"""The STABLE4 H48 root preparation workflow is not a LIVE switch."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]
YAML = ROOT / ".github/workflows/disdex-stable4-h48-owner-gates.yml"


class FormalWorkflowContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = YAML.read_text(encoding="utf8")

    def test_owner_only_master_with_production_review(self):
        for value in (
            "github.event_name == 'workflow_dispatch'",
            "github.repository == 'dunamishajime-bit/-ai-dex-manager'",
            "github.ref == 'refs/heads/master'",
            "github.actor == 'dunamishajime-bit'",
            "name: disdex-production",
            "cancel-in-progress: false",
        ):
            self.assertIn(value, self.text)

    def test_exact_h48_signature_verification_and_redeem_before_root_access(self):
        for value in (
            "action':'redeem'",
            "operation':fixed.OPERATION",
            "scope':'HYPE_TREND_LONG'",
            "target_sha':fixed.SOURCE",
            "plan_sha256':fixed.PLAN",
            "from disdex_owner_approval import verify",
            "route='GITHUB_ACTIONS'",
        ):
            self.assertIn(value, self.text)
        self.assertLess(self.text.index("Redeem exactly approved H48 policy"),
                        self.text.index("Stage Root-owned"))

    def test_root_stage_sha_and_exact_preflight_before_writes(self):
        for value in (
            '[[ "$(git rev-parse HEAD)" == "$GITHUB_SHA" ]]',
            "StrictHostKeyChecking=yes",
            'expected="$(sha256sum "$source"',
            '[[ "$expected" == "$actual" ]]',
            " --preflight-readonly --approval-id ",
            " --issue --approval-id ",
            " --arm --approval-id ",
        ):
            self.assertIn(value, self.text)
        self.assertLess(self.text.index(" --preflight-readonly --approval-id "),
                        self.text.index(" --issue --approval-id "))
        self.assertLess(self.text.rindex(" --preflight-readonly --approval-id "),
                        self.text.index(" --arm --approval-id "))

    def test_token_and_ssh_secret_cleanup_but_no_trading_commands(self):
        for value in (
            '"$RUNNER_TEMP/stable4-h48-owner-token"',
            "if: always()",
            "rm -rf",
            "STABLE4_LIVE_SWITCH_EXECUTED=FALSE",
            "TRADING_MUTATIONS=0",
        ):
            self.assertIn(value, self.text)
        for forbidden in ("systemctl start", "systemctl stop", "FLATTEN_MANAGED",
                          "kill-switch.json'", "GVAR{", "GHVAR{", "api/v3/order",
                          "risk_override", "kill_switch_clear"):
            self.assertNotIn(forbidden, self.text)


if __name__ == "__main__":
    unittest.main()
