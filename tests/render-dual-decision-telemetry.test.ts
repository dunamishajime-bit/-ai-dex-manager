import assert from "node:assert/strict";
import test from "node:test";
import { buildRenderDualDecisionTelemetry } from "../lib/render-dual-decision-telemetry";

const missing = { status: "MISSING" as const, reason: "CERTIFICATE_MISSING" };
const valid = { status: "VALID" as const, reason: "CERTIFICATE_VALID_AT_BOUND_SHA" };
const shadow = {
  decisionTs: 3_600_000,
  rawAccepted: true,
  rawReason: "RENDER_INDEPENDENT_WICK_SHARP_SIGNAL",
  priority: { accepted: true, reason: "INDEPENDENT_SIGNAL_ACCEPTED", incumbentPreserved: false },
  pendingCount: 1,
  settledCount: 0,
  features: {
    decisionTs: 3_600_000,
    btcH1Pct: 0.2,
    renderH1Pct: -0.6,
    renderCompletedH4Pct: -0.2,
    renderCompletedD1Pct: -1,
    volumeRatio: 1.4,
    sellerShare: 0.55,
    upperWickPctOfOpen: 0.4,
  },
};

test("RENDER telemetry is fail-closed when live flags and certificates are absent", () => {
  const result = buildRenderDualDecisionTelemetry({
    runtimeSha: "a".repeat(40),
    decisionTs: 3_600_000,
    updatedAt: 3_600_001,
    legacyAuthorized: false,
    legacyCertificate: missing,
    independentAuthorized: false,
    independentCertificate: missing,
    sameSymbolPositionOrPending: false,
  });
  assert.equal(result.legacy.status, "DISABLED");
  assert.equal(result.legacy.orderPermission, "NOT_APPLICABLE");
  assert.equal(result.independent.status, "BLOCKED");
  assert.equal(result.independent.orderPermission, "DENIED");
  assert.equal(result.independent.policy.grossMax, 0.75);
  assert.equal(result.independent.policy.maxHoldMinutes, 360);
  assert.equal(result.independent.policy.requiresOpenInterest, false);
});

test("a passing independent signal remains a non-authorizing candidate until runtime admission", () => {
  const result = buildRenderDualDecisionTelemetry({
    runtimeSha: "b".repeat(40),
    decisionTs: 3_600_000,
    updatedAt: 3_600_001,
    legacyAuthorized: true,
    legacyCertificate: valid,
    independentAuthorized: true,
    independentCertificate: valid,
    independentDecision: shadow,
    sameSymbolPositionOrPending: false,
  });
  assert.equal(result.independent.status, "CANDIDATE");
  assert.equal(result.independent.orderPermission, "NOT_PROVEN");
  assert.equal(result.independent.reason, "RENDER_INDEPENDENT_RUNTIME_ADMISSION_PENDING");
  assert.equal(result.independent.decision?.features?.sellerShare, 0.55);
  assert.equal(result.legacy.status, "READY_FOR_EXISTING_POSITION");
  assert.equal(result.legacy.orderPermission, "EXIT_ONLY");
});

test("same-symbol exposure blocks independent RENDER even with a valid certificate", () => {
  const result = buildRenderDualDecisionTelemetry({
    runtimeSha: "c".repeat(40),
    decisionTs: 3_600_000,
    updatedAt: 3_600_001,
    legacyAuthorized: true,
    legacyCertificate: valid,
    independentAuthorized: true,
    independentCertificate: valid,
    independentDecision: shadow,
    sameSymbolPositionOrPending: true,
  });
  assert.equal(result.independent.status, "BLOCKED");
  assert.equal(result.independent.orderPermission, "DENIED");
  assert.equal(result.independent.reason, "RENDER_SAME_SYMBOL_POSITION_OR_PENDING");
});

test("legacy adverse telemetry is exit-only and exposes the durable M5 watch", () => {
  const result = buildRenderDualDecisionTelemetry({
    runtimeSha: "d".repeat(40),
    decisionTs: 7_200_000,
    updatedAt: 7_200_001,
    legacyAuthorized: true,
    legacyCertificate: valid,
    legacyPosition: {
      route: "IDLE_RENDER_RELATIVE_SHORT",
      protectionVerified: true,
      legacyRenderAdverse: { watchStartedAt: 3_600_000, lastClosedM5Ts: 7_000_000, maxFavorableExcursionPct: 0.1 },
    },
    legacyGate: { accepted: true, reason: "IDLE_RENDER_RELATIVE_SHORT", holdHours: 12 },
    independentAuthorized: false,
    independentCertificate: missing,
    sameSymbolPositionOrPending: true,
  });
  assert.equal(result.legacy.status, "WATCHING");
  assert.equal(result.legacy.orderPermission, "EXIT_ONLY");
  assert.equal(result.legacy.position.watchStartedAt, 3_600_000);
  assert.equal(result.legacy.policy.watchMinutes, 120);
  assert.equal(result.legacy.policy.maxFavorableExcursionPct, 0.25);
  assert.equal(result.legacy.policy.gross, 0.25);
});
