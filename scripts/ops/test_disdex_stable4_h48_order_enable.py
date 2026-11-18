"""Unit tests for the fail-closed STABLE4 H48 HYPE-only order-enable helper."""
import hashlib
import json
import unittest
from pathlib import Path

from scripts.ops.deploy import disdex_stable4_h48_order_enable as gate


SOURCE = gate.SOURCE
PLAN = gate.PLAN
APPROVAL_ID = "5ad3c5a3-0833-4d27-bd05-f057ca434efa"
NOW = 1_800_000_000_000


def approval(status="REDEEMED", run_id="44286992278"):
    return {
        "id": APPROVAL_ID,
        "operation": gate.OPERATION,
        "scope": gate.SCOPE,
        "targetSha": SOURCE,
        "planSha256": PLAN,
        "requestActor": "dunamishajime-bit",
        "ordersEnabled": True,
        "status": status,
        "redeemedByRunId": run_id,
        "createdAt": NOW - 20_000,
        "approvedAt": NOW - 10_000,
        "redeemedAt": NOW - 5_000,
        "requestExpiresAt": NOW + 1_000,
    }


def hold():
    return {
        "active": True,
        "action": "HOLD_PROTECTED",
        "scope": "GLOBAL",
        "operator": "disdex-stable4-formal-owner-hold",
        "strategyId": "STABLE4_H48_CUTOVER",
        "reason": "STABLE4_RESEARCH_ROLLOUT:" + SOURCE,
    }


class HypeH48OrderEnableTests(unittest.TestCase):
    def test_exact_redeemed_hype_approval_is_required(self):
        self.assertEqual(
            gate.validate_approval_record(approval(), approval_id=APPROVAL_ID,
                                          run_id="44286992278", now_ms=NOW)["id"],
            APPROVAL_ID,
        )
        for diff in (
            {"scope": "FULL_PROJECT"},
            {"operation": "ALL_RUNNERS_ORDER_ENABLE"},
            {"ordersEnabled": False},
            {"status": "APPROVED"},
            {"redeemedByRunId": "1"},
        ):
            row = approval()
            row.update(diff)
            with self.assertRaises(ValueError):
                gate.validate_approval_record(row, approval_id=APPROVAL_ID,
                                              run_id="44286992278", now_ms=NOW)

    def test_protected_hold_is_exact_and_hash_bound(self):
        raw = json.dumps(hold(), sort_keys=True, separators=(",", ":")).encode()
        digest = hashlib.sha256(raw).hexdigest()
        self.assertEqual(gate.validate_global_hold(hold(), raw, now_ms=NOW), digest)
        for diff in ({"active": False}, {"scope": "V52_REFERENCE_ONLY"},
                     {"action": "FLATTEN_MANAGED"}, {"strategyId": "OTHER"}):
            value = hold()
            value.update(diff)
            bad = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
            with self.assertRaises(ValueError):
                gate.validate_global_hold(value, bad, now_ms=NOW)

    def test_permit_is_root_bound_and_zero_mutation(self):
        row = gate.build_hype_permit(
            approval_record=approval(),
            kill_switch=hold(),
            kill_switch_sha256="b" * 64,
            certificate_sha256="a" * 64,
            nonce_sha256="c" * 64,
            issued_at=NOW,
            expires_at=NOW + 86_400_000,
        )
        self.assertEqual(row["scope"], gate.SCOPE)
        self.assertTrue(row["ordersEnabled"])
        self.assertEqual((row["ordersSent"], row["cancelsSent"], row["positionChangesSent"]), (0, 0, 0))
        with self.assertRaises(ValueError):
            gate.validate_permit({**row, "scope": "FULL_PROJECT"}, now_ms=NOW + 1,
                                 kill_switch=hold(), kill_switch_sha256="b" * 64,
                                 certificate_sha256="a" * 64)

    def test_staged_publication_rolls_back_on_post_validation_failure(self):
        directory = Path.cwd() / ".tmp" / "h48-order-enable-test"
        directory.mkdir(parents=True, exist_ok=True)
        target = directory / "permit.json"
        original = b'{"old":true}\n'
        try:
            target.write_bytes(original)
            with self.assertRaises(RuntimeError):
                gate.publish_permit_transaction(target, b'{"new":true}\n',
                                                post_validate=lambda: (_ for _ in ()).throw(RuntimeError("reject")))
            self.assertEqual(target.read_bytes(), original)
        finally:
            try:
                target.chmod(0o644)
                target.unlink()
            except FileNotFoundError:
                pass

    def test_overlay_is_hype_symbol_and_live_stable4_only(self):
        base = (b'import { readSharedKillSwitch } from "./disdex-shared-kill-switch";\n'
                b'  async gate(signal:any) {\n'
                b'    if (!kill.active) return;\n'
                b'    const reason = "HYPE_ZEC_SHARED_KILL_SWITCH_ACTIVE";\n'
                b'  }\n')
        previous = gate.BASE_SOURCE_SHA256
        gate.BASE_SOURCE_SHA256 = hashlib.sha256(base).hexdigest()
        try:
            patched = gate.build_hype_source_overlay(base, "/overlay/hype-h48-order-permit.ts").decode()
        finally:
            gate.BASE_SOURCE_SHA256 = previous
        self.assertIn('hasValidHypeH48OrderPermit', patched)
        self.assertIn('signal.symbol === "HYPEUSDT"', patched)
        self.assertIn('runtime.signalMode === "STABLE4"', patched)
        self.assertIn('runtime.stable4Mode === "LIVE"', patched)
        self.assertEqual(patched.count("HYPE_ZEC_SHARED_KILL_SWITCH_ACTIVE"), 1)


if __name__ == "__main__":
    unittest.main()
