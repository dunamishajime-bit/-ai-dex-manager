#!/usr/bin/env python3
"""FET audit SHA-independent V52 pin negative-case contract tests."""
import importlib.util
from pathlib import Path
import unittest

SOURCE = Path(__file__).resolve().parents[1] / "scripts/ops/root/disdex-fet-preemption-readiness-guard.py"
spec = importlib.util.spec_from_file_location("fet_preemption_guard", SOURCE)
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)

SHA = "7688ed7c93a1918d8b44837339b7da5584a868f5"


class PinnedV52AuditTests(unittest.TestCase):
    def test_absent_pin_fails_closed(self):
        reason = guard.validate_v52_contract(
            None, {}, 1_793_573_600_000, 1, "/tmp", SHA, True
        )
        self.assertEqual(reason, "FET_PREEMPTION_V52_PIN_MISSING")

    def test_invalid_pin_fails_closed(self):
        invalid = {
            "sha": "bad",
            "releaseRoot": "/tmp/invalid",
            "serviceUnit": "invalid.service",
            "evidenceMode": "legacy",
        }
        reason = guard.validate_v52_contract(
            invalid, {}, 1_793_573_600_000, 1, "/tmp/invalid", SHA, True
        )
        self.assertEqual(reason, "FET_PREEMPTION_V52_PIN_INVALID")

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
