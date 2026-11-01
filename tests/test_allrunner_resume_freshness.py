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
        "positions": [{"symbol": "DOGEUSDT", "positionAmt": -226, "entryPrice": 0.08052}],
        "openOrders": [{"symbol": "DOGEUSDT", "clientOrderId": resume.STOP_ID,
                        "side": "BUY", "type": "STOP_MARKET", "origQty": 226,
                        "executedQty": 0, "reduceOnly": True, "status": "NEW"}],
    }


def run_fixture(value):
    result = types.SimpleNamespace(returncode=0, stdout=json.dumps(value) + "\n", stderr="")
    with patch.object(resume.subprocess, "run", return_value=result), patch.object(resume.time, "time", return_value=NOW / 1000):
        return resume.signed_get()


class SignedEvidenceFreshnessTests(unittest.TestCase):
    def test_fresh_protected_position_is_accepted(self):
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

    def test_unexplained_extra_doge_position_or_order_is_rejected(self):
        value = diagnostic()
        value["positions"].append({"symbol": "DOGEUSDT", "positionAmt": 1, "entryPrice": 0.08})
        with self.assertRaises(RuntimeError):
            run_fixture(value)
        value = diagnostic()
        value["openOrders"].append({"symbol": "DOGEUSDT", "clientOrderId": "unknown",
                                     "side": "BUY", "type": "STOP_MARKET", "origQty": 1,
                                     "executedQty": 0, "reduceOnly": True, "status": "NEW"})
        with self.assertRaises(RuntimeError):
            run_fixture(value)


if __name__ == "__main__":
    unittest.main()
