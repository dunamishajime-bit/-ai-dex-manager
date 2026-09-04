import json
import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import disdex_runner_heartbeat as heartbeat  # noqa: E402


class HeartbeatTests(unittest.TestCase):
    def setUp(self):
        self.root = Path.cwd() / ".task4-python-heartbeat-test"
        self.directory = self.root / "heartbeats"
        self.directory.mkdir(parents=True, exist_ok=True)
        self.old = {key: os.environ.get(key) for key in (
            "DISDEX_V52_RUNNER_HEARTBEAT_PATH", "DISDEX_QUALITY102_RUNNER_HEARTBEAT_PATH",
            "DISDEX_RUNTIME_COMMIT_SHA", "DISDEX_EXPECTED_RUNTIME_SHA", "DISDEX_V52_RUNNER_SERVICE_UNIT",
        )}

    def tearDown(self):
        for key, value in self.old.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        for path in self.directory.glob("*"):
            path.unlink()
        self.directory.rmdir()
        self.root.rmdir()

    def test_python_writer_reconstructs_bounded_redacted_payload_without_directory_mutation(self):
        target = self.directory / "v52.json"
        os.environ.update({
            "DISDEX_V52_RUNNER_HEARTBEAT_PATH": str(target),
            "DISDEX_RUNTIME_COMMIT_SHA": "0123456789abcdef0123456789abcdef01234567",
            "DISDEX_EXPECTED_RUNTIME_SHA": "0123456789abcdef0123456789abcdef01234567",
        })
        self.assertTrue(heartbeat.publish_heartbeat(
            runner_id="V52", mode="live", live_enabled=True, safety_state="LIVE",
            last_decision="tick", reason="token=secret " + "x" * 900,
            symbols=[{"symbol": "BTCUSDT", "eligible": False, "reason": "private_key=secret"}],
        ))
        payload = json.loads(target.read_text())
        self.assertLessEqual(len(payload["reason"]), 512)
        self.assertNotIn("secret", target.read_text().lower())
        self.assertEqual(payload["symbols"][0]["reason"], "[REDACTED]")

    def test_python_writer_rejects_unknown_symbol_fields_and_q102(self):
        target = self.directory / "v52.json"
        os.environ["DISDEX_V52_RUNNER_HEARTBEAT_PATH"] = str(target)
        self.assertFalse(heartbeat.publish_heartbeat(
            runner_id="V52", mode="live", live_enabled=False, safety_state="WAITING",
            last_decision="tick", reason="safe",
            symbols=[{"symbol": "BTCUSDT", "eligible": False, "reason": "safe", "token": "secret"}],
        ))
        q102 = self.directory / "q102.json"
        os.environ["DISDEX_QUALITY102_RUNNER_HEARTBEAT_PATH"] = str(q102)
        self.assertFalse(heartbeat.publish_heartbeat(
            runner_id="QUALITY102_CAUSAL_V1", mode="live", live_enabled=False,
            safety_state="UNKNOWN", last_decision="fatal", reason="safe",
        ))

    def test_v52_service_unit_allowlist_and_runner_relationship_are_enforced_before_write(self):
        target = self.directory / "v52.json"
        os.environ["DISDEX_V52_RUNNER_HEARTBEAT_PATH"] = str(target)
        target.write_text("sentinel\n")
        for invalid_unit in (
            "disdex-v52-aster-only.service",
            "disdex-v52-aster-only@0123456789abcdef0123456789abcdef0123456Z.service",
            "disdex-v12-x1-all@0123456789abcdef0123456789abcdef01234567.service",
        ):
            os.environ["DISDEX_V52_RUNNER_SERVICE_UNIT"] = invalid_unit
            self.assertFalse(heartbeat.publish_heartbeat(
                runner_id="V52", mode="live", live_enabled=False, safety_state="WAITING",
                last_decision="tick", reason="safe",
            ))
            self.assertEqual(target.read_text(), "sentinel\n")

        for valid_unit in (
            "disdex-v52-aster-only@0123456789abcdef0123456789abcdef01234567.service",
            "disdex-v96-v52-live.service",
        ):
            os.environ["DISDEX_V52_RUNNER_SERVICE_UNIT"] = valid_unit
            self.assertTrue(heartbeat.publish_heartbeat(
                runner_id="V52", mode="live", live_enabled=False, safety_state="WAITING",
                last_decision="tick", reason="safe",
            ))
            self.assertEqual(json.loads(target.read_text())["serviceUnit"], valid_unit)

    def test_python_serialized_text_redacts_all_ts_sensitive_patterns(self):
        target = self.directory / "v52.json"
        os.environ["DISDEX_V52_RUNNER_HEARTBEAT_PATH"] = str(target)
        sensitive = [
            "mnemonic=word1 seed phrase=word3 wallet=wallet-secret credential=cred-secret",
            "api-key=api-secret private key=private-secret secret=secret-value token=token-value",
            "password=password-value authorization=auth-value sk_12345678secret pk_abcdefghsecret 0x" + "a" * 40,
        ]
        self.assertTrue(heartbeat.publish_heartbeat(
            runner_id="V52", mode="live", live_enabled=False, safety_state="WAITING",
            last_decision=sensitive[0], reason=sensitive[1],
            symbols=[{"symbol": "BTCUSDT", "eligible": False, "reason": sensitive[2]}],
        ))
        persisted = target.read_text().lower()
        for secret in (
            "word1", "word3", "wallet-secret", "cred-secret", "api-secret", "private-secret",
            "secret-value", "token-value", "password-value", "auth-value", "sk_12345678secret",
            "pk_abcdefghsecret", "0x" + "a" * 40,
        ):
            self.assertNotIn(secret, persisted)
        payload = json.loads(persisted)
        self.assertLessEqual(len(payload["reason"]), heartbeat.MAX_REASON_LENGTH)
        self.assertLessEqual(len(payload["lastdecision"]), heartbeat.MAX_REASON_LENGTH)
        self.assertLessEqual(len(payload["symbols"][0]["reason"]), heartbeat.MAX_REASON_LENGTH)


if __name__ == "__main__":
    unittest.main()
