import assert from "node:assert/strict";
import test from "node:test";

import {
  assertRecoverableV12RuntimeLineageState,
  buildRecoveredV12RuntimeLineageState,
} from "../scripts/disdex-v12-runtime-lineage-recovery";

const sha = "c226fcf791ab21758c1690c42a8bf469f7045be3";

function state(overrides: Record<string, unknown> = {}) {
  return {
    schema: "v12-x1-all-runner-state/v1" as const,
    strategyId: "V12_X1.00_ALL" as const,
    mode: "LIVE" as const,
    updatedAt: 100,
    lastReferenceTs: 99,
    lastCompletedIdempotencyKey: "v12-entry-existing",
    activePositions: [],
    manualReview: "QUALITY102_OWNERSHIP_RUNTIME_SHA_MISMATCH",
    killSwitch: { active: true, reason: "QUALITY102_OWNERSHIP_RUNTIME_SHA_MISMATCH", trippedAt: 100 },
    ...overrides,
  };
}

test("V12 lineage recovery clears only the transient ownership review flags", () => {
  const before = state();
  assert.doesNotThrow(() => assertRecoverableV12RuntimeLineageState(before, sha));
  const after = buildRecoveredV12RuntimeLineageState(before, 200);
  assert.equal(after.manualReview, undefined);
  assert.equal(after.killSwitch, undefined);
  assert.deepEqual(after.activePositions, []);
  assert.equal(after.pending, undefined);
  assert.equal(after.lastReferenceTs, before.lastReferenceTs);
  assert.equal(after.lastCompletedIdempotencyKey, before.lastCompletedIdempotencyKey);
  assert.equal(after.updatedAt, 200);
});

test("V12 lineage recovery rejects non-flat or unrelated manual-review state", () => {
  assert.throws(() => assertRecoverableV12RuntimeLineageState(state({ pending: { clientOrderId: "x" } }), sha), /PENDING/);
  assert.throws(() => assertRecoverableV12RuntimeLineageState(state({ activePositions: [{ symbol: "DOGEUSDT" }] }), sha), /POSITION/);
  assert.throws(() => assertRecoverableV12RuntimeLineageState(state({ manualReview: "OTHER" }), sha), /REASON/);
});
