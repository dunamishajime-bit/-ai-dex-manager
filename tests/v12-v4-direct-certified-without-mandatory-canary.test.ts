import assert from "node:assert/strict";
import test from "node:test";
import { validateV4ProductionCertificate } from "../lib/v12-v4-certified-gates";
import { V12_V4_V2_POLICY } from "../lib/v12-v4-v2-shadow";
import { PRODUCTION_EXIT_CATALOG } from "../lib/v12-v4-production-lifecycle";

const sha = "a".repeat(40);
const now = Date.parse("2026-10-19T04:00:00Z");
const evidenceSha256 = Object.fromEntries(
  ["routeSourceParity", "establishedAsterOrders", "signedAsterAccount", "v4ExecutionTests", "sharedRiskAndPeers"]
    .map((key) => [key, "b".repeat(64)]),
);

function currentV3Fixture() {
  return {
    schema: "disdex-v12-v4-production-certification/v3",
    approvedSha: sha,
    policyId: V12_V4_V2_POLICY,
    approvedAt: new Date(now - 60_000).toISOString(),
    validUntil: new Date(now + 86_400_000).toISOString(),
    verifiedRoutes: PRODUCTION_EXIT_CATALOG.map((route) => route.route),
    venueEvidenceBasis: "ESTABLISHED_ASTER_PRODUCTION_EXECUTION",
    evidenceSha256,
    approvedGross: { v12: 3, crypto: 3.5, total: 4.75, recovery: 2.5 },
    risksAcknowledged: {
      v4FirstLiveFillNotYetObserved: true,
      weakIndependentForwardPerformance: true,
    },
    operatorAcknowledgement: "I_AUTHORIZE_CERTIFIED_V12_V4_REAL_ORDERS",
  };
}

test("V3 source validation does not require a preceding V4 canary fill or Testnet", () => {
  const validated = validateV4ProductionCertificate(currentV3Fixture(), sha, now);
  assert.equal(validated.schema, "disdex-v12-v4-production-certification/v3");
  assert.equal(validated.venueEvidenceBasis, "ESTABLISHED_ASTER_PRODUCTION_EXECUTION");
  assert.equal(validated.risksAcknowledged.v4FirstLiveFillNotYetObserved, true);
  // Source validation is not root-file hashing, risk reconciliation or LIVE approval.
});

test("V3 cannot certify an obsolete production SHA or stale certificate", () => {
  assert.throws(
    () => validateV4ProductionCertificate(currentV3Fixture(), "c".repeat(40), now),
    /V4_SHARED_EXECUTION_CERTIFICATE_INVALID/,
  );
  assert.throws(
    () => validateV4ProductionCertificate(currentV3Fixture(), sha, now + 2 * 86_400_000),
    /V4_CERTIFICATE_EXPIRED_OR_FUTURE/,
  );
});

test("V3 still requires all 41 routes, correct provenance and exact risk envelope", () => {
  const proof = currentV3Fixture();
  assert.equal(proof.verifiedRoutes.length, 41);
  assert.throws(
    () => validateV4ProductionCertificate({ ...proof, verifiedRoutes: proof.verifiedRoutes.slice(1) }, sha, now),
    /V4_ALL_41_ROUTE_PROOF_REQUIRED/,
  );
  assert.throws(
    () => validateV4ProductionCertificate({ ...proof, venueEvidenceBasis: "NO_VENUE_EVIDENCE" }, sha, now),
    /V4_SHARED_EXECUTION_CERTIFICATE_INVALID/,
  );
  assert.throws(
    () => validateV4ProductionCertificate({ ...proof, approvedGross: { v12: 2, crypto: 3, total: 4.25, recovery: 2.5 } }, sha, now),
    /V4_SHARED_RISK_CAP_MISMATCH/,
  );
});
