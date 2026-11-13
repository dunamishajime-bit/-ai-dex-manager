import importlib.util
from pathlib import Path
import json
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "ops" / "root" / "disdex-fet-preemption-readiness-guard.py"
SPEC = importlib.util.spec_from_file_location("fet_preemption_guard", SCRIPT)
guard = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(guard)

NOW = 1_793_573_600_000
SHA = "4d33d8244c0b50a7e461ffd8aaf493c32bfdfd81"
ROOT = f"/home/deploy/disdex-trading/releases/{SHA}"
UNIT = f"disdex-v52-aster-only@{SHA}.service"
PID = 512995

def pin():
    return {
        "sha": SHA,
        "releaseRoot": ROOT,
        "serviceUnit": UNIT,
        "evidenceMode": "heartbeat_v1",
        "healthPath": "/var/lib/disdex/runner-health/heartbeats/v52.json",
        "tickPath": "/var/lib/disdex/runner-health/ticks/v52.json",
    }

def heartbeat():
    return {
        "schema": "disdex-runner-heartbeat/v1",
        "runnerId": "V52",
        "runtimeSha": SHA,
        "expectedSha": SHA,
        "serviceUnit": UNIT,
        "mainPid": PID,
        "workingDirectory": ROOT,
        "mode": "LIVE",
        "safetyState": "HEALTHY",
        "newOrdersAllowed": True,
        "heartbeatAt": NOW - 1000,
        "lastTickAt": NOW - 2000,
    }

class V52EvidenceContractTests(unittest.TestCase):

    def test_current_production_v52_pin_remains_legacy_until_compatible_writer_cutover(self):
        manifest_path = Path(__file__).resolve().parents[1] / "config" / "disdex-runner-pins-DD1296_FINAL_ALLIN_10BPS.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        current = manifest["runners"]["V52"]
        old_sha = "4d33d8244c0b50a7e461ffd8aaf493c32bfdfd81"
        self.assertEqual(current["sha"], old_sha)
        self.assertEqual(current["evidenceMode"], "legacy")
        self.assertEqual(current["tickPath"], "/var/lib/disdex/runner-health/ticks/v52.json")

    def test_valid_contract_passes(self):
        self.assertIsNone(guard.validate_v52_contract(pin(), heartbeat(), NOW, PID, ROOT, SHA, True))

    def test_wrong_pin_sha_or_service_fails(self):
        for field, value in (
            ("sha", "9" * 40),
            ("releaseRoot", "/home/deploy/disdex-trading/releases/" + "9" * 40),
            ("serviceUnit", "disdex-v52-aster-only@" + "9" * 40 + ".service"),
            ("evidenceMode", "legacy"),
        ):
            with self.subTest(field=field):
                p = pin()
                p[field] = value
                self.assertEqual(guard.validate_v52_contract(p, heartbeat(), NOW, PID, ROOT, SHA, True),
                                 "FET_PREEMPTION_V52_PIN_INVALID")

    def test_marker_pid_cwd_and_running_must_match(self):
        self.assertEqual(guard.validate_v52_contract(pin(), heartbeat(), NOW, PID, ROOT, "9" * 40, True),
                         "FET_PREEMPTION_V52_RELEASE_MISMATCH")
        self.assertEqual(guard.validate_v52_contract(pin(), heartbeat(), NOW, 0, ROOT, SHA, True),
                         "FET_PREEMPTION_V52_NOT_RUNNING")
        self.assertEqual(guard.validate_v52_contract(pin(), heartbeat(), NOW, PID, "/wrong", SHA, True),
                         "FET_PREEMPTION_V52_WORKING_DIRECTORY_MISMATCH")
        self.assertEqual(guard.validate_v52_contract(pin(), heartbeat(), NOW, PID, ROOT, SHA, False),
                         "FET_PREEMPTION_V52_NOT_RUNNING")

    def test_heartbeat_wrong_identity_and_pid_fail(self):
        for field, value in (
            ("runnerId", "FET_BRK48_RESIDUAL"),
            ("runtimeSha", "9" * 40),
            ("expectedSha", "9" * 40),
            ("serviceUnit", "wrong.service"),
            ("mainPid", PID + 1),
            ("workingDirectory", "/wrong"),
            ("safetyState", "BLOCKED"),
            ("newOrdersAllowed", False),
        ):
            with self.subTest(field=field):
                hb = heartbeat()
                hb[field] = value
                self.assertEqual(guard.validate_v52_contract(pin(), hb, NOW, PID, ROOT, SHA, True),
                                 "FET_PREEMPTION_V52_HEARTBEAT_INVALID")

    def test_stale_and_future_heartbeat_or_tick_fail(self):
        for field in ("heartbeatAt", "lastTickAt"):
            for value in (NOW - 300001, NOW + 10001, None, "bad", True):
                with self.subTest(field=field, value=value):
                    hb = heartbeat()
                    hb[field] = value
                    self.assertEqual(guard.validate_v52_contract(pin(), hb, NOW, PID, ROOT, SHA, True),
                                     "FET_PREEMPTION_V52_HEARTBEAT_INVALID")

if __name__ == "__main__":
    unittest.main()
