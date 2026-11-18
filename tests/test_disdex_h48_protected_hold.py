import hashlib
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts" / "ops" / "deploy"))
import disdex_h48_protected_hold as hold


NOW = 1_794_987_700_000
KILL_BYTES = b'{"active":true,"action":"HOLD_PROTECTED"}\n'


def receipt(**changes):
    value = {
        "approvedSha": hold.SOURCE,
        "authorizesOrders": False,
        "expiresAt": NOW + 10 * 60_000,
        "issuedAt": NOW - 10 * 60_000,
        "killSwitchPath": hold.KILL_PATH,
        "killSwitchSha256": hashlib.sha256(KILL_BYTES).hexdigest(),
        "planSha256": hold.PLAN,
        "reason": hold.REASON,
        "schema": hold.HOLD_SCHEMA,
        "scope": hold.HOLD_SCOPE,
        "v4Sha": "e788abc82e80f9fc7ab0e1ba83fdb8be267eb513",
    }
    value.update(changes)
    return value


def kill(**changes):
    value = {
        "active": True,
        "action": "HOLD_PROTECTED",
        "scope": "GLOBAL",
        "operator": "disdex-stable4-formal-owner-hold",
        "strategyId": "STABLE4_H48_CUTOVER",
        "recoverable": False,
        "reason": hold.REASON,
    }
    value.update(changes)
    return value


class H48ProtectedHoldTests(unittest.TestCase):
    def test_valid_receipt_is_explicitly_no_order(self):
        result = hold.validate_h48_protected_hold(kill(), receipt(), KILL_BYTES, NOW)
        self.assertFalse(result["ordersEnabled"])
        self.assertFalse(result["authorizesOrders"])
        self.assertFalse(result["expired"])

    def test_expired_receipt_can_only_be_observed_when_explicitly_allowed(self):
        expired = receipt(expiresAt=NOW - 1)
        with self.assertRaisesRegex(ValueError, "RECEIPT_EXPIRED"):
            hold.validate_h48_protected_hold(kill(), expired, KILL_BYTES, NOW)
        result = hold.validate_h48_protected_hold(
            kill(), expired, KILL_BYTES, NOW, allow_expired_observation=True
        )
        self.assertTrue(result["expired"])
        self.assertFalse(result["ordersEnabled"])

    def test_foreign_or_mutated_hold_is_rejected(self):
        for change in (
            {"planSha256": "f" * 64},
            {"authorizesOrders": True},
            {"reason": "OTHER"},
        ):
            with self.subTest(change=change), self.assertRaises(ValueError):
                hold.validate_h48_protected_hold(kill(), receipt(**change), KILL_BYTES, NOW)
        with self.assertRaisesRegex(ValueError, "KILL_HASH_MISMATCH"):
            hold.validate_h48_protected_hold(kill(), receipt(), b"changed", NOW)

    def test_kill_must_remain_global_and_protected(self):
        for change in ({"active": False}, {"scope": "HYPE_TREND_LONG"}, {"recoverable": True}):
            with self.subTest(change=change), self.assertRaisesRegex(ValueError, "KILL_BINDING_INVALID"):
                hold.validate_h48_protected_hold(kill(**change), receipt(), KILL_BYTES, NOW)


if __name__ == "__main__":
    unittest.main()
