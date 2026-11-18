import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts" / "ops" / "deploy"))
import disdex_idle_h48_protected_recovery as recovery


NOW = 1_794_987_700_000


def idle_state(**changes):
    value = {
        "schema": recovery.IDLE_STATE_SCHEMA,
        "runtimeSha": recovery.IDLE_SHA,
        "updatedAt": NOW - 24 * 60 * 60 * 1000,
        "position": None,
        "pending": None,
        "manualReview": None,
        "lastDecision": {"accepted": False},
    }
    value.update(changes)
    return value


class IdleH48RecoveryContractTests(unittest.TestCase):
    def test_flat_stale_state_is_refreshable_without_changing_strategy_fields(self):
        before = idle_state()
        after = recovery.refreshed_idle_state(before, NOW)
        self.assertEqual(after["updatedAt"], NOW)
        self.assertEqual(after["runtimeSha"], recovery.IDLE_SHA)
        self.assertIsNone(after["position"])
        self.assertIsNone(after["pending"])
        self.assertIsNone(after["manualReview"])
        self.assertEqual(after["lastDecision"], before["lastDecision"])

    def test_nonflat_or_wrong_owner_state_is_rejected(self):
        for change in (
            {"runtimeSha": "f" * 40},
            {"position": {"symbol": "DOGEUSDT"}},
            {"pending": {"id": "entry"}},
            {"manualReview": "operator"},
            {"schema": "other"},
        ):
            with self.subTest(change=change), self.assertRaisesRegex(ValueError, "IDLE_STATE"):
                recovery.validate_idle_state(idle_state(**change), NOW)

    def test_refresh_never_accepts_future_or_non_integer_time(self):
        for updated in (NOW + 1001, True, "now", None):
            with self.subTest(updated=updated), self.assertRaises(ValueError):
                recovery.validate_idle_state(idle_state(updatedAt=updated), NOW)

    def test_signed_get_contract_requires_flat_account_and_zero_mutations(self):
        valid = {
            "status": "ASTER_READONLY_ACCOUNT_DIAGNOSTIC_PASS",
            "ordersSent": 0,
            "cancelsSent": 0,
            "positionChangesSent": 0,
            "positions": [],
            "openOrders": [],
        }
        self.assertEqual(recovery.validate_flat_signed_get(valid), valid)
        for change in (
            {"ordersSent": 1},
            {"positions": [{"symbol": "DOGEUSDT"}]},
            {"openOrders": [{"symbol": "DOGEUSDT"}]},
            {"status": "OTHER"},
        ):
            with self.subTest(change=change), self.assertRaises(ValueError):
                recovery.validate_flat_signed_get({**valid, **change})


if __name__ == "__main__":
    unittest.main()
