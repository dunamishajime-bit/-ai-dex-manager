"""Unit-level fail-closed checks for the scoped V52 cutover.

No exchange connection or systemd control is used by these tests.
"""
import importlib.util
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

MODULE = Path(__file__).resolve().parents[2] / "scripts/ops/deploy/disdex_v52_owner_approved_4d33_cutover.py"
SPEC = importlib.util.spec_from_file_location("v52_hotfix", MODULE)
m = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(m)


class V52CutoverTests(unittest.TestCase):
    def test_exact_release_constants(self):
        self.assertEqual(m.PROD, "7688ed7c93a1918d8b44837339b7da5584a868f5")
        self.assertEqual(m.OLD, "97830672e2f139b39f7194166d7dc8c36e8c8933")
        self.assertEqual(m.NEW, "4d33d8244c0b50a7e461ffd8aaf493c32bfdfd81")
        self.assertNotEqual(m.OLD, m.NEW)

    def test_pin_updates_both_fields_without_other_changes(self):
        old = (f"# deliberate unrelated setting\n"
               f"DISDEX_V52_RUNTIME_SHA={m.OLD}\n"
               f"DISDEX_V52_RUNTIME_ROOT={m.BASE / m.OLD}\n"
               f"ANOTHER_FLAG=unchanged\n").encode()
        new = m.new_pin(old)
        self.assertEqual(new.count(m.NEW.encode()), 2)
        self.assertNotIn(m.OLD.encode(), new)
        self.assertIn(b"ANOTHER_FLAG=unchanged", new)
        self.assertIn(b"# deliberate unrelated setting", new)

    def test_venue_proof_rejects_unprotected_short(self):
        good = {
            "status": "ASTER_READONLY_ACCOUNT_DIAGNOSTIC_PASS",
            "observedAt": 123456,
            "ordersSent": 0, "cancelsSent": 0, "positionChangesSent": 0,
            "positions": [{"symbol": "DOGEUSDT", "positionAmt": -226, "entryPrice": 0.08052}],
            "openOrders": [{"symbol": "DOGEUSDT", "clientOrderId": m.STOP,
                            "side": "BUY", "type": "STOP_MARKET", "origQty": "226",
                            "executedQty": "0", "reduceOnly": True, "status": "NEW"}],
        }
        with patch.object(m.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, json.dumps(good), "")):
            self.assertEqual(m.venue_get(), "123456")
        for mutate in [
            lambda d: d["openOrders"][0].update(reduceOnly=False),
            lambda d: d["openOrders"][0].update(clientOrderId="unexpected"),
            lambda d: d["positions"][0].update(positionAmt=0),
            lambda d: d.update(ordersSent=1),
            lambda d: d.update(openOrders=[]),
        ]:
            value = json.loads(json.dumps(good))
            mutate(value)
            with self.subTest(value=value):
                with patch.object(m.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, json.dumps(value), "")):
                    with self.assertRaises(RuntimeError):
                        m.venue_get()

    def test_incomplete_venue_read_fails_closed(self):
        with patch.object(m.subprocess, "run", return_value=subprocess.CompletedProcess([], 5, "", "read failed")):
            with self.assertRaisesRegex(RuntimeError, "SIGNED_ASTER_GET_FAILED"):
                m.venue_get()

    def test_old_and_new_must_not_run_simultaneously(self):
        with patch.object(m, "risk_snapshot"), patch.object(m, "service_active", side_effect=[True, True]):
            with self.assertRaisesRegex(RuntimeError, "EXPECTED_OLD_ONLY_V52_RUNNING"):
                m.all_preflight()

    def test_duplicate_venue_observations_block(self):
        with patch.object(m, "risk_snapshot"), patch.object(m, "service_active", side_effect=[True, False]), \
             patch.object(m, "unit_property", return_value="1234"), \
             patch.object(m.os.path, "realpath", return_value=str(m.BASE / m.OLD)), \
             patch.object(m, "pinned", return_value=(b"", 0, 0, 0)), \
             patch.object(m, "venue_get", return_value="1000"):
            with self.assertRaisesRegex(RuntimeError, "SIGNED_ASTER_GET_TIMESTAMPS_NOT_INCREASING"):
                m.all_preflight()

    def test_old_v52_stop_never_happens_in_preflight(self):
        with patch.object(m, "risk_snapshot", side_effect=RuntimeError("KILL_SWITCH_NOT_ACTIVE")), \
             patch.object(m, "run") as mocked_run:
            with self.assertRaisesRegex(RuntimeError, "KILL_SWITCH_NOT_ACTIVE"):
                m.all_preflight()
            mocked_run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
