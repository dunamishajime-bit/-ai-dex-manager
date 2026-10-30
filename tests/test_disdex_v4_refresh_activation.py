"""Owner-to-refresh-lease boundary tests; no real key or VPS access."""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts" / "ops" / "deploy"))

from disdex_v4_evidence_refresh_activation import (  # noqa: E402
    REFRESH_SCOPE,
    build_refresh_lease,
    require_fresh_refresh_approval,
    refresh_plan_sha256,
    validate_refresh_lease,
)


SHA = "a" * 40
NOW = 2_000_000_000


def approval(**overrides):
    value = {
        "schema": "disdex-owner-deployment-approval/v2",
        "repository": "dunamishajime-bit/-ai-dex-manager",
        "deploymentTarget": "professional-dismanager.net",
        "operatorTarget": "DD1296_FINAL_ALLIN_10BPS",
        "route": "CODEX_SSH",
        "sourceSha": SHA,
        "scope": REFRESH_SCOPE,
        "operator": "owner",
        "nonce": "b" * 32,
        "issuedAt": NOW - 30,
        "expiresAt": NOW + 270,
        "planSha256": refresh_plan_sha256(SHA),
        "ordersEnabled": False,
    }
    value.update(overrides)
    return value


class RefreshLeaseTest(unittest.TestCase):
    def test_owner_verified_approval_derives_exact_refresh_lease(self):
        result = build_refresh_lease(approval(), now=NOW)
        self.assertEqual(result["schema"], "disdex-v4-evidence-refresh-lease/v1")
        self.assertEqual(result["scope"], REFRESH_SCOPE)
        self.assertEqual(result["approvedSha"], SHA)
        self.assertEqual(result["approvedShaByRunner"], {"V12_V4": SHA})
        self.assertFalse(result["ordersEnabled"])
        self.assertTrue(result["signatureVerified"])
        self.assertNotIn("signature", result)
        self.assertEqual(result["approvalIssuedAt"], NOW - 30)

    def test_lease_validation_rejects_scope_expansion_and_expiry(self):
        result = build_refresh_lease(approval(), now=NOW)
        validate_refresh_lease(result, sha=SHA, now=NOW)
        with self.assertRaisesRegex(ValueError, "scope"):
            validate_refresh_lease({**result, "scope": "FULL_PROJECT"}, sha=SHA, now=NOW)
        with self.assertRaisesRegex(ValueError, "orders"):
            validate_refresh_lease({**result, "ordersEnabled": True}, sha=SHA, now=NOW)
        with self.assertRaisesRegex(ValueError, "expired"):
            validate_refresh_lease({**result, "expiresAt": NOW - 1}, sha=SHA, now=NOW)

    def test_approval_plan_is_not_a_free_form_hash(self):
        with self.assertRaisesRegex(ValueError, "plan"):
            build_refresh_lease(approval(planSha256="c" * 64), now=NOW)

    def test_expired_lease_can_be_validated_only_for_safe_replacement(self):
        active = build_refresh_lease(approval(), now=NOW)
        validate_refresh_lease(active, sha=SHA, now=NOW)
        expired = {**active, "approvedAt": NOW - 2, "expiresAt": NOW - 1}
        validate_refresh_lease(expired, sha=SHA, now=NOW, allow_expired=True)
        with self.assertRaisesRegex(ValueError, "expired"):
            validate_refresh_lease(expired, sha=SHA, now=NOW, allow_expired=False)

    def test_lease_schema_rejects_extra_fields(self):
        active = build_refresh_lease(approval(), now=NOW)
        with self.assertRaisesRegex(ValueError, "schema"):
            validate_refresh_lease({**active, "unexpected": True}, sha=SHA, now=NOW)

    def test_expired_lease_requires_a_fresh_owner_nonce(self):
        previous = build_refresh_lease(approval(), now=NOW)
        with self.assertRaisesRegex(ValueError, "nonce reused"):
            require_fresh_refresh_approval(previous, approval())

    def test_expired_lease_replacement_publishes_only_a_fresh_nonce(self):
        previous = build_refresh_lease(approval(), now=NOW)
        fresh = approval(nonce="c" * 32)
        self.assertIsNone(require_fresh_refresh_approval(previous, fresh))
        renewed = build_refresh_lease(fresh, now=NOW)
        self.assertNotEqual(
            renewed["approvalNonceDigest"], previous["approvalNonceDigest"],
        )


if __name__ == "__main__":
    unittest.main()
