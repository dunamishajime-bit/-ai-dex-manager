#!/usr/bin/env python3
"""FET audit SHA-independent V52 pin negative-case contract tests."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[1] / "scripts/ops/root/disdex-fet-preemption-readiness-guard.py"
spec = importlib.util.spec_from_file_location("fet_preemption_guard", SOURCE)
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)

SHA = "7688ed7c93a1918d8b44837339b7da5584a868f5"


class PinnedV52AuditTests(unittest.TestCase):
    def test_absent_pin_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            ok, reason = guard.v52_live_pinned(Path(tmp) / "missing")
            self.assertFalse(ok)
            self.assertNotEqual(reason, "V52_PINNED_IDENTITY_PASS")

    def test_invalid_pin_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            pin = Path(tmp) / "runner-pins.json"
            pin.write_text(json.dumps({
                "schema": "disdex-runner-pin-manifest/v2",
                "target": "professional-dismanager.net",
                "operatorTarget": "DD1296_FINAL_ALLIN_10BPS",
                "runners": {"V52": {
                    "sha": "bad", "releaseRoot": "/tmp/invalid",
                    "serviceUnit": "disdex-v52-aster-only@bad.service",
                    "evidenceMode": "legacy-state-v1",
                    "healthPath": "/var/lib/disdex/v52-aster-only/runner-live.json",
                    "tickPath": "/var/lib/disdex/runner-health/ticks/v52.json",
                }},
            }))
            ok, reason = guard.v52_live_pinned(pin)
            self.assertFalse(ok)
            self.assertNotEqual(reason, "V52_PINNED_IDENTITY_PASS")

    def test_fet_approval_and_config_remain_required(self):
        valid = {"DISDEX_RUNTIME_COMMIT_SHA": SHA, "FET_BRK48_CORE_PREEMPTION_READY": "true"}
        self.assertEqual(guard.evaluate(SHA, True, valid, "true")["status"], "HEALTHY")
        self.assertEqual(guard.evaluate(SHA, False, valid, "true")["status"], "BLOCKED")
        self.assertEqual(guard.evaluate(SHA, True, valid, "false")["status"], "BLOCKED")
        self.assertEqual(guard.evaluate(SHA, True, {"DISDEX_RUNTIME_COMMIT_SHA": "different", "FET_BRK48_CORE_PREEMPTION_READY": "true"}, "true")["status"], "BLOCKED")

    def test_no_trade_side_effects_declared(self):
        text = SOURCE.read_text()
        self.assertIn("mode.add_argument", text)
        self.assertIn("--audit", text)
        self.assertIn("--prestart", text)
        self.assertNotIn('submitOrder(', text)
        self.assertNotIn('cancelOrder(', text)


if __name__ == "__main__":
    unittest.main()
