import test from "node:test";
import assert from "node:assert/strict";

import {
  assertRecoverableV12ProtectionFailureState,
  buildRecoveredV12ProtectionFailureState,
} from "../scripts/disdex-v12-protection-failure-recovery";

const SHA = "9326eaeb0ffca23bd158b287c58f83d04ab63c28";

function state(overrides: Record<string, unknown> = {}) {
  return {
    schema: "v12-x1-all-runner-state/v2",
    strategyId: "V12_X1.00_ALL",
    mode: "LIVE",
    updatedAt: 1,
    activePositions: [],
    pending: {
      idempotencyKey: "v12-entry-old",
      action: "ENTRY",
      clientOrderId: "v12-entry-old",
      symbol: "DOGEUSDT",
      side: "LONG",
      quantity: 577,
      signalTs: 1,
      createdAt: 1,
    },
    manualReview: "PROTECTION_FAILED_FLATTENED:Order would immediately trigger.",
    killSwitch: { active: true, reason: "V12_BASE_AGGREGATE_GROSS_OVER_CAP", trippedAt: 2 },
    ...overrides,
  } as any;
}

test("accepts only the exact flattened protection-failure state", () => {
  assert.doesNotThrow(() => assertRecoverableV12ProtectionFailureState(state(), SHA));
  assert.throws(() => assertRecoverableV12ProtectionFailureState(state({ activePositions: [{ symbol: "DOGEUSDT" }] }), SHA), /POSITION_PRESENT/);
  assert.throws(() => assertRecoverableV12ProtectionFailureState(state({ manualReview: "UNKNOWN" }), SHA), /REASON_NOT_EXACT/);
});

test("recovery clears only local pending/manual-review/kill-switch and preserves history", () => {
  const before = state({ lastCompletedIdempotencyKey: "prior", unknownField: { keep: true } });
  const after = buildRecoveredV12ProtectionFailureState(before, SHA, 99);
  assert.equal(after.runtimeCommitSha, SHA);
  assert.equal(after.pending, undefined);
  assert.equal(after.manualReview, undefined);
  assert.equal(after.killSwitch, undefined);
  assert.deepEqual(after.activePositions, []);
  assert.equal(after.lastCompletedIdempotencyKey, "v12-entry-old");
  assert.deepEqual((after as any).unknownField, { keep: true });
  assert.equal(after.reconciliationStatus, "PASS");
});
