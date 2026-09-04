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
            "DISDEX_RUNTIME_COMMIT_SHA", "DISDEX_EXPECTED_RUNTIME_SHA",
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
        self.assertEqual(payload["symbols"][0]["reason"], "private_key=[REDACTED]")

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


if __name__ == "__main__":
    unittest.main()
