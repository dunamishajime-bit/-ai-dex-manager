import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertRecoverableV12RateBudgetState,
  buildRecoveredV12RateBudgetState,
} from "../scripts/disdex-v12-rate-budget-recovery";

const SHA = "b937a1b209a652b71a165216d7ac0dbed5a13908";

function state(overrides: Record<string, unknown> = {}) {
  return {
    schema: "v12-x1-all-runner-state/v2",
    strategyId: "V12_X1.00_ALL",
    mode: "LIVE",
    updatedAt: 1,
    lastReferenceTs: 123,
    pending: {
      idempotencyKey: "v12-entry-stale",
      action: "ENTRY",
      clientOrderId: "v12-entry-stale",
      symbol: "LINKUSDT",
      side: "LONG",
      quantity: 1,
      signalTs: 100,
      createdAt: 101,
    },
    manualReview: "ASTER_GLOBAL_RATE_BUDGET_SATURATED:7987",
    killSwitch: {
      active: true,
      reason: "EROFS: read-only file system, open '/var/lib/disdex/fet-brk48-residual/state.json.165823.1790078425378.tmp'",
      trippedAt: 102,
    },
    activePositions: [],
    ...overrides,
  };
}

test("rate-budget recovery accepts only a stale entry with no local V12 position", () => {
  const pending = assertRecoverableV12RateBudgetState(state(), SHA);
  assert.equal(pending.clientOrderId, "v12-entry-stale");
});

test("rate-budget recovery rejects unrelated manual review or local position", () => {
  assert.throws(
    () => assertRecoverableV12RateBudgetState(state({ manualReview: "UNKNOWN_FAILURE" }), SHA),
    /REASON_NOT_EXACT/,
  );
  assert.throws(
    () => assertRecoverableV12RateBudgetState(state({ activePositions: [{ symbol: "LINKUSDT" }] }), SHA),
    /LOCAL_POSITION_PRESENT/,
  );
});

test("rate-budget recovery clears only stale local gates and preserves history", () => {
  const recovered = buildRecoveredV12RateBudgetState(state() as never, SHA, 456);
  assert.equal(recovered.runtimeCommitSha, SHA);
  assert.equal(recovered.pending, undefined);
  assert.equal(recovered.manualReview, undefined);
  assert.equal(recovered.killSwitch, undefined);
  assert.equal(recovered.lastCompletedIdempotencyKey, "v12-entry-stale");
  assert.equal(recovered.lastReferenceTs, 123);
  assert.equal(recovered.updatedAt, 456);
});
