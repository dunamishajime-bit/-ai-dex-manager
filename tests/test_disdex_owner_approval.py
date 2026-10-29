import base64
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts" / "ops" / "deploy"))
from disdex_owner_approval import issue, verify, canonical, unique_json

REPO = "dunamishajime-bit/-ai-dex-manager"
SHA = "c9beb423ae9b6b18333ae9426a21a69cf35baeef"

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
        return issue(REPO, SHA, "SHARED_CRYPTO_RISK_ONLY", "owner", self.key,
                     now=1700000000, ttl=120)

    def check(self, token, sha=SHA, scope="SHARED_CRYPTO_RISK_ONLY",
              operator="owner", now=1700000010):
        return verify(token, self.pub, REPO, sha, scope, operator, now=now)

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

if __name__ == "__main__":
    unittest.main()
