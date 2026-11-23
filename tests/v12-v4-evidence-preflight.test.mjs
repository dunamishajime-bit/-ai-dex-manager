import assert from "node:assert/strict";
import test from "node:test";
import { validateEvidenceBundle, validateRuntimeHealth } from "../scripts/ops/root/disdex-v12-v4-evidence-preflight.mjs";

const sha = "a".repeat(40);
const now = Date.parse("2026-10-19T04:00:00.000Z");
const capturedAt = new Date(now - 60_000).toISOString();
const payloads = {
  routeSourceParity: { schema: "disdex-v12-v4-evidence/route-source-parity-v1", status: "PASS", candidateSha: sha, capturedAt, routeCount: 41, sourceParity: true },
  establishedAsterOrders: { schema: "disdex-v12-v4-evidence/established-orders-v1", status: "PASS", candidateSha: sha, capturedAt, readOnly: true, mutationCalls: 0 },
  signedAsterAccount: { schema: "disdex-v12-v4-evidence/signed-account-v1", status: "PASS", candidateSha: sha, capturedAt, readOnly: true, signedGet: true, mutationCalls: 0 },
  v4ExecutionTests: { schema: "disdex-v12-v4-evidence/execution-tests-v1", status: "PASS", candidateSha: sha, capturedAt, testPasses: 206, failCount: 0, typecheck: true },
  sharedRiskAndPeers: { schema: "disdex-v12-v4-evidence/shared-risk-v1", status: "PASS", candidateSha: sha, capturedAt, sharedRiskHealthy: true, marginGuardHealthy: true, killSwitch: false, pendingCount: 0 },
};

test("evidence preflight accepts a current, read-only, healthy bundle", () => {
  const result = validateEvidenceBundle({ sha, releaseMarker: sha, payloads, now });
  assert.equal(result.routeCount, 41);
  assert.equal(result.mutationCalls, 0);
});

test("evidence preflight rejects old candidate attribution and stale evidence", () => {
  assert.throws(() => validateEvidenceBundle({
    sha,
    releaseMarker: sha,
    payloads: { ...payloads, routeSourceParity: { ...payloads.routeSourceParity, candidateSha: "b".repeat(40) } },
    now,
  }), /CANDIDATE_SHA/);
  assert.throws(() => validateEvidenceBundle({
    sha,
    releaseMarker: sha,
    payloads: { ...payloads, signedAsterAccount: { ...payloads.signedAsterAccount, capturedAt: "2026-10-10T00:00:00.000Z" } },
    now,
  }), /STALE/);
});

test("runtime health preflight preserves fail-closed risk and pending gates", () => {
  assert.doesNotThrow(() => validateRuntimeHealth({
    sharedRisk: { sourceComplete: true, tripped: false },
    marginGuard: { stage: "HEALTHY", ordersAllowed: true },
    killSwitch: { active: false },
    pendingExposure: { activeCount: 0 },
  }));
  assert.throws(() => validateRuntimeHealth({
    sharedRisk: { sourceComplete: true, tripped: true },
    marginGuard: { stage: "HEALTHY", ordersAllowed: true },
    killSwitch: { active: false },
    pendingExposure: { activeCount: 0 },
  }), /SHARED_RISK/);
  assert.throws(() => validateRuntimeHealth({
    sharedRisk: { sourceComplete: true, tripped: false },
    marginGuard: { stage: "HEALTHY", ordersAllowed: true },
    killSwitch: { active: false },
    pendingExposure: { activeCount: 1 },
  }), /PENDING/);
});

test("runtime health preflight accepts only an allowlisted V52 reference-only hold", () => {
  assert.doesNotThrow(() => validateRuntimeHealth({
    sharedRisk: { sourceComplete: true, tripped: false },
    marginGuard: { stage: "HEALTHY", ordersAllowed: true },
    killSwitch: {
      active: true,
      scope: "V52_REFERENCE_ONLY",
      operator: "disdex-v52-aster-only",
      action: "HOLD_PROTECTED",
      recoverable: true,
      reason: 'V52 recoverable tick error: HTTP 503 http://127.0.0.1:8797/quote?symbol=TSLA: {"error":"stale_quote"}',
    },
    pendingExposure: { activeCount: 0 },
  }));
  assert.throws(() => validateRuntimeHealth({
    sharedRisk: { sourceComplete: true, tripped: false },
    marginGuard: { stage: "HEALTHY", ordersAllowed: true },
    killSwitch: {
      active: true,
      scope: "V52_REFERENCE_ONLY",
      operator: "other",
      action: "HOLD_PROTECTED",
      recoverable: true,
      reason: 'V52 recoverable tick error: HTTP 503 http://127.0.0.1:8797/quote?symbol=TSLA: {"error":"stale_quote"}',
    },
    pendingExposure: { activeCount: 0 },
  }), /KILL_SWITCH/);
});
