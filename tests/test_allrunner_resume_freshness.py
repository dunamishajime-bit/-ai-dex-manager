"""Offline tests: never call Aster or start a service."""
import importlib.util
import json
from pathlib import Path
import types
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[1] / "scripts/ops/deploy/disdex_allrunner_v4_idle_live_resume.py"
spec = importlib.util.spec_from_file_location("allrunner_resume", SCRIPT)
resume = importlib.util.module_from_spec(spec)
spec.loader.exec_module(resume)

NOW = 1_793_570_000_000


def diagnostic():
    return {
        "status": "ASTER_READONLY_ACCOUNT_DIAGNOSTIC_PASS", "observedAt": NOW - 500,
        "venueTime": NOW - 1000, "ordersSent": 0, "cancelsSent": 0,
        "positionChangesSent": 0,
        "positions": [],
        "openOrders": [],
    }


def run_fixture(value):
    result = types.SimpleNamespace(returncode=0, stdout=json.dumps(value) + "\n", stderr="")
    with patch.object(resume.subprocess, "run", return_value=result), patch.object(resume.time, "time", return_value=NOW / 1000):
        return resume.signed_get()


class SignedEvidenceFreshnessTests(unittest.TestCase):
    def test_fresh_signed_flat_account_is_accepted(self):
        self.assertEqual(run_fixture(diagnostic())["observedAt"], NOW - 500)

    def test_stale_future_missing_and_invalid_timestamps_are_rejected(self):
        for field in ("observedAt", "venueTime"):
            for invalid in (None, NOW - 30_001, NOW + 5_001, "not-time", True):
                with self.subTest(field=field, value=invalid):
                    value = diagnostic()
                    value[field] = invalid
                    with self.assertRaises(RuntimeError):
                        run_fixture(value)

    def test_malformed_position_or_order_collections_are_rejected(self):
        for field in ("positions", "openOrders"):
            for invalid in (None, {}, "bad", [None]):
                with self.subTest(field=field, value=invalid):
                    value = diagnostic()
                    value[field] = invalid
                    with self.assertRaises((RuntimeError, ValueError, TypeError)):
                        run_fixture(value)

    def test_read_only_counters_must_be_explicit_integer_zero(self):
        for field in ("ordersSent", "cancelsSent", "positionChangesSent"):
            for invalid in (None, False, "0", 1):
                with self.subTest(field=field, value=invalid):
                    value = diagnostic()
                    value[field] = invalid
                    with self.assertRaises(RuntimeError):
                        run_fixture(value)

    def test_any_nonflat_position_or_open_order_is_rejected(self):
        for position in (
            {"symbol": "DOGEUSDT", "positionAmt": -226, "entryPrice": 0.08052},
            {"symbol": "FETUSDT", "positionAmt": 1, "entryPrice": 0.2},
        ):
            with self.subTest(position=position):
                value = diagnostic()
                value["positions"].append(position)
                with self.assertRaisesRegex(RuntimeError, "ASTER_ACCOUNT_NOT_FLAT"):
                    run_fixture(value)
        for order in (
            {"symbol": "DOGEUSDT", "clientOrderId": "old-stop", "status": "NEW"},
            {"symbol": "FETUSDT", "clientOrderId": "pending-entry", "status": "NEW"},
        ):
            with self.subTest(order=order):
                value = diagnostic()
                value["openOrders"].append(order)
                with self.assertRaisesRegex(RuntimeError, "ASTER_ACCOUNT_NOT_FLAT"):
                    run_fixture(value)


if __name__ == "__main__":
    unittest.main()
