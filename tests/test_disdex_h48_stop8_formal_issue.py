"""No-production tests for H48 STOP8 Root issuance policy and HP redemption lineage."""
import importlib.util
from pathlib import Path
import sys
import unittest

SOURCE = Path(__file__).resolve().parents[1] / "scripts/ops/deploy/disdex_h48_stop8_formal_issue.py"
SPEC = importlib.util.spec_from_file_location("disdex_h48_stop8_formal_issue", SOURCE)
assert SPEC and SPEC.loader
issuer = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = issuer
SPEC.loader.exec_module(issuer)

SHA = "a" * 40
PLAN_SHA = "b" * 64
NOW = 1795680000000
APPROVAL = "11111111-1111-4111-8111-111111111111"
RUN = "45700123000"


def plan():
    return {
        "schema": issuer.PLAN_SCHEMA, "approvedSha": SHA,
        "status": "FINAL_OWNER_HP_SIGNED",
        "deploymentTarget": issuer.DEPLOYMENT_TARGET,
        "scope": issuer.SCOPE, "operation": issuer.OPERATION,
        "ordersEnabled": True, "policy": issuer.POLICY,
        "residentStopRequired": True, "residentTakeProfitRequired": False,
        "stopTriggerPct": 8, "stopOrderType": "STOP_MARKET",
        "stopReduceOnly": True, "gross": issuer.GROSS.copy(),
        "maxEntryNotionalUsd": 250, "maxSlippageBps": 20,
    }


def approval_record():
    return {
        "id": APPROVAL, "operation": issuer.OPERATION, "scope": issuer.SCOPE,
        "targetSha": SHA, "planSha256": PLAN_SHA, "requestActor": issuer.OWNER,
        "ordersEnabled": True, "status": "REDEEMED",
        "redeemedByRunId": RUN,
        "approvalToken": "SIGNED_HP_TOKEN_FOR_THIS_RUN",
        "approvalTokenExpiresAt": NOW // 1000 + 200,
        "createdAt": NOW - 120000, "approvedAt": NOW - 80000,
        "redeemedAt": NOW - 20000, "requestExpiresAt": NOW + 150000,
    }


class Stop8IssuerContractTest(unittest.TestCase):
    def test_exact_stop8_final_plan_only(self):
        self.assertEqual(issuer.expected_plan(plan(), SHA), plan())
        for key, bad in (
            ("status", "DRAFT_NOT_AUTHORIZED"), ("ordersEnabled", False),
            ("policy", "H48_TIME_ONLY"), ("residentStopRequired", False),
            ("stopTriggerPct", 5), ("stopOrderType", "LIMIT"),
            ("gross", {"crypto": 3, "stock": 1.5, "total": 3.5, "hype": 1}),
        ):
            changed = {**plan(), key: bad}
            with self.assertRaisesRegex(ValueError, "FINAL_SIGNED_STOP8_PLAN_INVALID"):
                issuer.expected_plan(changed, SHA)

    def test_owner_hp_redeemed_run_and_source_are_exact(self):
        record = approval_record()
        self.assertEqual(issuer.approved_record([record],
            approval_id=APPROVAL, sha=SHA, plan_hash=PLAN_SHA,
            run_id=RUN, now_ms=NOW), record)
        for key, value in (
            ("status", "APPROVED"), ("scope", "FULL_PROJECT"),
            ("targetSha", "f" * 40), ("planSha256", "f" * 64),
            ("redeemedByRunId", "999"), ("ordersEnabled", False),
        ):
            with self.assertRaisesRegex(ValueError, "APPROVAL_"):
                issuer.approved_record([{**record,key:value}],
                    approval_id=APPROVAL, sha=SHA, plan_hash=PLAN_SHA,
                    run_id=RUN, now_ms=NOW)
        with self.assertRaisesRegex(ValueError, "APPROVAL_NOT_EXACT_ONE"):
            issuer.approved_record([record, record],
                approval_id=APPROVAL, sha=SHA, plan_hash=PLAN_SHA,
                run_id=RUN, now_ms=NOW)

    def test_hp_token_must_match_same_redeemed_run_and_still_be_fresh(self):
        expected = approval_record()
        self.assertEqual(issuer.approved_record([expected],
            approval_id=APPROVAL, sha=SHA, plan_hash=PLAN_SHA,
            run_id=RUN, now_ms=NOW,
            owner_token="SIGNED_HP_TOKEN_FOR_THIS_RUN"), expected)
        for edited in (
            {"approvalToken": "ANOTHER_REDEEMED_RUN_TOKEN"},
            {"approvalTokenExpiresAt": NOW // 1000 - 1},
        ):
            with self.assertRaisesRegex(ValueError, "OWNER_TOKEN_NOT_THE_REDEEMED_APPROVAL"):
                issuer.approved_record([{**expected,**edited}],
                    approval_id=APPROVAL, sha=SHA, plan_hash=PLAN_SHA,
                    run_id=RUN, now_ms=NOW,
                    owner_token="SIGNED_HP_TOKEN_FOR_THIS_RUN")

    def test_redeemed_approval_receipt_timing_is_fresh(self):
        with self.assertRaisesRegex(ValueError, "APPROVAL_EXPIRED_OR_OUT_OF_ORDER"):
            issuer.approved_record([{**approval_record(), "redeemedAt":NOW-600000}],
                approval_id=APPROVAL, sha=SHA, plan_hash=PLAN_SHA,
                run_id=RUN, now_ms=NOW)

    def test_canonical_bundle_never_contains_order_permit(self):
        b = issuer.bundle(sha=SHA,plan_hash=PLAN_SHA,plan=plan(),
            approval_id=APPROVAL,owner_signed_token="SIGNED_TOKEN_PLACEHOLDER",now_ms=NOW)
        self.assertEqual(b["policy"], issuer.POLICY)
        self.assertEqual(b["residentStopRequired"], True)
        self.assertEqual(b["gross"],issuer.GROSS)
        self.assertNotIn("orderPermitIssued",b)
        self.assertNotIn("killSwitchClear",b)
        canonical = issuer.canonical(b)
        self.assertEqual(issuer.load_json(canonical),b)
        self.assertEqual(issuer.canonical(issuer.load_json(canonical)),canonical)

    def test_duplicate_json_and_bad_unsigned_bundle_fail(self):
        with self.assertRaisesRegex(ValueError,"DUPLICATE_JSON_FIELD"):
            issuer.load_json(b'{"approvedSha":"A","approvedSha":"B"}')
        with self.assertRaisesRegex(ValueError,"CERTIFICATE_INPUT_INVALID"):
            issuer.bundle(sha=SHA,plan_hash=PLAN_SHA,plan=plan(),
                approval_id=APPROVAL,owner_signed_token="",now_ms=NOW)

    def test_no_direct_issuance_from_unprivileged_process(self):
        if hasattr(issuer.os,"geteuid") and issuer.os.geteuid()!=0:
            with self.assertRaisesRegex(ValueError,"ROOT_REQUIRED"):
                issuer.formal_issue(sha=SHA,plan_hash=PLAN_SHA,
                    approval_id=APPROVAL,run_id=RUN,
                    owner_token="INVALID",now_ms=NOW)


if __name__=="__main__":
    unittest.main()
