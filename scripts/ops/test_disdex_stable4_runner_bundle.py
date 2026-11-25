"""Non-production contracts for the six-Runner Owner approval bundle."""
import hashlib
import json
import unittest

from scripts.ops.deploy import disdex_runner_scoped_order_enable as gate
from scripts.ops.deploy import disdex_deployment_contract as contract


APPROVAL_ID = "5ad3c5a3-0833-4d27-bd05-f057ca434efa"
RUN_ID = "44330000001"
NOW = 1_800_000_000_000


def bundle_approval(status="REDEEMED", run_id=RUN_ID):
    return {
        "id": APPROVAL_ID,
        "operation": gate.BUNDLE_OPERATION,
        "scope": gate.BUNDLE_SCOPE,
        "targetSha": gate.BUNDLE_SOURCE_SHA,
        "planSha256": gate.BUNDLE_PLAN_SHA256,
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
        "reason": "STABLE4_RESEARCH_ROLLOUT:e0e4f1d8f22b62e9410188ef6e590a20e31f760f",
    }


class Stable4RunnerBundleTests(unittest.TestCase):
    def test_bundle_scope_is_allowed_by_owner_signature_contract(self):
        self.assertIn(gate.BUNDLE_SCOPE, contract.SCOPES)
        contract.validate_order_permission(gate.BUNDLE_SCOPE, True)

    def test_manifest_is_exactly_six_and_excludes_hype(self):
        self.assertEqual(len(gate.BUNDLE_ENTRIES), 6)
        self.assertEqual(
            [entry["runner"] for entry in gate.BUNDLE_ENTRIES],
            ["FET_BRK48_RESIDUAL", "IDLE_PRIORITY_SHORT", "PENGU_V8",
             "QUALITY102_CAUSAL_V1", "V12_V4", "V52"],
        )
        self.assertNotIn("HYPE_TREND_LONG", [entry["runner"] for entry in gate.BUNDLE_ENTRIES])
        self.assertTrue(all(entry["operation"] == entry["runner"] + "_SCOPED_ORDER_ENABLE"
                            for entry in gate.BUNDLE_ENTRIES))
        self.assertEqual(gate.BUNDLE_SOURCE_SHA, "4786f600ae7bf86ffca948f1412956a9113cb20d")
        self.assertEqual(gate.BUNDLE_PLAN_SHA256,
                         "678428fdd874ce0bfe1f10f31dfec3f6fde0a027931082a195404c9c462dfbf1")
        self.assertTrue(all(entry["sourceSha"] == gate.BUNDLE_SOURCE_SHA for entry in gate.BUNDLE_ENTRIES))
        self.assertTrue(all(entry["planSha256"] ==
                            "568cf8f66490de5639ce2c5a8b14db385be922f1dde8d9079d3ca30022057712"
                            for entry in gate.BUNDLE_ENTRIES))

    def test_bundle_approval_is_single_exact_identity(self):
        row = gate.validate_bundle_approval_record(
            bundle_approval(), approval_id=APPROVAL_ID, run_id=RUN_ID, now_ms=NOW,
        )
        self.assertEqual(row["operation"], gate.BUNDLE_OPERATION)
        for diff in ({"scope": "FULL_PROJECT"}, {"ordersEnabled": False}, {"status": "APPROVED"}):
            bad = bundle_approval()
            bad.update(diff)
            with self.assertRaises(ValueError):
                gate.validate_bundle_approval_record(
                    bad, approval_id=APPROVAL_ID, run_id=RUN_ID, now_ms=NOW,
                )

    def test_child_permits_keep_runner_plan_and_zero_mutations(self):
        row = bundle_approval()
        entry = next(item for item in gate.BUNDLE_ENTRIES if item["runner"] == "PENGU_V8")
        raw = json.dumps(hold(), sort_keys=True, separators=(",", ":")).encode()
        digest = hashlib.sha256(raw).hexdigest()
        permit = gate.build_runner_permit(
            approval_record=row, runner=entry["runner"], source_sha=entry["sourceSha"],
            plan_sha256=entry["planSha256"], scope=entry["scope"], operation=entry["operation"],
            kill_switch=hold(), kill_switch_sha256=digest, nonce_sha256="c" * 64,
            issued_at=NOW, expires_at=NOW + 86_400_000,
        )
        self.assertEqual(permit["approvalId"], APPROVAL_ID)
        self.assertEqual(permit["planSha256"], entry["planSha256"])
        self.assertEqual((permit["ordersSent"], permit["cancelsSent"], permit["positionChangesSent"]), (0, 0, 0))

    def test_readiness_summary_blocks_without_approval_or_mutation_fields(self):
        rows = [
            {"runner": entry["runner"], "status": "READY"}
            for entry in gate.BUNDLE_ENTRIES
        ]
        rows[0]["status"] = "BLOCKED"
        rows[0]["reason"] = "RUNNER_UNIT_NOT_ACTIVE"
        result = gate._bundle_readiness_summary(rows)
        self.assertEqual(result["status"], "RUNNER_READINESS_PREFLIGHT_BLOCKED")
        self.assertEqual(result["blockedRunners"], [gate.BUNDLE_ENTRIES[0]["runner"]])
        self.assertEqual((result["ordersSent"], result["cancelsSent"], result["positionChangesSent"]), (0, 0, 0))
        self.assertNotIn("approvalId", result)
        self.assertNotIn("token", result)

if __name__ == "__main__":
    unittest.main()

