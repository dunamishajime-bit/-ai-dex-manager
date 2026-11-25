"""Regression tests for STABLE4 policy issuance: no live files, no orders."""
import copy
import importlib.util
import json
from pathlib import Path
import sys
import unittest

HERE = Path(__file__).resolve().parents[0] / "deploy"
sys.path.insert(0, str(HERE))
import disdex_stable4_h48_formal_issue as gate

NOW = 1794907879124
APPROVAL = "9ae68788-91df-44ac-b616-beb076cf65ff"
RUN = "44053153275"


def hp_record():
    return {
        "id": APPROVAL, "operation": gate.OPERATION, "scope": "HYPE_TREND_LONG",
        "targetSha": gate.SOURCE, "planSha256": gate.PLAN,
        "requestActor": "dunamishajime-bit", "ordersEnabled": True,
        "status": "REDEEMED", "redeemedByRunId": RUN,
        "createdAt": NOW - 15 * 60000, "approvedAt": NOW - 10 * 60000,
        "redeemedAt": NOW - 2 * 60000, "requestExpiresAt": NOW + 15 * 60000,
    }


class H48FormalOwnerTests(unittest.TestCase):
    def test_exact_hp_owner_approved_and_redeemed_run(self):
        self.assertEqual(gate.approved_record([hp_record()], approval_id=APPROVAL,
                                              run_id=RUN, now_ms=NOW)["status"], "REDEEMED")

    def test_incorrect_owner_status_operation_scope_sha_plan_or_run_fails_closed(self):
        for changes in (
            {"status": "APPROVED"}, {"status": "EXPIRED"},
            {"operation": "HYPE_TREND_LONG_SHA_RESTORE"},
            {"scope": "FULL_PROJECT"}, {"targetSha": "0" * 40},
            {"planSha256": "0" * 64}, {"requestActor": "not-owner"},
            {"ordersEnabled": False}, {"redeemedByRunId": "99999999999"},
            {"approvedAt": None}, {"requestExpiresAt": NOW - 12 * 60000},
            {"redeemedAt": NOW + 60000}, {"createdAt": NOW + 1},
        ):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                gate.approved_record([{**hp_record(), **changes}],
                                     approval_id=APPROVAL, run_id=RUN, now_ms=NOW)

    def test_duplicate_records_and_wrong_workflow_run_rejected(self):
        with self.assertRaises(ValueError):
            gate.approved_record([hp_record(), hp_record()], approval_id=APPROVAL,
                                 run_id=RUN, now_ms=NOW)
        with self.assertRaises(ValueError):
            gate.approved_record([hp_record()], approval_id=APPROVAL,
                                 run_id="1", now_ms=NOW)
        with self.assertRaises(ValueError):
            gate.approved_record([hp_record()], approval_id="other",
                                 run_id=RUN, now_ms=NOW)

    def test_explicit_h48_only_policy_document_without_stop_exemption_scope_leak(self):
        row = gate.certificate(NOW)
        self.assertEqual(set(row), {
            "schema","approvedSha","researchSha","planSha256","deploymentTarget",
            "policy","route","symbol","side","holdHours","entryGridHours",
            "residentStopRequired","residentTakeProfitRequired","approvedGross",
            "issuedAt","expiresAt","operatorAcknowledgement","authorizesOtherPolicies",
        })
        self.assertEqual(row["approvedSha"], gate.SOURCE)
        self.assertEqual(row["planSha256"], gate.PLAN)
        self.assertEqual(row["holdHours"], 48)
        self.assertEqual(row["entryGridHours"], 6)
        self.assertIs(row["residentStopRequired"], False)
        self.assertIs(row["residentTakeProfitRequired"], False)
        self.assertIs(row["authorizesOtherPolicies"], False)
        self.assertEqual(row["approvedGross"],
                         {"crypto": 3, "stock": 4, "total": 4.25, "hype": 1.5})
        self.assertEqual(row["issuedAt"], NOW)
        self.assertGreater(row["expiresAt"], NOW + 48 * 3600000)
        self.assertEqual(json.loads(gate.canonical(row)), row)

    def test_signature_verifier_path_is_fixed_and_caller_does_not_provide_key(self):
        import inspect
        code = inspect.getsource(gate.validate_token)
        self.assertIn("from disdex_owner_approval import verify", code)
        self.assertIn("nonce_dir=None", code)
        self.assertIn('route="GITHUB_ACTIONS"', code)
        self.assertIn("PUBKEY", code)
        self.assertNotIn("private_key", code)
        self.assertNotIn("issueDeploymentApprovalToken", code)

    def test_runtime_verifier_dependency_is_root_immutable_and_pinned(self):
        import inspect
        import re
        source = inspect.getsource(gate.validate_pinned_policy)
        self.assertIn("RUNTIME_OWNERSHIP_MODULE", source)
        self.assertIn("owner=0", source)
        self.assertIn("no_write=True", source)
        self.assertRegex(gate.RUNTIME_OWNERSHIP_MODULE_SHA256, r"^[0-9a-f]{64}$")

    def test_preflight_and_issue_are_separate(self):
        import inspect
        source = inspect.getsource(gate.main)
        self.assertIn("args.preflight_readonly != args.issue", source)
        self.assertIn("verify_preflight", source)
        self.assertIn("issue(args.approval_id, args.run_id, token)", source)
        self.assertNotIn("KillSwitch", inspect.getsource(gate.issue))
        self.assertNotIn("systemctl", inspect.getsource(gate.issue))


    def test_existing_certificate_reuse_is_candidate_and_plan_bound(self):
        import inspect
        source = inspect.getsource(gate.load_existing_certificate)
        self.assertIn("CERTIFICATE_EXISTING_SHA_MISMATCH", source)
        self.assertIn("CERTIFICATE_EXISTING_PLAN_MISMATCH", source)
        self.assertIn("CERTIFICATE_EXISTING_RECEIPT_DIGEST_MISMATCH", source)
        self.assertIn("CERTIFICATE_EXISTING_RECEIPT_MUTATION", source)
        self.assertIn("validate_pinned_policy(row, now_ms)", source)

    def test_idempotent_issue_remains_non_live_and_mutation_free(self):
        import inspect
        source = inspect.getsource(gate.issue)
        self.assertIn("load_existing_certificate(now_ms)", source)
        self.assertIn('"idempotent": True', source)
        self.assertIn('"ordersSent": 0', source)
        self.assertIn('"positionChangesSent": 0', source)

    def test_idempotent_reuse_rebinds_current_run_without_live_authority(self):
        import inspect
        source = inspect.getsource(gate.issue)
        self.assertIn("current_receipt_path(run_id)", source)
        self.assertIn("install_exact_file(receipt_path", source)
        self.assertIn('"receiptSha256"', source)
        self.assertIn('"ordersSent": 0', source)
        self.assertIn('"cancelsSent": 0', source)
        self.assertIn('"positionChangesSent": 0', source)


if __name__ == "__main__":
    unittest.main()

