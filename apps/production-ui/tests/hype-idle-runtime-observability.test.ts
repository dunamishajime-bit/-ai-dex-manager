import assert from "node:assert/strict";
import test from "node:test";

import { buildIndependentHypeIdleHealthEnvelope } from "../lib/server/hype-idle-health";
import { evaluateIdleRuntimeHealth } from "../lib/server/idle-runtime-observability";

test("HYPE and Idle health/order permission stay independent when Idle is stale", () => {
  const result = buildIndependentHypeIdleHealthEnvelope({
    hype: {
      status: "LIVE",
      orderPermission: { allowed: true, reason: "HYPE_HEALTHY" },
    },
    idle: {
      status: "STALE",
      orderPermission: { allowed: false, reason: "IDLE_RESIDUAL_STATE_STALE" },
    },
  });

  assert.equal(result.hype.status, "LIVE");
  assert.deepEqual(result.hype.orderPermission, { allowed: true, reason: "HYPE_HEALTHY" });
  assert.equal(result.idle.status, "STALE");
  assert.deepEqual(result.idle.orderPermission, { allowed: false, reason: "IDLE_RESIDUAL_STATE_STALE" });
  assert.equal(result.hype.orderPermission.allowed, true, "Idle failure must not stop HYPE");
});

test("Idle residual SHA/staleness blocks only residual order permission", () => {
  const now = 1_800_000_000_000;
  const sha = "a".repeat(40);
  const result = evaluateIdleRuntimeHealth({
    now,
    expectedSha: sha,
    heartbeat: { runtimeSha: sha, expectedSha: sha, heartbeatAt: now, mode: "LIVE", safetyState: "HEALTHY" },
    coreState: { runtimeSha: sha, updatedAt: now },
    residualState: { runtimeSha: "b".repeat(40), updatedAt: now - 4 * 60 * 60_000, position: null, pending: null },
  });

  assert.equal(result.core.status, "LIVE");
  assert.equal(result.core.orderPermission.allowed, true);
  assert.equal(result.residual.status, "BLOCKED");
  assert.equal(result.residual.orderPermission.allowed, false);
  assert.match(result.residual.orderPermission.reason, /SHA_MISMATCH/);
});

test("Idle core stale state blocks only core order permission and preserves decision timestamp", () => {
  const now = 1_800_000_000_000;
  const sha = "a".repeat(40);
  const result = evaluateIdleRuntimeHealth({
    now,
    expectedSha: sha,
    heartbeat: { runtimeSha: sha, expectedSha: sha, heartbeatAt: now, mode: "LIVE", safetyState: "HEALTHY" },
    coreState: {
      runtimeSha: sha,
      updatedAt: now - 4 * 60 * 60_000,
      lastDecision: { decisionTs: now - 1_000, accepted: false, reason: "IDLE_RATE_BUDGET_DEFERRED" },
    },
    residualState: { runtimeSha: sha, updatedAt: now, position: null, pending: null },
  });

  assert.equal(result.core.status, "STALE");
  assert.equal(result.core.orderPermission.allowed, false);
  assert.equal(result.residual.status, "LIVE");
  assert.equal(result.residual.orderPermission.allowed, true);
  assert.equal(result.core.lastDecision?.at, now - 1_000);
});

test("Idle rate-budget deferral blocks only the affected order permission", () => {
  const now = 1_800_000_000_000;
  const sha = "a".repeat(40);
  const result = evaluateIdleRuntimeHealth({
    now,
    expectedSha: sha,
    heartbeat: { runtimeSha: sha, expectedSha: sha, heartbeatAt: now, mode: "LIVE", safetyState: "HEALTHY" },
    coreState: {
      runtimeSha: sha,
      updatedAt: now,
      positions: [],
      lastDecisionTs: now,
      lastDecision: { decisionTs: now, accepted: false, reason: "IDLE_RATE_BUDGET_DEFERRED:SATURATED" },
    },
    residualState: { runtimeSha: sha, updatedAt: now, position: null, pending: null },
  });

  assert.equal(result.core.status, "LIVE");
  assert.equal(result.core.orderPermission.allowed, false);
  assert.match(result.core.orderPermission.reason, /RATE_BUDGET/);
  assert.equal(result.residual.orderPermission.allowed, true);
});

test("Idle protected positions require explicit protection verification", () => {
  const now = 1_800_000_000_000;
  const sha = "a".repeat(40);
  const unverified = evaluateIdleRuntimeHealth({
    now,
    expectedSha: sha,
    heartbeat: { runtimeSha: sha, expectedSha: sha, heartbeatAt: now, mode: "LIVE", safetyState: "HEALTHY" },
    coreState: { runtimeSha: sha, updatedAt: now, positions: [] },
    residualState: {
      runtimeSha: sha,
      updatedAt: now,
      position: { stopClientOrderId: "stop-1", takeProfitClientOrderId: "tp-1", protectionVerified: false },
    },
  });
  assert.equal(unverified.residual.status, "UNCONFIRMED");
  assert.equal(unverified.residual.protection.status, "UNVERIFIED");
  assert.equal(unverified.residual.orderPermission.allowed, false);

  const verified = evaluateIdleRuntimeHealth({
    now,
    expectedSha: sha,
    heartbeat: { runtimeSha: sha, expectedSha: sha, heartbeatAt: now, mode: "LIVE", safetyState: "HEALTHY" },
    coreState: { runtimeSha: sha, updatedAt: now, positions: [] },
    residualState: {
      runtimeSha: sha,
      updatedAt: now,
      position: { stopClientOrderId: "stop-1", takeProfitClientOrderId: "tp-1", protectionVerified: true },
      lastDecisionTs: now,
      lastDecision: { decisionTs: now, accepted: false, reason: "IDLE_RESIDUAL_RATE_BUDGET_DEFERRED:SATURATED" },
    },
  });
  assert.equal(verified.residual.status, "LIVE");
  assert.equal(verified.residual.protection.status, "VERIFIED");
  assert.equal(verified.residual.orderPermission.allowed, false);
  assert.match(verified.residual.orderPermission.reason, /RATE_BUDGET/);
});
