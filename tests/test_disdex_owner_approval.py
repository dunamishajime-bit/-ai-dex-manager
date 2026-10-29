import base64
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts" / "ops" / "deploy"))
from disdex_owner_approval import (
    DEPLOYMENT_TARGET,
    OPERATOR_TARGET,
    issue,
    verify,
    canonical,
    unique_json,
)

REPO = "dunamishajime-bit/-ai-dex-manager"
SHA = "c9beb423ae9b6b18333ae9426a21a69cf35baeef"
PLAN = "d" * 64

@unittest.skipUnless(shutil.which("openssl"), "OpenSSL is required for Ed25519 contract tests")
class DeploymentApprovalTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.key = Path(cls.temp.name) / "key.pem"
        cls.pub = Path(cls.temp.name) / "pub.pem"
        subprocess.run(["openssl", "genpkey", "-algorithm", "ED25519",
                        "-out", str(cls.key)], check=True, capture_output=True)
        subprocess.run(["openssl", "pkey", "-in", str(cls.key), "-pubout",
                        "-out", str(cls.pub)], check=True, capture_output=True)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def token(self):
        return issue(REPO, SHA, "SHARED_CRYPTO_RISK_ONLY", "owner", self.key, PLAN,
                     now=1700000000, ttl=120)

    def check(self, token, sha=SHA, scope="SHARED_CRYPTO_RISK_ONLY",
              operator="owner", now=1700000010):
        return verify(token, self.pub, REPO, sha, scope, operator, PLAN, now=now)

    def test_valid(self):
        self.assertEqual(self.check(self.token())["sourceSha"], SHA)

    def test_change_sha(self):
        with self.assertRaisesRegex(ValueError, "mismatch"):
            self.check(self.token(), sha="a"*40)

    def test_expand_scope(self):
        with self.assertRaisesRegex(ValueError, "mismatch"):
            self.check(self.token(), scope="FULL_PROJECT")

    def test_different_operator(self):
        with self.assertRaisesRegex(ValueError, "mismatch"):
            self.check(self.token(), operator="other")

    def test_plan_swap(self):
        with self.assertRaisesRegex(ValueError, "target mismatch"):
            verify(self.token(), self.pub, REPO, SHA, "SHARED_CRYPTO_RISK_ONLY",
                   "owner", "f"*64, now=1700000010)

    def test_expired(self):
        with self.assertRaisesRegex(ValueError, "time window"):
            self.check(self.token(), now=1700000200)

    def test_future(self):
        with self.assertRaisesRegex(ValueError, "time window"):
            self.check(self.token(), now=1699999800)

    def test_tamper_signature(self):
        token = json.loads(base64.b64decode(self.token()))
        token["payload"]["scope"] = "FULL_PROJECT"
        bad = base64.b64encode(canonical(token)).decode("ascii")
        with self.assertRaisesRegex(ValueError, "signature"):
            self.check(bad, scope="FULL_PROJECT")

    def test_duplicate_json(self):
        with self.assertRaisesRegex(ValueError, "duplicate"):
            unique_json('{"a":1,"a":2}')

    def test_missing_token(self):
        with self.assertRaisesRegex(ValueError, "malformed"):
            self.check("not-valid-base64!")

    def test_bad_nonce(self):
        token = json.loads(base64.b64decode(self.token()))
        token["payload"]["nonce"] = "../../breakout"
        bad = base64.b64encode(canonical(token)).decode("ascii")
        with self.assertRaisesRegex(ValueError, "identity"):
            self.check(bad)

    def test_route_is_bound_to_signature(self):
        token = issue(REPO, SHA, "SHARED_CRYPTO_RISK_ONLY", "owner", self.key, PLAN,
                      route="CODEX_SSH", now=1700000000, ttl=120)
        self.assertEqual(
            verify(token, self.pub, REPO, SHA, "SHARED_CRYPTO_RISK_ONLY", "owner", PLAN,
                   route="CODEX_SSH", now=1700000010)["route"],
            "CODEX_SSH",
        )
        with self.assertRaisesRegex(ValueError, "target mismatch"):
            self.check(token)

    def test_target_and_operator_are_bound(self):
        token = issue(REPO, SHA, "SHARED_CRYPTO_RISK_ONLY", "owner", self.key, PLAN,
                      deployment_target=DEPLOYMENT_TARGET,
                      operator_target=OPERATOR_TARGET,
                      now=1700000000, ttl=120)
        self.assertEqual(
            verify(token, self.pub, REPO, SHA, "SHARED_CRYPTO_RISK_ONLY", "owner", PLAN,
                   deployment_target=DEPLOYMENT_TARGET,
                   operator_target=OPERATOR_TARGET,
                   now=1700000010)["deploymentTarget"],
            DEPLOYMENT_TARGET,
        )

    def test_shared_risk_cannot_grant_new_orders(self):
        with self.assertRaisesRegex(ValueError, "order permission"):
            issue(REPO, SHA, "SHARED_CRYPTO_RISK_ONLY", "owner", self.key, PLAN,
                 orders_enabled=True, now=1700000000, ttl=120)

    def test_order_permission_is_signed(self):
        token = issue(REPO, SHA, "V12_V4", "owner", self.key, PLAN,
                      orders_enabled=True, now=1700000000, ttl=120)
        self.assertTrue(
            verify(token, self.pub, REPO, SHA, "V12_V4", "owner", PLAN,
                   orders_enabled=True, now=1700000010)["ordersEnabled"]
        )
        with self.assertRaisesRegex(ValueError, "target mismatch"):
            verify(token, self.pub, REPO, SHA, "V12_V4", "owner", PLAN,
                   orders_enabled=False, now=1700000010)

if __name__ == "__main__":
    unittest.main()
