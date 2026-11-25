"""Fail-closed STABLE4 GLOBAL protected HOLD tests (no live mutations)."""
from datetime import datetime
import hashlib
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent / "deploy"))
import disdex_stable4_global_hold_formal_arm as hold
import disdex_stable4_h48_formal_issue as owner

NOW = 1794907879124
V4 = "e788abc82e80f9fc7ab0e1ba83fdb8be267eb513"


def old_kill():
    return {"active": False, "action": "HOLD_PROTECTED", "scope": "GLOBAL",
            "operator": "disdex-v52-aster-only", "reason": "V52 incident recovered",
            "strategyId": "OLD_RUNNER",
            "clearancePlanSha256": "f"*64, "recoveredAt": NOW-1000,
            "recoverable": False}


def existing_stable4_hold():
    return {
        "active": True,
        "action": "HOLD_PROTECTED",
        "scope": "GLOBAL",
        "operator": hold.OPERATOR,
        "strategyId": hold.STRATEGY,
        "recoverable": False,
        "reason": hold.REASON,
        "previousReason": "V52 FET owner mismatch recovered by incident-scoped root authorization",
        "activatedAt": "2026-11-17T10:48:29.132+00:00",
        "graceStartedAt": "2026-11-17T10:48:29.132+00:00",
        "graceDeadlineAt": "2026-11-17T10:58:29.132+00:00",
    }


class GlobalOwnerProtectedHoldTests(unittest.TestCase):
    def test_accepts_existing_active_stable4_hold_as_already_protected(self):
        row = hold.validate_existing_active_hold(existing_stable4_hold())
        self.assertTrue(row["active"])
        self.assertEqual(row["reason"], hold.REASON)

    def test_accepts_existing_active_hold_from_prior_stable4_rollout_sha(self):
        legacy = {**existing_stable4_hold(),
                  "reason": "STABLE4_RESEARCH_ROLLOUT:e0e4f1d8f22b62e9410188ef6e590a20e31f760f"}
        row = hold.validate_existing_active_hold(legacy)
        self.assertTrue(row["active"])
        self.assertEqual(row["reason"], legacy["reason"])

    def test_rejects_active_hold_with_different_owner_or_reason(self):
        for change in ({"operator": "other"}, {"reason": "OTHER_INCIDENT"},
                       {"recoverable": True}, {"strategyId": "OTHER"}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                hold.validate_existing_active_hold({**existing_stable4_hold(), **change})

    def test_rearms_only_existing_inactive_global_protected_hold(self):
        row = hold.protected_hold(old_kill(), NOW)
        self.assertEqual(row["active"], True)
        self.assertEqual(row["action"], "HOLD_PROTECTED")
        self.assertEqual(row["scope"], "GLOBAL")
        self.assertEqual(row["reason"], "STABLE4_RESEARCH_ROLLOUT:" + owner.SOURCE)
        self.assertEqual(row["operator"], hold.OPERATOR)
        self.assertEqual(row["recoverable"], False)
        self.assertEqual(row["previousReason"], old_kill()["reason"])
        self.assertNotIn("clearancePlanSha256", row)
        self.assertNotIn("recoveredAt", row)
        self.assertEqual((datetime.fromisoformat(row["graceDeadlineAt"]) -
                          datetime.fromisoformat(row["graceStartedAt"])).total_seconds(), 600)

    def test_rejects_foreign_active_hold_and_flatten_kill(self):
        for change in (
            {"active": True}, {"action": "FLATTEN_MANAGED"},
            {"action": "UNKNOWN"}, {"scope": "V52_REFERENCE_ONLY"},
            {"scope": None}, {"reason": ""}, {"reason": None},
        ):
            with self.subTest(change=change), self.assertRaises(ValueError):
                hold.protected_hold({**old_kill(), **change}, NOW)

    def test_protected_hold_receipt_matches_existing_stable4_contract(self):
        new = owner.canonical(hold.protected_hold(old_kill(), NOW))
        receipt = hold.protected_hold_receipt(NOW, V4, new)
        self.assertEqual(set(receipt), {
            "schema", "planSha256", "approvedSha", "v4Sha", "killSwitchPath",
            "killSwitchSha256", "reason", "issuedAt", "expiresAt",
            "scope", "authorizesOrders",
        })
        self.assertEqual(receipt["approvedSha"], owner.SOURCE)
        self.assertEqual(receipt["planSha256"], owner.PLAN)
        self.assertEqual(receipt["v4Sha"], V4)
        self.assertFalse(receipt["authorizesOrders"])
        self.assertGreater(receipt["expiresAt"], NOW)
        self.assertLessEqual(receipt["expiresAt"] - NOW, 3600000)

    def test_receipt_preserves_observed_legacy_hold_reason(self):
        legacy = {**existing_stable4_hold(),
                  "reason": "STABLE4_RESEARCH_ROLLOUT:e0e4f1d8f22b62e9410188ef6e590a20e31f760f"}
        raw = owner.canonical(legacy)
        receipt = hold.protected_hold_receipt(NOW, V4, raw)
        self.assertEqual(receipt["approvedSha"], owner.SOURCE)
        self.assertEqual(receipt["reason"], legacy["reason"])
        self.assertNotEqual(receipt["reason"], hold.REASON)
        self.assertEqual(receipt["killSwitchSha256"], hashlib.sha256(raw).hexdigest())
        self.assertFalse(receipt["authorizesOrders"])

    def test_receipt_rejects_untrusted_or_unprotected_kill_bytes(self):
        for raw in (b"not json", owner.canonical(old_kill()),
                    owner.canonical({**existing_stable4_hold(), "reason": "INVALID"})):
            with self.subTest(raw=raw[:35]), self.assertRaises(ValueError):
                hold.protected_hold_receipt(NOW, V4, raw)

    def test_current_run_receipt_path_is_supported_for_idempotent_reuse(self):
        import inspect
        source = inspect.getsource(hold.validate_root_receipt)
        self.assertIn("owner.SOURCE + \".\" + run_id + \".json\"", source)
        self.assertIn("ROOT_RECEIPT_SYMLINK_FORBIDDEN", source)
        self.assertIn("certificate_digest", source)

    def test_kill_change_cannot_be_called_without_signature_and_root_receipt(self):
        import inspect
        f = inspect.getsource(hold.guarded_arm)
        self.assertIn("owner.validate_token(token", f)
        self.assertIn("validate_root_receipt(approval_id, run_id", f)
        self.assertIn("owner.approved_record", f)
        self.assertIn("owner.ROOT /", f)
        self.assertIn("os.replace(new_path, KILL)", f)
        self.assertNotIn("systemctl", f)
        self.assertNotIn("ASTER_API_PRIVATE_KEY", f)
        self.assertNotIn("clearKillSwitch", f)

    def test_wrong_v4_source_and_zero_time_rejected(self):
        with self.assertRaises(ValueError):
            hold.protected_hold_receipt(NOW, "a", b"state")
        with self.assertRaises(ValueError):
            hold.protected_hold_receipt(True, V4, b"state")


if __name__ == "__main__":
    unittest.main()

