import assert from "node:assert/strict";
import test from "node:test";
import {
  EVIDENCE_CLASSES,
  classifyV4EvidenceRefresh,
  inspectV4EvidenceExpiry,
} from "../scripts/ops/root/disdex-v12-v4-evidence-preflight.mjs";

const SHA = "a".repeat(40);
const NOW = Date.parse("2026-10-30T00:00:00.000Z");

function payloads(overrides = {}) {
  const capturedAt = new Date(NOW - 18 * 60 * 60 * 1000).toISOString();
  return {
    routeSourceParity: {
      status: "PASS", candidateSha: SHA, capturedAt, routeCount: 41, sourceParity: true,
    },
    establishedAsterOrders: {
      status: "PASS", candidateSha: SHA, capturedAt, readOnly: true, mutationCalls: 0,
    },
    signedAsterAccount: {
      status: "PASS", candidateSha: SHA, capturedAt, readOnly: true, signedGet: true, mutationCalls: 0,
    },
    v4ExecutionTests: {
      status: "PASS", candidateSha: SHA, capturedAt, testPasses: 206, failCount: 0, typecheck: true,
    },
    sharedRiskAndPeers: {
      status: "PASS", candidateSha: SHA, capturedAt, sharedRiskHealthy: true,
      marginGuardHealthy: true, killSwitch: false, pendingCount: 0,
    },
    ...overrides,
  };
}

test("the five proofs are separated into immutable release and dynamic account/risk classes", () => {
  assert.deepEqual(EVIDENCE_CLASSES.STATIC, ["routeSourceParity", "v4ExecutionTests"]);
  assert.deepEqual(EVIDENCE_CLASSES.DYNAMIC, ["establishedAsterOrders", "signedAsterAccount", "sharedRiskAndPeers"]);
  const result = classifyV4EvidenceRefresh({ sha: SHA, payloads: payloads(), now: NOW });
  assert.deepEqual(result.staticKeys, EVIDENCE_CLASSES.STATIC);
  assert.deepEqual(result.dynamicKeys, EVIDENCE_CLASSES.DYNAMIC);
  assert.deepEqual(result.refreshRequired, EVIDENCE_CLASSES.DYNAMIC);
  assert.deepEqual(result.staticAction, "REUSE_SHA_BOUND_RELEASE_PROOF");
});

test("old static release proofs do not make V4 stop, but dynamic proofs still expire at 24 hours", () => {
  const result = inspectV4EvidenceExpiry({ sha: SHA, payloads: payloads(), now: NOW });
  assert.equal(result.status, "EXPIRING_SOON");
  assert.deepEqual(result.evidence.find((row) => row.key === "routeSourceParity"), {
    key: "routeSourceParity",
    class: "STATIC_RELEASE",
    capturedAt: "2026-10-29T06:00:00.000Z",
    expiresAt: null,
    remainingMs: null,
    refreshRequired: false,
  });
  assert.ok(result.evidence.filter((row) => row.class === "DYNAMIC_ACCOUNT_RISK").every((row) => row.remainingMs === 6 * 60 * 60 * 1000));
});

test("refresh planning never authorizes orders and refuses a static proof refresh", () => {
  const plan = classifyV4EvidenceRefresh({ sha: SHA, payloads: payloads(), now: NOW });
  assert.equal(plan.authorizesTrading, false);
  assert.equal(plan.readOnly, true);
  assert.throws(() => plan.assertRefreshAllowed("routeSourceParity"), /STATIC_RELEASE_PROOF_REFRESH_FORBIDDEN/);
  assert.doesNotThrow(() => plan.assertRefreshAllowed("signedAsterAccount"));
});

test("future and SHA-mismatched proofs remain fail closed", () => {
  assert.throws(() => classifyV4EvidenceRefresh({
    sha: SHA,
    payloads: payloads({ signedAsterAccount: { ...payloads().signedAsterAccount, candidateSha: "b".repeat(40) } }),
    now: NOW,
  }), /CANDIDATE_SHA_MISMATCH/);
  assert.throws(() => classifyV4EvidenceRefresh({
    sha: SHA,
    payloads: payloads({ signedAsterAccount: { ...payloads().signedAsterAccount, capturedAt: new Date(NOW + 6 * 60_000).toISOString() } }),
    now: NOW,
  }), /TIMESTAMP_INVALID/);
});
