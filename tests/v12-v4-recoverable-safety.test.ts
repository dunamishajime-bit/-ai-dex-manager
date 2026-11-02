import assert from "node:assert/strict";
import test from "node:test";
import {
  buildV4HealthPayload,
  classifyV4RecoverableSafetyFailure,
} from "../scripts/v12-v4-production-runner";

test("expired dynamic evidence stays alive with orders blocked", () => {
  const result = classifyV4RecoverableSafetyFailure(new Error("V4_EVIDENCE_STALE:signedAsterAccount"), 10_000);
  assert.deepEqual(result, {
    status: "blocked",
    reason: "V4_EVIDENCE_REFRESH_REQUIRED:V4_EVIDENCE_STALE:signedAsterAccount",
    eventTs: 10_000,
    candidateCount: 0,
    orderEnabled: false,
  });
  const health = buildV4HealthPayload(
    "a".repeat(40),
    "CERTIFIED",
    result,
    10_000,
    11_000,
  );
  assert.equal(health.processState, "RUNNING");
  assert.equal(health.processAlive, true);
  assert.equal(health.liveEnabled, true);
  assert.equal(health.safetyState, "BLOCKED");
  assert.equal(health.ordersAllowed, false);
  assert.equal(health.orderPermission, "BLOCKED");
});

test("temporary read-only network failures stay blocked and retryable", () => {
  for (const reason of [
    "Aster request timeout after 10000ms",
    "ECONNRESET while reading signed account",
    "ETIMEDOUT",
    "fetch failed: EAI_AGAIN",
  ]) {
    const result = classifyV4RecoverableSafetyFailure(new Error(reason), 20_000);
    assert.equal(result?.status, "blocked", reason);
    assert.equal(result?.orderEnabled, false, reason);
    assert.match(result?.reason ?? "", /RETRY/);
  }
});

test("an unavailable exact-SHA peer keeps V4 alive but never grants order permission", () => {
  const result = classifyV4RecoverableSafetyFailure(
    new Error("V4_PEER_UNIT_NOT_RUNNING_OR_WRONG_SHA:disdex-pengu-dual-ls-v2@7688ed7c93a1918d8b44837339b7da5584a868f5.service"),
    25_000,
  );
  assert.deepEqual(result, {
    status: "blocked",
    reason: "V4_PEER_ATTESTATION_RETRY_REQUIRED:V4_PEER_UNIT_NOT_RUNNING_OR_WRONG_SHA:disdex-pengu-dual-ls-v2@7688ed7c93a1918d8b44837339b7da5584a868f5.service",
    eventTs: 25_000,
    candidateCount: 0,
    orderEnabled: false,
  });
  const health = buildV4HealthPayload("a".repeat(40), "CERTIFIED", result!, 25_000, 25_001);
  assert.equal(health.processState, "RUNNING");
  assert.equal(health.safetyState, "BLOCKED");
  assert.equal(health.ordersAllowed, false);
  assert.equal(health.orderPermission, "BLOCKED");
});

test("tampering, SHA mismatch, protection drift, and unknown errors remain fatal", () => {
  for (const reason of [
    "V4_EVIDENCE_CANDIDATE_SHA_MISMATCH:signedAsterAccount",
    "V4_EVIDENCE_DIGEST_MISMATCH:signedAsterAccount",
    "V4_PROTECTION_RECOVERY_VENUE_QTY_DRIFT:DOGEUSDT",
    "V4_ACCOUNT_MARK_MISMATCH",
    "UNKNOWN_FATAL",
  ]) {
    assert.equal(classifyV4RecoverableSafetyFailure(new Error(reason), 20_000), undefined, reason);
  }
});

test("one thousand injected expiry/network cycles never enable a new order", () => {
  for (let i = 0; i < 1_000; i += 1) {
    const reason = i % 2 === 0
      ? "V4_EVIDENCE_STALE:signedAsterAccount"
      : "ECONNRESET while reading signed account";
    const result = classifyV4RecoverableSafetyFailure(new Error(reason), 30_000 + i);
    assert.equal(result?.orderEnabled, false);
    assert.equal(result?.status, "blocked");
  }
});

test("bounded non-production soak can recover order permission only after an explicit healthy tick", () => {
  for (let i = 0; i < 300; i += 1) {
    const blocked = classifyV4RecoverableSafetyFailure(new Error("V4_EVIDENCE_STALE:sharedRiskAndPeers"), 40_000 + i);
    const health = buildV4HealthPayload("a".repeat(40), "CERTIFIED", blocked!, 40_000 + i, 40_001 + i);
    assert.equal(health.processState, "RUNNING");
    assert.equal(health.ordersAllowed, false);
    assert.equal(health.orderPermission, "BLOCKED");
  }
  const healthy = buildV4HealthPayload("a".repeat(40), "CERTIFIED", {
    status: "ready",
    reason: "NO_COMPLETED_BAR_SIGNAL",
    eventTs: 50_000,
    candidateCount: 0,
    orderEnabled: true,
  }, 50_000, 50_001);
  assert.equal(healthy.processState, "RUNNING");
  assert.equal(healthy.ordersAllowed, true);
  assert.equal(healthy.orderPermission, "ALLOWED");
});
